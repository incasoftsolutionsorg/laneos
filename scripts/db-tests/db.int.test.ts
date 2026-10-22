// Integration tests against the linked Supabase project (staging). Run: pnpm test:db
// They sign in as real users, so RLS, grants and api.* functions are exercised exactly as the app uses them.

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { priceBasket, type BasketLine } from '@laneos/pricing';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function userClient(email: string, password: string) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const found = data.users.find((u) => u.email === email);
  if (found) await admin.auth.admin.updateUserById(found.id, { password });
  else await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

let owner: SupabaseClient;   // demo tenant (pnpm db:seed)
let rival: SupabaseClient;   // a second, unrelated tenant
let laneId: string;
let shopId: string;
let items: { id: string; name: string; itemType: BasketLine['itemType']; priceCents: number }[];
let promotions: { id: string; kind: 'multi_buy'; buyQty: number; bundlePriceCents: number; itemIds: string[] }[];
let rounding: number;

beforeAll(async () => {
  owner = await userClient(process.env.DEMO_OWNER_EMAIL!, process.env.DEMO_OWNER_PASSWORD!);
  rival = await userClient('rival-owner@test.laneos.lk', `${process.env.DEMO_OWNER_PASSWORD}-rival`);

  const { data: rivalMember } = await rival.from('members').select('id').maybeSingle();
  if (!rivalMember) {
    const { error } = await rival.schema('api').rpc('create_tenant', {
      p_name: 'Rival Stores', p_slug: 'rival-stores-test', p_shop_code: 'RVL1', p_shop_name: 'Galle', p_owner_name: 'Rival Owner',
    });
    if (error) throw error;
  }

  const { data: lane } = await owner.from('lanes').select('id, shop_id').eq('code', 'L1').single();
  laneId = lane!.id;
  shopId = lane!.shop_id;
  await owner.schema('api').rpc('open_shift', { p_lane: laneId, p_opening_float_cents: 500000 }); // ok if already open

  const { data: catalog, error } = await owner.schema('api').rpc('lane_catalog', { p_lane: laneId });
  if (error) throw error;
  const c = catalog as { items: typeof items; promotions: typeof promotions; tenant: { roundingUnitCents: number } };
  items = c.items;
  promotions = c.promotions;
  rounding = c.tenant.roundingUnitCents;
}, 60_000);

const byName = (n: string) => items.find((i) => i.name === n)!;

describe('tenant isolation (RLS)', () => {
  it('a rival tenant sees none of the demo tenant\'s rows', async () => {
    for (const table of ['items', 'customers', 'suppliers', 'sales', 'stock_levels', 'lanes'] as const) {
      const { data, error } = await rival.from(table).select('tenant_id');
      expect(error).toBeNull();
      const { data: mine } = await rival.from('members').select('tenant_id').single();
      expect(data!.every((r) => r.tenant_id === mine!.tenant_id), table).toBe(true);
    }
  });

  it('a rival cannot read the demo lane catalogue or dashboard', async () => {
    const cat = await rival.schema('api').rpc('lane_catalog', { p_lane: laneId });
    expect(cat.error?.message).toMatch(/NOT_FOUND/);
    const dash = await rival.schema('api').rpc('dashboard', { p_shop: shopId });
    expect(dash.error?.message).toMatch(/NOT_FOUND/);
  });

  it('a rival cannot sell on the demo lane', async () => {
    const { error } = await rival.schema('api').rpc('create_sale', {
      p: { clientUuid: randomUUID(), laneId, lines: [{ itemId: items[0]!.id, qtyMilli: 1000 }], payments: [{ method: 'cash', amountCents: 1 }], expectedTotalCents: 1 },
    });
    expect(error?.message).toMatch(/NOT_FOUND|SHIFT_NOT_OPEN|FORBIDDEN/);
  });

  it('signed-out visitors read nothing', async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data } = await anon.from('items').select('id');
    expect(data ?? []).toEqual([]);
    const rpc = await anon.schema('api').rpc('lane_catalog', { p_lane: laneId });
    expect(rpc.error).not.toBeNull();
  });
});

