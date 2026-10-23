-- Fix: api.lane_catalog runs as the caller and read lanes.*, which includes key_hash; after
-- 20261023090100 hid that column the whole query was refused. Same function, named columns only.
-- Found by scripts/db-tests (pnpm test:db).

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
  -- Named columns: key_hash is not readable by authenticated (20261023090100). RLS hides other tenants' lanes.
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
                                 'catalogVersion', v_tenant.catalog_version),
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
                'priceCents', pli.price_cents, 'mrpCents', i.mrp_cents, 'isPinned', i.is_pinned, 'taxClass', i.tax_class,
                'isReturnable', i.is_returnable, 'stockMilli', coalesce(sl.qty_milli, 0),
                'barcodes', (select coalesce(jsonb_agg(b.code), '[]') from public.barcodes b where b.item_id = i.id))
                order by i.name), '[]')
                from public.items i
                join public.price_lists pl on pl.tenant_id = i.tenant_id and pl.is_default
                left join public.price_list_items pli on pli.price_list_id = pl.id and pli.item_id = i.id
                left join public.stock_levels sl on sl.item_id = i.id and sl.shop_id = v_lane.shop_id
               where i.tenant_id = v_lane.tenant_id and i.is_active),
    'promotions', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', pr.id, 'name', pr.name, 'kind', pr.kind, 'buyQty', pr.buy_qty,
                     'bundlePriceCents', pr.bundle_price_cents, 'percentBp', pr.percent_bp, 'endsAt', pr.ends_at,
                     'itemIds', (select coalesce(jsonb_agg(pi.item_id), '[]') from public.promotion_items pi where pi.promotion_id = pr.id))), '[]')
                     from public.promotions pr
                    where pr.tenant_id = v_lane.tenant_id and pr.is_active and pr.starts_at <= now()
                      and (pr.ends_at is null or pr.ends_at > now()))
  );
end $$;

revoke all on function api.lane_catalog(uuid) from public, anon;
grant execute on function api.lane_catalog(uuid) to authenticated, service_role;
