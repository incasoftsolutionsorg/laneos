-- Chain / head office (Figma 3-261 and blueprint §26, §28.6–28.7):
--   more shops (api.add_shop), per-shop price overrides, scheduled price changes (pg_cron), stock transfers,
--   and the cross-shop read functions behind Head office, Stock across shops, Revenue and Damage across shops.

-- Shops ------------------------------------------------------------------------------------------------------

create or replace function api.add_shop(p_code text, p_name text, p_address text, p_phone text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_max    integer;
  v_id     uuid;
begin
  perform app.require_perm('settings.manage');
  select e.max_shops into v_max from public.tenant_entitlements e where e.tenant_id = v_tenant;
  if (select count(*) from public.shops s where s.tenant_id = v_tenant and s.is_active) >= coalesce(v_max, 1) then
    raise exception 'PLAN_LIMIT: % shops', coalesce(v_max, 1) using errcode = 'P0001';
  end if;
  insert into public.shops (tenant_id, code, name, address, phone, created_by)
  values (v_tenant, upper(p_code), trim(p_name), nullif(trim(p_address), ''), nullif(p_phone, ''), auth.uid())
  returning id into v_id;
  insert into public.lanes (tenant_id, shop_id, code, name, created_by) values (v_tenant, v_id, 'L1', 'Lane 1', auth.uid());
  -- Shelf labels for every item at the new shop's prices.
  insert into public.label_queue (tenant_id, shop_id, item_id, reason)
  select v_tenant, v_id, i.id, 'new_item' from public.items i where i.tenant_id = v_tenant and i.is_active;
  perform app.audit('shop.create', 'shops', v_id, jsonb_build_object('code', upper(p_code)));
  return v_id;
end $$;

create or replace function api.set_shop_active(p_shop uuid, p_active boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('settings.manage');
  if not p_active and (select count(*) from public.shops s where s.tenant_id = app.tenant_id() and s.is_active) <= 1 then
    raise exception 'VALIDATION_ERROR: a business needs at least one active shop' using errcode = 'P0001';
  end if;
  if not p_active and exists (select 1 from public.shifts sh where sh.shop_id = p_shop and sh.status = 'open') then
    raise exception 'VALIDATION_ERROR: close the open shifts first' using errcode = 'P0001';
  end if;
  update public.shops set is_active = p_active, updated_at = now() where id = p_shop and tenant_id = app.tenant_id();
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.audit(case when p_active then 'shop.reopen' else 'shop.close' end, 'shops', p_shop);
end $$;

-- Per-shop prices (central pricing → overrides) ------------------------------------------------------------------

create table public.shop_prices (
  shop_id     uuid not null references public.shops (id),
  item_id     uuid not null references public.items (id),
  tenant_id   uuid not null references public.tenants (id),
  price_cents bigint not null check (price_cents >= 0),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (shop_id, item_id)
);
create index shop_prices_item on public.shop_prices (item_id);
alter table public.shop_prices enable row level security;
alter table public.shop_prices force row level security;
create policy shop_prices_read on public.shop_prices for select to authenticated using (tenant_id = (select app.tenant_id()));
revoke all on public.shop_prices from anon;
revoke insert, update, delete, truncate on public.shop_prices from authenticated;
create trigger shop_prices_catalog after insert or update or delete on public.shop_prices
  for each row execute function app.bump_catalog_version();

-- Override (or clear with null) one item's price at one shop. Same MRP rule as the default list (BR-011).
create or replace function app.set_shop_price(p_tenant uuid, p_shop uuid, p_item uuid, p_price bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old bigint;
begin
  if p_price is not null and exists (select 1 from public.items i where i.id = p_item and i.mrp_cents is not null and p_price > i.mrp_cents) then
    raise exception 'ABOVE_MRP' using errcode = 'P0001';
  end if;
  select price_cents into v_old from public.shop_prices where shop_id = p_shop and item_id = p_item;
  if p_price is null then
    delete from public.shop_prices where shop_id = p_shop and item_id = p_item;
  else
    insert into public.shop_prices (shop_id, item_id, tenant_id, price_cents, updated_by)
    values (p_shop, p_item, p_tenant, p_price, auth.uid())
    on conflict (shop_id, item_id) do update set price_cents = excluded.price_cents, updated_at = now(), updated_by = excluded.updated_by;
  end if;
  if p_price is distinct from v_old then
    insert into public.label_queue (tenant_id, shop_id, item_id, reason, old_price_cents)
    values (p_tenant, p_shop, p_item, 'price_changed', v_old)
    on conflict (shop_id, item_id) where printed_at is null do update set reason = excluded.reason;
  end if;
end $$;

create or replace function api.set_shop_price(p_shop uuid, p_item uuid, p_price_cents bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('item.edit');
  if not app.can_shop(p_shop) or not exists (select 1 from public.items i where i.id = p_item and i.tenant_id = app.tenant_id()) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.set_shop_price(app.tenant_id(), p_shop, p_item, p_price_cents);
  perform app.audit('price.override', 'shop_prices', p_item, jsonb_build_object('shop', p_shop, 'price', p_price_cents));
end $$;

-- Scheduled price changes (WF-007) ------------------------------------------------------------------------------

create type public.price_schedule_status as enum ('scheduled', 'applied', 'cancelled');

create table public.price_schedules (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants (id),
  name         text not null check (char_length(name) between 2 and 80),
  starts_at    timestamptz not null,
  status       public.price_schedule_status not null default 'scheduled',
  created_at   timestamptz not null default now(),
  created_by   uuid not null,
  applied_at   timestamptz,
  cancelled_by uuid
);
create index price_schedules_due on public.price_schedules (starts_at) where status = 'scheduled';

create table public.price_schedule_lines (
  id          uuid primary key default app.uuid_v7(),
  schedule_id uuid not null references public.price_schedules (id) on delete cascade,
  tenant_id   uuid not null references public.tenants (id),
  item_id     uuid not null references public.items (id),
  shop_id     uuid references public.shops (id),              -- null = every shop (the default list)
  price_cents bigint not null check (price_cents >= 0),
  old_cents   bigint,                                          -- filled when applied
  unique nulls not distinct (schedule_id, item_id, shop_id)
);

alter table public.price_schedules enable row level security;
alter table public.price_schedules force row level security;
alter table public.price_schedule_lines enable row level security;
alter table public.price_schedule_lines force row level security;
create policy price_schedules_read on public.price_schedules for select to authenticated using (tenant_id = (select app.tenant_id()));
create policy price_schedule_lines_read on public.price_schedule_lines for select to authenticated using (tenant_id = (select app.tenant_id()));
revoke all on public.price_schedules, public.price_schedule_lines from anon;
revoke insert, update, delete, truncate on public.price_schedules, public.price_schedule_lines from authenticated;

-- p: {name, startsAt, lines: [{itemId, shopId?, priceCents}]}
create or replace function api.save_price_schedule(p jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_id     uuid;
begin
  perform app.require_perm('item.edit');
  if (p ->> 'startsAt')::timestamptz < now() - interval '1 minute' then
    raise exception 'VALIDATION_ERROR: the start time is in the past' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then
    raise exception 'VALIDATION_ERROR: add at least one item' using errcode = 'P0001';
  end if;
  insert into public.price_schedules (tenant_id, name, starts_at, created_by)
  values (v_tenant, trim(p ->> 'name'), (p ->> 'startsAt')::timestamptz, auth.uid()) returning id into v_id;
  insert into public.price_schedule_lines (schedule_id, tenant_id, item_id, shop_id, price_cents)
  select v_id, v_tenant, i.id, s.id, (l ->> 'priceCents')::bigint
    from jsonb_array_elements(p -> 'lines') l
    join public.items i on i.id = (l ->> 'itemId')::uuid and i.tenant_id = v_tenant
    left join public.shops s on s.id = nullif(l ->> 'shopId', '')::uuid and s.tenant_id = v_tenant;
  if exists (select 1 from public.price_schedule_lines x join public.items i on i.id = x.item_id
              where x.schedule_id = v_id and i.mrp_cents is not null and x.price_cents > i.mrp_cents) then
    raise exception 'ABOVE_MRP' using errcode = 'P0001';
  end if;
  perform app.audit('price.schedule', 'price_schedules', v_id, jsonb_build_object('startsAt', p ->> 'startsAt'));
  return v_id;
end $$;

create or replace function api.cancel_price_schedule(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('item.edit');
  update public.price_schedules set status = 'cancelled', cancelled_by = auth.uid()
   where id = p_id and tenant_id = app.tenant_id() and status = 'scheduled';
  if not found then
    raise exception 'VALIDATION_ERROR: only a scheduled change can be cancelled' using errcode = 'P0001';
  end if;
  perform app.audit('price.schedule_cancel', 'price_schedules', p_id);
end $$;

-- Applies every due schedule (all tenants when called by pg_cron; the caller's tenant from the API).
create or replace function app.apply_due_price_schedules(p_tenant uuid default null)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_s    record;
  v_l    record;
  v_list uuid;
  v_n    integer := 0;
begin
  for v_s in select * from public.price_schedules ps
              where ps.status = 'scheduled' and ps.starts_at <= now() and (p_tenant is null or ps.tenant_id = p_tenant)
              order by ps.starts_at for update skip locked loop
    select pl.id into v_list from public.price_lists pl where pl.tenant_id = v_s.tenant_id and pl.is_default;
    for v_l in select * from public.price_schedule_lines x where x.schedule_id = v_s.id loop
      if v_l.shop_id is null then
        update public.price_schedule_lines set old_cents = (select pli.price_cents from public.price_list_items pli
                                                              where pli.price_list_id = v_list and pli.item_id = v_l.item_id)
         where id = v_l.id;
        insert into public.price_list_items (price_list_id, item_id, tenant_id, price_cents)
        values (v_list, v_l.item_id, v_s.tenant_id, v_l.price_cents)
        on conflict (price_list_id, item_id) do update set price_cents = excluded.price_cents, updated_at = now();
      else
        update public.price_schedule_lines set old_cents = (select sp.price_cents from public.shop_prices sp
                                                              where sp.shop_id = v_l.shop_id and sp.item_id = v_l.item_id)
         where id = v_l.id;
        perform app.set_shop_price(v_s.tenant_id, v_l.shop_id, v_l.item_id, v_l.price_cents);
      end if;
    end loop;
    update public.price_schedules set status = 'applied', applied_at = now() where id = v_s.id;
    insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, data)
    values (v_s.tenant_id, null, 'price.schedule_applied', 'price_schedules', v_s.id, '{}');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function api.apply_due_price_schedules()
returns integer
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('item.edit');
  return app.apply_due_price_schedules(app.tenant_id());
end $$;

-- Every minute if pg_cron can be enabled; otherwise the pricing page applies due changes when opened.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('laneos-apply-price-schedules', '* * * * *', 'select app.apply_due_price_schedules()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end $$;

-- Stock transfers (WF-006) --------------------------------------------------------------------------------------

create type public.transfer_status as enum ('requested', 'approved', 'rejected', 'in_transit', 'received', 'received_with_variance', 'closed', 'cancelled');

create table public.transfers (
  id            uuid primary key default app.uuid_v7(),
  tenant_id     uuid not null references public.tenants (id),
  transfer_no   text not null unique,
  from_shop_id  uuid not null references public.shops (id),
  to_shop_id    uuid not null references public.shops (id),
  status        public.transfer_status not null default 'requested',
  note          text check (char_length(note) <= 300),
  variance_note text check (char_length(variance_note) <= 300),
  requested_by  uuid not null,
  approved_by   uuid,
  approved_at   timestamptz,
  dispatched_by uuid,
  dispatched_at timestamptz,
  received_by   uuid,
  received_at   timestamptz,
  closed_by     uuid,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  check (from_shop_id <> to_shop_id)
);
create index transfers_shops on public.transfers (tenant_id, created_at desc);

create table public.transfer_lines (
  id                  uuid primary key default app.uuid_v7(),
  transfer_id         uuid not null references public.transfers (id) on delete cascade,
  tenant_id           uuid not null references public.tenants (id),
  item_id             uuid not null references public.items (id),
  qty_requested_milli bigint not null check (qty_requested_milli > 0),
  qty_sent_milli      bigint check (qty_sent_milli >= 0),
  qty_received_milli  bigint check (qty_received_milli >= 0),
  unit_cost_cents     bigint not null default 0,
  unique (transfer_id, item_id)
);

alter table public.transfers enable row level security;
alter table public.transfers force row level security;
alter table public.transfer_lines enable row level security;
alter table public.transfer_lines force row level security;
create policy transfers_read on public.transfers for select to authenticated
  using (tenant_id = (select app.tenant_id()) and ((select app.can_shop(from_shop_id)) or (select app.can_shop(to_shop_id))));
create policy transfer_lines_read on public.transfer_lines for select to authenticated
  using (tenant_id = (select app.tenant_id())
         and exists (select 1 from public.transfers t where t.id = transfer_id
                      and ((select app.can_shop(t.from_shop_id)) or (select app.can_shop(t.to_shop_id)))));
revoke all on public.transfers, public.transfer_lines from anon;
revoke insert, update, delete, truncate on public.transfers, public.transfer_lines from authenticated;

-- p: {fromShopId, toShopId, note, lines: [{itemId, qtyMilli}]} — the receiving shop asks for stock.
create or replace function api.request_transfer(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_from   uuid := (p ->> 'fromShopId')::uuid;
  v_to     uuid := (p ->> 'toShopId')::uuid;
  v_id     uuid;
  v_no     text;
begin
  perform app.require_perm('stock.adjust');
  if not (select e.transfers from public.tenant_entitlements e where e.tenant_id = v_tenant) then
    raise exception 'PLAN_LIMIT: transfers are on the Multi-store plan and up' using errcode = 'P0001';
  end if;
  if not app.can_shop(v_to) or not exists (select 1 from public.shops s where s.id = v_from and s.tenant_id = v_tenant and s.is_active) then
    raise exception 'NOT_FOUND: shop' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then
    raise exception 'VALIDATION_ERROR: add at least one item' using errcode = 'P0001';
  end if;
  v_no := app.next_doc_no(v_from, 'TRF');
  insert into public.transfers (tenant_id, transfer_no, from_shop_id, to_shop_id, note, requested_by)
  values (v_tenant, v_no, v_from, v_to, nullif(p ->> 'note', ''), auth.uid()) returning id into v_id;
  insert into public.transfer_lines (transfer_id, tenant_id, item_id, qty_requested_milli, unit_cost_cents)
  select v_id, v_tenant, i.id, sum((l ->> 'qtyMilli')::bigint), coalesce(max(sl.avg_cost_cents), max(i.cost_cents), 0)
    from jsonb_array_elements(p -> 'lines') l
    join public.items i on i.id = (l ->> 'itemId')::uuid and i.tenant_id = v_tenant
    left join public.stock_levels sl on sl.item_id = i.id and sl.shop_id = v_from
   group by i.id;
  perform app.audit('transfer.request', 'transfers', v_id, jsonb_build_object('from', v_from, 'to', v_to));
  return jsonb_build_object('id', v_id, 'transferNo', v_no);
end $$;

-- approve / reject (transfer.approve) · dispatch {lines:[{itemId, qtyMilli}]} at the sending shop ·
-- receive {lines:[{itemId, qtyMilli}]} at the receiving shop · close {note} (accept a variance) · cancel.
create or replace function api.transfer_action(p_id uuid, p_action text, p jsonb default '{}')
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_t      public.transfers;
  v_l      record;
  v_member uuid := app.member_id();
  v_qty    bigint;
  v_var    boolean := false;
begin
  select * into v_t from public.transfers t where t.id = p_id and t.tenant_id = app.tenant_id() for update;
  if v_t.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_action in ('approve', 'reject') then
    perform app.require_perm('transfer.approve');
    if v_t.status <> 'requested' then
      raise exception 'VALIDATION_ERROR: only a requested transfer can be approved or rejected' using errcode = 'P0001';
    end if;
    update public.transfers set status = case when p_action = 'approve' then 'approved'::public.transfer_status else 'rejected' end,
           approved_by = v_member, approved_at = now(), variance_note = case when p_action = 'reject' then nullif(p ->> 'note', '') end
     where id = p_id;

  elsif p_action = 'dispatch' then
    perform app.require_perm('stock.adjust');
    if not app.can_shop(v_t.from_shop_id) then
      raise exception 'FORBIDDEN: only the sending shop dispatches' using errcode = 'P0001';
    end if;
    if v_t.status <> 'approved' then
      raise exception 'VALIDATION_ERROR: approve the transfer first' using errcode = 'P0001';
    end if;
    for v_l in select * from public.transfer_lines x where x.transfer_id = p_id loop
      select coalesce((select (e ->> 'qtyMilli')::bigint from jsonb_array_elements(coalesce(p -> 'lines', '[]')) e
                        where (e ->> 'itemId')::uuid = v_l.item_id), v_l.qty_requested_milli) into v_qty;
      update public.transfer_lines set qty_sent_milli = v_qty where id = v_l.id;
      if v_qty > 0 then
        perform app.post_movement(v_t.tenant_id, v_t.from_shop_id, v_l.item_id, -v_qty, 'transfer_out', 'transfer', p_id, v_t.transfer_no);
      end if;
    end loop;
    update public.transfers set status = 'in_transit', dispatched_by = v_member, dispatched_at = now() where id = p_id;

  elsif p_action = 'receive' then
    perform app.require_perm('stock.adjust');
    if not app.can_shop(v_t.to_shop_id) then
      raise exception 'FORBIDDEN: only the receiving shop receives' using errcode = 'P0001';
    end if;
    if v_t.status <> 'in_transit' then
      raise exception 'VALIDATION_ERROR: the transfer is not on its way' using errcode = 'P0001';
    end if;
    for v_l in select * from public.transfer_lines x where x.transfer_id = p_id loop
      select coalesce((select (e ->> 'qtyMilli')::bigint from jsonb_array_elements(coalesce(p -> 'lines', '[]')) e
                        where (e ->> 'itemId')::uuid = v_l.item_id), v_l.qty_sent_milli) into v_qty;
      if v_qty < 0 or v_qty > v_l.qty_sent_milli then
        raise exception 'VALIDATION_ERROR: received quantity must be between 0 and what was sent' using errcode = 'P0001';
      end if;
      update public.transfer_lines set qty_received_milli = v_qty where id = v_l.id;
      if v_qty > 0 then
        perform app.post_movement(v_t.tenant_id, v_t.to_shop_id, v_l.item_id, v_qty, 'transfer_in', 'transfer', p_id, v_t.transfer_no);
      end if;
      v_var := v_var or v_qty <> v_l.qty_sent_milli;
    end loop;
    update public.transfers set status = case when v_var then 'received_with_variance'::public.transfer_status else 'closed' end,
           received_by = v_member, received_at = now(), closed_at = case when v_var then null else now() end,
           variance_note = coalesce(nullif(p ->> 'note', ''), variance_note)
     where id = p_id;

  elsif p_action = 'close' then
    perform app.require_perm('transfer.approve');
    if v_t.status <> 'received_with_variance' then
      raise exception 'VALIDATION_ERROR: only a transfer with a variance waits to be closed' using errcode = 'P0001';
    end if;
    if char_length(coalesce(p ->> 'note', '')) < 3 then
      raise exception 'VALIDATION_ERROR: say why the quantities differ' using errcode = 'P0001';
    end if;
    update public.transfers set status = 'closed', closed_by = v_member, closed_at = now(), variance_note = p ->> 'note' where id = p_id;

  elsif p_action = 'cancel' then
    if v_t.status not in ('requested', 'approved') then
      raise exception 'VALIDATION_ERROR: a dispatched transfer cannot be cancelled' using errcode = 'P0001';
    end if;
    if v_t.requested_by <> auth.uid() and not app.has_perm('transfer.approve') then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    update public.transfers set status = 'cancelled' where id = p_id;
  else
    raise exception 'VALIDATION_ERROR: unknown action' using errcode = 'P0001';
  end if;
  perform app.audit('transfer.' || p_action, 'transfers', p_id, p - 'lines');
end $$;

-- Head office read functions ------------------------------------------------------------------------------------

-- One row per shop the caller can see: today's sales, lanes online, stock value and alerts (Figma 3-261).
create or replace function api.chain_overview()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_today  timestamptz := ((now() at time zone 'Asia/Colombo')::date::timestamp at time zone 'Asia/Colombo');
begin
  perform app.require_perm('reports.view');
  return coalesce((select jsonb_agg(x order by x ->> 'code') from (
    select jsonb_build_object(
      'id', s.id, 'code', s.code, 'name', s.name, 'isActive', s.is_active,
      'salesToday', coalesce((select sum(v.total_cents) from public.sales v where v.shop_id = s.id and v.created_at >= v_today), 0),
      'billsToday', (select count(*) from public.sales v where v.shop_id = s.id and v.created_at >= v_today),
      'salesYesterday', coalesce((select sum(v.total_cents) from public.sales v where v.shop_id = s.id
                                    and v.created_at >= v_today - interval '1 day' and v.created_at < now() - interval '1 day'), 0),
      'lanes', (select count(*) from public.lanes l where l.shop_id = s.id and l.status = 'active'),
      'lanesOnline', (select count(*) from public.lanes l where l.shop_id = s.id and l.status = 'active' and l.last_seen_at > now() - interval '15 minutes'),
      'offlineLanes', (select coalesce(jsonb_agg(l.code order by l.code), '[]') from public.lanes l
                        where l.shop_id = s.id and l.status = 'active' and l.registered_at is not null
                          and (l.last_seen_at is null or l.last_seen_at <= now() - interval '15 minutes')
                          and exists (select 1 from public.shifts sh where sh.lane_id = l.id and sh.status = 'open')),
      'stockValue', coalesce((select sum(greatest(sl.qty_milli, 0) * coalesce(nullif(sl.avg_cost_cents, 0), i.cost_cents, 0) / 1000)
                                from public.stock_levels sl join public.items i on i.id = sl.item_id where sl.shop_id = s.id), 0),
      'lowStock', (select count(*) from public.stock_levels sl join public.items i on i.id = sl.item_id
                    where sl.shop_id = s.id and i.is_active and i.reorder_level_milli > 0 and sl.qty_milli <= i.reorder_level_milli),
      'syncIssues', (select count(*) from public.sync_issues si where si.shop_id = s.id and si.status = 'open'),
      'damagePending', (select count(*) from public.damage_reports d where d.shop_id = s.id
                         and d.status in ('reported', 'awaiting_approval', 'awaiting_decision')),
      'lastVariance', (select sh.counted_cash_cents - sh.expected_cash_cents from public.shifts sh
                        where sh.shop_id = s.id and sh.status = 'closed' and sh.closed_at >= v_today - interval '1 day'
                          and sh.counted_cash_cents <> sh.expected_cash_cents order by sh.closed_at desc limit 1),
      'lastPricePush', (select max(ps.applied_at) from public.price_schedules ps where ps.tenant_id = v_tenant and ps.status = 'applied')
    ) as x
    from public.shops s where s.tenant_id = v_tenant and s.id = any (app.shop_ids())) t), '[]');
end $$;

-- Per shop over a range: net sales, bills, margin, returns, wastage, damage (Revenue and Damage across shops).
create or replace function api.chain_report(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_start timestamptz := (p_from::timestamp at time zone 'Asia/Colombo');
  v_end   timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Colombo');
begin
  perform app.require_perm('reports.view');
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'VALIDATION_ERROR: choose a range of up to 400 days' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'sales')::bigint desc) from (
    select jsonb_build_object(
      'id', s.id, 'code', s.code, 'name', s.name,
      'sales', coalesce((select sum(v.total_cents) from public.sales v where v.shop_id = s.id and v.created_at >= v_start and v.created_at < v_end), 0),
      'bills', (select count(*) from public.sales v where v.shop_id = s.id and v.created_at >= v_start and v.created_at < v_end),
      'lineSales', coalesce((select sum(sl.net_cents) from public.sale_lines sl join public.sales v on v.id = sl.sale_id
                              where v.shop_id = s.id and v.created_at >= v_start and v.created_at < v_end), 0),
      'margin', coalesce((select sum(sl.net_cents - app.div_round(sl.unit_cost_cents * sl.qty_milli, 1000)) from public.sale_lines sl
                           join public.sales v on v.id = sl.sale_id where v.shop_id = s.id and v.created_at >= v_start and v.created_at < v_end), 0),
      'returns', coalesce((select sum(r.total_cents) from public.returns r where r.shop_id = s.id and r.created_at >= v_start and r.created_at < v_end), 0),
      'wholesale', coalesce((select sum(w.total_cents) from public.wholesale_docs w where w.shop_id = s.id and w.kind = 'invoice'
                              and w.status = 'issued' and w.created_at >= v_start and w.created_at < v_end), 0),
      'damageValue', coalesce((select sum(app.div_round(d.qty_milli * d.unit_cost_cents, 1000)) from public.damage_reports d
                                where d.shop_id = s.id and d.created_at >= v_start and d.created_at < v_end), 0),
      'damageReports', (select count(*) from public.damage_reports d where d.shop_id = s.id and d.created_at >= v_start and d.created_at < v_end),
      'damagePending', (select count(*) from public.damage_reports d where d.shop_id = s.id and d.status in ('reported', 'awaiting_approval', 'awaiting_decision')),
      'wastage', coalesce((select sum(-m.qty_milli * coalesce(nullif(l.avg_cost_cents, 0), i.cost_cents, 0) / 1000)
                            from public.stock_movements m join public.items i on i.id = m.item_id
                            left join public.stock_levels l on l.item_id = m.item_id and l.shop_id = m.shop_id
                           where m.shop_id = s.id and m.reason = 'wastage' and m.qty_milli < 0 and m.created_at >= v_start and m.created_at < v_end), 0),
      'days', (select coalesce(jsonb_agg(jsonb_build_object('day', g::date, 'net',
                 coalesce((select sum(v.total_cents) from public.sales v where v.shop_id = s.id
                            and v.created_at >= (g::date::timestamp at time zone 'Asia/Colombo')
                            and v.created_at < ((g::date + 1)::timestamp at time zone 'Asia/Colombo')), 0)) order by g), '[]')
                 from generate_series(p_from, p_to, interval '1 day') g)
    ) as x
    from public.shops s where s.tenant_id = app.tenant_id() and s.id = any (app.shop_ids())) t), '[]');
end $$;

-- Items × shops quantities (Figma 3-1035). p_search on name/barcode; at most 200 items.
create or replace function api.stock_across_shops(p_search text default null, p_department uuid default null, p_low_only boolean default false)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x ->> 'name'), '[]') from (
    select jsonb_build_object(
      'id', i.id, 'name', i.name, 'itemType', i.item_type, 'reorderMilli', i.reorder_level_milli,
      'shops', (select coalesce(jsonb_object_agg(sl.shop_id, sl.qty_milli), '{}') from public.stock_levels sl
                 where sl.item_id = i.id and sl.shop_id = any (app.shop_ids()))) as x
      from public.items i
     where i.tenant_id = app.tenant_id() and i.is_active
       and (p_department is null or i.department_id = p_department)
       and (p_search is null or p_search = '' or i.name ilike '%' || p_search || '%'
            or exists (select 1 from public.barcodes b where b.item_id = i.id and b.code = upper(p_search)))
       and (not p_low_only or exists (select 1 from public.stock_levels sl where sl.item_id = i.id
                                       and sl.shop_id = any (app.shop_ids()) and i.reorder_level_milli > 0 and sl.qty_milli <= i.reorder_level_milli))
     order by i.name limit 200) t;
$$;

-- api.create_sale v5: a shop's own price (shop_prices) wins over the default list. Otherwise unchanged from v4.
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
       order by c2.item_id, saving desc, pr.id
    ) best
   where c.item_id = best.item_id and best.saving > 0;

  update pg_temp.sale_calc set promo_cents = 0 where promo_cents is null;

  select coalesce(sum(gross_cents), 0), coalesce(sum(promo_cents), 0) into v_subtotal, v_promo from pg_temp.sale_calc;
  v_before := v_subtotal - v_promo;
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
                            balance_due_cents, client_uuid, created_by)
  values (v_tenant, v_lane.shop_id, v_lane.id, v_shift.id, v_invoice, v_customer.id, v_member,
          v_subtotal, v_promo, v_rounding, v_total, v_paid - v_account, v_change, v_account, v_client, auth.uid())
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

  return jsonb_build_object('id', v_sale, 'invoiceNo', v_invoice, 'subtotalCents', v_subtotal,
    'promoCents', v_promo, 'roundingCents', v_rounding, 'totalCents', v_total, 'changeCents', v_change,
    'receiptToken', (select s.receipt_token from public.sales s where s.id = v_sale), 'replayed', false);
end $$;

-- api.lane_catalog v4: same price rule as create_sale v5.
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
                     'itemIds', (select coalesce(jsonb_agg(pi.item_id), '[]') from public.promotion_items pi where pi.promotion_id = pr.id))), '[]')
                     from public.promotions pr
                    where pr.tenant_id = v_lane.tenant_id and pr.is_active and pr.starts_at <= now()
                      and (pr.ends_at is null or pr.ends_at > now()))
  );
end $$;

-- Grants --------------------------------------------------------------------------------------------------------

revoke all on function api.add_shop(text, text, text, text), api.set_shop_active(uuid, boolean), api.set_shop_price(uuid, uuid, bigint),
  api.save_price_schedule(jsonb), api.cancel_price_schedule(uuid), api.apply_due_price_schedules(), api.request_transfer(jsonb),
  api.transfer_action(uuid, text, jsonb), api.chain_overview(), api.chain_report(date, date), api.stock_across_shops(text, uuid, boolean)
  from public, anon;
grant execute on function api.add_shop(text, text, text, text), api.set_shop_active(uuid, boolean), api.set_shop_price(uuid, uuid, bigint),
  api.save_price_schedule(jsonb), api.cancel_price_schedule(uuid), api.apply_due_price_schedules(), api.request_transfer(jsonb),
  api.transfer_action(uuid, text, jsonb), api.chain_overview(), api.chain_report(date, date), api.stock_across_shops(text, uuid, boolean)
  to authenticated, service_role;
revoke all on function app.set_shop_price(uuid, uuid, uuid, bigint), app.apply_due_price_schedules(uuid) from public, anon, authenticated;
