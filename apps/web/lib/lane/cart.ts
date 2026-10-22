// Lane cart logic (pure). The checkout screen keeps the cart in React state and calls these.

import { parseScan, type EmbeddedMode } from '@laneos/barcode';
import { divRound, type ItemType } from '@laneos/core';
import type { BasketLine, Promotion } from '@laneos/pricing';

export interface CatalogItem {
  id: string;
  name: string;
  itemType: ItemType;
  plu: number | null;
  departmentId: string | null;
  priceCents: number | null;
  mrpCents: number | null;
  isPinned: boolean;
  stockMilli: number;
  barcodes: string[];
}

export interface CatalogPromotion {
  id: string;
  name: string;
  kind: 'multi_buy' | 'percent_off';
  buyQty: number | null;
  bundlePriceCents: number | null;
  percentBp: number | null;
  itemIds: string[];
}

/** Shape returned by api.lane_catalog. */
export interface LaneCatalog {
  lane: { id: string; code: string; name: string; status: string };
  shop: { id: string; code: string; name: string };
  tenant: { name: string; roundingUnitCents: number; embeddedBarcodeMode: EmbeddedMode; catalogVersion: number };
  shift: { id: string; shiftNo: number; openedAt: string; cashier: string } | null;
  departments: { id: string; name: string }[];
  items: CatalogItem[];
  promotions: CatalogPromotion[];
}

export interface CartLine {
  itemId: string;
  qtyMilli: number;
  openPriceCents?: number;
}

export interface CatalogIndex {
  byId: Map<string, CatalogItem>;
  byBarcode: Map<string, CatalogItem>;
  byPlu: Map<number, CatalogItem>;
}

export function indexCatalog(items: CatalogItem[]): CatalogIndex {
  const byId = new Map<string, CatalogItem>();
  const byBarcode = new Map<string, CatalogItem>();
  const byPlu = new Map<number, CatalogItem>();
  for (const item of items) {
    byId.set(item.id, item);
    if (item.plu != null) byPlu.set(item.plu, item);
    for (const code of item.barcodes) byBarcode.set(code, item);
  }
  return { byId, byBarcode, byPlu };
}

export type ScanOutcome =
  | { ok: true; item: CatalogItem; qtyMilli: number; needs?: 'weight' | 'price' }
  | { ok: false; message: string };

/** What should happen when the scanner (or the cashier) enters a code. */
export function resolveScan(index: CatalogIndex, raw: string, mode: EmbeddedMode = 'weight'): ScanOutcome {
  const scan = parseScan(raw, { embeddedMode: mode });
  const needsFor = (item: CatalogItem) =>
    item.itemType === 'weighed' ? 'weight' : item.itemType === 'open_price' ? 'price' : undefined;

  switch (scan.kind) {
    case 'invalid':
      return { ok: false, message: scan.reason === 'empty' ? 'Scan or type a code.' : `Barcode ${raw.trim()} has a wrong check digit. Scan again.` };
    case 'gtin':
    case 'code': {
      const item = index.byBarcode.get(scan.code);
      if (!item) return { ok: false, message: `No item with barcode ${scan.code}.` };
      return { ok: true, item, qtyMilli: 1000, needs: needsFor(item) };
    }
    case 'plu': {
      const item = index.byPlu.get(scan.plu);
      if (!item) return { ok: false, message: `No item with PLU ${scan.plu}.` };
      return { ok: true, item, qtyMilli: item.itemType === 'weighed' ? 0 : 1000, needs: needsFor(item) };
    }
    case 'embedded_weight': {
      const item = index.byPlu.get(scan.plu);
      if (!item) return { ok: false, message: `Scale label PLU ${scan.plu} is not in the catalogue.` };
      if (scan.grams <= 0) return { ok: false, message: 'The scale label shows zero weight.' };
      return { ok: true, item, qtyMilli: scan.grams };
    }
    case 'embedded_price': {
      const item = index.byPlu.get(scan.plu);
      if (!item || !item.priceCents) return { ok: false, message: `Scale label PLU ${scan.plu} is not in the catalogue.` };
      return { ok: true, item, qtyMilli: divRound(scan.priceCents * 1000, item.priceCents) };
    }
  }
}

/** Add to the cart; the same item scanned again adds to its line (the server merges the same way). */
export function addLine(cart: CartLine[], line: CartLine): CartLine[] {
  const i = cart.findIndex((l) => l.itemId === line.itemId);
  if (i === -1) return [...cart, line];
  const merged = { ...cart[i]!, qtyMilli: cart[i]!.qtyMilli + line.qtyMilli, openPriceCents: line.openPriceCents ?? cart[i]!.openPriceCents };
  return cart.map((l, j) => (j === i ? merged : l));
}

export function setQty(cart: CartLine[], itemId: string, qtyMilli: number): CartLine[] {
  if (qtyMilli <= 0) return cart.filter((l) => l.itemId !== itemId);
  return cart.map((l) => (l.itemId === itemId ? { ...l, qtyMilli } : l));
}

export function toBasket(cart: CartLine[], index: CatalogIndex): BasketLine[] {
  return cart.flatMap((l) => {
    const item = index.byId.get(l.itemId);
    if (!item) return [];
    return [{ itemId: l.itemId, itemType: item.itemType, qtyMilli: l.qtyMilli, unitPriceCents: l.openPriceCents ?? item.priceCents ?? 0 }];
  });
}

export function toPromotions(promotions: CatalogPromotion[]): Promotion[] {
  return promotions.flatMap((p): Promotion[] => {
    if (p.kind === 'multi_buy' && p.buyQty && p.bundlePriceCents != null) {
      return [{ id: p.id, kind: 'multi_buy', itemIds: p.itemIds, buyQty: p.buyQty, bundlePriceCents: p.bundlePriceCents, name: p.name }];
    }
    if (p.kind === 'percent_off' && p.percentBp) {
      return [{ id: p.id, kind: 'percent_off', itemIds: p.itemIds, percentBp: p.percentBp, name: p.name }];
    }
    return [];
  });
}

/** Quick cash amounts a cashier is likely to be handed for this total. */
export function quickTenders(totalCents: number): number[] {
  const notes = [10000, 50000, 100000, 500000];
  const out = new Set<number>([totalCents]);
  for (const n of notes) {
    const up = Math.ceil(totalCents / n) * n;
    if (up > totalCents) out.add(up);
  }
  return [...out].sort((a, b) => a - b).slice(0, 4);
}
