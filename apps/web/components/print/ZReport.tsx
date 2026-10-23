'use client';

import { formatAmount } from '@laneos/core';
import { Paper, Row, Rule, ShopHeader, printDate } from './PrintParts';

export interface ZData {
  tenant: string;
  shopName: string;
  shiftNo: number;
  laneCode: string;
  cashier: string;
  openedAt: string;
  closedAt: string | null;
  bills: number;
  salesTotalCents: number;
  promoCents: number;
  cashSalesCents: number;
  cardQrCents: number;
  creditNoteCents: number;
  openingFloatCents: number;
  pickupsCents: number;
  refundsCashCents: number;
  expectedCashCents: number;
  countedCashCents: number | null;
}

const neg = (c: number) => (c ? `-${formatAmount(c)}` : formatAmount(0));

// Z-report printed at shift close (Figma 11-1759).
export function ZReport({ z }: { z: ZData }) {
  const variance = z.countedCashCents == null ? null : z.countedCashCents - z.expectedCashCents;
  return (
    <Paper>
      <ShopHeader name={z.tenant} lines={[z.shopName]} logo={false} />
      <Rule />
      <p className="text-center text-[13px] font-bold">Z-REPORT · SHIFT CLOSE</p>
      <Row label="Shift" value={`#${z.shiftNo} · Lane ${z.laneCode}`} />
      <Row label="Cashier" value={z.cashier} />
      <Row label="Opened" value={printDate(z.openedAt)} />
      <Row label="Closed" value={z.closedAt ? printDate(z.closedAt) : '—'} />
      <Rule />
      <Row label="Bills" value={z.bills} />
      <Row label="Gross sales" value={formatAmount(z.salesTotalCents + z.promoCents)} />
      <Row label="Promotions" value={neg(z.promoCents)} />
      <Row label="Returns (cash)" value={neg(z.refundsCashCents)} />
      <Rule />
      <Row label="Cash (net of change)" value={formatAmount(z.cashSalesCents)} />
      <Row label="Card + LankaQR" value={formatAmount(z.cardQrCents)} />
      <Row label="Credit note used" value={formatAmount(z.creditNoteCents)} />
      <Rule />
      <Row label="Opening float" value={formatAmount(z.openingFloatCents)} />
      <Row label="Pickups to safe" value={neg(z.pickupsCents)} />
      <Row label="Cash refunds" value={neg(z.refundsCashCents)} />
      <Row label="Expected cash" value={formatAmount(z.expectedCashCents)} bold />
      <Row label="Counted cash" value={z.countedCashCents == null ? '—' : formatAmount(z.countedCashCents)} bold />
      <Row label="VARIANCE" value={variance == null ? '—' : `${variance > 0 ? '+' : variance < 0 ? '-' : ''}${formatAmount(Math.abs(variance))}`} big />
      <Rule />
      <p className="mt-4 text-center">Cashier ........  Manager ........</p>
    </Paper>
  );
}
