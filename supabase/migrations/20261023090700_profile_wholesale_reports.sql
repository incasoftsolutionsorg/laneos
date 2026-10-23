-- Profile, wholesale billing and reports (Figma 1-3518, 1-1162, 1-4536):
--   api.update_profile; customer balances only change through the ledger; cost snapshot on sale lines
--   (for margin); wholesale quotations and invoices; one report function for the report tabs.

-- My profile ---------------------------------------------------------------------------------------------

create or replace function api.update_profile(p_name text, p_phone text, p_language text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.member_id() is null then
    raise exception 'NO_TENANT' using errcode = 'P0001';
  end if;
  update public.members
     set display_name = trim(p_name), phone = nullif(p_phone, ''), language = coalesce(nullif(p_language, ''), 'en'), updated_at = now()
   where id = app.member_id();
  perform app.audit('profile.update', 'members', app.member_id());
end $$;

-- Customer balances move only through api.receive_customer_payment / sales / returns (ledger).
revoke update on public.customers from authenticated;
grant update (name, phone, email, credit_limit_cents, marketing_consent, is_active, updated_at) on public.customers to authenticated;

-- Cost snapshot for margin reports --------------------------------------------------------------------------

alter table public.sale_lines add column unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0);

create or replace function app.sale_line_cost()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  select coalesce(nullif(l.avg_cost_cents, 0), i.cost_cents, 0) into new.unit_cost_cents
    from public.items i
    left join public.stock_levels l on l.item_id = i.id and l.shop_id = new.shop_id
   where i.id = new.item_id;
  new.unit_cost_cents := coalesce(new.unit_cost_cents, 0);
  return new;
end $$;
create trigger sale_lines_cost before insert on public.sale_lines for each row execute function app.sale_line_cost();

-- Backfill from today's costs (the best we know for older bills). sale_lines is append-only, so lift the guard.
alter table public.sale_lines disable trigger user;
update public.sale_lines sl set unit_cost_cents = coalesce(nullif(l.avg_cost_cents, 0), i.cost_cents, 0)
  from public.items i left join public.stock_levels l on l.item_id = i.id
 where i.id = sl.item_id and (l.shop_id is null or l.shop_id = sl.shop_id);
alter table public.sale_lines enable trigger user;

-- Wholesale quotations and invoices (Figma 1-1162) ----------------------------------------------------------

create type public.wholesale_kind as enum ('quotation', 'invoice');
create type public.wholesale_status as enum ('open', 'converted', 'issued', 'void');
create type public.wholesale_terms as enum ('cash', 'credit', 'cheque');

create table public.wholesale_docs (
  id                uuid primary key default app.uuid_v7(),
  tenant_id         uuid not null references public.tenants (id),
  shop_id           uuid not null references public.shops (id),
  kind              public.wholesale_kind not null,
  doc_no            text not null,
  status            public.wholesale_status not null,
  customer_id       uuid references public.customers (id),
  buyer_name        text not null check (char_length(buyer_name) between 1 and 120),
  buyer_address     text check (char_length(buyer_address) <= 300),
  buyer_vat_no      text check (char_length(buyer_vat_no) <= 30),
  buyer_phone       text check (char_length(buyer_phone) <= 20),
  terms             public.wholesale_terms not null default 'cash',
  credit_days       integer not null default 0 check (credit_days between 0 and 180),
  cheque_no         text check (char_length(cheque_no) <= 30),
  subtotal_cents    bigint not null check (subtotal_cents >= 0),
  discount_cents    bigint not null default 0 check (discount_cents >= 0),
  vat_cents         bigint not null default 0 check (vat_cents >= 0),
  vat_included      boolean not null default true,
  total_cents       bigint not null check (total_cents >= 0),
  paid_cents        bigint not null default 0 check (paid_cents >= 0),
  valid_until       date,
  due_on            date,
  from_quotation_id uuid references public.wholesale_docs (id),
  note              text check (char_length(note) <= 300),
  created_at        timestamptz not null default now(),
  created_by        uuid not null,
  unique (shop_id, doc_no),
  check (paid_cents <= total_cents)
);
create index wholesale_docs_shop_time on public.wholesale_docs (shop_id, created_at desc);

