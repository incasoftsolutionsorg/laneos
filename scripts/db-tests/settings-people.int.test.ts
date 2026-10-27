// Settings, people, customer credit, wholesale and reports against staging (migrations 0600–0800).
// Uses throw-away rows named "ZZ Test …" and restores every setting it changes.

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let owner: SupabaseClient;
let api: ReturnType<SupabaseClient['schema']>;
let shopId: string;
let tenantId: string;
let itemId: string;
let customerId: string;
let memberId: string;
const tag = randomUUID().slice(0, 4).toUpperCase();
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  owner = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await owner.auth.signInWithPassword({ email: process.env.DEMO_OWNER_EMAIL!, password: process.env.DEMO_OWNER_PASSWORD! });
  if (error) throw error;
  api = owner.schema('api');
  const { data: shop } = await owner.from('shops').select('id, tenant_id').eq('code', 'KDY1').single();
  shopId = shop!.id;
  tenantId = shop!.tenant_id;
  const up = await api.rpc('upsert_item', { p: { name: `ZZ Test Biscuits ${tag}`, priceCents: 25000, costCents: 18000, wholesaleCents: 21000 } });
  if (up.error) throw up.error;
  itemId = up.data as string;
  await api.rpc('adjust_stock', { p_shop: shopId, p_item: itemId, p_qty_milli: 500_000, p_reason: 'opening' });
  const phone = `+9477${String(Date.now()).slice(-7)}`;
  const { data: c, error: ce } = await owner.from('customers')
    .insert({ tenant_id: tenantId, name: `ZZ Test Retailer ${tag}`, phone, credit_limit_cents: 1_000_000 }).select('id').single();
  if (ce) throw ce;
  customerId = c!.id;
}, 60_000);

afterAll(async () => {
  await owner.from('items').update({ is_active: false }).eq('id', itemId);
  await owner.from('customers').update({ is_active: false }).eq('id', customerId);
  if (memberId) await api.rpc('update_member', { p: { id: memberId, isActive: false } });
});

describe('tenant settings', () => {
  it('changes whitelisted columns and refuses others', async () => {
    const { data: before } = await owner.from('tenants').select('receipt_footer').single();
    expect((await api.rpc('update_tenant_settings', { p: { receipt_footer: `ZZ footer ${tag}` } })).error).toBeNull();
    expect((await owner.from('tenants').select('receipt_footer').single()).data!.receipt_footer).toBe(`ZZ footer ${tag}`);
    await api.rpc('update_tenant_settings', { p: { receipt_footer: before!.receipt_footer } });
    expect((await api.rpc('update_tenant_settings', { p: { plan_id: 'chain' } })).error?.message).toMatch(/cannot be changed here/);
    expect((await owner.from('tenants').update({ name: 'x' }).eq('id', tenantId)).error?.code).toBe('42501');
  });

  it('keeps tax rates by date', async () => {
    const { data } = await owner.from('tax_rates').select('tax_class, rate_bp').eq('tax_class', 'standard');
    expect(data!.some((r) => r.rate_bp === 1800)).toBe(true);
  });

  it('refuses a plan the business has outgrown', async () => {
    const { count } = await owner.from('lanes').select('id', { count: 'exact', head: true }).eq('shop_id', shopId);
    const r = await api.rpc('change_plan', { p_plan: 'lite' });
    if ((count ?? 0) > 1) expect(r.error?.message).toMatch(/^PLAN_LIMIT/);
    expect((await api.rpc('change_plan', { p_plan: 'chain' })).error?.message).toMatch(/arranged with LaneOS/);
  });
});

describe('people', () => {
  it('adds a PIN-only cashier with a permission override', async () => {
    const { data: role } = await owner.from('roles').select('id, permissions').eq('key', 'cashier').single();
    const { data, error } = await api.rpc('add_member', { p: {
      name: `ZZ Test Cashier ${tag}`, roleId: role!.id, allShops: false, shopIds: [shopId], staffCode: `Z${tag}`, pin: '4826', permsAdd: 8,
    } });
    expect(error).toBeNull();
    memberId = data as string;
    const { data: m } = await owner.from('members').select('staff_code, perms_add, has_pin, perm_v').eq('id', memberId).single();
    expect(m).toMatchObject({ staff_code: `Z${tag}`, perms_add: 8, has_pin: true });
  });

  it('bumps perm_v when access changes and refuses a too-simple PIN', async () => {
    const { data: before } = await owner.from('members').select('perm_v').eq('id', memberId).single();
    expect((await api.rpc('update_member', { p: { id: memberId, permsAdd: 0 } })).error).toBeNull();
    expect((await owner.from('members').select('perm_v').eq('id', memberId).single()).data!.perm_v).toBe(before!.perm_v + 1);
    expect((await api.rpc('set_pin', { p_member: memberId, p_pin: '1111' })).error?.message).toMatch(/PIN must be|too simple/);
  });

  it('lists my sessions and reports member status', async () => {
    const { data } = await api.rpc('list_sessions');
    expect(Array.isArray(data)).toBe(true);
    const { data: st } = await api.rpc('member_status');
    expect(typeof st).toBe('object');
  });
});

