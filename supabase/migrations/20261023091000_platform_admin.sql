-- Platform admin (LaneOS staff; Figma 3-2736 … 3-4959, blueprint §27.7): support tickets, time-boxed support-view
-- sessions, and admin-only functions for the overview, tenants, billing, plans, overdue, live activity, audit and security.
-- Every api.admin_* function checks app.require_platform_admin(); tenant data reached here is audited.

create or replace function app.require_platform_admin()
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'FORBIDDEN: platform admins only' using errcode = 'P0001';
  end if;
end $$;

-- Support tickets -------------------------------------------------------------------------------------------------

create type public.ticket_status as enum ('open', 'pending', 'resolved', 'closed');
create type public.ticket_priority as enum ('low', 'normal', 'high', 'urgent');

create table public.support_tickets (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references public.tenants (id),
  ticket_no   bigint generated always as identity unique,
  subject     text not null check (char_length(subject) between 3 and 120),
  priority    public.ticket_priority not null default 'normal',
  status      public.ticket_status not null default 'open',
  created_by  uuid not null,
  assigned_to uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index support_tickets_status on public.support_tickets (status, updated_at desc);

create table public.ticket_messages (
  id         uuid primary key default app.uuid_v7(),
  ticket_id  uuid not null references public.support_tickets (id) on delete cascade,
  tenant_id  uuid not null references public.tenants (id),
  author_id  uuid not null,
  is_staff   boolean not null default false,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket on public.ticket_messages (ticket_id, created_at);
create trigger ticket_messages_append_only before update or delete on public.ticket_messages for each row execute function app.append_only();

alter table public.support_tickets enable row level security;
alter table public.support_tickets force row level security;
alter table public.ticket_messages enable row level security;
alter table public.ticket_messages force row level security;
create policy support_tickets_read on public.support_tickets for select to authenticated
  using (tenant_id = (select app.tenant_id()) or (select app.is_platform_admin()));
create policy ticket_messages_read on public.ticket_messages for select to authenticated
  using (tenant_id = (select app.tenant_id()) or (select app.is_platform_admin()));
revoke all on public.support_tickets, public.ticket_messages from anon;
revoke insert, update, delete, truncate on public.support_tickets, public.ticket_messages from authenticated;

-- A tenant member opens a ticket (Back office → Help & support).
create or replace function api.create_ticket(p_subject text, p_body text, p_priority text default 'normal')
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if app.tenant_id() is null then
    raise exception 'NO_TENANT' using errcode = 'P0001';
  end if;
  insert into public.support_tickets (tenant_id, subject, priority, created_by)
  values (app.tenant_id(), trim(p_subject), coalesce(nullif(p_priority, ''), 'normal')::public.ticket_priority, auth.uid())
  returning id into v_id;
  insert into public.ticket_messages (ticket_id, tenant_id, author_id, body) values (v_id, app.tenant_id(), auth.uid(), trim(p_body));
  return v_id;
end $$;

-- Reply from either side. Staff may also change status / assign themselves.
create or replace function api.ticket_reply(p_ticket uuid, p_body text, p_status text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_t     public.support_tickets;
  v_staff boolean := app.is_platform_admin();
begin
  select * into v_t from public.support_tickets t where t.id = p_ticket for update;
  if v_t.id is null or (not v_staff and v_t.tenant_id is distinct from app.tenant_id()) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_body), '') <> '' then
    insert into public.ticket_messages (ticket_id, tenant_id, author_id, is_staff, body) values (p_ticket, v_t.tenant_id, auth.uid(), v_staff, trim(p_body));
  end if;
  update public.support_tickets
     set status = case when p_status is not null and (v_staff or p_status = 'closed') then p_status::public.ticket_status
                       when v_staff then 'pending'::public.ticket_status else 'open'::public.ticket_status end,
         assigned_to = case when v_staff then coalesce(assigned_to, auth.uid()) else assigned_to end,
         updated_at = now()
   where id = p_ticket;
end $$;

-- Support view (impersonation, read-only) -----------------------------------------------------------------------------

create table public.support_sessions (
  id         uuid primary key default app.uuid_v7(),
  admin_id   uuid not null references auth.users (id),
  tenant_id  uuid not null references public.tenants (id),
  reason     text not null check (char_length(reason) between 5 and 300),
  ticket_id  uuid references public.support_tickets (id),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at   timestamptz
);
create index support_sessions_active on public.support_sessions (admin_id, tenant_id) where ended_at is null;
alter table public.support_sessions enable row level security;
alter table public.support_sessions force row level security;
-- Admins see every session; a tenant's owners see the sessions on their business.
create policy support_sessions_read on public.support_sessions for select to authenticated
  using ((select app.is_platform_admin()) or (tenant_id = (select app.tenant_id()) and (select app.has_perm('settings.manage'))));
revoke all on public.support_sessions from anon;
revoke insert, update, delete, truncate on public.support_sessions from authenticated;

create or replace function app.support_session_ok(p_tenant uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.support_sessions s where s.admin_id = auth.uid() and s.tenant_id = p_tenant
                  and s.ended_at is null and s.expires_at > now());
$$;

create or replace function api.admin_start_support(p_tenant uuid, p_reason text, p_minutes integer default 30, p_ticket uuid default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.require_platform_admin();
  if p_minutes not between 5 and 120 then
    raise exception 'VALIDATION_ERROR: 5 to 120 minutes' using errcode = 'P0001';
  end if;
  update public.support_sessions set ended_at = now() where admin_id = auth.uid() and tenant_id = p_tenant and ended_at is null;
  insert into public.support_sessions (admin_id, tenant_id, reason, ticket_id, expires_at)
  values (auth.uid(), p_tenant, trim(p_reason), p_ticket, now() + make_interval(mins => p_minutes)) returning id into v_id;
  -- Written into the tenant's own activity log, so the business can see LaneOS looked.
  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, data)
  values (p_tenant, auth.uid(), 'support.view_start', 'support_sessions', v_id, jsonb_build_object('reason', trim(p_reason), 'minutes', p_minutes));
  return v_id;
end $$;

create or replace function api.admin_end_support(p_session uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  perform app.require_platform_admin();
  update public.support_sessions set ended_at = now() where id = p_session and admin_id = auth.uid() and ended_at is null
  returning tenant_id into v_tenant;
  if v_tenant is not null then
    insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id) values (v_tenant, auth.uid(), 'support.view_end', 'support_sessions', p_session);
  end if;
end $$;

-- What support sees during a session: configuration and health, no customer personal data.
create or replace function api.admin_support_view(p_tenant uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  if not app.support_session_ok(p_tenant) then
    raise exception 'FORBIDDEN: start a support session first' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(t) - 'created_by' from public.tenants t where t.id = p_tenant),
    'lanes', (select coalesce(jsonb_agg(jsonb_build_object('shop', s.code, 'code', l.code, 'status', l.status, 'registered', l.registered_at is not null,
                                                           'lastSeen', l.last_seen_at, 'shiftOpen', exists (select 1 from public.shifts sh where sh.lane_id = l.id and sh.status = 'open'))
                                        order by s.code, l.code), '[]')
                from public.lanes l join public.shops s on s.id = l.shop_id where l.tenant_id = p_tenant),
    'counts', jsonb_build_object(
      'items', (select count(*) from public.items i where i.tenant_id = p_tenant and i.is_active),
      'itemsNoPrice', (select count(*) from public.items i where i.tenant_id = p_tenant and i.is_active and not exists (
                        select 1 from public.price_list_items pli join public.price_lists pl on pl.id = pli.price_list_id and pl.is_default where pli.item_id = i.id)),
      'negativeStock', (select count(*) from public.stock_levels sl where sl.tenant_id = p_tenant and sl.qty_milli < 0),
      'salesToday', (select count(*) from public.sales v where v.tenant_id = p_tenant and v.created_at >= ((now() at time zone 'Asia/Colombo')::date::timestamp at time zone 'Asia/Colombo'))),
    'syncIssues', (select coalesce(jsonb_agg(jsonb_build_object('lane', l.code, 'code', si.error_code, 'message', si.error_message, 'at', si.created_at) order by si.created_at desc), '[]')
                     from public.sync_issues si join public.lanes l on l.id = si.lane_id where si.tenant_id = p_tenant and si.status = 'open'),
    'recentSales', (select coalesce(jsonb_agg(jsonb_build_object('invoice', v.invoice_no, 'total', v.total_cents, 'at', v.created_at) order by v.created_at desc), '[]')
                      from (select * from public.sales v where v.tenant_id = p_tenant order by v.created_at desc limit 10) v)
  );
