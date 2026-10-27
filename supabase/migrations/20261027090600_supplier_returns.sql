-- Supplier returns (blueprint SLICE-008, §30.1 "returned to supplier", TC-DMG-003):
--   goods go back to a supplier — damaged stock (a damage decision) or sellable stock (sale-or-return unsold, wrong
--   delivery). The supplier then credits the return (supplier ledger, `return` kind) or refuses it: damaged quantity
--   goes back to "awaiting decision", sellable quantity back to stock.

create type public.supplier_return_status as enum ('sent', 'credited', 'rejected');

create table public.supplier_returns (
  id            uuid primary key default app.uuid_v7(),
  tenant_id     uuid not null references public.tenants (id),
  shop_id       uuid not null references public.shops (id),
  return_no     text not null,
  supplier_id   uuid not null references public.suppliers (id),
  status        public.supplier_return_status not null default 'sent',
  value_cents   bigint not null check (value_cents >= 0),     -- at cost when sent
  credit_cents  bigint check (credit_cents >= 0),             -- what the supplier agreed to credit
  note          text check (char_length(note) <= 300),
  answer_note   text check (char_length(answer_note) <= 300),
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  answered_by   uuid,
  answered_at   timestamptz,
  unique (shop_id, return_no)
);
create index supplier_returns_supplier on public.supplier_returns (supplier_id, created_at desc);

create table public.supplier_return_lines (
  id                 uuid primary key default app.uuid_v7(),
  return_id          uuid not null references public.supplier_returns (id) on delete cascade,
  tenant_id          uuid not null references public.tenants (id),
  item_id            uuid not null references public.items (id),
  qty_milli          bigint not null check (qty_milli > 0),
  unit_cost_cents    bigint not null check (unit_cost_cents >= 0),
  line_cents         bigint not null check (line_cents >= 0),
  damage_report_id   uuid references public.damage_reports (id),  -- null = sellable stock
  damage_decision_id uuid references public.damage_decisions (id)
);

alter table public.supplier_returns enable row level security;
alter table public.supplier_returns force row level security;
alter table public.supplier_return_lines enable row level security;
alter table public.supplier_return_lines force row level security;
create policy supplier_returns_read on public.supplier_returns for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));
create policy supplier_return_lines_read on public.supplier_return_lines for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and exists (select 1 from public.supplier_returns r where r.id = return_id and (select app.can_shop(r.shop_id))));
revoke all on public.supplier_returns, public.supplier_return_lines from anon;
revoke insert, update, delete, truncate on public.supplier_returns, public.supplier_return_lines from authenticated;

