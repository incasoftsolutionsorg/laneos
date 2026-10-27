'use server';

import { revalidatePath } from 'next/cache';
import { parseRupees } from '@laneos/core';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface DamageState { error?: string; ok?: number; message?: string }

const REASONS = ['broken', 'leaking', 'crushed', 'pest', 'expired', 'temperature', 'other'];
const SOURCES = ['shelf', 'grn', 'transfer', 'count'];

export async function reportDamage(prev: DamageState, form: FormData): Promise<DamageState> {
  const ctx = await requireTenant('stock.adjust');
  const item = String(form.get('itemId') ?? '');
  const qty = Number(form.get('qty'));
  const reason = String(form.get('reason') ?? '');
  const source = String(form.get('source') ?? 'shelf');
  if (!item) return { error: 'Choose the damaged item.' };
  if (!(qty > 0)) return { error: 'Enter how many are damaged.' };
  if (!REASONS.includes(reason)) return { error: 'Choose a reason.' };
  if (!SOURCES.includes(source)) return { error: 'Choose where it was found.' };
  const { data, error } = await ctx.supabase.schema('api').rpc('report_damage', {
    p_shop: ctx.shop.id, p_item: item, p_qty_milli: Math.round(qty * 1000), p_reason: reason, p_source: source,
    p_note: String(form.get('note') ?? '').trim() || undefined,
    p_photo: String(form.get('photo') ?? '') || undefined,
  });
  if (error) return { error: error.message.startsWith('VALIDATION_ERROR: ') ? `${error.message.slice(18, 19).toUpperCase()}${error.message.slice(19)}.` : dbErrorText(error) };
  const r = data as { reportNo: string; status: string };
  revalidatePath('/backoffice/stock/damage');
  return {
    ok: (prev.ok ?? 0) + 1,
    message: r.status === 'awaiting_approval'
      ? `${r.reportNo} recorded. Its value is above the approval limit, so a second person must approve it.`
      : `${r.reportNo} recorded and moved out of sellable stock.`,
  };
}

export async function decideDamage(prev: DamageState, form: FormData): Promise<DamageState> {
  const ctx = await requireTenant('stock.adjust');
  const decision = String(form.get('decision'));
  const markdown = decision === 'reduced_sale' ? parseRupees(String(form.get('markdown') ?? '')) : null;
  if (decision === 'reduced_sale' && !markdown) return { error: 'Enter the reduced price.' };
  const { error } = await ctx.supabase.schema('api').rpc('decide_damage', {
    p_report: String(form.get('id')), p_decision: decision, p_qty_milli: Math.round(Number(form.get('qty')) * 1000),
    p_markdown_cents: markdown ?? undefined,
  });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/stock/damage');
  return { ok: (prev.ok ?? 0) + 1 };
}

export async function approveDamage(id: string, approve: boolean): Promise<{ error?: string }> {
  const ctx = await requireTenant('stock.adjust');
  const { error } = await ctx.supabase.schema('api').rpc('approve_damage', { p_report: id, p_approve: approve });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/stock/damage');
  return {};
}
