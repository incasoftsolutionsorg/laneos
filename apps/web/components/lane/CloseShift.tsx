'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatRs } from '@laneos/core';
import { Alert, Button, Card, CardTitle, Field, Input, PageHeader, StatCard, cn } from '@laneos/ui';
import { cashPickup, closeShift } from '@/app/(lane)/lane/actions';
import { listQueue } from '@/lib/lane/device';
import { clearHeld } from '@/lib/lane/held';
import { printJob } from '@/lib/lane/print';
import type { ZData } from '@/components/print/ZReport';
import { Dialog } from './Dialog';
import { DenominationTable, denomsTotal, type Denoms } from './Denominations';

export interface ShiftSummary extends ZData {
  shiftId: string;
  laneId: string;
  cashBills: number;
  cardQrBills: number;
  refundsCashCount: number;
  pickupsCount: number;
}

const hhmm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

// Close shift (Figma 1-4331): count the drawer, see the variance, close and print the Z-report.
export function CloseShift({ s, canPickup }: { s: ShiftSummary; canPickup: boolean }) {
  const router = useRouter();
  const [denoms, setDenoms] = useState<Denoms>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickup, setPickup] = useState(false);
  const [queued, setQueued] = useState(0);
  const counted = denomsTotal(denoms);
  const variance = counted - s.expectedCashCents;

  useEffect(() => { listQueue(s.laneId).then((q) => setQueued(q.length)).catch(() => undefined); }, [s.laneId]);

  const close = async () => {
    if (queued) return setError(`${queued} offline ${queued === 1 ? 'sale is' : 'sales are'} still waiting to sync on this lane. Reconnect before closing.`);
    if (variance !== 0 && note.trim().length < 3) return setError('Add a note explaining the variance.');
    setBusy(true); setError(null);
    const r = await closeShift({ shiftId: s.shiftId, countedCents: counted, denoms, note });
    setBusy(false);
    if (r.error || !r.result) return setError(r.error ?? 'Could not close the shift.');
    clearHeld(s.laneId);
    printJob({ kind: 'z', z: { ...s, closedAt: new Date().toISOString(), countedCashCents: counted, expectedCashCents: r.result.expectedCashCents } });
    router.replace(`/lane/${s.laneId}`);
  };

  return (
    <>
      <PageHeader
        title="Close shift"
        subtitle={`Lane ${s.laneCode} · ${s.cashier} · opened ${hhmm(s.openedAt)}`}
        actions={
          <div className="flex gap-3">
            {canPickup ? <Button variant="secondary" onClick={() => setPickup(true)}>Cash pickup</Button> : null}
            <Button onClick={close} disabled={busy}>{busy ? 'Closing…' : 'Close shift & print Z-report'}</Button>
          </div>
        }
      />
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Cash sales" value={formatRs(s.cashSalesCents, { decimals: 0 })} delta={`${s.cashBills} bills`} note="in this shift" />
        <StatCard label="Card & LankaQR" value={formatRs(s.cardQrCents, { decimals: 0 })} delta={`${s.cardQrBills} bills`} note="reference only" />
        <StatCard label="Refunds (cash)" value={formatRs(s.refundsCashCents, { decimals: 0 })} delta={`${s.refundsCashCount} ${s.refundsCashCount === 1 ? 'refund' : 'refunds'}`} note="from the drawer" />
        <StatCard label="Pickups" value={formatRs(s.pickupsCents, { decimals: 0 })} delta={`${s.pickupsCount} ${s.pickupsCount === 1 ? 'pickup' : 'pickups'}`} note="to safe" />
      </section>
      <section className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <Card className="flex min-w-0 flex-1 flex-col gap-3.5 p-5">
          <CardTitle>Count the drawer</CardTitle>
          <DenominationTable value={denoms} onChange={setDenoms} />
        </Card>
        <Card className="flex flex-col gap-3 p-5 xl:w-[380px]">
          <CardTitle>Shift result</CardTitle>
          <Line label="Opening float" value={formatRs(s.openingFloatCents)} />
          <Line label="Expected cash" value={formatRs(s.expectedCashCents)} />
          <Line label="Counted cash" value={formatRs(counted)} />
          <div className="h-px bg-border" />
          <div className={cn('flex items-center justify-between rounded-card p-4', variance === 0 ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
            <span className="text-[13px] font-semibold">Variance</span>
            <span className="text-2xl font-bold">{variance === 0 ? 'Balanced' : `${variance > 0 ? '+' : '−'} ${formatRs(Math.abs(variance))}`}</span>
          </div>
          <Field label="Note for variance"><Input value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder="Customer change error at 4:10 pm" /></Field>
          {error ? <Alert>{error}</Alert> : null}
          <Button onClick={close} disabled={busy}>{busy ? 'Closing…' : 'Close shift & print Z-report'}</Button>
        </Card>
      </section>
      {pickup ? <PickupDialog shiftId={s.shiftId} onClose={() => { setPickup(false); router.refresh(); }} /> : null}
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-[13px]"><span className="text-text-muted">{label}</span><span className="font-medium tabular-nums">{value}</span></div>;
}

function PickupDialog({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Cash pickup" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        const r = await cashPickup(shiftId, amount, note);
        setBusy(false);
        if (r.error) setError(r.error); else onClose();
      }}>
        <p className="text-[13px] text-text-muted">Cash taken from the drawer to the safe. It lowers the expected cash at close.</p>
        {error ? <Alert>{error}</Alert> : null}
        <Field label="Amount (Rs)"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus /></Field>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} /></Field>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record pickup'}</Button>
      </form>
    </Dialog>
  );
}
