// Lane operations against staging: PINs, lane keys, returns, credit notes, sync issues, receipts.
// Uses lane L2 of the demo shop (it gets registered here; re-register it in the app afterwards).

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { priceBasket } from '@laneos/pricing';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let owner: SupabaseClient;
let api: ReturnType<SupabaseClient['schema']>;
let me: { id: string };
let l1: { id: string };
let l2: { id: string };
let bread: { id: string; priceCents: number };
let rice: { id: string; priceCents: number };
let rounding: number;
const promotions: { id: string; kind: 'multi_buy'; buyQty: number; bundlePriceCents: number; itemIds: string[] }[] = [];

const total = (lines: { id: string; priceCents: number; qty: number }[]) =>
  priceBasket(lines.map((l) => ({ itemId: l.id, itemType: 'standard', qtyMilli: l.qty * 1000, unitPriceCents: l.priceCents })), promotions, { roundingUnitCents: rounding }).totalCents;

async function sell(laneId: string, lines: { id: string; priceCents: number; qty: number }[], payments: { method: string; amountCents: number; reference?: string }[], extra: Record<string, unknown> = {}) {
  return api.rpc('create_sale', {
    p: { clientUuid: randomUUID(), laneId, lines: lines.map((l) => ({ itemId: l.id, qtyMilli: l.qty * 1000 })), payments, expectedTotalCents: total(lines), ...extra },
  });
}

beforeAll(async () => {
  owner = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await owner.auth.signInWithPassword({ email: process.env.DEMO_OWNER_EMAIL!, password: process.env.DEMO_OWNER_PASSWORD! });
  if (error) throw error;
  api = owner.schema('api');
  // The owner's own membership (other tests add staff to the demo tenant).
  const { data: who } = await owner.auth.getUser();
  me = (await owner.from('members').select('id').eq('user_id', who.user!.id).single()).data!;
  l1 = (await owner.from('lanes').select('id, shop:shops!inner(code)').eq('code', 'L1').eq('shop.code', 'KDY1').single()).data!;
  l2 = (await owner.from('lanes').select('id, shop:shops!inner(code)').eq('code', 'L2').eq('shop.code', 'KDY1').single()).data!;
  await api.rpc('open_shift', { p_lane: l1.id, p_opening_float_cents: 500000 });
  const { data } = await api.rpc('lane_catalog', { p_lane: l1.id });
  const c = data as { items: { id: string; name: string; priceCents: number }[]; promotions: typeof promotions; tenant: { roundingUnitCents: number } };
  bread = c.items.find((i) => i.name === 'Prima Sandwich Bread 450g')!;
  rice = c.items.find((i) => i.name === 'Samba Rice 5kg')!;
  promotions.push(...c.promotions);
  rounding = c.tenant.roundingUnitCents;
}, 60_000);

