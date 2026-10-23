import { describe, expect, it } from 'vitest';
import { COLUMNS, TEMPLATE_CSV, parseCsv, validateItems } from '../../lib/import/items';
import { sizeFromName, unitPriceText } from '../../lib/labels';
import { indexCatalog, resolveScan, type CatalogItem } from '../../lib/lane/cart';

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, commas and newlines inside quotes, CRLF and a BOM', () => {
    const csv = '﻿name,price\r\n"Rice, red ""kekulu"" 5kg",1050\r\n"Two\nlines",1\n\n';
    expect(parseCsv(csv)).toEqual([['name', 'price'], ['Rice, red "kekulu" 5kg', '1050'], ['Two\nlines', '1']]);
  });
});

describe('validateItems', () => {
  const header = COLUMNS.join(',');

  it('accepts the template as downloaded', () => {
    const { rows, problems, headerError } = validateItems(parseCsv(TEMPLATE_CSV));
    expect(headerError).toBeUndefined();
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ row: 2, name: 'Samba Rice 5kg', priceCents: 123000, mrpCents: 125000, openingStockMilli: 64000, isPinned: true });
    expect(rows[1]).toMatchObject({ itemType: 'weighed', plu: 1234, openingStockMilli: 42600 });
  });

  it('refuses a file whose header is not the template', () => {
    expect(validateItems(parseCsv('item,cost\nRice,1')).headerError).toMatch(/Missing: name, price/);
  });

  it('reports each problem with its spreadsheet row and column (Figma 11-4551)', () => {
    const csv = [
      header,
      'Butter,,,,,4792081000013,,980,,,,,',        // wrong check digit
      'Milk,,,,,,,"1,180 Rs",,,,,',                  // money with text
      'Tea,,,,vat,,,780,,,,,',                       // unknown tax class
      'Carrots,,,weighed,,,,480,,,,,',              // weighed without PLU
      'Bread,,,,,,,170,160,,,,maybe',               // price above MRP + bad yes/no
    ].join('\n');
    const { rows, problems } = validateItems(parseCsv(csv));
    expect(rows).toEqual([]);
    expect(problems).toEqual(expect.arrayContaining([
      { row: 2, column: 'barcode', value: '4792081000013', problem: 'Check digit is wrong (EAN-13)' },
      { row: 3, column: 'price', value: '1,180 Rs', problem: 'Use numbers only, e.g. 1180.00' },
      { row: 4, column: 'tax_class', value: 'vat', problem: 'Use standard, exempt or zero' },
      { row: 5, column: 'plu', value: '', problem: 'Weighed items need a PLU' },
      { row: 6, column: 'price', value: '170', problem: 'Price is above the MRP' },
      { row: 6, column: 'pinned', value: 'maybe', problem: 'Use yes or no' },
    ]));
  });

  it('catches the same barcode twice in one file', () => {
    const csv = [header, 'A,,,,,4006381333931,,1,,,,,', 'B,,,,,4006381333931,,1,,,,,'].join('\n');
    expect(validateItems(parseCsv(csv)).problems).toEqual([{ row: 3, column: 'barcode', value: '4006381333931', problem: 'Same barcode as row 2' }]);
  });
});

describe('shelf labels', () => {
  it('reads the pack size from the name', () => {
    expect(sizeFromName('Samba Rice 5kg')).toEqual({ amount: 5000, unit: 'g' });
    expect(sizeFromName('Anchor Milk Powder 400g')).toEqual({ amount: 400, unit: 'g' });
    expect(sizeFromName('Coca-Cola 1.5L')).toEqual({ amount: 1500, unit: 'ml' });
    expect(sizeFromName('Coconut (large)')).toBeNull();
  });

  it('prints the price per kg like the Figma labels', () => {
    expect(unitPriceText('Samba Rice 5kg', 123000, 'standard')).toBe('Rs 246.00 / kg');
    expect(unitPriceText('Anchor Milk Powder 400g', 118000, 'standard')).toBe('Rs 2,950.00 / kg');
    expect(unitPriceText('Carrots per kg', 48000, 'weighed')).toBeNull();
  });
});

describe('case barcodes', () => {
  const item: CatalogItem = {
    id: 'milk', name: 'Anchor 400g', itemType: 'standard', plu: null, departmentId: null, priceCents: 118000, mrpCents: null,
    isPinned: false, stockMilli: 0, barcodes: ['4006381333931'], packBarcodes: [{ code: '14006381333938', qty: 12 }],
  };
  it('scanning a case barcode adds the whole case', () => {
    const index = indexCatalog([item]);
    expect(resolveScan(index, '4006381333931')).toMatchObject({ ok: true, qtyMilli: 1000 });
    expect(resolveScan(index, '14006381333938')).toMatchObject({ ok: true, qtyMilli: 12000 });
  });
});
