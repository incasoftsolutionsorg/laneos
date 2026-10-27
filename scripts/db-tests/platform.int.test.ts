// Platform admin against staging (migrations 20261023091000–091100). Needs DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD
// (scripts/seed-admin.mjs). Every admin function must refuse a tenant user; support views are audited in the tenant's log.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let owner: SupabaseClient;
let admin: SupabaseClient;
let tenantId: string;
let shopId: string;

async function signIn(email: string, password: string) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

beforeAll(async () => {
  owner = await signIn(process.env.DEMO_OWNER_EMAIL!, process.env.DEMO_OWNER_PASSWORD!);
  admin = await signIn(process.env.DEMO_ADMIN_EMAIL!, process.env.DEMO_ADMIN_PASSWORD!);
  const { data } = await owner.from('shops').select('id, tenant_id').eq('code', 'KDY1').single();
  tenantId = data!.tenant_id;
  shopId = data!.id;
}, 60_000);

describe('access', () => {
  it('tenant users cannot call admin functions; admins can', async () => {
    expect((await owner.schema('api').rpc('admin_overview')).error?.message).toMatch(/platform admins only/);
    expect((await owner.schema('api').rpc('is_platform_admin')).data).toBe(false);
    expect((await admin.schema('api').rpc('is_platform_admin')).data).toBe(true);
    const { data, error } = await admin.schema('api').rpc('admin_overview');
    expect(error).toBeNull();
    expect((data as { mrr: number }).mrr).toBeGreaterThanOrEqual(0);
  });

  it('lists and opens the demo tenant', async () => {
    const list = (await admin.schema('api').rpc('admin_tenants', { p_search: '', p_status: '' })).data as { id: string }[];
    expect(list.some((t) => t.id === tenantId)).toBe(true);
    const d = (await admin.schema('api').rpc('admin_tenant', { p_tenant: tenantId })).data as { shops: { code: string }[] };
    expect(d.shops.map((s) => s.code)).toContain('KDY1');
  });
});

describe('tickets', () => {
  it('a business opens a ticket, support replies, the business sees it', async () => {
    const { data: id, error } = await owner.schema('api').rpc('create_ticket', { p_subject: 'ZZ test: printer', p_body: 'Lane L2 does not print', p_priority: 'low' });
    expect(error).toBeNull();
    expect((await admin.schema('api').rpc('ticket_reply', { p_ticket: id, p_body: 'Is QZ Tray running?', p_status: null })).error).toBeNull();
    const { data: t } = await owner.from('support_tickets').select('status, ticket_messages(is_staff)').eq('id', id as string).single();
    expect(t!.status).toBe('pending');
    expect(t!.ticket_messages.some((m) => m.is_staff)).toBe(true);
    await owner.schema('api').rpc('ticket_reply', { p_ticket: id, p_body: 'Fixed, thanks', p_status: 'closed' });
    expect((await owner.from('support_tickets').select('status').eq('id', id as string).single()).data!.status).toBe('closed');
  });
});

describe('support view', () => {
  it('needs a session, and the business sees it in its activity log', async () => {
    expect((await admin.schema('api').rpc('admin_support_view', { p_tenant: tenantId })).error?.message).toMatch(/start a support session/);
    const { data: sid, error } = await admin.schema('api').rpc('admin_start_support', { p_tenant: tenantId, p_reason: 'ZZ test support view', p_minutes: 5 });
    expect(error).toBeNull();
    const view = await admin.schema('api').rpc('admin_support_view', { p_tenant: tenantId });
    expect(view.error).toBeNull();
    expect((view.data as { counts: { items: number } }).counts.items).toBeGreaterThan(0);
    const { data: log } = await owner.from('audit_log').select('action').eq('entity_id', sid as string);
    expect(log!.map((l) => l.action)).toContain('support.view_start');
    await admin.schema('api').rpc('admin_end_support', { p_session: sid });
    expect((await admin.schema('api').rpc('admin_support_view', { p_tenant: tenantId })).error).not.toBeNull();
  });
});

