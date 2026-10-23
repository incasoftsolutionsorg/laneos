-- Settings, people and billing (Figma 1-3034, 1-3237, 1-3518, 1-3701, 1-3902, 1-4145, 11-4771, 1-90; blueprint §27.5–27.6):
--   tenant settings (general, branding, tax, receipt, security), effective-dated tax rates, price-list rules,
--   staff codes and per-member permission overrides, staff invites, session list / end / reset access,
--   customer credit (on-account sales, customer ledger, payments), SaaS plans as designed, SaaS invoices.

-- Tenant settings --------------------------------------------------------------------------------------

alter table public.tenants
  add column business_reg_no       text check (char_length(business_reg_no) <= 40),
  add column city                  text check (char_length(city) <= 60),
  add column business_type         text check (business_type in ('grocery', 'supermarket', 'pharmacy', 'hardware', 'other')),
  add column brand_color           text not null default '#0E7C66' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column theme                 text not null default 'default' check (theme in ('default', 'christmas', 'awurudu', 'vesak', 'deepavali', 'ramadan')),
  add column auto_seasonal_theme   boolean not null default false,
  add column vat_registered        boolean not null default false,
  add column vat_no                text check (char_length(vat_no) <= 30),
  add column prices_include_vat    boolean not null default true,
  add column receipt_paper         text not null default '80mm' check (receipt_paper in ('80mm', '58mm', 'a4')),
  add column receipt_header        text check (char_length(receipt_header) <= 120),
  add column receipt_footer        text not null default 'Thank you! Returns within 7 days with receipt.' check (char_length(receipt_footer) <= 200),
  add column receipt_print_logo    boolean not null default true,
  add column receipt_silent        boolean not null default false,
  add column receipt_open_drawer   boolean not null default true,
  add column receipt_local_language boolean not null default false,
  add column require_2fa           text not null default 'owners' check (require_2fa in ('owners', 'managers', 'all')),
  add column strict_sessions       boolean not null default false,
  add column idle_timeout_min      integer not null default 30 check (idle_timeout_min between 10 and 120),
  add column lane_lock_min         integer not null default 3 check (lane_lock_min between 1 and 15),
  add column failed_login_limit    integer not null default 5 check (failed_login_limit between 3 and 10),
  add column failed_login_lock_min integer not null default 15 check (failed_login_lock_min between 5 and 60),
  add column pin_length_min        integer not null default 4 check (pin_length_min between 4 and 6),
  add column pin_change_days       integer check (pin_change_days between 30 and 180),
  add column credit_note_cash_out  boolean not null default false,
  add column export_owner_only     boolean not null default true,
  add column login_alerts          boolean not null default true,
  add column customer_credit_days  integer not null default 30 check (customer_credit_days between 0 and 180),
  add column trial_ends_on         date,
  add column next_charge_on        date;

alter table public.lanes add column printer_name text check (char_length(printer_name) <= 60);
grant select (printer_name) on public.lanes to authenticated;
grant update (printer_name) on public.lanes to authenticated;

-- Tenant settings are written only through api.update_tenant_settings (validated + audited).
revoke update on public.tenants from authenticated;

-- One whitelist-driven update for every settings tab. p: {key: value, ...} of tenant columns.
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
    'failed_login_lock_min', 'pin_length_min', 'pin_change_days', 'credit_note_cash_out', 'export_owner_only', 'login_alerts'];
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

-- Effective-dated tax rates (BR-060) -------------------------------------------------------------------

create table public.tax_rates (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants (id),
  tax_class      public.tax_class not null,
  rate_bp        integer not null check (rate_bp between 0 and 10000),
  effective_from date not null,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  unique (tenant_id, tax_class, effective_from)
);
alter table public.tax_rates enable row level security;
alter table public.tax_rates force row level security;
create policy tax_rates_read on public.tax_rates for select to authenticated using (tenant_id = (select app.tenant_id()));
revoke all on public.tax_rates from anon;
revoke insert, update, delete, truncate on public.tax_rates from authenticated;

insert into public.tax_rates (tenant_id, tax_class, rate_bp, effective_from)
select t.id, c.cls, c.rate, date '2024-01-01'
  from public.tenants t
 cross join (values ('standard'::public.tax_class, 1800), ('exempt'::public.tax_class, 0), ('zero'::public.tax_class, 0)) c(cls, rate);

