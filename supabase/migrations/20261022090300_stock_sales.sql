-- Stock (shop level): cached levels + append-only movement ledger, written in the same transaction.
-- Sales (shop level): shifts, sales, sale lines, sale payments and the functions that write them.

create table public.stock_levels (
  shop_id        uuid not null references public.shops (id),
  item_id        uuid not null references public.items (id),
  tenant_id      uuid not null references public.tenants (id),
  qty_milli      bigint not null default 0,              -- sellable; may go negative (BR-032)
  damaged_milli  bigint not null default 0 check (damaged_milli >= 0), -- never sellable (BR-070)
  avg_cost_cents bigint not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (shop_id, item_id)
) with (fillfactor = 80);
create index stock_levels_tenant_item on public.stock_levels (tenant_id, item_id);

create table public.stock_movements (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null references public.tenants (id),
  shop_id    uuid not null references public.shops (id),
  item_id    uuid not null references public.items (id),
  qty_milli  bigint not null check (qty_milli <> 0),     -- signed: + in, − out
  reason     public.movement_reason not null,
  ref_type   text,                                       -- e.g. 'sale', 'grn'
  ref_id     uuid,
  note       text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid
);
create index stock_movements_item_time on public.stock_movements (shop_id, item_id, created_at desc);
create index stock_movements_ref on public.stock_movements (ref_type, ref_id);

create table public.shifts (
  id                  uuid primary key default app.uuid_v7(),
  tenant_id           uuid not null references public.tenants (id),
  shop_id             uuid not null references public.shops (id),
  lane_id             uuid not null references public.lanes (id),
  shift_no            bigint generated always as identity,
  status              public.shift_status not null default 'open',
  opened_by           uuid not null references public.members (id),
  opened_at           timestamptz not null default now(),
  opening_float_cents bigint not null default 0 check (opening_float_cents >= 0),
  closed_by           uuid references public.members (id),
  closed_at           timestamptz,
  expected_cash_cents bigint,
  counted_cash_cents  bigint check (counted_cash_cents >= 0),
  check ((status = 'open') = (closed_at is null))
);
create unique index shifts_one_open_per_lane on public.shifts (lane_id) where status = 'open';
create index shifts_shop_time on public.shifts (shop_id, opened_at desc);

-- Not partitioned yet; monthly partitions (blueprint §22.2) come before go-live volumes.
create table public.sales (
  id                uuid primary key default app.uuid_v7(),
  tenant_id         uuid not null references public.tenants (id),
  shop_id           uuid not null references public.shops (id),
  lane_id           uuid not null references public.lanes (id),
  shift_id          uuid not null references public.shifts (id),
  invoice_no        text not null,
  customer_id       uuid references public.customers (id),
  member_id         uuid not null references public.members (id),
  subtotal_cents    bigint not null check (subtotal_cents >= 0),
  promo_cents       bigint not null default 0 check (promo_cents >= 0),
  rounding_cents    integer not null default 0,
  total_cents       bigint not null check (total_cents >= 0),
  paid_cents        bigint not null check (paid_cents >= 0),
  change_cents      bigint not null default 0 check (change_cents >= 0),
  balance_due_cents bigint not null default 0 check (balance_due_cents >= 0),
  client_uuid       uuid not null,                       -- idempotency key from the lane (PRN-004)
  created_at        timestamptz not null default now(),
  created_by        uuid not null,
  unique (lane_id, invoice_no)
);
create unique index sales_idem on public.sales (tenant_id, client_uuid);
create index sales_shop_time on public.sales (shop_id, created_at desc);
create index sales_created_brin on public.sales using brin (created_at);

