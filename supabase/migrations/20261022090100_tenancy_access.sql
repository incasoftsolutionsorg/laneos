-- Tenancy and access: plans, tenants, shops, lanes, roles, members, session resets, audit log,
-- RLS helper functions, the custom access token hook and tenant onboarding (WF-001).

-- Platform level ---------------------------------------------------------------------------

create table public.plans (
  id                 text primary key check (id ~ '^[a-z_]{2,30}$'),
  name               text not null,
  max_shops          integer not null check (max_shops >= 1),
  max_lanes_per_shop integer not null check (max_lanes_per_shop >= 1),
  head_office        boolean not null default false,
  transfers          boolean not null default false,
  price_cents        bigint not null check (price_cents >= 0),
  is_active          boolean not null default true
);

insert into public.plans (id, name, max_shops, max_lanes_per_shop, head_office, transfers, price_cents) values
  ('single', 'Single shop', 1, 3, false, false, 450000),
  ('growth', 'Growth', 3, 6, false, true, 1200000),
  ('chain', 'Chain', 30, 12, true, true, 4500000);

-- Permission bits. Must match packages/core/src/permissions.ts (checked by a unit test).
create table public.permissions (
  key         text primary key,
  bit         bigint not null unique,
  description text not null
);

insert into public.permissions (key, bit, description) values
  ('sale.create',      1,    'Sell on a lane'),
  ('return.create',    2,    'Process returns and refunds'),
  ('item.edit',        4,    'Create and edit items, barcodes and prices'),
  ('stock.adjust',     8,    'Adjust stock, wastage and counts'),
  ('grn.post',         16,   'Receive goods (GRN)'),
  ('promotion.manage', 32,   'Create and edit promotions'),
  ('staff.manage',     64,   'Manage staff, roles and lanes'),
  ('reports.view',     128,  'View reports and dashboards'),
  ('settings.manage',  256,  'Change shop and security settings'),
  ('cash.pickup',      512,  'Cash pickups and drawer actions'),
  ('shift.manage',     1024, 'Open and close shifts'),
  ('transfer.approve', 2048, 'Approve stock transfers'),
  ('customer.manage',  4096, 'Manage customers and credit'),
  ('supplier.manage',  8192, 'Manage suppliers and payments');

create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Tenant level -----------------------------------------------------------------------------

create table public.tenants (
  id                    uuid primary key default app.uuid_v7(),
  name                  text not null check (char_length(name) between 2 and 120),
  slug                  text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  status                public.tenant_status not null default 'trial',
  plan_id               text not null references public.plans (id),
  rounding_unit_cents   integer not null default 100 check (rounding_unit_cents in (1, 10, 50, 100, 500, 1000)),
  embedded_barcode_mode text not null default 'weight' check (embedded_barcode_mode in ('weight', 'price')),
  catalog_version       bigint not null default 0,
  timezone              text not null default 'Asia/Colombo',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id)
);

create table public.tenant_entitlements (
  tenant_id          uuid primary key references public.tenants (id) on delete cascade,
  max_shops          integer not null check (max_shops >= 1),
  max_lanes_per_shop integer not null check (max_lanes_per_shop >= 1),
  head_office        boolean not null default false,
  transfers          boolean not null default false,
  updated_at         timestamptz not null default now()
);

create table public.shops (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null references public.tenants (id),
  code       text not null check (code ~ '^[A-Z0-9]{2,8}$'),
  name       text not null check (char_length(name) between 2 and 120),
  address    text check (char_length(address) <= 300),
  phone      text check (phone ~ '^\+94\d{9}$'),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (tenant_id, code)
);

