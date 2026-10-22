// Quantities are integer milli-units: 1 piece = 1000, and for weighed items 1 g = 1 (1 kg = 1000).

export const ITEM_TYPES = ['standard', 'weighed', 'pack', 'open_price'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const pieces = (n: number) => n * 1000;

/** "2" for pieces, "0.756 kg" for weighed items. */
export function formatQty(qtyMilli: number, itemType: ItemType): string {
  if (itemType === 'weighed') {
    return `${(qtyMilli / 1000).toFixed(3)} kg`;
  }
  const n = qtyMilli / 1000;
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

/** Stock shown in tables: whole pieces, or kilograms with one decimal for weighed items. */
export function formatStock(qtyMilli: number, itemType: ItemType): string {
  if (itemType === 'weighed') return `${(qtyMilli / 1000).toFixed(1)} kg`;
  return (Math.trunc(qtyMilli / 1000)).toLocaleString('en-US');
}
