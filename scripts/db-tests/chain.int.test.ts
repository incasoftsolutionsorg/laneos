// Head office against staging (migration 20261023090900): shops, shop prices (catalogue + server price),
// scheduled price changes, transfers with a variance, cross-shop read functions.
// Puts the demo tenant on Multi-store with a second shop CMB2 (created once, kept for the demo).

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let owner: SupabaseClient;
let api: ReturnType<SupabaseClient['schema']>;
let kdy: string;
let cmb: string;
let itemId: string;
const tag = randomUUID().slice(0, 4).toUpperCase();

const level = async (shop: string) =>
  (await owner.from('stock_levels').select('qty_milli').eq('shop_id', shop).eq('item_id', itemId).maybeSingle()).data?.qty_milli ?? 0;

beforeAll(async () => {
  owner = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await owner.auth.signInWithPassword({ email: process.env.DEMO_OWNER_EMAIL!, password: process.env.DEMO_OWNER_PASSWORD! });
  if (error) throw error;
  api = owner.schema('api');
  const { data: plan } = await owner.from('tenants').select('plan_id').single();
  if (plan!.plan_id !== 'growth') {
    const r = await api.rpc('change_plan', { p_plan: 'growth' });
    if (r.error) throw r.error;
  }
  kdy = (await owner.from('shops').select('id').eq('code', 'KDY1').single()).data!.id;
  let { data: c } = await owner.from('shops').select('id').eq('code', 'CMB2').maybeSingle();
  if (!c) {
    const r = await api.rpc('add_shop', { p_code: 'CMB2', p_name: 'Colombo 7', p_address: '45 Ward Place, Colombo 7', p_phone: '+94112223344' });
    if (r.error) throw r.error;
    c = { id: r.data as string };
  }
  cmb = c.id;
  await owner.auth.refreshSession(); // the token's shop list now includes CMB2
  const up = await api.rpc('upsert_item', { p: { name: `ZZ Test Tea ${tag}`, priceCents: 50000, costCents: 35000 } });
  if (up.error) throw up.error;
  itemId = up.data as string;
  await api.rpc('adjust_stock', { p_shop: kdy, p_item: itemId, p_qty_milli: 20_000, p_reason: 'opening' });
}, 60_000);

afterAll(async () => {
  await owner.from('items').update({ is_active: false }).eq('id', itemId);
});

describe('shops', () => {
  it('CMB2 exists with lane L1 and the plan limit is enforced', async () => {
    const { data: lanes } = await owner.from('lanes').select('code').eq('shop_id', cmb);
    expect(lanes!.map((l) => l.code)).toContain('L1');
    expect((await api.rpc('add_shop', { p_code: 'KDY1', p_name: 'Dup', p_address: '', p_phone: '' })).error).not.toBeNull();
  });
});

describe('shop prices', () => {
  it('an override changes the lane catalogue and the server price for that shop only', async () => {
    expect((await api.rpc('set_shop_price', { p_shop: cmb, p_item: itemId, p_price_cents: 47500 })).error).toBeNull();
    // CMB2 L2 is never registered by any test (security tests register L1), so it sells without a device key.
    let { data: l2 } = await owner.from('lanes').select('id').eq('shop_id', cmb).eq('code', 'L2').maybeSingle();
    if (!l2) { await api.rpc('add_lane', { p_shop_id: cmb, p_name: 'Lane 2' }); ({ data: l2 } = await owner.from('lanes').select('id').eq('shop_id', cmb).eq('code', 'L2').maybeSingle()); }
    const laneC = l2!.id;
    const laneK = (await owner.from('lanes').select('id, shop:shops!inner(code)').eq('shop.code', 'KDY1').eq('code', 'L1').single()).data!.id;
    const price = async (lane: string) => ((await api.rpc('lane_catalog', { p_lane: lane })).data as { items: { id: string; priceCents: number }[] }).items.find((i) => i.id === itemId)!.priceCents;
    expect(await price(laneC)).toBe(47500);
    expect(await price(laneK)).toBe(50000);

    // Server truth: a sale at CMB2 is priced with the override.
    await api.rpc('open_shift', { p_lane: laneC, p_opening_float_cents: 0 });
    await api.rpc('adjust_stock', { p_shop: cmb, p_item: itemId, p_qty_milli: 5_000, p_reason: 'opening' });
    const { data: t } = await owner.from('tenants').select('rounding_unit_cents').single();
    const unit = t!.rounding_unit_cents;
    const expected = unit <= 1 ? 47500 : Math.round(47500 / unit) * unit;
    const sale = await api.rpc('create_sale', { p: {
      clientUuid: randomUUID(), laneId: laneC, lines: [{ itemId, qtyMilli: 1000 }], payments: [{ method: 'cash', amountCents: 50000 }], expectedTotalCents: expected,
    } });
    expect(sale.error).toBeNull();
    expect((sale.data as { totalCents: number }).totalCents).toBe(expected);

    expect((await api.rpc('set_shop_price', { p_shop: cmb, p_item: itemId, p_price_cents: null })).error).toBeNull();
    expect(await price(laneC)).toBe(50000);
  });
});

