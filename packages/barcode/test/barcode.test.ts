import { describe, expect, it } from 'vitest';
import { gtinCheckDigit, isValidGtin, makeScaleLabel, parseScan } from '../src';

describe('GS1 check digits', () => {
  it.each([
    ['4006381333931', 'EAN-13'],
    ['036000291452', 'UPC-A'],
    ['96385074', 'EAN-8'],
    ['10012345678902', 'ITF-14'],
  ])('%s is a valid %s', (code) => {
    expect(isValidGtin(code)).toBe(true);
  });

  it('rejects a wrong check digit and wrong lengths', () => {
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('40063813339A1')).toBe(false);
  });

  it('computes the digit for a body', () => {
    expect(gtinCheckDigit('400638133393')).toBe(1);
  });
});

describe('parseScan', () => {
  it('treats short numbers as PLUs', () => {
    expect(parseScan('1234')).toEqual({ kind: 'plu', plu: 1234 });
  });

  it('returns normal barcodes as GTINs', () => {
    expect(parseScan(' 4006381333931 ')).toEqual({ kind: 'gtin', code: '4006381333931' });
  });

  it('flags a misread barcode', () => {
    expect(parseScan('4006381333932')).toEqual({ kind: 'invalid', reason: 'check_digit' });
    expect(parseScan('   ')).toEqual({ kind: 'invalid', reason: 'empty' });
  });

  it('reads weight from a scale label (carrots, PLU 1234, 756 g)', () => {
    const label = makeScaleLabel(21, 1234, 756);
    expect(label).toHaveLength(13);
    expect(parseScan(label)).toEqual({ kind: 'embedded_weight', plu: 1234, grams: 756 });
  });

  it('reads price from a scale label in price mode', () => {
    const label = makeScaleLabel(22, 42, 363);
    expect(parseScan(label, { embeddedMode: 'price' })).toEqual({ kind: 'embedded_price', plu: 42, priceCents: 36300 });
  });

  it('passes internal codes through in upper case', () => {
    expect(parseScan('bag-01')).toEqual({ kind: 'code', code: 'BAG-01' });
  });

  it('only accepts prefixes 20–29 for scale labels', () => {
    expect(() => makeScaleLabel(19, 1, 1)).toThrow(RangeError);
  });
});