create table public.wholesale_doc_lines (
  id                uuid primary key default app.uuid_v7(),
  doc_id            uuid not null references public.wholesale_docs (id) on delete cascade,
  tenant_id         uuid not null references public.tenants (id),
  line_no           integer not null check (line_no >= 1),
  item_id           uuid not null references public.items (id),
  item_name         text not null,
  tax_class         public.tax_class not null,
  pack_qty          integer not null default 1 check (pack_qty between 1 and 1000),
  unit_label        text not null,                         -- "Case of 24", "Each"
  qty               integer not null check (qty between 1 and 100000),   -- packs
  list_price_cents  bigint not null check (list_price_cents >= 0),       -- per pack, retail
  price_cents       bigint not null check (price_cents >= 0),            -- per pack, wholesale
  discount_bp       integer not null default 0 check (discount_bp between 0 and 5000),
  line_total_cents  bigint not null check (line_total_cents >= 0),
  unit_cost_cents   bigint not null default 0,
  unique (doc_id, line_no)
);

alter table public.wholesale_docs enable row level security;
alter table public.wholesale_docs force row level security;
alter table public.wholesale_doc_lines enable row level security;
alter table public.wholesale_doc_lines force row level security;
create policy wholesale_docs_read on public.wholesale_docs for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));
create policy wholesale_doc_lines_read on public.wholesale_doc_lines for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and exists (select 1 from public.wholesale_docs d where d.id = doc_id and (select app.can_shop(d.shop_id))));
revoke all on public.wholesale_docs, public.wholesale_doc_lines from anon;
revoke insert, update, delete, truncate on public.wholesale_docs, public.wholesale_doc_lines from authenticated;

-- Standard VAT rate in force on a date (BR-060).
create or replace function app.tax_rate_bp(p_tenant uuid, p_class public.tax_class, p_on date)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select r.rate_bp from public.tax_rates r
                    where r.tenant_id = p_tenant and r.tax_class = p_class and r.effective_from <= p_on
                    order by r.effective_from desc limit 1), 0);
$$;

