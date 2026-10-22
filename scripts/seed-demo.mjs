// Seeds a demo business on the linked Supabase project (staging only — never production).
// Run: pnpm db:seed   (reads apps/web/.env.local)
//
// Everything except creating the login goes through the same api.* functions the app uses,
// signed in as the demo owner, so RLS and permission checks are exercised by the seed too.

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.DEMO_OWNER_EMAIL ?? 'owner@demo.laneos.lk';
const password = process.env.DEMO_OWNER_PASSWORD;
if (!url || !anon || !service || !password) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEMO_OWNER_PASSWORD');
  process.exit(1);
}

const admin = createClient(url, service, { auth: { persistSession: false } });

function ean13(body12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body12[11 - i]) * (i % 2 === 0 ? 3 : 1);
  return body12 + ((10 - (sum % 10)) % 10);
}

export async function ensureUser(adminClient, userEmail, userPassword) {
  const { data: list, error } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const existing = list.users.find((u) => u.email === userEmail);
  if (existing) {
    await adminClient.auth.admin.updateUserById(existing.id, { password: userPassword });
    return existing.id;
  }
  const { data, error: createError } = await adminClient.auth.admin.createUser({ email: userEmail, password: userPassword, email_confirm: true });
  if (createError) throw createError;
  return data.user.id;
}

export async function signInAs(userEmail, userPassword) {
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: userEmail, password: userPassword });
  if (error) throw error;
  return client;
}

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

const DEPARTMENTS = ['Dairy', 'Rice & grains', 'Bakery', 'Vegetables', 'Beverages', 'Household', 'Biscuits'];

// name, department, type, price Rs, MRP Rs, cost Rs, stock, reorder, pinned, plu
const ITEMS = [
  ['Anchor Full Cream Milk Powder 400g', 'Dairy', 'standard', 1180, 1200, 1040, 6, 10, true],
  ['Samba Rice 5kg', 'Rice & grains', 'standard', 1230, 1250, 1095, 64, 15, true],
  ['Prima Sandwich Bread 450g', 'Bakery', 'standard', 160, 160, 128, 38, 10, true],
  ['Highland Yoghurt 80g', 'Dairy', 'standard', 110, 110, 86, 120, 30, true],
  ['Munchee Super Cream Cracker 490g', 'Biscuits', 'standard', 390, 400, 330, 55, 12, true],
  ['Elephant House Cream Soda 1.5L', 'Beverages', 'standard', 420, 420, 350, 30, 12, true],
  ['Bananas (Ambul) per kg', 'Vegetables', 'weighed', 380, null, 290, 25.4, 5, true, 1201],
  ['Carrots per kg', 'Vegetables', 'weighed', 480, null, 360, 42.6, 8, true, 1234],
  ['Dhal (Mysore) 1kg', 'Rice & grains', 'standard', 345, 360, 300, 77, 20, true],
  ['Coconut (large)', 'Vegetables', 'standard', 140, null, 105, 210, 40, true],
  ['Sunlight Soap 110g', 'Household', 'standard', 95, 100, 76, 140, 30, true],
  ['Lanka Eggs (10 pack)', 'Dairy', 'standard', 520, 550, 455, 0, 10, true],
  ['Maliban Marie 80g', 'Biscuits', 'standard', 120, 120, 98, 90, 20, true],
  ['Kotmale Fresh Milk 1L', 'Dairy', 'standard', 590, 600, 510, 26, 10, true],
  ['Carrier bag', 'Household', 'standard', 5, null, 2, 500, 100, true],
  ['Keeri Samba Rice 1kg', 'Rice & grains', 'standard', 310, 320, 270, 48, 10, false],
  ['Red Raw Rice 5kg', 'Rice & grains', 'standard', 1050, 1080, 920, 22, 8, false],
  ['Big Onions per kg', 'Vegetables', 'weighed', 360, null, 280, 60, 10, false, 1301],
  ['Potatoes per kg', 'Vegetables', 'weighed', 420, null, 330, 35.2, 10, false, 1302],
  ['Tomatoes per kg', 'Vegetables', 'weighed', 650, null, 500, 8.5, 5, false, 1303],
  ['Kist Mixed Fruit Jam 510g', 'Household', 'standard', 690, 720, 590, 14, 6, false],
  ['Milo 400g', 'Beverages', 'standard', 1150, 1180, 1010, 18, 6, false],
  ['Lipton Ceylonta Tea 200g', 'Beverages', 'standard', 780, 800, 680, 33, 8, false],
  ['Coca-Cola 1.5L', 'Beverages', 'standard', 450, 460, 380, 40, 12, false],
  ['Signal Toothpaste 120g', 'Household', 'standard', 340, 350, 285, 27, 8, false],
  ['Vim Dishwash Liquid 500ml', 'Household', 'standard', 495, 520, 410, 3, 6, false],
  ['Fresh Butter Cake 500g', 'Bakery', 'standard', 650, null, 480, 9, 4, false],
  ['Fish Buns', 'Bakery', 'standard', 90, null, 55, 24, 10, false],
  ['Cheese Slices 200g', 'Dairy', 'standard', 1250, 1290, 1080, 11, 5, false],
  ['Loose vegetables (open price)', 'Vegetables', 'open_price', null, null, null, 0, 0, false, 9001],
];