-- p: {supplierId, note?, lines: [{damageReportId, qtyMilli} | {itemId, qtyMilli}]}
create or replace function api.create_supplier_return(p_shop uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant   uuid := app.tenant_id();
  v_supplier uuid := (p ->> 'supplierId')::uuid;
  v_id       uuid;
  v_no       text;
  v_l        jsonb;
  v_qty      bigint;
  v_r        public.damage_reports;
  v_dec      uuid;
  v_item     public.items;
  v_cost     bigint;
  v_stock    bigint;
  v_total    bigint := 0;
begin
  perform app.require_perm('stock.adjust');
  if not app.can_shop(p_shop) or not exists (select 1 from public.suppliers s where s.id = v_supplier and s.tenant_id = v_tenant) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then
    raise exception 'VALIDATION_ERROR: add at least one item' using errcode = 'P0001';
  end if;
  v_no := app.next_doc_no(p_shop, 'SRN');
  insert into public.supplier_returns (tenant_id, shop_id, return_no, supplier_id, value_cents, note, created_by)
  values (v_tenant, p_shop, v_no, v_supplier, 0, nullif(trim(p ->> 'note'), ''), auth.uid()) returning id into v_id;

  for v_l in select x from jsonb_array_elements(p -> 'lines') x loop
    v_qty := (v_l ->> 'qtyMilli')::bigint;
    if v_qty is null or v_qty <= 0 then
      raise exception 'VALIDATION_ERROR: every line needs a quantity' using errcode = 'P0001';
    end if;
    if (v_l ->> 'damageReportId') is not null then
      -- Damaged stock: the same as the "return to supplier" decision, linked to this return.
      select * into v_r from public.damage_reports d where d.id = (v_l ->> 'damageReportId')::uuid and d.tenant_id = v_tenant and d.shop_id = p_shop for update;
      if v_r.id is null then
        raise exception 'NOT_FOUND: damage report' using errcode = 'P0001';
      end if;
      if v_r.status not in ('reported', 'awaiting_decision') or v_qty > v_r.remaining_milli then
        raise exception 'VALIDATION_ERROR: % is not waiting for a decision, or less is left', v_r.report_no using errcode = 'P0001';
      end if;
      insert into public.damage_decisions (tenant_id, damage_report_id, decision, qty_milli, supplier_return_id, decided_by)
      values (v_tenant, v_r.id, 'supplier_return', v_qty, v_id, app.member_id()) returning id into v_dec;
      update public.stock_levels set damaged_milli = damaged_milli - v_qty, updated_at = now() where shop_id = p_shop and item_id = v_r.item_id;
      update public.damage_reports set remaining_milli = remaining_milli - v_qty,
             status = case when remaining_milli - v_qty > 0 then 'awaiting_decision'::public.damage_status else 'sent_to_supplier' end
       where id = v_r.id;
      v_cost := v_r.unit_cost_cents;
      insert into public.supplier_return_lines (return_id, tenant_id, item_id, qty_milli, unit_cost_cents, line_cents, damage_report_id, damage_decision_id)
      values (v_id, v_tenant, v_r.item_id, v_qty, v_cost, app.div_round(v_cost * v_qty, 1000), v_r.id, v_dec);
    else
      -- Sellable stock (sale-or-return unsold, wrong delivery): leaves stock now.
      select * into v_item from public.items i where i.id = (v_l ->> 'itemId')::uuid and i.tenant_id = v_tenant;
      if v_item.id is null then
        raise exception 'NOT_FOUND: item' using errcode = 'P0001';
      end if;
      select coalesce(nullif(sl.avg_cost_cents, 0), v_item.cost_cents, 0), coalesce(sl.qty_milli, 0) into v_cost, v_stock
        from (select 1) one left join public.stock_levels sl on sl.shop_id = p_shop and sl.item_id = v_item.id;
      if v_qty > v_stock then
        raise exception 'VALIDATION_ERROR: only % of % in stock', v_stock / 1000.0, v_item.name using errcode = 'P0001';
      end if;
      perform app.post_movement(v_tenant, p_shop, v_item.id, -v_qty, 'adjustment', 'supplier_return', v_id, v_no);
      insert into public.supplier_return_lines (return_id, tenant_id, item_id, qty_milli, unit_cost_cents, line_cents)
      values (v_id, v_tenant, v_item.id, v_qty, v_cost, app.div_round(v_cost * v_qty, 1000));
    end if;
  end loop;

  select coalesce(sum(line_cents), 0) into v_total from public.supplier_return_lines where return_id = v_id;
  update public.supplier_returns set value_cents = v_total where id = v_id;
  perform app.audit('supplier_return.send', 'supplier_returns', v_id, jsonb_build_object('supplier', v_supplier, 'value', v_total));
  return jsonb_build_object('id', v_id, 'returnNo', v_no, 'valueCents', v_total);
end $$;

-- credit {creditCents, note} → supplier ledger; reject {note} → damaged qty back to awaiting decision, sellable back to stock.
create or replace function api.answer_supplier_return(p_return uuid, p_action text, p_credit_cents bigint default null, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_r public.supplier_returns;
  v_l record;
begin
  perform app.require_perm('supplier.manage');
  select * into v_r from public.supplier_returns r where r.id = p_return and r.tenant_id = app.tenant_id() for update;
  if v_r.id is null or not app.can_shop(v_r.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_r.status <> 'sent' then
    raise exception 'VALIDATION_ERROR: this return has already been answered' using errcode = 'P0001';
  end if;
  if p_action = 'credit' then
    if p_credit_cents is null or p_credit_cents <= 0 then
      raise exception 'VALIDATION_ERROR: enter the amount the supplier credits' using errcode = 'P0001';
    end if;
    perform app.supplier_post(v_r.tenant_id, v_r.supplier_id, 'return', v_r.id, -p_credit_cents, v_r.return_no);
    update public.supplier_returns set status = 'credited', credit_cents = p_credit_cents, answer_note = nullif(trim(p_note), ''),
           answered_by = auth.uid(), answered_at = now() where id = v_r.id;
    update public.damage_reports d set status = 'closed'
     where d.id in (select l.damage_report_id from public.supplier_return_lines l where l.return_id = v_r.id)
       and d.status = 'sent_to_supplier' and d.remaining_milli = 0;
  elsif p_action = 'reject' then
    if char_length(coalesce(trim(p_note), '')) < 3 then
      raise exception 'VALIDATION_ERROR: say why the supplier refused' using errcode = 'P0001';
    end if;
    for v_l in select * from public.supplier_return_lines l where l.return_id = v_r.id loop
      if v_l.damage_report_id is not null then
        update public.stock_levels set damaged_milli = damaged_milli + v_l.qty_milli, updated_at = now()
         where shop_id = v_r.shop_id and item_id = v_l.item_id;
        update public.damage_reports set remaining_milli = remaining_milli + v_l.qty_milli, status = 'awaiting_decision'
         where id = v_l.damage_report_id;
      else
        perform app.post_movement(v_r.tenant_id, v_r.shop_id, v_l.item_id, v_l.qty_milli, 'adjustment', 'supplier_return', v_r.id, v_r.return_no || ' refused');
      end if;
    end loop;
    update public.supplier_returns set status = 'rejected', answer_note = trim(p_note), answered_by = auth.uid(), answered_at = now() where id = v_r.id;
  else
    raise exception 'VALIDATION_ERROR: credit or reject' using errcode = 'P0001';
  end if;
  perform app.audit('supplier_return.' || p_action, 'supplier_returns', v_r.id, jsonb_build_object('credit', p_credit_cents, 'note', p_note));
end $$;

revoke all on function api.create_supplier_return(uuid, jsonb), api.answer_supplier_return(uuid, text, bigint, text) from public, anon;
grant execute on function api.create_supplier_return(uuid, jsonb), api.answer_supplier_return(uuid, text, bigint, text) to authenticated, service_role;