describe('PIN and lane registration', () => {
  let key: string;

  it('sets a PIN and hides PIN hashes and lane keys from the API', async () => {
    expect((await api.rpc('set_pin', { p_member: me.id, p_pin: '1111' })).error?.message).toMatch(/VALIDATION_ERROR/); // too simple
    expect((await api.rpc('set_pin', { p_member: me.id, p_pin: '4826' })).error).toBeNull();
    expect((await owner.from('members').select('pin_hash')).error).not.toBeNull();
    expect((await owner.from('lanes').select('key_hash')).error).not.toBeNull();
    expect((await owner.from('members').select('has_pin').eq('id', me.id).single()).data!.has_pin).toBe(true);
  });

  it('registers L2 and only unlocks with the right key and PIN', async () => {
    key = (await api.rpc('register_lane', { p_lane: l2.id })).data as string;
    expect(key).toMatch(/^[0-9a-f]{48}$/);
    const noKey = await api.rpc('lane_unlock', { p_lane: l2.id, p_key: 'wrong', p_member: me.id, p_pin: '4826' });
    expect(noKey.data).toMatchObject({ ok: false, error: 'LANE_KEY_INVALID' });
    const badPin = await api.rpc('lane_unlock', { p_lane: l2.id, p_key: key, p_member: me.id, p_pin: '0001' });
    expect(badPin.data).toMatchObject({ ok: false, error: 'PIN_INVALID' });
    const { data: m } = await owner.from('members').select('pin_failures').eq('id', me.id).single();
    expect(m!.pin_failures).toBe(1); // the failure is kept even though the call "failed"
    const good = await api.rpc('lane_unlock', { p_lane: l2.id, p_key: key, p_member: me.id, p_pin: '4826' });
    expect(good.data).toMatchObject({ ok: true });
  });

  it('a registered lane refuses sales without its device key', async () => {
    await api.rpc('open_shift', { p_lane: l2.id, p_opening_float_cents: 0 });
    const t = total([{ ...rice, qty: 1 }]);
    const without = await sell(l2.id, [{ ...rice, qty: 1 }], [{ method: 'cash', amountCents: t }]);
    expect(without.error?.message).toMatch(/^LANE_KEY_INVALID/);
    const withKey = await sell(l2.id, [{ ...rice, qty: 1 }], [{ method: 'cash', amountCents: t }], { laneKey: key });
    expect(withKey.error).toBeNull();
  });
});

