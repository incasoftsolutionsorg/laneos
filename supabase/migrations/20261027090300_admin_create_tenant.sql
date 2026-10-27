-- SLICE-001 "platform admin creates a tenant": the sign-up logic moves into app.create_tenant_for(user, …), used by
-- api.create_tenant (self sign-up, v3, unchanged behaviour) and api.admin_create_tenant (LaneOS staff, for an invited owner;
-- custom plans such as Chain allowed, status active or trial).

create or replace function app.create_tenant_for(
  p_uid uuid, p_name text, p_slug text, p_shop_code text, p_shop_name text, p_owner_name text, p_plan public.plans,
  p_details jsonb, p_status public.tenant_status, p_actor uuid
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_shop   uuid;
begin
  if exists (select 1 from public.members m where m.user_id = p_uid and m.is_active) then
    raise exception 'VALIDATION_ERROR: this account already belongs to a business' using errcode = 'P0001';
  end if;

  insert into public.tenants (name, slug, plan_id, status, created_by, business_reg_no, city, business_type, trial_ends_on, next_charge_on)
  values (p_name, p_slug, p_plan.id, p_status, p_uid, nullif(p_details ->> 'businessRegNo', ''), nullif(p_details ->> 'city', ''),
          nullif(p_details ->> 'businessType', ''),
          case when p_status = 'trial' then current_date + 14 end, current_date + case when p_status = 'trial' then 14 else 30 end)
  returning id into v_tenant;

  insert into public.tenant_entitlements (tenant_id, max_shops, max_lanes_per_shop, head_office, transfers)
  values (v_tenant, p_plan.max_shops, p_plan.max_lanes_per_shop, p_plan.head_office, p_plan.transfers);

  -- Default roles; masks match DEFAULT_ROLES in packages/core/src/permissions.ts.
  insert into public.roles (tenant_id, key, name, permissions, is_system) values
    (v_tenant, 'owner', 'Owner', 16383, true),
    (v_tenant, 'manager', 'Store manager', 14079, true),
    (v_tenant, 'cashier', 'Cashier', 3, true),
    (v_tenant, 'stock_keeper', 'Stock keeper', 24, true),
    (v_tenant, 'accountant', 'Accountant', 8320, true);

  insert into public.shops (tenant_id, code, name, phone, created_by)
  values (v_tenant, upper(p_shop_code), p_shop_name, nullif(p_details ->> 'shopPhone', ''), p_uid) returning id into v_shop;

  insert into public.members (tenant_id, user_id, role_id, display_name, phone, all_shops, created_by)
  select v_tenant, p_uid, r.id, p_owner_name, nullif(p_details ->> 'mobile', ''), true, p_uid
    from public.roles r where r.tenant_id = v_tenant and r.key = 'owner';

  insert into public.lanes (tenant_id, shop_id, code, name, created_by)
  values (v_tenant, v_shop, 'L1', 'Lane 1', p_uid);

  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, data)
  values (v_tenant, p_actor, case when p_actor = p_uid then 'tenant.create' else 'platform.tenant_create' end, 'tenants', v_tenant,
          jsonb_build_object('plan', p_plan.id, 'owner', p_uid));
  return v_tenant;
end $$;
revoke all on function app.create_tenant_for(uuid, text, text, text, text, text, public.plans, jsonb, public.tenant_status, uuid)
  from public, anon, authenticated;

-- v3: same as v2, through the shared helper.
create or replace function api.create_tenant(
  p_name text, p_slug text, p_shop_code text, p_shop_name text, p_owner_name text, p_plan text default 'single',
  p_details jsonb default '{}'
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  select * into v_plan from public.plans where id = p_plan and is_active and not is_custom;
  if v_plan.id is null then
    raise exception 'VALIDATION_ERROR: unknown plan' using errcode = 'P0001';
  end if;
  return app.create_tenant_for(auth.uid(), p_name, p_slug, p_shop_code, p_shop_name, p_owner_name, v_plan, p_details, 'trial', auth.uid());
end $$;

-- LaneOS staff set up a business for an owner whose login already exists (the server invites them first).
create or replace function api.admin_create_tenant(
  p_owner_email text, p_name text, p_slug text, p_shop_code text, p_shop_name text, p_owner_name text, p_plan text,
  p_trial boolean default true, p_details jsonb default '{}'
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid  uuid;
  v_plan public.plans;
begin
  perform app.require_platform_admin();
  select u.id into v_uid from auth.users u where lower(u.email) = lower(trim(p_owner_email));
  if v_uid is null then
    raise exception 'NOT_FOUND: no login with that email' using errcode = 'P0001';
  end if;
  select * into v_plan from public.plans where id = p_plan and is_active;
  if v_plan.id is null then
    raise exception 'VALIDATION_ERROR: unknown plan' using errcode = 'P0001';
  end if;
  return app.create_tenant_for(v_uid, p_name, p_slug, p_shop_code, p_shop_name, p_owner_name, v_plan, p_details,
                               case when p_trial then 'trial'::public.tenant_status else 'active' end, auth.uid());
end $$;

revoke all on function api.create_tenant(text, text, text, text, text, text, jsonb),
  api.admin_create_tenant(text, text, text, text, text, text, text, boolean, jsonb) from public, anon;
grant execute on function api.create_tenant(text, text, text, text, text, text, jsonb),
  api.admin_create_tenant(text, text, text, text, text, text, text, boolean, jsonb) to authenticated, service_role;
