// Barcode parsing for the lane (pure: no network, no React). Blueprint §24 and BR-010.

/** GS1 check digit for the digits before it (works for EAN-8, UPC-A, EAN-13 and ITF-14). */
export function gtinCheckDigit(body: string): number {
  if (!/^\d+$/.test(body)) throw new TypeError('digits only');
  let sum = 0;
  // Weights alternate 3,1,3,… starting from the digit next to the check digit.
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/** How the scale prints the 5-digit value in a 20–29 prefixed label. Set per tenant. */
export type EmbeddedMode = 'weight' | 'price';

export type ScanResult =
  | { kind: 'gtin'; code: string }
  | { kind: 'embedded_weight'; plu: number; grams: number }
  | { kind: 'embedded_price'; plu: number; priceCents: number }
  | { kind: 'plu'; plu: number }
  | { kind: 'code'; code: string }
  | { kind: 'invalid'; reason: 'check_digit' | 'empty' };

/**
 * Classify whatever the scanner (or the cashier) typed.
 *
 * Scale labels are EAN-13: `2D PPPPP VVVVV C` where 2D is 20–29, PPPPP the PLU and VVVVV
 * the weight in grams (weight mode) or the price in whole rupees (price mode).
 */
export function parseScan(raw: string, opts: { embeddedMode?: EmbeddedMode } = {}): ScanResult {
  const code = raw.trim().toUpperCase();
  if (code === '') return { kind: 'invalid', reason: 'empty' };

  if (/^\d{1,5}$/.test(code)) return { kind: 'plu', plu: Number(code) };

  if (/^\d{8}$|^\d{12,14}$/.test(code)) {
    if (!isValidGtin(code)) return { kind: 'invalid', reason: 'check_digit' };
    if (code.length === 13 && code[0] === '2') {
      const plu = Number(code.slice(2, 7));
      const value = Number(code.slice(7, 12));
      return (opts.embeddedMode ?? 'weight') === 'weight'
        ? { kind: 'embedded_weight', plu, grams: value }
        : { kind: 'embedded_price', plu, priceCents: value * 100 };
    }
    return { kind: 'gtin', code };
  }

  // Internal codes (letters, dashes) are looked up as-is.
  if (/^[0-9A-Z-]{1,32}$/.test(code)) return { kind: 'code', code };
  return { kind: 'invalid', reason: 'check_digit' };
}

/** Build a scale label (used by tests and the label printer). */
export function makeScaleLabel(prefix: number, plu: number, value: number): string {
  if (prefix < 20 || prefix > 29) throw new RangeError('prefix must be 20–29');
  const body = `${prefix}${String(plu).padStart(5, '0')}${String(value).padStart(5, '0')}`;
  return body + gtinCheckDigit(body);
}
