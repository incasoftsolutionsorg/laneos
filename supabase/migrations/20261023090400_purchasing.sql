-- Purchasing (WF-005, Figma 1-2121, 11-3669, 1-2351, 11-3921, 11-3474):
--   preferred supplier per item, purchase orders with re-order suggestions, GRN with batches and
--   expiry, supplier ledger (append-only) + cached balance, supplier payments with an owner
--   approval limit, and an expiry list that infers what is left of each batch (FEFO, BR-031).

-- Suppliers and items -----------------------------------------------------------------------------------

alter table public.suppliers
  add column contact_name   text check (char_length(contact_name) <= 80),
  add column vat_no         text check (char_length(vat_no) <= 30),
  add column daily_delivery boolean not null default false;

alter table public.items add column supplier_id uuid references public.suppliers (id);   -- preferred supplier
create index items_supplier on public.items (supplier_id);

alter table public.tenants
  add column supplier_payment_approval_cents bigint not null default 5000000 check (supplier_payment_approval_cents >= 0); -- Rs 50,000

create type public.po_status as enum ('draft', 'sent', 'partially_received', 'received', 'cancelled');
create type public.grn_status as enum ('draft', 'posted');
create type public.supplier_payment_method as enum ('cash', 'bank_transfer', 'cheque');
create type public.supplier_payment_status as enum ('pending_approval', 'paid', 'rejected');
create type public.supplier_ledger_kind as enum ('grn', 'payment', 'return', 'adjustment');

-- Purchase orders --------------------------------------------------------------------------------------

create table public.purchase_orders (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references public.tenants (id),
  shop_id     uuid not null references public.shops (id),
  po_no       text not null,
  supplier_id uuid not null references public.suppliers (id),
  status      public.po_status not null default 'draft',
  expected_on date,
  note        text check (char_length(note) <= 300),
  total_cents bigint not null default 0 check (total_cents >= 0),
  created_by  uuid not null references public.members (id),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  updated_at  timestamptz not null default now(),
  unique (shop_id, po_no)
);
create index purchase_orders_shop on public.purchase_orders (shop_id, created_at desc);
create trigger purchase_orders_touch before update on public.purchase_orders for each row execute function app.touch_updated_at();

create table public.purchase_order_lines (
  id              uuid primary key default app.uuid_v7(),
  po_id           uuid not null references public.purchase_orders (id) on delete cascade,
  tenant_id       uuid not null references public.tenants (id),
  item_id         uuid not null references public.items (id),
  qty_milli       bigint not null check (qty_milli > 0),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  received_milli  bigint not null default 0 check (received_milli >= 0),
  unique (po_id, item_id)
);

-- Goods received notes and batches ----------------------------------------------------------------------

create table public.grns (
  id                  uuid primary key default app.uuid_v7(),
  tenant_id           uuid not null references public.tenants (id),
  shop_id             uuid not null references public.shops (id),
  grn_no              text not null,
  supplier_id         uuid not null references public.suppliers (id),
  po_id               uuid references public.purchase_orders (id),
  supplier_invoice_no text check (char_length(supplier_invoice_no) <= 40),
  received_on         date not null,
  status              public.grn_status not null default 'draft',
  subtotal_cents      bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents      bigint not null default 0 check (discount_cents >= 0),
  total_cents         bigint not null default 0 check (total_cents >= 0),   -- payable to the supplier
  paid_cents          bigint not null default 0 check (paid_cents >= 0),
  due_on              date,
  created_by          uuid not null references public.members (id),
  created_at          timestamptz not null default now(),
  posted_by           uuid references public.members (id),
  posted_at           timestamptz,
  updated_at          timestamptz not null default now(),
  unique (shop_id, grn_no),
  check (paid_cents <= total_cents)
);
create index grns_supplier on public.grns (supplier_id, received_on desc);
create index grns_open on public.grns (supplier_id) where status = 'posted' and paid_cents < total_cents;
create trigger grns_touch before update on public.grns for each row execute function app.touch_updated_at();

