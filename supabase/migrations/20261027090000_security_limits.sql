-- Security limits (blueprint §27.6, §30.3, THR-014):
--   * credit-note lookups: 10 per minute per lane, 5 wrong codes in a row lock lookups for 5 minutes
--   * failed-login lockout per tenant settings (failed_login_limit / failed_login_lock_min), checked server-side
--   * PIN change interval (tenants.pin_change_days): the lane asks for a new PIN; self-service change at the lane
--   * credit-note cash-out when the tenant allows it (tenants.credit_note_cash_out)
--   * api.lane_cashiers honours per-person permission overrides

-- Attempt log for rate limits (no API access at all) ---------------------------------------------------------

create table public.lookup_attempts (
  id        uuid primary key default app.uuid_v7(),
  tenant_id uuid references public.tenants (id),
  lane_id   uuid references public.lanes (id),
  kind      text not null check (kind in ('credit_note')),
  ok        boolean not null,
  at        timestamptz not null default now()
);
create index lookup_attempts_lane on public.lookup_attempts (lane_id, kind, at desc);
alter table public.lookup_attempts enable row level security;
alter table public.lookup_attempts force row level security;
revoke all on public.lookup_attempts from anon, authenticated;

create table public.login_attempts (
  id         uuid primary key default app.uuid_v7(),
  email_hash text not null,
  ok         boolean not null,
  at         timestamptz not null default now()
);
create index login_attempts_email on public.login_attempts (email_hash, at desc);
alter table public.login_attempts enable row level security;
alter table public.login_attempts force row level security;
revoke all on public.login_attempts from anon, authenticated;

