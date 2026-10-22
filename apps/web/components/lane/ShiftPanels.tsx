'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { formatRs } from '@laneos/core';
import { Alert, Button, Card, Field, Input } from '@laneos/ui';
import { closeShift, openShift, type ShiftState } from '@/app/(lane)/lane/actions';
import { Dialog } from './Dialog';

const initial: ShiftState = {};

export function OpenShiftCard({ laneId, laneName }: { laneId: string; laneName: string }) {
  const [state, action, pending] = useActionState(openShift, initial);
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm p-6">
        <form action={action} className="flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-bold">Open a shift</h1>
            <p className="mt-1 text-[13px] text-text-muted">{laneName} has no open shift. Count the float in the drawer to start selling.</p>
          </div>
          {state.error ? <Alert>{state.error}</Alert> : null}
          <input type="hidden" name="laneId" value={laneId} />
          <Field label="Opening float (Rs)"><Input name="float" inputMode="decimal" defaultValue="5,000.00" autoFocus /></Field>
          <Button type="submit" disabled={pending}>{pending ? 'Opening…' : 'Open shift'}</Button>
        </form>
      </Card>
    </div>
  );
}

export function CloseShiftDialog({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(closeShift, initial);
  const router = useRouter();

  if (state.result) {
    const v = state.result.varianceCents;
    return (
      <Dialog title="Shift closed" onClose={() => router.refresh()}>
        <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
          <dt className="text-text-muted">Expected cash</dt><dd className="text-right font-semibold">{formatRs(state.result.expectedCashCents)}</dd>
          <dt className="text-text-muted">Counted</dt><dd className="text-right font-semibold">{formatRs(state.result.countedCashCents)}</dd>
          <dt className="text-text-muted">Variance</dt>
          <dd className={v === 0 ? 'text-right font-bold text-success' : 'text-right font-bold text-danger'}>
            {v === 0 ? 'Balanced' : `${v > 0 ? 'Over' : 'Short'} ${formatRs(Math.abs(v))}`}
          </dd>
        </dl>
        <Button onClick={() => router.refresh()}>Done</Button>
      </Dialog>
    );
  }

  return (
    <Dialog title="Close shift" onClose={onClose}>
      <form action={action} className="flex flex-col gap-4">
        <p className="text-[13px] text-text-muted">Count all cash in the drawer, including the float.</p>
        {state.error ? <Alert>{state.error}</Alert> : null}
        <input type="hidden" name="shiftId" value={shiftId} />
        <Field label="Counted cash (Rs)"><Input name="counted" inputMode="decimal" required /></Field>
        <Button type="submit" variant="danger" disabled={pending}>{pending ? 'Closing…' : 'Close shift'}</Button>
      </form>
    </Dialog>
  );
}
