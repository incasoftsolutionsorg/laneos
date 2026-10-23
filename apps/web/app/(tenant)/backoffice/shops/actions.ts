'use server';

import { revalidatePath } from 'next/cache';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface ShopResult { error?: string; ok?: string; id?: string }

const toPhone = (raw: string) => {
  const m = /^(?:\+94|0094|94|0)?(\d{9})$/.exec(raw.replace(/[\s()-]/g, ''));
  return raw.trim() ? (m ? `+94${m[1]}` : undefined) : null;
};

/** New shop (Figma 3-507 "+ Add shop"): within the plan's shop limit; gets lane L1 and a label queue. */
export async function addShop(v: { code: string; name: string; address: string; phone: string }): Promise<ShopResult> {
  const ctx = await requireTenant('settings.manage');
  const code = v.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(code)) return { error: 'Shop code: 2–8 letters or digits, e.g. CMB2.' };
  if (v.name.trim().length < 2) return { error: 'Enter the shop name.' };
  const phone = toPhone(v.phone);
  if (phone === undefined) return { error: 'Enter the phone like 011 222 3344.' };
  const { data, error } = await ctx.supabase.schema('api').rpc('add_shop', { p_code: code, p_name: v.name, p_address: v.address, p_phone: phone ?? '' });
  if (error) {
    if (error.message.startsWith('PLAN_LIMIT')) return { error: `Your plan allows ${error.message.replace(/\D+/g, '')} shops. Change plan in Plan & billing.` };
    if (error.code === '23505') return { error: 'Another shop already uses that code.' };
    return { error: dbErrorText(error) };
  }
  // The access token lists the member's shops; refresh it so the new shop is visible straight away.
  await ctx.supabase.auth.refreshSession();
  revalidatePath('/backoffice', 'layout');
  return { ok: `${v.name} added with lane L1.`, id: data as string };
}

export async function updateShop(id: string, v: { name: string; address: string; phone: string }): Promise<ShopResult> {
  const ctx = await requireTenant('settings.manage');
  const phone = toPhone(v.phone);
  if (phone === undefined) return { error: 'Enter the phone like 011 222 3344.' };
  if (v.name.trim().length < 2) return { error: 'Enter the shop name.' };
  const { error } = await ctx.supabase.from('shops').update({ name: v.name.trim(), address: v.address.trim() || null, phone, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice', 'layout');
  return { ok: 'Shop saved.' };
}

export async function setShopActive(id: string, active: boolean): Promise<ShopResult> {
  const ctx = await requireTenant('settings.manage');
  const { error } = await ctx.supabase.schema('api').rpc('set_shop_active', { p_shop: id, p_active: active });
  if (error) return { error: error.message.startsWith('VALIDATION_ERROR') ? error.message.replace('VALIDATION_ERROR: ', '') : dbErrorText(error) };
  revalidatePath('/backoffice', 'layout');
  return { ok: active ? 'Shop reopened.' : 'Shop closed. Its history stays; it no longer sells.' };
}