end $$;

-- Admin reads -------------------------------------------------------------------------------------------------------

create or replace function app.tenant_mrr(p_tenant uuid)
returns bigint
language sql stable security definer
set search_path = ''
as $$
  select case when t.status in ('cancelled', 'trial') then 0
              when p.per_shop then p.price_cents * greatest(1, (select count(*) from public.shops s where s.tenant_id = t.id and s.is_active))
              else p.price_cents end
    from public.tenants t join public.plans p on p.id = t.plan_id where t.id = p_tenant;
$$;

create or replace function api.admin_overview()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today timestamptz := ((now() at time zone 'Asia/Colombo')::date::timestamp at time zone 'Asia/Colombo');
begin
  perform app.require_platform_admin();
  return jsonb_build_object(
    'tenants', (select jsonb_object_agg(status, n) from (select t.status, count(*) n from public.tenants t group by t.status) x),
    'mrr', (select coalesce(sum(app.tenant_mrr(t.id)), 0) from public.tenants t),
    'newThisMonth', (select count(*) from public.tenants t where t.created_at >= date_trunc('month', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo'),
    'overdue', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(i.amount_cents), 0)) from public.saas_invoices i
                 where i.status = 'open' and i.due_on < (now() at time zone 'Asia/Colombo')::date),
    'lanesOnline', (select count(*) from public.lanes l where l.last_seen_at > now() - interval '15 minutes'),
    'lanes', (select count(*) from public.lanes l where l.status = 'active'),
    'salesToday', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(v.total_cents), 0)) from public.sales v where v.created_at >= v_today),
    'openTickets', (select count(*) from public.support_tickets s where s.status in ('open', 'pending')),
    'syncIssues', (select count(*) from public.sync_issues s where s.status = 'open'),
    'signups', (select coalesce(jsonb_agg(jsonb_build_object('day', g::date, 'n',
                   (select count(*) from public.tenants t where (t.created_at at time zone 'Asia/Colombo')::date = g::date)) order by g), '[]')
                  from generate_series((now() at time zone 'Asia/Colombo')::date - 29, (now() at time zone 'Asia/Colombo')::date, interval '1 day') g)
  );