describe('customer credit and wholesale', () => {
  // A function: itemId is only set in beforeAll, after describe bodies run.
  const line = () => ({ itemId, packQty: 12, qty: 2, priceCents: 21000 * 12, discountBp: 200 });
  const lineTotal = 2 * 21000 * 12 - Math.round((2 * 21000 * 12 * 200) / 10000);

  it('a quotation does not move stock or the balance', async () => {
    const { data: lvl0 } = await owner.from('stock_levels').select('qty_milli').eq('shop_id', shopId).eq('item_id', itemId).single();
    const r = await api.rpc('save_wholesale', { p_shop: shopId, p: { kind: 'quotation', customerId, buyerName: '', lines: [line()] } });
    expect(r.error).toBeNull();
    expect((r.data as { docNo: string }).docNo).toMatch(/^QTN-KDY1-\d{6}$/);
    expect((await owner.from('stock_levels').select('qty_milli').eq('shop_id', shopId).eq('item_id', itemId).single()).data!.qty_milli).toBe(lvl0!.qty_milli);
  });

  it('a credit invoice takes stock and puts the balance on account', async () => {
    const r = await api.rpc('save_wholesale', { p_shop: shopId, p: { kind: 'invoice', customerId, terms: 'credit', paidCents: 100000, lines: [line()] } });
    expect(r.error).toBeNull();
    const total = (r.data as { totalCents: number }).totalCents;
    expect(total).toBeGreaterThanOrEqual(lineTotal); // VAT may be added when prices exclude it
    const { data: c } = await owner.from('customers').select('balance_due_cents').eq('id', customerId).single();
    expect(c!.balance_due_cents).toBe(total - 100000);
    const { data: lvl } = await owner.from('stock_levels').select('qty_milli').eq('shop_id', shopId).eq('item_id', itemId).single();
    expect(lvl!.qty_milli).toBe(500_000 - 24_000);
    const { data: credit } = await api.rpc('customer_credit');
    expect((credit as Record<string, { oldestUnpaid: string }>)[customerId]?.oldestUnpaid).toBeTruthy();
  });

  it('refuses a balance over the credit limit and a price under the minimum', async () => {
    const big = { ...line(), qty: 1000 };
    expect((await api.rpc('save_wholesale', { p_shop: shopId, p: { kind: 'invoice', customerId, terms: 'credit', paidCents: 0, lines: [big] } })).error?.message).toMatch(/^CREDIT_LIMIT/);
    await api.rpc('upsert_item', { p: { id: itemId, name: `ZZ Test Biscuits ${tag}`, priceCents: 25000, costCents: 18000, wholesaleCents: 21000, minPriceCents: 20000 } });
    expect((await api.rpc('save_wholesale', { p_shop: shopId, p: { kind: 'quotation', lines: [{ ...line(), priceCents: 12 * 15000, discountBp: 0 }] } })).error?.message).toMatch(/minimum price/);
  });

  it('receiving a payment lowers the balance through the ledger', async () => {
    const before = (await owner.from('customers').select('balance_due_cents').eq('id', customerId).single()).data!.balance_due_cents;
    expect((await api.rpc('receive_customer_payment', { p_customer: customerId, p_amount_cents: 50000, p_method: 'cash' })).error).toBeNull();
    expect((await owner.from('customers').select('balance_due_cents').eq('id', customerId).single()).data!.balance_due_cents).toBe(before - 50000);
    const { data: ledger } = await owner.from('customer_ledger').select('kind, amount_cents').eq('customer_id', customerId).order('created_at');
    expect(ledger!.map((l) => l.kind)).toEqual(['sale', 'payment']);
    expect(ledger!.reduce((s, l) => s + l.amount_cents, 0)).toBe(before - 50000);
    // Balances cannot be edited directly any more.
    expect((await owner.from('customers').update({ balance_due_cents: 0 }).eq('id', customerId)).error?.code).toBe('42501');
  });
});

describe('reports', () => {
  it('returns every tab for this month', async () => {
    const from = `${today.slice(0, 8)}01`;
    for (const kind of ['sales', 'margin', 'items', 'stock', 'damage', 'shrinkage', 'expiry', 'promotions', 'credit_notes', 'tax']) {
      const { data, error } = await api.rpc('report', { p_shop: shopId, p_kind: kind, p_from: from, p_to: today });
      expect(error, kind).toBeNull();
      expect(data, kind).toBeTruthy();
    }
    const { data } = await api.rpc('report', { p_shop: shopId, p_kind: 'sales', p_from: from, p_to: today });
    const s = data as { days: unknown[]; totals: { wholesale: number } };
    expect(s.days.length).toBe(Number(today.slice(8)));
    expect(s.totals.wholesale).toBeGreaterThan(0);
  });

  it('refuses ranges over 400 days', async () => {
    expect((await api.rpc('report', { p_shop: shopId, p_kind: 'sales', p_from: '2020-01-01', p_to: today })).error?.message).toMatch(/400 days/);
  });
});