-- A lane is one checkout terminal (a registered browser on a PC or tablet).
create table public.lanes (
  id            uuid primary key default app.uuid_v7(),
  tenant_id     uuid not null references public.tenants (id),
  shop_id       uuid not null references public.shops (id),
  code          text not null check (code ~ '^L[0-9]{1,2}$'),
  name          text not null check (char_length(name) between 1 and 60),
  status        public.lane_status not null default 'active',
  key_hash      text,                      -- hash of the device binding key; the key itself is never stored
  registered_at timestamptz,
  last_seen_at  timestamptz,
  invoice_seq   bigint not null default 0, -- invoice numbers are per lane (BR-003)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id),
  unique (shop_id, code)
);
create index lanes_tenant on public.lanes (tenant_id);

create table public.roles (
  id          uuid primary key default app.uuid_v7(),
  tenant_id   uuid not null references public.tenants (id),
  key         text not null check (key ~ '^[a-z_]{2,30}$'),
  name        text not null,
  permissions bigint not null default 0 check (permissions >= 0),
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, key)
);

-- A member is a person working for a tenant. Cashiers who only use a PIN have no auth user yet.
create table public.members (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants (id),
  user_id      uuid references auth.users (id) on delete set null,
  role_id      uuid not null references public.roles (id),
  display_name text not null check (char_length(display_name) between 1 and 80),
  phone        text check (phone ~ '^\+947\d{8}$'),
  all_shops    boolean not null default false,
  pin_hash     text,                       -- Argon2id hash; never the PIN
  perm_v       integer not null default 1, -- bumped on role or shop change to revoke old tokens
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id),
  unique (tenant_id, user_id)
);
create index members_user on public.members (user_id) where is_active;

create table public.member_shops (
  member_id uuid not null references public.members (id) on delete cascade,
  shop_id   uuid not null references public.shops (id),
  tenant_id uuid not null references public.tenants (id),
  primary key (member_id, shop_id)
);

-- Reset markers (blueprint §27.5.5): tokens issued before reset_at are refused.
create table public.session_resets (
  scope_type public.reset_scope not null,
  scope_id   uuid not null,
  tenant_id  uuid references public.tenants (id),
  reset_at   timestamptz not null default now(),
  reset_by   uuid not null,
  reason     text not null check (char_length(reason) between 3 and 200),
  primary key (scope_type, scope_id)
);

create table public.audit_log (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid references public.tenants (id),
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  data       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_tenant_time on public.audit_log (tenant_id, created_at desc);

-- Triggers -----------------------------------------------------------------------------------

create trigger tenants_touch before update on public.tenants for each row execute function app.touch_updated_at();
create trigger shops_touch before update on public.shops for each row execute function app.touch_updated_at();
create trigger lanes_touch before update on public.lanes for each row execute function app.touch_updated_at();
create trigger roles_touch before update on public.roles for each row execute function app.touch_updated_at();
create trigger members_touch before update on public.members for each row execute function app.touch_updated_at();
create trigger shops_keys before update on public.shops for each row execute function app.protect_keys();
create trigger lanes_keys before update on public.lanes for each row execute function app.protect_keys();
create trigger roles_keys before update on public.roles for each row execute function app.protect_keys();
create trigger members_keys before update on public.members for each row execute function app.protect_keys();
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function app.append_only();

-- RLS helpers ----------------------------------------------------------------------------------
-- They read the claims added by the access token hook and fall back to a table lookup, so they
-- work before the hook is enabled. SECURITY DEFINER so the lookup is not itself blocked by RLS.

create or replace function app.jwt()
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create or replace function app.member()
returns public.members
language sql stable security definer
set search_path = ''
as $$
  select m.* from public.members m
  where m.user_id = auth.uid() and m.is_active
  order by m.created_at
  limit 1;
$$;

create or replace function app.tenant_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select coalesce(nullif(app.jwt() ->> 'tenant_id', '')::uuid, (app.member()).tenant_id);
$$;

create or replace function app.member_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select coalesce(nullif(app.jwt() ->> 'member_id', '')::uuid, (app.member()).id);
$$;

create or replace function app.permissions()
returns bigint
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (app.jwt() ->> 'perms')::bigint,
    (select r.permissions from public.roles r where r.id = (app.member()).role_id),
    0);
$$;