end $$;

create or replace function api.admin_tenants(p_search text default null, p_status text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(x order by x ->> 'createdAt' desc) from (
    select jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'status', t.status, 'plan', p.name, 'planId', p.id, 'city', t.city, 'createdAt', t.created_at,
      'trialEndsOn', t.trial_ends_on, 'mrr', app.tenant_mrr(t.id),
      'shops', (select count(*) from public.shops s where s.tenant_id = t.id and s.is_active),
      'lanes', (select count(*) from public.lanes l where l.tenant_id = t.id),
      'staff', (select count(*) from public.members m where m.tenant_id = t.id and m.is_active),
      'lastSale', (select max(v.created_at) from public.sales v where v.tenant_id = t.id),
      'overdue', coalesce((select sum(i.amount_cents) from public.saas_invoices i where i.tenant_id = t.id and i.status = 'open'
                            and i.due_on < (now() at time zone 'Asia/Colombo')::date), 0),
      'owner', (select u.email from public.members m join public.roles r on r.id = m.role_id and r.key = 'owner'
                  join auth.users u on u.id = m.user_id where m.tenant_id = t.id and m.is_active order by m.created_at limit 1)) as x
      from public.tenants t join public.plans p on p.id = t.plan_id
     where (p_status is null or p_status = '' or t.status::text = p_status)
       and (p_search is null or p_search = '' or t.name ilike '%' || p_search || '%' or t.slug ilike '%' || p_search || '%')
     order by t.created_at desc limit 500) q), '[]');
