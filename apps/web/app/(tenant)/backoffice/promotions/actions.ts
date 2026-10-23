'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { parseRupees } from '@laneos/core';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface PromoFormState { error?: string }

const Promo = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('multi_buy'), buyQty: z.number().int().min(2).max(100), bundlePriceCents: z.number().int().min(0) }),
  z.object({ kind: z.literal('percent_off'), percentBp: z.number().int().min(1).max(10000) }),
]);

// Colombo midnight of a yyyy-mm-dd date.
const colomboDate = (d: string, endOfDay = false) => (d ? `${d}T${endOfDay ? '23:59:59' : '00:00:00'}+05:30` : null);

export async function savePromotion(_: PromoFormState, form: FormData): Promise<PromoFormState> {
  const ctx = await requireTenant('promotion.manage');
  const kind = String(form.get('kind'));
  const name = String(form.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Give the promotion a name customers will see, e.g. "3 for Rs 450".' };
  const parsed = Promo.safeParse(kind === 'multi_buy'
    ? { kind, buyQty: Number(form.get('buyQty')), bundlePriceCents: parseRupees(String(form.get('bundlePrice') ?? '')) ?? -1 }
    : { kind, percentBp: Math.round(Number(form.get('percent')) * 100) });
  if (!parsed.success) return { error: kind === 'multi_buy' ? 'Enter how many to buy (2–100) and the bundle price.' : 'Enter a percentage between 0.01 and 100.' };

  const itemIds = form.getAll('itemIds').map(String);
  if (itemIds.length === 0) return { error: 'Choose at least one item.' };
  const startsAt = colomboDate(String(form.get('startsOn') ?? ''));
  const endsAt = colomboDate(String(form.get('endsOn') ?? ''), true);
  if (startsAt && endsAt && endsAt <= startsAt) return { error: 'The end date must be after the start date.' };

  const { error } = await ctx.supabase.schema('api').rpc('save_promotion', {
    p: { id: String(form.get('id') ?? '') || null, name, ...parsed.data, startsAt, endsAt, isActive: form.get('isActive') === 'on', itemIds },
  });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/promotions');
  redirect('/backoffice/promotions');
}
