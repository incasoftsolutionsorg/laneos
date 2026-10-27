// Basket pricing shared by the lane (preview) and tests. The database function api.create_sale
// implements the same rules and is the source of truth (PRN-002); keep the two in step.

import { cashRounding, divRound, type ItemType } from '@laneos/core';

export interface BasketLine {
  itemId: string;
  itemType: ItemType;
  qtyMilli: number;
  unitPriceCents: number;
}

interface PromotionBase { id: string; itemIds: string[]; name?: string; /** Only when a loyalty member is on the bill. */ membersOnly?: boolean }

export type Promotion =
  /** "3 for Rs 450": every complete group of `buyQty` pieces of one item costs `bundlePriceCents`. */
  | (PromotionBase & { kind: 'multi_buy'; buyQty: number; bundlePriceCents: number })
  /** Percentage off the line, in basis points (10% = 1000). */
  | (PromotionBase & { kind: 'percent_off'; percentBp: number })
  /** "Any 3 of these for Rs 450": pieces of any items in the group count together. */
  | (PromotionBase & { kind: 'mix_match'; buyQty: number; bundlePriceCents: number })
  /** "Spend Rs 5,000, get Rs 250 off" (or a % off): on the whole bill after item promotions. `itemIds` is unused. */
  | (PromotionBase & { kind: 'threshold'; thresholdCents: number; discountCents?: number | null; percentBp?: number | null });

export interface PricedLine extends BasketLine {
  grossCents: number;
  promoCents: number;
  promotionId: string | null;
}

export interface BasketTotals {
  lines: PricedLine[];
  subtotalCents: number;
  /** Item promotions plus the bill discount. */
  promoCents: number;
  /** The bill-level ("spend X") discount, already included in promoCents. */
  basketPromoCents: number;
  basketPromotionId: string | null;
  roundingCents: number;
  totalCents: number;
}

/** Line value before promotions. Weighed items: price is per kg and qty is grams. */
export function lineGross(line: Pick<BasketLine, 'qtyMilli' | 'unitPriceCents'>): number {
  return divRound(line.unitPriceCents * line.qtyMilli, 1000);
}

