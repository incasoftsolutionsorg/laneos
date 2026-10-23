'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { formatRs } from '@laneos/core';
import { Alert, Button, Card, CardTitle, Field, Input, buttonClass, cn } from '@laneos/ui';
import { receivePayment, updateCreditLimit } from '@/app/(tenant)/backoffice/customers/actions';
import { printJob } from '@/lib/lane/print';

const METHODS = [['cash', 'Cash'], ['bank', 'Bank'], ['cheque', 'Cheque']] as const;

export interface PanelCustomer {
  id: string; name: string; phone: string; creditLimitCents: number; balanceCents: number; oldest: string | null;
}

/** Selected customer: balance, receive payment, print statement (Figma 1-3034 right panel). */
export function CustomerPanel({
  c, canManage, print,
}: {
  c: PanelCustomer; canManage: boolean;
  print: { tenant: string; shop: { name: string; address?: string | null; phone?: string | null }; by: string };
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<(typeof METHODS)[number][0]>('cash');
  const [reference, setReference] = useState('');
  const [limit, setLimit] = useState(String(c.creditLimitCents / 100));
  const [editLimit, setEditLimit] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const record = (andPrint: boolean) => start(async () => {
    setMsg(null);
    const r = await receivePayment(c.id, amount, method, reference);
    if (r.error) return setMsg({ tone: 'danger', text: r.error });
    setMsg({ tone: 'success', text: `${formatRs(r.ok!.amountCents)} received. Balance now ${formatRs(r.ok!.balanceCents)}.` });
    if (andPrint) {
      printJob({ kind: 'payment', payment: {
        ...print, customer: c.name, amountCents: r.ok!.amountCents, method: METHODS.find((m) => m[0] === method)![1],
        reference: reference || null, balanceCents: r.ok!.balanceCents, at: r.ok!.at,
      } });
    }
    setAmount(''); setReference('');
  });

  return (
    <Card id="pay" className="flex flex-col gap-3 p-5 xl:w-[340px]">
      <CardTitle>{c.name}</CardTitle>
      <Line label="Credit limit" value={c.creditLimitCents > 0 ? formatRs(c.creditLimitCents, { decimals: 0 }) : 'Cash only'}
        action={canManage ? <button type="button" className="text-xs font-semibold text-brand-primary hover:underline" onClick={() => setEditLimit((v) => !v)}>Change</button> : null} />
      {editLimit ? (
        <form className="flex items-end gap-2" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await updateCreditLimit(c.id, limit);
            if (r.error) setMsg({ tone: 'danger', text: r.error }); else setEditLimit(false);
          });
        }}>
          <Field label="New limit (Rs)" className="flex-1"><Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" autoFocus /></Field>
          <Button type="submit" variant="secondary" disabled={pending}>Save</Button>
        </form>
      ) : null}
      <Line label="Balance due" value={formatRs(c.balanceCents, { decimals: 0 })} strong />
      <Line label="Oldest unpaid bill" value={c.oldest ?? '—'} />

      {canManage && c.balanceCents > 0 ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <Field label="Receive payment">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={`Rs ${formatRs(c.balanceCents, { decimals: 0 }).replace('Rs ', '')}`} />
          </Field>
          <div className="flex w-fit gap-1 rounded-control bg-surface-muted p-1" role="radiogroup" aria-label="Payment method">
            {METHODS.map(([key, label]) => (
              <button key={key} type="button" role="radio" aria-checked={method === key} onClick={() => setMethod(key)}
                className={cn('rounded-md px-3.5 py-1.5 text-xs font-semibold', method === key ? 'bg-surface text-text shadow-sm' : 'text-text-muted')}>
                {label}
              </button>
            ))}
          </div>
          {method !== 'cash' ? (
            <Field label={method === 'cheque' ? 'Cheque number' : 'Bank reference'}>
              <Input value={reference} onChange={(e) => setReference(e.target.value.slice(0, 40))} />
            </Field>
          ) : null}
          {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
          <Button disabled={pending || !amount} onClick={() => record(true)}>{pending ? 'Saving…' : 'Record payment & print'}</Button>
        </div>
      ) : msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Link href={`/print/statement/${c.id}`} target="_blank" className={buttonClass('secondary')}>Print statement</Link>
    </Card>
  );
}

function Line({ label, value, strong, action }: { label: string; value: string; strong?: boolean; action?: React.ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 text-[13px]', strong && 'font-semibold')}>
      <span className={strong ? '' : 'text-text-muted'}>{label}</span>
      <span className="flex items-center gap-2 tabular-nums">{value}{action}</span>
    </div>
  );
}
