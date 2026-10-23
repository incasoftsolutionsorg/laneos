'use server';

import { revalidatePath } from 'next/cache';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface AccessResult { error?: string; ok?: string }

/** Which shops a member works in (Figma 3-2328). Changing it signs them out so the change applies at once. */
export async function setMemberShops(memberId: string, allShops: boolean, shopIds: string[]): Promise<AccessResult> {
  const ctx = await requireTenant('staff.manage');
  if (!allShops && shopIds.length === 0) return { error: 'Give them at least one shop, or deactivate them in Users & roles.' };
  const { error } = await ctx.supabase.schema('api').rpc('update_member', { p: { id: memberId, allShops, shopIds: allShops ? [] : shopIds } });
  if (error) return { error: error.message.startsWith('FORBIDDEN') ? 'Only an owner can change an owner.' : dbErrorText(error) };
  revalidatePath('/backoffice/access');
  return { ok: 'Access changed.' };
}

export async function resetShopAccess(shopId: string, reason: string): Promise<AccessResult> {
  const ctx = await requireTenant('settings.manage');
  const { error } = await ctx.supabase.schema('api').rpc('reset_access', { p_scope: 'shop', p_id: shopId, p_reason: reason.trim() });
  if (error) return { error: error.message.includes('give a reason') ? 'Give a short reason (kept in the audit log).' : dbErrorText(error) };
  return { ok: 'Everyone who works only at this shop was signed out, and its lanes locked.' };
}