end $$;

create or replace function api.admin_tenant(p_tenant uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  return (select jsonb_build_object(
    'tenant', jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'status', t.status, 'planId', t.plan_id, 'createdAt', t.created_at,
                                 'trialEndsOn', t.trial_ends_on, 'nextChargeOn', t.next_charge_on, 'city', t.city, 'businessRegNo', t.business_reg_no,
                                 'businessType', t.business_type, 'mrr', app.tenant_mrr(t.id)),
    'entitlements', (select to_jsonb(e) - 'tenant_id' from public.tenant_entitlements e where e.tenant_id = t.id),
    'shops', (select coalesce(jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'isActive', s.is_active,
                                                           'lanes', (select count(*) from public.lanes l where l.shop_id = s.id)) order by s.code), '[]')
                from public.shops s where s.tenant_id = t.id),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('name', m.display_name, 'role', r.name, 'email', u.email, 'active', m.is_active,
                                                            'twoFactor', exists (select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified'))
                                         order by r.permissions desc, m.display_name), '[]')
                 from public.members m join public.roles r on r.id = m.role_id left join auth.users u on u.id = m.user_id where m.tenant_id = t.id),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'invoiceNo', i.invoice_no, 'periodStart', i.period_start, 'amount', i.amount_cents,
                                                              'status', i.status, 'dueOn', i.due_on) order by i.period_start desc), '[]')
                   from public.saas_invoices i where i.tenant_id = t.id),
    'tickets', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'no', s.ticket_no, 'subject', s.subject, 'status', s.status, 'updatedAt', s.updated_at)
                                          order by s.updated_at desc), '[]') from public.support_tickets s where s.tenant_id = t.id),
    'usage', jsonb_build_object(
      'sales30', (select count(*) from public.sales v where v.tenant_id = t.id and v.created_at > now() - interval '30 days'),
      'amount30', (select coalesce(sum(v.total_cents), 0) from public.sales v where v.tenant_id = t.id and v.created_at > now() - interval '30 days'),
      'items', (select count(*) from public.items i where i.tenant_id = t.id and i.is_active)),
    'support', (select coalesce(jsonb_agg(jsonb_build_object('id', ss.id, 'reason', ss.reason, 'startedAt', ss.started_at, 'expiresAt', ss.expires_at,
                                                             'endedAt', ss.ended_at, 'mine', ss.admin_id = auth.uid()) order by ss.started_at desc), '[]')
                  from public.support_sessions ss where ss.tenant_id = t.id)
  ) from public.tenants t where t.id = p_tenant);
end $$;

-- Admin writes ------------------------------------------------------------------------------------------------------

-- p: {status?, planId?, trialEndsOn?, maxShops?, maxLanesPerShop?, transfers?, headOffice?, reason}
create or replace function api.admin_update_tenant(p_tenant uuid, p jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
begin
  perform app.require_platform_admin();
  if char_length(coalesce(p ->> 'reason', '')) < 3 then
    raise exception 'VALIDATION_ERROR: give a reason' using errcode = 'P0001';
  end if;
  if p ? 'planId' then
    select * into v_plan from public.plans where id = p ->> 'planId';
    if v_plan.id is null then
      raise exception 'NOT_FOUND: plan' using errcode = 'P0001';
    end if;
    update public.tenant_entitlements set max_shops = v_plan.max_shops, max_lanes_per_shop = v_plan.max_lanes_per_shop,
           head_office = v_plan.head_office, transfers = v_plan.transfers, updated_at = now() where tenant_id = p_tenant;
  end if;
  update public.tenants set
    status = coalesce((p ->> 'status')::public.tenant_status, status),
    plan_id = coalesce(p ->> 'planId', plan_id),
    trial_ends_on = case when p ? 'trialEndsOn' then (p ->> 'trialEndsOn')::date else trial_ends_on end,
    updated_at = now()
   where id = p_tenant;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  update public.tenant_entitlements set
    max_shops = coalesce((p ->> 'maxShops')::integer, max_shops),
    max_lanes_per_shop = coalesce((p ->> 'maxLanesPerShop')::integer, max_lanes_per_shop),
    transfers = coalesce((p ->> 'transfers')::boolean, transfers),
    head_office = coalesce((p ->> 'headOffice')::boolean, head_office),
    updated_at = now()
   where tenant_id = p_tenant;
  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, data)
  values (p_tenant, auth.uid(), 'platform.tenant_update', 'tenants', p_tenant, p);
