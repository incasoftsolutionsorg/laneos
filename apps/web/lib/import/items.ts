// Item CSV import (Figma 11-4551, blueprint §24): parse, check the header against the template
// version, and validate every row with readable problems per column. Pure — no network.

import { isValidGtin } from '@laneos/barcode';

export const TEMPLATE_VERSION = 'items-import-v1';
export const COLUMNS = [
  'name', 'category', 'brand', 'item_type', 'tax_class', 'barcode', 'plu', 'price', 'mrp', 'cost',
  'reorder_level', 'opening_stock', 'pinned',
] as const;
export const REQUIRED = ['name', 'price'] as const;
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 20_000;

export const TEMPLATE_CSV =
  `${COLUMNS.join(',')}\n` +
  'Samba Rice 5kg,Rice & grains,Nipuna,standard,standard,4796001230046,,1230.00,1250.00,1095.00,15,64,yes\n' +
  'Carrots per kg,Vegetables,,weighed,exempt,,1234,480.00,,360.00,8,42.6,no\n';

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, ''); // Excel adds a BOM
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export interface ImportRow {
  row: number; name: string; category: string | null; brand: string | null;
  itemType: 'standard' | 'weighed' | 'pack' | 'open_price'; taxClass: 'standard' | 'exempt' | 'zero';
  barcode: string | null; plu: number | null; priceCents: number; mrpCents: number | null; costCents: number | null;
  reorderLevelMilli: number; openingStockMilli: number; isPinned: boolean;
}

export interface ImportProblem { row: number; column: string; value: string; problem: string }

const money = (s: string) => (/^\d{1,9}(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : null);
const qty = (s: string) => (/^\d{1,7}(\.\d{1,3})?$/.test(s) ? Math.round(Number(s) * 1000) : null);
const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0', '']);

/** Validates a parsed file. Row numbers match the spreadsheet (header = row 1). */
export function validateItems(table: string[][]): { rows: ImportRow[]; problems: ImportProblem[]; headerError?: string } {
  const [header, ...body] = table;
  if (!header) return { rows: [], problems: [], headerError: 'The file is empty.' };
  const cols = header.map((h) => h.trim().toLowerCase());
  const unknown = cols.filter((c) => c && !(COLUMNS as readonly string[]).includes(c));
  const missing = REQUIRED.filter((c) => !cols.includes(c));
  if (missing.length || unknown.length) {
    return {
      rows: [], problems: [],
      headerError: `The header does not match ${TEMPLATE_VERSION}.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}${unknown.length ? ` Unknown: ${unknown.join(', ')}.` : ''} Download the template.`,
    };
  }
  if (body.length > MAX_ROWS) return { rows: [], problems: [], headerError: `At most ${MAX_ROWS.toLocaleString('en-US')} rows per file.` };

  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  const seenBarcodes = new Map<string, number>();

  body.forEach((cells, i) => {
    const rowNo = i + 2;
    const get = (c: (typeof COLUMNS)[number]) => (cols.indexOf(c) >= 0 ? (cells[cols.indexOf(c)] ?? '').trim() : '');
    const bad = (column: string, value: string, problem: string) => problems.push({ row: rowNo, column, value, problem });
    const before = problems.length;

    const name = get('name');
    if (!name) bad('name', '', 'Name is required');
    else if (name.length > 120) bad('name', name.slice(0, 30) + '…', 'Use at most 120 characters');

    const itemTypeRaw = (get('item_type') || 'standard').toLowerCase().replace(' ', '_');
    if (!['standard', 'weighed', 'pack', 'open_price'].includes(itemTypeRaw)) bad('item_type', get('item_type'), 'Use standard, weighed, pack or open_price');
    const taxRaw = (get('tax_class') || 'standard').toLowerCase();
    if (!['standard', 'exempt', 'zero'].includes(taxRaw)) bad('tax_class', get('tax_class'), 'Use standard, exempt or zero');

    const barcode = get('barcode').toUpperCase();
    if (barcode) {
      if (!/^[0-9A-Z-]{1,32}$/.test(barcode)) bad('barcode', barcode, 'Digits, capital letters and dashes only');
      else if (/^\d{8}$|^\d{12,14}$/.test(barcode) && !isValidGtin(barcode)) bad('barcode', barcode, `Check digit is wrong (${barcode.length === 13 ? 'EAN-13' : barcode.length === 12 ? 'UPC-A' : `${barcode.length} digits`})`);
      else if (seenBarcodes.has(barcode)) bad('barcode', barcode, `Same barcode as row ${seenBarcodes.get(barcode)}`);
      else seenBarcodes.set(barcode, rowNo);
    }

    const pluRaw = get('plu');
    const plu = pluRaw ? Number(pluRaw) : null;
    if (pluRaw && (!Number.isInteger(plu) || plu! < 1 || plu! > 99999)) bad('plu', pluRaw, 'PLU must be a whole number 1–99999');
    if (itemTypeRaw === 'weighed' && !pluRaw) bad('plu', '', 'Weighed items need a PLU');

    const priceRaw = get('price');
    const priceCents = money(priceRaw.replace(/,/g, ''));
    if (priceCents == null && !(itemTypeRaw === 'open_price' && priceRaw === '')) bad('price', priceRaw, 'Use numbers only, e.g. 1180.00');
    const mrpRaw = get('mrp');
    const mrpCents = mrpRaw ? money(mrpRaw.replace(/,/g, '')) : null;
    if (mrpRaw && mrpCents == null) bad('mrp', mrpRaw, 'Use numbers only, e.g. 1200.00');
    if (priceCents != null && mrpCents != null && priceCents > mrpCents) bad('price', priceRaw, 'Price is above the MRP');
    const costRaw = get('cost');
    const costCents = costRaw ? money(costRaw.replace(/,/g, '')) : null;
    if (costRaw && costCents == null) bad('cost', costRaw, 'Use numbers only, e.g. 1040.00');

    const reorderRaw = get('reorder_level');
    const reorder = reorderRaw ? qty(reorderRaw) : 0;
    if (reorder == null) bad('reorder_level', reorderRaw, 'Use a number, e.g. 12 or 2.5');
    const openingRaw = get('opening_stock');
    const opening = openingRaw ? qty(openingRaw) : 0;
    if (opening == null) bad('opening_stock', openingRaw, 'Use a number, e.g. 64 or 42.6');

    const pinnedRaw = get('pinned').toLowerCase();
    if (!YES.has(pinnedRaw) && !NO.has(pinnedRaw)) bad('pinned', get('pinned'), 'Use yes or no');

    if (problems.length === before) {
      rows.push({
        row: rowNo, name, category: get('category') || null, brand: get('brand') || null,
        itemType: itemTypeRaw as ImportRow['itemType'], taxClass: taxRaw as ImportRow['taxClass'],
        barcode: barcode || null, plu, priceCents: priceCents ?? 0, mrpCents, costCents,
        reorderLevelMilli: reorder ?? 0, openingStockMilli: opening ?? 0, isPinned: YES.has(pinnedRaw),
      });
    }
  });
  return { rows, problems };
}