function itemSaving(promo: Promotion, line: BasketLine, gross: number): number {
  if (promo.kind === 'percent_off') return divRound(gross * promo.percentBp, 10_000);
  if (promo.kind !== 'multi_buy' || line.itemType === 'weighed') return 0; // multi-buy counts pieces only
  const qty = Math.floor(line.qtyMilli / 1000);
  const groups = Math.floor(qty / promo.buyQty);
  return Math.max(0, groups * (promo.buyQty * line.unitPriceCents - promo.bundlePriceCents));
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Price a basket (rules = api.create_sale, BR-020/021):
 * 1. Lines with the same item are merged, so "3 for 450" works however the cashier scanned them.
 * 2. Each item gets its single best item promotion (multi-buy or % off).
 * 3. Mix-and-match promotions, in id order: the group's pieces (most expensive first) form complete groups; the
 *    promotion replaces the item promotions of the lines it uses only if it saves more than they do. Its saving is
 *    shared over those lines in proportion to their value in the groups (item id order, last line takes the rest).
 * 4. The best "spend X" promotion the bill reaches is taken off the bill after item promotions.
 * Members-only promotions count only when `member` is true. Promotions never stack on one line.
 */
export function priceBasket(
  input: BasketLine[],
  promotions: Promotion[] = [],
  opts: { roundingUnitCents?: number; member?: boolean } = {},
): BasketTotals {
  const merged = new Map<string, BasketLine>();
  for (const line of input) {
    const prev = merged.get(line.itemId);
    merged.set(line.itemId, prev ? { ...prev, qtyMilli: prev.qtyMilli + line.qtyMilli } : { ...line });
  }
  const usable = promotions.filter((p) => !p.membersOnly || opts.member);

  const lines: PricedLine[] = [...merged.values()].sort((a, b) => byText(a.itemId, b.itemId)).map((line) => {
    const grossCents = lineGross(line);
    let best = { saving: 0, id: null as string | null };
    for (const promo of usable) {
      if ((promo.kind !== 'multi_buy' && promo.kind !== 'percent_off') || !promo.itemIds.includes(line.itemId)) continue;
      const saving = Math.min(grossCents, itemSaving(promo, line, grossCents));
      if (saving > best.saving || (saving === best.saving && saving > 0 && best.id !== null && byText(promo.id, best.id) < 0)) best = { saving, id: promo.id };
    }
    return { ...line, grossCents, promoCents: best.saving, promotionId: best.id };
  });

  const claimed = new Set<string>();
  for (const promo of usable.filter((p) => p.kind === 'mix_match').sort((a, b) => byText(a.id, b.id))) {
    if (promo.kind !== 'mix_match') continue;
    const pieces: { itemId: string; price: number }[] = [];
    for (const l of lines) {
      if (!promo.itemIds.includes(l.itemId) || l.itemType === 'weighed' || claimed.has(l.itemId)) continue;
      for (let i = 0; i < Math.floor(l.qtyMilli / 1000); i++) pieces.push({ itemId: l.itemId, price: l.unitPriceCents });
    }
    pieces.sort((a, b) => b.price - a.price || byText(a.itemId, b.itemId));
    const groups = Math.floor(pieces.length / promo.buyQty);
    if (!groups) continue;
    const used = pieces.slice(0, groups * promo.buyQty);
    const share = new Map<string, number>();
    for (const p of used) share.set(p.itemId, (share.get(p.itemId) ?? 0) + p.price);
    const usedValue = used.reduce((s, p) => s + p.price, 0);
    const saving = Math.max(0, usedValue - groups * promo.bundlePriceCents);
    const replaced = lines.filter((l) => share.has(l.itemId)).reduce((s, l) => s + l.promoCents, 0);
    if (saving <= replaced) continue;
    const ids = [...share.keys()].sort(byText);
    let left = saving;
    ids.forEach((id, i) => {
      const l = lines.find((x) => x.itemId === id)!;
      const part = i === ids.length - 1 ? left : divRound(saving * share.get(id)!, usedValue);
      left -= part;
      l.promoCents = Math.min(l.grossCents, part);
      l.promotionId = promo.id;
      claimed.add(id);
    });
  }

  const subtotalCents = lines.reduce((s, l) => s + l.grossCents, 0);
  const itemPromo = lines.reduce((s, l) => s + l.promoCents, 0);
  const afterItems = subtotalCents - itemPromo;

  let basket = { saving: 0, id: null as string | null };
  for (const promo of usable) {
    if (promo.kind !== 'threshold' || afterItems < promo.thresholdCents) continue;
    const saving = Math.min(afterItems, promo.percentBp ? divRound(afterItems * promo.percentBp, 10_000) : promo.discountCents ?? 0);
    if (saving > basket.saving || (saving === basket.saving && saving > 0 && basket.id !== null && byText(promo.id, basket.id) < 0)) basket = { saving, id: promo.id };
  }

  const beforeRounding = afterItems - basket.saving;
  const roundingCents = cashRounding(beforeRounding, opts.roundingUnitCents ?? 0);
  return {
    lines, subtotalCents, promoCents: itemPromo + basket.saving, basketPromoCents: basket.saving, basketPromotionId: basket.id,
    roundingCents, totalCents: beforeRounding + roundingCents,
  };
}

/** Points a bill earns: one point per full `spendCents` paid (loyalty points spent on it are not counted). */
export function pointsEarned(paidCents: number, spendCents: number): number {
  return spendCents > 0 ? Math.max(0, Math.floor(paidCents / spendCents)) : 0;
}

/** Change to give back for a cash payment. Negative means the customer still owes. */
export function changeDue(totalCents: number, tenderedCents: number): number {
  return tenderedCents - totalCents;
}
