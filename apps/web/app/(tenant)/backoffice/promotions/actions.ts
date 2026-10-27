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
  z.object({ kind: z.literal('mix_match'), buyQty: z.number().int().min(2).max(100), bundlePriceCents: z.number().int().min(0) }),
  z.object({ kind: z.literal('percent_off'), percentBp: z.number().int().min(1).max(10000) }),
  z.object({ kind: z.literal('threshold'), thresholdCents: z.number().int().min(1),
    discountCents: z.number().int().min(1).nullable(), percentBp: z.number().int().min(1).max(10000).nullable() }),
]);

const MESSAGE: Record<string, string> = {
  multi_buy: 'Enter how many to buy (2–100) and the bundle price.',
  mix_match: 'Enter how many to buy (2–100) and the price for the group.',
  percent_off: 'Enter a percentage between 0.01 and 100.',
  threshold: 'Enter the amount to spend, and either a rupee discount or a percentage (not both).',
};

// Colombo midnight of a yyyy-mm-dd date.
const colomboDate = (d: string, endOfDay = false) => (d ? `${d}T${endOfDay ? '23:59:59' : '00:00:00'}+05:30` : null);

export async function savePromotion(_: PromoFormState, form: FormData): Promise<PromoFormState> {
  const ctx = await requireTenant('promotion.manage');
  const kind = String(form.get('kind'));
  const name = String(form.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Give the promotion a name customers will see, e.g. "3 for Rs 450".' };
  const rupees = (k: string) => { const v = String(form.get(k) ?? '').trim(); return v ? parseRupees(v) ?? -1 : null; };
  const pct = String(form.get('percent') ?? '').trim();
  const parsed = Promo.safeParse(
    kind === 'multi_buy' || kind === 'mix_match' ? { kind, buyQty: Number(form.get('buyQty')), bundlePriceCents: rupees('bundlePrice') ?? -1 }
    : kind === 'threshold' ? { kind, thresholdCents: rupees('threshold') ?? -1, discountCents: rupees('discount'), percentBp: pct ? Math.round(Number(pct) * 100) : null }
    : { kind, percentBp: Math.round(Number(pct) * 100) });
  if (!parsed.success || (parsed.data.kind === 'threshold' && (parsed.data.discountCents == null) === (parsed.data.percentBp == null))) {
    return { error: MESSAGE[kind] ?? 'Check the promotion details.' };
  }

  const itemIds = kind === 'threshold' ? [] : form.getAll('itemIds').map(String);
  if (kind !== 'threshold' && itemIds.length === 0) return { error: 'Choose at least one item.' };
  if (kind === 'mix_match' && itemIds.length < 2) return { error: 'A mix-and-match deal needs at least two items.' };
  const startsAt = colomboDate(String(form.get('startsOn') ?? ''));
  const endsAt = colomboDate(String(form.get('endsOn') ?? ''), true);
  if (startsAt && endsAt && endsAt <= startsAt) return { error: 'The end date must be after the start date.' };

  const { error } = await ctx.supabase.schema('api').rpc('save_promotion', {
    p: { id: String(form.get('id') ?? '') || null, name, ...parsed.data, startsAt, endsAt, isActive: form.get('isActive') === 'on', itemIds,
      membersOnly: form.get('membersOnly') === 'on' },
  });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/promotions');
  redirect('/backoffice/promotions');
}
