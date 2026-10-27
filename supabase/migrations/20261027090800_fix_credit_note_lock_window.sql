-- Fix for 20261027090000: the wrong-code count for credit-note look-ups had no time limit, so after a lock ended a
-- single new wrong code locked the lane again. Only wrong codes from the last 5 minutes count now (blueprint §30.3:
-- "5 failed codes in a row lock the lookup for 5 minutes").

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
  -- Wrong codes in a row (since the last good one) within the last 5 minutes; older ones no longer count, so the
  -- lock ends 5 minutes after the last wrong code and the count starts again.
  select count(*), max(a.at) into v_fails, v_last from public.lookup_attempts a
   where a.lane_id = p_lane and a.kind = 'credit_note' and not a.ok and a.at > now() - interval '5 minutes'
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
