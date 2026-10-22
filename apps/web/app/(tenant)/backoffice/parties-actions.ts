'use server';

import { revalidatePath } from 'next/cache';
import { CustomerInput, SupplierInput, normalizeLkPhone, parseRupees } from '@laneos/core';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface PartyFormState { error?: string; ok?: number }

const phoneOrRaw = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : normalizeLkPhone(s) ?? s;
};

export async function createCustomer(prev: PartyFormState, form: FormData): Promise<PartyFormState> {
  const ctx = await requireTenant('customer.manage');
  const parsed = CustomerInput.safeParse({
    name: form.get('name'),
    phone: phoneOrRaw(form.get('phone')),
    email: String(form.get('email') ?? '').trim() || null,
    creditLimitCents: parseRupees(String(form.get('creditLimit') || '0')) ?? -1,
    marketingConsent: form.get('marketingConsent') === 'on',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const { error } = await ctx.supabase.from('customers').insert({
    tenant_id: ctx.tenant.id, name: v.name, phone: v.phone, email: v.email ?? null,
    credit_limit_cents: v.creditLimitCents, marketing_consent: v.marketingConsent, created_by: ctx.userId,
  });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/customers');
  return { ok: (prev.ok ?? 0) + 1 };
}

export async function createSupplier(prev: PartyFormState, form: FormData): Promise<PartyFormState> {
  const ctx = await requireTenant('supplier.manage');
  const parsed = SupplierInput.safeParse({
    name: form.get('name'),
    phone: phoneOrRaw(form.get('phone')),
    email: String(form.get('email') ?? '').trim() || null,
    paymentTermsDays: Number(form.get('paymentTermsDays') || 30),
    isSaleOrReturn: form.get('isSaleOrReturn') === 'on',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const { error } = await ctx.supabase.from('suppliers').insert({
    tenant_id: ctx.tenant.id, name: v.name, phone: v.phone ?? null, email: v.email ?? null,
    payment_terms_days: v.paymentTermsDays, is_sale_or_return: v.isSaleOrReturn, created_by: ctx.userId,
  });
  if (error) return { error: error.code === '23505' ? 'A supplier with this name already exists.' : dbErrorText(error) };
  revalidatePath('/backoffice/suppliers');
  return { ok: (prev.ok ?? 0) + 1 };
}

export async function addLane(prev: PartyFormState, form: FormData): Promise<PartyFormState> {
  const ctx = await requireTenant('staff.manage');
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { error: 'Give the lane a name, e.g. "Lane 2".' };
  const { error } = await ctx.supabase.schema('api').rpc('add_lane', { p_shop_id: ctx.shop.id, p_name: name });
  if (error) return { error: error.message.startsWith('PLAN_LIMIT') ? `Your plan allows ${error.message.replace(/\D+/g, ' ').trim().split(' ')[0]} lanes per shop.` : dbErrorText(error) };
  revalidatePath('/backoffice/lanes');
  return { ok: (prev.ok ?? 0) + 1 };
}
