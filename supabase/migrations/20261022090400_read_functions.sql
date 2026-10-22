-- Read functions for the back office and the lane. SECURITY INVOKER: RLS applies to every row
-- they read, so they can never show another tenant's or another shop's data.

-- Dashboard (Figma 1-256) for one shop, "today" in the tenant's time zone.
create or replace function api.dashboard(p_shop uuid)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_tz        text := coalesce((select t.timezone from public.tenants t where t.id = app.tenant_id()), 'Asia/Colombo');
  v_day_start timestamptz := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  v_lw_start  timestamptz := v_day_start - interval '7 days';
  v_result    jsonb;
begin
  if not app.can_shop(p_shop) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  with today as (
    select s.* from public.sales s where s.shop_id = p_shop and s.created_at >= v_day_start
  ), last_week as (
    select s.* from public.sales s
     where s.shop_id = p_shop and s.created_at >= v_lw_start and s.created_at < now() - interval '7 days'
  ), lines as (
    select l.item_id, l.item_name, l.item_type, sum(l.qty_milli) as qty_milli, sum(l.net_cents) as net_cents,
           sum(app.div_round(coalesce(i.cost_cents, 0) * l.qty_milli, 1000)) as cost_cents,
           bool_and(i.cost_cents is not null) as has_cost
      from public.sale_lines l
      join today t on t.id = l.sale_id
      join public.items i on i.id = l.item_id
     group by 1, 2, 3
  )
  select jsonb_build_object(
    'salesCents', (select coalesce(sum(total_cents), 0) from today),
    'bills', (select count(*) from today),
    'lastWeekSalesCents', (select coalesce(sum(total_cents), 0) from last_week),
    'lastWeekBills', (select count(*) from last_week),
    'marginBp', (select case when sum(net_cents) filter (where has_cost) > 0
                        then app.div_round((sum(net_cents - cost_cents) filter (where has_cost)) * 10000,
                                           sum(net_cents) filter (where has_cost)) end from lines),
    'byHour', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'cents', c) order by h), '[]')
                 from (select extract(hour from created_at at time zone v_tz)::int as h, sum(total_cents) as c
                         from today group by 1) x),
    'topItems', (select coalesce(jsonb_agg(x order by x."netCents" desc), '[]') from (
                   select item_name as name, item_type as "itemType", qty_milli as "qtyMilli", net_cents as "netCents",
                          case when has_cost and net_cents > 0
                               then app.div_round((net_cents - cost_cents) * 10000, net_cents) end as "marginBp"
                     from lines order by net_cents desc limit 5) x),
    'lowStock', (select count(*) from public.stock_levels sl join public.items i on i.id = sl.item_id
                  where sl.shop_id = p_shop and i.is_active and i.reorder_level_milli > 0
                    and sl.qty_milli > 0 and sl.qty_milli <= i.reorder_level_milli),
    'outOfStock', (select count(*) from public.stock_levels sl join public.items i on i.id = sl.item_id
                    where sl.shop_id = p_shop and i.is_active and sl.qty_milli <= 0),
    'damagedUnits', (select coalesce(sum(sl.damaged_milli), 0) from public.stock_levels sl where sl.shop_id = p_shop),
    'attention', (select coalesce(jsonb_agg(x), '[]') from (
                   select i.name, i.item_type as "itemType", sl.qty_milli as "qtyMilli"
                     from public.stock_levels sl join public.items i on i.id = sl.item_id
                    where sl.shop_id = p_shop and i.is_active and i.reorder_level_milli > 0
                      and sl.qty_milli <= i.reorder_level_milli
                    order by sl.qty_milli limit 4) x),
    'lanes', (select coalesce(jsonb_agg(x order by x.code), '[]') from (
               select l.id, l.code, l.name, l.status,
                      (select m.display_name from public.shifts sh join public.members m on m.id = sh.opened_by
                        where sh.lane_id = l.id and sh.status = 'open') as cashier,
                      (select coalesce(sum(t.total_cents), 0) from today t where t.lane_id = l.id) as "salesCents"
                 from public.lanes l where l.shop_id = p_shop) x)
  ) into v_result;

  return v_result;
end $$;

