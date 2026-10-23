'use server';

import { revalidatePath } from 'next/cache';
import type { Json } from '@laneos/db-types';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface PoInput { id?: string; supplierId: string; expectedOn?: string | null; note?: string; lines: { itemId: string; qtyMilli: number; unitCostCents: number }[] }

export async function savePo(input: PoInput, send: boolean): Promise<{ id?: string; error?: string }> {
  const ctx = await requireTenant('grn.post');
  const { data, error } = await ctx.supabase.schema('api').rpc('save_po', { p_shop: ctx.shop.id, p: input as unknown as Json });
  if (error) return { error: dbErrorText(error) };
  const id = data as string;
  if (send) {
    const r = await ctx.supabase.schema('api').rpc('po_action', { p_po: id, p_action: 'send' });
    if (r.error) return { id, error: dbErrorText(r.error) };
  }
  revalidatePath('/backoffice/purchasing/orders');
  return { id };
}

export async function poAction(id: string, action: 'send' | 'cancel' | 'close'): Promise<{ error?: string }> {
  const ctx = await requireTenant('grn.post');
  const { error } = await ctx.supabase.schema('api').rpc('po_action', { p_po: id, p_action: action });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/purchasing/orders');
  revalidatePath(`/backoffice/purchasing/orders/${id}`);
  return {};
}

export interface GrnInput {
  id?: string; supplierId: string; poId?: string | null; supplierInvoiceNo?: string; receivedOn: string; discountCents: number;
  lines: { itemId: string; batchNo?: string; expiryOn?: string | null; qtyMilli: number; freeMilli: number; unitCostCents: number }[];
}

export async function saveGrn(input: GrnInput, post: boolean): Promise<{ id?: string; grnNo?: string; error?: string }> {
  const ctx = await requireTenant('grn.post');
  const { data, error } = await ctx.supabase.schema('api').rpc('save_grn', { p_shop: ctx.shop.id, p: input as unknown as Json, p_post: post });
  if (error) return { error: dbErrorText(error) };
  const r = data as { id: string; grnNo: string };
  revalidatePath('/backoffice/purchasing/grn');
  revalidatePath('/backoffice/items');
  return { id: r.id, grnNo: r.grnNo };
}

export interface PayInput { supplierId: string; method: 'cash' | 'bank_transfer' | 'cheque'; reference?: string; chequeDate?: string | null; amountCents: number; allocations: { grnId: string; amountCents: number }[] }

export async function paySupplier(input: PayInput): Promise<{ status?: string; error?: string }> {
  const ctx = await requireTenant('supplier.manage');
  const { data, error } = await ctx.supabase.schema('api').rpc('pay_supplier', { p_shop: ctx.shop.id, p: input as unknown as Json });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/purchasing/payments');
  revalidatePath('/backoffice/suppliers');
  return { status: (data as { status: string }).status };
}

export async function decidePayment(id: string, approve: boolean): Promise<{ error?: string }> {
  const ctx = await requireTenant('settings.manage');
  const { error } = await ctx.supabase.schema('api').rpc('decide_supplier_payment', { p_payment: id, p_approve: approve });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/purchasing/payments');
  revalidatePath('/backoffice/suppliers');
  return {};
}
