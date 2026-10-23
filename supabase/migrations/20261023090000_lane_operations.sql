-- Lane operations (blueprint §27.5, §30, WF-002..004, WF-009):
--   cashier PINs and lane device registration, shift float counts and cash pickups,
--   customer returns with credit notes and refunds, damage reports, offline sync issues,
--   digital receipts, and api.create_sale v3 (credit-note payments, lane key, reserved invoice numbers).

-- Safety net: functions created in api/app from now on are not executable by PUBLIC by default.
alter default privileges in schema api revoke execute on functions from public;
alter default privileges in schema app revoke execute on functions from public;

-- Enums ------------------------------------------------------------------------------------------

create type public.return_settlement as enum ('cash', 'original', 'exchange', 'credit_note', 'credit_balance');
create type public.return_reason as enum ('changed_mind', 'wrong_item', 'damaged', 'expired', 'quality', 'other');
create type public.restock_action as enum ('sellable', 'damaged');
create type public.credit_note_status as enum ('active', 'partially_used', 'used', 'expired', 'cancelled', 'cashed_out');
create type public.damage_source as enum ('shelf', 'grn', 'customer_return', 'transfer', 'count');
create type public.damage_reason as enum ('broken', 'leaking', 'crushed', 'pest', 'expired', 'temperature', 'other');
create type public.damage_status as enum
  ('reported', 'awaiting_approval', 'awaiting_decision', 'sent_to_supplier', 'reduced_for_sale',
   'written_off', 'used_in_store', 'rejected', 'closed');
create type public.damage_decision as enum ('supplier_return', 'reduced_sale', 'write_off', 'internal_use');
create type public.sync_issue_status as enum ('open', 'resolved', 'discarded');

-- New columns on existing tables -----------------------------------------------------------------

alter table public.tenants
  add column credit_note_days      integer not null default 90 check (credit_note_days between 30 and 365),
  add column credit_note_any_shop  boolean not null default true,   -- chain: redeem at any shop (REQ-CRN-008)
  add column cash_refund_pin_cents bigint  not null default 500000 check (cash_refund_pin_cents >= 0); -- Rs 5,000

alter table public.members
  add column pin_failures     integer not null default 0,
  add column pin_locked_until timestamptz;

alter table public.lanes
  add column active_member_id uuid references public.members (id),  -- cashier unlocked by PIN on this lane
  add column active_since     timestamptz;

alter table public.shifts
  add column opening_denoms jsonb,            -- {"500000":1,"100000":2,...,"coins":20000} note value (cents) → count
  add column closing_denoms jsonb,
  add column variance_note  text check (char_length(variance_note) <= 300),
  add column reserved_from  bigint,           -- invoice numbers kept for offline use (open-shift toggle)
  add column reserved_to    bigint,
  add check ((reserved_from is null) = (reserved_to is null));

-- Unguessable token for the digital receipt link /r/<token> (blueprint ACT-009).
alter table public.sales add column receipt_token text not null default encode(extensions.gen_random_bytes(16), 'hex');
create unique index sales_receipt_token on public.sales (receipt_token);

-- Document numbers per shop: RTN-KDY1-000001, CN-KDY1-000001, DMG-KDY1-000001 ---------------------

create table public.doc_counters (
  shop_id uuid not null references public.shops (id),
  kind    text not null check (kind ~ '^[A-Z]{2,4}$'),
  seq     bigint not null default 0,
  primary key (shop_id, kind)
);
alter table public.doc_counters enable row level security;
alter table public.doc_counters force row level security;
revoke all on public.doc_counters from anon, authenticated;