describe('scheduled price changes', () => {
  it('applies a due change to the central price and refuses a past start', async () => {
    const r = await api.rpc('save_price_schedule', { p: { name: `ZZ change ${tag}`, startsAt: new Date().toISOString(), lines: [{ itemId, priceCents: 52000 }] } });
    expect(r.error).toBeNull();
    expect(await api.rpc('apply_due_price_schedules').then((x) => x.data)).toBeGreaterThanOrEqual(1);
    const { data: s } = await owner.from('price_schedules').select('status').eq('id', r.data as string).single();
    expect(s!.status).toBe('applied');
    const { data: pli } = await owner.from('price_list_items').select('price_cents').eq('item_id', itemId).single();
    expect(pli!.price_cents).toBe(52000);
    expect((await api.rpc('save_price_schedule', { p: { name: 'past', startsAt: '2020-01-01T00:00:00Z', lines: [{ itemId, priceCents: 1 }] } })).error?.message).toMatch(/in the past/);
  });
});

describe('transfers', () => {
  it('request → approve → dispatch → receive short → close moves stock and records the variance', async () => {
    const k0 = await level(kdy);
    const c0 = await level(cmb);
    const r = await api.rpc('request_transfer', { p: { fromShopId: kdy, toShopId: cmb, note: 'test', lines: [{ itemId, qtyMilli: 5000 }] } });
    expect(r.error).toBeNull();
    const id = (r.data as { id: string; transferNo: string }).id;
    expect((r.data as { transferNo: string }).transferNo).toMatch(/^TRF-KDY1-\d{6}$/);
    expect((await api.rpc('transfer_action', { p_id: id, p_action: 'dispatch', p: {} })).error?.message).toMatch(/approve the transfer first/);
    expect((await api.rpc('transfer_action', { p_id: id, p_action: 'approve', p: {} })).error).toBeNull();
    expect((await api.rpc('transfer_action', { p_id: id, p_action: 'dispatch', p: { lines: [{ itemId, qtyMilli: 5000 }] } })).error).toBeNull();
    expect(await level(kdy)).toBe(k0 - 5000);
    expect((await api.rpc('transfer_action', { p_id: id, p_action: 'receive', p: { lines: [{ itemId, qtyMilli: 4000 }] } })).error).toBeNull();
    expect(await level(cmb)).toBe(c0 + 4000);
    expect((await owner.from('transfers').select('status').eq('id', id).single()).data!.status).toBe('received_with_variance');
    expect((await api.rpc('transfer_action', { p_id: id, p_action: 'close', p: { note: 'One carton crushed in the van' } })).error).toBeNull();
    expect((await owner.from('transfers').select('status').eq('id', id).single()).data!.status).toBe('closed');
  });
});

describe('head office reads', () => {
  it('overview, report and stock grid cover both shops', async () => {
    const ov = (await api.rpc('chain_overview')).data as { code: string }[];
    expect(ov.map((s) => s.code)).toEqual(expect.arrayContaining(['KDY1', 'CMB2']));
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const rep = (await api.rpc('chain_report', { p_from: today, p_to: today })).data as { code: string; sales: number }[];
    expect(rep.find((s) => s.code === 'CMB2')!.sales).toBeGreaterThan(0);
    const grid = (await api.rpc('stock_across_shops', { p_search: `ZZ Test Tea ${tag}`, p_department: null, p_low_only: false })).data as { shops: Record<string, number> }[];
    expect(grid[0]!.shops[kdy]).toBe(20_000 - 5000);
    expect(grid[0]!.shops[cmb]).toBe(5000 - 1000 + 4000);
  });
});
