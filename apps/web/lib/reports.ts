import 'server-only';
import { formatRs } from '@laneos/core';
import type { requireTenant } from '@/lib/server/context';
import { colomboToday } from '@/lib/server/dates';

// Report tabs (Figma 1-4536). Each tab is one call to api.report and one table; the CSV export uses
// the same table with plain numbers.

type Ctx = Awaited<ReturnType<typeof requireTenant>>;

export const REPORT_TABS = {
  sales: 'Sales', margin: 'Margin', items: 'Items', stock: 'Stock', damage: 'Damage & wastage', shrinkage: 'Shrinkage', expiry: 'Expiry',
  promotions: 'Promotions', 'credit-notes': 'Credit notes', tax: 'Tax',
} as const;
export type ReportKey = keyof typeof REPORT_TABS;

export type ColKind = 'text' | 'money' | 'pct' | 'int' | 'qty';
export interface ReportTable { cols: { label: string; kind: ColKind }[]; rows: (string | number | null)[][] }

const REASON: Record<string, string> = {
  broken: 'Broken', leaking: 'Leaking', crushed: 'Crushed', pest: 'Pests', expired: 'Expired', temperature: 'Temperature (cold chain)', other: 'Other',
};
const CLASS: Record<string, string> = { standard: 'Standard', exempt: 'Exempt', zero: 'Zero rated' };
const PROMO_KIND: Record<string, string> = { multi_buy: 'Multi-buy', mix_match: 'Mix & match', percent_off: 'Item discount', threshold: 'Spend X' };

/** "from"/"to" from the URL, or this month so far (Colombo days). */
export function readRange(from?: string, to?: string) {
  const today = colomboToday();
  const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  const t = ok(to) && to! <= today ? to! : today;
  const f = ok(from) && from! <= t ? from! : `${t.slice(0, 8)}01`;
  return { from: f, to: t };
}

