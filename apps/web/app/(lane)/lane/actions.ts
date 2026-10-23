'use server';

import { revalidatePath } from 'next/cache';
import { ERROR_TEXT, normalizeLkPhone, parseRupees, type ErrorCode } from '@laneos/core';
import type { Json } from '@laneos/db-types';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

const text = (code: string | undefined | null) => (code && ERROR_TEXT[code as ErrorCode]) || 'Something went wrong.';

// Device registration and PIN ------------------------------------------------------------------------

export async function registerLane(laneId: string): Promise<{ key?: string; error?: string }> {
  const ctx = await requireTenant('staff.manage');
  const { data, error } = await ctx.supabase.schema('api').rpc('register_lane', { p_lane: laneId });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/lane');
  return { key: data as string };
}

export async function unlockLane(laneId: string, key: string | null, memberId: string, pin: string)
  : Promise<{ ok: boolean; error?: string; name?: string }> {
  const ctx = await requireTenant('sale.create');
  const { data, error } = await ctx.supabase.schema('api').rpc('lane_unlock', {
    p_lane: laneId, p_key: key ?? '', p_member: memberId, p_pin: pin,
  });
  if (error) return { ok: false, error: dbErrorText(error) };
  const r = data as { ok: boolean; error?: string; member?: { name: string } };
  return r.ok ? { ok: true, name: r.member?.name } : { ok: false, error: text(r.error) };
}

export async function lockLane(laneId: string) {
  const ctx = await requireTenant('sale.create');
  await ctx.supabase.schema('api').rpc('lane_lock', { p_lane: laneId });
}

// Shifts ------------------------------------------------------------------------------------------------

export async function openShift(input: { laneId: string; floatCents: number; denoms: Record<string, number>; reserve: number })
  : Promise<{ error?: string }> {
  const ctx = await requireTenant('sale.create');
  const { error } = await ctx.supabase.schema('api').rpc('open_shift', {
    p_lane: input.laneId, p_opening_float_cents: input.floatCents, p_denoms: input.denoms, p_reserve: input.reserve,
  });
  if (error) return { error: dbErrorText(error) };
  revalidatePath(`/lane/${input.laneId}`);
  return {};
}

export interface CloseResult { expectedCashCents: number; countedCashCents: number; varianceCents: number }

export async function closeShift(input: { shiftId: string; countedCents: number; denoms: Record<string, number>; note: string })
  : Promise<{ error?: string; result?: CloseResult }> {
  const ctx = await requireTenant('sale.create');
  const { data, error } = await ctx.supabase.schema('api').rpc('close_shift', {
    p_shift: input.shiftId, p_counted_cash_cents: input.countedCents, p_denoms: input.denoms, p_note: input.note,
  });
  if (error) return { error: dbErrorText(error) };
  return { result: data as unknown as CloseResult };
}

export async function cashPickup(shiftId: string, amount: string, note: string): Promise<{ error?: string }> {
  const ctx = await requireTenant('cash.pickup');
  const cents = parseRupees(amount);
  if (!cents) return { error: 'Enter the amount taken to the safe.' };
  const { error } = await ctx.supabase.schema('api').rpc('cash_pickup', { p_shift: shiftId, p_amount_cents: cents, p_note: note || undefined });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/lane', 'layout');
  return {};
}

// Customers at the lane ---------------------------------------------------------------------------------

export interface CustomerHit { id: string; name: string; phone: string; balanceDueCents: number; creditLimitCents?: number; loyaltyPoints: number; marketingConsent: boolean; since: string }

export async function findCustomer(phone: string): Promise<CustomerHit | null> {
  const ctx = await requireTenant('sale.create');
  const normalized = normalizeLkPhone(phone);
  if (!normalized) return null;
  const { data } = await ctx.supabase
    .from('customers')
    .select('id, name, phone, balance_due_cents, credit_limit_cents, loyalty_points, marketing_consent, created_at')
    .eq('phone', normalized).eq('is_active', true).maybeSingle();
  return data
    ? { id: data.id, name: data.name, phone: data.phone, balanceDueCents: data.balance_due_cents, creditLimitCents: data.credit_limit_cents, loyaltyPoints: data.loyalty_points,
        marketingConsent: data.marketing_consent, since: data.created_at }
    : null;
}