describe('api.create_sale', () => {
  const basket = () => {
    const bread = byName('Prima Sandwich Bread 450g');
    const rice = byName('Samba Rice 5kg');
    const carrots = byName('Carrots per kg');
    return [
      { itemId: bread.id, itemType: bread.itemType, qtyMilli: 3000, unitPriceCents: bread.priceCents },
      { itemId: rice.id, itemType: rice.itemType, qtyMilli: 1000, unitPriceCents: rice.priceCents },
      { itemId: carrots.id, itemType: carrots.itemType, qtyMilli: 756, unitPriceCents: carrots.priceCents },
    ];
  };

  it('server total equals the lane preview (pricing parity, OUT-D04)', async () => {
    const lines = basket();
    const preview = priceBasket(lines, promotions.map((p) => ({ ...p, kind: 'multi_buy' as const })), { roundingUnitCents: rounding });
    expect(preview.promoCents).toBe(3000); // 3 for 450 on bread

    const clientUuid = randomUUID();
    const { data, error } = await owner.schema('api').rpc('create_sale', {
      p: { clientUuid, laneId, lines: lines.map(({ itemId, qtyMilli }) => ({ itemId, qtyMilli })), payments: [{ method: 'cash', amountCents: 500000 }], expectedTotalCents: preview.totalCents },
    });
    expect(error).toBeNull();
    const sale = data as { invoiceNo: string; totalCents: number; promoCents: number; changeCents: number; replayed: boolean };
    expect(sale.totalCents).toBe(preview.totalCents);
    expect(sale.promoCents).toBe(preview.promoCents);
    expect(sale.changeCents).toBe(500000 - preview.totalCents);
    expect(sale.invoiceNo).toMatch(/^KDY1-L1-\d{6}$/);

    // A retry with the same clientUuid returns the same sale and writes nothing new (PRN-004).
    const again = await owner.schema('api').rpc('create_sale', {
      p: { clientUuid, laneId, lines: lines.map(({ itemId, qtyMilli }) => ({ itemId, qtyMilli })), payments: [{ method: 'cash', amountCents: 500000 }], expectedTotalCents: preview.totalCents },
    });
    expect((again.data as typeof sale).invoiceNo).toBe(sale.invoiceNo);
    expect((again.data as typeof sale).replayed).toBe(true);
  });

  it('rejects a tampered total with PRICE_MISMATCH (PRN-002)', async () => {
    const lines = basket();
    const { error } = await owner.schema('api').rpc('create_sale', {
      p: { clientUuid: randomUUID(), laneId, lines: lines.map(({ itemId, qtyMilli }) => ({ itemId, qtyMilli })), payments: [{ method: 'cash', amountCents: 100 }], expectedTotalCents: 100 },
    });
    expect(error?.message).toMatch(/^PRICE_MISMATCH/);
  });

  it('rejects underpayment and change from a card', async () => {
    const rice = byName('Samba Rice 5kg');
    const total = priceBasket([{ itemId: rice.id, itemType: 'standard', qtyMilli: 1000, unitPriceCents: rice.priceCents }], [], { roundingUnitCents: rounding }).totalCents;
    const base = { laneId, lines: [{ itemId: rice.id, qtyMilli: 1000 }], expectedTotalCents: total };
    const under = await owner.schema('api').rpc('create_sale', { p: { ...base, clientUuid: randomUUID(), payments: [{ method: 'cash', amountCents: total - 100 }] } });
    expect(under.error?.message).toMatch(/^UNDERPAID/);
    const card = await owner.schema('api').rpc('create_sale', { p: { ...base, clientUuid: randomUUID(), payments: [{ method: 'card', amountCents: total + 1000 }] } });
    expect(card.error?.message).toMatch(/change can only be given from cash/);
  });

  it('sales are append-only, even for the owner (PRN-003)', async () => {
    const { data: sale } = await owner.from('sales').select('id').limit(1).single();
    const { data } = await owner.from('sales').update({ total_cents: 1 }).eq('id', sale!.id).select();
    expect(data ?? []).toEqual([]); // no UPDATE grant / policy: nothing changes
    const { data: check } = await owner.from('sales').select('total_cents').eq('id', sale!.id).single();
    expect(check!.total_cents).not.toBe(1);
  });

  it('stock levels equal the sum of the movement ledger', async () => {
    const rice = byName('Samba Rice 5kg');
    const { data: level } = await owner.from('stock_levels').select('qty_milli').eq('shop_id', shopId).eq('item_id', rice.id).single();
    const { data: moves } = await owner.from('stock_movements').select('qty_milli').eq('shop_id', shopId).eq('item_id', rice.id);
    expect(level!.qty_milli).toBe(moves!.reduce((s, m) => s + m.qty_milli, 0));
  });
});

describe('schema guards', () => {
  it('every public table has RLS enabled and forced (PRN-001)', () => {
    const out = execSync(
      `npx supabase db query --linked "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const json = JSON.parse(out.slice(out.indexOf('{')));
    expect(json.rows).toEqual([]);
  }, 60_000);
});