create table public.sale_lines (
  id               uuid primary key default app.uuid_v7(),
  sale_id          uuid not null references public.sales (id),
  tenant_id        uuid not null references public.tenants (id),
  shop_id          uuid not null references public.shops (id),
  line_no          integer not null check (line_no >= 1),
  item_id          uuid not null references public.items (id),
  item_name        text not null,                        -- snapshot for receipts and history
  item_type        public.item_type not null,
  tax_class        public.tax_class not null,
  qty_milli        bigint not null check (qty_milli > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  gross_cents      bigint not null check (gross_cents >= 0),
  promo_cents      bigint not null default 0 check (promo_cents >= 0),
  net_cents        bigint not null check (net_cents >= 0),
  promotion_id     uuid references public.promotions (id),
  unique (sale_id, line_no)
);
create index sale_lines_item on public.sale_lines (item_id);

create table public.sale_payments (
  id           uuid primary key default app.uuid_v7(),
  sale_id      uuid not null references public.sales (id),
  tenant_id    uuid not null references public.tenants (id),
  shop_id      uuid not null references public.shops (id),
  method       public.payment_method not null,
  amount_cents bigint not null check (amount_cents > 0),
  reference    text check (char_length(reference) <= 64),
  created_at   timestamptz not null default now()
);
create index sale_payments_sale on public.sale_payments (sale_id);

-- Append-only ledgers and financial records (PRN-003). Shifts change only through api.close_shift.
create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function app.append_only();
create trigger sales_append_only before update or delete on public.sales
  for each row execute function app.append_only();
create trigger sale_lines_append_only before update or delete on public.sale_lines
  for each row execute function app.append_only();
create trigger sale_payments_append_only before update or delete on public.sale_payments
  for each row execute function app.append_only();

-- RLS: read by tenant and shop; no write policies, so writes happen only in api.* functions.
alter table public.stock_levels enable row level security;
alter table public.stock_levels force row level security;
create policy stock_levels_read on public.stock_levels for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

alter table public.stock_movements enable row level security;
alter table public.stock_movements force row level security;
create policy stock_movements_read on public.stock_movements for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

alter table public.shifts enable row level security;
alter table public.shifts force row level security;
create policy shifts_read on public.shifts for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

alter table public.sales enable row level security;
alter table public.sales force row level security;
create policy sales_read on public.sales for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

alter table public.sale_lines enable row level security;
alter table public.sale_lines force row level security;
create policy sale_lines_read on public.sale_lines for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

alter table public.sale_payments enable row level security;
alter table public.sale_payments force row level security;
create policy sale_payments_read on public.sale_payments for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

revoke all on public.stock_levels, public.stock_movements, public.shifts, public.sales, public.sale_lines,
  public.sale_payments from anon;
revoke insert, update, delete, truncate on public.stock_levels, public.stock_movements, public.shifts,
  public.sales, public.sale_lines, public.sale_payments from authenticated;

-- Stock ----------------------------------------------------------------------------------------

-- Ledger + cached balance in one statement pair (blueprint §21.4 rule 1). Internal only.
create or replace function app.post_movement(
  p_tenant uuid, p_shop uuid, p_item uuid, p_qty bigint, p_reason public.movement_reason,
  p_ref_type text default null, p_ref_id uuid default null, p_note text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.stock_movements (tenant_id, shop_id, item_id, qty_milli, reason, ref_type, ref_id, note, created_by)
  values (p_tenant, p_shop, p_item, p_qty, p_reason, p_ref_type, p_ref_id, p_note, auth.uid());

  insert into public.stock_levels (shop_id, item_id, tenant_id, qty_milli)
  values (p_shop, p_item, p_tenant, p_qty)
  on conflict (shop_id, item_id) do update
    set qty_milli = public.stock_levels.qty_milli + excluded.qty_milli, updated_at = now();
end $$;

revoke all on function app.post_movement from public, anon, authenticated;

-- Back-office stock adjustment (opening stock, counts, corrections).
create or replace function api.adjust_stock(p_shop uuid, p_item uuid, p_qty_milli bigint, p_reason text, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
begin
  perform app.require_perm('stock.adjust');
  if p_reason not in ('opening', 'adjustment', 'wastage', 'count') then
    raise exception 'VALIDATION_ERROR: reason must be opening, adjustment, wastage or count' using errcode = 'P0001';
  end if;
  if not app.can_shop(p_shop)
     or not exists (select 1 from public.items i where i.id = p_item and i.tenant_id = v_tenant) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_qty_milli = 0 then
    return;
  end if;
  perform app.post_movement(v_tenant, p_shop, p_item, p_qty_milli, p_reason::public.movement_reason, 'adjustment', null, p_note);
end $$;

-- Shifts ---------------------------------------------------------------------------------------

create or replace function api.open_shift(p_lane uuid, p_opening_float_cents bigint default 0)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_lane   public.lanes;
  v_shift  uuid;
begin
  perform app.require_perm('sale.create');
  select * into v_lane from public.lanes l where l.id = p_lane and l.tenant_id = v_tenant;
  if v_lane.id is null or not app.can_shop(v_lane.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_lane.status <> 'active' then
    raise exception 'FORBIDDEN: lane is disabled' using errcode = 'P0001';
  end if;
  begin
    insert into public.shifts (tenant_id, shop_id, lane_id, opened_by, opening_float_cents)
    values (v_tenant, v_lane.shop_id, v_lane.id, app.member_id(), p_opening_float_cents)
    returning id into v_shift;
  exception when unique_violation then
    raise exception 'SHIFT_ALREADY_OPEN' using errcode = 'P0001';
  end;
  return v_shift;
end $$;

create or replace function api.close_shift(p_shift uuid, p_counted_cash_cents bigint)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant   uuid := app.tenant_id();
  v_shift    public.shifts;
  v_cash     bigint;
  v_change   bigint;
  v_expected bigint;
begin
  perform app.require_perm('sale.create');
  select * into v_shift from public.shifts s where s.id = p_shift and s.tenant_id = v_tenant for update;
  if v_shift.id is null or not app.can_shop(v_shift.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'SHIFT_NOT_OPEN' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_cents), 0) into v_cash
    from public.sale_payments p join public.sales s on s.id = p.sale_id
   where s.shift_id = p_shift and p.method = 'cash';
  select coalesce(sum(s.change_cents), 0) into v_change from public.sales s where s.shift_id = p_shift;
  v_expected := v_shift.opening_float_cents + v_cash - v_change;

  update public.shifts set status = 'closed', closed_at = now(), closed_by = app.member_id(),
         expected_cash_cents = v_expected, counted_cash_cents = p_counted_cash_cents
   where id = p_shift;

  perform app.audit('shift.close', 'shifts', p_shift,
    jsonb_build_object('expected', v_expected, 'counted', p_counted_cash_cents));
  return jsonb_build_object('expectedCashCents', v_expected, 'countedCashCents', p_counted_cash_cents,
                            'varianceCents', p_counted_cash_cents - v_expected);
end $$;

-- Pricing (server truth) --------------------------------------------------------------------------
-- Same rules as packages/pricing: weighed qty in grams × price per kg, best single promotion per
-- item (BR-021), cash rounding to the tenant's unit. Half-up rounding everywhere.

create or replace function app.div_round(p_num numeric, p_den numeric)
returns bigint
language sql immutable
set search_path = ''
as $$
  select (sign(p_num) * sign(p_den) * floor((abs(p_num) + floor(abs(p_den) / 2)) / abs(p_den)))::bigint;
$$;

create or replace function api.create_sale(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant   uuid := app.tenant_id();
  v_member   uuid := app.member_id();
  v_client   uuid := (p ->> 'clientUuid')::uuid;
  v_lane     public.lanes;
  v_shop     public.shops;
  v_shift    uuid;
  v_unit     integer;
  v_list     uuid;
  v_existing public.sales;
  v_sale     uuid;
  v_invoice  text;
  v_seq      bigint;
  v_line     record;
  v_line_no  integer := 0;
  v_subtotal bigint := 0;
  v_promo    bigint := 0;
  v_before   bigint;
  v_rounding integer;
  v_total    bigint;
  v_paid     bigint;
  v_cash     bigint;
  v_change   bigint;
begin
  perform app.require_perm('sale.create');

  -- Idempotency: a retried request returns the first result (PRN-004).
  select * into v_existing from public.sales s where s.tenant_id = v_tenant and s.client_uuid = v_client;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'invoiceNo', v_existing.invoice_no,
      'subtotalCents', v_existing.subtotal_cents, 'promoCents', v_existing.promo_cents,
      'roundingCents', v_existing.rounding_cents, 'totalCents', v_existing.total_cents,
      'changeCents', v_existing.change_cents, 'replayed', true);
  end if;

  select * into v_lane from public.lanes l where l.id = (p ->> 'laneId')::uuid and l.tenant_id = v_tenant;
  if v_lane.id is null or not app.can_shop(v_lane.shop_id) then
    raise exception 'NOT_FOUND: lane' using errcode = 'P0001';
  end if;
  if v_lane.status <> 'active' then
    raise exception 'FORBIDDEN: lane is disabled' using errcode = 'P0001';
  end if;
  select * into v_shop from public.shops s where s.id = v_lane.shop_id;
  select s.id into v_shift from public.shifts s where s.lane_id = v_lane.id and s.status = 'open';
  if v_shift is null then
    raise exception 'SHIFT_NOT_OPEN' using errcode = 'P0001';
  end if;
  if (p ->> 'customerId') is not null
     and not exists (select 1 from public.customers c where c.id = (p ->> 'customerId')::uuid and c.tenant_id = v_tenant) then
    raise exception 'NOT_FOUND: customer' using errcode = 'P0001';
  end if;

  select t.rounding_unit_cents into v_unit from public.tenants t where t.id = v_tenant;
  select pl.id into v_list from public.price_lists pl where pl.tenant_id = v_tenant and pl.is_default;

  -- Price every merged line on the server. Rows are processed in item order so stock rows are
  -- always locked in the same order (no deadlocks between lanes).
  create temp table if not exists pg_temp.sale_calc (
    item_id uuid primary key, item_name text, item_type public.item_type, tax_class public.tax_class,
    qty_milli bigint, unit_price_cents bigint, gross_cents bigint, promo_cents bigint, promotion_id uuid
  ) on commit drop;
  delete from pg_temp.sale_calc;

  insert into pg_temp.sale_calc (item_id, item_name, item_type, tax_class, qty_milli, unit_price_cents)
  select i.id, i.name, i.item_type, i.tax_class, x.qty,
         case when i.item_type = 'open_price' then x.open_price else pli.price_cents end
    from (select (l ->> 'itemId')::uuid as item_id,
                 sum((l ->> 'qtyMilli')::bigint) as qty,
                 max((l ->> 'openPriceCents')::bigint) as open_price
            from jsonb_array_elements(p -> 'lines') l
           group by 1) x
    join public.items i on i.id = x.item_id and i.tenant_id = v_tenant and i.is_active
    left join public.price_list_items pli on pli.price_list_id = v_list and pli.item_id = i.id;

  if (select count(*) from pg_temp.sale_calc)
     <> (select count(distinct l ->> 'itemId') from jsonb_array_elements(p -> 'lines') l) then
    raise exception 'ITEM_INACTIVE' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_temp.sale_calc c where c.unit_price_cents is null) then
    raise exception 'VALIDATION_ERROR: item has no price' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_temp.sale_calc c join public.items i on i.id = c.item_id
              where i.mrp_cents is not null and c.unit_price_cents > i.mrp_cents) then
    raise exception 'ABOVE_MRP' using errcode = 'P0001';
  end if;

  update pg_temp.sale_calc set gross_cents = app.div_round(unit_price_cents * qty_milli, 1000);

  update pg_temp.sale_calc c set promo_cents = best.saving, promotion_id = best.promotion_id
    from (
      select distinct on (c2.item_id) c2.item_id, pr.id as promotion_id,
             least(c2.gross_cents, case
               when pr.kind = 'percent_off' then app.div_round(c2.gross_cents * pr.percent_bp, 10000)
               when c2.item_type = 'weighed' then 0
               else greatest(0, ((c2.qty_milli / 1000) / pr.buy_qty)  -- integer division = whole groups
                                 * (pr.buy_qty * c2.unit_price_cents - pr.bundle_price_cents))
             end) as saving
        from pg_temp.sale_calc c2
        join public.promotion_items pi on pi.item_id = c2.item_id
        join public.promotions pr on pr.id = pi.promotion_id
       where pr.is_active and pr.starts_at <= now() and (pr.ends_at is null or pr.ends_at > now())
       order by c2.item_id, saving desc, pr.id
    ) best
   where c.item_id = best.item_id and best.saving > 0;

  update pg_temp.sale_calc set promo_cents = 0 where promo_cents is null;

  select coalesce(sum(gross_cents), 0), coalesce(sum(promo_cents), 0) into v_subtotal, v_promo from pg_temp.sale_calc;
  v_before := v_subtotal - v_promo;
  v_rounding := case when v_unit <= 1 then 0 else app.div_round(v_before, v_unit) * v_unit - v_before end;
  v_total := v_before + v_rounding;

  if (p ->> 'expectedTotalCents')::bigint is distinct from v_total then
    raise exception 'PRICE_MISMATCH: server total %', v_total using errcode = 'P0001';
  end if;

  select coalesce(sum((x ->> 'amountCents')::bigint), 0),
         coalesce(sum((x ->> 'amountCents')::bigint) filter (where x ->> 'method' = 'cash'), 0)
    into v_paid, v_cash
    from jsonb_array_elements(p -> 'payments') x;
  if v_paid < v_total then
    raise exception 'UNDERPAID' using errcode = 'P0001';
  end if;
  v_change := v_paid - v_total;
  if v_change > v_cash then
    raise exception 'VALIDATION_ERROR: change can only be given from cash' using errcode = 'P0001';
  end if;

  update public.lanes set invoice_seq = invoice_seq + 1, last_seen_at = now()
   where id = v_lane.id returning invoice_seq into v_seq;
  v_invoice := v_shop.code || '-' || v_lane.code || '-' || lpad(v_seq::text, 6, '0');

  insert into public.sales (tenant_id, shop_id, lane_id, shift_id, invoice_no, customer_id, member_id,
                            subtotal_cents, promo_cents, rounding_cents, total_cents, paid_cents, change_cents,
                            client_uuid, created_by)
  values (v_tenant, v_lane.shop_id, v_lane.id, v_shift, v_invoice, (p ->> 'customerId')::uuid, v_member,
          v_subtotal, v_promo, v_rounding, v_total, v_paid, v_change, v_client, auth.uid())
  returning id into v_sale;

  for v_line in select * from pg_temp.sale_calc order by item_id loop
    v_line_no := v_line_no + 1;
    insert into public.sale_lines (sale_id, tenant_id, shop_id, line_no, item_id, item_name, item_type, tax_class,
                                   qty_milli, unit_price_cents, gross_cents, promo_cents, net_cents, promotion_id)
    values (v_sale, v_tenant, v_lane.shop_id, v_line_no, v_line.item_id, v_line.item_name, v_line.item_type,
            v_line.tax_class, v_line.qty_milli, v_line.unit_price_cents, v_line.gross_cents, v_line.promo_cents,
            v_line.gross_cents - v_line.promo_cents, v_line.promotion_id);
    perform app.post_movement(v_tenant, v_lane.shop_id, v_line.item_id, -v_line.qty_milli, 'sale', 'sale', v_sale);
  end loop;

  insert into public.sale_payments (sale_id, tenant_id, shop_id, method, amount_cents, reference)
  select v_sale, v_tenant, v_lane.shop_id, (x ->> 'method')::public.payment_method,
         (x ->> 'amountCents')::bigint, x ->> 'reference'
    from jsonb_array_elements(p -> 'payments') x;

  return jsonb_build_object('id', v_sale, 'invoiceNo', v_invoice, 'subtotalCents', v_subtotal,
    'promoCents', v_promo, 'roundingCents', v_rounding, 'totalCents', v_total, 'changeCents', v_change,
    'replayed', false);
end $$;

revoke all on function api.adjust_stock, api.open_shift, api.close_shift, api.create_sale from public, anon;
grant execute on function api.adjust_stock, api.open_shift, api.close_shift, api.create_sale to authenticated, service_role;
revoke all on function app.div_round from public, anon;
grant execute on function app.div_round to authenticated, service_role;
