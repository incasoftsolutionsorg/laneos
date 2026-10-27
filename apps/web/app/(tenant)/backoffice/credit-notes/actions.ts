'use server';

import { revalidatePath } from 'next/cache';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface NoteActionState { error?: string; ok?: number }

export async function extendNote(prev: NoteActionState, form: FormData): Promise<NoteActionState> {
  const ctx = await requireTenant('settings.manage');
  const { error } = await ctx.supabase.schema('api').rpc('extend_credit_note', {
    p_note: String(form.get('id')), p_days: Number(form.get('days') || 30), p_reason: String(form.get('reason') ?? ''),
  });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/credit-notes');
  return { ok: (prev.ok ?? 0) + 1 };
}

export async function cancelNote(prev: NoteActionState, form: FormData): Promise<NoteActionState> {
  const ctx = await requireTenant('settings.manage');
  const { error } = await ctx.supabase.schema('api').rpc('cancel_credit_note', {
    p_note: String(form.get('id')), p_reason: String(form.get('reason') ?? ''),
  });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/credit-notes');
  return { ok: (prev.ok ?? 0) + 1 };
}

/** Cash out a credit note's balance (Settings → Security must allow it; manager or owner). */
export async function cashOutNote(prev: NoteActionState, form: FormData): Promise<NoteActionState> {
  const ctx = await requireTenant('shift.manage');
  const { error } = await ctx.supabase.schema('api').rpc('cash_out_credit_note', {
    p_note: String(form.get('id')), p_reason: String(form.get('reason') ?? ''),
  });
  if (error) return { error: error.message.startsWith('FORBIDDEN:') ? 'Cashing out credit notes is turned off in Settings → Security.' : dbErrorText(error) };
  revalidatePath('/backoffice/credit-notes');
  return { ok: (prev.ok ?? 0) + 1 };
}

export async function resolveSyncIssue(prev: NoteActionState, form: FormData): Promise<NoteActionState> {
  const ctx = await requireTenant('shift.manage');
  const { error } = await ctx.supabase.schema('api').rpc('resolve_sync_issue', {
    p_issue: String(form.get('id')), p_status: String(form.get('status')), p_note: String(form.get('note') ?? ''),
  });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/sync-issues');
  return { ok: (prev.ok ?? 0) + 1 };
}