create or replace function app.default_tax_rates()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.tax_rates (tenant_id, tax_class, rate_bp, effective_from)
  values (new.id, 'standard', 1800, current_date), (new.id, 'exempt', 0, current_date), (new.id, 'zero', 0, current_date);
  return null;
end $$;
create trigger tenants_default_tax after insert on public.tenants for each row execute function app.default_tax_rates();

create or replace function api.set_tax_rate(p_class text, p_rate_bp integer, p_from date)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('settings.manage');
  insert into public.tax_rates (tenant_id, tax_class, rate_bp, effective_from, created_by)
  values (app.tenant_id(), p_class::public.tax_class, p_rate_bp, p_from, auth.uid())
  on conflict (tenant_id, tax_class, effective_from) do update set rate_bp = excluded.rate_bp;
  perform app.audit('tax.rate', 'tax_rates', null, jsonb_build_object('class', p_class, 'rate', p_rate_bp, 'from', p_from));
end $$;

-- Price-list rules (Figma 1-3902 "Price rates"): a list can be "list price − x %" for a group of buyers.
alter table public.price_lists
  add column discount_bp integer not null default 0 check (discount_bp between 0 and 9000),
  add column applies_to  text check (char_length(applies_to) <= 60);

create or replace function api.save_price_rule(p_id uuid, p_name text, p_discount_bp integer, p_applies_to text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  perform app.require_perm('settings.manage');
  if v_id is null then
    insert into public.price_lists (tenant_id, name, discount_bp, applies_to) values (app.tenant_id(), p_name, p_discount_bp, p_applies_to)
    returning id into v_id;
  else
    update public.price_lists set name = p_name, discount_bp = p_discount_bp, applies_to = p_applies_to
     where id = v_id and tenant_id = app.tenant_id() and not is_default;
    if not found then
      raise exception 'NOT_FOUND: the default list cannot be changed here' using errcode = 'P0001';
    end if;
  end if;
  return v_id;
end $$;

-- People: staff codes, permission overrides, invites ----------------------------------------------------------

alter table public.members
  add column staff_code   text check (staff_code ~ '^[A-Z0-9]{2,8}$'),
  add column perms_add    bigint not null default 0 check (perms_add >= 0),
  add column perms_remove bigint not null default 0 check (perms_remove >= 0),
  add column invite_email text check (char_length(invite_email) <= 254),
  add column language     text not null default 'en' check (language in ('en', 'si', 'ta'));
create unique index members_tenant_code on public.members (tenant_id, staff_code) where staff_code is not null;
create unique index members_tenant_invite on public.members (tenant_id, lower(invite_email)) where invite_email is not null and user_id is null;
grant select (staff_code, perms_add, perms_remove, invite_email, language) on public.members to authenticated;

alter table public.plans
  add column description text,
  add column per_shop    boolean not null default false,
  add column is_custom   boolean not null default false,
  add column max_staff   integer not null default 10 check (max_staff >= 1),
  add column sort_order  integer not null default 0;

-- Plans as designed (Figma 1-90, 11-4771). Existing ids are kept so tenants keep their plan.
insert into public.plans (id, name, max_shops, max_lanes_per_shop, head_office, transfers, price_cents, description, max_staff, sort_order)
values ('lite', 'Kade Lite', 1, 1, false, false, 290000, '1 shop · 1 lane', 3, 1);
update public.plans set name = 'Store Pro', max_lanes_per_shop = 4, price_cents = 540000, description = '1 shop · up to 4 lanes · promotions', max_staff = 10, sort_order = 2 where id = 'single';
update public.plans set name = 'Multi-store', max_shops = 5, max_lanes_per_shop = 4, price_cents = 490000, per_shop = true, transfers = true, description = 'Up to 5 shops · transfers', max_staff = 40, sort_order = 3 where id = 'growth';
update public.plans set name = 'Chain', price_cents = 0, is_custom = true, description = 'Head office, API, custom domain', max_staff = 500, sort_order = 4 where id = 'chain';
update public.tenant_entitlements e set max_lanes_per_shop = p.max_lanes_per_shop, max_shops = p.max_shops
  from public.tenants t join public.plans p on p.id = t.plan_id where e.tenant_id = t.id;

-- Effective permissions: role, plus member grants, minus member removals.
create or replace function app.permissions()
returns bigint
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (app.jwt() ->> 'perms')::bigint,
    (select (r.permissions | m.perms_add) & ~m.perms_remove
       from public.roles r join public.members m on m.role_id = r.id
      where m.id = (app.member()).id),
    0);
