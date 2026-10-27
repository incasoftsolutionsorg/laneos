-- SLICE-009 Promotions v2 and loyalty (blueprint CAP-013, BR-021). Same rules as packages/pricing:
--   * mix_match: "any N of these items for Rs X" across items; replaces item promotions only when it saves more
--   * threshold: "spend Rs X, get Rs Y (or Z %) off" on the bill after item promotions; best one reached
--   * members_only: counts only when a customer is on the bill
--   * loyalty: points earned per full spend unit on what the customer pays (not with points); points spent as a
--     payment ('loyalty'); returns take back earned points in proportion
-- api.create_sale v6, api.lane_catalog v5, api.save_promotion v2, api.update_tenant_settings v2.

-- Promotions --------------------------------------------------------------------------------------------------------

alter table public.promotions
  add column threshold_cents bigint check (threshold_cents > 0),
  add column discount_cents  bigint check (discount_cents > 0),
  add column members_only    boolean not null default false;
alter table public.promotions drop constraint promotions_check1;
alter table public.promotions add constraint promotions_kind_fields check (
  (kind = 'multi_buy' and buy_qty is not null and bundle_price_cents is not null and percent_bp is null and threshold_cents is null)
  or (kind = 'percent_off' and percent_bp is not null and buy_qty is null and bundle_price_cents is null and threshold_cents is null)
  or (kind = 'mix_match' and buy_qty is not null and bundle_price_cents is not null and percent_bp is null and threshold_cents is null)
  or (kind = 'threshold' and threshold_cents is not null and buy_qty is null and bundle_price_cents is null
      and ((discount_cents is not null) <> (percent_bp is not null)))
);

-- p: {id?, name, kind, itemIds[], buyQty?, bundlePriceCents?, percentBp?, thresholdCents?, discountCents?, membersOnly?, startsAt?, endsAt?, isActive?}
create or replace function api.save_promotion(p jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_id     uuid := nullif(p ->> 'id', '')::uuid;
  v_kind   public.promotion_kind := (p ->> 'kind')::public.promotion_kind;
begin
  perform app.require_perm('promotion.manage');
  if v_kind <> 'threshold' and jsonb_array_length(coalesce(p -> 'itemIds', '[]')) = 0 then
    raise exception 'VALIDATION_ERROR: choose at least one item' using errcode = 'P0001';
  end if;
  if v_kind = 'mix_match' and jsonb_array_length(coalesce(p -> 'itemIds', '[]')) < 2 then
    raise exception 'VALIDATION_ERROR: a mix-and-match deal needs at least two items' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.promotions (tenant_id, name, kind, buy_qty, bundle_price_cents, percent_bp, threshold_cents, discount_cents,
                                   members_only, starts_at, ends_at, is_active, created_by)
    values (v_tenant, p ->> 'name', v_kind, (p ->> 'buyQty')::integer, (p ->> 'bundlePriceCents')::bigint, (p ->> 'percentBp')::integer,
            (p ->> 'thresholdCents')::bigint, (p ->> 'discountCents')::bigint, coalesce((p ->> 'membersOnly')::boolean, false),
            coalesce((p ->> 'startsAt')::timestamptz, now()), (p ->> 'endsAt')::timestamptz, coalesce((p ->> 'isActive')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.promotions set name = p ->> 'name', kind = v_kind,
           buy_qty = (p ->> 'buyQty')::integer, bundle_price_cents = (p ->> 'bundlePriceCents')::bigint,
           percent_bp = (p ->> 'percentBp')::integer, threshold_cents = (p ->> 'thresholdCents')::bigint,
           discount_cents = (p ->> 'discountCents')::bigint, members_only = coalesce((p ->> 'membersOnly')::boolean, members_only),
           starts_at = coalesce((p ->> 'startsAt')::timestamptz, starts_at),
           ends_at = (p ->> 'endsAt')::timestamptz, is_active = coalesce((p ->> 'isActive')::boolean, is_active)
     where id = v_id and tenant_id = v_tenant;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  delete from public.promotion_items pi
   where pi.promotion_id = v_id
     and pi.item_id not in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p -> 'itemIds', '[]')) x);
  insert into public.promotion_items (promotion_id, item_id, tenant_id)
  select v_id, i.id, v_tenant
    from public.items i
   where i.tenant_id = v_tenant and i.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p -> 'itemIds', '[]')) x)
  on conflict do nothing;
  perform app.audit('promotion.save', 'promotions', v_id, jsonb_build_object('name', p ->> 'name', 'kind', v_kind));
  return v_id;