create or replace function app.has_perm(p_key text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (app.permissions() & coalesce((select p.bit from public.permissions p where p.key = p_key), 0)) <> 0;
$$;

create or replace function app.require_perm(p_key text)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if app.tenant_id() is null then
    raise exception 'NO_TENANT' using errcode = 'P0001';
  end if;
  if not app.has_perm(p_key) then
    raise exception 'FORBIDDEN: needs %', p_key using errcode = 'P0001';
  end if;
end $$;

create or replace function app.shop_ids()
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select array_agg(x::uuid) from jsonb_array_elements_text(app.jwt() -> 'shop_ids') x),
    (select case when m.all_shops
              then (select array_agg(s.id) from public.shops s where s.tenant_id = m.tenant_id)
              else (select array_agg(ms.shop_id) from public.member_shops ms where ms.member_id = m.id)
            end
       from (select (app.member()).*) m),
    '{}');
$$;

create or replace function app.can_shop(p_shop uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_shop = any (app.shop_ids());
$$;

create or replace function app.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid());
$$;

create or replace function app.audit(p_action text, p_entity text, p_entity_id uuid, p_data jsonb default '{}')
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, data)
  values (app.tenant_id(), auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_data, '{}'));
$$;

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;

-- Custom access token hook (blueprint §27): adds tenant, member, role, permissions and shops.
-- Enable in config.toml [auth.hook.custom_access_token].
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
    v_claims := v_claims
      || jsonb_build_object(
           'tenant_id', v_member.tenant_id,
           'member_id', v_member.id,
           'role', v_role.key,
           'perms', v_role.permissions,
           'shop_ids', to_jsonb(v_shops),
           'perm_v', v_member.perm_v);
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end $$;

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Row level security -------------------------------------------------------------------------

alter table public.plans enable row level security;
alter table public.plans force row level security;
create policy plans_read on public.plans for select to authenticated using (true);

alter table public.permissions enable row level security;
alter table public.permissions force row level security;
create policy permissions_read on public.permissions for select to authenticated using (true);

alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

alter table public.tenants enable row level security;
alter table public.tenants force row level security;
create policy tenants_read on public.tenants for select to authenticated
  using (id = (select app.tenant_id()) or (select app.is_platform_admin()));
create policy tenants_update on public.tenants for update to authenticated
  using (id = (select app.tenant_id()) and (select app.has_perm('settings.manage')))
  with check (id = (select app.tenant_id()));

alter table public.tenant_entitlements enable row level security;
alter table public.tenant_entitlements force row level security;
create policy entitlements_read on public.tenant_entitlements for select to authenticated
  using (tenant_id = (select app.tenant_id()) or (select app.is_platform_admin()));

alter table public.shops enable row level security;
alter table public.shops force row level security;
create policy shops_read on public.shops for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy shops_update on public.shops for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_perm('settings.manage')))
  with check (tenant_id = (select app.tenant_id()));

alter table public.lanes enable row level security;
alter table public.lanes force row level security;
create policy lanes_read on public.lanes for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));
create policy lanes_update on public.lanes for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)) and (select app.has_perm('staff.manage')))
  with check (tenant_id = (select app.tenant_id()));

alter table public.roles enable row level security;
alter table public.roles force row level security;
create policy roles_read on public.roles for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.members enable row level security;
alter table public.members force row level security;
create policy members_read on public.members for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.member_shops enable row level security;
alter table public.member_shops force row level security;
create policy member_shops_read on public.member_shops for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.session_resets enable row level security;
alter table public.session_resets force row level security;
create policy session_resets_read on public.session_resets for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;
create policy audit_log_read on public.audit_log for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_perm('settings.manage')));

-- Writes to these tables go through api.* functions only.
revoke all on public.plans, public.permissions, public.platform_admins, public.tenants, public.tenant_entitlements,
  public.shops, public.lanes, public.roles, public.members, public.member_shops, public.session_resets,
  public.audit_log from anon;
