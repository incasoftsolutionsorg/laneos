'use server';

import { revalidatePath } from 'next/cache';
import { parseRupees } from '@laneos/core';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export async function reducedSticker(itemId: string, price: string, copies: number): Promise<{ error?: string }> {
  const ctx = await requireTenant('item.edit');
  const cents = parseRupees(price);
  if (cents == null) return { error: 'Enter the reduced price, e.g. 70.00' };
  const { error } = await ctx.supabase.schema('api').rpc('queue_reduced_label', { p_shop: ctx.shop.id, p_item: itemId, p_price_cents: cents, p_copies: copies });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/labels');
  return {};
}

export async function writeOffBatch(itemId: string, qtyMilli: number, batchNo: string | null): Promise<{ error?: string }> {
  const ctx = await requireTenant('stock.adjust');
  const { error } = await ctx.supabase.schema('api').rpc('adjust_stock', {
    p_shop: ctx.shop.id, p_item: itemId, p_qty_milli: -qtyMilli, p_reason: 'wastage', p_note: `Expired${batchNo ? ` batch ${batchNo}` : ''}`,
  });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/stock/expiry');
  return {};
}