create or replace function app.next_doc_no(p_shop uuid, p_kind text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_seq  bigint;
  v_code text;
begin
  insert into public.doc_counters (shop_id, kind, seq) values (p_shop, p_kind, 1)
  on conflict (shop_id, kind) do update set seq = public.doc_counters.seq + 1
  returning seq into v_seq;
  select s.code into v_code from public.shops s where s.id = p_shop;
  return p_kind || '-' || v_code || '-' || lpad(v_seq::text, 6, '0');
end $$;

-- Cash pickups (drawer → safe during a shift) ------------------------------------------------------

create table public.cash_pickups (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants (id),
  shop_id      uuid not null references public.shops (id),
  shift_id     uuid not null references public.shifts (id),
  amount_cents bigint not null check (amount_cents > 0),
  note         text check (char_length(note) <= 200),
  member_id    uuid not null references public.members (id),
  created_at   timestamptz not null default now()
);
create index cash_pickups_shift on public.cash_pickups (shift_id);

-- Damage reports (blueprint §30.1) ---------------------------------------------------------------

create table public.damage_reports (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null references public.tenants (id),
  shop_id         uuid not null references public.shops (id),
  report_no       text not null,
  item_id         uuid not null references public.items (id),
  qty_milli       bigint not null check (qty_milli > 0),
  remaining_milli bigint not null check (remaining_milli >= 0),   -- still awaiting a decision
  unit_cost_cents bigint not null default 0,                      -- snapshot for value reports
  source          public.damage_source not null,
  source_ref_id   uuid,                                           -- return line, GRN line, count line…
  reason          public.damage_reason not null,
  photo_path      text,
  note            text check (char_length(note) <= 500),
  status          public.damage_status not null default 'reported',
  reported_by     uuid not null references public.members (id),
  approved_by     uuid references public.members (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (shop_id, report_no),
  check (remaining_milli <= qty_milli)
);
create index damage_open on public.damage_reports (shop_id, created_at)
  where status in ('reported', 'awaiting_approval', 'awaiting_decision');
create trigger damage_reports_touch before update on public.damage_reports for each row execute function app.touch_updated_at();

create table public.damage_decisions (
  id                   uuid primary key default app.uuid_v7(),
  tenant_id            uuid not null references public.tenants (id),
  damage_report_id     uuid not null references public.damage_reports (id),
  decision             public.damage_decision not null,
  qty_milli            bigint not null check (qty_milli > 0),
  markdown_price_cents bigint check (markdown_price_cents >= 0),
  supplier_return_id   uuid,
  decided_by           uuid not null references public.members (id),
  decided_at           timestamptz not null default now()
);
create index damage_decisions_report on public.damage_decisions (damage_report_id);

-- Returns and credit notes (blueprint §30.2) -------------------------------------------------------

create table public.returns (
  id           uuid primary key default app.uuid_v7(),
  tenant_id    uuid not null references public.tenants (id),
  shop_id      uuid not null references public.shops (id),
  lane_id      uuid not null references public.lanes (id),
  shift_id     uuid references public.shifts (id),       -- set when cash leaves the drawer
  sale_id      uuid not null references public.sales (id),
  return_no    text not null,
  customer_id  uuid references public.customers (id),
  settlement   public.return_settlement not null,
  total_cents  bigint not null check (total_cents > 0),
  member_id    uuid not null references public.members (id),
  approved_by  uuid references public.members (id),       -- supervisor PIN for large cash refunds
  client_uuid  uuid not null,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  unique (shop_id, return_no)
);
create unique index returns_idem on public.returns (tenant_id, client_uuid);
create index returns_sale on public.returns (sale_id);
create index returns_shop_time on public.returns (shop_id, created_at desc);

create table public.return_lines (
  id           uuid primary key default app.uuid_v7(),
  return_id    uuid not null references public.returns (id),
  tenant_id    uuid not null references public.tenants (id),
  shop_id      uuid not null references public.shops (id),
  sale_line_id uuid not null references public.sale_lines (id),
  item_id      uuid not null references public.items (id),
  item_name    text not null,
  qty_milli    bigint not null check (qty_milli > 0),
  value_cents  bigint not null check (value_cents >= 0),
  reason       public.return_reason not null,
  restock      public.restock_action not null
);
create index return_lines_sale_line on public.return_lines (sale_line_id);

create table public.credit_notes (
  id            uuid primary key default app.uuid_v7(),
  tenant_id     uuid not null references public.tenants (id),
  shop_id       uuid not null references public.shops (id),
  note_no       text not null,
  code_hash     bytea not null,                 -- HMAC-SHA256(code, Vault key); the code is never stored
  code_last4    char(4) not null,
  return_id     uuid references public.returns (id),
  customer_id   uuid references public.customers (id),
  amount_cents  bigint not null check (amount_cents > 0),
  balance_cents bigint not null check (balance_cents >= 0),
  expires_on    date not null,
  status        public.credit_note_status not null default 'active',
  issued_by     uuid not null references public.members (id),
  reason        text check (char_length(reason) <= 200),
  replaced_by   uuid references public.credit_notes (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (balance_cents <= amount_cents),
  unique (tenant_id, code_hash),
  unique (shop_id, note_no)
);
create index credit_notes_open on public.credit_notes (tenant_id, expires_on) where status in ('active', 'partially_used');
create trigger credit_notes_touch before update on public.credit_notes for each row execute function app.touch_updated_at();

create table public.credit_note_redemptions (
  id             uuid primary key default app.uuid_v7(),
  tenant_id      uuid not null references public.tenants (id),
  credit_note_id uuid not null references public.credit_notes (id),
  sale_id        uuid not null references public.sales (id),
  shop_id        uuid not null references public.shops (id),
  lane_id        uuid not null references public.lanes (id),
  amount_cents   bigint not null check (amount_cents > 0),
  redeemed_by    uuid not null references public.members (id),
  created_at     timestamptz not null default now()
);
create index credit_note_redemptions_note on public.credit_note_redemptions (credit_note_id);
create index credit_note_redemptions_sale on public.credit_note_redemptions (sale_id);

-- Offline sales the server refused when the lane synced them (WF-003) -------------------------------

create table public.sync_issues (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null references public.tenants (id),
  shop_id         uuid not null references public.shops (id),
  lane_id         uuid not null references public.lanes (id),
  client_uuid     uuid not null,
  payload         jsonb not null,
  error_code      text not null,
  error_message   text,
  status          public.sync_issue_status not null default 'open',
  resolved_by     uuid references public.members (id),
  resolution_note text check (char_length(resolution_note) <= 300),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  unique (tenant_id, client_uuid)
);
create index sync_issues_open on public.sync_issues (shop_id, created_at) where status = 'open';

-- Append-only ---------------------------------------------------------------------------------------

create trigger cash_pickups_append_only before update or delete on public.cash_pickups
  for each row execute function app.append_only();
create trigger returns_append_only before update or delete on public.returns
  for each row execute function app.append_only();
create trigger return_lines_append_only before update or delete on public.return_lines
  for each row execute function app.append_only();
create trigger credit_note_redemptions_append_only before update or delete on public.credit_note_redemptions
  for each row execute function app.append_only();
create trigger damage_decisions_append_only before update or delete on public.damage_decisions
  for each row execute function app.append_only();

-- RLS: read by tenant (and shop); writes only through api.* functions --------------------------------

alter table public.cash_pickups enable row level security;
alter table public.cash_pickups force row level security;
create policy cash_pickups_read on public.cash_pickups for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

alter table public.damage_reports enable row level security;
alter table public.damage_reports force row level security;
create policy damage_reports_read on public.damage_reports for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

alter table public.damage_decisions enable row level security;
alter table public.damage_decisions force row level security;
create policy damage_decisions_read on public.damage_decisions for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.returns enable row level security;
alter table public.returns force row level security;
create policy returns_read on public.returns for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

alter table public.return_lines enable row level security;
alter table public.return_lines force row level security;
create policy return_lines_read on public.return_lines for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

-- Credit notes are a tenant-wide liability: any shop of the tenant can look them up (REQ-CRN-008).
alter table public.credit_notes enable row level security;
alter table public.credit_notes force row level security;
create policy credit_notes_read on public.credit_notes for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.credit_note_redemptions enable row level security;
alter table public.credit_note_redemptions force row level security;
create policy credit_note_redemptions_read on public.credit_note_redemptions for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.sync_issues enable row level security;
alter table public.sync_issues force row level security;
create policy sync_issues_read on public.sync_issues for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));

revoke all on public.cash_pickups, public.damage_reports, public.damage_decisions, public.returns,
  public.return_lines, public.credit_notes, public.credit_note_redemptions, public.sync_issues from anon;
revoke insert, update, delete, truncate on public.cash_pickups, public.damage_reports, public.damage_decisions,
  public.returns, public.return_lines, public.credit_notes, public.credit_note_redemptions, public.sync_issues
  from authenticated;

-- Credit-note code hashing ---------------------------------------------------------------------------
-- The HMAC key lives in Supabase Vault, a new random value per environment (never copied).

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'credit_note_hmac_key',
                           'HMAC key for credit note redemption codes (blueprint §30.2)')