-- Inventory table (Figma 1-1429). Offset paging is fine for the back office; lanes use deltas.
create or replace function api.list_items(
  p_shop uuid,
  p_search text default null,
  p_filter text default 'all',     -- all | low | out | damaged | weighed
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with base as (
    select i.id, i.name, i.item_type, i.plu, i.mrp_cents, i.reorder_level_milli, i.is_pinned, i.is_active,
           d.name as department,
           (select b.code from public.barcodes b where b.item_id = i.id order by b.created_at limit 1) as barcode,
           pli.price_cents,
           coalesce(sl.qty_milli, 0) as qty_milli,
           coalesce(sl.damaged_milli, 0) as damaged_milli
      from public.items i
      left join public.departments d on d.id = i.department_id
      left join public.price_lists pl on pl.tenant_id = i.tenant_id and pl.is_default
      left join public.price_list_items pli on pli.price_list_id = pl.id and pli.item_id = i.id
      left join public.stock_levels sl on sl.item_id = i.id and sl.shop_id = p_shop
     where i.is_active
       and (p_search is null or p_search = ''
            or i.name ilike '%' || p_search || '%'
            or exists (select 1 from public.barcodes b where b.item_id = i.id and b.code = upper(p_search))
            or i.plu::text = p_search)
  ), filtered as (
    select * from base
     where case p_filter
             when 'low' then reorder_level_milli > 0 and qty_milli > 0 and qty_milli <= reorder_level_milli
             when 'out' then qty_milli <= 0 and item_type <> 'open_price'
             when 'damaged' then damaged_milli > 0
             when 'weighed' then item_type = 'weighed'
             else true
           end
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
              'id', id, 'name', name, 'itemType', item_type, 'plu', plu, 'barcode', barcode,
              'department', department, 'priceCents', price_cents, 'mrpCents', mrp_cents,
              'qtyMilli', qty_milli, 'damagedMilli', damaged_milli, 'reorderLevelMilli', reorder_level_milli,
              'isPinned', is_pinned) order by name)
            from (select * from filtered order by name limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) page),
            '[]')
  );
$$;

-- Everything a lane needs to sell offline-first: items, prices, barcodes, stock and promotions.
create or replace function api.lane_catalog(p_lane uuid)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_lane   public.lanes;
  v_tenant public.tenants;
begin
  select * into v_lane from public.lanes l where l.id = p_lane;  -- RLS hides other tenants' lanes
  if v_lane.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_tenant from public.tenants t where t.id = v_lane.tenant_id;

  return jsonb_build_object(
    'lane', jsonb_build_object('id', v_lane.id, 'code', v_lane.code, 'name', v_lane.name, 'status', v_lane.status),
    'shop', (select jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name) from public.shops s where s.id = v_lane.shop_id),
    'tenant', jsonb_build_object('name', v_tenant.name, 'roundingUnitCents', v_tenant.rounding_unit_cents,
                                 'embeddedBarcodeMode', v_tenant.embedded_barcode_mode,
                                 'catalogVersion', v_tenant.catalog_version),
    'shift', (select jsonb_build_object('id', sh.id, 'shiftNo', sh.shift_no, 'openedAt', sh.opened_at,
                                        'cashier', m.display_name)
                from public.shifts sh join public.members m on m.id = sh.opened_by
               where sh.lane_id = v_lane.id and sh.status = 'open'),
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.sort_order, d.name), '[]')
                      from public.departments d where d.tenant_id = v_lane.tenant_id and d.is_active),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id, 'name', i.name, 'itemType', i.item_type, 'plu', i.plu, 'departmentId', i.department_id,
                'priceCents', pli.price_cents, 'mrpCents', i.mrp_cents, 'isPinned', i.is_pinned,
                'stockMilli', coalesce(sl.qty_milli, 0),
                'barcodes', (select coalesce(jsonb_agg(b.code), '[]') from public.barcodes b where b.item_id = i.id))
                order by i.name), '[]')
                from public.items i
                join public.price_lists pl on pl.tenant_id = i.tenant_id and pl.is_default
                left join public.price_list_items pli on pli.price_list_id = pl.id and pli.item_id = i.id
                left join public.stock_levels sl on sl.item_id = i.id and sl.shop_id = v_lane.shop_id
               where i.tenant_id = v_lane.tenant_id and i.is_active),
    'promotions', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', pr.id, 'name', pr.name, 'kind', pr.kind, 'buyQty', pr.buy_qty,
                     'bundlePriceCents', pr.bundle_price_cents, 'percentBp', pr.percent_bp,
                     'itemIds', (select coalesce(jsonb_agg(pi.item_id), '[]') from public.promotion_items pi where pi.promotion_id = pr.id))), '[]')
                     from public.promotions pr
                    where pr.tenant_id = v_lane.tenant_id and pr.is_active and pr.starts_at <= now()
                      and (pr.ends_at is null or pr.ends_at > now()))
  );
end $$;

revoke all on function api.dashboard, api.list_items, api.lane_catalog from public, anon;
grant execute on function api.dashboard, api.list_items, api.lane_catalog to authenticated, service_role;
