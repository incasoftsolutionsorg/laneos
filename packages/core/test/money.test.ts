import { describe, expect, it } from 'vitest';
import { cashRounding, divRound, formatAmount, formatRs, parseRupees } from '../src/money';
import { formatQty, formatStock } from '../src/qty';

describe('divRound (half away from zero)', () => {
  it('rounds halves up for positives and down for negatives', () => {
    expect(divRound(5, 10)).toBe(1);
    expect(divRound(4, 10)).toBe(0);
    expect(divRound(-5, 10)).toBe(-1);
    expect(divRound(-4, 10)).toBe(0);
  });
  it('prices a weighed line: 0.756 kg × Rs 480.00 = Rs 362.88', () => {
    expect(divRound(48000 * 756, 1000)).toBe(36288);
  });
  it('refuses division by zero', () => {
    expect(() => divRound(1, 0)).toThrow(RangeError);
  });
});

describe('formatRs', () => {
  it('formats cents with grouping', () => {
    expect(formatRs(125050)).toBe('Rs 1,250.50');
    expect(formatRs(5)).toBe('Rs 0.05');
    expect(formatRs(38425000, { decimals: 0 })).toBe('Rs 384,250');
  });
  it('marks negatives with a minus sign', () => {
    expect(formatRs(-3000)).toBe('− Rs 30.00');
  });
  it('formatAmount drops the currency', () => {
    expect(formatAmount(123000)).toBe('1,230.00');
  });
});

describe('parseRupees', () => {
  it.each([
    ['1250', 125000],
    ['1,250.5', 125050],
    ['Rs 1,250.50', 125050],
    ['0.05', 5],
  ])('%s → %i cents', (input, cents) => {
    expect(parseRupees(input)).toBe(cents);
  });
  it.each(['', 'abc', '1.234', '-5', '12.3.4'])('rejects %j', (input) => {
    expect(parseRupees(input)).toBeNull();
  });
});

describe('cashRounding', () => {
  it('rounds to the nearest rupee', () => {
    expect(cashRounding(426788, 100)).toBe(12);  // 4,267.88 → 4,268.00
    expect(cashRounding(426749, 100)).toBe(-49); // 4,267.49 → 4,267.00
    expect(cashRounding(426750, 100)).toBe(50);  // half rounds up
  });
  it('does nothing when the unit is 1 cent', () => {
    expect(cashRounding(426788, 1)).toBe(0);
  });
});

describe('quantities', () => {
  it('formats pieces and kilograms', () => {
    expect(formatQty(2000, 'standard')).toBe('2');
    expect(formatQty(756, 'weighed')).toBe('0.756 kg');
    expect(formatStock(42600, 'weighed')).toBe('42.6 kg');
    expect(formatStock(3086000, 'standard')).toBe('3,086');
  });
});