where not exists (select 1 from vault.secrets where name = 'credit_note_hmac_key');

create or replace function app.normalize_code(p_code text)
returns text
language sql immutable
set search_path = ''
as $$
  -- Crockford Base32: case-insensitive, O→0, I/L→1, dashes and spaces ignored
  select translate(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')), 'OIL', '011');
$$;

create or replace function app.credit_note_hash(p_code text)
returns bytea
language sql stable security definer
set search_path = ''
as $$
  select extensions.hmac(app.normalize_code(p_code),
                         (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'credit_note_hmac_key'),
                         'sha256');
$$;

create or replace function app.new_credit_note_code()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_alpha constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_code  text := '';
begin
  for i in 0..11 loop
    v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
end $$;

-- Creates a credit note and returns its number and the plain code (shown once, never stored).
create or replace function app.issue_credit_note(
  p_tenant uuid, p_shop uuid, p_amount bigint, p_return uuid, p_customer uuid, p_member uuid, p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_code  text := app.new_credit_note_code();
  v_days  integer;
  v_no    text := app.next_doc_no(p_shop, 'CN');
  v_id    uuid;
  v_until date;
begin
  select t.credit_note_days into v_days from public.tenants t where t.id = p_tenant;
  v_until := (now() at time zone 'Asia/Colombo')::date + v_days;
  insert into public.credit_notes (tenant_id, shop_id, note_no, code_hash, code_last4, return_id, customer_id,
                                   amount_cents, balance_cents, expires_on, issued_by, reason)
  values (p_tenant, p_shop, v_no, app.credit_note_hash(v_code), right(app.normalize_code(v_code), 4), p_return,
          p_customer, p_amount, p_amount, v_until, p_member, p_reason)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'noteNo', v_no, 'code', v_code, 'amountCents', p_amount, 'expiresOn', v_until);
end $$;

-- PINs ------------------------------------------------------------------------------------------------
-- bcrypt via pgcrypto (blueprint asks for Argon2id, which Postgres cannot compute; see DOC-08 §6).

create or replace function app.check_pin(p_member uuid, p_pin text)
returns text   -- 'ok' | 'invalid' | 'locked' | 'no_pin'
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m public.members;
begin
  select * into v_m from public.members m where m.id = p_member for update;
  if v_m.pin_hash is null then
    return 'no_pin';
  end if;
  if v_m.pin_locked_until is not null and v_m.pin_locked_until > now() then
    return 'locked';
  end if;
  if extensions.crypt(coalesce(p_pin, ''), v_m.pin_hash) = v_m.pin_hash then
    update public.members set pin_failures = 0, pin_locked_until = null where id = p_member;
    return 'ok';
  end if;
  update public.members
     set pin_failures = case when pin_failures + 1 >= 5 then 0 else pin_failures + 1 end,
         pin_locked_until = case when pin_failures + 1 >= 5 then now() + interval '15 minutes' else null end
   where id = p_member;
  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, data)
  values (v_m.tenant_id, auth.uid(), 'pin.failed', 'members', p_member, jsonb_build_object('failures', v_m.pin_failures + 1));
  return case when v_m.pin_failures + 1 >= 5 then 'locked' else 'invalid' end;
end $$;

create or replace function api.set_pin(p_member uuid, p_pin text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m public.members;
begin
  select * into v_m from public.members m where m.id = p_member and m.tenant_id = app.tenant_id();
  if v_m.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_m.id <> app.member_id() and not app.has_perm('staff.manage') then
    raise exception 'FORBIDDEN: needs staff.manage' using errcode = 'P0001';
  end if;
  if p_pin !~ '^\d{4,6}$' or p_pin ~ '^(\d)\1+$' or p_pin in ('1234', '12345', '123456', '0000') then
    raise exception 'VALIDATION_ERROR: PIN must be 4–6 digits and not too simple' using errcode = 'P0001';
  end if;
  update public.members
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), pin_failures = 0, pin_locked_until = null
   where id = p_member;
  perform app.audit('pin.set', 'members', p_member);
end $$;

-- Lane device registration and PIN unlock ---------------------------------------------------------------

