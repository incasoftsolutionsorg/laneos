// Purchasing against staging: PO → GRN (stock, batches, average cost, supplier balance, PO status),
// FEFO expiry inference, supplier payments. Uses a throw-away supplier and items named "ZZ Test …".

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let owner: SupabaseClient;
let api: ReturnType<SupabaseClient['schema']>;
let shopId: string;
let supplierId: string;
let itemId: string;
const tag = randomUUID().slice(0, 6).toUpperCase();
const day = (n: number) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  owner = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await owner.auth.signInWithPassword({ email: process.env.DEMO_OWNER_EMAIL!, password: process.env.DEMO_OWNER_PASSWORD! });
  if (error) throw error;
  api = owner.schema('api');
  const { data: shop } = await owner.from('shops').select('id, tenant_id').eq('code', 'KDY1').single();
  shopId = shop!.id;
  const { data: s, error: se } = await owner.from('suppliers').insert({ tenant_id: shop!.tenant_id, name: `ZZ Test Supplier ${tag}`, payment_terms_days: 14 }).select('id').single();
  if (se) throw se;
  supplierId = s!.id;
  itemId = (await api.rpc('upsert_item', { p: { name: `ZZ Test Butter ${tag}`, priceCents: 98000, costCents: 80000, reorderLevelMilli: 10000, trackBatches: true } })).data as string;
}, 60_000);

afterAll(async () => {
  await owner.from('items').update({ is_active: false }).eq('id', itemId);
  await owner.from('suppliers').update({ is_active: false }).eq('id', supplierId);
});

describe('purchase order → GRN', () => {
  let poId: string;

  it('suggests the item that is below its re-order level', async () => {
    const { data } = await api.rpc('po_suggestions', { p_shop: shopId });
    expect((data as { itemId: string }[]).some((s) => s.itemId === itemId)).toBe(true);
  });

  it('creates and sends a PO', async () => {
    poId = (await api.rpc('save_po', { p_shop: shopId, p: { supplierId, lines: [{ itemId, qtyMilli: 24000, unitCostCents: 84000 }] } })).data as string;
    expect((await api.rpc('po_action', { p_po: poId, p_action: 'send' })).error).toBeNull();
    const { data } = await owner.from('purchase_orders').select('status, total_cents, po_no').eq('id', poId).single();
    expect(data).toMatchObject({ status: 'sent', total_cents: 24 * 84000 });
    expect(data!.po_no).toMatch(/^PO-KDY1-\d{6}$/);
  });

  it('posting a GRN adds stock and batches, raises the supplier balance and part-receives the PO', async () => {
    const r = await api.rpc('save_grn', { p_shop: shopId, p_post: true, p: {
      supplierId, poId, supplierInvoiceNo: `INV-${tag}`, receivedOn: day(0), discountCents: 1000,
      lines: [{ itemId, batchNo: 'AB-OLD', expiryOn: day(2), qtyMilli: 12000, freeMilli: 1000, unitCostCents: 84000 }],
    } });
    expect(r.error).toBeNull();
    const { data: lvl } = await owner.from('stock_levels').select('qty_milli, avg_cost_cents').eq('shop_id', shopId).eq('item_id', itemId).single();
    expect(lvl!.qty_milli).toBe(13000);                                // 12 paid + 1 free
    expect(lvl!.avg_cost_cents).toBe(Math.round((12 * 84000) / 13));  // free issue lowers the average
    const { data: sup } = await owner.from('suppliers').select('balance_due_cents').eq('id', supplierId).single();
    expect(sup!.balance_due_cents).toBe(12 * 84000 - 1000);
    expect((await owner.from('purchase_orders').select('status').eq('id', poId).single()).data!.status).toBe('partially_received');
    const { data: grn } = await owner.from('grns').select('due_on').eq('id', (r.data as { id: string }).id).single();
    expect(grn!.due_on).toBe(day(14));
  });

  it('refuses an expiry date in the past', async () => {
    const r = await api.rpc('save_grn', { p_shop: shopId, p_post: true, p: { supplierId, receivedOn: day(0), lines: [{ itemId, expiryOn: day(-1), qtyMilli: 1000, unitCostCents: 1 }] } });
    expect(r.error?.message).toMatch(/expiry must be today or later/);
  });
});

describe('expiry (FEFO inference)', () => {
  it('assumes the oldest batch sells first', async () => {
    await api.rpc('save_grn', { p_shop: shopId, p_post: true, p: { supplierId, receivedOn: day(0), lines: [{ itemId, batchNo: 'AB-NEW', expiryOn: day(20), qtyMilli: 10000, unitCostCents: 84000 }] } });
    // 23 in stock: 13 from the old batch + 10 new. Sell 5 → the old batch has 8 left, the new one 10.
    await api.rpc('adjust_stock', { p_shop: shopId, p_item: itemId, p_qty_milli: -5000, p_reason: 'adjustment' });
    const { data } = await api.rpc('expiry_list', { p_shop: shopId, p_within_days: 30 });
    const mine = (data as { batchNo: string; leftMilli: number; name: string }[]).filter((b) => b.name === `ZZ Test Butter ${tag}`);
    expect(mine).toEqual([
      expect.objectContaining({ batchNo: 'AB-OLD', leftMilli: 8000 }),
      expect.objectContaining({ batchNo: 'AB-NEW', leftMilli: 10000 }),
    ]);
    const soon = (await api.rpc('expiry_list', { p_shop: shopId, p_within_days: 3 })).data as { batchNo: string; name: string }[];
    expect(soon.filter((b) => b.name === `ZZ Test Butter ${tag}`).map((b) => b.batchNo)).toEqual(['AB-OLD']);
  });
});

