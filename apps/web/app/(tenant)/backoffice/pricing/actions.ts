'use server';

import { revalidatePath } from 'next/cache';
import { parseRupees } from '@laneos/core';
import type { Json } from '@laneos/db-types';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface PriceResult { error?: string; ok?: string }

const msg = (m: string, fallback: string) =>
  m.startsWith('ABOVE_MRP') ? 'That price is above the MRP printed on the pack.'
  : m.startsWith('VALIDATION_ERROR') ? m.replace('VALIDATION_ERROR: ', '').replace(/^./, (c) => c.toUpperCase()) + '.' : fallback;

/** A shop's own price for one item, or clear it (back to the central price). */
export async function setShopPrice(shopId: string, itemId: string, priceText: string | null): Promise<PriceResult> {
  const ctx = await requireTenant('item.edit');
  const price = priceText == null ? null : parseRupees(priceText);
  if (priceText != null && (price == null || price < 0)) return { error: 'Enter a price in rupees.' };
  const { error } = await ctx.supabase.schema('api').rpc('set_shop_price', { p_shop: shopId, p_item: itemId, p_price_cents: price as number });
  if (error) return { error: msg(error.message, dbErrorText(error)) };
  revalidatePath('/backoffice/pricing', 'layout');
  return { ok: price == null ? 'Back to the central price.' : 'Shop price saved. Lanes pick it up on their next catalogue refresh.' };
}

export interface ScheduleLine { itemId: string; shopId: string | null; priceText: string }

/** A price change from a date and time (WF-007). `now` applies it straight away through the same path. */
export async function savePriceSchedule(name: string, startsAt: string | 'now', lines: ScheduleLine[]): Promise<PriceResult> {
  const ctx = await requireTenant('item.edit');
  if (name.trim().length < 2) return { error: 'Name the change, e.g. "October price update".' };
  const parsed = lines.map((l) => ({ itemId: l.itemId, shopId: l.shopId, priceCents: parseRupees(l.priceText) }));
  if (!parsed.length) return { error: 'Add at least one item.' };
  if (parsed.some((l) => l.priceCents == null || l.priceCents < 0)) return { error: 'Every line needs a new price.' };
  const when = startsAt === 'now' ? new Date().toISOString() : new Date(`${startsAt}:00+05:30`).toISOString();
  const { error } = await ctx.supabase.schema('api').rpc('save_price_schedule', { p: { name, startsAt: when, lines: parsed } as unknown as Json });
  if (error) return { error: msg(error.message, dbErrorText(error)) };
  if (startsAt === 'now') await ctx.supabase.schema('api').rpc('apply_due_price_schedules');
  revalidatePath('/backoffice/pricing', 'layout');
  return { ok: startsAt === 'now' ? 'Prices changed. Shelf labels are in the print queue.' : 'Scheduled. It applies automatically at the start time.' };
}

export async function cancelPriceSchedule(id: string): Promise<PriceResult> {
  const ctx = await requireTenant('item.edit');
  const { error } = await ctx.supabase.schema('api').rpc('cancel_price_schedule', { p_id: id });
  if (error) return { error: msg(error.message, dbErrorText(error)) };
  revalidatePath('/backoffice/pricing', 'layout');
  return { ok: 'Cancelled.' };
}