create table public.grn_lines (
  id              uuid primary key default app.uuid_v7(),
  grn_id          uuid not null references public.grns (id) on delete cascade,
  tenant_id       uuid not null references public.tenants (id),
  item_id         uuid not null references public.items (id),
  batch_no        text check (char_length(batch_no) <= 40),
  expiry_on       date,
  qty_milli       bigint not null check (qty_milli > 0),             -- paid units
  free_milli      bigint not null default 0 check (free_milli >= 0),  -- free issue
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  line_cents      bigint not null check (line_cents >= 0)
);
create index grn_lines_grn on public.grn_lines (grn_id);

create table public.stock_batches (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null references public.tenants (id),
  shop_id         uuid not null references public.shops (id),
  item_id         uuid not null references public.items (id),
  batch_no        text,
  expiry_on       date,
  received_milli  bigint not null check (received_milli > 0),
  unit_cost_cents bigint not null default 0,
  grn_line_id     uuid references public.grn_lines (id),
  received_at     timestamptz not null default now()
);
create index stock_batches_fefo on public.stock_batches (shop_id, item_id, expiry_on);

-- Supplier money ----------------------------------------------------------------------------------------

create table public.supplier_ledger (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants (id),
  supplier_id  uuid not null references public.suppliers (id),
  kind         public.supplier_ledger_kind not null,
  ref_id       uuid,
  amount_cents bigint not null check (amount_cents <> 0),   -- + we owe more, − we paid / got credit
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid
);
create index supplier_ledger_supplier on public.supplier_ledger (supplier_id, created_at desc);

create table public.supplier_payments (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants (id),
  shop_id      uuid not null references public.shops (id),
  payment_no   text not null,
  supplier_id  uuid not null references public.suppliers (id),
  method       public.supplier_payment_method not null,
  reference    text check (char_length(reference) <= 40),    -- cheque or transfer number
  cheque_date  date,
  amount_cents bigint not null check (amount_cents > 0),
  status       public.supplier_payment_status not null,
  allocations  jsonb not null default '[]',                   -- [{grnId, amountCents}] applied on approval
  created_by   uuid not null references public.members (id),
  created_at   timestamptz not null default now(),
  decided_by   uuid references public.members (id),
  decided_at   timestamptz,
  unique (shop_id, payment_no)
);
create index supplier_payments_supplier on public.supplier_payments (supplier_id, created_at desc);

create table public.supplier_payment_allocations (
  payment_id   uuid not null references public.supplier_payments (id),
  grn_id       uuid not null references public.grns (id),
  tenant_id    uuid not null references public.tenants (id),
  amount_cents bigint not null check (amount_cents > 0),
  primary key (payment_id, grn_id)
);

create trigger supplier_ledger_append_only before update or delete on public.supplier_ledger
  for each row execute function app.append_only();
create trigger supplier_payment_allocations_append_only before update or delete on public.supplier_payment_allocations
  for each row execute function app.append_only();

-- RLS ------------------------------------------------------------------------------------------------

alter table public.purchase_orders enable row level security;
alter table public.purchase_orders force row level security;
create policy purchase_orders_read on public.purchase_orders for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

alter table public.purchase_order_lines enable row level security;
alter table public.purchase_order_lines force row level security;
create policy purchase_order_lines_read on public.purchase_order_lines for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.grns enable row level security;
alter table public.grns force row level security;
create policy grns_read on public.grns for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

alter table public.grn_lines enable row level security;
alter table public.grn_lines force row level security;
create policy grn_lines_read on public.grn_lines for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.stock_batches enable row level security;
alter table public.stock_batches force row level security;
create policy stock_batches_read on public.stock_batches for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

alter table public.supplier_ledger enable row level security;
alter table public.supplier_ledger force row level security;
create policy supplier_ledger_read on public.supplier_ledger for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.supplier_payments enable row level security;
alter table public.supplier_payments force row level security;
create policy supplier_payments_read on public.supplier_payments for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.supplier_payment_allocations enable row level security;
alter table public.supplier_payment_allocations force row level security;
create policy supplier_payment_allocations_read on public.supplier_payment_allocations for select to authenticated
  using (tenant_id = (select app.tenant_id()));

