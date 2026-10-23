'use client';

import { formatRs } from '@laneos/core';
import { Code128, Paper, Qr, Row, Rule, ShopHeader, printDate } from './PrintParts';

export interface CreditNoteData {
  tenant: string;
  shop: { name: string; address?: string | null; phone?: string | null };
  noteNo: string;
  code: string;
  amountCents: number;
  expiresOn: string;
  issuedAt: string;
  lane: string;
  returnNo: string;
  invoiceNo: string;
  customer?: string | null;
}

// Credit note slip (Figma 11-1635, blueprint §30.2). The code is printed once and never stored.
export function CreditNoteSlip({ n }: { n: CreditNoteData }) {
  const valid = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(n.expiresOn));
  return (
    <Paper>
      <ShopHeader name={n.tenant} lines={[n.shop.address, n.shop.phone ? `Tel ${n.shop.phone}` : null, n.shop.name]} />
      <Rule />
      <p className="text-center text-[15px] font-bold">CREDIT NOTE</p>
      <p className="text-center">ණය පත · கடன் குறிப்பு</p>
      <Rule />
      <Row label="Credit note no" value={n.noteNo} />
      <Row label="Issued" value={`${printDate(n.issuedAt)} · ${n.lane}`} />
      <Row label="Against return" value={n.returnNo} />
      <Row label="Original invoice" value={n.invoiceNo} />
      {n.customer ? <Row label="Customer" value={n.customer} /> : null}
      <Rule />
      <Row label="AMOUNT" value={formatRs(n.amountCents)} big />
      <Row label="Valid until" value={valid} bold />
      <Rule />
      <div className="flex items-center gap-3">
        <Qr text={n.code} size={84} />
        <div>
          <p className="text-[13px] font-bold">{n.code}</p>
          <p>Use as payment at any {n.tenant} shop.</p>
        </div>
      </div>
      <Rule />
      <p className="text-center">Not exchangeable for cash.</p>
      <p className="text-center">Lost slips replaced only with the registered phone number.</p>
      <div className="mt-2"><Code128 value={n.code.replace(/-/g, '')} /></div>
    </Paper>
  );
}