-- Registers the browser this is called from as the lane's device. Returns the device key once; only
-- its SHA-256 is stored. Registering again rotates the key (the old device stops working).
create or replace function api.register_lane(p_lane uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_lane public.lanes;
  v_key  text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  perform app.require_perm('staff.manage');
  select * into v_lane from public.lanes l where l.id = p_lane and l.tenant_id = app.tenant_id();
  if v_lane.id is null or not app.can_shop(v_lane.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  update public.lanes
     set key_hash = encode(extensions.digest(v_key, 'sha256'), 'hex'), registered_at = now(),
         active_member_id = null, active_since = null
   where id = p_lane;
  perform app.audit('lane.register', 'lanes', p_lane, jsonb_build_object('rotated', v_lane.key_hash is not null));
  return v_key;
end $$;

create or replace function app.lane_key_ok(p_lane public.lanes, p_key text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_lane.key_hash is null
      or (p_key is not null and encode(extensions.digest(p_key, 'sha256'), 'hex') = p_lane.key_hash);
$$;

-- Cashiers who may unlock this lane: active, PIN set, sale.create, and allowed in the lane's shop.
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
       and (r.permissions & 1) <> 0
       and (m.all_shops or exists (select 1 from public.member_shops ms where ms.member_id = m.id and ms.shop_id = v_lane.shop_id))
  ), '[]'::jsonb);
end $$;

-- Returns {ok:true, member} or {ok:false, error}. Does not raise on a wrong PIN so the failure count is kept.
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
  select m.* into v_member from public.members m
    join public.roles r on r.id = m.role_id
   where m.id = p_member and m.tenant_id = v_lane.tenant_id and m.is_active and (r.permissions & 1) <> 0
     and (m.all_shops or exists (select 1 from public.member_shops ms where ms.member_id = m.id and ms.shop_id = v_lane.shop_id));
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  v_result := app.check_pin(v_member.id, p_pin);
  if v_result <> 'ok' then
    return jsonb_build_object('ok', false, 'error', case v_result when 'locked' then 'PIN_LOCKED' when 'no_pin' then 'NO_PIN' else 'PIN_INVALID' end);
  end if;

  update public.lanes set active_member_id = v_member.id, active_since = now(), last_seen_at = now() where id = p_lane;
  perform app.audit('lane.unlock', 'lanes', p_lane, jsonb_build_object('member_id', v_member.id));
  return jsonb_build_object('ok', true, 'member', jsonb_build_object('id', v_member.id, 'name', v_member.display_name));
end $$;

create or replace function api.lane_lock(p_lane uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('sale.create');
  update public.lanes set active_member_id = null, active_since = null
   where id = p_lane and tenant_id = app.tenant_id() and app.can_shop(shop_id);
end $$;

-- The member a lane action is recorded against: the PIN-unlocked cashier, else the signed-in member.
create or replace function app.lane_member(p_lane public.lanes)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select coalesce(p_lane.active_member_id, app.member_id());
$$;

-- Shifts v2: float counted by note, optional invoice-number reservation for offline use ----------------

drop function if exists api.open_shift(uuid, bigint);
drop function if exists api.close_shift(uuid, bigint);

create or replace function api.open_shift(p_lane uuid, p_opening_float_cents bigint, p_denoms jsonb default null, p_reserve integer default 0)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_lane   public.lanes;
  v_shift  uuid;
  v_to     bigint;
begin
  perform app.require_perm('sale.create');
  select * into v_lane from public.lanes l where l.id = p_lane and l.tenant_id = v_tenant;
  if v_lane.id is null or not app.can_shop(v_lane.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_lane.status <> 'active' then
    raise exception 'FORBIDDEN: lane is disabled' using errcode = 'P0001';
  end if;
  if p_reserve < 0 or p_reserve > 500 then
    raise exception 'VALIDATION_ERROR: reserve 0–500 invoice numbers' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.shifts s where s.lane_id = p_lane and s.status = 'open') then
    raise exception 'SHIFT_ALREADY_OPEN' using errcode = 'P0001';
  end if;
  if p_reserve > 0 then
    update public.lanes set invoice_seq = invoice_seq + p_reserve where id = p_lane returning invoice_seq into v_to;
  end if;
  insert into public.shifts (tenant_id, shop_id, lane_id, opened_by, opening_float_cents, opening_denoms,
                             reserved_from, reserved_to)
  values (v_tenant, v_lane.shop_id, v_lane.id, app.lane_member(v_lane), p_opening_float_cents, p_denoms,
          case when p_reserve > 0 then v_to - p_reserve + 1 end, case when p_reserve > 0 then v_to end)
  returning id into v_shift;
  return jsonb_build_object('shiftId', v_shift,
    'reservedFrom', case when p_reserve > 0 then v_to - p_reserve + 1 end,
    'reservedTo', case when p_reserve > 0 then v_to end);
end $$;

-- Totals for the close-shift screen and the Z-report.
create or replace function api.shift_summary(p_shift uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_s public.shifts;
  v_cash bigint; v_change bigint; v_cash_bills bigint;
  v_other bigint; v_other_bills bigint;
  v_refunds bigint; v_refund_count bigint;
  v_pickups bigint; v_pickup_count bigint;
  v_total bigint; v_bills bigint; v_promo bigint; v_cn bigint;
begin
  select * into v_s from public.shifts s where s.id = p_shift and s.tenant_id = app.tenant_id();
  if v_s.id is null or not app.can_shop(v_s.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(sum(p.amount_cents) filter (where p.method = 'cash'), 0),
         count(distinct p.sale_id) filter (where p.method = 'cash'),
         coalesce(sum(p.amount_cents) filter (where p.method in ('card', 'lankaqr')), 0),
         count(distinct p.sale_id) filter (where p.method in ('card', 'lankaqr')),
         coalesce(sum(p.amount_cents) filter (where p.method = 'credit_note'), 0)
    into v_cash, v_cash_bills, v_other, v_other_bills, v_cn
    from public.sale_payments p join public.sales s on s.id = p.sale_id
   where s.shift_id = p_shift;
  select coalesce(sum(s.change_cents), 0), coalesce(sum(s.total_cents), 0), count(*), coalesce(sum(s.promo_cents), 0)
    into v_change, v_total, v_bills, v_promo
    from public.sales s where s.shift_id = p_shift;
  select coalesce(sum(r.total_cents), 0), count(*) into v_refunds, v_refund_count
    from public.returns r where r.shift_id = p_shift and r.settlement = 'cash';
  select coalesce(sum(c.amount_cents), 0), count(*) into v_pickups, v_pickup_count
    from public.cash_pickups c where c.shift_id = p_shift;

  return jsonb_build_object(
    'shiftId', v_s.id, 'shiftNo', v_s.shift_no, 'status', v_s.status, 'laneId', v_s.lane_id,
    'laneCode', (select l.code from public.lanes l where l.id = v_s.lane_id),
    'shopCode', (select sh.code from public.shops sh where sh.id = v_s.shop_id),
    'shopName', (select sh.name from public.shops sh where sh.id = v_s.shop_id),
    'cashier', (select m.display_name from public.members m where m.id = v_s.opened_by),
    'openedAt', v_s.opened_at, 'closedAt', v_s.closed_at,
    'openingFloatCents', v_s.opening_float_cents,
    'cashSalesCents', v_cash - v_change, 'cashBills', v_cash_bills,
    'cardQrCents', v_other, 'cardQrBills', v_other_bills, 'creditNoteCents', v_cn,
    'refundsCashCents', v_refunds, 'refundsCashCount', v_refund_count,
    'pickupsCents', v_pickups, 'pickupsCount', v_pickup_count,
    'salesTotalCents', v_total, 'bills', v_bills, 'promoCents', v_promo,
    'expectedCashCents', v_s.opening_float_cents + v_cash - v_change - v_refunds - v_pickups,
    'countedCashCents', v_s.counted_cash_cents, 'closingDenoms', v_s.closing_denoms, 'varianceNote', v_s.variance_note);
end $$;

create or replace function api.close_shift(p_shift uuid, p_counted_cash_cents bigint, p_denoms jsonb default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_s        public.shifts;
  v_summary  jsonb;
  v_expected bigint;
begin
  perform app.require_perm('sale.create');
  select * into v_s from public.shifts s where s.id = p_shift and s.tenant_id = app.tenant_id() for update;
  if v_s.id is null or not app.can_shop(v_s.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_s.status <> 'open' then
    raise exception 'SHIFT_NOT_OPEN' using errcode = 'P0001';
  end if;
  if p_counted_cash_cents < 0 then
    raise exception 'VALIDATION_ERROR: counted cash cannot be negative' using errcode = 'P0001';
  end if;

  v_summary := api.shift_summary(p_shift);
  v_expected := (v_summary ->> 'expectedCashCents')::bigint;

  update public.shifts set status = 'closed', closed_at = now(),
         closed_by = coalesce((select l.active_member_id from public.lanes l where l.id = v_s.lane_id), app.member_id()),
         expected_cash_cents = v_expected, counted_cash_cents = p_counted_cash_cents,
         closing_denoms = p_denoms, variance_note = nullif(trim(p_note), '')
   where id = p_shift;
  -- Shift closed: that lane's cashier session ends (blueprint §27.5.3).
  update public.lanes set active_member_id = null, active_since = null where id = v_s.lane_id;

  perform app.audit('shift.close', 'shifts', p_shift,
    jsonb_build_object('expected', v_expected, 'counted', p_counted_cash_cents, 'note', p_note));
  return jsonb_build_object('expectedCashCents', v_expected, 'countedCashCents', p_counted_cash_cents,
                            'varianceCents', p_counted_cash_cents - v_expected);
end $$;

create or replace function api.cash_pickup(p_shift uuid, p_amount_cents bigint, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_s  public.shifts;
  v_id uuid;
begin
  perform app.require_perm('cash.pickup');
  select * into v_s from public.shifts s where s.id = p_shift and s.tenant_id = app.tenant_id();
  if v_s.id is null or not app.can_shop(v_s.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_s.status <> 'open' then
    raise exception 'SHIFT_NOT_OPEN' using errcode = 'P0001';
  end if;
  if p_amount_cents <= 0 then
    raise exception 'VALIDATION_ERROR: amount must be positive' using errcode = 'P0001';
  end if;
  insert into public.cash_pickups (tenant_id, shop_id, shift_id, amount_cents, note, member_id)
  values (v_s.tenant_id, v_s.shop_id, p_shift, p_amount_cents, p_note, app.member_id())
  returning id into v_id;
  perform app.audit('cash.pickup', 'shifts', p_shift, jsonb_build_object('amount', p_amount_cents));
  return v_id;
end $$;

-- api.create_sale v3 ------------------------------------------------------------------------------------
-- Adds to v2: lane key check, PIN-unlocked cashier as the seller, credit-note payments (locked, hashed
-- code; the payment stores the note number, never the code) and lane-reserved invoice numbers.

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
  v_change   bigint;
  v_pay      jsonb;
  v_note     public.credit_notes;
  v_amount   bigint;
begin
  perform app.require_perm('sale.create');

  -- Idempotency: a retried request returns the first result (PRN-004).
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
  if (p ->> 'customerId') is not null
     and not exists (select 1 from public.customers c where c.id = (p ->> 'customerId')::uuid and c.tenant_id = v_tenant) then
    raise exception 'NOT_FOUND: customer' using errcode = 'P0001';
  end if;

  select pl.id into v_list from public.price_lists pl where pl.tenant_id = v_tenant and pl.is_default;

  -- Price every merged line on the server, in item order (stock rows always lock in the same order).
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
         coalesce(sum((x ->> 'amountCents')::bigint) filter (where x ->> 'method' = 'cash'), 0)
    into v_paid, v_cash
    from jsonb_array_elements(p -> 'payments') x;
  if v_paid < v_total then
    raise exception 'UNDERPAID' using errcode = 'P0001';
  end if;
  v_change := v_paid - v_total;
  if v_change > v_cash then
    raise exception 'VALIDATION_ERROR: change can only be given from cash' using errcode = 'P0001';
  end if;

  -- Credit notes: lock each note, check it, remember how much to take (blueprint §30.2 rules 1–4).
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

  -- Invoice number: a lane-reserved number (offline-capable) if given and valid, else the next one.
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
                            client_uuid, created_by)
  values (v_tenant, v_lane.shop_id, v_lane.id, v_shift.id, v_invoice, (p ->> 'customerId')::uuid, v_member,
          v_subtotal, v_promo, v_rounding, v_total, v_paid, v_change, v_client, auth.uid())
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

  -- Non-credit-note payments as sent; credit-note payments store the note number, never the code.
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

  return jsonb_build_object('id', v_sale, 'invoiceNo', v_invoice, 'subtotalCents', v_subtotal,
    'promoCents', v_promo, 'roundingCents', v_rounding, 'totalCents', v_total, 'changeCents', v_change,
    'receiptToken', (select s.receipt_token from public.sales s where s.id = v_sale), 'replayed', false);
end $$;

-- Credit-note lookup for the lane (balance, expiry, shop rule). Never returns the code.
create or replace function api.check_credit_note(p_code text, p_lane uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_note public.credit_notes;
  v_lane public.lanes;
  v_any  boolean;
begin
  perform app.require_perm('sale.create');
  select * into v_lane from public.lanes l where l.id = p_lane and l.tenant_id = app.tenant_id();
  if v_lane.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_note from public.credit_notes n where n.tenant_id = v_lane.tenant_id and n.code_hash = app.credit_note_hash(p_code);
  if v_note.id is null then
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

-- Returns (WF-004) ------------------------------------------------------------------------------------

-- The receipt being returned, with how much of each line can still come back.
create or replace function api.find_sale_for_return(p_invoice text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
begin
  perform app.require_perm('return.create');
  select * into v_sale from public.sales s
   where s.tenant_id = app.tenant_id() and upper(s.invoice_no) = upper(trim(p_invoice));
  if v_sale.id is null then
    raise exception 'NOT_FOUND: receipt' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'id', v_sale.id, 'invoiceNo', v_sale.invoice_no, 'createdAt', v_sale.created_at, 'totalCents', v_sale.total_cents,
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'balanceDueCents', c.balance_due_cents)
                   from public.customers c where c.id = v_sale.customer_id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('method', p.method, 'amountCents', p.amount_cents,
                                                              'reference', p.reference)), '[]')
                   from public.sale_payments p where p.sale_id = v_sale.id),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'saleLineId', l.id, 'itemId', l.item_id, 'name', l.item_name, 'itemType', l.item_type,
                'qtyMilli', l.qty_milli, 'netCents', l.net_cents, 'isReturnable', i.is_returnable,
                'returnedMilli', coalesce((select sum(rl.qty_milli) from public.return_lines rl where rl.sale_line_id = l.id), 0))
                order by l.line_no), '[]')
                from public.sale_lines l join public.items i on i.id = l.item_id where l.sale_id = v_sale.id));
