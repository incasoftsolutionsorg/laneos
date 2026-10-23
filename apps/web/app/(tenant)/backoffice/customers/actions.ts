'use server';

import { revalidatePath } from 'next/cache';
import { parseRupees } from '@laneos/core';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface PaymentResult { error?: string; ok?: { amountCents: number; balanceCents: number; at: string } }

const METHODS = ['cash', 'bank', 'cheque'] as const;

/** Receive a payment from a credit customer (Figma 1-3034). Settles the oldest bills first. */
export async function receivePayment(customerId: string, amountText: string, method: string, reference: string): Promise<PaymentResult> {
  const ctx = await requireTenant('customer.manage');
  const amount = parseRupees(amountText);
  if (!amount || amount <= 0) return { error: 'Enter the amount received.' };
  if (!METHODS.includes(method as (typeof METHODS)[number])) return { error: 'Choose cash, bank or cheque.' };
  if (method === 'cheque' && !reference.trim()) return { error: 'Enter the cheque number.' };
  const { error } = await ctx.supabase.schema('api').rpc('receive_customer_payment', {
    p_customer: customerId, p_amount_cents: amount, p_method: method, p_reference: reference.trim() || undefined,
  });
  if (error) return { error: dbErrorText(error) };
  const { data } = await ctx.supabase.from('customers').select('balance_due_cents').eq('id', customerId).single();
  revalidatePath('/backoffice/customers');
  return { ok: { amountCents: amount, balanceCents: data?.balance_due_cents ?? 0, at: new Date().toISOString() } };
}

export async function updateCreditLimit(customerId: string, limitText: string): Promise<{ error?: string }> {
  const ctx = await requireTenant('customer.manage');
  const limit = parseRupees(limitText || '0');
  if (limit == null || limit < 0) return { error: 'Enter a credit limit in rupees (0 = cash only).' };
  const { error } = await ctx.supabase.from('customers').update({ credit_limit_cents: limit }).eq('id', customerId);
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/customers');
  return {};
}
