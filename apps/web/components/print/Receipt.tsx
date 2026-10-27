'use client';

import { formatAmount, formatRs } from '@laneos/core';
import { Code128, Paper, Qr, Row, Rule, ShopHeader, printDate } from './PrintParts';

export interface ReceiptData {
  tenant: string;
  shop: { name: string; address?: string | null; phone?: string | null };
  invoiceNo: string;
  createdAt: string;
  lane: string;
  cashier: string;
  customer?: string | null;
  lines: { name: string; qtyLabel: string; unitCents: number; amountCents: number; promo?: { name: string; cents: number } | null }[];
  itemCount: number;
  subtotalCents: number;
  savedCents: number;
  roundingCents: number;
  totalCents: number;
  payments: { label: string; amountCents: number }[];
  changeCents: number;
  receiptUrl?: string | null;
  /** Loyalty points on this bill (online sales with a member attached). */
  loyalty?: { earned: number; redeemed: number; balance: number } | null;
  offline?: boolean;
  /** Settings → Receipt & printer (Figma 1-4145). */
  settings?: ReceiptSettings;
}

export interface ReceiptSettings { paper: string; header: string | null; footer: string; logo: boolean; vatNo: string | null; logoUrl?: string | null }

// 80 mm sales receipt, logo left (Figma 11-285); 58 mm uses the same layout on a narrower roll.
export function Receipt({ r }: { r: ReceiptData }) {
  const s = r.settings;
  const title = s?.vatNo ? 'TAX INVOICE' : 'RECEIPT';
  return (
    <Paper width={s?.paper === '58mm' ? '48mm' : '72mm'}>
      <ShopHeader name={s?.header || r.tenant} logo={s?.logo ?? true} logoUrl={s?.logoUrl} lines={[r.shop.address, r.shop.phone ? `Tel ${r.shop.phone}` : null, s?.header ? null : r.shop.name]} />
      <Rule />
      <p className="text-center font-bold">{r.offline ? `${title} (OFFLINE — SYNC PENDING)` : title}</p>
      {s?.vatNo ? <Row label="VAT reg. no" value={s.vatNo} /> : null}
      <Row label="Invoice" value={r.invoiceNo} />
      <Row label="Date" value={printDate(r.createdAt)} />
      <Row label="Lane / Cashier" value={`${r.lane} · ${r.cashier}`} />
      {r.customer ? <Row label="Customer" value={r.customer} /> : null}
      <Rule />
      {r.lines.map((l, i) => (
        <div key={i}>
          <p className="font-bold">{l.name}</p>
          <Row label={`  ${l.qtyLabel} x ${formatAmount(l.unitCents)}`} value={formatAmount(l.amountCents)} />
          {l.promo ? <Row label={`  ${l.promo.name}`} value={`-${formatAmount(l.promo.cents)}`} /> : null}
        </div>
      ))}
      <Rule />
      <Row label="Items" value={r.itemCount} />
      <Row label="Subtotal" value={formatAmount(r.subtotalCents)} />
      {r.savedCents ? <Row label="You saved" value={formatAmount(r.savedCents)} /> : null}
      {r.roundingCents ? <Row label="Rounding" value={`${r.roundingCents > 0 ? '+' : '-'}${formatAmount(Math.abs(r.roundingCents))}`} /> : null}
      <Rule />
      <Row label="TOTAL" value={formatRs(r.totalCents)} big />
      <Rule />
      {r.payments.map((p, i) => <Row key={i} label={p.label} value={formatAmount(p.amountCents)} />)}
      <Row label="Change" value={formatAmount(r.changeCents)} />
      {r.loyalty ? (
        <>
          <Rule />
          {r.loyalty.redeemed ? <Row label="Points used" value={`-${r.loyalty.redeemed}`} /> : null}
          <Row label="Points earned" value={`+${r.loyalty.earned}`} />
          <Row label="Points balance" value={r.loyalty.balance} bold />
        </>
      ) : null}
      <Rule />
      {s?.footer ? <p className="text-center font-bold">{s.footer}</p> : (
        <>
          <p className="text-center font-bold">Thank you for shopping with us!</p>
          <p className="text-center">Keep this receipt for returns.</p>
        </>
      )}
      <div className="mt-2 flex items-center justify-center gap-3">
        {r.receiptUrl ? <Qr text={r.receiptUrl} size={72} /> : null}
        <div className="flex flex-col items-center">
          <Code128 value={r.invoiceNo} />
          <span className="text-[10px]">{r.invoiceNo}</span>
        </div>
      </div>
      {r.receiptUrl ? <p className="mt-1 text-center text-[10px]">Scan for digital receipt</p> : null}
      <p className="text-center text-[10px]">Powered by LaneOS</p>
    </Paper>
  );
}