describe('returns and credit notes', () => {
  let sale: { id: string; invoiceNo: string; receiptToken: string };
  let code: string;
  let noteAmount: number;

  it('returns part of a bill as a credit note and blocks over-returns', async () => {
    const lines = [{ ...bread, qty: 2 }, { ...rice, qty: 1 }];
    const r = await sell(l1.id, lines, [{ method: 'cash', amountCents: total(lines) }]);
    expect(r.error).toBeNull();
    sale = r.data as typeof sale;

    const found = (await api.rpc('find_sale_for_return', { p_invoice: sale.invoiceNo.toLowerCase() })).data as { lines: { saleLineId: string; itemId: string; qtyMilli: number; netCents: number }[] };
    const breadLine = found.lines.find((l) => l.itemId === bread.id)!;

    const ret = await api.rpc('process_return', {
      p: { clientUuid: randomUUID(), laneId: l1.id, saleId: sale.id, settlement: 'credit_note',
           lines: [{ saleLineId: breadLine.saleLineId, qtyMilli: 1000, reason: 'changed_mind', restock: 'sellable' }] },
    });
    expect(ret.error).toBeNull();
    const out = ret.data as { ok: boolean; returnNo: string; totalCents: number; creditNote: { code: string; noteNo: string; amountCents: number } };
    expect(out.ok).toBe(true);
    expect(out.returnNo).toMatch(/^RTN-KDY1-\d{6}$/);
    expect(out.creditNote.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(out.totalCents).toBe(Math.round(breadLine.netCents / 2));
    code = out.creditNote.code;
    noteAmount = out.creditNote.amountCents;

    const again = await api.rpc('process_return', {
      p: { clientUuid: randomUUID(), laneId: l1.id, saleId: sale.id, settlement: 'credit_note',
           lines: [{ saleLineId: breadLine.saleLineId, qtyMilli: 2000, reason: 'changed_mind', restock: 'sellable' }] },
    });
    expect(again.error?.message).toMatch(/^RETURN_QTY_EXCEEDED/);
  });

  it('never stores the code, and checks it by hash', async () => {
    const { data } = await owner.from('credit_notes').select('code_last4, balance_cents').eq('amount_cents', noteAmount).order('created_at', { ascending: false }).limit(1).single();
    expect(data!.code_last4).toBe(code.replace(/-/g, '').slice(-4));
    const check = (await api.rpc('check_credit_note', { p_code: code.toLowerCase(), p_lane: l1.id })).data as { ok: boolean; balanceCents: number };
    expect(check).toMatchObject({ ok: true, balanceCents: noteAmount });
    const wrong = (await api.rpc('check_credit_note', { p_code: 'AAAA-BBBB-CCCC', p_lane: l1.id })).data as { ok: boolean; error: string };
    expect(wrong).toMatchObject({ ok: false, error: 'CREDIT_NOTE_NOT_FOUND' });
  });

  it('spends a credit note once: two lanes at the same time, only one wins (TC-CRN-003)', async () => {
    const lines = [{ ...rice, qty: 1 }];
    const t = total(lines);
    const pay = [{ method: 'credit_note', amountCents: noteAmount, reference: code }, { method: 'cash', amountCents: t - noteAmount }];
    const [a, b] = await Promise.all([sell(l1.id, lines, pay), sell(l1.id, lines, pay)]);
    const ok = [a, b].filter((r) => !r.error);
    expect(ok).toHaveLength(1);
    expect([a, b].find((r) => r.error)!.error!.message).toMatch(/^CREDIT_NOTE_(USED|INSUFFICIENT)/);

    const { data: payRow } = await owner.from('sale_payments').select('reference').eq('sale_id', (ok[0]!.data as { id: string }).id).eq('method', 'credit_note').single();
    expect(payRow!.reference).toMatch(/^CN-KDY1-/); // the payment stores the note number, never the code
  });

  it('refunds of goods paid by credit note must go back to a credit note (rule 5)', async () => {
    const { data: s } = await owner.from('sale_payments').select('sale_id').eq('method', 'credit_note').order('created_at', { ascending: false }).limit(1).single();
    const found = (await api.rpc('find_sale_for_return', { p_invoice: (await owner.from('sales').select('invoice_no').eq('id', s!.sale_id).single()).data!.invoice_no })).data as { lines: { saleLineId: string }[] };
    const cash = await api.rpc('process_return', {
      p: { clientUuid: randomUUID(), laneId: l1.id, saleId: s!.sale_id, settlement: 'cash',
           lines: [{ saleLineId: found.lines[0]!.saleLineId, qtyMilli: 1000, reason: 'other', restock: 'damaged' }] },
    });
    expect(cash.error?.message).toMatch(/must be a credit note/);
  });

  it('serves the digital receipt to anyone with the token, and nothing else', async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const r = await anon.schema('api').rpc('public_receipt', { p_token: sale.receiptToken });
    expect((r.data as { invoiceNo: string }).invoiceNo).toBe(sale.invoiceNo);
    expect(r.data).not.toHaveProperty('customer'); // the shop's phone is fine; nothing about the customer
    expect(r.data).not.toHaveProperty('customerId');
    expect((await anon.schema('api').rpc('public_receipt', { p_token: '0'.repeat(32) })).data).toBeNull();
    expect((await anon.schema('api').rpc('create_sale', { p: {} })).error).not.toBeNull();
  });
});

describe('shifts and sync issues', () => {
  it('summarises the open shift with cash expected', async () => {
    const { data: shift } = await owner.from('shifts').select('id').eq('lane_id', l1.id).eq('status', 'open').single();
    expect((await api.rpc('cash_pickup', { p_shift: shift!.id, p_amount_cents: 100 })).error).toBeNull();
    const s = (await api.rpc('shift_summary', { p_shift: shift!.id })).data as Record<string, number>;
    expect(s.expectedCashCents).toBe(s.openingFloatCents + s.cashSalesCents - s.refundsCashCents - s.pickupsCents);
  });

  it('records and resolves a refused offline sale', async () => {
    const id = randomUUID();
    expect((await api.rpc('report_sync_issue', { p_lane: l1.id, p_client_uuid: id, p_payload: { expectedTotalCents: 1 }, p_code: 'PRICE_MISMATCH', p_message: 'test' })).error).toBeNull();
    const { data: issue } = await owner.from('sync_issues').select('id, status').eq('client_uuid', id).single();
    expect(issue!.status).toBe('open');
    expect((await api.rpc('resolve_sync_issue', { p_issue: issue!.id, p_status: 'discarded', p_note: 'integration test' })).error).toBeNull();
  });
});
