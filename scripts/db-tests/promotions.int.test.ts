// Promotions v2 and loyalty against staging (migrations 20261027090400/0500): the lane's pricing engine and
// api.create_sale must agree on mix-and-match, members-only spend-X deals and loyalty points (earn, spend, return).
// Sells on CMB2 L2 (never registered). Its promotions are switched off and loyalty restored afterwards.

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { priceBasket, pointsEarned, type Promotion } from '@laneos/pricing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let owner: SupabaseClient;
let api: ReturnType<SupabaseClient['schema']>;
let laneId: string;
let shopId: string;
let customerId: string;
let rounding: number;
let loyaltyBefore: Record<string, unknown>;
const items: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' };
const promoIds: string[] = [];
const tag = randomUUID().slice(0, 4).toUpperCase();
const PRICE = { a: 12000, b: 10000, c: 9000 };

/** Prices a basket the way the lane does, from the catalogue's promotions. */
async function lanePrice(lines: { id: string; qty: number }[], member: boolean) {
  const cat = (await api.rpc('lane_catalog', { p_lane: laneId })).data as {
    items: { id: string; priceCents: number; itemType: string }[];
    promotions: { id: string; kind: string; itemIds: string[]; buyQty: number | null; bundlePriceCents: number | null; percentBp: number | null;
      thresholdCents: number | null; discountCents: number | null; membersOnly: boolean }[];
  };
  const promos = cat.promotions.map((p): Promotion => ({
    id: p.id, itemIds: p.itemIds, membersOnly: p.membersOnly,
    ...(p.kind === 'threshold' ? { kind: 'threshold', thresholdCents: p.thresholdCents!, discountCents: p.discountCents, percentBp: p.percentBp }
      : p.kind === 'percent_off' ? { kind: 'percent_off', percentBp: p.percentBp! }
      : { kind: p.kind as 'multi_buy' | 'mix_match', buyQty: p.buyQty!, bundlePriceCents: p.bundlePriceCents! }),
  }) as Promotion);
  const basket = lines.map((l) => {
    const it = cat.items.find((i) => i.id === l.id)!;
    return { itemId: l.id, itemType: it.itemType as 'standard', qtyMilli: l.qty * 1000, unitPriceCents: it.priceCents };
  });
  return priceBasket(basket, promos, { roundingUnitCents: rounding, member });
}

async function sell(lines: { id: string; qty: number }[], payments: { method: string; amountCents: number }[], member: boolean, expected: number) {
  return api.rpc('create_sale', { p: {
    clientUuid: randomUUID(), laneId, customerId: member ? customerId : null,
    lines: lines.map((l) => ({ itemId: l.id, qtyMilli: l.qty * 1000 })), payments, expectedTotalCents: expected,
  } });
}

beforeAll(async () => {
  owner = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await owner.auth.signInWithPassword({ email: process.env.DEMO_OWNER_EMAIL!, password: process.env.DEMO_OWNER_PASSWORD! });
  if (error) throw error;
  await owner.auth.refreshSession();
  api = owner.schema('api');
  const { data: shop } = await owner.from('shops').select('id, tenant_id').eq('code', 'CMB2').single();
  shopId = shop!.id;
  let { data: l2 } = await owner.from('lanes').select('id').eq('shop_id', shopId).eq('code', 'L2').maybeSingle();
  if (!l2) { await api.rpc('add_lane', { p_shop_id: shopId, p_name: 'Lane 2' }); ({ data: l2 } = await owner.from('lanes').select('id').eq('shop_id', shopId).eq('code', 'L2').maybeSingle()); }
  laneId = l2!.id;
  await api.rpc('open_shift', { p_lane: laneId, p_opening_float_cents: 0 });

  const { data: t } = await owner.from('tenants').select('rounding_unit_cents, loyalty_enabled, loyalty_spend_cents, loyalty_point_value_cents, loyalty_min_redeem').single();
  rounding = t!.rounding_unit_cents;
  loyaltyBefore = { loyalty_enabled: t!.loyalty_enabled, loyalty_spend_cents: t!.loyalty_spend_cents, loyalty_point_value_cents: t!.loyalty_point_value_cents, loyalty_min_redeem: t!.loyalty_min_redeem };
  const set = await api.rpc('update_tenant_settings', { p: { loyalty_enabled: true, loyalty_spend_cents: 10000, loyalty_point_value_cents: 100, loyalty_min_redeem: 10 } });
  if (set.error) throw set.error;

  for (const k of ['a', 'b', 'c'] as const) {
    const up = await api.rpc('upsert_item', { p: { name: `ZZ Test Snack ${k.toUpperCase()} ${tag}`, priceCents: PRICE[k], costCents: 5000 } });
    if (up.error) throw up.error;
    items[k] = up.data as string;
    await api.rpc('adjust_stock', { p_shop: shopId, p_item: items[k], p_qty_milli: 200_000, p_reason: 'opening' });
  }
  const mm = await api.rpc('save_promotion', { p: { name: `ZZ any 3 for 270 ${tag}`, kind: 'mix_match', buyQty: 3, bundlePriceCents: 27000, itemIds: Object.values(items) } });
  if (mm.error) throw mm.error;
  // Members only and high, so other tests' sales never reach it.
  const th = await api.rpc('save_promotion', { p: { name: `ZZ spend 5000 ${tag}`, kind: 'threshold', thresholdCents: 500000, discountCents: 25000, membersOnly: true, itemIds: [] } });
  if (th.error) throw th.error;
  promoIds.push(mm.data as string, th.data as string);

  const phone = `+9477${String(Date.now()).slice(-7)}`;
  const { data: c, error: ce } = await owner.from('customers').insert({ tenant_id: shop!.tenant_id, name: `ZZ Test Member ${tag}`, phone }).select('id').single();
  if (ce) throw ce;
  customerId = c!.id;
}, 90_000);