end $$;

-- p: {clientUuid, laneId, laneKey?, saleId, settlement, lines:[{saleLineId, qtyMilli, reason, restock}],
--     supervisorMemberId?, supervisorPin?}
-- Returns {ok:true, returnNo, totalCents, creditNote?} or {ok:false, error} for PIN problems.
create or replace function api.process_return(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant     uuid := app.tenant_id();
  v_client     uuid := (p ->> 'clientUuid')::uuid;
  v_settle     public.return_settlement := (p ->> 'settlement')::public.return_settlement;
  v_lane       public.lanes;
  v_sale       public.sales;
  v_existing   public.returns;
  v_shift      uuid;
  v_member     uuid;
  v_approver   uuid;
  v_pin        text;
  v_limit      bigint;
  v_total      bigint := 0;
  v_return     uuid;
  v_return_no  text;
  v_line       jsonb;
  v_sl         record;
  v_qty        bigint;
  v_value      bigint;
  v_rl         uuid;
  v_note       jsonb;
  v_paid_cn    boolean;
begin
  perform app.require_perm('return.create');

  select * into v_existing from public.returns r where r.tenant_id = v_tenant and r.client_uuid = v_client;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'returnNo', v_existing.return_no, 'totalCents', v_existing.total_cents,
                              'settlement', v_existing.settlement, 'replayed', true);
  end if;

  select * into v_lane from public.lanes l where l.id = (p ->> 'laneId')::uuid and l.tenant_id = v_tenant;
  if v_lane.id is null or not app.can_shop(v_lane.shop_id) then
    raise exception 'NOT_FOUND: lane' using errcode = 'P0001';
  end if;
  if not app.lane_key_ok(v_lane, p ->> 'laneKey') then
    raise exception 'LANE_KEY_INVALID' using errcode = 'P0001';
  end if;
  v_member := app.lane_member(v_lane);

  select * into v_sale from public.sales s where s.id = (p ->> 'saleId')::uuid and s.tenant_id = v_tenant for share;
  if v_sale.id is null then
    raise exception 'NOT_FOUND: receipt' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then
    raise exception 'VALIDATION_ERROR: choose at least one item' using errcode = 'P0001';
  end if;

  -- Value of each line, checked against what is left to return (BR-040: never more than was paid).
  create temp table if not exists pg_temp.ret_calc (sale_line_id uuid primary key, item_id uuid, item_name text,
    qty bigint, value bigint, reason public.return_reason, restock public.restock_action) on commit drop;
  truncate pg_temp.ret_calc;

  for v_line in select x from jsonb_array_elements(p -> 'lines') x loop
    select l.*, i.is_returnable, i.cost_cents,
           coalesce((select sum(rl.qty_milli) from public.return_lines rl where rl.sale_line_id = l.id), 0) as returned
      into v_sl
      from public.sale_lines l join public.items i on i.id = l.item_id
     where l.id = (v_line ->> 'saleLineId')::uuid and l.sale_id = v_sale.id
     for update of l;
    v_qty := (v_line ->> 'qtyMilli')::bigint;
    if v_sl.id is null then
      raise exception 'NOT_FOUND: sale line' using errcode = 'P0001';
    end if;
    if not v_sl.is_returnable then
      raise exception 'NOT_RETURNABLE: %', v_sl.item_name using errcode = 'P0001';
    end if;
    if v_qty <= 0 or v_qty > v_sl.qty_milli - v_sl.returned then
      raise exception 'RETURN_QTY_EXCEEDED: %', v_sl.item_name using errcode = 'P0001';
    end if;
    v_value := app.div_round(v_sl.net_cents * v_qty, v_sl.qty_milli);
    insert into pg_temp.ret_calc values (v_sl.id, v_sl.item_id, v_sl.item_name, v_qty, v_value,
      coalesce(v_line ->> 'reason', 'other')::public.return_reason, coalesce(v_line ->> 'restock', 'sellable')::public.restock_action);
    v_total := v_total + v_value;
  end loop;

  if v_total <= 0 then
    raise exception 'VALIDATION_ERROR: nothing to refund' using errcode = 'P0001';
  end if;

  -- Goods paid with a credit note go back to a credit note, never cash (§30.2 rule 5).
  v_paid_cn := exists (select 1 from public.sale_payments sp where sp.sale_id = v_sale.id and sp.method = 'credit_note');
  if v_paid_cn and v_settle not in ('credit_note', 'exchange') then
    raise exception 'VALIDATION_ERROR: this bill was paid with a credit note, so the refund must be a credit note' using errcode = 'P0001';
  end if;

  if v_settle = 'cash' then
    select s.id into v_shift from public.shifts s where s.lane_id = v_lane.id and s.status = 'open';
    if v_shift is null then
      raise exception 'SHIFT_NOT_OPEN' using errcode = 'P0001';
    end if;
    select t.cash_refund_pin_cents into v_limit from public.tenants t where t.id = v_tenant;
    if v_total > v_limit then
      if (p ->> 'supervisorMemberId') is null then
        return jsonb_build_object('ok', false, 'error', 'SUPERVISOR_PIN_REQUIRED', 'limitCents', v_limit);
      end if;
      select m.id into v_approver from public.members m join public.roles r on r.id = m.role_id
       where m.id = (p ->> 'supervisorMemberId')::uuid and m.tenant_id = v_tenant and m.is_active
         and (r.permissions & 1024) <> 0;   -- shift.manage = supervisor
      if v_approver is null then
        return jsonb_build_object('ok', false, 'error', 'SUPERVISOR_PIN_REQUIRED', 'limitCents', v_limit);
      end if;
      v_pin := app.check_pin(v_approver, p ->> 'supervisorPin');
      if v_pin <> 'ok' then
        return jsonb_build_object('ok', false, 'error', case v_pin when 'locked' then 'PIN_LOCKED' else 'PIN_INVALID' end);
      end if;
    end if;
  elsif v_settle = 'original' then
    if not exists (select 1 from public.sale_payments sp where sp.sale_id = v_sale.id and sp.method in ('card', 'lankaqr')) then
      raise exception 'VALIDATION_ERROR: the bill was not paid by card or LankaQR' using errcode = 'P0001';
    end if;
  elsif v_settle = 'credit_balance' then
    if v_sale.customer_id is null then
      raise exception 'CUSTOMER_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  v_return_no := app.next_doc_no(v_lane.shop_id, 'RTN');
  insert into public.returns (tenant_id, shop_id, lane_id, shift_id, sale_id, return_no, customer_id, settlement,
                              total_cents, member_id, approved_by, client_uuid, created_by)
  values (v_tenant, v_lane.shop_id, v_lane.id, v_shift, v_sale.id, v_return_no, v_sale.customer_id, v_settle,
          v_total, v_member, v_approver, v_client, auth.uid())
  returning id into v_return;

  for v_sl in select * from pg_temp.ret_calc order by item_id loop
    insert into public.return_lines (return_id, tenant_id, shop_id, sale_line_id, item_id, item_name, qty_milli,
                                     value_cents, reason, restock)
    values (v_return, v_tenant, v_lane.shop_id, v_sl.sale_line_id, v_sl.item_id, v_sl.item_name, v_sl.qty,
            v_sl.value, v_sl.reason, v_sl.restock)
    returning id into v_rl;

    if v_sl.restock = 'sellable' then
      perform app.post_movement(v_tenant, v_lane.shop_id, v_sl.item_id, v_sl.qty, 'return', 'return', v_return);
    else
      -- Damaged returns go to the damaged bucket and wait for a manager's decision (§30.1).
      insert into public.stock_levels (shop_id, item_id, tenant_id, damaged_milli)
      values (v_lane.shop_id, v_sl.item_id, v_tenant, v_sl.qty)
      on conflict (shop_id, item_id) do update
        set damaged_milli = public.stock_levels.damaged_milli + excluded.damaged_milli, updated_at = now();
      insert into public.damage_reports (tenant_id, shop_id, report_no, item_id, qty_milli, remaining_milli,
                                         unit_cost_cents, source, source_ref_id, reason, note, status, reported_by)
      select v_tenant, v_lane.shop_id, app.next_doc_no(v_lane.shop_id, 'DMG'), v_sl.item_id, v_sl.qty, v_sl.qty,
             coalesce(i.cost_cents, 0), 'customer_return', v_rl,
             case v_sl.reason when 'expired' then 'expired'::public.damage_reason else 'other'::public.damage_reason end,
             'Customer return ' || v_return_no, 'awaiting_decision', v_member
        from public.items i where i.id = v_sl.item_id;
    end if;
  end loop;

  if v_settle in ('credit_note', 'exchange') then
    v_note := app.issue_credit_note(v_tenant, v_lane.shop_id, v_total, v_return, v_sale.customer_id, v_member,
                                    case when v_settle = 'exchange' then 'Exchange' else null end);
  elsif v_settle = 'credit_balance' then
    update public.customers set balance_due_cents = balance_due_cents - v_total where id = v_sale.customer_id;
  end if;

  perform app.audit('return.create', 'returns', v_return,
    jsonb_build_object('settlement', v_settle, 'total', v_total, 'sale_id', v_sale.id, 'approved_by', v_approver));
  return jsonb_build_object('ok', true, 'returnNo', v_return_no, 'totalCents', v_total, 'settlement', v_settle,
                            'creditNote', v_note, 'replayed', false);