describe('supplier payments', () => {
  it('spreads a payment over GRNs and lowers the balance', async () => {
    const { data: grns } = await owner.from('grns').select('id, total_cents').eq('supplier_id', supplierId).eq('status', 'posted').order('created_at');
    const first = grns![0]!;
    const before = (await owner.from('suppliers').select('balance_due_cents').eq('id', supplierId).single()).data!.balance_due_cents;
    const r = await api.rpc('pay_supplier', { p_shop: shopId, p: { supplierId, method: 'bank_transfer', reference: `T-${tag}`, amountCents: 50000, allocations: [{ grnId: first.id, amountCents: 50000 }] } });
    expect(r.error).toBeNull();
    expect((r.data as { status: string }).status).toBe('paid'); // the owner is never held for approval
    expect((await owner.from('grns').select('paid_cents').eq('id', first.id).single()).data!.paid_cents).toBe(50000);
    expect((await owner.from('suppliers').select('balance_due_cents').eq('id', supplierId).single()).data!.balance_due_cents).toBe(before - 50000);
  });

  it('refuses to over-allocate a GRN and needs a cheque number for cheques', async () => {
    const { data: g } = await owner.from('grns').select('id, total_cents, paid_cents').eq('supplier_id', supplierId).eq('status', 'posted').order('created_at').limit(1).single();
    const over = g!.total_cents - g!.paid_cents + 100;
    expect((await api.rpc('pay_supplier', { p_shop: shopId, p: { supplierId, method: 'cash', amountCents: over, allocations: [{ grnId: g!.id, amountCents: over }] } })).error?.message).toMatch(/larger than what is open/);
    expect((await api.rpc('pay_supplier', { p_shop: shopId, p: { supplierId, method: 'cheque', amountCents: 100, allocations: [] } })).error?.message).toMatch(/cheque number/);
  });
});

describe('supplier returns', () => {
  const levels = async () => (await owner.from('stock_levels').select('qty_milli, damaged_milli').eq('shop_id', shopId).eq('item_id', itemId).single()).data!;

  it('a refused return puts damaged and sellable goods back', async () => {
    const dmg = (await api.rpc('report_damage', { p_shop: shopId, p_item: itemId, p_qty_milli: 1000, p_reason: 'crushed' })).data as { id: string };
    const before = await levels();
    const r = await api.rpc('create_supplier_return', { p_shop: shopId, p: { supplierId, lines: [{ damageReportId: dmg.id, qtyMilli: 1000 }, { itemId, qtyMilli: 2000 }] } });
    expect(r.error).toBeNull();
    const id = (r.data as { id: string; returnNo: string }).id;
    expect((r.data as { returnNo: string }).returnNo).toMatch(/^SRN-KDY1-\d{6}$/);
    const sent = await levels();
    expect(sent.damaged_milli).toBe(before.damaged_milli - 1000);
    expect(sent.qty_milli).toBe(before.qty_milli - 2000);
    expect((await owner.from('damage_reports').select('status').eq('id', dmg.id).single()).data!.status).toBe('sent_to_supplier');

    expect((await api.rpc('answer_supplier_return', { p_return: id, p_action: 'reject', p_credit_cents: null, p_note: 'Not our fault' })).error).toBeNull();
    const back = await levels();
    expect(back).toMatchObject({ damaged_milli: before.damaged_milli, qty_milli: before.qty_milli });
    expect((await owner.from('damage_reports').select('status, remaining_milli').eq('id', dmg.id).single()).data).toMatchObject({ status: 'awaiting_decision', remaining_milli: 1000 });
  });

  it('a credited return lowers what we owe the supplier', async () => {
    const owed = (await owner.from('suppliers').select('balance_due_cents').eq('id', supplierId).single()).data!.balance_due_cents;
    const r = await api.rpc('create_supplier_return', { p_shop: shopId, p: { supplierId, lines: [{ itemId, qtyMilli: 1000 }] } });
    const id = (r.data as { id: string }).id;
    expect((await api.rpc('answer_supplier_return', { p_return: id, p_action: 'credit', p_credit_cents: 70000, p_note: 'CN-778' })).error).toBeNull();
    expect((await owner.from('suppliers').select('balance_due_cents').eq('id', supplierId).single()).data!.balance_due_cents).toBe(owed - 70000);
    expect((await api.rpc('answer_supplier_return', { p_return: id, p_action: 'reject', p_credit_cents: null, p_note: 'again' })).error?.message).toMatch(/already been answered/);
  });
});
