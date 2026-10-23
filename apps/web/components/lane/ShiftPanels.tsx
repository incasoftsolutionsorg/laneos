'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatRs } from '@laneos/core';
import { Alert, Button, Switch, buttonClass } from '@laneos/ui';
import { openShift } from '@/app/(lane)/lane/actions';
import { DenominationTable, denomsTotal, type Denoms } from './Denominations';

const when = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

// Open shift (Figma 11-2885): count the float by note, optionally reserve invoice numbers for offline use.
export function OpenShiftCard({ laneId, laneCode, cashier }: { laneId: string; laneCode: string; cashier: string }) {
  const router = useRouter();
  const [denoms, setDenoms] = useState<Denoms>({});
  const [reserve, setReserve] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = denomsTotal(denoms);

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto bg-[#2b3a4a] p-6 sm:pt-14">
      <div className="flex w-full max-w-[560px] flex-col gap-4 rounded-dialog bg-surface p-7 shadow-[0_8px_24px_rgba(15,23,41,0.12)]">
        <div>
          <h1 className="text-[22px] font-bold">Open shift</h1>
          <p className="mt-1 text-[13px] text-text-muted">Lane {laneCode} · {cashier} · {when(new Date())}</p>
        </div>
        <DenominationTable value={denoms} onChange={setDenoms} />
        <div className="flex justify-between text-[13px] font-semibold">
          <span>Opening float</span><span className="tabular-nums">{formatRs(total)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-[13px] font-semibold">
          Reserve 200 invoice numbers for offline use
          <Switch on={reserve} onChange={setReserve} label="Reserve invoice numbers for offline use" />
        </div>
        {error ? <Alert>{error}</Alert> : null}
        <div className="flex gap-3">
          <Link href="/lane" className={buttonClass('secondary')}>Cancel</Link>
          <div className="flex-1" />
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await openShift({ laneId, floatCents: total, denoms, reserve: reserve ? 200 : 0 });
              setBusy(false);
              if (r.error) setError(r.error);
              else router.refresh();
            }}
          >
            {busy ? 'Opening…' : 'Open shift & start selling'}
          </Button>
        </div>
      </div>
    </div>
  );
}
