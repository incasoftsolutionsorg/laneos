// Basket pricing shared by the lane (preview) and tests. The database function api.create_sale
// implements the same rules and is the source of truth (PRN-002); keep the two in step.

import { cashRounding, divRound, type ItemType } from '@laneos/core';

export interface BasketLine {
  itemId: string;
  itemType: ItemType;
  qtyMilli: number;
  unitPriceCents: number;
}

export type Promotion =
  /** "3 for Rs 450": every complete group of `buyQty` pieces costs `bundlePriceCents`. */
  | { id: string; kind: 'multi_buy'; itemIds: string[]; buyQty: number; bundlePriceCents: number; name?: string }
  /** Percentage off the line, in basis points (10% = 1000). */
  | { id: string; kind: 'percent_off'; itemIds: string[]; percentBp: number; name?: string };

export interface PricedLine extends BasketLine {
  grossCents: number;
  promoCents: number;
  promotionId: string | null;
}

export interface BasketTotals {
  lines: PricedLine[];
  subtotalCents: number;
  promoCents: number;
  roundingCents: number;
  totalCents: number;
}

/** Line value before promotions. Weighed items: price is per kg and qty is grams. */
export function lineGross(line: Pick<BasketLine, 'qtyMilli' | 'unitPriceCents'>): number {
  return divRound(line.unitPriceCents * line.qtyMilli, 1000);
}

function promoSaving(promo: Promotion, line: BasketLine, gross: number): number {
  if (promo.kind === 'percent_off') return divRound(gross * promo.percentBp, 10_000);
  if (line.itemType === 'weighed') return 0; // multi-buy counts pieces only
  const qty = Math.floor(line.qtyMilli / 1000);
  const groups = Math.floor(qty / promo.buyQty);
  const saving = groups * (promo.buyQty * line.unitPriceCents - promo.bundlePriceCents);
  return Math.max(0, saving);
}

/**
 * Price a basket. Lines with the same item are merged first so "3 for 450" works however
 * the cashier scanned them. When several promotions match an item the customer gets the
 * single best one (BR-021).
 */
export function priceBasket(
  input: BasketLine[],
  promotions: Promotion[] = [],
  opts: { roundingUnitCents?: number } = {},
): BasketTotals {
  const merged = new Map<string, BasketLine>();
  for (const line of input) {
    const prev = merged.get(line.itemId);
    merged.set(line.itemId, prev ? { ...prev, qtyMilli: prev.qtyMilli + line.qtyMilli } : { ...line });
  }

  const lines: PricedLine[] = [...merged.values()].map((line) => {
    const grossCents = lineGross(line);
    let best = { saving: 0, id: null as string | null };
    for (const promo of promotions) {
      if (!promo.itemIds.includes(line.itemId)) continue;
      const saving = Math.min(grossCents, promoSaving(promo, line, grossCents));
      if (saving > best.saving) best = { saving, id: promo.id };
    }
    return { ...line, grossCents, promoCents: best.saving, promotionId: best.id };
  });

  const subtotalCents = lines.reduce((s, l) => s + l.grossCents, 0);
  const promoCents = lines.reduce((s, l) => s + l.promoCents, 0);
  const beforeRounding = subtotalCents - promoCents;
  const roundingCents = cashRounding(beforeRounding, opts.roundingUnitCents ?? 0);
  return { lines, subtotalCents, promoCents, roundingCents, totalCents: beforeRounding + roundingCents };
}

/** Change to give back for a cash payment. Negative means the customer still owes. */
export function changeDue(totalCents: number, tenderedCents: number): number {
  return tenderedCents - totalCents;
}