revoke all on public.purchase_orders, public.purchase_order_lines, public.grns, public.grn_lines, public.stock_batches,
  public.supplier_ledger, public.supplier_payments, public.supplier_payment_allocations from anon;
revoke insert, update, delete, truncate on public.purchase_orders, public.purchase_order_lines, public.grns, public.grn_lines,
  public.stock_batches, public.supplier_ledger, public.supplier_payments, public.supplier_payment_allocations from authenticated;

-- Supplier ledger + cached balance in one statement pair (blueprint §21.4 rule 1). Internal.
create or replace function app.supplier_post(p_tenant uuid, p_supplier uuid, p_kind public.supplier_ledger_kind, p_ref uuid, p_amount bigint, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.supplier_ledger (tenant_id, supplier_id, kind, ref_id, amount_cents, note, created_by)
  values (p_tenant, p_supplier, p_kind, p_ref, p_amount, p_note, auth.uid());
  update public.suppliers set balance_due_cents = balance_due_cents + p_amount where id = p_supplier;
end $$;

-- Purchase orders -------------------------------------------------------------------------------------------

-- Items at or below their re-order level, with the preferred supplier, case size and a suggested order
-- (up to twice the re-order level, rounded up to whole cases).
create or replace function api.po_suggestions(p_shop uuid)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x."supplierName" nulls last, x.name), '[]') from (
    select i.id as "itemId", i.name, i.item_type as "itemType", coalesce(sl.qty_milli, 0) as "stockMilli",
           i.reorder_level_milli as "reorderMilli", i.cost_cents as "unitCostCents",
           s.id as "supplierId", s.name as "supplierName",
           coalesce((select max(b.pack_qty) from public.barcodes b where b.item_id = i.id), 1) as "caseQty",
           greatest(1000, ((greatest(i.reorder_level_milli * 2 - coalesce(sl.qty_milli, 0), 1000) + coalesce((select max(b.pack_qty) from public.barcodes b where b.item_id = i.id), 1) * 1000 - 1)
             / (coalesce((select max(b.pack_qty) from public.barcodes b where b.item_id = i.id), 1) * 1000))
             * coalesce((select max(b.pack_qty) from public.barcodes b where b.item_id = i.id), 1) * 1000) as "suggestMilli"
      from public.items i
      left join public.stock_levels sl on sl.item_id = i.id and sl.shop_id = p_shop
      left join public.suppliers s on s.id = i.supplier_id
     where i.is_active and i.reorder_level_milli > 0 and coalesce(sl.qty_milli, 0) <= i.reorder_level_milli
       and i.item_type <> 'open_price'
       and not exists (select 1 from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.po_id
                        where pl.item_id = i.id and po.shop_id = p_shop and po.status in ('draft', 'sent', 'partially_received'))
  ) x;
$$;

