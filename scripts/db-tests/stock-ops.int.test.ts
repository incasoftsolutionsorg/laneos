// Catalogue and stock operations against staging: items v2, labels, import, damage, counts.
// Test items are named "ZZ Test …" and deactivated afterwards.

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let owner: SupabaseClient;
let api: ReturnType<SupabaseClient['schema']>;
let shopId: string;
const created: string[] = [];
const tag = randomUUID().slice(0, 6).toUpperCase();

function ean13(body12: string) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(body12[11 - i]) * (i % 2 === 0 ? 3 : 1);
  return body12 + ((10 - (s % 10)) % 10);
}
const code = (n: number) => ean13(`20${String(Date.now()).slice(-7)}${String(n).padStart(3, '0')}`.slice(0, 12));

async function level(itemId: string) {
  const { data } = await owner.from('stock_levels').select('qty_milli, damaged_milli').eq('shop_id', shopId).eq('item_id', itemId).maybeSingle();
  return data ?? { qty_milli: 0, damaged_milli: 0 };
}

beforeAll(async () => {
  owner = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await owner.auth.signInWithPassword({ email: process.env.DEMO_OWNER_EMAIL!, password: process.env.DEMO_OWNER_PASSWORD! });
  if (error) throw error;
  api = owner.schema('api');
  shopId = (await owner.from('shops').select('id').eq('code', 'KDY1').single()).data!.id;
}, 60_000);

afterAll(async () => {
  if (created.length) await owner.from('items').update({ is_active: false }).in('id', created);
});

describe('items v2 and the label queue', () => {
  let itemId: string;
  const single = code(1);
  const caseCode = code(2);

  it('saves brand, wholesale, minimum and a case barcode', async () => {
    const r = await api.rpc('upsert_item', { p: {
      name: `ZZ Test Milk ${tag}`, brand: 'Anchor', priceCents: 118000, mrpCents: 120000, wholesaleCents: 104000, minPriceCents: 110000,
      barcodes: [{ code: single, packQty: 1 }, { code: caseCode, packQty: 12 }],
    } });
    expect(r.error).toBeNull();
    itemId = r.data as string;
    created.push(itemId);
    const { data } = await owner.from('items').select('brand, wholesale_cents, min_price_cents, barcodes(code, pack_qty)').eq('id', itemId).single();
    expect(data).toMatchObject({ brand: 'Anchor', wholesale_cents: 104000, min_price_cents: 110000 });
    expect(data!.barcodes).toEqual(expect.arrayContaining([{ code: single, pack_qty: 1 }, { code: caseCode, pack_qty: 12 }]));
  });

  it('refuses a barcode that belongs to another item', async () => {
    const r = await api.rpc('upsert_item', { p: { name: `ZZ Test Other ${tag}`, priceCents: 100, barcodes: [{ code: single, packQty: 1 }] } });
    expect(r.error?.message).toMatch(/^DUPLICATE_BARCODE/);
  });

  it('queues a shelf label with the old price when the price changes', async () => {
    await api.rpc('upsert_item', { p: { id: itemId, name: `ZZ Test Milk ${tag}`, priceCents: 115000, mrpCents: 120000, barcodes: [{ code: single, packQty: 1 }] } });
    const { data } = await owner.from('label_queue').select('reason, old_price_cents').eq('shop_id', shopId).eq('item_id', itemId).is('printed_at', null).single();
    expect(data).toEqual({ reason: 'price_changed', old_price_cents: 118000 });
    const { data: b } = await owner.from('barcodes').select('code').eq('item_id', itemId);
    expect(b!.map((x) => x.code)).toEqual([single]); // the set was replaced: the case barcode is gone
  });
});

describe('import_items', () => {
  it('creates, updates and reports problem rows without failing the file', async () => {
    // Only test-owned items: A has a barcode, B has a PLU. A row naming A's barcode with B's PLU must fail.
    const aCode = code(4);
    const plu = 90000 + Math.floor(Math.random() * 9000);
    const a = (await api.rpc('upsert_item', { p: { name: `ZZ Test A ${tag}`, priceCents: 100, barcodes: [{ code: aCode, packQty: 1 }] } })).data as string;
    const b = (await api.rpc('upsert_item', { p: { name: `ZZ Test B ${tag}`, priceCents: 100, plu } })).data as string;
    created.push(a, b);

    const good = code(3);
    const r = await api.rpc('import_items', { p_shop: shopId, p_rows: [
      { row: 2, name: `ZZ Test Import ${tag}`, category: 'ZZ Test Category', barcode: good, priceCents: 5000, openingStockMilli: 7000, itemType: 'standard', taxClass: 'standard' },
      { row: 3, name: `ZZ Test A renamed ${tag}`, barcode: aCode, priceCents: 200, itemType: 'standard', taxClass: 'standard' },
      { row: 4, name: `ZZ Test Clash ${tag}`, barcode: aCode, plu, priceCents: 300, itemType: 'standard', taxClass: 'standard' },
    ] });
    expect(r.error).toBeNull();
    const out = r.data as { created: number; updated: number; errors: { row: number; column: string }[] };
    expect(out).toMatchObject({ created: 1, updated: 1 });
    expect(out.errors).toEqual([expect.objectContaining({ row: 4, column: 'plu' })]);

    const { data: item } = await owner.from('barcodes').select('item_id').eq('code', good).single();
    created.push(item!.item_id);
    expect((await level(item!.item_id)).qty_milli).toBe(7000);
    // Row 3 updated A; the failed row 4 changed nothing (its savepoint rolled back).
    expect((await owner.from('items').select('name').eq('id', a).single()).data!.name).toBe(`ZZ Test A renamed ${tag}`);
  });
});

