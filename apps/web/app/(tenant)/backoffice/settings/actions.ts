'use server';

import { revalidatePath } from 'next/cache';
import type { Json } from '@laneos/db-types';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface SettingsResult { error?: string; ok?: string }

/** Every settings tab saves through api.update_tenant_settings (column whitelist + audit). */
export async function saveSettings(patch: Record<string, string | number | boolean | null>): Promise<SettingsResult> {
  const ctx = await requireTenant('settings.manage');
  const { error } = await ctx.supabase.schema('api').rpc('update_tenant_settings', { p: patch as Json });
  if (error) return { error: error.message.startsWith('VALIDATION_ERROR') ? error.message.replace('VALIDATION_ERROR: ', '') : dbErrorText(error) };
  revalidatePath('/backoffice', 'layout');
  revalidatePath('/lane', 'layout');
  return { ok: 'Settings saved.' };
}

export async function saveShop(v: { name: string; address: string; phone: string }): Promise<SettingsResult> {
  const ctx = await requireTenant('settings.manage');
  // Shops may have a landline (081 …) as well as a mobile, so accept any 9-digit Sri Lankan number.
  const m = /^(?:\+94|0094|94|0)?(\d{9})$/.exec(v.phone.replace(/[\s()-]/g, ''));
  const phone = v.phone.trim() ? (m ? `+94${m[1]}` : null) : null;
  if (v.phone.trim() && !phone) return { error: 'Enter the shop phone like 081 222 3344.' };
  if (v.name.trim().length < 2) return { error: 'Enter the shop name.' };
  const { error } = await ctx.supabase.from('shops')
    .update({ name: v.name.trim(), address: v.address.trim() || null, phone, updated_at: new Date().toISOString() })
    .eq('id', ctx.shop.id);
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice', 'layout');
  return { ok: 'Shop details saved.' };
}

export async function setTaxRate(taxClass: string, ratePct: string, from: string): Promise<SettingsResult> {
  const ctx = await requireTenant('settings.manage');
  const rate = Math.round(Number(ratePct) * 100);
  if (!Number.isFinite(rate) || rate < 0 || rate > 10000) return { error: 'Enter a rate between 0 and 100 %.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { error: 'Choose the date the rate starts.' };
  const { error } = await ctx.supabase.schema('api').rpc('set_tax_rate', { p_class: taxClass, p_rate_bp: rate, p_from: from });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/settings/tax');
  return { ok: 'Rate saved.' };
}

export async function savePriceRule(id: string | null, name: string, discountPct: string, appliesTo: string): Promise<SettingsResult> {
  const ctx = await requireTenant('settings.manage');
  const bp = Math.round(Number(discountPct) * 100);
  if (!name.trim()) return { error: 'Name the price list.' };
  if (!Number.isFinite(bp) || bp < 0 || bp > 9000) return { error: 'Discount must be 0–90 %.' };
  const { error } = await ctx.supabase.schema('api').rpc('save_price_rule', {
    // SQL accepts null for a new list / no audience; the generated types do not say so.
    p_id: id as string, p_name: name.trim(), p_discount_bp: bp, p_applies_to: (appliesTo.trim() || null) as string,
  });
  if (error) return { error: error.code === '23505' ? 'A price list with that name exists.' : dbErrorText(error) };
  revalidatePath('/backoffice/settings/tax');
  return { ok: 'Price list saved.' };
}

export async function setLanePrinter(laneId: string, printer: string): Promise<SettingsResult> {
  const ctx = await requireTenant('settings.manage');
  const { error } = await ctx.supabase.from('lanes').update({ printer_name: printer.trim() || null }).eq('id', laneId);
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/settings/receipt');
  return { ok: 'Printer saved.' };
}

/** Reset all access (blueprint §27.5.4): every login of this business, or of the current shop, is signed out. */
export async function resetAllAccess(scope: 'tenant' | 'shop', reason: string): Promise<SettingsResult> {
  const ctx = await requireTenant('settings.manage');
  const { error } = await ctx.supabase.schema('api').rpc('reset_access', {
    p_scope: scope, p_id: scope === 'shop' ? ctx.shop.id : ctx.tenant.id, p_reason: reason.trim(),
  });
  if (error) return { error: error.message.includes('give a reason') ? 'Give a short reason (kept in the audit log).' : dbErrorText(error) };
  return { ok: scope === 'shop' ? `Everyone working only at ${ctx.shop.name} was signed out, and its lanes locked.` : 'Everyone was signed out and every lane locked. You will be asked to sign in again.' };
}
