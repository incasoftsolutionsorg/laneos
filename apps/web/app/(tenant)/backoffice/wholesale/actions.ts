'use server';

import { revalidatePath } from 'next/cache';
import type { Json } from '@laneos/db-types';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface WholesaleInput {
  kind: 'invoice' | 'quotation';
  customerId: string | null;
  buyerName: string; buyerAddress: string; buyerVatNo: string; buyerPhone: string;
  terms: 'cash' | 'credit' | 'cheque'; paidCents: number; chequeNo: string; note: string;
  fromQuotationId: string | null;
  lines: { itemId: string; packQty: number; qty: number; priceCents: number | null; discountBp: number }[];
}

/** Wholesale invoice or quotation (Figma 1-1162). The server prices and totals everything again. */
export async function saveWholesale(v: WholesaleInput): Promise<{ error?: string; id?: string; docNo?: string }> {
  const ctx = await requireTenant(v.kind === 'invoice' ? 'customer.manage' : 'sale.create');
  if (!v.lines.length) return { error: 'Add at least one line.' };
  if (v.lines.some((l) => !Number.isInteger(l.qty) || l.qty < 1)) return { error: 'Quantities are whole cases / packs (1 or more).' };
  const { data, error } = await ctx.supabase.schema('api').rpc('save_wholesale', { p_shop: ctx.shop.id, p: v as unknown as Json });
  if (error) {
    const m = error.message;
    if (m.startsWith('CREDIT_LIMIT')) return { error: `Over this customer's credit limit — ${m.replace(/\D+/g, ' ').trim() ? `Rs ${(Number(m.replace(/\D+/g, '')) / 100).toLocaleString('en-LK')} available` : 'no credit available'}. Take more now or raise the limit.` };
    if (m.startsWith('CUSTOMER_REQUIRED')) return { error: 'Choose a customer to sell on credit.' };
    if (m.startsWith('UNDERPAID')) return { error: 'Cash terms: the paid amount must equal the total.' };
    if (m.startsWith('VALIDATION_ERROR')) return { error: m.replace('VALIDATION_ERROR: ', '').replace(/^./, (c) => c.toUpperCase()) + '.' };
    return { error: dbErrorText(error) };
  }
  revalidatePath('/backoffice/wholesale');
  const r = data as { id: string; docNo: string };
  return { id: r.id, docNo: r.docNo };
}
