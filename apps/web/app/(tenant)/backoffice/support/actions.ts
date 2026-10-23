'use server';

import { revalidatePath } from 'next/cache';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface SupportResult { error?: string; id?: string }

export async function openTicket(subject: string, body: string, priority: string): Promise<SupportResult> {
  const ctx = await requireTenant();
  if (subject.trim().length < 3) return { error: 'Give the problem a short title.' };
  if (body.trim().length < 5) return { error: 'Describe what happened.' };
  const { data, error } = await ctx.supabase.schema('api').rpc('create_ticket', { p_subject: subject, p_body: body, p_priority: priority });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/support');
  return { id: data as string };
}

export async function replyToSupport(id: string, body: string, close: boolean): Promise<SupportResult> {
  const ctx = await requireTenant();
  const { error } = await ctx.supabase.schema('api').rpc('ticket_reply', { p_ticket: id, p_body: body, p_status: (close ? 'closed' : null) as string });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/support');
  return { id };
}