revoke insert, update, delete on public.plans, public.permissions, public.platform_admins,
  public.tenant_entitlements, public.roles, public.members, public.member_shops, public.session_resets,
  public.audit_log from authenticated;
revoke insert, delete on public.tenants, public.shops, public.lanes from authenticated;

-- Onboarding (WF-001) ------------------------------------------------------------------------

-- Creates a tenant with its first shop, default roles and the caller as owner.
create or replace function api.create_tenant(
  p_name text,
  p_slug text,
  p_shop_code text,
  p_shop_name text,
  p_owner_name text,
  p_plan text default 'single'
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_plan   public.plans;
  v_tenant uuid;
  v_owner  uuid;
  v_shop   uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.members m where m.user_id = v_uid and m.is_active) then
    raise exception 'VALIDATION_ERROR: this account already belongs to a business' using errcode = 'P0001';
  end if;
  select * into v_plan from public.plans where id = p_plan and is_active;
  if v_plan.id is null then
    raise exception 'VALIDATION_ERROR: unknown plan' using errcode = 'P0001';
  end if;

  insert into public.tenants (name, slug, plan_id, created_by)
  values (p_name, p_slug, v_plan.id, v_uid) returning id into v_tenant;

  insert into public.tenant_entitlements (tenant_id, max_shops, max_lanes_per_shop, head_office, transfers)
  values (v_tenant, v_plan.max_shops, v_plan.max_lanes_per_shop, v_plan.head_office, v_plan.transfers);

  -- Default roles; masks match DEFAULT_ROLES in packages/core/src/permissions.ts.
  insert into public.roles (tenant_id, key, name, permissions, is_system) values
    (v_tenant, 'owner', 'Owner', 16383, true),
    (v_tenant, 'manager', 'Store manager', 14079, true),
    (v_tenant, 'cashier', 'Cashier', 3, true),
    (v_tenant, 'stock_keeper', 'Stock keeper', 24, true),
    (v_tenant, 'accountant', 'Accountant', 8320, true);

  insert into public.shops (tenant_id, code, name, created_by)
  values (v_tenant, upper(p_shop_code), p_shop_name, v_uid) returning id into v_shop;

  insert into public.members (tenant_id, user_id, role_id, display_name, all_shops, created_by)
  select v_tenant, v_uid, r.id, p_owner_name, true, v_uid
    from public.roles r where r.tenant_id = v_tenant and r.key = 'owner'
  returning id into v_owner;

  insert into public.lanes (tenant_id, shop_id, code, name, created_by)
  values (v_tenant, v_shop, 'L1', 'Lane 1', v_uid);

  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, data)
  values (v_tenant, v_uid, 'tenant.create', 'tenants', v_tenant, jsonb_build_object('plan', v_plan.id));

  return v_tenant;
end $$;

-- Adds a lane to a shop, enforcing the plan's lane limit (BR-002).
create or replace function api.add_lane(p_shop_id uuid, p_name text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_count  integer;
  v_max    integer;
  v_lane   uuid;
begin
  perform app.require_perm('staff.manage');
  if not exists (select 1 from public.shops s where s.id = p_shop_id and s.tenant_id = v_tenant)
     or not app.can_shop(p_shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.lanes l where l.shop_id = p_shop_id;
  select e.max_lanes_per_shop into v_max from public.tenant_entitlements e where e.tenant_id = v_tenant;
  if v_count >= v_max then
    raise exception 'PLAN_LIMIT: % lanes per shop on this plan', v_max using errcode = 'P0001';
  end if;
  insert into public.lanes (tenant_id, shop_id, code, name, created_by)
  values (v_tenant, p_shop_id, 'L' || (v_count + 1), p_name, auth.uid())
  returning id into v_lane;
  perform app.audit('lane.create', 'lanes', v_lane, jsonb_build_object('shop_id', p_shop_id));
  return v_lane;
end $$;

revoke all on all functions in schema api from public, anon;
grant execute on all functions in schema api to authenticated, service_role;