export async function loadReport(ctx: Ctx, key: ReportKey, from: string, to: string) {
  const kind = key === 'credit-notes' ? 'credit_notes' : key;
  const { data, error } = await ctx.supabase.schema('api').rpc('report', { p_shop: ctx.shop.id, p_kind: kind, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return data as unknown;
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

/** The table for a tab — rendered on the page and exported as CSV. */
export function reportTable(key: ReportKey, data: unknown): ReportTable {
  switch (key) {
    case 'sales': {
      const d = data as SalesData;
      const total = d.rows.reduce((s, r) => s + r.sales, 0);
      return {
        cols: [{ label: 'Category', kind: 'text' }, { label: 'Sales', kind: 'money' }, { label: 'Share', kind: 'pct' }, { label: 'Margin', kind: 'pct' }, { label: 'Wastage', kind: 'money' }],
        rows: d.rows.map((r) => [r.name, r.sales, pct(r.sales, total), pct(r.margin, r.sales), r.wastage]),
      };
    }
    case 'margin': {
      const rows = data as ItemRow[];
      return {
        cols: [{ label: 'Item', kind: 'text' }, { label: 'Sales', kind: 'money' }, { label: 'Cost', kind: 'money' }, { label: 'Margin', kind: 'money' }, { label: 'Margin %', kind: 'pct' }],
        rows: rows.map((r) => [r.name, r.sales, r.cost, r.sales - r.cost, pct(r.sales - r.cost, r.sales)]),
      };
    }
    case 'items': {
      const rows = data as ItemRow[];
      return {
        cols: [{ label: 'Item', kind: 'text' }, { label: 'Qty sold', kind: 'qty' }, { label: 'Bills', kind: 'int' }, { label: 'Promotions', kind: 'money' }, { label: 'Sales', kind: 'money' }],
        rows: rows.map((r) => [r.name, r.qtyMilli, r.bills, r.promo, r.sales]),
      };
    }
    case 'stock': {
      const rows = data as StockRow[];
      return {
        cols: [{ label: 'Department', kind: 'text' }, { label: 'Items', kind: 'int' }, { label: 'Stock value (cost)', kind: 'money' }, { label: 'Damaged value', kind: 'money' }, { label: 'Low stock', kind: 'int' }, { label: 'Below zero', kind: 'int' }],
        rows: rows.map((r) => [r.name, r.items, r.value, r.damagedValue, r.low, r.negative]),
      };
    }
    case 'damage': {
      const d = data as DamageData;
      return {
        cols: [{ label: 'Reason', kind: 'text' }, { label: 'Reports', kind: 'int' }, { label: 'Quantity', kind: 'qty' }, { label: 'Value (cost)', kind: 'money' }],
        rows: d.byReason.map((r) => [REASON[r.reason] ?? r.reason, r.reports, r.qtyMilli, r.value]),
      };
    }
    case 'shrinkage': {
      const d = data as ShrinkData;
      return {
        cols: [{ label: 'Item', kind: 'text' }, { label: 'Department', kind: 'text' }, { label: 'Count difference', kind: 'qty' }, { label: 'Value (cost)', kind: 'money' }],
        rows: d.rows.map((r) => [r.name, r.department, r.qtyMilli, r.value]),
      };
    }
    case 'expiry': {
      const d = data as ExpiryData;
      return {
        cols: [{ label: 'Item', kind: 'text' }, { label: 'How', kind: 'text' }, { label: 'Quantity', kind: 'qty' }, { label: 'Value (cost)', kind: 'money' }],
        rows: d.rows.map((r) => [r.name, r.source, r.qtyMilli, r.value]),
      };
    }
    case 'promotions': {
      const rows = data as PromoRow[];
      return {
        cols: [{ label: 'Promotion', kind: 'text' }, { label: 'Type', kind: 'text' }, { label: 'Bills', kind: 'int' }, { label: 'Units', kind: 'qty' },
          { label: 'Sales', kind: 'money' }, { label: 'Discount given', kind: 'money' }, { label: 'Margin left', kind: 'money' }],
        rows: rows.map((r) => [r.name, PROMO_KIND[r.kind] ?? r.kind, r.bills, r.qtyMilli, r.sales, r.discount, r.margin]),
      };
    }
    case 'credit-notes': {
      const d = data as NotesData;
      return {
        cols: [{ label: 'Measure', kind: 'text' }, { label: 'Amount', kind: 'money' }],
        rows: [['Issued in period', d.issued], ['Redeemed in period', d.redeemed], ['Outstanding now', d.outstanding], ['Expired, never used', d.expired]],
      };
    }
    case 'tax': {
      const d = data as TaxData;
      return {
        cols: [{ label: 'Tax class', kind: 'text' }, { label: 'Rate', kind: 'pct' }, { label: 'Sales', kind: 'money' }, { label: d.included ? 'VAT included' : 'VAT', kind: 'money' }],
        rows: d.rows.map((r) => [CLASS[r.taxClass] ?? r.taxClass, r.rateBp / 100, r.sales, r.vat]),
      };
    }
  }
}

export function formatCell(v: string | number | null, kind: ColKind): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  switch (kind) {
    case 'money': return formatRs(v, { decimals: 0 });
    case 'pct': return `${v}%`;
    case 'qty': return (v / 1000).toLocaleString('en-LK', { maximumFractionDigits: 3 });
    default: return v.toLocaleString('en-LK');
  }
}

export function toCsv(t: ReportTable): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  // Formula injection: a cell starting with = + - @ is opened as a formula by spreadsheets.
  const safe = (s: string) => (/^[=+\-@]/.test(s) ? `'${s}` : s);
  const cell = (v: string | number | null, kind: ColKind) =>
    v == null ? '' : typeof v === 'string' ? esc(safe(v)) : kind === 'money' ? (v / 100).toFixed(2) : kind === 'qty' ? String(v / 1000) : String(v);
  return [t.cols.map((c) => esc(c.label)).join(','), ...t.rows.map((r) => r.map((v, i) => cell(v, t.cols[i]!.kind)).join(','))].join('\r\n');
}

export interface SalesData {
  days: { day: string; net: number; bills: number }[];
  totals: { net: number; bills: number; returns: number; promo: number; lineSales: number; margin: number; wastage: number; wholesale: number };
  rows: { name: string; sales: number; margin: number; wastage: number }[];
}
export interface ItemRow { itemId: string; name: string; qtyMilli: number; sales: number; cost: number; bills: number; promo: number; lastSold: string }
export interface StockRow { name: string; items: number; value: number; damagedValue: number; low: number; negative: number }
export interface DamageData { byReason: { reason: string; reports: number; qtyMilli: number; value: number }[]; wastage: number; pending: number }
export interface ShrinkData { loss: number; gain: number; rows: { itemId: string; name: string; department: string; qtyMilli: number; value: number }[] }
export interface ExpiryData { value: number; rows: { itemId: string; name: string; qtyMilli: number; value: number; source: string }[] }
export interface PromoRow { id: string; name: string; kind: string; bills: number; qtyMilli: number | null; sales: number; discount: number; margin: number | null }
export interface NotesData { issued: number; issuedCount: number; redeemed: number; outstanding: number; expired: number }
export interface TaxData { registered: boolean; vatNo: string | null; included: boolean; rows: { taxClass: string; rateBp: number; sales: number; vat: number }[] }
