'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseRupees } from '@laneos/core';
import type { Json } from '@laneos/db-types';
import { requireAdmin } from '@/lib/server/admin';

export interface AdminResult { error?: string; ok?: string }

const clean = (m: string) => m.replace(/^[A-Z_]+: ?/, '').replace(/^./, (c) => c.toUpperCase()) || 'Something went wrong.';

async function call(fn: string, args: Record<string, unknown>, ok: string, paths: string[]): Promise<AdminResult> {
  const { supabase } = await requireAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one wrapper for many admin RPCs
  const { error } = await (supabase.schema('api').rpc as any)(fn, args);
  if (error) return { error: clean(error.message) };
  paths.forEach((p) => revalidatePath(p));
  return { ok };
}

export async function updateTenant(id: string, p: Record<string, unknown>) {
  return call('admin_update_tenant', { p_tenant: id, p: p as Json }, 'Saved.', [`/admin/tenants/${id}`, '/admin/tenants']);
}

export async function savePlan(v: Record<string, string | boolean>) {
  const price = parseRupees(String(v.price ?? ''));
  if (price == null) return { error: 'Enter the monthly price in rupees (0 for custom).' };
  const p = {
    id: v.id, name: v.name, priceCents: price, maxShops: Number(v.maxShops), maxLanesPerShop: Number(v.maxLanesPerShop), maxStaff: Number(v.maxStaff),
    perShop: !!v.perShop, headOffice: !!v.headOffice, transfers: !!v.transfers, isCustom: !!v.isCustom, isActive: v.isActive !== false,
    description: v.description, sortOrder: Number(v.sortOrder || 9),
  };
  if (!/^[a-z_]{2,30}$/.test(String(p.id))) return { error: 'Plan id: 2–30 lowercase letters or _' };
  return call('admin_save_plan', { p }, 'Plan saved. Existing tenants keep their limits until their plan is changed.', ['/admin/plans']);
}

export async function generateInvoices(period: string) {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.schema('api').rpc('admin_generate_invoices', { p_period: `${period}-01` });
  if (error) return { error: clean(error.message) };
  revalidatePath('/admin/billing');
  return { ok: `${data} invoice(s) created for ${period}.` };
}

export async function setInvoice(id: string, status: 'paid' | 'void' | 'open', reference: string) {
  return call('admin_set_invoice', { p_invoice: id, p_status: status, p_reference: reference }, status === 'paid' ? 'Marked paid.' : 'Updated.', ['/admin/billing', '/admin/overdue']);
}

export async function replyTicket(id: string, body: string, status: string | null) {
  return call('ticket_reply', { p_ticket: id, p_body: body, p_status: status }, 'Sent.', ['/admin/tickets', `/admin/tickets/${id}`]);
}

export async function startSupport(tenantId: string, reason: string, minutes: number) {
  const r = await call('admin_start_support', { p_tenant: tenantId, p_reason: reason, p_minutes: minutes }, 'Started.', ['/admin/impersonation']);
  if (r.error) return r;
  redirect(`/admin/impersonation?tenant=${tenantId}`);
}

export async function endSupport(id: string) {
  return call('admin_end_support', { p_session: id }, 'Ended.', ['/admin/impersonation']);
}

export async function addAdmin(email: string) {
  return call('admin_add_admin', { p_email: email }, `${email} is now a platform admin.`, ['/admin/security']);
}

export async function removeAdmin(userId: string) {
  return call('admin_remove_admin', { p_user: userId }, 'Removed.', ['/admin/security']);
}

export async function resetPlatform(reason: string) {
  return call('admin_reset_platform', { p_reason: reason }, 'Everyone has been signed out.', ['/admin/security']);
}
