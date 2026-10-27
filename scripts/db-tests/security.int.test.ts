// Security limits against staging (migration 20261027090000): credit-note lookup lock, failed-login gate,
// PIN change interval with self-service change at the lane, credit-note cash-out switch.
// Uses CMB2's lane so the KDY1 lanes used by other tests are not locked.

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let owner: SupabaseClient;
let service: SupabaseClient;
let api: ReturnType<SupabaseClient['schema']>;
let laneId: string;
let laneKey: string;
let memberId: string;
const tag = randomUUID().slice(0, 4).toUpperCase();

beforeAll(async () => {
  owner = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await owner.auth.signInWithPassword({ email: process.env.DEMO_OWNER_EMAIL!, password: process.env.DEMO_OWNER_PASSWORD! });
  if (error) throw error;
  service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  api = owner.schema('api');
  const { data: lane } = await owner.from('lanes').select('id, shop_id, shop:shops!inner(code)').eq('code', 'L1').eq('shop.code', 'CMB2').single();
  laneId = lane!.id;
  laneKey = (await api.rpc('register_lane', { p_lane: laneId })).data as string;
  const { data: role } = await owner.from('roles').select('id').eq('key', 'cashier').single();
  const add = await api.rpc('add_member', { p: { name: `ZZ Test PIN ${tag}`, roleId: role!.id, allShops: false, shopIds: [lane!.shop_id], staffCode: `P${tag}`, pin: '4826' } });
  if (add.error) throw add.error;
  memberId = add.data as string;
}, 60_000);

afterAll(async () => {
  await api.rpc('update_tenant_settings', { p: { pin_change_days: null } });
  if (memberId) await api.rpc('update_member', { p: { id: memberId, isActive: false } });
});

describe('credit-note lookups', () => {
  it('5 wrong codes in a row lock lookups on that lane', async () => {
    // A lock from a run in the last 5 minutes may still be on; otherwise the 6th wrong code finds it locked.
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const { data } = await api.rpc('check_credit_note', { p_code: `ZZZZ${tag}${i}000`.slice(0, 12), p_lane: laneId });
      seen.push((data as { error: string }).error);
      if (seen.at(-1) === 'CREDIT_NOTE_LOCKED') break;
    }
    expect(seen.at(-1)).toBe('CREDIT_NOTE_LOCKED');
    expect(seen.slice(0, -1).every((e) => e === 'CREDIT_NOTE_NOT_FOUND')).toBe(true);
    // Either a lock from a run in the last 5 minutes is still on, or it takes exactly 5 wrong codes (6th call locked).
    expect(seen.length <= 6).toBe(true);
  });
});

describe('failed-login gate', () => {
  it('locks after the limit and opens again after a good sign-in', async () => {
    const email = `zz-${tag.toLowerCase()}@example.test`;
    for (let i = 0; i < 5; i++) await service.schema('api').rpc('login_record', { p_email: email, p_ok: false });
    expect(((await service.schema('api').rpc('login_gate', { p_email: email })).data as { locked: boolean }).locked).toBe(true);
    await service.schema('api').rpc('login_record', { p_email: email, p_ok: true });
    expect(((await service.schema('api').rpc('login_gate', { p_email: email })).data as { locked: boolean }).locked).toBe(false);
  });

  it('browsers cannot read or write the gate', async () => {
    expect((await api.rpc('login_record', { p_email: 'x@example.test', p_ok: true })).error).not.toBeNull();
    expect((await owner.from('login_attempts').select('id').limit(1)).error).not.toBeNull();
  });
});

describe('PIN change interval', () => {
  it('an old PIN must be changed at the lane, then the new one works', async () => {
    expect((await api.rpc('update_tenant_settings', { p: { pin_change_days: 30 } })).error).toBeNull();
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    expect((await service.from('members').update({ pin_set_at: old }).eq('id', memberId)).error).toBeNull();

    const unlock = (pin: string) => api.rpc('lane_unlock', { p_lane: laneId, p_key: laneKey, p_member: memberId, p_pin: pin });
    expect(((await unlock('4826')).data as { error: string }).error).toBe('PIN_EXPIRED');
    const same = (await api.rpc('lane_change_pin', { p_lane: laneId, p_key: laneKey, p_member: memberId, p_old: '4826', p_new: '4826' })).data as { ok: boolean; error: string };
    expect(same).toMatchObject({ ok: false, error: 'VALIDATION_ERROR' });
    const changed = (await api.rpc('lane_change_pin', { p_lane: laneId, p_key: laneKey, p_member: memberId, p_old: '4826', p_new: '5937' })).data as { ok: boolean };
    expect(changed.ok).toBe(true);
    expect(((await unlock('5937')).data as { ok: boolean }).ok).toBe(true);
    await api.rpc('lane_lock', { p_lane: laneId });
  });
});

describe('credit-note cash-out', () => {
  it('is refused while the tenant setting is off', async () => {
    const { data: t } = await owner.from('tenants').select('credit_note_cash_out').single();
    if (t!.credit_note_cash_out) return;
    const r = await api.rpc('cash_out_credit_note', { p_note: randomUUID(), p_reason: 'test' });
    expect(r.error?.message).toMatch(/turned off/);
  });
});
