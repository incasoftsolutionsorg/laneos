-- Fix: the access token hook wrote the LaneOS role into the `role` claim, which PostgREST uses
-- as the Postgres role to switch to ("role owner does not exist"). Keep `role` untouched and put
-- the LaneOS role in `app_role`.

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
           'perms', v_role.permissions,
           'shop_ids', to_jsonb(v_shops),
           'perm_v', v_member.perm_v);
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end $$;

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
