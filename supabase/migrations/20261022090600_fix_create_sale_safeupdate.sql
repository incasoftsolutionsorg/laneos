-- Fix: Supabase loads pg-safeupdate for API requests, which rejects DELETE/UPDATE without a WHERE
-- clause — even on the temp table inside api.create_sale, so every sale failed. Same function,
-- with TRUNCATE and an explicit WHERE. Found by scripts/db-tests (pnpm test:db).

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
  truncate pg_temp.sale_calc;

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

  update pg_temp.sale_calc set gross_cents = app.div_round(unit_price_cents * qty_milli, 1000) where true;

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

revoke all on function api.create_sale(jsonb) from public, anon;
grant execute on function api.create_sale(jsonb) to authenticated, service_role;
