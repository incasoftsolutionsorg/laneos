-- LaneOS foundation: schemas, extensions, id generator, enums and shared triggers.
-- Conventions: blueprint §22.1 (money in cents, quantities in milli-units, uuid v7 keys).

create schema if not exists app;      -- helper functions used by RLS and other functions
create schema if not exists api;      -- functions the app calls with supabase.rpc()
create schema if not exists private;  -- service-only objects; nothing is granted on it

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

grant usage on schema app to authenticated, service_role;
grant usage on schema api to authenticated, service_role;
revoke all on schema private from public, anon, authenticated;

-- Time-ordered uuid v7 (Postgres 17 has no built-in uuidv7()).
create or replace function app.uuid_v7()
returns uuid
language sql volatile
set search_path = ''
as $$
  select encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
              placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
              from 1 for 6),
      52, 1), 53, 1),
    'hex')::uuid;
$$;

-- Enums ------------------------------------------------------------------------------------

create type public.tenant_status as enum ('trial', 'active', 'past_due', 'suspended', 'cancelled');
create type public.lane_status as enum ('active', 'disabled');
create type public.item_type as enum ('standard', 'weighed', 'pack', 'open_price');
create type public.tax_class as enum ('standard', 'exempt', 'zero');
create type public.promotion_kind as enum ('multi_buy', 'percent_off');
create type public.movement_reason as enum
  ('opening', 'sale', 'return', 'grn', 'adjustment', 'wastage', 'damage', 'transfer_in', 'transfer_out', 'count');
create type public.shift_status as enum ('open', 'closed');
create type public.payment_method as enum ('cash', 'card', 'lankaqr', 'credit_note');
create type public.reset_scope as enum ('user', 'lane', 'shop', 'tenant', 'platform');

-- Shared triggers ---------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Master data: id and tenant_id never change once written (blueprint §22.3).
create or replace function app.protect_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id then
    raise exception 'VALIDATION_ERROR: id and tenant_id cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Ledgers and financial records are append-only (PRN-003).
create or replace function app.append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'FORBIDDEN: % is append-only', tg_table_name using errcode = 'P0001';
end $$;