end $$;

-- p: {id, name, priceCents, maxShops, maxLanesPerShop, maxStaff, perShop, headOffice, transfers, isCustom, isActive, description, sortOrder}
create or replace function api.admin_save_plan(p jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  insert into public.plans (id, name, price_cents, max_shops, max_lanes_per_shop, max_staff, per_shop, head_office, transfers, is_custom, is_active, description, sort_order)
  values (p ->> 'id', p ->> 'name', (p ->> 'priceCents')::bigint, (p ->> 'maxShops')::integer, (p ->> 'maxLanesPerShop')::integer,
          (p ->> 'maxStaff')::integer, coalesce((p ->> 'perShop')::boolean, false), coalesce((p ->> 'headOffice')::boolean, false),
          coalesce((p ->> 'transfers')::boolean, false), coalesce((p ->> 'isCustom')::boolean, false), coalesce((p ->> 'isActive')::boolean, true),
          p ->> 'description', coalesce((p ->> 'sortOrder')::integer, 9))
  on conflict (id) do update set name = excluded.name, price_cents = excluded.price_cents, max_shops = excluded.max_shops,
    max_lanes_per_shop = excluded.max_lanes_per_shop, max_staff = excluded.max_staff, per_shop = excluded.per_shop,
    head_office = excluded.head_office, transfers = excluded.transfers, is_custom = excluded.is_custom, is_active = excluded.is_active,
    description = excluded.description, sort_order = excluded.sort_order;
  insert into public.audit_log (tenant_id, actor_id, action, entity, data) values (null, auth.uid(), 'platform.plan_save', 'plans', p);
end $$;

-- Monthly SaaS invoices for every active tenant (and trials that have ended) for the month starting p_period.
create or replace function api.admin_generate_invoices(p_period date)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_period)::date;
  v_n     integer;
begin
  perform app.require_platform_admin();
  insert into public.saas_invoices (tenant_id, invoice_no, plan_id, period_start, period_end, amount_cents, due_on)
  select t.id, 'INV-' || to_char(v_start, 'YYMM') || '-' || lpad((row_number() over (order by t.created_at))::text, 3, '0'),
         t.plan_id, v_start, (v_start + interval '1 month' - interval '1 day')::date, app.tenant_mrr(t.id), v_start + 7
    from public.tenants t
   where t.status in ('active', 'past_due') or (t.status = 'trial' and t.trial_ends_on < v_start)
  on conflict (tenant_id, period_start) do nothing;
  get diagnostics v_n = row_count;
  insert into public.audit_log (tenant_id, actor_id, action, entity, data)
  values (null, auth.uid(), 'platform.invoices_generate', 'saas_invoices', jsonb_build_object('period', v_start, 'count', v_n));
  return v_n;
end $$;

create or replace function api.admin_set_invoice(p_invoice uuid, p_status text, p_reference text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  perform app.require_platform_admin();
  update public.saas_invoices set status = p_status::public.saas_invoice_status,
         paid_at = case when p_status = 'paid' then now() else null end, payhere_order_id = coalesce(nullif(p_reference, ''), payhere_order_id)
   where id = p_invoice returning tenant_id into v_tenant;
  if v_tenant is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  -- A tenant with nothing overdue any more is active again.
  if p_status = 'paid' and not exists (select 1 from public.saas_invoices i where i.tenant_id = v_tenant and i.status = 'open'
                                        and i.due_on < (now() at time zone 'Asia/Colombo')::date) then
    update public.tenants set status = 'active', updated_at = now() where id = v_tenant and status = 'past_due';
  end if;
  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, data)
  values (v_tenant, auth.uid(), 'platform.invoice_' || p_status, 'saas_invoices', p_invoice, jsonb_build_object('reference', p_reference));
