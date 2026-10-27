-- Advanced reports (blueprint SLICE-012): api.report v2 adds `shrinkage` (stock-count variances at cost),
-- `expiry` (expired stock written off or reported damaged) and `promotions` (promotion effect: bills, units, sales,
-- discount and margin per promotion, including spend-X deals). Other kinds unchanged.

create or replace function api.report(p_shop uuid, p_kind text, p_from date, p_to date)
returns jsonb
language plpgsql security definer   -- volatile: it fills a temp table
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_shops  uuid[];
  v_start  timestamptz := (p_from::timestamp at time zone 'Asia/Colombo');
  v_end    timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Colombo');
  v_t      public.tenants;
  v_out    jsonb;
begin
  perform app.require_perm('reports.view');
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'VALIDATION_ERROR: choose a range of up to 400 days' using errcode = 'P0001';
  end if;
  if p_shop is null then
    v_shops := app.shop_ids();
  elsif app.can_shop(p_shop) then
    v_shops := array[p_shop];
  else
    raise exception 'NOT_FOUND: shop' using errcode = 'P0001';
  end if;
  select * into v_t from public.tenants where id = v_tenant;

  create temp table if not exists pg_temp.rep_lines on commit drop as
    select sl.item_id, sl.item_name, sl.tax_class, sl.qty_milli, sl.net_cents, sl.promo_cents, sl.unit_cost_cents, s.created_at, s.id as sale_id
      from public.sale_lines sl join public.sales s on s.id = sl.sale_id where false;
  truncate pg_temp.rep_lines;
  insert into pg_temp.rep_lines
  select sl.item_id, sl.item_name, sl.tax_class, sl.qty_milli, sl.net_cents, sl.promo_cents, sl.unit_cost_cents, s.created_at, s.id
    from public.sale_lines sl join public.sales s on s.id = sl.sale_id
   where s.tenant_id = v_tenant and s.shop_id = any (v_shops) and s.created_at >= v_start and s.created_at < v_end;

  if p_kind = 'sales' then
    with d as (
      select (s.created_at at time zone 'Asia/Colombo')::date as day, sum(s.total_cents) as net, count(*) as bills
        from public.sales s
       where s.tenant_id = v_tenant and s.shop_id = any (v_shops) and s.created_at >= v_start and s.created_at < v_end
       group by 1
    ), w as (
      select coalesce(sum(-m.qty_milli * coalesce(nullif(l.avg_cost_cents, 0), i.cost_cents, 0) / 1000), 0) as wastage, m.item_id
        from public.stock_movements m join public.items i on i.id = m.item_id
        left join public.stock_levels l on l.item_id = m.item_id and l.shop_id = m.shop_id
       where m.tenant_id = v_tenant and m.shop_id = any (v_shops) and m.reason in ('wastage', 'damage') and m.qty_milli < 0
         and m.created_at >= v_start and m.created_at < v_end
       group by m.item_id
    ), cat as (
      select coalesce(dp.name, 'No department') as name, sum(r.net_cents) as sales,
             sum(r.net_cents - app.div_round(r.unit_cost_cents * r.qty_milli, 1000)) as margin
        from pg_temp.rep_lines r join public.items i on i.id = r.item_id left join public.departments dp on dp.id = i.department_id
       group by 1
    ), catw as (
      select coalesce(dp.name, 'No department') as name, sum(w.wastage) as wastage
        from w join public.items i on i.id = w.item_id left join public.departments dp on dp.id = i.department_id group by 1
    )
    select jsonb_build_object(
      'days', coalesce((select jsonb_agg(jsonb_build_object('day', g::date, 'net', coalesce(d.net, 0), 'bills', coalesce(d.bills, 0)) order by g)
                          from generate_series(p_from, p_to, interval '1 day') g left join d on d.day = g::date), '[]'),
      'totals', jsonb_build_object(
        'net', coalesce((select sum(net) from d), 0),
        'bills', coalesce((select sum(bills) from d), 0),
        'returns', coalesce((select sum(r.total_cents) from public.returns r where r.tenant_id = v_tenant and r.shop_id = any (v_shops)
                              and r.created_at >= v_start and r.created_at < v_end), 0),
        'promo', coalesce((select sum(promo_cents) from pg_temp.rep_lines), 0),
        'lineSales', coalesce((select sum(net_cents) from pg_temp.rep_lines), 0),
        'margin', coalesce((select sum(net_cents - app.div_round(unit_cost_cents * qty_milli, 1000)) from pg_temp.rep_lines), 0),
        'wastage', coalesce((select sum(wastage) from w), 0),
        'wholesale', coalesce((select sum(x.total_cents) from public.wholesale_docs x where x.tenant_id = v_tenant and x.shop_id = any (v_shops)
                                and x.kind = 'invoice' and x.status = 'issued' and x.created_at >= v_start and x.created_at < v_end), 0)),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('name', c.name, 'sales', c.sales, 'margin', c.margin, 'wastage', coalesce(cw.wastage, 0))
                                         order by c.sales desc)
                          from cat c left join catw cw on cw.name = c.name), '[]'))
      into v_out;

  elsif p_kind in ('margin', 'items') then
    select coalesce(jsonb_agg(x order by (x ->> 'sales')::bigint desc), '[]') into v_out from (
      select jsonb_build_object('itemId', r.item_id, 'name', max(r.item_name), 'qtyMilli', sum(r.qty_milli), 'sales', sum(r.net_cents),
                                'cost', sum(app.div_round(r.unit_cost_cents * r.qty_milli, 1000)), 'bills', count(distinct r.sale_id),
                                'promo', sum(r.promo_cents), 'lastSold', max(r.created_at)) as x
        from pg_temp.rep_lines r group by r.item_id order by sum(r.net_cents) desc limit 300) t;

  elsif p_kind = 'stock' then
    select coalesce(jsonb_agg(x order by (x ->> 'value')::bigint desc), '[]') into v_out from (
      select jsonb_build_object('name', coalesce(dp.name, 'No department'), 'items', count(distinct i.id),
                                'value', sum(greatest(l.qty_milli, 0) * coalesce(nullif(l.avg_cost_cents, 0), i.cost_cents, 0) / 1000),
                                'damagedValue', sum(l.damaged_milli * coalesce(nullif(l.avg_cost_cents, 0), i.cost_cents, 0) / 1000),
                                'low', count(*) filter (where i.reorder_level_milli > 0 and l.qty_milli <= i.reorder_level_milli),
                                'negative', count(*) filter (where l.qty_milli < 0)) as x
        from public.stock_levels l join public.items i on i.id = l.item_id and i.is_active
        left join public.departments dp on dp.id = i.department_id
       where l.tenant_id = v_tenant and l.shop_id = any (v_shops)
       group by dp.name) t;

  elsif p_kind = 'damage' then
    select jsonb_build_object(
      'byReason', coalesce((select jsonb_agg(jsonb_build_object('reason', r.reason, 'reports', r.n, 'qtyMilli', r.q, 'value', r.v) order by r.v desc)
                              from (select d.reason, count(*) n, sum(d.qty_milli) q, sum(app.div_round(d.qty_milli * d.unit_cost_cents, 1000)) v
                                      from public.damage_reports d
                                     where d.tenant_id = v_tenant and d.shop_id = any (v_shops) and d.created_at >= v_start and d.created_at < v_end
                                     group by d.reason) r), '[]'),
      'wastage', coalesce((select sum(-m.qty_milli * coalesce(nullif(l.avg_cost_cents, 0), i.cost_cents, 0) / 1000)
                             from public.stock_movements m join public.items i on i.id = m.item_id
                             left join public.stock_levels l on l.item_id = m.item_id and l.shop_id = m.shop_id
                            where m.tenant_id = v_tenant and m.shop_id = any (v_shops) and m.reason = 'wastage' and m.qty_milli < 0
                              and m.created_at >= v_start and m.created_at < v_end), 0),
      'pending', (select count(*) from public.damage_reports d where d.tenant_id = v_tenant and d.shop_id = any (v_shops)
                   and d.status in ('reported', 'awaiting_approval', 'awaiting_decision')))
      into v_out;

  elsif p_kind = 'credit_notes' then
    select jsonb_build_object(
      'issued', coalesce(sum(n.amount_cents) filter (where n.created_at >= v_start and n.created_at < v_end), 0),
      'issuedCount', count(*) filter (where n.created_at >= v_start and n.created_at < v_end),
      'redeemed', coalesce((select sum(r.amount_cents) from public.credit_note_redemptions r where r.tenant_id = v_tenant
                             and r.shop_id = any (v_shops) and r.created_at >= v_start and r.created_at < v_end), 0),
      'outstanding', coalesce(sum(n.balance_cents) filter (where n.status in ('active', 'partially_used')
                                                            and n.expires_on >= (now() at time zone 'Asia/Colombo')::date), 0),
      'expired', coalesce(sum(n.balance_cents) filter (where n.status in ('active', 'partially_used', 'expired')
                                                        and n.expires_on < (now() at time zone 'Asia/Colombo')::date), 0))
      into v_out
      from public.credit_notes n where n.tenant_id = v_tenant and n.shop_id = any (v_shops);

  elsif p_kind = 'tax' then
    select jsonb_build_object(
      'registered', v_t.vat_registered, 'vatNo', v_t.vat_no, 'included', v_t.prices_include_vat,
      'rows', coalesce(jsonb_agg(jsonb_build_object('taxClass', t.tax_class, 'rateBp', t.rate, 'sales', t.sales,
                                 'vat', case when not v_t.vat_registered then 0
                                             when v_t.prices_include_vat then app.div_round(t.sales * t.rate, 10000 + t.rate)
                                             else app.div_round(t.sales * t.rate, 10000) end) order by t.tax_class), '[]'))
      into v_out
      from (select r.tax_class, app.tax_rate_bp(v_tenant, r.tax_class, p_to) as rate, sum(r.net_cents) as sales
              from pg_temp.rep_lines r group by r.tax_class) t;
  elsif p_kind = 'shrinkage' then
    -- Stock-count variances (blueprint SLICE-012 "shrinkage"): what counts found missing or extra, at cost.
    select jsonb_build_object(
      'loss', coalesce(sum(-v.value) filter (where v.value < 0), 0),
      'gain', coalesce(sum(v.value) filter (where v.value > 0), 0),
      'rows', coalesce(jsonb_agg(jsonb_build_object('itemId', v.item_id, 'name', v.name, 'department', v.dept, 'qtyMilli', v.qty, 'value', v.value)
                                 order by v.value), '[]'))
      into v_out
      from (select m.item_id, max(i.name) as name, max(coalesce(dp.name, 'No department')) as dept, sum(m.qty_milli) as qty,
                   sum(m.qty_milli * coalesce(nullif(l.avg_cost_cents, 0), i.cost_cents, 0) / 1000) as value
              from public.stock_movements m
              join public.items i on i.id = m.item_id
              left join public.departments dp on dp.id = i.department_id
              left join public.stock_levels l on l.item_id = m.item_id and l.shop_id = m.shop_id
             where m.tenant_id = v_tenant and m.shop_id = any (v_shops) and m.reason = 'count'
               and m.created_at >= v_start and m.created_at < v_end
             group by m.item_id) v;

  elsif p_kind = 'expiry' then
    -- Expired stock thrown away (expiry screen write-offs) or reported as damaged with reason "expired".
    select jsonb_build_object(
      'value', coalesce(sum(x.value), 0),
      'rows', coalesce(jsonb_agg(jsonb_build_object('itemId', x.item_id, 'name', x.name, 'qtyMilli', x.qty, 'value', x.value, 'source', x.source)
                                 order by x.value desc), '[]'))
      into v_out
      from (select m.item_id, max(i.name) as name, sum(-m.qty_milli) as qty, 'Written off' as source,
                   sum(-m.qty_milli * coalesce(nullif(l.avg_cost_cents, 0), i.cost_cents, 0) / 1000) as value
              from public.stock_movements m join public.items i on i.id = m.item_id
              left join public.stock_levels l on l.item_id = m.item_id and l.shop_id = m.shop_id
             where m.tenant_id = v_tenant and m.shop_id = any (v_shops) and m.reason = 'wastage' and m.qty_milli < 0
               and m.note ilike 'expired%' and m.created_at >= v_start and m.created_at < v_end
             group by m.item_id
            union all
            select d.item_id, max(i.name), sum(d.qty_milli), 'Damage report',
                   sum(app.div_round(d.qty_milli * d.unit_cost_cents, 1000))
              from public.damage_reports d join public.items i on i.id = d.item_id
             where d.tenant_id = v_tenant and d.shop_id = any (v_shops) and d.reason = 'expired'
               and d.created_at >= v_start and d.created_at < v_end
             group by d.item_id) x;

  elsif p_kind = 'promotions' then
    -- Promotion effect: bills, units, sales and discount per promotion, and the margin left on promoted lines.
    select coalesce(jsonb_agg(x order by (x ->> 'discount')::bigint desc), '[]') into v_out from (
      select jsonb_build_object('id', pr.id, 'name', pr.name, 'kind', pr.kind,
               'bills', count(distinct r.sale_id), 'qtyMilli', sum(r.qty_milli), 'sales', sum(r.net_cents), 'discount', sum(r.promo_cents),
               'margin', sum(r.net_cents - app.div_round(r.unit_cost_cents * r.qty_milli, 1000))) as x
        from pg_temp.rep_lines r
        join public.sale_lines sl on sl.sale_id = r.sale_id and sl.item_id = r.item_id and sl.promotion_id is not null
        join public.promotions pr on pr.id = sl.promotion_id
       group by pr.id, pr.name, pr.kind
      union all
      select jsonb_build_object('id', pr.id, 'name', pr.name, 'kind', pr.kind, 'bills', count(*), 'qtyMilli', null,
               'sales', sum(s.total_cents), 'discount', sum(s.basket_promo_cents), 'margin', null)
        from public.sales s join public.promotions pr on pr.id = s.basket_promotion_id
       where s.tenant_id = v_tenant and s.shop_id = any (v_shops) and s.created_at >= v_start and s.created_at < v_end
       group by pr.id, pr.name, pr.kind) t;

  else
    raise exception 'VALIDATION_ERROR: unknown report' using errcode = 'P0001';
  end if;
  return v_out;
end $$;
