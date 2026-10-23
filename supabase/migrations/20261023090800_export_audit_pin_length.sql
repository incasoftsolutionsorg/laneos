-- Export audit and PIN length (Settings → Security, blueprint §27.6):
--   api.audit_export records every CSV export; api.set_pin honours tenants.pin_length_min.

create or replace function api.audit_export(p_what text, p_from date, p_to date)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('reports.view');
  perform app.audit('export.csv', p_what, null, jsonb_build_object('from', p_from, 'to', p_to));
end $$;

create or replace function api.set_pin(p_member uuid, p_pin text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m   public.members;
  v_min integer;
begin
  select * into v_m from public.members m where m.id = p_member and m.tenant_id = app.tenant_id();
  if v_m.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_m.id <> app.member_id() and not app.has_perm('staff.manage') then
    raise exception 'FORBIDDEN: needs staff.manage' using errcode = 'P0001';
  end if;
  select t.pin_length_min into v_min from public.tenants t where t.id = v_m.tenant_id;
  if p_pin !~ '^\d{4,6}$' or char_length(p_pin) < coalesce(v_min, 4) or p_pin ~ '^(\d)\1+$' or p_pin in ('1234', '12345', '123456', '0000') then
    raise exception 'VALIDATION_ERROR: PIN must be % to 6 digits and not too simple', coalesce(v_min, 4) using errcode = 'P0001';
  end if;
  update public.members
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), pin_failures = 0, pin_locked_until = null
   where id = p_member;
  perform app.audit('pin.set', 'members', p_member);
end $$;

revoke all on function api.audit_export(text, date, date) from public, anon;
grant execute on function api.audit_export(text, date, date) to authenticated, service_role;
