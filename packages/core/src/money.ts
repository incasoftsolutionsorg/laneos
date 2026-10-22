// Money is always an integer number of cents (Rs 1,250.50 → 125050). See blueprint §22.1.

const grouped = (n: number) => n.toLocaleString('en-US');

/** Divide and round half away from zero, using integers only. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError('division by zero');
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const a = Math.abs(numerator);
  const b = Math.abs(denominator);
  return sign * Math.floor((a + Math.floor(b / 2)) / b) + 0; // + 0 turns -0 into 0
}

/** Format cents as "Rs 1,250.50". `decimals: 0` gives "Rs 1,251" (dashboard style). */
export function formatRs(cents: number, opts: { decimals?: 0 | 2; sign?: boolean } = {}): string {
  const decimals = opts.decimals ?? 2;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  let body: string;
  if (decimals === 0) {
    body = grouped(divRound(abs, 100));
  } else {
    const rupees = Math.floor(abs / 100);
    const rest = String(abs % 100).padStart(2, '0');
    body = `${grouped(rupees)}.${rest}`;
  }
  const prefix = negative ? '− ' : opts.sign ? '+ ' : '';
  return `${prefix}Rs ${body}`;
}

/** Format cents as a plain amount without the currency, e.g. "1,230.00" (receipt and cart lines). */
export function formatAmount(cents: number): string {
  return formatRs(cents).replace('Rs ', '');
}

/** Parse a typed rupee amount ("1,250.5", "1250") into cents. Returns null when it is not a valid amount. */
export function parseRupees(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '').replace(/^Rs\.?/i, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Round a total to the nearest cash unit (e.g. 100 = nearest rupee). Returns the adjustment in cents. */
export function cashRounding(totalCents: number, unitCents: number): number {
  if (unitCents <= 1) return 0;
  return divRound(totalCents, unitCents) * unitCents - totalCents;
}