end $$;

create or replace function api.admin_invoices(p_status text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'invoiceNo', i.invoice_no, 'tenantId', t.id, 'tenant', t.name, 'plan', i.plan_id,
                                                       'periodStart', i.period_start, 'amount', i.amount_cents, 'status', i.status, 'dueOn', i.due_on,
                                                       'paidAt', i.paid_at, 'reference', i.payhere_order_id) order by i.period_start desc, i.invoice_no)
                    from public.saas_invoices i join public.tenants t on t.id = i.tenant_id
                   where p_status is null or p_status = '' or i.status::text = p_status), '[]');
end $$;

-- Lanes seen in the last 15 minutes and sales in the last hour, per tenant (Figma 3-4387).
create or replace function api.admin_live()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  return jsonb_build_object(
    'tenants', (select coalesce(jsonb_agg(x order by (x ->> 'sales')::bigint desc), '[]') from (
                  select jsonb_build_object('id', t.id, 'name', t.name,
                    'lanesOnline', (select count(*) from public.lanes l where l.tenant_id = t.id and l.last_seen_at > now() - interval '15 minutes'),
                    'sales', (select count(*) from public.sales v where v.tenant_id = t.id and v.created_at > now() - interval '1 hour'),
                    'amount', (select coalesce(sum(v.total_cents), 0) from public.sales v where v.tenant_id = t.id and v.created_at > now() - interval '1 hour'),
                    'lastSale', (select max(v.created_at) from public.sales v where v.tenant_id = t.id)) as x
                    from public.tenants t where t.status <> 'cancelled') q),
    'perMinute', (select coalesce(jsonb_agg(jsonb_build_object('at', g, 'n',
                     (select count(*) from public.sales v where v.created_at >= g and v.created_at < g + interval '1 minute')) order by g), '[]')
                    from generate_series(date_trunc('minute', now()) - interval '59 minutes', date_trunc('minute', now()), interval '1 minute') g),
    'syncIssues', (select coalesce(jsonb_agg(jsonb_build_object('tenant', t.name, 'code', s.error_code, 'at', s.created_at) order by s.created_at desc), '[]')
                     from (select * from public.sync_issues s where s.status = 'open' order by s.created_at desc limit 20) s
                     join public.tenants t on t.id = s.tenant_id),
    'signIns', (select count(*) from auth.sessions s where s.created_at > now() - interval '1 hour')
  );
end $$;

create or replace function api.admin_audit(p_tenant uuid default null, p_action text default null, p_before timestamptz default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'at', a.created_at, 'tenant', t.name, 'tenantId', a.tenant_id, 'action', a.action,
                                                       'entity', a.entity, 'actor', u.email, 'data', a.data) order by a.created_at desc)
                    from (select * from public.audit_log a
                           where (p_tenant is null or a.tenant_id = p_tenant)
                             and (p_action is null or p_action = '' or a.action like p_action || '%')
                             and (p_before is null or a.created_at < p_before)
                           order by a.created_at desc limit 200) a
                    left join public.tenants t on t.id = a.tenant_id
                    left join auth.users u on u.id = a.actor_id), '[]');
end $$;

