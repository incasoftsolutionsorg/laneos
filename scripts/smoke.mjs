// Smoke test against a running dev server: signs in as the demo owner and loads every built page.
// Run: node --env-file=apps/web/.env.local scripts/smoke.mjs [baseUrl]

import { createClient } from '@supabase/supabase-js';

const base = process.argv[2] ?? 'http://localhost:3000';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ref = new URL(url).hostname.split('.')[0];

const sb = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.auth.signInWithPassword({ email: process.env.DEMO_OWNER_EMAIL, password: process.env.DEMO_OWNER_PASSWORD });
if (error) throw error;

// Same cookie format @supabase/ssr writes: base64url JSON session, split into 3,180-char chunks.
const value = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url');
const chunks = value.match(/.{1,3180}/g);
const cookie = chunks.length === 1
  ? `sb-${ref}-auth-token=${value}`
  : chunks.map((c, i) => `sb-${ref}-auth-token.${i}=${c}`).join('; ');

const { data: lane } = await sb.from('lanes').select('id, shop:shops!inner(code)').eq('code', 'L1').eq('shop.code', 'KDY1').single();
const { data: lastSale } = await sb.from('sales').select('receipt_token, invoice_no').order('created_at', { ascending: false }).limit(1).single();

const pages = [
  ['/login', null, 'Welcome back'],
  ['/backoffice', cookie, 'Today&#x27;s sales'],
  ['/backoffice/items', cookie, 'Anchor Full Cream Milk Powder 400g'],
  ['/backoffice/items?page=2', cookie, 'Samba Rice 5kg'],
  ['/backoffice/items?filter=low', cookie, 'Low stock'],
  ['/backoffice/items/new', cookie, 'Retail price'],
  ['/backoffice/customers', cookie, 'Nadeesha Fernando'],
  ['/backoffice/suppliers', cookie, 'Fonterra'],
  ['/backoffice/staff', cookie, 'Kasun Perera'],
  ['/backoffice/lanes', cookie, 'Open checkout'],
  ['/backoffice/reports/sales', cookie, 'Daily sales'],
  ['/backoffice/reports/shifts', cookie, 'Expected'],
  ['/backoffice/settings', cookie, 'Returns &amp; credit notes'],
  ['/backoffice/settings/branding', cookie, 'Seasonal themes'],
  ['/backoffice/settings/tax', cookie, 'VAT registration'],
  ['/backoffice/settings/receipt', cookie, 'Paper width'],
  ['/backoffice/settings/security', cookie, 'Reset all access'],
  ['/backoffice/billing', cookie, 'Your plan'],
  ['/backoffice/profile', cookie, 'Active sessions'],
  ['/backoffice/profile/security/enrol-mfa', cookie, '2-step verification'],
  ['/backoffice/staff/roles', cookie, 'Returns with receipt'],
  ['/backoffice/wholesale', cookie, 'Invoice summary'],
  ['/backoffice/reports/margin', cookie, 'Margin %'],
  ['/backoffice/reports/items', cookie, 'Qty sold'],
  ['/backoffice/reports/stock', cookie, 'Stock value'],
  ['/backoffice/reports/damage', cookie, 'Wastage written off'],
  ['/backoffice/reports/credit-notes', cookie, 'Outstanding'],
  ['/backoffice/reports/tax', cookie, 'Tax class'],
  ['/backoffice/reports/shrinkage', cookie, 'Missing at counts'],
  ['/backoffice/reports/expiry', cookie, 'Expired stock lost'],
  ['/backoffice/reports/promotions', cookie, 'Discount given'],
  ['/backoffice/purchasing/returns', cookie, 'Supplier returns'],
  ['/backoffice/purchasing/returns/new', cookie, 'Return goods to a supplier'],
  ['/backoffice/reports/sales/csv', cookie, 'Category,Sales'],
  ['/backoffice/items/import', cookie, 'Import'],
  ['/backoffice/promotions', cookie, 'Promotions'],
  ['/backoffice/labels', cookie, 'Print labels'],
  ['/backoffice/stock/damage', cookie, 'Damaged goods'],
  ['/backoffice/stock/counts', cookie, 'Stock count'],
  ['/backoffice/stock/expiry', cookie, 'Expiry'],
  ['/backoffice/purchasing/orders', cookie, 'Purchase orders'],
  ['/backoffice/purchasing/grn', cookie, 'GRN'],
  ['/backoffice/purchasing/payments', cookie, 'Supplier payments'],
  ['/backoffice/credit-notes', cookie, 'Returns &amp; credit notes'],
  ['/backoffice/refunds', cookie, 'RTN-KDY1-'],
  ['/backoffice/sync-issues', cookie, 'Sync issues'],
  ['/backoffice/support', cookie, 'Help &amp; support'],
  ['/backoffice/head-office', cookie, 'All shops overview'],
  ['/backoffice/shops', cookie, 'CMB2'],
  ['/backoffice/stock-across-shops', cookie, 'Stock across shops'],
  ['/backoffice/transfers?show=all', cookie, 'TRF-KDY1-'],
  ['/backoffice/transfers/new', cookie, 'Request stock'],
  ['/backoffice/pricing/lists', cookie, 'Central pricing'],
  ['/backoffice/pricing/overrides', cookie, 'Shop overrides'],
  ['/backoffice/pricing/schedules', cookie, 'Schedule a price change'],
  ['/backoffice/revenue', cookie, 'Sales by shop'],
  ['/backoffice/damage-across-shops', cookie, 'Waiting for a decision'],
  ['/backoffice/activity-logs', cookie, 'Activity logs'],
  ['/backoffice/access', cookie, 'Users &amp; access'],
  ['/backoffice/plan', cookie, 'Your plan'],
  ['/admin', cookie, '', 307],
  ['/admin/login', null, 'Platform admin'],
  ['/register', null, 'Create your shop account'],
  ['/auth/confirm', null, 'Signing you in'],
  ['/lane-sw.js', null, 'laneos-lane-pages'],
  ['/backoffice/settings/branding', cookie, 'Upload new logo'],
  ['/login/mfa', null, 'Enter your code'],
  ['/lane', cookie, 'Choose the lane'],
  ['/lane/register', cookie, 'Register this device'],
  [`/lane/${lane.id}`, cookie, 'Current sale'],
  [`/lane/${lane.id}/pin`, cookie, 'Lane L1'],
  [`/lane/${lane.id}/shift`, cookie, 'Count the drawer'],
  [`/lane/${lane.id}/return`, cookie, 'Customer return'],
  [`/lane/${lane.id}/display`, cookie, ''],
  ['/lane/print', cookie, ''],
  [`/r/${lastSale.receipt_token}`, null, lastSale.invoice_no],
  ['/r/00000000000000000000000000000000', null, '', 404],
];

