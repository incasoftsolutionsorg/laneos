'use server';

import { revalidatePath } from 'next/cache';
import type { Json } from '@laneos/db-types';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface TransferResult { error?: string; id?: string }

const text = (m: string, fallback: string) =>
  m.startsWith('VALIDATION_ERROR') ? m.replace('VALIDATION_ERROR: ', '').replace(/^./, (c) => c.toUpperCase()) + '.'
  : m.startsWith('FORBIDDEN:') ? m.replace('FORBIDDEN: ', '').replace(/^./, (c) => c.toUpperCase()) + '.'
  : m.startsWith('PLAN_LIMIT') ? 'Transfers are on the Multi-store plan and up.' : fallback;

/** WF-006 step 1: the receiving shop asks another shop for stock. */
export async function requestTransfer(v: { fromShopId: string; toShopId: string; note: string; lines: { itemId: string; qtyMilli: number }[] }): Promise<TransferResult> {
  const ctx = await requireTenant('stock.adjust');
  if (v.fromShopId === v.toShopId) return { error: 'Choose two different shops.' };
  if (!v.lines.length || v.lines.some((l) => !(l.qtyMilli > 0))) return { error: 'Add items with a quantity above zero.' };
  const { data, error } = await ctx.supabase.schema('api').rpc('request_transfer', { p: v as unknown as Json });
  if (error) return { error: text(error.message, dbErrorText(error)) };
  revalidatePath('/backoffice/transfers');
  return { id: (data as { id: string }).id };
}

export async function transferAction(id: string, action: string, p: { note?: string; lines?: { itemId: string; qtyMilli: number }[] } = {}): Promise<TransferResult> {
  const ctx = await requireTenant();
  const { error } = await ctx.supabase.schema('api').rpc('transfer_action', { p_id: id, p_action: action, p: p as unknown as Json });
  if (error) return { error: text(error.message, dbErrorText(error)) };
  revalidatePath('/backoffice/transfers');
  revalidatePath(`/backoffice/transfers/${id}`);
  return { id };
}
