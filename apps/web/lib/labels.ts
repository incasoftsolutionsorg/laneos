// Shelf-label helpers (Figma 11-2830). Pure.

import { divRound, formatRs } from '@laneos/core';

/** Net content read from the item name: "Samba Rice 5kg" → 5000 g, "Coke 1.5L" → 1500 ml. */
export function sizeFromName(name: string): { amount: number; unit: 'g' | 'ml' } | null {
  const m = /(\d+(?:\.\d+)?)\s*(kg|g|l|ml)\b/i.exec(name);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2]!.toLowerCase();
  if (!(n > 0)) return null;
  if (u === 'kg') return { amount: n * 1000, unit: 'g' };
  if (u === 'g') return { amount: n, unit: 'g' };
  if (u === 'l') return { amount: n * 1000, unit: 'ml' };
  return { amount: n, unit: 'ml' };
}

/** "Rs 246.00 / kg" for a 5 kg bag at Rs 1,230 — the comparison price shoppers look for. */
export function unitPriceText(name: string, priceCents: number, itemType: string): string | null {
  if (itemType === 'weighed') return null; // the price already is per kg
  const size = sizeFromName(name);
  if (!size) return null;
  const per = divRound(priceCents * 1000, size.amount);
  return `${formatRs(per)} / ${size.unit === 'g' ? 'kg' : 'L'}`;
}

export type LabelFormat = 'shelf' | 'sticker' | 'a4';
export const LABEL_SIZES: Record<LabelFormat, { w: string; h: string; label: string }> = {
  shelf: { w: '50mm', h: '25mm', label: 'Shelf 50×25' },
  sticker: { w: '38mm', h: '25mm', label: 'Sticker 38×25' },
  a4: { w: '63.5mm', h: '38.1mm', label: 'A4 sheet' },   // 3 × 7 labels per A4 page
};
