'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { checkoutHash, payhereAmount, payhereConfig } from '@/lib/payhere';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export async function changePlan(planId: string): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireTenant('settings.manage');
  const { error } = await ctx.supabase.schema('api').rpc('change_plan', { p_plan: planId });
  if (error) {
    if (error.message.startsWith('PLAN_LIMIT')) return { error: error.message.replace('PLAN_LIMIT: ', 'You use more than this plan allows: ').replace(/allows$/, 'allows. Remove shops, lanes or staff first.') };
    return { error: error.message.startsWith('VALIDATION_ERROR') ? error.message.replace('VALIDATION_ERROR: ', '') : dbErrorText(error) };
  }
  revalidatePath('/backoffice', 'layout');
  return { ok: 'Plan changed. The new price applies from your next charge.' };
}

export interface PayhereCheckout { error?: string; url?: string; fields?: Record<string, string> }

/** Fields for the PayHere checkout form (WF-008) for one open invoice. The browser posts them to PayHere. */
export async function startPayhere(invoiceId: string): Promise<PayhereCheckout> {
  const ctx = await requireTenant('settings.manage');
  const cfg = payhereConfig();
  if (!cfg) return { error: 'Online payment is not set up yet. Pay by bank transfer and LaneOS will record it.' };
  const { data: inv } = await ctx.supabase.from('saas_invoices').select('invoice_no, amount_cents, status, period_start').eq('id', invoiceId).maybeSingle();
  if (!inv || inv.status !== 'open') return { error: 'This invoice is not open.' };
  const { data: shop } = await ctx.supabase.from('shops').select('address, phone').eq('id', ctx.shop.id).single();
  const { data: t } = await ctx.supabase.from('tenants').select('city').eq('id', ctx.tenant.id).single();
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const origin = `${h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')}://${host}`;
  const [first, ...rest] = ctx.member.name.split(' ');
  return {
    url: cfg.checkoutUrl,
    fields: {
      merchant_id: cfg.merchantId,
      return_url: `${origin}/backoffice/billing?paid=1`,
      cancel_url: `${origin}/backoffice/billing`,
      notify_url: `${origin}/api/payhere/notify`,
      order_id: inv.invoice_no,
      items: `LaneOS subscription ${inv.period_start.slice(0, 7)}`,
      currency: 'LKR',
      amount: payhereAmount(inv.amount_cents),
      first_name: first ?? 'Owner',
      last_name: rest.join(' ') || '-',
      email: ctx.email,
      phone: (shop?.phone ?? '').replace(/^\+94/, '0') || '0000000000',
      address: shop?.address ?? '-',
      city: t?.city ?? 'Colombo',
      country: 'Sri Lanka',
      hash: checkoutHash(cfg.merchantId, cfg.secret, inv.invoice_no, inv.amount_cents),
    },
  };
}
