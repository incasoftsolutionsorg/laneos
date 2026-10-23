-- Security fix: members.pin_hash and lanes.key_hash were readable by every signed-in member of the
-- tenant through the API. A 4–6 digit PIN hash can be brute-forced offline, so both columns are now
-- hidden (column-level grants). Functions (SECURITY DEFINER) still use them. members.has_pin replaces
-- the "does this person have a PIN?" check.

alter table public.members add column has_pin boolean generated always as (pin_hash is not null) stored;

revoke select on public.members from authenticated;
grant select (id, tenant_id, user_id, role_id, display_name, phone, all_shops, perm_v, is_active, created_at,
              updated_at, created_by, pin_failures, pin_locked_until, has_pin)
  on public.members to authenticated;

revoke select on public.lanes from authenticated;
grant select (id, tenant_id, shop_id, code, name, status, registered_at, last_seen_at, invoice_seq, created_at,
              updated_at, created_by, active_member_id, active_since)
  on public.lanes to authenticated;
-- lanes_update policy (staff.manage) may still change name/status; key_hash only via api.register_lane.
revoke update on public.lanes from authenticated;
grant update (name, status) on public.lanes to authenticated;