end $$;

-- Back-office credit note actions --------------------------------------------------------------------

create or replace function api.extend_credit_note(p_note uuid, p_days integer, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('settings.manage');
  if p_days not between 1 and 365 or char_length(coalesce(p_reason, '')) < 3 then
    raise exception 'VALIDATION_ERROR: 1–365 days and a reason' using errcode = 'P0001';
  end if;
  update public.credit_notes
     set expires_on = greatest(expires_on, (now() at time zone 'Asia/Colombo')::date) + p_days,
         status = case when status = 'expired' then (case when balance_cents < amount_cents then 'partially_used' else 'active' end)::public.credit_note_status else status end
   where id = p_note and tenant_id = app.tenant_id() and status in ('active', 'partially_used', 'expired');
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.audit('credit_note.extend', 'credit_notes', p_note, jsonb_build_object('days', p_days, 'reason', p_reason));
end $$;

create or replace function api.cancel_credit_note(p_note uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('settings.manage');
  if char_length(coalesce(p_reason, '')) < 3 then
    raise exception 'VALIDATION_ERROR: give a reason' using errcode = 'P0001';
  end if;
  update public.credit_notes set status = 'cancelled', reason = p_reason
   where id = p_note and tenant_id = app.tenant_id() and status in ('active', 'partially_used');
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.audit('credit_note.cancel', 'credit_notes', p_note, jsonb_build_object('reason', p_reason));
end $$;

-- Lane customer actions (cashiers have sale.create, not customer.manage) ---------------------------------

create or replace function api.lane_add_customer(p_name text, p_phone text, p_consent boolean default false)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.require_perm('sale.create');
  insert into public.customers (tenant_id, name, phone, marketing_consent, created_by)
  values (app.tenant_id(), trim(p_name), p_phone, coalesce(p_consent, false), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function api.set_marketing_consent(p_customer uuid, p_consent boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('sale.create');
  update public.customers set marketing_consent = p_consent
   where id = p_customer and tenant_id = app.tenant_id();
  perform app.audit('customer.consent', 'customers', p_customer, jsonb_build_object('consent', p_consent));
end $$;

-- Offline sync issues ------------------------------------------------------------------------------------

create or replace function api.report_sync_issue(p_lane uuid, p_client_uuid uuid, p_payload jsonb, p_code text, p_message text)
returns void
language plpgsql security definer
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
  insert into public.sync_issues (tenant_id, shop_id, lane_id, client_uuid, payload, error_code, error_message)
  values (v_lane.tenant_id, v_lane.shop_id, v_lane.id, p_client_uuid, p_payload, left(p_code, 60), left(p_message, 300))
  on conflict (tenant_id, client_uuid) do update
    set error_code = excluded.error_code, error_message = excluded.error_message, payload = excluded.payload
    where public.sync_issues.status = 'open';
end $$;

create or replace function api.resolve_sync_issue(p_issue uuid, p_status text, p_note text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('shift.manage');
  if p_status not in ('resolved', 'discarded') then
    raise exception 'VALIDATION_ERROR: status must be resolved or discarded' using errcode = 'P0001';
  end if;
  update public.sync_issues
     set status = p_status::public.sync_issue_status, resolution_note = p_note, resolved_by = app.member_id(), resolved_at = now()
   where id = p_issue and tenant_id = app.tenant_id() and app.can_shop(shop_id) and status = 'open';
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
end $$;

-- Digital receipt (public, by unguessable token; no customer details) -------------------------------------

grant usage on schema api to anon;

create or replace function api.public_receipt(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_sale public.sales;
begin
  if p_token !~ '^[0-9a-f]{32}$' then
    return null;
  end if;
  select * into v_sale from public.sales s where s.receipt_token = p_token;
  if v_sale.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'tenant', (select t.name from public.tenants t where t.id = v_sale.tenant_id),
    'shop', (select jsonb_build_object('name', sh.name, 'code', sh.code, 'address', sh.address, 'phone', sh.phone)
               from public.shops sh where sh.id = v_sale.shop_id),
    'lane', (select l.code from public.lanes l where l.id = v_sale.lane_id),
    'cashier', (select split_part(m.display_name, ' ', 1) from public.members m where m.id = v_sale.member_id),
    'invoiceNo', v_sale.invoice_no, 'createdAt', v_sale.created_at,
    'subtotalCents', v_sale.subtotal_cents, 'promoCents', v_sale.promo_cents, 'roundingCents', v_sale.rounding_cents,
    'totalCents', v_sale.total_cents, 'paidCents', v_sale.paid_cents, 'changeCents', v_sale.change_cents,
    'lines', (select jsonb_agg(jsonb_build_object('name', l.item_name, 'itemType', l.item_type, 'qtyMilli', l.qty_milli,
                                                  'unitPriceCents', l.unit_price_cents, 'grossCents', l.gross_cents,
                                                  'promoCents', l.promo_cents) order by l.line_no)
                from public.sale_lines l where l.sale_id = v_sale.id),
    'payments', (select jsonb_agg(jsonb_build_object('method', p.method, 'amountCents', p.amount_cents))
                   from public.sale_payments p where p.sale_id = v_sale.id));
end $$;

-- Lane catalogue v2: adds registration, unlocked cashier and the shift's reserved invoice range ------------

create or replace function api.lane_catalog(p_lane uuid)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_lane   public.lanes;
  v_tenant public.tenants;
  v_shift  public.shifts;
begin
  select * into v_lane from public.lanes l where l.id = p_lane;  -- RLS hides other tenants' lanes
  if v_lane.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_tenant from public.tenants t where t.id = v_lane.tenant_id;
  select * into v_shift from public.shifts s where s.lane_id = v_lane.id and s.status = 'open';

  return jsonb_build_object(
    'lane', jsonb_build_object('id', v_lane.id, 'code', v_lane.code, 'name', v_lane.name, 'status', v_lane.status,
                               'registered', v_lane.key_hash is not null),
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
                'priceCents', pli.price_cents, 'mrpCents', i.mrp_cents, 'isPinned', i.is_pinned, 'taxClass', i.tax_class,
                'isReturnable', i.is_returnable, 'stockMilli', coalesce(sl.qty_milli, 0),
                'barcodes', (select coalesce(jsonb_agg(b.code), '[]') from public.barcodes b where b.item_id = i.id))
                order by i.name), '[]')
                from public.items i
                join public.price_lists pl on pl.tenant_id = i.tenant_id and pl.is_default
                left join public.price_list_items pli on pli.price_list_id = pl.id and pli.item_id = i.id
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

-- Grants -----------------------------------------------------------------------------------------------

revoke all on all functions in schema api from public, anon;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema api to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
revoke all on function app.check_pin(uuid, text) from authenticated;
revoke all on function app.issue_credit_note(uuid, uuid, bigint, uuid, uuid, uuid, text) from authenticated;
revoke all on function app.credit_note_hash(text) from authenticated;
revoke all on function app.post_movement from authenticated;
grant execute on function api.public_receipt(text) to anon;
