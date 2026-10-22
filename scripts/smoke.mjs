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

const { data: lane } = await sb.from('lanes').select('id').eq('code', 'L1').single();

const pages = [
  ['/login', null, 'Welcome back'],
  ['/backoffice', cookie, 'Today&#x27;s sales'],
  ['/backoffice/items', cookie, 'Anchor Full Cream Milk Powder 400g'],
  ['/backoffice/items?page=2', cookie, 'Samba Rice 5kg'],
  ['/backoffice/items?filter=low', cookie, 'Low stock'],
  ['/backoffice/items/new', cookie, 'Selling price'],
  ['/backoffice/customers', cookie, 'Nadeesha Fernando'],
  ['/backoffice/suppliers', cookie, 'Fonterra'],
  ['/backoffice/staff', cookie, 'Kasun Perera'],
  ['/backoffice/lanes', cookie, 'Open checkout'],
  ['/backoffice/reports/sales', cookie, 'KDY1-L1-'],
  ['/backoffice/reports/shifts', cookie, 'Expected'],
  ['/backoffice/settings', cookie, 'Devices &amp; lanes'],
  ['/backoffice/stock/damage', cookie, 'Not built yet'],
  ['/lane', cookie, 'Choose the lane'],
  [`/lane/${lane.id}`, cookie, 'Current sale'],
];

let failed = 0;
for (const [path, c, expect] of pages) {
  const res = await fetch(base + path, { headers: c ? { cookie: c } : {}, redirect: 'manual' });
  const body = res.status === 200 ? await res.text() : '';
  const ok = res.status === 200 && body.includes(expect);
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