-- p: {id?, supplierId, expectedOn?, note?, lines:[{itemId, qtyMilli, unitCostCents}]}
create or replace function api.save_po(p_shop uuid, p jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_id     uuid := nullif(p ->> 'id', '')::uuid;
  v_po     public.purchase_orders;
begin
  perform app.require_perm('grn.post');
  if not app.can_shop(p_shop)
     or not exists (select 1 from public.suppliers s where s.id = (p ->> 'supplierId')::uuid and s.tenant_id = v_tenant) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then
    raise exception 'VALIDATION_ERROR: add at least one item' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.purchase_orders (tenant_id, shop_id, po_no, supplier_id, expected_on, note, created_by)
    values (v_tenant, p_shop, app.next_doc_no(p_shop, 'PO'), (p ->> 'supplierId')::uuid, (p ->> 'expectedOn')::date, p ->> 'note', app.member_id())
    returning id into v_id;
  else
    select * into v_po from public.purchase_orders po where po.id = v_id and po.tenant_id = v_tenant for update;
    if v_po.id is null then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_po.status <> 'draft' then
      raise exception 'VALIDATION_ERROR: only a draft order can be changed' using errcode = 'P0001';
    end if;
    update public.purchase_orders set supplier_id = (p ->> 'supplierId')::uuid, expected_on = (p ->> 'expectedOn')::date, note = p ->> 'note'
     where id = v_id;
    delete from public.purchase_order_lines where po_id = v_id;
  end if;
  insert into public.purchase_order_lines (po_id, tenant_id, item_id, qty_milli, unit_cost_cents)
  select v_id, v_tenant, i.id, (l ->> 'qtyMilli')::bigint, (l ->> 'unitCostCents')::bigint
    from jsonb_array_elements(p -> 'lines') l
    join public.items i on i.id = (l ->> 'itemId')::uuid and i.tenant_id = v_tenant;
  update public.purchase_orders po
     set total_cents = (select coalesce(sum(app.div_round(pl.qty_milli * pl.unit_cost_cents, 1000)), 0) from public.purchase_order_lines pl where pl.po_id = v_id)
   where po.id = v_id;
  return v_id;
end $$;

create or replace function api.po_action(p_po uuid, p_action text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
begin
  perform app.require_perm('grn.post');
  select * into v_po from public.purchase_orders po where po.id = p_po and po.tenant_id = app.tenant_id() for update;
  if v_po.id is null or not app.can_shop(v_po.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_action = 'send' and v_po.status = 'draft' then
    update public.purchase_orders set status = 'sent', sent_at = now() where id = p_po;
  elsif p_action = 'cancel' and v_po.status in ('draft', 'sent') then
    update public.purchase_orders set status = 'cancelled' where id = p_po;
  elsif p_action = 'close' and v_po.status = 'partially_received' then
    update public.purchase_orders set status = 'received' where id = p_po;
  else
    raise exception 'VALIDATION_ERROR: cannot % an order that is %', p_action, v_po.status using errcode = 'P0001';
  end if;
  perform app.audit('po.' || p_action, 'purchase_orders', p_po);
end $$;

-- GRN ------------------------------------------------------------------------------------------------------

-- p: {id?, supplierId, poId?, supplierInvoiceNo?, receivedOn, discountCents?,
--     lines:[{itemId, batchNo?, expiryOn?, qtyMilli, freeMilli?, unitCostCents}]}
-- p_post = true posts to stock: batches, movements, average cost, supplier ledger, PO received qty.
create or replace function api.save_grn(p_shop uuid, p jsonb, p_post boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant   uuid := app.tenant_id();
  v_id       uuid := nullif(p ->> 'id', '')::uuid;
  v_grn      public.grns;
  v_supplier public.suppliers;
  v_line     record;
  v_subtotal bigint;
  v_discount bigint := coalesce((p ->> 'discountCents')::bigint, 0);
  v_today    date := (now() at time zone 'Asia/Colombo')::date;
  v_level    public.stock_levels;
  v_po_left  boolean;
begin
  perform app.require_perm('grn.post');
  select * into v_supplier from public.suppliers s where s.id = (p ->> 'supplierId')::uuid and s.tenant_id = v_tenant;
  if v_supplier.id is null or not app.can_shop(p_shop) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then
    raise exception 'VALIDATION_ERROR: add at least one item' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p -> 'lines') l
              where (l ->> 'expiryOn') is not null
                and ((l ->> 'expiryOn')::date < v_today or (l ->> 'expiryOn')::date > v_today + interval '10 years')) then
    raise exception 'VALIDATION_ERROR: expiry must be today or later and within 10 years' using errcode = 'P0001';
  end if;
  if (p ->> 'poId') is not null and not exists (
       select 1 from public.purchase_orders po where po.id = (p ->> 'poId')::uuid and po.tenant_id = v_tenant
          and po.supplier_id = v_supplier.id and po.status in ('sent', 'partially_received')) then
    raise exception 'VALIDATION_ERROR: the purchase order is not open for this supplier' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.grns (tenant_id, shop_id, grn_no, supplier_id, po_id, supplier_invoice_no, received_on, created_by)
    values (v_tenant, p_shop, app.next_doc_no(p_shop, 'GRN'), v_supplier.id, (p ->> 'poId')::uuid, p ->> 'supplierInvoiceNo',
            coalesce((p ->> 'receivedOn')::date, v_today), app.member_id())
    returning id into v_id;
  else
    select * into v_grn from public.grns g where g.id = v_id and g.tenant_id = v_tenant for update;
    if v_grn.id is null then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_grn.status <> 'draft' then
      raise exception 'VALIDATION_ERROR: this GRN is already posted' using errcode = 'P0001';
    end if;
    update public.grns set supplier_id = v_supplier.id, po_id = (p ->> 'poId')::uuid, supplier_invoice_no = p ->> 'supplierInvoiceNo',
           received_on = coalesce((p ->> 'receivedOn')::date, v_today)
     where id = v_id;
    delete from public.grn_lines where grn_id = v_id;
  end if;

  insert into public.grn_lines (grn_id, tenant_id, item_id, batch_no, expiry_on, qty_milli, free_milli, unit_cost_cents, line_cents)
  select v_id, v_tenant, i.id, nullif(trim(l ->> 'batchNo'), ''), (l ->> 'expiryOn')::date, (l ->> 'qtyMilli')::bigint,
         coalesce((l ->> 'freeMilli')::bigint, 0), (l ->> 'unitCostCents')::bigint,
         app.div_round((l ->> 'qtyMilli')::bigint * (l ->> 'unitCostCents')::bigint, 1000)
    from jsonb_array_elements(p -> 'lines') l
    join public.items i on i.id = (l ->> 'itemId')::uuid and i.tenant_id = v_tenant;

  select coalesce(sum(line_cents), 0) into v_subtotal from public.grn_lines where grn_id = v_id;
  if v_discount > v_subtotal then
    raise exception 'VALIDATION_ERROR: discount is larger than the GRN' using errcode = 'P0001';
  end if;
  update public.grns set subtotal_cents = v_subtotal, discount_cents = v_discount, total_cents = v_subtotal - v_discount
   where id = v_id;

  if p_post then
    for v_line in select * from public.grn_lines where grn_id = v_id order by item_id loop
      -- Weighted average cost over sellable stock (free issue lowers the average).
      select * into v_level from public.stock_levels where shop_id = p_shop and item_id = v_line.item_id for update;
      perform app.post_movement(v_tenant, p_shop, v_line.item_id, v_line.qty_milli + v_line.free_milli, 'grn', 'grn', v_id);
      update public.stock_levels sl
         set avg_cost_cents = case
               when greatest(coalesce(v_level.qty_milli, 0), 0) + v_line.qty_milli + v_line.free_milli = 0 then v_line.unit_cost_cents
               else app.div_round(greatest(coalesce(v_level.qty_milli, 0), 0) * coalesce(v_level.avg_cost_cents, v_line.unit_cost_cents)
                                  + v_line.qty_milli * v_line.unit_cost_cents,
                                  greatest(coalesce(v_level.qty_milli, 0), 0) + v_line.qty_milli + v_line.free_milli) end
       where sl.shop_id = p_shop and sl.item_id = v_line.item_id;
      update public.items set cost_cents = v_line.unit_cost_cents, supplier_id = coalesce(supplier_id, v_supplier.id)
       where id = v_line.item_id;
      insert into public.stock_batches (tenant_id, shop_id, item_id, batch_no, expiry_on, received_milli, unit_cost_cents, grn_line_id)
      values (v_tenant, p_shop, v_line.item_id, v_line.batch_no, v_line.expiry_on, v_line.qty_milli + v_line.free_milli, v_line.unit_cost_cents, v_line.id);
      if (p ->> 'poId') is not null then
        update public.purchase_order_lines set received_milli = received_milli + v_line.qty_milli + v_line.free_milli
         where po_id = (p ->> 'poId')::uuid and item_id = v_line.item_id;
      end if;
    end loop;

    update public.grns set status = 'posted', posted_by = app.member_id(), posted_at = now(),
           due_on = received_on + v_supplier.payment_terms_days
     where id = v_id;
    if v_subtotal - v_discount > 0 then
      perform app.supplier_post(v_tenant, v_supplier.id, 'grn', v_id, v_subtotal - v_discount);
    end if;

    if (p ->> 'poId') is not null then
      select exists (select 1 from public.purchase_order_lines pl where pl.po_id = (p ->> 'poId')::uuid and pl.received_milli < pl.qty_milli)
        into v_po_left;
      update public.purchase_orders set status = case when v_po_left then 'partially_received'::public.po_status else 'received' end
       where id = (p ->> 'poId')::uuid;
    end if;
    perform app.audit('grn.post', 'grns', v_id, jsonb_build_object('total', v_subtotal - v_discount));
  end if;

  return jsonb_build_object('id', v_id, 'grnNo', (select g.grn_no from public.grns g where g.id = v_id), 'posted', p_post);
end $$;

-- Supplier payments ------------------------------------------------------------------------------------------

create or replace function app.apply_supplier_payment(p_payment uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_pay public.supplier_payments;
  v_a   jsonb;
begin
  select * into v_pay from public.supplier_payments where id = p_payment;
  for v_a in select x from jsonb_array_elements(v_pay.allocations) x loop
    update public.grns g set paid_cents = paid_cents + (v_a ->> 'amountCents')::bigint
     where g.id = (v_a ->> 'grnId')::uuid and g.supplier_id = v_pay.supplier_id and g.status = 'posted'
       and g.paid_cents + (v_a ->> 'amountCents')::bigint <= g.total_cents;
    if not found then
      raise exception 'VALIDATION_ERROR: an allocation is larger than what is open on that GRN' using errcode = 'P0001';
    end if;
    insert into public.supplier_payment_allocations (payment_id, grn_id, tenant_id, amount_cents)
    values (p_payment, (v_a ->> 'grnId')::uuid, v_pay.tenant_id, (v_a ->> 'amountCents')::bigint);
  end loop;
  perform app.supplier_post(v_pay.tenant_id, v_pay.supplier_id, 'payment', p_payment, -v_pay.amount_cents,
                            v_pay.method || coalesce(' ' || v_pay.reference, ''));
end $$;

-- p: {supplierId, method, reference?, chequeDate?, amountCents, allocations:[{grnId, amountCents}]}
-- Above the tenant's limit a payment waits for the owner (settings.manage) unless the payer is the owner.
create or replace function api.pay_supplier(p_shop uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant  uuid := app.tenant_id();
  v_limit   bigint;
  v_amount  bigint := (p ->> 'amountCents')::bigint;
  v_alloc   bigint;
  v_id      uuid;
  v_status  public.supplier_payment_status;
begin
  perform app.require_perm('supplier.manage');
  if not app.can_shop(p_shop)
     or not exists (select 1 from public.suppliers s where s.id = (p ->> 'supplierId')::uuid and s.tenant_id = v_tenant) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'VALIDATION_ERROR: enter the amount' using errcode = 'P0001';
  end if;
  select coalesce(sum((x ->> 'amountCents')::bigint), 0) into v_alloc from jsonb_array_elements(coalesce(p -> 'allocations', '[]')) x;
  if v_alloc > v_amount then
    raise exception 'VALIDATION_ERROR: the GRN amounts add up to more than the payment' using errcode = 'P0001';
  end if;
  if (p ->> 'method') = 'cheque' and nullif(p ->> 'reference', '') is null then
    raise exception 'VALIDATION_ERROR: enter the cheque number' using errcode = 'P0001';
  end if;

  select t.supplier_payment_approval_cents into v_limit from public.tenants t where t.id = v_tenant;
  v_status := case when v_amount > v_limit and not app.has_perm('settings.manage') then 'pending_approval' else 'paid' end;

  insert into public.supplier_payments (tenant_id, shop_id, payment_no, supplier_id, method, reference, cheque_date, amount_cents,
                                        status, allocations, created_by, decided_by, decided_at)
  values (v_tenant, p_shop, app.next_doc_no(p_shop, 'PAY'), (p ->> 'supplierId')::uuid, (p ->> 'method')::public.supplier_payment_method,
          nullif(p ->> 'reference', ''), (p ->> 'chequeDate')::date, v_amount, v_status, coalesce(p -> 'allocations', '[]'),
          app.member_id(), case when v_status = 'paid' then app.member_id() end, case when v_status = 'paid' then now() end)
  returning id into v_id;
  if v_status = 'paid' then
    perform app.apply_supplier_payment(v_id);
  end if;
  perform app.audit('supplier.pay', 'supplier_payments', v_id, jsonb_build_object('amount', v_amount, 'status', v_status));
  return jsonb_build_object('id', v_id, 'status', v_status, 'limitCents', v_limit);
end $$;

create or replace function api.decide_supplier_payment(p_payment uuid, p_approve boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_pay public.supplier_payments;
begin
  perform app.require_perm('settings.manage');
  select * into v_pay from public.supplier_payments where id = p_payment and tenant_id = app.tenant_id() for update;
  if v_pay.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_pay.status <> 'pending_approval' then
    raise exception 'VALIDATION_ERROR: this payment is not waiting for approval' using errcode = 'P0001';
  end if;
  update public.supplier_payments set status = case when p_approve then 'paid'::public.supplier_payment_status else 'rejected' end,
         decided_by = app.member_id(), decided_at = now()
   where id = p_payment;
  if p_approve then
    perform app.apply_supplier_payment(p_payment);
  end if;
  perform app.audit(case when p_approve then 'supplier.pay.approve' else 'supplier.pay.reject' end, 'supplier_payments', p_payment);
end $$;

-- Expiry (Figma 11-3474): what is left of each batch, inferred first-expiry-first-out from current
-- stock: the newest batches are assumed to be on the shelf, the oldest sold first.
create or replace function api.expiry_list(p_shop uuid, p_within_days integer)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with b as (
    select sb.*, i.name, i.item_type, coalesce(sl.qty_milli, 0) as stock,
           sum(sb.received_milli) over (partition by sb.item_id order by sb.expiry_on desc nulls first, sb.received_at desc
                                        rows between unbounded preceding and current row) as newer_incl
      from public.stock_batches sb
      join public.items i on i.id = sb.item_id
      left join public.stock_levels sl on sl.shop_id = sb.shop_id and sl.item_id = sb.item_id
     where sb.shop_id = p_shop and i.is_active
  ), left_ as (
    select b.*, least(b.received_milli, greatest(0, b.stock - (b.newer_incl - b.received_milli))) as left_milli from b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'batchId', id, 'itemId', item_id, 'name', name, 'itemType', item_type, 'batchNo', batch_no, 'expiryOn', expiry_on,
           'leftMilli', left_milli, 'unitCostCents', unit_cost_cents) order by expiry_on, name), '[]')
    from left_
   where left_milli > 0 and expiry_on is not null
     and expiry_on <= (now() at time zone 'Asia/Colombo')::date + p_within_days;
$$;

-- Grants --------------------------------------------------------------------------------------------------

revoke all on function api.po_suggestions(uuid), api.save_po(uuid, jsonb), api.po_action(uuid, text),
  api.save_grn(uuid, jsonb, boolean), api.pay_supplier(uuid, jsonb), api.decide_supplier_payment(uuid, boolean),
  api.expiry_list(uuid, integer) from public, anon;
grant execute on function api.po_suggestions(uuid), api.save_po(uuid, jsonb), api.po_action(uuid, text),
  api.save_grn(uuid, jsonb, boolean), api.pay_supplier(uuid, jsonb), api.decide_supplier_payment(uuid, boolean),
  api.expiry_list(uuid, integer) to authenticated, service_role;
