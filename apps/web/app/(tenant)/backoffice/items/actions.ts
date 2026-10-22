'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ItemInput, parseRupees } from '@laneos/core';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface ItemFormState { error?: string; fieldErrors?: Record<string, string> }

const rupees = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : parseRupees(s);
};

export async function saveItem(_: ItemFormState, form: FormData): Promise<ItemFormState> {
  const ctx = await requireTenant('item.edit');
  const id = String(form.get('id') ?? '') || null;
  const priceCents = rupees(form.get('price'));
  const itemType = String(form.get('itemType') ?? 'standard');
  const reorder = Number(form.get('reorderLevel') || 0);

  const parsed = ItemInput.safeParse({
    name: form.get('name'),
    departmentId: String(form.get('departmentId') ?? '') || null,
    itemType,
    taxClass: form.get('taxClass') ?? 'standard',
    plu: form.get('plu') ? Number(form.get('plu')) : null,
    barcode: String(form.get('barcode') ?? '').trim().toUpperCase() || null,
    priceCents: priceCents ?? -1,
    mrpCents: rupees(form.get('mrp')),
    costCents: rupees(form.get('cost')),
    reorderLevelMilli: Math.round(reorder * 1000),
    isReturnable: form.get('isReturnable') === 'on',
    trackBatches: form.get('trackBatches') === 'on',
    isPinned: form.get('isPinned') === 'on',
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    if (priceCents == null) fieldErrors.priceCents = 'Enter a price, e.g. 1,230.00';
    return { error: 'Check the highlighted fields.', fieldErrors };
  }

  const { data: itemId, error } = await ctx.supabase.schema('api').rpc('upsert_item', { p: { ...parsed.data, id } });
  if (error) return { error: dbErrorText(error) };

  // Opening stock for a new item goes through the stock ledger like every other change.
  const opening = Number(form.get('openingStock') || 0);
  if (!id && opening > 0) {
    const { error: stockError } = await ctx.supabase.schema('api').rpc('adjust_stock', {
      p_shop: ctx.shop.id, p_item: itemId as string, p_qty_milli: Math.round(opening * 1000), p_reason: 'opening',
    });
    if (stockError) return { error: `Item saved, but opening stock failed: ${dbErrorText(stockError)}` };
  }

  revalidatePath('/backoffice/items');
  redirect('/backoffice/items');
}

/** Items are deactivated, never deleted: past sales still point at them. */
export async function deactivateItem(form: FormData) {
  const ctx = await requireTenant('item.edit');
  await ctx.supabase.from('items').update({ is_active: false }).eq('id', String(form.get('id')));
  revalidatePath('/backoffice/items');
}