export async function addLaneCustomer(name: string, phone: string, consent: boolean): Promise<{ customer?: CustomerHit; error?: string }> {
  const ctx = await requireTenant('sale.create');
  const normalized = normalizeLkPhone(phone);
  if (!normalized) return { error: 'Enter a mobile number like 077 123 4567.' };
  if (name.trim().length < 2) return { error: 'Enter the customer name.' };
  const { error } = await ctx.supabase.schema('api').rpc('lane_add_customer', { p_name: name, p_phone: normalized, p_consent: consent });
  if (error) return { error: dbErrorText(error) };
  const customer = await findCustomer(normalized);
  return customer ? { customer } : { error: 'Saved, but could not load the customer.' };
}

export async function setConsent(customerId: string, consent: boolean): Promise<{ error?: string }> {
  const ctx = await requireTenant('sale.create');
  const { error } = await ctx.supabase.schema('api').rpc('set_marketing_consent', { p_customer: customerId, p_consent: consent });
  return error ? { error: dbErrorText(error) } : {};
}

// Credit notes -------------------------------------------------------------------------------------------

export interface NoteCheck { ok: boolean; error?: string; noteNo?: string; balanceCents?: number; expiresOn?: string }

export async function checkCreditNote(code: string, laneId: string): Promise<NoteCheck> {
  const ctx = await requireTenant('sale.create');
  if (code.replace(/[^0-9a-z]/gi, '').length !== 12) return { ok: false, error: 'A credit note code has 12 letters and digits.' };
  const { data, error } = await ctx.supabase.schema('api').rpc('check_credit_note', { p_code: code, p_lane: laneId });
  if (error) return { ok: false, error: dbErrorText(error) };
  const r = data as { ok: boolean; error?: string; noteNo: string; balanceCents: number; expiresOn: string };
  return { ok: r.ok, error: r.ok ? undefined : text(r.error), noteNo: r.noteNo, balanceCents: r.balanceCents, expiresOn: r.expiresOn };
}

// Returns ----------------------------------------------------------------------------------------------

export interface ReturnableSale {
  id: string; invoiceNo: string; createdAt: string; totalCents: number;
  customer: { id: string; name: string; balanceDueCents: number } | null;
  payments: { method: string; amountCents: number; reference: string | null }[];
  lines: { saleLineId: string; itemId: string; name: string; itemType: string; qtyMilli: number; netCents: number;
           isReturnable: boolean; returnedMilli: number }[];
}

export async function findSaleForReturn(invoice: string): Promise<{ sale?: ReturnableSale; error?: string }> {
  const ctx = await requireTenant('return.create');
  const { data, error } = await ctx.supabase.schema('api').rpc('find_sale_for_return', { p_invoice: invoice });
  if (error) return { error: error.message.startsWith('NOT_FOUND') ? `No bill ${invoice.trim().toUpperCase()} in this business.` : dbErrorText(error) };
  return { sale: data as unknown as ReturnableSale };
}

export interface ReturnResult {
  ok: boolean; error?: string; needsSupervisor?: boolean;
  returnNo?: string; totalCents?: number; settlement?: string;
  creditNote?: { noteNo: string; code: string; amountCents: number; expiresOn: string } | null;
}

export async function processReturn(payload: Record<string, unknown>): Promise<ReturnResult> {
  const ctx = await requireTenant('return.create');
  const { data, error } = await ctx.supabase.schema('api').rpc('process_return', { p: payload as Json });
  if (error) return { ok: false, error: dbErrorText(error) };
  const r = data as unknown as ReturnResult & { error?: string };
  if (!r.ok) return { ok: false, error: text(r.error), needsSupervisor: r.error === 'SUPERVISOR_PIN_REQUIRED' };
  revalidatePath('/backoffice/credit-notes');
  return r;
}

// Offline sync issues ------------------------------------------------------------------------------------

export async function reportSyncIssue(laneId: string, clientUuid: string, payload: Record<string, unknown>, code: string, message: string) {
  const ctx = await requireTenant('sale.create');
  await ctx.supabase.schema('api').rpc('report_sync_issue', {
    p_lane: laneId, p_client_uuid: clientUuid, p_payload: payload as Json, p_code: code, p_message: message,
  });
}
