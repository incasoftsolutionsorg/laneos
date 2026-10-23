'use server';

import { revalidatePath } from 'next/cache';
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
