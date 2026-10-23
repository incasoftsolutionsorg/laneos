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

  it('generating invoices twice for a month creates nothing the second time', async () => {
    const period = '2099-01-01';
    const first = await admin.schema('api').rpc('admin_generate_invoices', { p_period: period });
    expect(first.error).toBeNull();
    expect((await admin.schema('api').rpc('admin_generate_invoices', { p_period: period })).data).toBe(0);
  });
});