describe('suspension and invoices', () => {
  it('a suspended tenant cannot record wholesale documents (or sales)', async () => {
    const { data: t } = await owner.from('tenants').select('status').single();
    const before = t!.status;
    expect((await admin.schema('api').rpc('admin_update_tenant', { p_tenant: tenantId, p: { status: 'suspended', reason: 'ZZ test' } })).error).toBeNull();
    try {
      const { data: item } = await owner.from('items').select('id').eq('is_active', true).limit(1).single();
      const r = await owner.schema('api').rpc('save_wholesale', { p_shop: shopId, p: { kind: 'quotation', buyerName: 'ZZ', lines: [{ itemId: item!.id, packQty: 1, qty: 1 }] } });
      expect(r.error?.message).toBe('TENANT_SUSPENDED');
    } finally {
      await admin.schema('api').rpc('admin_update_tenant', { p_tenant: tenantId, p: { status: before, reason: 'ZZ test restore' } });
    }
    expect((await owner.from('tenants').select('status').single()).data!.status).toBe(before);
  });

  it('bills tenants once their trial ends (first month by the day), once per month', async () => {
    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data: t } = await service.from('tenants').select('status, trial_ends_on, plan:plans(price_cents, per_shop)').eq('id', tenantId).single();
    const { count: shops } = await service.from('shops').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_active', true);
    const plan = t!.plan as unknown as { price_cents: number; per_shop: boolean };
    const full = plan.per_shop ? plan.price_cents * Math.max(1, shops ?? 0) : plan.price_cents;
    expect(t!.trial_ends_on).not.toBeNull(); // 20261027092340 gave old trials an end date

    // The month the trial ends: charged from the trial's last day to the month end.
    const end = t!.trial_ends_on as string;
    const monthStart = `${end.slice(0, 7)}-01`;
    const days = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0)).getUTCDate();
    const prorated = Math.round((full * (days - Number(end.slice(8, 10)) + 1)) / days);
    const before = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
    const periods = [monthStart, '2099-01-01'];
    const existing = new Set(((await service.from('saas_invoices').select('id').in('period_start', [...periods, before])).data ?? []).map((r) => r.id));
    try {
      for (const p of periods) {
        expect((await admin.schema('api').rpc('admin_generate_invoices', { p_period: p })).error).toBeNull();
        expect((await admin.schema('api').rpc('admin_generate_invoices', { p_period: p })).data).toBe(0);
      }
      const { data: inv } = await service.from('saas_invoices').select('period_start, amount_cents').eq('tenant_id', tenantId).in('period_start', periods).order('period_start');
      expect(inv).toEqual([{ period_start: monthStart, amount_cents: end.endsWith('-01') ? full : prorated }, { period_start: '2099-01-01', amount_cents: full }]);
      // The month before the trial ends is free.
      await admin.schema('api').rpc('admin_generate_invoices', { p_period: before });
      expect((await service.from('saas_invoices').select('id').eq('tenant_id', tenantId).eq('period_start', before)).data).toEqual([]);
    } finally {
      // Leave staging as it was: remove only the invoices this test created.
      const { data: made } = await service.from('saas_invoices').select('id').in('period_start', [...periods, before]);
      const ids = (made ?? []).map((r) => r.id).filter((id) => !existing.has(id));
      if (ids.length) await service.from('saas_invoices').delete().in('id', ids);
    }
  });
});

describe('PayHere notify (20261027090900)', () => {
  it('only the service role can record a payment; wrong amounts and statuses change nothing', async () => {
    const args = { p_order: 'INV-NOPE', p_payment: 'ZZ-PAY', p_amount_cents: 100, p_status: 2 };
    expect((await owner.schema('api').rpc('payhere_paid', args)).error).not.toBeNull();
    expect((await admin.schema('api').rpc('payhere_paid', args)).error).not.toBeNull();

    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const pay = async (p: typeof args) => (await service.schema('api').rpc('payhere_paid', p)).data as string;
    expect(await pay(args)).toBe('unknown_order');

    // A throw-away open invoice for the demo tenant (its trial has no end date, so the invoice run skips it).
    const invoiceNo = `INV-ZZ-${Date.now()}`;
    const { data: inv, error } = await service.from('saas_invoices').insert({ tenant_id: tenantId, invoice_no: invoiceNo, plan_id: 'growth',
      period_start: '2098-01-01', period_end: '2098-01-31', amount_cents: 540000, due_on: '2098-01-08' }).select('id').single();
    expect(error).toBeNull();
    const order = { ...args, p_order: invoiceNo, p_amount_cents: 540000 };
    const { data: before } = await service.from('tenants').select('status, next_charge_on').eq('id', tenantId).single();
    try {
      expect(await pay({ ...order, p_status: 0 })).toBe('ignored_status');
      expect(await pay({ ...order, p_amount_cents: 539999 })).toBe('amount_mismatch');
      expect((await service.from('saas_invoices').select('status').eq('id', inv!.id).single()).data!.status).toBe('open');
      expect(await pay(order)).toBe('paid');
      expect(await pay(order)).toBe('already_paid');
      const { data: paid } = await service.from('saas_invoices').select('status, payhere_order_id').eq('id', inv!.id).single();
      expect(paid).toEqual({ status: 'paid', payhere_order_id: 'ZZ-PAY' });
      expect((await service.from('tenants').select('status').eq('id', tenantId).single()).data!.status).toBe('active');
    } finally {
      await service.from('tenants').update(before!).eq('id', tenantId);
      await service.from('saas_invoices').delete().eq('id', inv!.id);
    }
  });
});

describe('create tenant for a customer', () => {
  it('needs a platform admin and an existing login; one business per owner', async () => {
    const args = { p_owner_email: 'zz-created-by-admin@example.test', p_name: 'ZZ Admin Created Shop', p_slug: 'zz-admin-created-shop',
      p_shop_code: 'ZZA1', p_shop_name: 'ZZ Town', p_owner_name: 'ZZ Owner', p_plan: 'lite', p_trial: true, p_details: {} };
    expect((await owner.schema('api').rpc('admin_create_tenant', args)).error?.message).toMatch(/platform admins only/);
    expect((await admin.schema('api').rpc('admin_create_tenant', { ...args, p_owner_email: 'nobody-zz@example.test' })).error?.message).toMatch(/no login/);

    // A fixed throw-away owner: the first run creates the business, later runs hit "already belongs to a business".
    const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    await service.auth.admin.createUser({ email: args.p_owner_email, email_confirm: true, password: `Zz-${Date.now()}-pw` });
    const r = await admin.schema('api').rpc('admin_create_tenant', args);
    if (r.error) {
      expect(r.error.message).toMatch(/already belongs to a business/);
    } else {
      const d = (await admin.schema('api').rpc('admin_tenant', { p_tenant: r.data })).data as { tenant: { status: string }; shops: { code: string }[] };
      expect(d.tenant.status).toBe('trial');
      expect(d.shops.map((x) => x.code)).toEqual(['ZZA1']);
      await admin.schema('api').rpc('admin_update_tenant', { p_tenant: r.data, p: { status: 'cancelled', reason: 'ZZ test tenant' } });
    }
  });
});
