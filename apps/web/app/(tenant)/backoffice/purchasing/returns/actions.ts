'use server';

import { revalidatePath } from 'next/cache';
import { parseRupees } from '@laneos/core';
import type { Json } from '@laneos/db-types';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface ReturnResult { error?: string; id?: string }

const text = (m: string, fallback: string) =>
  m.startsWith('VALIDATION_ERROR: ') ? `${m.slice(18, 19).toUpperCase()}${m.slice(19)}.` : fallback;

/** Send goods back to a supplier: damaged stock (from damage reports) and/or sellable stock. */
export async function createSupplierReturn(v: { supplierId: string; note: string; lines: { damageReportId?: string; itemId?: string; qtyMilli: number }[] }): Promise<ReturnResult> {
  const ctx = await requireTenant('stock.adjust');
  if (!v.supplierId) return { error: 'Choose the supplier.' };
  if (!v.lines.length || v.lines.some((l) => !(l.qtyMilli > 0))) return { error: 'Add items with a quantity above zero.' };
  const { data, error } = await ctx.supabase.schema('api').rpc('create_supplier_return', { p_shop: ctx.shop.id, p: v as unknown as Json });
  if (error) return { error: text(error.message, dbErrorText(error)) };
  revalidatePath('/backoffice/purchasing/returns');
  revalidatePath('/backoffice/stock/damage');
  return { id: (data as { id: string }).id };
}

/** The supplier's answer: a credit (lowers what we owe) or a refusal (goods come back). */
export async function answerSupplierReturn(id: string, action: 'credit' | 'reject', creditText: string, note: string): Promise<ReturnResult> {
  const ctx = await requireTenant('supplier.manage');
  const credit = action === 'credit' ? parseRupees(creditText) : null;
  if (action === 'credit' && (credit == null || credit <= 0)) return { error: 'Enter the amount the supplier credits.' };
  const { error } = await ctx.supabase.schema('api').rpc('answer_supplier_return', {
    p_return: id, p_action: action, p_credit_cents: credit as number, p_note: note,
  });
  if (error) return { error: text(error.message, dbErrorText(error)) };
  revalidatePath('/backoffice/purchasing/returns');
  revalidatePath(`/backoffice/purchasing/returns/${id}`);
  revalidatePath('/backoffice/suppliers');
  return { id };
}
