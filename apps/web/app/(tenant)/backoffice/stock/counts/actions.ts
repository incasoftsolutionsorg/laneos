'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface CountState { error?: string }

export async function startCount(_: CountState, form: FormData): Promise<CountState> {
  const ctx = await requireTenant('stock.adjust');
  const dept = String(form.get('departmentId') ?? '') || undefined;
  const name = String(form.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Name the section you are counting, e.g. "Dairy · Aisle 3".' };
  const { data, error } = await ctx.supabase.schema('api').rpc('start_count', { p_shop: ctx.shop.id, p_name: name, p_department: dept });
  if (error) return { error: dbErrorText(error) };
  redirect(`/backoffice/stock/counts/${data as string}`);
}

export async function recordCount(lineId: string, qty: string): Promise<{ error?: string }> {
  const ctx = await requireTenant('stock.adjust');
  const n = Number(qty);
  if (qty.trim() === '' || !(n >= 0)) return { error: 'Enter a number (0 or more).' };
  const { error } = await ctx.supabase.schema('api').rpc('record_count', { p_line: lineId, p_counted_milli: Math.round(n * 1000) });
  return error ? { error: dbErrorText(error) } : {};
}

export async function countAction(countId: string, action: 'submit' | 'post' | 'cancel' | 'reopen'): Promise<{ error?: string }> {
  const ctx = await requireTenant('stock.adjust');
  const { error } = await ctx.supabase.schema('api').rpc('count_action', { p_count: countId, p_action: action });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/stock/counts');
  revalidatePath(`/backoffice/stock/counts/${countId}`);
  return {};
}
