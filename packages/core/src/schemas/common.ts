import { z } from 'zod';

export const MAX_LINE_CENTS = 100_000_000 * 100; // Rs 100 million per line (blueprint §24)

export const cents = z.number().int().min(0).max(MAX_LINE_CENTS);
export const uuid = z.uuid();
/** Sri Lankan mobile in E.164: +947XXXXXXXX */
export const lkPhone = z.string().regex(/^\+947\d{8}$/, 'Use a mobile number like 077 123 4567');

/** Accepts 0771234567, 771234567, 94771234567 or +94 77 123 4567 and returns +94771234567. */
export function normalizeLkPhone(input: string): string | null {
  const digits = input.replace(/[\s()-]/g, '');
  const m = /^(?:\+94|0094|94|0)?(7\d{8})$/.exec(digits);
  return m ? `+94${m[1]}` : null;
}
export const barcode = z.string().regex(/^[0-9A-Z-]{1,32}$/, 'Barcode may use digits, capital letters and dashes');