afterAll(async () => {
  for (const id of promoIds) await owner.from('promotions').update({ is_active: false }).eq('id', id);
  await api.rpc('update_tenant_settings', { p: loyaltyBefore });
  for (const id of Object.values(items)) await owner.from('items').update({ is_active: false }).eq('id', id);
  await owner.from('customers').update({ is_active: false }).eq('id', customerId);
});

describe('promotions v2 parity', () => {
  it('mix and match: lane and server agree', async () => {
    const lines = [{ id: items.a, qty: 2 }, { id: items.b, qty: 1 }, { id: items.c, qty: 1 }];
    const t = await lanePrice(lines, false);
    expect(t.promoCents).toBe(7000); // 120 + 120 + 100 = 340 -> 270
    const r = await sell(lines, [{ method: 'cash', amountCents: t.totalCents }], false, t.totalCents);
    expect(r.error).toBeNull();
    expect((r.data as { totalCents: number; promoCents: number })).toMatchObject({ totalCents: t.totalCents, promoCents: 7000 });
  });

  it('members-only spend-X needs a member; points are earned on what is paid', async () => {
    const lines = [{ id: items.a, qty: 60 }];
    const guest = await lanePrice(lines, false);
    expect(guest.basketPromoCents).toBe(0);
    const member = await lanePrice(lines, true);
    expect(member.basketPromoCents).toBe(25000);
    const r = await sell(lines, [{ method: 'cash', amountCents: member.totalCents }], true, member.totalCents);
    expect(r.error).toBeNull();
    const d = r.data as { totalCents: number; basketPromoCents: number; pointsEarned: number };
    expect(d).toMatchObject({ totalCents: member.totalCents, basketPromoCents: 25000, pointsEarned: pointsEarned(member.totalCents, 10000) });
    const { data: c } = await owner.from('customers').select('loyalty_points').eq('id', customerId).single();
    expect(c!.loyalty_points).toBe(d.pointsEarned);
  });

  it('spends points as a payment, and a return takes back earned points', async () => {
    const before = (await owner.from('customers').select('loyalty_points').eq('id', customerId).single()).data!.loyalty_points;
    const t = await lanePrice([{ id: items.b, qty: 1 }], true);
    expect((await sell([{ id: items.b, qty: 1 }], [{ method: 'loyalty', amountCents: 5 * 100 }, { method: 'cash', amountCents: t.totalCents - 500 }], true, t.totalCents)).error?.message)
      .toMatch(/at least 10 points/);
    const r = await sell([{ id: items.b, qty: 1 }], [{ method: 'loyalty', amountCents: 2000 }, { method: 'cash', amountCents: t.totalCents - 2000 }], true, t.totalCents);
    expect(r.error).toBeNull();
    expect((r.data as { pointsRedeemed: number }).pointsRedeemed).toBe(20);
    const after = (await owner.from('customers').select('loyalty_points').eq('id', customerId).single()).data!.loyalty_points;
    expect(after).toBe(before - 20 + pointsEarned(t.totalCents - 2000, 10000));

    // Return half of the big bill: half its points come back off the balance.
    const { data: big } = await owner.from('sales').select('id, invoice_no, points_earned').eq('customer_id', customerId).gt('points_earned', 0).order('created_at').limit(1).single();
    const found = (await api.rpc('find_sale_for_return', { p_invoice: big!.invoice_no })).data as { lines: { saleLineId: string }[] };
    const ret = await api.rpc('process_return', { p: { clientUuid: randomUUID(), laneId, saleId: big!.id, settlement: 'credit_note',
      lines: [{ saleLineId: found.lines[0]!.saleLineId, qtyMilli: 30_000, reason: 'changed_mind', restock: 'sellable' }] } });
    expect(ret.error).toBeNull();
    const { data: led } = await owner.from('loyalty_ledger').select('kind, points').eq('customer_id', customerId).eq('kind', 'reverse');
    expect(led!.length).toBe(1);
    expect(led![0]!.points).toBeLessThan(0);
    expect(-led![0]!.points).toBeLessThanOrEqual(big!.points_earned);
  });
});
