'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { formatRs, parseRupees } from '@laneos/core';
import { Alert, Button, Card, Field, Input, tabClass, tabsClass } from '@laneos/ui';
import { paySupplier } from '@/app/(tenant)/backoffice/purchasing/actions';

export interface OpenGrn { id: string; grnNo: string; receivedOn: string; dueOn: string | null; openCents: number }

const dm = (d: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(`${d}T00:00:00+05:30`));

// Pay supplier (Figma 11-3921): the amount is spread over open GRNs, oldest first.
export function PaySupplier({ supplier, grns, limitCents, isOwner }: {
  supplier: { id: string; name: string; balanceCents: number }; grns: OpenGrn[]; limitCents: number; isOwner: boolean;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<'cash' | 'bank_transfer' | 'cheque'>('bank_transfer');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cents = parseRupees(amount || '0') ?? 0;
  const allocations = useMemo(() => {
    let left = cents;
    return grns.map((g) => { const pay = Math.min(left, g.openCents); left -= pay; return { grnId: g.id, amountCents: pay }; });
  }, [cents, grns]);
  const open = grns.reduce((s, g) => s + g.openCents, 0);
  const needsApproval = cents > limitCents && !isOwner;

  const submit = async () => {
    if (!cents) return setError('Enter the amount.');
    if (method === 'cheque' && !reference) return setError('Enter the cheque number.');
    setBusy(true); setError(null);
    const r = await paySupplier({
      supplierId: supplier.id, method, reference: reference || undefined, chequeDate: method === 'cheque' ? chequeDate || null : null,
      amountCents: cents, allocations: allocations.filter((a) => a.amountCents > 0),
    });
    setBusy(false);
    if (r.error) return setError(r.error);
    setDone(r.status === 'pending_approval' ? 'Sent to the owner for approval.' : 'Payment recorded.');
    setAmount(''); setReference('');
    router.refresh();
  };

  return (
    <Card className="flex max-w-[640px] flex-col gap-4 p-7">
      <div>
        <h2 className="text-[22px] font-bold">Pay supplier</h2>
        <p className="mt-1 text-[13px] text-text-muted">{supplier.name} · payable {formatRs(supplier.balanceCents)}</p>
      </div>
      <div className="overflow-hidden rounded-card border border-border">
        <table className="w-full text-left text-[13px]">
          <thead><tr className="bg-surface-muted text-[11px] font-semibold text-text-muted"><th className="px-4 py-2.5">GRN</th><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Due</th><th className="px-4 py-2.5">Open</th><th className="px-4 py-2.5">Pay</th></tr></thead>
          <tbody>
            {grns.map((g, i) => (
              <tr key={g.id} className="border-t border-border">
                <td className="px-4 py-2.5 font-mono text-xs">{g.grnNo}</td><td className="px-4 py-2.5">{dm(g.receivedOn)}</td>
                <td className="px-4 py-2.5">{g.dueOn ? dm(g.dueOn) : '—'}</td><td className="px-4 py-2.5 tabular-nums">{formatRs(g.openCents)}</td>
                <td className="px-4 py-2.5 tabular-nums">{allocations[i]!.amountCents ? formatRs(allocations[i]!.amountCents) : '—'}</td>
              </tr>
            ))}
            {grns.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-text-muted">No open GRNs. A payment now is an advance on account.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className={tabsClass()} role="tablist">
        {([['cash', 'Cash'], ['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque']] as const).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={method === k} className={tabClass(method === k)} onClick={() => setMethod(k)}>{t}</button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {method !== 'cash' ? <Field label={method === 'cheque' ? 'Cheque no.' : 'Transfer ref'}><Input value={reference} onChange={(e) => setReference(e.target.value.slice(0, 40))} /></Field> : null}
        {method === 'cheque' ? <Field label="Cheque date"><Input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} /></Field> : null}
        <Field label="Amount"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={`Rs ${(open / 100).toFixed(2)}`} /></Field>
      </div>
      {needsApproval ? <p className="text-xs font-semibold text-warning">Payments above {formatRs(limitCents, { decimals: 0 })} need the owner&apos;s approval.</p> : null}
      {error ? <Alert>{error}</Alert> : done ? <Alert tone="success">{done}</Alert> : null}
      <div className="flex justify-end">
        <Button onClick={submit} disabled={busy || !cents}>{busy ? 'Saving…' : needsApproval ? 'Send for approval' : 'Record payment'}</Button>
      </div>
    </Card>
  );
}
