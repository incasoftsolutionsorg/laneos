'use server';

import { revalidatePath } from 'next/cache';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export async function labelsAction(ids: string[], action: 'printed' | 'remove' | 'copies', copies?: number): Promise<{ error?: string }> {
  const ctx = await requireTenant('item.edit');
  const { error } = await ctx.supabase.schema('api').rpc('update_labels', { p_ids: ids, p_action: action, p_copies: copies });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/labels');
  return {};
}

export async function queueItems(itemIds: string[]): Promise<{ error?: string; added?: number }> {
  const ctx = await requireTenant('item.edit');
  const { data, error } = await ctx.supabase.schema('api').rpc('queue_labels', { p_shop: ctx.shop.id, p_items: itemIds });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/labels');
  return { added: data as number };
}
