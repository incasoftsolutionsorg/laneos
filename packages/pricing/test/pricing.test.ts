import { describe, expect, it } from 'vitest';
import { changeDue, lineGross, priceBasket, type BasketLine, type Promotion } from '../src';

const line = (itemId: string, qtyMilli: number, unitPriceCents: number, itemType: BasketLine['itemType'] = 'standard'): BasketLine =>
  ({ itemId, qtyMilli, unitPriceCents, itemType });

const breadDeal: Promotion = { id: 'p-bread', kind: 'multi_buy', itemIds: ['bread'], buyQty: 3, bundlePriceCents: 45000 };

describe('lineGross', () => {
  it('multiplies price by quantity', () => {
    expect(lineGross({ qtyMilli: 2000, unitPriceCents: 118000 })).toBe(236000);
  });
  it('prices weighed items per kg with half-up rounding', () => {
    expect(lineGross({ qtyMilli: 756, unitPriceCents: 48000 })).toBe(36288);
    expect(lineGross({ qtyMilli: 333, unitPriceCents: 1 })).toBe(0);
    expect(lineGross({ qtyMilli: 500, unitPriceCents: 1 })).toBe(1);
  });
});

describe('priceBasket', () => {
  it('totals the checkout example from Figma (rounding to the rupee)', () => {
    const t = priceBasket(
      [
        line('rice', 1000, 123000),
        line('milk', 2000, 118000),
        line('carrots', 756, 48000, 'weighed'),
        line('bread', 1000, 16000),
        line('coconut', 1000, 14000),
        line('bag', 1000, 500),
      ],
      [],
      { roundingUnitCents: 100 },
    );
    expect(t.subtotalCents).toBe(425788);
    expect(t.roundingCents).toBe(12);
    expect(t.totalCents).toBe(425800);
  });

  it('applies "3 for Rs 450" per complete group only', () => {
    expect(priceBasket([line('bread', 2000, 16000)], [breadDeal]).promoCents).toBe(0);
    expect(priceBasket([line('bread', 3000, 16000)], [breadDeal]).promoCents).toBe(3000);
    expect(priceBasket([line('bread', 4000, 16000)], [breadDeal]).promoCents).toBe(3000);
    expect(priceBasket([line('bread', 6000, 16000)], [breadDeal]).promoCents).toBe(6000);
  });

  it('merges repeated scans of the same item before promotions', () => {
    const t = priceBasket([line('bread', 1000, 16000), line('bread', 1000, 16000), line('bread', 1000, 16000)], [breadDeal]);
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]!.qtyMilli).toBe(3000);
    expect(t.promoCents).toBe(3000);
  });

  it('gives the single best promotion when several match (BR-021)', () => {
    const tenPercent: Promotion = { id: 'p-10', kind: 'percent_off', itemIds: ['bread'], percentBp: 1000 };
    const t = priceBasket([line('bread', 3000, 16000)], [tenPercent, breadDeal]);
    expect(t.promoCents).toBe(4800); // 10% of 480 beats Rs 30 off
    expect(t.lines[0]!.promotionId).toBe('p-10');
  });

  it('never gives a negative saving or more than the line value', () => {
    const badDeal: Promotion = { id: 'p-bad', kind: 'multi_buy', itemIds: ['bread'], buyQty: 3, bundlePriceCents: 60000 };
    expect(priceBasket([line('bread', 3000, 16000)], [badDeal]).promoCents).toBe(0);
    const everything: Promotion = { id: 'p-all', kind: 'percent_off', itemIds: ['bread'], percentBp: 10000 };
    expect(priceBasket([line('bread', 1000, 16000)], [everything]).totalCents).toBe(0);
  });

  it('does not apply multi-buy to weighed items', () => {
    const deal: Promotion = { id: 'p-kg', kind: 'multi_buy', itemIds: ['carrots'], buyQty: 2, bundlePriceCents: 1 };
    expect(priceBasket([line('carrots', 5000, 48000, 'weighed')], [deal]).promoCents).toBe(0);
  });

  it('handles an empty basket', () => {
    expect(priceBasket([], [], { roundingUnitCents: 100 })).toMatchObject({ subtotalCents: 0, totalCents: 0, roundingCents: 0 });
  });
});

describe('changeDue', () => {
  it('returns the change for cash', () => {
    expect(changeDue(425800, 500000)).toBe(74200);
    expect(changeDue(425800, 400000)).toBeLessThan(0);
  });
});