describe('damage (blueprint §30.1)', () => {
  let itemId: string;

  beforeAll(async () => {
    itemId = (await api.rpc('upsert_item', { p: { name: `ZZ Test Yoghurt ${tag}`, priceCents: 11000, costCents: 8600 } })).data as string;
    created.push(itemId);
    await api.rpc('adjust_stock', { p_shop: shopId, p_item: itemId, p_qty_milli: 20000, p_reason: 'opening' });
  });

  it('moves damaged stock out of sellable, then partial decisions add up', async () => {
    const rep = await api.rpc('report_damage', { p_shop: shopId, p_item: itemId, p_qty_milli: 6000, p_reason: 'leaking', p_source: 'shelf' });
    expect(rep.error).toBeNull();
    const { id, reportNo, status } = rep.data as { id: string; reportNo: string; status: string };
    expect(reportNo).toMatch(/^DMG-KDY1-\d{6}$/);
    expect(status).toBe('awaiting_decision');
    expect(await level(itemId)).toEqual({ qty_milli: 14000, damaged_milli: 6000 });

    expect((await api.rpc('decide_damage', { p_report: id, p_decision: 'write_off', p_qty_milli: 4000 })).error).toBeNull();
    expect((await api.rpc('decide_damage', { p_report: id, p_decision: 'reduced_sale', p_qty_milli: 2000, p_markdown_cents: 7000 })).error).toBeNull();
    expect(await level(itemId)).toEqual({ qty_milli: 16000, damaged_milli: 0 }); // 2 back to sellable at the reduced price
    const { data } = await owner.from('damage_reports').select('status, remaining_milli').eq('id', id).single();
    expect(data).toEqual({ status: 'reduced_for_sale', remaining_milli: 0 });
    expect((await api.rpc('decide_damage', { p_report: id, p_decision: 'write_off', p_qty_milli: 1000 })).error?.message).toMatch(/VALIDATION_ERROR/);
  });

  it('a report above the limit waits for a different person (REQ-DMG-005)', async () => {
    const big = (await api.rpc('report_damage', { p_shop: shopId, p_item: itemId, p_qty_milli: 13000, p_reason: 'broken' })).data as { id: string; status: string; valueCents: number };
    // 13 × Rs 86 = Rs 1,118 → below the default Rs 10,000 limit; lower the limit to force approval.
    expect(big.status).toBe('awaiting_decision');
    const { data: t } = await owner.from('tenants').select('id, damage_approval_cents').single();
    await api.rpc('update_tenant_settings', { p: { damage_approval_cents: 100 } });
    try {
      const rep = (await api.rpc('report_damage', { p_shop: shopId, p_item: itemId, p_qty_milli: 1000, p_reason: 'broken' })).data as { id: string; status: string };
      expect(rep.status).toBe('awaiting_approval');
      expect((await api.rpc('approve_damage', { p_report: rep.id, p_approve: true })).error?.message).toMatch(/different person/);
    } finally {
      await api.rpc('update_tenant_settings', { p: { damage_approval_cents: t!.damage_approval_cents } });
    }
  });
});

describe('stock counts', () => {
  it('posts only the variance between the frozen and counted quantity', async () => {
    const itemId = (await api.rpc('upsert_item', { p: { name: `ZZ Test Count ${tag}`, priceCents: 5000 } })).data as string;
    created.push(itemId);
    await api.rpc('adjust_stock', { p_shop: shopId, p_item: itemId, p_qty_milli: 10000, p_reason: 'opening' });
    const countId = (await api.rpc('start_count', { p_shop: shopId, p_name: `ZZ Test ${tag}` })).data as string;
    const { data: line } = await owner.from('stock_count_lines').select('id, system_milli').eq('count_id', countId).eq('item_id', itemId).single();
    expect(line!.system_milli).toBe(10000);

    expect((await api.rpc('record_count', { p_line: line!.id, p_counted_milli: 8000 })).error).toBeNull();
    expect((await api.rpc('count_action', { p_count: countId, p_action: 'post' })).error?.message).toMatch(/cannot post a count that is counting/);
    expect((await api.rpc('count_action', { p_count: countId, p_action: 'submit' })).error).toBeNull();
    expect((await api.rpc('record_count', { p_line: line!.id, p_counted_milli: 1 })).error?.message).toMatch(/no longer open/);
    expect((await api.rpc('count_action', { p_count: countId, p_action: 'post' })).error).toBeNull();
    expect((await level(itemId)).qty_milli).toBe(8000);
  });
});