$$;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_member public.members;
  v_role   public.roles;
  v_shops  uuid[];
begin
  select m.* into v_member from public.members m
   where m.user_id = (event ->> 'user_id')::uuid and m.is_active
   order by m.created_at limit 1;

  if v_member.id is not null then
    select r.* into v_role from public.roles r where r.id = v_member.role_id;
    if v_member.all_shops then
      select coalesce(array_agg(s.id), '{}') into v_shops from public.shops s where s.tenant_id = v_member.tenant_id;
    else
      select coalesce(array_agg(ms.shop_id), '{}') into v_shops from public.member_shops ms where ms.member_id = v_member.id;
    end if;
    v_claims := (v_claims - 'app_role')
      || jsonb_build_object(
           'tenant_id', v_member.tenant_id,
           'member_id', v_member.id,
           'app_role', v_role.key,
           'perms', (v_role.permissions | v_member.perms_add) & ~v_member.perms_remove,
           'shop_ids', to_jsonb(v_shops),
           'perm_v', v_member.perm_v);
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end $$;
revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Ends every session of the given auth users and writes reset markers (blueprint §27.5.5).
create or replace function app.end_sessions(p_users uuid[], p_scope public.reset_scope, p_scope_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.session_resets (scope_type, scope_id, tenant_id, reset_by, reason)
  values (p_scope, p_scope_id, app.tenant_id(), coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'), p_reason)
  on conflict (scope_type, scope_id) do update set reset_at = now(), reset_by = excluded.reset_by, reason = excluded.reason;
  delete from auth.sessions s where s.user_id = any (p_users);
end $$;

-- p: {name, roleId, allShops, shopIds[], staffCode?, pin?, phone?, inviteEmail?, permsAdd?, permsRemove?}
create or replace function api.add_member(p jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_id     uuid;
  v_max    integer;
  v_count  integer;
  v_role   public.roles;
begin
  perform app.require_perm('staff.manage');
  select r.* into v_role from public.roles r where r.id = (p ->> 'roleId')::uuid and r.tenant_id = v_tenant;
  if v_role.id is null then
    raise exception 'NOT_FOUND: role' using errcode = 'P0001';
  end if;
  if v_role.key = 'owner' and not app.has_perm('settings.manage') then
    raise exception 'FORBIDDEN: only an owner can add an owner' using errcode = 'P0001';
  end if;
  select pl.max_staff into v_max from public.tenants t join public.plans pl on pl.id = t.plan_id where t.id = v_tenant;
  select count(*) into v_count from public.members m where m.tenant_id = v_tenant and m.is_active;
  if v_count >= v_max then
    raise exception 'PLAN_LIMIT: % staff on this plan', v_max using errcode = 'P0001';
  end if;
  insert into public.members (tenant_id, role_id, display_name, phone, all_shops, staff_code, invite_email, perms_add, perms_remove, created_by)
  values (v_tenant, v_role.id, trim(p ->> 'name'), nullif(p ->> 'phone', ''), coalesce((p ->> 'allShops')::boolean, false),
          upper(nullif(p ->> 'staffCode', '')), lower(nullif(p ->> 'inviteEmail', '')),
          coalesce((p ->> 'permsAdd')::bigint, 0), coalesce((p ->> 'permsRemove')::bigint, 0), auth.uid())
  returning id into v_id;
  insert into public.member_shops (member_id, shop_id, tenant_id)
  select v_id, s.id, v_tenant from public.shops s
   where s.tenant_id = v_tenant and s.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p -> 'shopIds', '[]')) x);
  if nullif(p ->> 'pin', '') is not null then
    perform api.set_pin(v_id, p ->> 'pin');
  end if;
  perform app.audit('member.add', 'members', v_id, jsonb_build_object('role', v_role.key));
  return v_id;
end $$;

