'use client';

import { useActionState, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { formatQty, type ItemType } from '@laneos/core';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select, chipClass, cn, inputClass } from '@laneos/ui';
import { Dialog } from '@/components/lane/Dialog';
import { approveDamage, decideDamage, reportDamage, type DamageState } from '@/app/(tenant)/backoffice/stock/damage/actions';

const REASONS = [['broken', 'Broken'], ['leaking', 'Leaking'], ['crushed', 'Crushed'], ['expired', 'Expired'], ['pest', 'Pest'], ['temperature', 'Temperature'], ['other', 'Other']] as const;

/** Report damaged stock (left card of Figma 1-1849). */
export function DamageForm({ items }: { items: { id: string; name: string; itemType: ItemType; costCents: number | null }[] }) {
  const [state, action, pending] = useActionState(reportDamage, {} as DamageState);
  const [q, setQ] = useState('');
  const [item, setItem] = useState<(typeof items)[number] | null>(null);
  const [reason, setReason] = useState<string>('broken');
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s.length < 2 || item?.name === q ? [] : items.filter((i) => i.name.toLowerCase().includes(s)).slice(0, 8);
  }, [q, items, item]);

  return (
    <Card className="p-5">
      <form key={state.ok} action={action} className="flex flex-col gap-3.5">
        <CardTitle>Report damaged stock</CardTitle>
        {state.error ? <Alert>{state.error}</Alert> : state.message ? <Alert tone="success">{state.message}</Alert> : null}
        <input type="hidden" name="itemId" value={item?.id ?? ''} />
        <input type="hidden" name="reason" value={reason} />
        <Field label="Item">
          <div className="relative">
            <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" aria-hidden />
            <input value={q} onChange={(e) => { setQ(e.target.value); setItem(null); }} placeholder="Search item" className={cn(inputClass, 'pl-9')} aria-label="Item" />
            {matches.length ? (
              <ul className="absolute z-10 mt-1 w-full rounded-card border border-border bg-surface py-1 shadow-lg">
                {matches.map((m) => (
                  <li key={m.id}><button type="button" className="w-full px-3 py-2 text-left text-[13px] hover:bg-surface-muted" onClick={() => { setItem(m); setQ(m.name); }}>{m.name}</button></li>
                ))}
              </ul>
            ) : null}
          </div>
        </Field>
        <Field label={`Quantity${item?.itemType === 'weighed' ? ' (kg)' : ''}`}>
          <Input name="qty" type="number" min={0.001} step={item?.itemType === 'weighed' ? '0.001' : '1'} required />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold">Reason</span>
          <div className="flex flex-wrap gap-2">
            {REASONS.map(([k, t]) => <button key={k} type="button" onClick={() => setReason(k)} className={chipClass(reason === k)} aria-pressed={reason === k}>{t}</button>)}
          </div>
        </div>
        <Field label="Found during">
          <Select name="source" defaultValue="shelf">
            <option value="shelf">Shelf check</option><option value="count">Stock count</option>
            <option value="grn">Delivery (GRN)</option><option value="transfer">Shop transfer</option>
          </Select>
        </Field>
        <Field label="Note (optional)"><Input name="note" maxLength={500} /></Field>
        <p className="rounded-control border border-dashed border-border-strong p-3 text-xs text-text-muted">Photos (needed above the approval limit) come with the storage task; add details in the note for now.</p>
        <Button type="submit" disabled={pending || !item}>{pending ? 'Saving…' : 'Submit report'}</Button>
      </form>
    </Card>
  );
}

type Decision = 'supplier_return' | 'reduced_sale' | 'write_off' | 'internal_use';
const TITLE: Record<Decision, string> = { supplier_return: 'Return to supplier', reduced_sale: 'Sell at a reduced price', write_off: 'Write off', internal_use: 'Use in store' };

/** Decision links on each report row: Return · Reduce · Write off, or Approve/Reject. */
export function DamageActions({ id, reportNo, remainingMilli, itemType, status, canApprove }: {
  id: string; reportNo: string; remainingMilli: number; itemType: ItemType; status: string; canApprove: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Decision | null>(null);
  const [state, action, pending] = useActionState(async (prev: DamageState, form: FormData) => {
    const r = await decideDamage(prev, form);
    if (!r.error) setOpen(null);
    return r;
  }, {} as DamageState);
  const [error, setError] = useState<string | null>(null);

  if (status === 'awaiting_approval') {
    return canApprove ? (
      <span className="flex items-center gap-3 text-xs font-semibold">
        <button type="button" className="text-brand-primary hover:underline" onClick={async () => { const r = await approveDamage(id, true); if (r.error) setError(r.error); else router.refresh(); }}>Approve</button>
        <button type="button" className="text-danger hover:underline" onClick={async () => { const r = await approveDamage(id, false); if (r.error) setError(r.error); else router.refresh(); }}>Not damaged</button>
        {error ? <span className="text-danger">{error}</span> : null}
      </span>
    ) : <Badge tone="warning">Approval needed</Badge>;
  }
  if (status !== 'awaiting_decision' && status !== 'reported') {
    const s: Record<string, [string, 'info' | 'neutral' | 'success' | 'danger']> = {
      sent_to_supplier: ['Sent to supplier', 'info'], reduced_for_sale: ['Reduced for sale', 'success'],
      written_off: ['Written off', 'neutral'], used_in_store: ['Used in store', 'neutral'], rejected: ['Not damaged', 'neutral'], closed: ['Closed', 'neutral'],
    };
    const [text, tone] = s[status] ?? [status, 'neutral'];
    return <Badge tone={tone}>{text}</Badge>;
  }

  return (
    <>
      <span className="flex gap-3 text-xs font-semibold">
        <button type="button" className="text-brand-primary hover:underline" onClick={() => setOpen('supplier_return')}>Return</button>
        <button type="button" className="text-brand-primary hover:underline" onClick={() => setOpen('reduced_sale')}>Reduce</button>
        <button type="button" className="text-danger hover:underline" onClick={() => setOpen('write_off')}>Write off</button>
      </span>
      {open ? (
        <Dialog title={`${TITLE[open]} · ${reportNo}`} onClose={() => setOpen(null)}>
          <form action={action} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value={open} />
            {state.error ? <Alert>{state.error}</Alert> : null}
            <Field label={`Quantity (${formatQty(remainingMilli, itemType)} left)`}>
              <Input name="qty" type="number" min={0.001} step={itemType === 'weighed' ? '0.001' : '1'} max={remainingMilli / 1000} defaultValue={remainingMilli / 1000} required />
            </Field>
            {open === 'reduced_sale' ? <Field label="Reduced price (Rs)" hint="A reduced sticker is queued in Print labels"><Input name="markdown" inputMode="decimal" required autoFocus /></Field> : null}
            {open === 'supplier_return' ? <p className="text-xs text-text-muted">The supplier return note and credit come with purchasing; this records the decision and removes the stock.</p> : null}
            <Button type="submit" variant={open === 'write_off' ? 'danger' : 'primary'} disabled={pending}>{pending ? 'Saving…' : TITLE[open]}</Button>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

