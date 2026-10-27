'use client';

import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatAmount, formatRs, parseRupees, type PaymentMethod } from '@laneos/core';
import { Alert, Button, Field, Input, Select, chipClass, cn, tabClass, tabsClass } from '@laneos/ui';
import { quickTenders } from '@/lib/lane/cart';
import { checkCreditNote, type CustomerHit } from '@/app/(lane)/lane/actions';
import { Dialog } from '../Dialog';
import type { AppliedNote } from './CustomerDialog';

export interface Tender { method: PaymentMethod; amountCents: number; reference?: string; label: string }

type Mode = PaymentMethod | 'split';

const LABEL: Record<PaymentMethod, string> = { cash: 'Cash', card: 'Card', lankaqr: 'LankaQR', credit_note: 'Credit note', account: 'On account', loyalty: 'Points' };

/** Take payment (Figma 1-1159): cash, card, LankaQR, credit note, on account (named credit customer) or a split. */
export function PaymentDialog({
  totalCents, laneId, offline, initialMode = 'cash', appliedNote, customer, loyalty, onClose, submit,
}: {
  totalCents: number; laneId: string; offline: boolean; initialMode?: Mode; appliedNote?: AppliedNote | null;
  customer?: CustomerHit | null;
  /** Tenant loyalty settings from the lane catalogue. */
  loyalty?: { enabled: boolean; pointValueCents: number; minRedeem: number };
  onClose: () => void;
  submit: (tenders: Tender[], print: boolean) => Promise<string | null>;
}) {
  const noteTender = (n: AppliedNote): Tender =>
    ({ method: 'credit_note', amountCents: Math.min(n.balanceCents, totalCents), reference: n.code, label: `Credit note ${n.noteNo}` });

  const [mode, setMode] = useState<Mode>(appliedNote ? (appliedNote.balanceCents >= totalCents ? 'credit_note' : 'split') : initialMode);
  const [entries, setEntries] = useState<Tender[]>(appliedNote ? [noteTender(appliedNote)] : []);
  const [cashText, setCashText] = useState('');
  const [reference, setReference] = useState('');
  const [noteCode, setNoteCode] = useState(appliedNote?.code ?? '');
  const [note, setNote] = useState<AppliedNote | null>(appliedNote ?? null);
  const [addMethod, setAddMethod] = useState<PaymentMethod>('card');
  const [addAmount, setAddAmount] = useState('');
  const [addRef, setAddRef] = useState('');
  const [print, setPrint] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cashCents = cashText === '' ? 0 : parseRupees(cashText);
  // Server re-checks the limit (BR-041); this only decides whether the tab is offered.
  const creditLeft = customer?.creditLimitCents ? Math.max(0, customer.creditLimitCents - customer.balanceDueCents) : 0;
  const tenders: Tender[] = useMemo(() => {
    switch (mode) {
      case 'cash': return cashCents ? [{ method: 'cash', amountCents: cashCents, label: 'Cash' }] : [];
      case 'card':
      case 'lankaqr': return [{ method: mode, amountCents: totalCents, reference: reference || undefined, label: `${LABEL[mode]}${reference ? ` · ref ${reference}` : ''}` }];
      case 'credit_note': return note ? [noteTender(note)] : [];
      case 'account': return customer && creditLeft >= totalCents ? [{ method: 'account', amountCents: totalCents, label: `On account · ${customer.name}` }] : [];
      case 'split': return [...entries, ...(cashCents ? [{ method: 'cash' as const, amountCents: cashCents, label: 'Cash' }] : [])];
      case 'loyalty': return entries;
    }
  }, [mode, cashCents, totalCents, reference, note, entries, customer, creditLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Points pay in whole points and never more than the bill still needs (change comes from cash only).
  const owedBeforePoints = Math.max(0, totalCents - entries.filter((t) => t.method !== 'loyalty').reduce((s, t) => s + t.amountCents, 0));
  const pointsUsable = loyalty?.enabled && customer && !entries.some((t) => t.method === 'loyalty')
    ? Math.min(customer.loyaltyPoints, Math.floor(owedBeforePoints / loyalty.pointValueCents)) : 0;
  const canUsePoints = !offline && !!loyalty && pointsUsable >= loyalty.minRedeem;
  const usePoints = () => {
    if (!loyalty || !canUsePoints) return;
    setEntries((e) => [...e, { method: 'loyalty', amountCents: pointsUsable * loyalty.pointValueCents, reference: String(pointsUsable),
      label: `${pointsUsable.toLocaleString('en-LK')} points` }]);
    setMode('split');
  };

  const paid = tenders.reduce((s, t) => s + t.amountCents, 0);
  const nonCash = tenders.filter((t) => t.method !== 'cash').reduce((s, t) => s + t.amountCents, 0);
  const remainingBeforeCash = Math.max(0, totalCents - nonCash);
  const change = paid - totalCents;
  const changeOk = change <= (cashCents ?? 0);
  const ready = cashCents != null && paid >= totalCents && changeOk;

  const addEntry = async () => {
    setError(null);
    if (addMethod === 'credit_note') {
      if (offline) return setError('Credit notes need a connection.');
      const r = await checkCreditNote(addRef, laneId);
      if (!r.ok) return setError(r.error ?? 'Credit note cannot be used.');
      const left = Math.max(0, totalCents - entries.reduce((s, t) => s + t.amountCents, 0));
      setEntries((e) => [...e, { method: 'credit_note', amountCents: Math.min(r.balanceCents!, left), reference: addRef, label: `Credit note ${r.noteNo}` }]);
    } else {
      const amount = parseRupees(addAmount);
      if (!amount) return setError('Enter the amount for this payment.');
      setEntries((e) => [...e, { method: addMethod, amountCents: amount, reference: addRef || undefined, label: `${LABEL[addMethod]}${addRef ? ` · ref ${addRef}` : ''}` }]);
    }
    setAddAmount(''); setAddRef('');
  };

  return (
    <Dialog title="Take payment" onClose={onClose} width={640} aside={<span className="text-lg font-bold text-brand-primary">Total {formatRs(totalCents)}</span>}>
      <div className={tabsClass()} role="tablist" aria-label="Payment method">
        {(['cash', 'card', 'lankaqr', 'credit_note', 'account', ...(loyalty?.enabled ? ['loyalty' as const] : []), 'split'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={tabClass(mode === m)}
            disabled={(m === 'credit_note' || m === 'account' || m === 'loyalty') && offline}
            onClick={() => { setError(null); if (m === 'loyalty') { if (canUsePoints) usePoints(); else setMode('loyalty'); } else setMode(m); }}>
            {m === 'split' ? 'Split' : LABEL[m]}
          </button>
        ))}
      </div>

      {mode === 'loyalty' ? (
        <Alert tone="warning">
          {!customer ? 'Attach the loyalty member first (F7).'
            : `${customer.name} has ${customer.loyaltyPoints.toLocaleString('en-LK')} points; at least ${loyalty?.minRedeem ?? 0} are needed to pay with points.`}
        </Alert>
      ) : null}

      {mode === 'card' || mode === 'lankaqr' ? (
        <Field label="Reference" hint="Approval code or last 4 digits — never the full card number">
          <Input value={reference} onChange={(e) => setReference(e.target.value.slice(0, 40))} autoFocus />
        </Field>
      ) : null}

      {mode === 'credit_note' ? (
        note ? (
          <div className="flex items-center justify-between rounded-card bg-success-soft p-3 text-success">
            <span className="text-[13px] font-semibold">{note.noteNo} · balance {formatRs(note.balanceCents)}</span>
            {note.balanceCents < totalCents ? <span className="text-xs">Pay the rest under Split</span> : null}
          </div>
        ) : (
          <form className="flex items-end gap-2" onSubmit={async (e) => {
            e.preventDefault();
            const r = await checkCreditNote(noteCode, laneId);
            if (!r.ok) return setError(r.error ?? 'Credit note cannot be used.');
            const n = { code: noteCode, noteNo: r.noteNo!, balanceCents: r.balanceCents! };
            setNote(n);
            if (n.balanceCents < totalCents) { setEntries([noteTender(n)]); setMode('split'); }
          }}>
            <Field label="Credit note code" className="flex-1">
              <Input value={noteCode} onChange={(e) => setNoteCode(e.target.value.toUpperCase())} className="font-mono" autoFocus />
            </Field>
            <Button type="submit" variant="secondary">Check</Button>
          </form>
        )
      ) : null}

      {mode === 'account' ? (
        !customer ? <Alert tone="warning">Attach a credit customer first (F7). On-account sales need a named customer.</Alert>
          : !customer.creditLimitCents ? <Alert tone="warning">{customer.name} is a cash customer (no credit limit). Set a limit in Customers &amp; credit.</Alert>
          : (
            <div className={cn('flex items-center justify-between rounded-card p-3', creditLeft >= totalCents ? 'bg-brand-light text-brand-primary' : 'bg-danger-soft text-danger')}>
              <span className="text-[13px] font-semibold">{customer.name} · owes {formatRs(customer.balanceDueCents)}</span>
              <span className="text-xs">{creditLeft >= totalCents ? `${formatRs(creditLeft)} credit available` : `Only ${formatRs(creditLeft)} available — use Split`}</span>
            </div>
          )
      ) : null}

      {mode === 'split' ? (
        <div className="overflow-hidden rounded-card border border-border">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="bg-surface-muted text-[11px] font-semibold text-text-muted">
                <th className="px-4 py-2.5">Method</th><th className="px-4 py-2.5">Reference</th><th className="px-4 py-2.5">Amount</th><th />
              </tr>
            </thead>
            <tbody>
              {entries.map((t, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-2.5">{LABEL[t.method]}</td>
                  <td className="px-4 py-2.5">{t.method === 'credit_note' ? t.label.replace('Credit note ', '') : t.reference ?? '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatRs(t.amountCents)}</td>
                  <td className="px-2"><button type="button" aria-label="Remove payment" onClick={() => setEntries((e) => e.filter((_, j) => j !== i))} className="p-1 text-text-muted hover:text-danger"><Trash2 size={14} /></button></td>
                </tr>
              ))}
              <tr className="border-t border-border">
                <td className="px-2 py-2"><Select value={addMethod} onChange={(e) => setAddMethod(e.target.value as PaymentMethod)} className="py-1.5">
                  <option value="card">Card</option><option value="lankaqr">LankaQR</option>
                  <option value="credit_note" disabled={offline}>Credit note</option>
                  {creditLeft > 0 ? <option value="account" disabled={offline}>On account</option> : null}
                </Select></td>
                <td className="px-2 py-2"><Input value={addRef} onChange={(e) => setAddRef(e.target.value.slice(0, 40))} placeholder={addMethod === 'credit_note' ? 'Code' : 'Ref'} className="py-1.5" /></td>
                <td className="px-2 py-2"><Input value={addAmount} onChange={(e) => setAddAmount(e.target.value)} placeholder={addMethod === 'credit_note' ? 'auto' : '0.00'} disabled={addMethod === 'credit_note'} inputMode="decimal" className="py-1.5" /></td>
                <td className="px-2"><Button variant="soft" onClick={addEntry} className="px-3 py-1.5">Add</Button></td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {mode === 'cash' || mode === 'split' ? (
        <>
          <p className="text-xs font-semibold text-text-muted">Quick cash{mode === 'split' ? ` · ${formatRs(remainingBeforeCash)} left` : ''}</p>
          <div className="flex flex-wrap gap-2">
            {quickTenders(remainingBeforeCash).map((q) => (
              <button key={q} type="button" onClick={() => setCashText(formatAmount(q))} className={chipClass(cashCents === q)}>
                {q === remainingBeforeCash ? 'Exact' : formatRs(q, { decimals: 0 })}
              </button>
            ))}
          </div>
          <Field label="Cash received">
            <Input value={cashText} onChange={(e) => setCashText(e.target.value)} inputMode="decimal" autoFocus={mode === 'cash'} placeholder="Rs 0.00" />
          </Field>
        </>
      ) : null}

      <div className={cn('flex items-center justify-between rounded-card p-4', change >= 0 && changeOk ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
        <span className="text-sm font-semibold">{change >= 0 ? 'Change due' : 'Still to pay'}</span>
        <span className="text-2xl font-bold tabular-nums">{formatRs(Math.abs(change))}</span>
      </div>
      {!changeOk && change > 0 ? <p className="text-xs text-danger">Change can only be given from cash — lower the card or credit-note amount.</p> : null}
      {error ? <Alert>{error}</Alert> : null}

      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} className="size-4 accent-brand-primary" />
        Print receipt
      </label>

      <div className="flex gap-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <div className="flex-1" />
        <Button
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true); setError(null);
            const err = await submit(tenders, print);
            setBusy(false);
            if (err) setError(err);
          }}
        >
          {busy ? 'Saving…' : print ? 'Complete sale & print' : 'Complete sale'}
        </Button>
      </div>
    </Dialog>
  );
}
