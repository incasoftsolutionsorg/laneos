import { describe, expect, it } from 'vitest';
import { makeScaleLabel } from '@laneos/barcode';
import { addLine, indexCatalog, quickTenders, resolveScan, setQty, toBasket, type CatalogItem } from '../../lib/lane/cart';

const item = (over: Partial<CatalogItem>): CatalogItem => ({
  id: 'x', name: 'Item', itemType: 'standard', plu: null, departmentId: null, priceCents: 10000, mrpCents: null,
  isPinned: false, stockMilli: 0, barcodes: [], ...over,
});

const rice = item({ id: 'rice', name: 'Samba Rice 5kg', priceCents: 123000, barcodes: ['4006381333931'] });
const carrots = item({ id: 'carrots', name: 'Carrots per kg', itemType: 'weighed', plu: 1234, priceCents: 48000 });
const veg = item({ id: 'veg', name: 'Mixed veg', itemType: 'open_price', plu: 77, priceCents: null, barcodes: ['VEG'] });
const index = indexCatalog([rice, carrots, veg]);

describe('resolveScan', () => {
  it('finds an item by barcode', () => {
    expect(resolveScan(index, '4006381333931')).toMatchObject({ ok: true, item: { id: 'rice' }, qtyMilli: 1000 });
  });

  it('reports unknown and misread barcodes', () => {
    expect(resolveScan(index, '036000291452')).toEqual({ ok: false, message: 'No item with barcode 036000291452.' });
    expect(resolveScan(index, '4006381333932').ok).toBe(false);
  });

  it('asks for a weight when a weighed item is keyed by PLU', () => {
    expect(resolveScan(index, '1234')).toMatchObject({ ok: true, item: { id: 'carrots' }, needs: 'weight', qtyMilli: 0 });
  });

  it('takes the weight from a scale label', () => {
    expect(resolveScan(index, makeScaleLabel(21, 1234, 756))).toMatchObject({ ok: true, item: { id: 'carrots' }, qtyMilli: 756 });
  });

  it('converts a price-embedded label to grams', () => {
    // Rs 363 of carrots at Rs 480/kg = 756.25 g → 756 g
    expect(resolveScan(index, makeScaleLabel(22, 1234, 363), 'price')).toMatchObject({ ok: true, qtyMilli: 756 });
  });

  it('asks for a price for open-price items', () => {
    expect(resolveScan(index, 'veg')).toMatchObject({ ok: true, needs: 'price' });
  });
});

describe('cart', () => {
  it('adds to the existing line when the same item is scanned again', () => {
    const cart = addLine(addLine([], { itemId: 'rice', qtyMilli: 1000 }), { itemId: 'rice', qtyMilli: 1000 });
    expect(cart).toEqual([{ itemId: 'rice', qtyMilli: 2000, openPriceCents: undefined }]);
  });

  it('removes a line when its quantity reaches zero', () => {
    expect(setQty([{ itemId: 'rice', qtyMilli: 1000 }], 'rice', 0)).toEqual([]);
  });

  it('builds a basket with open prices taking priority', () => {
    const basket = toBasket([{ itemId: 'rice', qtyMilli: 1000 }, { itemId: 'veg', qtyMilli: 1000, openPriceCents: 25000 }], index);
    expect(basket.map((b) => b.unitPriceCents)).toEqual([123000, 25000]);
  });
});

describe('quickTenders', () => {
  it('offers exact money and the next notes up', () => {
    expect(quickTenders(425800)).toEqual([425800, 430000, 450000, 500000]);
  });
});