// Platform admin pages with the staff login from scripts/seed-admin.mjs.
const sa = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: ad, error: adErr } = await sa.auth.signInWithPassword({ email: process.env.DEMO_ADMIN_EMAIL, password: process.env.DEMO_ADMIN_PASSWORD });
if (adErr) throw adErr;
const adminValue = 'base64-' + Buffer.from(JSON.stringify(ad.session)).toString('base64url');
const adminCookie = (adminValue.match(/.{1,3180}/g)).map((c, i, all) => all.length === 1 ? `sb-${ref}-auth-token=${c}` : `sb-${ref}-auth-token.${i}=${c}`).join('; ');
const { data: anyTenant } = await sa.schema('api').rpc('admin_tenants', { p_search: '', p_status: '' });
pages.push(
  ['/admin', adminCookie, 'Platform overview'],
  ['/admin/tenants', adminCookie, 'ABC Supermarket'],
  [`/admin/tenants/${anyTenant[0].id}`, adminCookie, 'Account controls'],
  ['/admin/billing', adminCookie, 'Monthly invoices'],
  ['/admin/plans', adminCookie, 'Store Pro'],
  ['/admin/overdue', adminCookie, 'Overdue accounts'],
  ['/admin/tickets?status=', adminCookie, 'Support tickets'],
  ['/admin/live-activity', adminCookie, 'Bills per minute'],
  ['/admin/impersonation', adminCookie, 'Recent support views'],
  ['/admin/security', adminCookie, 'Sign everyone out'],
  ['/admin/audit', adminCookie, 'platform.'],
  ['/admin/profile', adminCookie, '2-step'],
  ['/admin/tenants/new', adminCookie, 'Create tenant and send invite'],
  ['/backoffice', adminCookie, '', 307],
);

let failed = 0;
for (const [path, c, expect, status = 200] of pages) {
  const res = await fetch(base + path, { headers: c ? { cookie: c } : {}, redirect: 'manual' });
  const body = res.status === 200 ? await res.text() : '';
  const ok = res.status === status && body.includes(expect);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${res.status} ${path}${ok ? '' : `  (expected "${expect}")`}`);
}

const anon = await fetch(base + '/backoffice', { redirect: 'manual' });
const redirected = anon.status === 307 && anon.headers.get('location')?.includes('/login');
console.log(`${redirected ? 'ok  ' : 'FAIL'} signed-out /backoffice → /login`);
if (!redirected) failed++;

const api = await fetch(base + '/api/lane/sales', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ totalCents: 1 }) });
const apiOk = api.status === 400 && (await api.json()).error.code === 'VALIDATION_ERROR';
console.log(`${apiOk ? 'ok  ' : 'FAIL'} POST /api/lane/sales rejects a bad body (${api.status})`);
if (!apiOk) failed++;

process.exit(failed ? 1 : 0);
