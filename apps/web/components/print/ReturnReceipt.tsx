'use client';

import { formatAmount, formatRs } from '@laneos/core';
import { Code128, Paper, Row, Rule, ShopHeader, printDate } from './PrintParts';

export interface ReturnReceiptData {
  tenant: string;
  shop: { name: string; address?: string | null; phone?: string | null };
  returnNo: string;
  invoiceNo: string;
  at: string;
  lane: string;
  cashier: string;
  customer?: string | null;
  lines: { name: string; qtyLabel: string; amountCents: number; reason: string; damaged: boolean }[];
  totalCents: number;
  settlement: string;
  creditNoteNo?: string | null;
}

const HOW: Record<string, string> = {
  cash: 'Cash refunded', original: 'Refunded to card / LankaQR', exchange: 'Exchange credit note', credit_note: 'Credit note issued', credit_balance: 'Off credit balance',
};

// Return receipt, 80 mm (Figma 11-1680 — frame not read; built from the receipt and credit-note slip, compare when Figma access returns).
export function ReturnReceipt({ r }: { r: ReturnReceiptData }) {
  return (
    <Paper>
      <ShopHeader name={r.tenant} lines={[r.shop.address, r.shop.phone ? `Tel ${r.shop.phone}` : null, r.shop.name]} />
      <Rule />
      <p className="text-center text-[15px] font-bold">RETURN</p>
      <Rule />
      <Row label="Return no" value={r.returnNo} />
      <Row label="Original invoice" value={r.invoiceNo} />
      <Row label="Date" value={printDate(r.at)} />
      <Row label="Lane / Cashier" value={`${r.lane} · ${r.cashier}`} />
      {r.customer ? <Row label="Customer" value={r.customer} /> : null}
      <Rule />
      {r.lines.map((l, i) => (
        <div key={i}>
          <p className="font-bold">{l.name}</p>
          <Row label={`  ${l.qtyLabel} · ${l.reason}${l.damaged ? ' · damaged' : ''}`} value={`-${formatAmount(l.amountCents)}`} />
        </div>
      ))}
      <Rule />
      <Row label="TOTAL RETURNED" value={formatRs(r.totalCents)} big />
      <Row label={HOW[r.settlement] ?? r.settlement} value={r.creditNoteNo ?? ''} bold />
      <Rule />
      <p className="mt-6">Customer signature</p>
      <p className="tracking-[-0.05em]">................................</p>
      <div className="mt-2 flex justify-center"><Code128 value={r.returnNo} /></div>
    </Paper>
  );
}