-- p: {id, name?, roleId?, allShops?, shopIds?, staffCode?, phone?, isActive?, permsAdd?, permsRemove?}
-- Any change to role, shops, permissions or active ends the member's sessions (BR-090).
create or replace function api.update_member(p jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_m      public.members;
  v_access boolean;
begin
  perform app.require_perm('staff.manage');
  select * into v_m from public.members m where m.id = (p ->> 'id')::uuid and m.tenant_id = v_tenant for update;
  if v_m.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if (select r.key from public.roles r where r.id = coalesce((p ->> 'roleId')::uuid, v_m.role_id)) = 'owner'
     and not app.has_perm('settings.manage') then
    raise exception 'FORBIDDEN: only an owner can change an owner' using errcode = 'P0001';
  end if;
  if v_m.id = app.member_id() and ((p ->> 'isActive') = 'false' or (p ? 'roleId' and (p ->> 'roleId')::uuid <> v_m.role_id)) then
    raise exception 'VALIDATION_ERROR: you cannot change your own role or deactivate yourself' using errcode = 'P0001';
  end if;
  v_access := (p ? 'roleId' and (p ->> 'roleId')::uuid <> v_m.role_id) or p ? 'shopIds' or p ? 'allShops' or p ? 'isActive'
           or p ? 'permsAdd' or p ? 'permsRemove';
  update public.members set
    display_name = coalesce(nullif(trim(p ->> 'name'), ''), display_name),
    role_id = coalesce((p ->> 'roleId')::uuid, role_id),
    all_shops = coalesce((p ->> 'allShops')::boolean, all_shops),
    staff_code = case when p ? 'staffCode' then upper(nullif(p ->> 'staffCode', '')) else staff_code end,
    phone = case when p ? 'phone' then nullif(p ->> 'phone', '') else phone end,
    is_active = coalesce((p ->> 'isActive')::boolean, is_active),
    perms_add = coalesce((p ->> 'permsAdd')::bigint, perms_add),
    perms_remove = coalesce((p ->> 'permsRemove')::bigint, perms_remove),
    pin_hash = case when (p ->> 'isActive') = 'false' then null else pin_hash end,
    perm_v = perm_v + case when v_access then 1 else 0 end
   where id = v_m.id;
  if p ? 'shopIds' then
    delete from public.member_shops where member_id = v_m.id;
    insert into public.member_shops (member_id, shop_id, tenant_id)
    select v_m.id, s.id, v_tenant from public.shops s
     where s.tenant_id = v_tenant and s.id in (select (x #>> '{}')::uuid from jsonb_array_elements(p -> 'shopIds') x);
  end if;
  if v_access and v_m.user_id is not null then
    perform app.end_sessions(array[v_m.user_id], 'user', v_m.user_id, 'Access changed');
  end if;
  perform app.audit('member.update', 'members', v_m.id, p - 'pin');
end $$;

-- Links an invited email to the signed-in user (first login after the invite email).
create or replace function api.claim_invite()
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.members m set user_id = auth.uid(), invite_email = null
   where m.user_id is null and m.is_active and lower(m.invite_email) = lower((select u.email from auth.users u where u.id = auth.uid()))
     and not exists (select 1 from public.members x where x.user_id = auth.uid() and x.is_active)
  returning m.id into v_id;
  return v_id;
end $$;

-- Sessions (Figma 1-3518, blueprint §27.5.7) -------------------------------------------------------------

create or replace function app.can_see_user(p_user uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_user = auth.uid()
      or (app.has_perm('staff.manage') and exists (select 1 from public.members m where m.user_id = p_user and m.tenant_id = app.tenant_id()));
$$;

create or replace function api.list_sessions(p_user uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
begin
  if not app.can_see_user(v_user) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'createdAt', s.created_at, 'lastActive', coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
             'userAgent', s.user_agent, 'current', s.id::text = app.jwt() ->> 'session_id', 'aal', s.aal)
             order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc)
      from auth.sessions s where s.user_id = v_user), '[]'::jsonb);
end $$;

create or replace function api.end_session(p_session uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select s.user_id into v_user from auth.sessions s where s.id = p_session;
  if v_user is null or not app.can_see_user(v_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  delete from auth.sessions where id = p_session;
  perform app.audit('session.end', 'auth.sessions', p_session);
end $$;

-- Reset access (blueprint §27.5.4): one user, one lane, one shop or the whole tenant.
create or replace function api.reset_access(p_scope text, p_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_users  uuid[];
begin
  if char_length(coalesce(p_reason, '')) < 3 then
    raise exception 'VALIDATION_ERROR: give a reason' using errcode = 'P0001';
  end if;
  if p_scope = 'user' then
    perform app.require_perm('staff.manage');
    if not app.can_see_user(p_id) then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    v_users := array[p_id];
  elsif p_scope = 'lane' then
    perform app.require_perm('staff.manage');
    if not exists (select 1 from public.lanes l where l.id = p_id and l.tenant_id = v_tenant and app.can_shop(l.shop_id)) then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    update public.lanes set active_member_id = null, active_since = null where id = p_id;
    v_users := '{}';
  elsif p_scope = 'shop' then
    perform app.require_perm('settings.manage');
    select array_agg(m.user_id) into v_users from public.members m
     where m.tenant_id = v_tenant and m.user_id is not null
       and (m.all_shops is false and exists (select 1 from public.member_shops ms where ms.member_id = m.id and ms.shop_id = p_id));
    update public.lanes set active_member_id = null, active_since = null where shop_id = p_id and tenant_id = v_tenant;
  elsif p_scope = 'tenant' then
    perform app.require_perm('settings.manage');
    p_id := v_tenant;
    select array_agg(m.user_id) into v_users from public.members m where m.tenant_id = v_tenant and m.user_id is not null;
    update public.lanes set active_member_id = null, active_since = null where tenant_id = v_tenant;
  else
    raise exception 'VALIDATION_ERROR: scope must be user, lane, shop or tenant' using errcode = 'P0001';
  end if;
  perform app.end_sessions(coalesce(v_users, '{}'), p_scope::public.reset_scope, p_id, p_reason);
  perform app.audit('security.reset_access', p_scope, p_id, jsonb_build_object('reason', p_reason));
end $$;

-- Reset markers the proxy compares with a token's issue time (cached there for 30 s).
create or replace function api.reset_marker()
returns timestamptz
language sql stable security definer
set search_path = ''
as $$
  select max(r.reset_at) from public.session_resets r
   where (r.scope_type = 'user' and r.scope_id = auth.uid())
      or (r.scope_type = 'tenant' and r.scope_id = app.tenant_id())
      or (r.scope_type = 'shop' and r.scope_id = any (app.shop_ids()))
      or r.scope_type = 'platform';
$$;

-- Last activity and 2FA per member (Users & roles table).
create or replace function api.member_status()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(m.id, jsonb_build_object(
           'twoFactor', exists (select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified'),
           'lastActive', (select max(coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at)) from auth.sessions s where s.user_id = m.user_id))),
         '{}'::jsonb)
    from public.members m
   where m.tenant_id = app.tenant_id() and app.has_perm('staff.manage');
$$;

-- Customer credit (BR-041, Figma 1-3034) -------------------------------------------------------------------

alter type public.payment_method add value if not exists 'account';

create type public.customer_ledger_kind as enum ('sale', 'payment', 'return', 'adjustment');

create table public.customer_ledger (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants (id),
  customer_id  uuid not null references public.customers (id),
  kind         public.customer_ledger_kind not null,
  ref_id       uuid,
  amount_cents bigint not null check (amount_cents <> 0),   -- + customer owes more, − paid / credited
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid
);
create index customer_ledger_customer on public.customer_ledger (customer_id, created_at desc);
create trigger customer_ledger_append_only before update or delete on public.customer_ledger
  for each row execute function app.append_only();
alter table public.customer_ledger enable row level security;
alter table public.customer_ledger force row level security;
create policy customer_ledger_read on public.customer_ledger for select to authenticated using (tenant_id = (select app.tenant_id()));
revoke all on public.customer_ledger from anon;
revoke insert, update, delete, truncate on public.customer_ledger from authenticated;

-- Existing balances become opening ledger rows so ledger = balance from now on.
insert into public.customer_ledger (tenant_id, customer_id, kind, amount_cents, note)
select c.tenant_id, c.id, 'adjustment', c.balance_due_cents, 'Opening balance' from public.customers c where c.balance_due_cents <> 0;

create or replace function app.customer_post(p_tenant uuid, p_customer uuid, p_kind public.customer_ledger_kind, p_ref uuid, p_amount bigint, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.customer_ledger (tenant_id, customer_id, kind, ref_id, amount_cents, note, created_by)
  values (p_tenant, p_customer, p_kind, p_ref, p_amount, p_note, auth.uid());
  update public.customers set balance_due_cents = balance_due_cents + p_amount where id = p_customer;
end $$;

create or replace function api.receive_customer_payment(p_customer uuid, p_amount_cents bigint, p_method text, p_reference text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('customer.manage');
  if p_amount_cents <= 0 or p_method not in ('cash', 'bank', 'cheque') then
    raise exception 'VALIDATION_ERROR: amount and method (cash, bank, cheque)' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer and c.tenant_id = app.tenant_id()) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.customer_post(app.tenant_id(), p_customer, 'payment', null, -p_amount_cents, p_method || coalesce(' ' || p_reference, ''));
  perform app.audit('customer.payment', 'customers', p_customer, jsonb_build_object('amount', p_amount_cents, 'method', p_method));
end $$;

-- Per customer: balance, limit, and the oldest unpaid on-account bill (payments settle the oldest first).
create or replace function api.customer_credit()
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with acct as (
    select l.customer_id, l.created_at, l.amount_cents,
           sum(l.amount_cents) over (partition by l.customer_id order by l.created_at desc rows between unbounded preceding and current row) as newer_incl
      from public.customer_ledger l where l.amount_cents > 0
  )
  select coalesce(jsonb_object_agg(c.id, jsonb_build_object(
           'oldestUnpaid', (select min(a.created_at) from acct a where a.customer_id = c.id and a.newer_incl - a.amount_cents < c.balance_due_cents))), '{}')
    from public.customers c
   where c.tenant_id = app.tenant_id() and c.balance_due_cents > 0;
$$;

-- api.create_sale v4: adds on-account payments (method 'account') for named customers within limit.
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

-- Customer returns settled to the credit balance now go through the ledger.
create or replace function app.customer_return_credit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.settlement = 'credit_balance' and new.customer_id is not null then
    -- process_return already lowered customers.balance_due_cents; record the ledger row only.
    insert into public.customer_ledger (tenant_id, customer_id, kind, ref_id, amount_cents, note, created_by)
    values (new.tenant_id, new.customer_id, 'return', new.id, -new.total_cents, new.return_no, new.created_by);
  end if;
  return null;
end $$;
create trigger returns_customer_ledger after insert on public.returns for each row execute function app.customer_return_credit();

-- SaaS billing (Figma 11-4771) ---------------------------------------------------------------------------

create type public.saas_invoice_status as enum ('open', 'paid', 'void');

create table public.saas_invoices (
  id               uuid primary key default app.uuid_v7(),
  tenant_id        uuid not null references public.tenants (id),
  invoice_no       text not null unique,
  plan_id          text not null references public.plans (id),
  period_start     date not null,
  period_end       date not null,
  amount_cents     bigint not null check (amount_cents >= 0),
  status           public.saas_invoice_status not null default 'open',
  due_on           date not null,
  paid_at          timestamptz,
  payhere_order_id text,
  created_at       timestamptz not null default now(),
  unique (tenant_id, period_start)
);
alter table public.saas_invoices enable row level security;
alter table public.saas_invoices force row level security;
create policy saas_invoices_read on public.saas_invoices for select to authenticated
  using (tenant_id = (select app.tenant_id()) or (select app.is_platform_admin()));
revoke all on public.saas_invoices from anon;
revoke insert, update, delete, truncate on public.saas_invoices from authenticated;

-- Owner changes the plan; refused if the business already uses more than the new plan allows.
create or replace function api.change_plan(p_plan text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_plan   public.plans;
begin
  perform app.require_perm('settings.manage');
  select * into v_plan from public.plans where id = p_plan and is_active and not is_custom;
  if v_plan.id is null then
    raise exception 'VALIDATION_ERROR: choose a listed plan (Chain is arranged with LaneOS)' using errcode = 'P0001';
  end if;
  if (select count(*) from public.shops s where s.tenant_id = v_tenant and s.is_active) > v_plan.max_shops
     or exists (select 1 from public.lanes l where l.tenant_id = v_tenant group by l.shop_id having count(*) > v_plan.max_lanes_per_shop)
     or (select count(*) from public.members m where m.tenant_id = v_tenant and m.is_active) > v_plan.max_staff then
    raise exception 'PLAN_LIMIT: you use more shops, lanes or staff than % allows', v_plan.name using errcode = 'P0001';
  end if;
  update public.tenants set plan_id = v_plan.id where id = v_tenant;
  update public.tenant_entitlements set max_shops = v_plan.max_shops, max_lanes_per_shop = v_plan.max_lanes_per_shop,
         head_office = v_plan.head_office, transfers = v_plan.transfers, updated_at = now()
   where tenant_id = v_tenant;
  perform app.audit('plan.change', 'tenants', v_tenant, jsonb_build_object('plan', v_plan.id));
end $$;

-- api.create_tenant v2: business details from the sign-up form (Figma 1-90), trial dates, staff code for the owner.
create or replace function api.create_tenant(
  p_name text, p_slug text, p_shop_code text, p_shop_name text, p_owner_name text, p_plan text default 'single',
  p_details jsonb default '{}'
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_plan   public.plans;
  v_tenant uuid;
  v_shop   uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.members m where m.user_id = v_uid and m.is_active) then
    raise exception 'VALIDATION_ERROR: this account already belongs to a business' using errcode = 'P0001';
  end if;
  select * into v_plan from public.plans where id = p_plan and is_active and not is_custom;
  if v_plan.id is null then
    raise exception 'VALIDATION_ERROR: unknown plan' using errcode = 'P0001';
  end if;

  insert into public.tenants (name, slug, plan_id, created_by, business_reg_no, city, business_type, trial_ends_on, next_charge_on)
  values (p_name, p_slug, v_plan.id, v_uid, nullif(p_details ->> 'businessRegNo', ''), nullif(p_details ->> 'city', ''),
          nullif(p_details ->> 'businessType', ''), current_date + 14, current_date + 14)
  returning id into v_tenant;

  insert into public.tenant_entitlements (tenant_id, max_shops, max_lanes_per_shop, head_office, transfers)
  values (v_tenant, v_plan.max_shops, v_plan.max_lanes_per_shop, v_plan.head_office, v_plan.transfers);

  insert into public.roles (tenant_id, key, name, permissions, is_system) values
    (v_tenant, 'owner', 'Owner', 16383, true),
    (v_tenant, 'manager', 'Store manager', 14079, true),
    (v_tenant, 'cashier', 'Cashier', 3, true),
    (v_tenant, 'stock_keeper', 'Stock keeper', 24, true),
    (v_tenant, 'accountant', 'Accountant', 8320, true);

  insert into public.shops (tenant_id, code, name, phone, created_by)
  values (v_tenant, upper(p_shop_code), p_shop_name, nullif(p_details ->> 'shopPhone', ''), v_uid) returning id into v_shop;

  insert into public.members (tenant_id, user_id, role_id, display_name, phone, all_shops, created_by)
  select v_tenant, v_uid, r.id, p_owner_name, nullif(p_details ->> 'mobile', ''), true, v_uid
    from public.roles r where r.tenant_id = v_tenant and r.key = 'owner';

  insert into public.lanes (tenant_id, shop_id, code, name, created_by)
  values (v_tenant, v_shop, 'L1', 'Lane 1', v_uid);

  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, data)
  values (v_tenant, v_uid, 'tenant.create', 'tenants', v_tenant, jsonb_build_object('plan', v_plan.id));
  return v_tenant;
end $$;
drop function if exists api.create_tenant(text, text, text, text, text, text);

-- Grants --------------------------------------------------------------------------------------------------

revoke all on function api.update_tenant_settings(jsonb), api.set_tax_rate(text, integer, date),
  api.save_price_rule(uuid, text, integer, text), api.add_member(jsonb), api.update_member(jsonb), api.claim_invite(),
  api.list_sessions(uuid), api.end_session(uuid), api.reset_access(text, uuid, text), api.reset_marker(), api.member_status(),
  api.receive_customer_payment(uuid, bigint, text, text), api.customer_credit(), api.create_sale(jsonb),
  api.change_plan(text), api.create_tenant(text, text, text, text, text, text, jsonb)
  from public, anon;
grant execute on function api.update_tenant_settings(jsonb), api.set_tax_rate(text, integer, date),
  api.save_price_rule(uuid, text, integer, text), api.add_member(jsonb), api.update_member(jsonb), api.claim_invite(),
  api.list_sessions(uuid), api.end_session(uuid), api.reset_access(text, uuid, text), api.reset_marker(), api.member_status(),
  api.receive_customer_payment(uuid, bigint, text, text), api.customer_credit(), api.create_sale(jsonb),
  api.change_plan(text), api.create_tenant(text, text, text, text, text, text, jsonb)
  to authenticated, service_role;
grant execute on function app.permissions() to authenticated, service_role;