-- p: {kind, customerId?, buyerName, buyerAddress?, buyerVatNo?, buyerPhone?, terms, paidCents, chequeNo?, note?,
--     fromQuotationId?, validDays?, lines: [{itemId, packQty, qty, priceCents?, discountBp}]}
-- Prices come from the item (wholesale × pack) unless overridden; the server computes every total.
create or replace function api.save_wholesale(p_shop uuid, p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant   uuid := app.tenant_id();
  v_t        public.tenants;
  v_kind     public.wholesale_kind := (p ->> 'kind')::public.wholesale_kind;
  v_terms    public.wholesale_terms := coalesce(p ->> 'terms', 'cash')::public.wholesale_terms;
  v_customer public.customers;
  v_id       uuid;
  v_no       text;
  v_sub      bigint;
  v_disc     bigint;
  v_vat      bigint := 0;
  v_total    bigint;
  v_paid     bigint := coalesce((p ->> 'paidCents')::bigint, 0);
  v_balance  bigint;
  v_line     record;
  v_rate     integer;
begin
  perform app.require_perm('sale.create');
  if v_kind = 'invoice' then
    perform app.require_perm('customer.manage');
  end if;
  if not app.can_shop(p_shop) then
    raise exception 'NOT_FOUND: shop' using errcode = 'P0001';
  end if;
  select * into v_t from public.tenants where id = v_tenant;
  if (p ->> 'customerId') is not null then
    select * into v_customer from public.customers c where c.id = (p ->> 'customerId')::uuid and c.tenant_id = v_tenant for update;
    if v_customer.id is null then
      raise exception 'NOT_FOUND: customer' using errcode = 'P0001';
    end if;
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then
    raise exception 'VALIDATION_ERROR: add at least one line' using errcode = 'P0001';
  end if;

  create temp table if not exists pg_temp.ws_calc (
    line_no integer, item_id uuid, item_name text, tax_class public.tax_class, pack_qty integer, unit_label text, qty integer,
    list_price bigint, price bigint, discount_bp integer, line_total bigint, unit_cost bigint, min_price bigint, mrp bigint
  ) on commit drop;
  truncate pg_temp.ws_calc;

  insert into pg_temp.ws_calc
  select x.ord::integer, i.id, i.name, i.tax_class, x.pack, case when x.pack = 1 then 'Each' else 'Case of ' || x.pack end, x.qty,
         coalesce(pli.price_cents, 0) * x.pack,
         coalesce(x.price, coalesce(i.wholesale_cents, pli.price_cents, 0) * x.pack),
         x.disc, 0,
         coalesce(nullif(l.avg_cost_cents, 0), i.cost_cents, 0), i.min_price_cents, i.mrp_cents
    from jsonb_array_elements(p -> 'lines') with ordinality as e(l, ord)
    cross join lateral (select greatest(coalesce((e.l ->> 'packQty')::integer, 1), 1) as pack, (e.l ->> 'qty')::integer as qty,
                               (e.l ->> 'priceCents')::bigint as price, coalesce((e.l ->> 'discountBp')::integer, 0) as disc,
                               (e.l ->> 'itemId')::uuid as item_id, e.ord) x
    join public.items i on i.id = x.item_id and i.tenant_id = v_tenant and i.is_active
    left join public.price_lists pl on pl.tenant_id = v_tenant and pl.is_default
    left join public.price_list_items pli on pli.price_list_id = pl.id and pli.item_id = i.id
    left join public.stock_levels l on l.item_id = i.id and l.shop_id = p_shop;

  if (select count(*) from pg_temp.ws_calc) <> jsonb_array_length(p -> 'lines') then
    raise exception 'ITEM_INACTIVE' using errcode = 'P0001';
  end if;
  update pg_temp.ws_calc set line_total = price * qty - app.div_round(price * qty * discount_bp, 10000) where true;
  if exists (select 1 from pg_temp.ws_calc c where c.min_price is not null
              and app.div_round(c.line_total, c.qty * c.pack_qty) < c.min_price) then
    raise exception 'VALIDATION_ERROR: a price is below the item''s minimum price' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_temp.ws_calc c where c.mrp is not null and c.price > c.mrp * c.pack_qty) then
    raise exception 'ABOVE_MRP' using errcode = 'P0001';
  end if;

  select sum(price * qty), sum(price * qty - line_total), sum(line_total) into v_sub, v_disc, v_total from pg_temp.ws_calc;
  if v_t.vat_registered then
    v_rate := app.tax_rate_bp(v_tenant, 'standard', current_date);
    select coalesce(sum(case when v_t.prices_include_vat then app.div_round(line_total * v_rate, 10000 + v_rate)
                             else app.div_round(line_total * v_rate, 10000) end), 0)
      into v_vat from pg_temp.ws_calc where tax_class = 'standard';
    if not v_t.prices_include_vat then
      v_total := v_total + v_vat;
    end if;
  end if;

  if v_kind = 'invoice' then
    if v_paid > v_total or v_paid < 0 then
      raise exception 'VALIDATION_ERROR: paid amount is more than the total' using errcode = 'P0001';
    end if;
    if v_terms = 'cheque' and coalesce(p ->> 'chequeNo', '') = '' then
      raise exception 'VALIDATION_ERROR: enter the cheque number' using errcode = 'P0001';
    end if;
    v_balance := v_total - v_paid;
    if v_terms = 'cash' and v_balance > 0 then
      raise exception 'UNDERPAID' using errcode = 'P0001';
    end if;
    if v_balance > 0 then
      if v_customer.id is null then
        raise exception 'CUSTOMER_REQUIRED' using errcode = 'P0001';
      end if;
      if v_customer.balance_due_cents + v_balance > v_customer.credit_limit_cents then
        raise exception 'CREDIT_LIMIT: available %', greatest(0, v_customer.credit_limit_cents - v_customer.balance_due_cents) using errcode = 'P0001';
      end if;
    end if;
  else
    v_paid := 0;
  end if;

  v_no := app.next_doc_no(p_shop, case when v_kind = 'invoice' then 'WS' else 'QTN' end);
  insert into public.wholesale_docs (tenant_id, shop_id, kind, doc_no, status, customer_id, buyer_name, buyer_address, buyer_vat_no,
                                     buyer_phone, terms, credit_days, cheque_no, subtotal_cents, discount_cents, vat_cents, vat_included,
                                     total_cents, paid_cents, valid_until, due_on, from_quotation_id, note, created_by)
  values (v_tenant, p_shop, v_kind, v_no, case when v_kind = 'invoice' then 'issued'::public.wholesale_status else 'open' end,
          v_customer.id, coalesce(nullif(trim(p ->> 'buyerName'), ''), v_customer.name, 'Cash buyer'), nullif(p ->> 'buyerAddress', ''),
          nullif(p ->> 'buyerVatNo', ''), nullif(p ->> 'buyerPhone', ''), v_terms,
          case when v_terms = 'credit' then v_t.customer_credit_days else 0 end, nullif(p ->> 'chequeNo', ''),
          v_sub, v_disc, v_vat, v_t.prices_include_vat, v_total, v_paid,
          case when v_kind = 'quotation' then current_date + coalesce((p ->> 'validDays')::integer, 14) end,
          case when v_kind = 'invoice' and v_terms = 'credit' then current_date + v_t.customer_credit_days end,
          (p ->> 'fromQuotationId')::uuid, nullif(p ->> 'note', ''), auth.uid())
  returning id into v_id;

  insert into public.wholesale_doc_lines (doc_id, tenant_id, line_no, item_id, item_name, tax_class, pack_qty, unit_label, qty,
                                          list_price_cents, price_cents, discount_bp, line_total_cents, unit_cost_cents)
  select v_id, v_tenant, c.line_no, c.item_id, c.item_name, c.tax_class, c.pack_qty, c.unit_label, c.qty, c.list_price, c.price,
         c.discount_bp, c.line_total, c.unit_cost
    from pg_temp.ws_calc c;

  if v_kind = 'invoice' then
    for v_line in select * from pg_temp.ws_calc loop
      perform app.post_movement(v_tenant, p_shop, v_line.item_id, -(v_line.qty::bigint * v_line.pack_qty * 1000), 'sale', 'wholesale', v_id, v_no);
    end loop;
    if v_balance > 0 then
      perform app.customer_post(v_tenant, v_customer.id, 'sale', v_id, v_balance, v_no);
    end if;
    if (p ->> 'fromQuotationId') is not null then
      update public.wholesale_docs set status = 'converted'
       where id = (p ->> 'fromQuotationId')::uuid and tenant_id = v_tenant and kind = 'quotation';
    end if;
  end if;

  perform app.audit('wholesale.' || v_kind, 'wholesale_docs', v_id, jsonb_build_object('total', v_total, 'paid', v_paid));
  return jsonb_build_object('id', v_id, 'docNo', v_no, 'totalCents', v_total);
end $$;

-- Reports (Figma 1-4536) ------------------------------------------------------------------------------------
-- One entry point for the report tabs. Days are Colombo calendar days, both ends included.

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
  else
    raise exception 'VALIDATION_ERROR: unknown report' using errcode = 'P0001';
  end if;
  return v_out;
end $$;

revoke all on function api.update_profile(text, text, text), api.save_wholesale(uuid, jsonb), api.report(uuid, text, date, date) from public, anon;
grant execute on function api.update_profile(text, text, text), api.save_wholesale(uuid, jsonb), api.report(uuid, text, date, date)
  to authenticated, service_role;
