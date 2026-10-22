'use server';

import { revalidatePath } from 'next/cache';
import { normalizeLkPhone, parseRupees } from '@laneos/core';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface ShiftState { error?: string; result?: { expectedCashCents: number; countedCashCents: number; varianceCents: number } }

export async function openShift(_: ShiftState, form: FormData): Promise<ShiftState> {
  const ctx = await requireTenant('sale.create');
  const laneId = String(form.get('laneId'));
  const float = parseRupees(String(form.get('float') || '0'));
  if (float == null) return { error: 'Enter the opening float, e.g. 5,000.00' };
  const { error } = await ctx.supabase.schema('api').rpc('open_shift', { p_lane: laneId, p_opening_float_cents: float });
  if (error) return { error: dbErrorText(error) };
  revalidatePath(`/lane/${laneId}`);
  return {};
}

export async function closeShift(_: ShiftState, form: FormData): Promise<ShiftState> {
  const ctx = await requireTenant('sale.create');
  const counted = parseRupees(String(form.get('counted') ?? ''));
  if (counted == null) return { error: 'Count the cash in the drawer and enter the total.' };
  const { data, error } = await ctx.supabase.schema('api').rpc('close_shift', {
    p_shift: String(form.get('shiftId')), p_counted_cash_cents: counted,
  });
  if (error) return { error: dbErrorText(error) };
  return { result: data as unknown as NonNullable<ShiftState['result']> };
}

export interface CustomerHit { id: string; name: string; phone: string; balanceDueCents: number }

export async function findCustomer(phone: string): Promise<CustomerHit | null> {
  const ctx = await requireTenant('sale.create');
  const normalized = normalizeLkPhone(phone);
  if (!normalized) return null;
  const { data } = await ctx.supabase.from('customers').select('id, name, phone, balance_due_cents').eq('phone', normalized).eq('is_active', true).maybeSingle();
  return data ? { id: data.id, name: data.name, phone: data.phone, balanceDueCents: data.balance_due_cents } : null;
}
