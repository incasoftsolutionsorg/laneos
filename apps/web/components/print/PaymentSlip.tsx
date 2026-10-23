'use client';

import { formatRs } from '@laneos/core';
import { Paper, Row, Rule, ShopHeader, printDate } from './PrintParts';

export interface PaymentSlipData {
  tenant: string;
  shop: { name: string; address?: string | null; phone?: string | null };
  customer: string;
  amountCents: number;
  method: string;
  reference?: string | null;
  balanceCents: number;
  at: string;
  by: string;
}

// Receipt for money received from a credit customer (Figma 1-3034 "Record payment & print").
export function PaymentSlip({ p }: { p: PaymentSlipData }) {
  return (
    <Paper>
      <ShopHeader name={p.tenant} lines={[p.shop.address, p.shop.phone ? `Tel ${p.shop.phone}` : null, p.shop.name]} />
      <Rule />
      <p className="text-center text-[15px] font-bold">PAYMENT RECEIVED</p>
      <Rule />
      <Row label="Date" value={printDate(p.at)} />
      <Row label="Customer" value={p.customer} />
      <Row label="Method" value={`${p.method}${p.reference ? ` · ${p.reference}` : ''}`} />
      <Row label="Received by" value={p.by} />
      <Rule />
      <Row label="AMOUNT" value={formatRs(p.amountCents)} big />
      <Row label="Balance now due" value={formatRs(p.balanceCents)} bold />
      <Rule />
      <p className="text-center">Thank you for your payment.</p>
    </Paper>
  );
}