async function main() {
  console.log(`Seeding demo business for ${email} on ${url}`);
  await ensureUser(admin, email, password);
  const db = await signInAs(email, password);
  const api = db.schema('api');

  const { data: member } = await db.from('members').select('id, tenant_id').maybeSingle();
  if (!member) {
    must(await api.rpc('create_tenant', {
      p_name: 'ABC Supermarket', p_slug: 'abc-supermarket', p_shop_code: 'KDY1', p_shop_name: 'Kandy', p_owner_name: 'Kasun Perera',
    }), 'create_tenant');
    console.log('  created tenant ABC Supermarket, shop KDY1, lane L1');
  }

  const shop = must(await db.from('shops').select('id, tenant_id').eq('code', 'KDY1').single(), 'shop');
  const { count } = await db.from('items').select('id', { count: 'exact', head: true });
  if (count && count > 0) {
    console.log(`  ${count} items already there — skipping catalogue`);
  } else {
    await seedCatalogue(db, api, shop);
  }
  await seedParties(db, api, shop);
  console.log('Done.');
}

async function seedCatalogue(db, api, shop) {

  must(await db.from('departments').insert(DEPARTMENTS.map((name, i) => ({ tenant_id: shop.tenant_id, name, sort_order: i }))), 'departments');
  const depts = new Map(must(await db.from('departments').select('id, name'), 'departments').map((d) => [d.name, d.id]));

  const ids = new Map();
  for (const [i, [name, dept, type, price, mrp, cost, stock, reorder, pinned, plu]] of ITEMS.entries()) {
    const cents = (rs) => (rs == null ? null : Math.round(rs * 100));
    const id = must(await api.rpc('upsert_item', {
      p: {
        name, departmentId: depts.get(dept), itemType: type, taxClass: 'standard', plu: plu ?? null,
        barcode: type === 'standard' ? ean13(`479${String(2081000000 + i * 1117).padStart(9, '0')}`) : null,
        priceCents: cents(price) ?? 0, mrpCents: cents(mrp), costCents: cents(cost),
        reorderLevelMilli: Math.round(reorder * 1000), isPinned: pinned,
      },
    }), `item ${name}`);
    ids.set(name, id);
    if (stock > 0) {
      must(await api.rpc('adjust_stock', { p_shop: shop.id, p_item: id, p_qty_milli: Math.round(stock * 1000), p_reason: 'opening' }), `stock ${name}`);
    }
  }
  console.log(`  ${ITEMS.length} items with barcodes, prices and opening stock`);

  const promo = must(await db.from('promotions').insert({
    tenant_id: shop.tenant_id, name: '3 for 450', kind: 'multi_buy', buy_qty: 3, bundle_price_cents: 45000,
  }).select('id').single(), 'promotion');
  must(await db.from('promotion_items').insert({ promotion_id: promo.id, item_id: ids.get('Prima Sandwich Bread 450g'), tenant_id: shop.tenant_id }), 'promotion item');
  console.log('  promotion "3 for 450"');
}

async function seedParties(db, api, shop) {
  const { count } = await db.from('customers').select('id', { count: 'exact', head: true });
  if (count && count > 0) return console.log('  customers already there — skipping parties');
  // defaultToNull: false so columns a row leaves out get their default, not null.

  must(await db.from('customers').insert([
    { tenant_id: shop.tenant_id, name: 'Nadeesha Fernando', phone: '+94771234567', credit_limit_cents: 2500000, marketing_consent: true },
    { tenant_id: shop.tenant_id, name: 'Ruwan Silva', phone: '+94712345678', credit_limit_cents: 0 },
    { tenant_id: shop.tenant_id, name: 'Hotel Hilltop (wholesale)', phone: '+94762223344', credit_limit_cents: 15000000 },
  ], { defaultToNull: false }), 'customers');
  must(await db.from('suppliers').insert([
    { tenant_id: shop.tenant_id, name: 'Fonterra Brands Lanka', phone: '+94777000111', payment_terms_days: 30 },
    { tenant_id: shop.tenant_id, name: 'Prima Ceylon (bread)', payment_terms_days: 7, is_sale_or_return: true },
    { tenant_id: shop.tenant_id, name: 'Kandy Vegetable Market', payment_terms_days: 0 },
  ], { defaultToNull: false }), 'suppliers');

  must(await api.rpc('add_lane', { p_shop_id: shop.id, p_name: 'Lane 2' }), 'lane 2');
  console.log('  3 customers, 3 suppliers, lane L2');
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('seed-demo.mjs')) {
  main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