end $$;

-- Loyalty -----------------------------------------------------------------------------------------------------------

alter table public.tenants
  add column loyalty_enabled           boolean not null default false,
  add column loyalty_spend_cents       integer not null default 10000 check (loyalty_spend_cents between 100 and 10000000),
  add column loyalty_point_value_cents integer not null default 100 check (loyalty_point_value_cents between 1 and 100000),
  add column loyalty_min_redeem        integer not null default 100 check (loyalty_min_redeem between 1 and 100000);

alter table public.sales
  add column basket_promo_cents  bigint not null default 0 check (basket_promo_cents >= 0),
  add column basket_promotion_id uuid references public.promotions (id),
  add column points_earned       integer not null default 0 check (points_earned >= 0),
  add column points_redeemed     integer not null default 0 check (points_redeemed >= 0);

create type public.loyalty_kind as enum ('earn', 'redeem', 'reverse', 'adjust');

create table public.loyalty_ledger (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references public.tenants (id),
  customer_id uuid not null references public.customers (id),
  kind        public.loyalty_kind not null,
  sale_id     uuid references public.sales (id),
  return_id   uuid references public.returns (id),
  points      integer not null check (points <> 0),
  note        text check (char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  created_by  uuid
);
create index loyalty_ledger_customer on public.loyalty_ledger (customer_id, created_at desc);
create trigger loyalty_ledger_append_only before update or delete on public.loyalty_ledger for each row execute function app.append_only();
alter table public.loyalty_ledger enable row level security;
alter table public.loyalty_ledger force row level security;
create policy loyalty_ledger_read on public.loyalty_ledger for select to authenticated using (tenant_id = (select app.tenant_id()));
revoke all on public.loyalty_ledger from anon;
revoke insert, update, delete, truncate on public.loyalty_ledger from authenticated;

-- Existing point balances become opening rows so the ledger equals the balance.
insert into public.loyalty_ledger (tenant_id, customer_id, kind, points, note)
select c.tenant_id, c.id, 'adjust', c.loyalty_points, 'Opening balance' from public.customers c where c.loyalty_points > 0;

create or replace function app.loyalty_post(p_tenant uuid, p_customer uuid, p_kind public.loyalty_kind, p_points integer,
                                            p_sale uuid default null, p_return uuid default null, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_points = 0 then
    return;
  end if;
  insert into public.loyalty_ledger (tenant_id, customer_id, kind, sale_id, return_id, points, note, created_by)
  values (p_tenant, p_customer, p_kind, p_sale, p_return, p_points, p_note, auth.uid());
  update public.customers set loyalty_points = greatest(0, loyalty_points + p_points) where id = p_customer;
end $$;

-- Manual correction by a manager (complaint, goodwill).
create or replace function api.adjust_loyalty(p_customer uuid, p_points integer, p_reason text)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_c public.customers;
begin
  perform app.require_perm('customer.manage');
  if char_length(coalesce(trim(p_reason), '')) < 3 or p_points = 0 then
    raise exception 'VALIDATION_ERROR: points and a reason' using errcode = 'P0001';
  end if;
  select * into v_c from public.customers c where c.id = p_customer and c.tenant_id = app.tenant_id() for update;
  if v_c.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_c.loyalty_points + p_points < 0 then
    raise exception 'VALIDATION_ERROR: the customer has only % points', v_c.loyalty_points using errcode = 'P0001';
  end if;
  perform app.loyalty_post(v_c.tenant_id, v_c.id, 'adjust', p_points, null, null, trim(p_reason));
  perform app.audit('loyalty.adjust', 'customers', v_c.id, jsonb_build_object('points', p_points, 'reason', trim(p_reason)));
  return v_c.loyalty_points + p_points;
end $$;

-- A return takes back the points its bill earned, in proportion to the value returned.
create or replace function app.loyalty_on_return()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
  v_back integer;
begin
  select * into v_sale from public.sales s where s.id = new.sale_id;
  if v_sale.customer_id is null or v_sale.points_earned = 0 or v_sale.total_cents = 0 then
    return null;
  end if;
  v_back := least(v_sale.points_earned, floor(v_sale.points_earned::numeric * new.total_cents / v_sale.total_cents)::integer);
  if v_back > 0 then
    perform app.loyalty_post(new.tenant_id, v_sale.customer_id, 'reverse', -v_back, v_sale.id, new.id, new.return_no);
  end if;
  return null;
end $$;
create trigger returns_loyalty after insert on public.returns for each row execute function app.loyalty_on_return();

-- api.update_tenant_settings v2: loyalty settings join the whitelist.
create or replace function api.update_tenant_settings(p jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant  uuid := app.tenant_id();
  v_allowed text[] := array[
    'name', 'business_reg_no', 'city', 'business_type', 'rounding_unit_cents', 'embedded_barcode_mode', 'credit_note_days',
    'credit_note_any_shop', 'cash_refund_pin_cents', 'damage_approval_cents', 'supplier_payment_approval_cents',
    'customer_credit_days', 'brand_color', 'theme', 'auto_seasonal_theme', 'vat_registered', 'vat_no', 'prices_include_vat',
    'receipt_paper', 'receipt_header', 'receipt_footer', 'receipt_print_logo', 'receipt_silent', 'receipt_open_drawer',
    'receipt_local_language', 'require_2fa', 'strict_sessions', 'idle_timeout_min', 'lane_lock_min', 'failed_login_limit',
    'failed_login_lock_min', 'pin_length_min', 'pin_change_days', 'credit_note_cash_out', 'export_owner_only', 'login_alerts',
    'loyalty_enabled', 'loyalty_spend_cents', 'loyalty_point_value_cents', 'loyalty_min_redeem'];
  v_key     text;
  v_sql     text := '';
begin
  perform app.require_perm('settings.manage');
  for v_key in select jsonb_object_keys(p) loop
    if not v_key = any (v_allowed) then
      raise exception 'VALIDATION_ERROR: % cannot be changed here', v_key using errcode = 'P0001';
    end if;
    v_sql := v_sql || format('%I = (jsonb_populate_record(null::public.tenants, $1)).%I, ', v_key, v_key);
  end loop;
  if v_sql = '' then
    return;
  end if;
  execute format('update public.tenants set %s updated_at = now() where id = $2', v_sql) using p, v_tenant;
  perform app.audit('settings.update', 'tenants', v_tenant, p);
end $$;

-- api.create_sale v6: promotions v2, members-only promotions, loyalty points (earn and pay). Otherwise v5.
create or replace function api.create_sale(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant   uuid := app.tenant_id();
  v_member   uuid;
  v_client   uuid := (p ->> 'clientUuid')::uuid;
  v_lane     public.lanes;
  v_shop     public.shops;
  v_tenant_r public.tenants;
  v_shift    public.shifts;
  v_customer public.customers;
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
  v_account  bigint;
  v_change   bigint;
  v_pay      jsonb;
  v_note     public.credit_notes;
  v_amount   bigint;
  v_basket   bigint := 0;
  v_basket_p uuid;
  v_mm       record;
  v_groups   bigint;
  v_used     bigint;
  v_saving   bigint;
  v_replaced bigint;
  v_left     bigint;
  v_part     bigint;
  v_loyalty  bigint := 0;
  v_pts_used integer := 0;
  v_pts_earn integer := 0;
begin
  perform app.require_perm('sale.create');

  select * into v_existing from public.sales s where s.tenant_id = v_tenant and s.client_uuid = v_client;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'invoiceNo', v_existing.invoice_no,
      'subtotalCents', v_existing.subtotal_cents, 'promoCents', v_existing.promo_cents,
      'roundingCents', v_existing.rounding_cents, 'totalCents', v_existing.total_cents,
      'changeCents', v_existing.change_cents, 'receiptToken', v_existing.receipt_token, 'replayed', true);
  end if;

  select * into v_lane from public.lanes l where l.id = (p ->> 'laneId')::uuid and l.tenant_id = v_tenant;
  if v_lane.id is null or not app.can_shop(v_lane.shop_id) then
    raise exception 'NOT_FOUND: lane' using errcode = 'P0001';
  end if;
  if v_lane.status <> 'active' then
    raise exception 'FORBIDDEN: lane is disabled' using errcode = 'P0001';
  end if;
  if not app.lane_key_ok(v_lane, p ->> 'laneKey') then
    raise exception 'LANE_KEY_INVALID' using errcode = 'P0001';
  end if;
  v_member := app.lane_member(v_lane);
  select * into v_shop from public.shops s where s.id = v_lane.shop_id;
  select * into v_tenant_r from public.tenants t where t.id = v_tenant;
  select * into v_shift from public.shifts s where s.lane_id = v_lane.id and s.status = 'open';
  if v_shift.id is null then
    raise exception 'SHIFT_NOT_OPEN' using errcode = 'P0001';
  end if;
  if (p ->> 'customerId') is not null then
    select * into v_customer from public.customers c where c.id = (p ->> 'customerId')::uuid and c.tenant_id = v_tenant for update;
    if v_customer.id is null then
      raise exception 'NOT_FOUND: customer' using errcode = 'P0001';
    end if;
  end if;

  select pl.id into v_list from public.price_lists pl where pl.tenant_id = v_tenant and pl.is_default;

  create temp table if not exists pg_temp.sale_calc (
    item_id uuid primary key, item_name text, item_type public.item_type, tax_class public.tax_class,
    qty_milli bigint, unit_price_cents bigint, gross_cents bigint, promo_cents bigint, promotion_id uuid
  ) on commit drop;
  truncate pg_temp.sale_calc;

  insert into pg_temp.sale_calc (item_id, item_name, item_type, tax_class, qty_milli, unit_price_cents)
  select i.id, i.name, i.item_type, i.tax_class, x.qty,
         case when i.item_type = 'open_price' then x.open_price else coalesce(sp.price_cents, pli.price_cents) end
    from (select (l ->> 'itemId')::uuid as item_id,
                 sum((l ->> 'qtyMilli')::bigint) as qty,
                 max((l ->> 'openPriceCents')::bigint) as open_price
            from jsonb_array_elements(p -> 'lines') l
           group by 1) x
    join public.items i on i.id = x.item_id and i.tenant_id = v_tenant and i.is_active
    left join public.price_list_items pli on pli.price_list_id = v_list and pli.item_id = i.id
    left join public.shop_prices sp on sp.shop_id = v_lane.shop_id and sp.item_id = i.id;

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

  update pg_temp.sale_calc set gross_cents = app.div_round(unit_price_cents * qty_milli, 1000) where true;

  update pg_temp.sale_calc c set promo_cents = best.saving, promotion_id = best.promotion_id
    from (
      select distinct on (c2.item_id) c2.item_id, pr.id as promotion_id,
             least(c2.gross_cents, case
               when pr.kind = 'percent_off' then app.div_round(c2.gross_cents * pr.percent_bp, 10000)
               when c2.item_type = 'weighed' then 0
               else greatest(0, ((c2.qty_milli / 1000) / pr.buy_qty)
                                 * (pr.buy_qty * c2.unit_price_cents - pr.bundle_price_cents))
             end) as saving
        from pg_temp.sale_calc c2
        join public.promotion_items pi on pi.item_id = c2.item_id
        join public.promotions pr on pr.id = pi.promotion_id
       where pr.is_active and pr.starts_at <= now() and (pr.ends_at is null or pr.ends_at > now())
         and pr.kind in ('multi_buy', 'percent_off') and (not pr.members_only or v_customer.id is not null)
       order by c2.item_id, saving desc, pr.id
    ) best
   where c.item_id = best.item_id and best.saving > 0;

  update pg_temp.sale_calc set promo_cents = 0 where promo_cents is null;

  -- Mix and match (SLICE-009), in promotion id order, exactly as packages/pricing: whole pieces of unclaimed,
  -- non-weighed lines, most expensive first; applied only if it beats the item promotions of the lines it uses;
  -- the saving is shared by value (item id order, the last line takes the rest).
  create temp table if not exists pg_temp.sale_claimed (item_id uuid primary key) on commit drop;
  create temp table if not exists pg_temp.mm_pieces (item_id uuid, price bigint, rn bigint) on commit drop;
  truncate pg_temp.sale_claimed;
  for v_mm in select pr.id, pr.buy_qty, pr.bundle_price_cents from public.promotions pr
               where pr.tenant_id = v_tenant and pr.kind = 'mix_match' and pr.is_active and pr.starts_at <= now()
                 and (pr.ends_at is null or pr.ends_at > now()) and (not pr.members_only or v_customer.id is not null)
               order by pr.id loop
    truncate pg_temp.mm_pieces;
    insert into pg_temp.mm_pieces (item_id, price, rn)
    select c.item_id, c.unit_price_cents, row_number() over (order by c.unit_price_cents desc, c.item_id)
      from pg_temp.sale_calc c
      join public.promotion_items pi on pi.promotion_id = v_mm.id and pi.item_id = c.item_id
      cross join lateral generate_series(1, (c.qty_milli / 1000)::integer) g
     where c.item_type <> 'weighed' and c.item_id not in (select k.item_id from pg_temp.sale_claimed k);
    v_groups := (select count(*) from pg_temp.mm_pieces) / v_mm.buy_qty;
    continue when v_groups = 0;
    select coalesce(sum(m.price), 0) into v_used from pg_temp.mm_pieces m where m.rn <= v_groups * v_mm.buy_qty;
    v_saving := greatest(0, v_used - v_groups * v_mm.bundle_price_cents);
    select coalesce(sum(c.promo_cents), 0) into v_replaced from pg_temp.sale_calc c
     where c.item_id in (select m.item_id from pg_temp.mm_pieces m where m.rn <= v_groups * v_mm.buy_qty);
    continue when v_saving <= v_replaced;
    v_left := v_saving;
    for v_line in select m.item_id, sum(m.price) as share, count(*) over () as n, row_number() over (order by m.item_id) as i
                    from pg_temp.mm_pieces m where m.rn <= v_groups * v_mm.buy_qty group by m.item_id order by m.item_id loop
      v_part := case when v_line.i = v_line.n then v_left else app.div_round(v_saving * v_line.share, v_used) end;
      v_left := v_left - v_part;
      update pg_temp.sale_calc set promo_cents = least(gross_cents, v_part), promotion_id = v_mm.id where item_id = v_line.item_id;
      insert into pg_temp.sale_claimed (item_id) values (v_line.item_id);
    end loop;
  end loop;

  select coalesce(sum(gross_cents), 0), coalesce(sum(promo_cents), 0) into v_subtotal, v_promo from pg_temp.sale_calc;

  -- "Spend X" (threshold): the best one the bill reaches after item promotions.
  select pr.id, least(v_subtotal - v_promo, case when pr.percent_bp is not null then app.div_round((v_subtotal - v_promo) * pr.percent_bp, 10000)
                                                  else coalesce(pr.discount_cents, 0) end) as saving
    into v_basket_p, v_basket
    from public.promotions pr
   where pr.tenant_id = v_tenant and pr.kind = 'threshold' and pr.is_active and pr.starts_at <= now()
     and (pr.ends_at is null or pr.ends_at > now()) and (not pr.members_only or v_customer.id is not null)
     and v_subtotal - v_promo >= pr.threshold_cents
   order by saving desc, pr.id
   limit 1;
  v_basket := coalesce(v_basket, 0);
  if v_basket = 0 then
    v_basket_p := null;
  end if;
  v_before := v_subtotal - v_promo - v_basket;
  v_rounding := case when v_tenant_r.rounding_unit_cents <= 1 then 0
                     else app.div_round(v_before, v_tenant_r.rounding_unit_cents) * v_tenant_r.rounding_unit_cents - v_before end;
  v_total := v_before + v_rounding;

  if (p ->> 'expectedTotalCents')::bigint is distinct from v_total then
    raise exception 'PRICE_MISMATCH: server total %', v_total using errcode = 'P0001';
  end if;

  select coalesce(sum((x ->> 'amountCents')::bigint), 0),
         coalesce(sum((x ->> 'amountCents')::bigint) filter (where x ->> 'method' = 'cash'), 0),
         coalesce(sum((x ->> 'amountCents')::bigint) filter (where x ->> 'method' = 'account'), 0)
    into v_paid, v_cash, v_account
    from jsonb_array_elements(p -> 'payments') x;
  if v_paid < v_total then
    raise exception 'UNDERPAID' using errcode = 'P0001';
  end if;
  v_change := v_paid - v_total;
  if v_change > v_cash then
    raise exception 'VALIDATION_ERROR: change can only be given from cash' using errcode = 'P0001';
  end if;

  -- On account (BR-041): a named customer, within their credit limit.
  if v_account > 0 then
    if v_customer.id is null then
      raise exception 'CUSTOMER_REQUIRED' using errcode = 'P0001';
    end if;
    if v_customer.balance_due_cents + v_account > v_customer.credit_limit_cents then
      raise exception 'CREDIT_LIMIT: available %', greatest(0, v_customer.credit_limit_cents - v_customer.balance_due_cents) using errcode = 'P0001';
    end if;
  end if;

  -- Loyalty points as payment: whole points, at least the tenant's minimum, never more than the customer has.
  select coalesce(sum((x ->> 'amountCents')::bigint) filter (where x ->> 'method' = 'loyalty'), 0) into v_loyalty
    from jsonb_array_elements(p -> 'payments') x;
  if v_loyalty > 0 then
    if not v_tenant_r.loyalty_enabled then
      raise exception 'VALIDATION_ERROR: loyalty points are turned off' using errcode = 'P0001';
    end if;
    if v_customer.id is null then
      raise exception 'CUSTOMER_REQUIRED' using errcode = 'P0001';
    end if;
    if v_loyalty % v_tenant_r.loyalty_point_value_cents <> 0 then
      raise exception 'VALIDATION_ERROR: points are spent in whole points' using errcode = 'P0001';
    end if;
    v_pts_used := (v_loyalty / v_tenant_r.loyalty_point_value_cents)::integer;
    if v_pts_used < v_tenant_r.loyalty_min_redeem then
      raise exception 'VALIDATION_ERROR: spend at least % points', v_tenant_r.loyalty_min_redeem using errcode = 'P0001';
    end if;
    if v_pts_used > v_customer.loyalty_points then
      raise exception 'LOYALTY_POINTS_LOW: % points available', v_customer.loyalty_points using errcode = 'P0001';
    end if;
  end if;
  if v_tenant_r.loyalty_enabled and v_customer.id is not null and v_tenant_r.loyalty_spend_cents > 0 then
    v_pts_earn := greatest(0, (v_total - v_loyalty) / v_tenant_r.loyalty_spend_cents)::integer;
  end if;

  create temp table if not exists pg_temp.sale_cn (note_id uuid, note_no text, amount bigint, pos integer) on commit drop;
  truncate pg_temp.sale_cn;
  for v_pay in select x from jsonb_array_elements(p -> 'payments') x where x ->> 'method' = 'credit_note' loop
    select * into v_note from public.credit_notes n
     where n.tenant_id = v_tenant and n.code_hash = app.credit_note_hash(v_pay ->> 'reference')
     for update;
    v_amount := (v_pay ->> 'amountCents')::bigint;
    if v_note.id is null then
      raise exception 'CREDIT_NOTE_NOT_FOUND' using errcode = 'P0001';
    end if;
    if not v_tenant_r.credit_note_any_shop and v_note.shop_id <> v_lane.shop_id then
      raise exception 'CREDIT_NOTE_OTHER_SHOP' using errcode = 'P0001';
    end if;
    if v_note.status not in ('active', 'partially_used') then
      raise exception 'CREDIT_NOTE_USED' using errcode = 'P0001';
    end if;
    if v_note.expires_on < (now() at time zone 'Asia/Colombo')::date then
      raise exception 'CREDIT_NOTE_EXPIRED' using errcode = 'P0001';
    end if;
    if v_amount > v_note.balance_cents - coalesce((select sum(c.amount) from pg_temp.sale_cn c where c.note_id = v_note.id), 0) then
      raise exception 'CREDIT_NOTE_INSUFFICIENT' using errcode = 'P0001';
    end if;
    insert into pg_temp.sale_cn (note_id, note_no, amount) values (v_note.id, v_note.note_no, v_amount);
  end loop;

  if (p ->> 'invoiceNo') is not null then
    v_invoice := p ->> 'invoiceNo';
    v_seq := nullif(substring(v_invoice from '-(\d{6})$'), '')::bigint;
    if v_invoice !~ ('^' || v_shop.code || '-' || v_lane.code || '-\d{6}$')
       or v_shift.reserved_from is null or v_seq not between v_shift.reserved_from and v_shift.reserved_to then
      raise exception 'VALIDATION_ERROR: invoice number is not reserved for this shift' using errcode = 'P0001';
    end if;
    update public.lanes set last_seen_at = now() where id = v_lane.id;
  else
    update public.lanes set invoice_seq = invoice_seq + 1, last_seen_at = now()
     where id = v_lane.id returning invoice_seq into v_seq;
    v_invoice := v_shop.code || '-' || v_lane.code || '-' || lpad(v_seq::text, 6, '0');
  end if;

  insert into public.sales (tenant_id, shop_id, lane_id, shift_id, invoice_no, customer_id, member_id,
                            subtotal_cents, promo_cents, rounding_cents, total_cents, paid_cents, change_cents,
                            balance_due_cents, client_uuid, created_by, basket_promo_cents, basket_promotion_id,
                            points_earned, points_redeemed)
  values (v_tenant, v_lane.shop_id, v_lane.id, v_shift.id, v_invoice, v_customer.id, v_member,
          v_subtotal, v_promo + v_basket, v_rounding, v_total, v_paid - v_account, v_change, v_account, v_client, auth.uid(),
          v_basket, v_basket_p, v_pts_earn, v_pts_used)
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
         (x ->> 'amountCents')::bigint, left(x ->> 'reference', 64)
    from jsonb_array_elements(p -> 'payments') x
   where x ->> 'method' <> 'credit_note';
  insert into public.sale_payments (sale_id, tenant_id, shop_id, method, amount_cents, reference)
  select v_sale, v_tenant, v_lane.shop_id, 'credit_note', c.amount, c.note_no from pg_temp.sale_cn c;

  insert into public.credit_note_redemptions (tenant_id, credit_note_id, sale_id, shop_id, lane_id, amount_cents, redeemed_by)
  select v_tenant, c.note_id, v_sale, v_lane.shop_id, v_lane.id, c.amount, v_member from pg_temp.sale_cn c;
  update public.credit_notes n
     set balance_cents = n.balance_cents - u.used,
         status = case when n.balance_cents - u.used = 0 then 'used'::public.credit_note_status else 'partially_used' end
    from (select c.note_id, sum(c.amount) as used from pg_temp.sale_cn c group by c.note_id) u
   where n.id = u.note_id;

  if v_account > 0 then
    perform app.customer_post(v_tenant, v_customer.id, 'sale', v_sale, v_account, v_invoice);
  end if;
  if v_pts_used > 0 then
    perform app.loyalty_post(v_tenant, v_customer.id, 'redeem', -v_pts_used, v_sale, null, v_invoice);
  end if;
  if v_pts_earn > 0 then
    perform app.loyalty_post(v_tenant, v_customer.id, 'earn', v_pts_earn, v_sale, null, v_invoice);
  end if;

  return jsonb_build_object('id', v_sale, 'invoiceNo', v_invoice, 'subtotalCents', v_subtotal,
    'promoCents', v_promo + v_basket, 'basketPromoCents', v_basket, 'roundingCents', v_rounding, 'totalCents', v_total,
    'changeCents', v_change, 'pointsEarned', v_pts_earn, 'pointsRedeemed', v_pts_used,
    'receiptToken', (select s.receipt_token from public.sales s where s.id = v_sale), 'replayed', false);
end $$;

-- api.lane_catalog v5: promotion fields for v2 kinds and the tenant's loyalty settings.
create or replace function api.lane_catalog(p_lane uuid)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_lane   record;
  v_tenant public.tenants;
  v_shift  public.shifts;
begin
  select l.id, l.tenant_id, l.shop_id, l.code, l.name, l.status, l.registered_at, l.active_member_id
    into v_lane from public.lanes l where l.id = p_lane;
  if v_lane.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_tenant from public.tenants t where t.id = v_lane.tenant_id;
  select * into v_shift from public.shifts s where s.lane_id = v_lane.id and s.status = 'open';

  return jsonb_build_object(
    'lane', jsonb_build_object('id', v_lane.id, 'code', v_lane.code, 'name', v_lane.name, 'status', v_lane.status,
                               'registered', v_lane.registered_at is not null),
    'activeMember', (select jsonb_build_object('id', m.id, 'name', m.display_name)
                       from public.members m where m.id = v_lane.active_member_id),
    'shop', (select jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name) from public.shops s where s.id = v_lane.shop_id),
    'tenant', jsonb_build_object('name', v_tenant.name, 'roundingUnitCents', v_tenant.rounding_unit_cents,
                                 'embeddedBarcodeMode', v_tenant.embedded_barcode_mode,
                                 'catalogVersion', v_tenant.catalog_version,
                                 'loyalty', jsonb_build_object('enabled', v_tenant.loyalty_enabled, 'spendCents', v_tenant.loyalty_spend_cents,
                                                               'pointValueCents', v_tenant.loyalty_point_value_cents, 'minRedeem', v_tenant.loyalty_min_redeem)),
    'shift', case when v_shift.id is null then null else jsonb_build_object(
               'id', v_shift.id, 'shiftNo', v_shift.shift_no, 'openedAt', v_shift.opened_at,
               'cashier', (select m.display_name from public.members m where m.id = v_shift.opened_by),
               'reservedFrom', v_shift.reserved_from, 'reservedTo', v_shift.reserved_to,
               'nextReserved', case when v_shift.reserved_from is null then null else greatest(v_shift.reserved_from,
                  coalesce((select max(right(s.invoice_no, 6)::bigint) + 1 from public.sales s
                             where s.shift_id = v_shift.id
                               and right(s.invoice_no, 6)::bigint between v_shift.reserved_from and v_shift.reserved_to), 0)) end)
             end,
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.sort_order, d.name), '[]')
                      from public.departments d where d.tenant_id = v_lane.tenant_id and d.is_active),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id, 'name', i.name, 'itemType', i.item_type, 'plu', i.plu, 'departmentId', i.department_id,
                'priceCents', coalesce(sp.price_cents, pli.price_cents), 'mrpCents', i.mrp_cents, 'isPinned', i.is_pinned, 'taxClass', i.tax_class,
                'isReturnable', i.is_returnable, 'stockMilli', coalesce(sl.qty_milli, 0),
                'barcodes', (select coalesce(jsonb_agg(b.code), '[]') from public.barcodes b where b.item_id = i.id and b.pack_qty = 1),
                'packBarcodes', (select coalesce(jsonb_agg(jsonb_build_object('code', b.code, 'qty', b.pack_qty)), '[]')
                                   from public.barcodes b where b.item_id = i.id and b.pack_qty > 1))
                order by i.name), '[]')
                from public.items i
                join public.price_lists pl on pl.tenant_id = i.tenant_id and pl.is_default
                left join public.price_list_items pli on pli.price_list_id = pl.id and pli.item_id = i.id
                left join public.shop_prices sp on sp.shop_id = v_lane.shop_id and sp.item_id = i.id
                left join public.stock_levels sl on sl.item_id = i.id and sl.shop_id = v_lane.shop_id
               where i.tenant_id = v_lane.tenant_id and i.is_active),
    'promotions', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', pr.id, 'name', pr.name, 'kind', pr.kind, 'buyQty', pr.buy_qty,
                     'bundlePriceCents', pr.bundle_price_cents, 'percentBp', pr.percent_bp, 'endsAt', pr.ends_at,
                     'thresholdCents', pr.threshold_cents, 'discountCents', pr.discount_cents, 'membersOnly', pr.members_only,
                     'itemIds', (select coalesce(jsonb_agg(pi.item_id), '[]') from public.promotion_items pi where pi.promotion_id = pr.id))), '[]')
                     from public.promotions pr
                    where pr.tenant_id = v_lane.tenant_id and pr.is_active and pr.starts_at <= now()
                      and (pr.ends_at is null or pr.ends_at > now()))
  );
end $$;

-- Grants --------------------------------------------------------------------------------------------------------

revoke all on function api.save_promotion(jsonb), api.adjust_loyalty(uuid, integer, text) from public, anon;
grant execute on function api.save_promotion(jsonb), api.adjust_loyalty(uuid, integer, text) to authenticated, service_role;
revoke all on function app.loyalty_post(uuid, uuid, public.loyalty_kind, integer, uuid, uuid, text), app.loyalty_on_return()
  from public, anon, authenticated;