-- Credit-note check v2: rate limited and locked after repeated wrong codes. VOLATILE so the attempt log is written.
create or replace function api.check_credit_note(p_code text, p_lane uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_note   public.credit_notes;
  v_lane   public.lanes;
  v_any    boolean;
  v_recent integer;
  v_fails  integer;
  v_last   timestamptz;
begin
  perform app.require_perm('sale.create');
  select * into v_lane from public.lanes l where l.id = p_lane and l.tenant_id = app.tenant_id();
  if v_lane.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select count(*) into v_recent from public.lookup_attempts a
   where a.lane_id = p_lane and a.kind = 'credit_note' and a.at > now() - interval '1 minute';
  if v_recent >= 10 then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;
  -- Wrong codes since the last good one, and when the latest wrong one was.
  select count(*), max(a.at) into v_fails, v_last from public.lookup_attempts a
   where a.lane_id = p_lane and a.kind = 'credit_note' and not a.ok
     and a.at > coalesce((select max(b.at) from public.lookup_attempts b where b.lane_id = p_lane and b.kind = 'credit_note' and b.ok), '-infinity');
  if v_fails >= 5 and v_last > now() - interval '5 minutes' then
    return jsonb_build_object('ok', false, 'error', 'CREDIT_NOTE_LOCKED');
  end if;

  select * into v_note from public.credit_notes n where n.tenant_id = v_lane.tenant_id and n.code_hash = app.credit_note_hash(p_code);
  insert into public.lookup_attempts (tenant_id, lane_id, kind, ok) values (v_lane.tenant_id, p_lane, 'credit_note', v_note.id is not null);
  if v_note.id is null then
    if v_fails + 1 >= 5 then
      perform app.audit('credit_note.lookup_locked', 'lanes', p_lane);
    end if;
    return jsonb_build_object('ok', false, 'error', 'CREDIT_NOTE_NOT_FOUND');
  end if;
  select t.credit_note_any_shop into v_any from public.tenants t where t.id = v_lane.tenant_id;
  return jsonb_build_object(
    'ok', v_note.status in ('active', 'partially_used') and v_note.expires_on >= (now() at time zone 'Asia/Colombo')::date
          and (v_any or v_note.shop_id = v_lane.shop_id),
    'error', case
      when v_note.status not in ('active', 'partially_used') then 'CREDIT_NOTE_USED'
      when v_note.expires_on < (now() at time zone 'Asia/Colombo')::date then 'CREDIT_NOTE_EXPIRED'
      when not v_any and v_note.shop_id <> v_lane.shop_id then 'CREDIT_NOTE_OTHER_SHOP' end,
    'noteNo', v_note.note_no, 'balanceCents', v_note.balance_cents, 'amountCents', v_note.amount_cents,
    'expiresOn', v_note.expires_on, 'status', v_note.status);
end $$;

-- Failed-login lockout (called only by the server with the service role) -------------------------------------------

create or replace function app.login_policy(p_email text)
returns record
language sql stable security definer
set search_path = ''
as $$
  select coalesce(min(t.failed_login_limit), 5) as lim, coalesce(max(t.failed_login_lock_min), 15) as lock_min
    from auth.users u
    join public.members m on m.user_id = u.id and m.is_active
    join public.tenants t on t.id = m.tenant_id
   where lower(u.email) = lower(trim(p_email));
$$;

-- {locked, until, limit, lockMinutes}: locked when the wrong passwords since the last good sign-in reach the
-- tenant's limit inside its lock window.
create or replace function api.login_gate(p_email text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_hash  text := encode(extensions.digest(lower(trim(p_email)), 'sha256'), 'hex');
  v_lim   integer;
  v_min   integer;
  v_fails integer;
  v_last  timestamptz;
begin
  select lim, lock_min into v_lim, v_min from app.login_policy(p_email) as (lim integer, lock_min integer);
  select count(*), max(a.at) into v_fails, v_last from public.login_attempts a
   where a.email_hash = v_hash and not a.ok and a.at > now() - make_interval(mins => v_min)
     and a.at > coalesce((select max(b.at) from public.login_attempts b where b.email_hash = v_hash and b.ok), '-infinity');
  return jsonb_build_object('locked', v_fails >= v_lim, 'until', case when v_fails >= v_lim then v_last + make_interval(mins => v_min) end,
                            'limit', v_lim, 'lockMinutes', v_min, 'failures', v_fails);
end $$;

create or replace function api.login_record(p_email text, p_ok boolean)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.login_attempts (email_hash, ok) values (encode(extensions.digest(lower(trim(p_email)), 'sha256'), 'hex'), p_ok);
  delete from public.login_attempts where at < now() - interval '30 days';
$$;

-- PIN rules and PIN change at the lane ----------------------------------------------------------------------------

alter table public.members add column pin_set_at timestamptz;
update public.members set pin_set_at = now() where pin_hash is not null;
grant select (pin_set_at) on public.members to authenticated;

create or replace function app.pin_problem(p_tenant uuid, p_pin text)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when p_pin !~ '^\d{4,6}$' then 'PIN must be 4 to 6 digits'
    when char_length(p_pin) < coalesce((select t.pin_length_min from public.tenants t where t.id = p_tenant), 4)
      then 'PIN must be at least ' || (select t.pin_length_min from public.tenants t where t.id = p_tenant) || ' digits'
    when p_pin ~ '^(\d)\1+$' or p_pin in ('1234', '12345', '123456', '0000', '4321', '654321') then 'PIN is too simple'
  end;
$$;

create or replace function api.set_pin(p_member uuid, p_pin text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m       public.members;
  v_problem text;
begin
  select * into v_m from public.members m where m.id = p_member and m.tenant_id = app.tenant_id();
  if v_m.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_m.id <> app.member_id() and not app.has_perm('staff.manage') then
    raise exception 'FORBIDDEN: needs staff.manage' using errcode = 'P0001';
  end if;
  v_problem := app.pin_problem(v_m.tenant_id, p_pin);
  if v_problem is not null then
    raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
  end if;
  update public.members
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), pin_failures = 0, pin_locked_until = null, pin_set_at = now()
   where id = p_member;
  perform app.audit('pin.set', 'members', p_member);
end $$;

create or replace function app.pin_expired(p_member uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select t.pin_change_days is not null and coalesce(m.pin_set_at, m.created_at) < now() - make_interval(days => t.pin_change_days)
    from public.members m join public.tenants t on t.id = m.tenant_id where m.id = p_member;
$$;

create or replace function app.lane_member_ok(p_lane public.lanes, p_member uuid)
returns public.members
language sql stable security definer
set search_path = ''
as $$
  select m.* from public.members m join public.roles r on r.id = m.role_id
   where m.id = p_member and m.tenant_id = p_lane.tenant_id and m.is_active
     and (((r.permissions | m.perms_add) & ~m.perms_remove) & 1) <> 0
     and (m.all_shops or exists (select 1 from public.member_shops ms where ms.member_id = m.id and ms.shop_id = p_lane.shop_id));
$$;

create or replace function api.lane_cashiers(p_lane uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_lane public.lanes;
begin
  perform app.require_perm('sale.create');
  select * into v_lane from public.lanes l where l.id = p_lane and l.tenant_id = app.tenant_id();
  if v_lane.id is null or not app.can_shop(v_lane.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.display_name,
                                        'locked', m.pin_locked_until is not null and m.pin_locked_until > now())
                     order by m.display_name)
      from public.members m
      join public.roles r on r.id = m.role_id
     where m.tenant_id = v_lane.tenant_id and m.is_active and m.pin_hash is not null
       and (((r.permissions | m.perms_add) & ~m.perms_remove) & 1) <> 0
       and (m.all_shops or exists (select 1 from public.member_shops ms where ms.member_id = m.id and ms.shop_id = v_lane.shop_id))
  ), '[]'::jsonb);
end $$;

-- Lane unlock v2: a correct PIN that is older than the tenant's interval returns PIN_EXPIRED (failures are reset).
create or replace function api.lane_unlock(p_lane uuid, p_key text, p_member uuid, p_pin text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_lane   public.lanes;
  v_member public.members;
  v_result text;
begin
  perform app.require_perm('sale.create');
  select * into v_lane from public.lanes l where l.id = p_lane and l.tenant_id = app.tenant_id();
  if v_lane.id is null or not app.can_shop(v_lane.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_lane.key_hash is null then
    return jsonb_build_object('ok', false, 'error', 'LANE_NOT_REGISTERED');
  end if;
  if not app.lane_key_ok(v_lane, p_key) then
    return jsonb_build_object('ok', false, 'error', 'LANE_KEY_INVALID');
  end if;
  v_member := app.lane_member_ok(v_lane, p_member);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  v_result := app.check_pin(v_member.id, p_pin);
  if v_result <> 'ok' then
    return jsonb_build_object('ok', false, 'error', case v_result when 'locked' then 'PIN_LOCKED' when 'no_pin' then 'NO_PIN' else 'PIN_INVALID' end);
  end if;
  if app.pin_expired(v_member.id) then
    return jsonb_build_object('ok', false, 'error', 'PIN_EXPIRED');
  end if;
  update public.lanes set active_member_id = v_member.id, active_since = now(), last_seen_at = now() where id = p_lane;
  perform app.audit('lane.unlock', 'lanes', p_lane, jsonb_build_object('member_id', v_member.id));
  return jsonb_build_object('ok', true, 'member', jsonb_build_object('id', v_member.id, 'name', v_member.display_name));
end $$;

-- The cashier proves the old PIN, sets a new one and is signed in to the lane. {ok:false, error} like lane_unlock.
create or replace function api.lane_change_pin(p_lane uuid, p_key text, p_member uuid, p_old text, p_new text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_lane    public.lanes;
  v_member  public.members;
  v_result  text;
  v_problem text;
begin
  perform app.require_perm('sale.create');
  select * into v_lane from public.lanes l where l.id = p_lane and l.tenant_id = app.tenant_id();
  if v_lane.id is null or not app.can_shop(v_lane.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.lane_key_ok(v_lane, p_key) then
    return jsonb_build_object('ok', false, 'error', 'LANE_KEY_INVALID');
  end if;
  v_member := app.lane_member_ok(v_lane, p_member);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  v_result := app.check_pin(v_member.id, p_old);
  if v_result <> 'ok' then
    return jsonb_build_object('ok', false, 'error', case v_result when 'locked' then 'PIN_LOCKED' when 'no_pin' then 'NO_PIN' else 'PIN_INVALID' end);
  end if;
  v_problem := app.pin_problem(v_member.tenant_id, p_new);
  if v_problem is null and p_new = p_old then
    v_problem := 'choose a PIN you have not just used';
  end if;
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'error', 'VALIDATION_ERROR', 'message', v_problem);
  end if;
  update public.members set pin_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), pin_set_at = now() where id = v_member.id;
  update public.lanes set active_member_id = v_member.id, active_since = now(), last_seen_at = now() where id = p_lane;
  perform app.audit('pin.changed_at_lane', 'members', v_member.id, jsonb_build_object('lane', p_lane));
  return jsonb_build_object('ok', true, 'member', jsonb_build_object('id', v_member.id, 'name', v_member.display_name));
end $$;

-- Credit-note cash-out (blueprint §27.6 "manager approval") ------------------------------------------------------

create or replace function api.cash_out_credit_note(p_note uuid, p_reason text)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_note public.credit_notes;
begin
  perform app.require_perm('shift.manage');
  if not coalesce((select t.credit_note_cash_out from public.tenants t where t.id = app.tenant_id()), false) then
    raise exception 'FORBIDDEN: cashing out credit notes is turned off in Settings → Security' using errcode = 'P0001';
  end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then
    raise exception 'VALIDATION_ERROR: give a reason' using errcode = 'P0001';
  end if;
  select * into v_note from public.credit_notes n where n.id = p_note and n.tenant_id = app.tenant_id() for update;
  if v_note.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_note.status not in ('active', 'partially_used') or v_note.balance_cents <= 0 then
    raise exception 'CREDIT_NOTE_USED' using errcode = 'P0001';
  end if;
  update public.credit_notes set status = 'cashed_out', balance_cents = 0 where id = v_note.id;
  perform app.audit('credit_note.cash_out', 'credit_notes', v_note.id, jsonb_build_object('amount', v_note.balance_cents, 'reason', trim(p_reason)));
  return v_note.balance_cents;
end $$;

-- Grants --------------------------------------------------------------------------------------------------------

revoke all on function api.check_credit_note(text, uuid), api.lane_cashiers(uuid), api.lane_unlock(uuid, text, uuid, text),
  api.lane_change_pin(uuid, text, uuid, text, text), api.set_pin(uuid, text), api.cash_out_credit_note(uuid, text),
  api.login_gate(text), api.login_record(text, boolean) from public, anon;
grant execute on function api.check_credit_note(text, uuid), api.lane_cashiers(uuid), api.lane_unlock(uuid, text, uuid, text),
  api.lane_change_pin(uuid, text, uuid, text, text), api.set_pin(uuid, text), api.cash_out_credit_note(uuid, text)
  to authenticated, service_role;
-- Login gate and record run before anyone is signed in, so only the server (service role) may call them.
revoke all on function api.login_gate(text), api.login_record(text, boolean) from authenticated;
grant execute on function api.login_gate(text), api.login_record(text, boolean) to service_role;
revoke all on function app.login_policy(text), app.pin_problem(uuid, text), app.pin_expired(uuid), app.lane_member_ok(public.lanes, uuid)
  from public, anon, authenticated;