-- Platform security (Figma 3-4959): who the admins are, their 2FA, and platform-wide reset.
create or replace function api.admin_security()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  return jsonb_build_object(
    'admins', (select coalesce(jsonb_agg(jsonb_build_object('userId', a.user_id, 'email', u.email, 'since', a.created_at, 'lastSignIn', u.last_sign_in_at,
                 'twoFactor', exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified'), 'me', a.user_id = auth.uid())
                 order by a.created_at), '[]')
                 from public.platform_admins a join auth.users u on u.id = a.user_id),
    'lastPlatformReset', (select to_jsonb(r) from public.session_resets r where r.scope_type = 'platform'),
    'tenantsWithout2fa', (select count(distinct m.tenant_id) from public.members m join public.roles r on r.id = m.role_id and r.key = 'owner'
                           where m.is_active and m.user_id is not null
                             and not exists (select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified'))
  );
end $$;

create or replace function api.admin_add_admin(p_email text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  perform app.require_platform_admin();
  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'NOT_FOUND: no LaneOS login with that email' using errcode = 'P0001';
  end if;
  insert into public.platform_admins (user_id) values (v_user) on conflict do nothing;
  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id) values (null, auth.uid(), 'platform.admin_add', 'platform_admins', v_user);
end $$;

create or replace function api.admin_remove_admin(p_user uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  if p_user = auth.uid() then
    raise exception 'VALIDATION_ERROR: you cannot remove yourself' using errcode = 'P0001';
  end if;
  delete from public.platform_admins where user_id = p_user;
  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id) values (null, auth.uid(), 'platform.admin_remove', 'platform_admins', p_user);
end $$;

-- Signs every user of every tenant out (stolen key, incident). The caller is signed out too.
create or replace function api.admin_reset_platform(p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  if char_length(coalesce(p_reason, '')) < 5 then
    raise exception 'VALIDATION_ERROR: give a reason' using errcode = 'P0001';
  end if;
  insert into public.session_resets (scope_type, scope_id, tenant_id, reset_by, reason)
  values ('platform', '00000000-0000-0000-0000-000000000000', null, auth.uid(), p_reason)
  on conflict (scope_type, scope_id) do update set reset_at = now(), reset_by = excluded.reset_by, reason = excluded.reason;
  delete from auth.sessions where true;
  update public.lanes set active_member_id = null, active_since = null where active_member_id is not null;
  insert into public.audit_log (tenant_id, actor_id, action, entity, data) values (null, auth.uid(), 'platform.reset_all', 'auth.sessions', jsonb_build_object('reason', p_reason));
end $$;

create or replace function api.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_platform_admin();
$$;

-- Grants --------------------------------------------------------------------------------------------------------

revoke all on function api.create_ticket(text, text, text), api.ticket_reply(uuid, text, text), api.admin_start_support(uuid, text, integer, uuid),
  api.admin_end_support(uuid), api.admin_support_view(uuid), api.admin_overview(), api.admin_tenants(text, text), api.admin_tenant(uuid),
  api.admin_update_tenant(uuid, jsonb), api.admin_save_plan(jsonb), api.admin_generate_invoices(date), api.admin_set_invoice(uuid, text, text),
  api.admin_invoices(text), api.admin_live(), api.admin_audit(uuid, text, timestamptz), api.admin_security(), api.admin_add_admin(text),
  api.admin_remove_admin(uuid), api.admin_reset_platform(text), api.is_platform_admin()
  from public, anon;
grant execute on function api.create_ticket(text, text, text), api.ticket_reply(uuid, text, text), api.admin_start_support(uuid, text, integer, uuid),
  api.admin_end_support(uuid), api.admin_support_view(uuid), api.admin_overview(), api.admin_tenants(text, text), api.admin_tenant(uuid),
  api.admin_update_tenant(uuid, jsonb), api.admin_save_plan(jsonb), api.admin_generate_invoices(date), api.admin_set_invoice(uuid, text, text),
  api.admin_invoices(text), api.admin_live(), api.admin_audit(uuid, text, timestamptz), api.admin_security(), api.admin_add_admin(text),
  api.admin_remove_admin(uuid), api.admin_reset_platform(text), api.is_platform_admin()
  to authenticated, service_role;
revoke all on function app.require_platform_admin(), app.support_session_ok(uuid), app.tenant_mrr(uuid) from public, anon;
grant execute on function app.require_platform_admin(), app.support_session_ok(uuid), app.tenant_mrr(uuid) to authenticated, service_role;
