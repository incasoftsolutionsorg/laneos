'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import { divRound, formatQty, formatRs, type ItemType } from '@laneos/core';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, PageHeader, Select, buttonClass, cn } from '@laneos/ui';
import { findSaleForReturn, processReturn, type ReturnResult, type ReturnableSale } from '@/app/(lane)/lane/actions';
import { getLaneKey } from '@/lib/lane/device';
import { printJob } from '@/lib/lane/print';
import type { ReturnReceiptData } from '@/components/print/ReturnReceipt';
import { Dialog } from './Dialog';

type Settlement = 'cash' | 'original' | 'exchange' | 'credit_note' | 'credit_balance';
interface LineState { checked: boolean; qty: string; reason: string; restock: 'sellable' | 'damaged' }

const REASONS = [
  ['changed_mind', 'Changed mind'], ['wrong_item', 'Wrong item'], ['damaged', 'Damaged'],
  ['expired', 'Expired'], ['quality', 'Quality'], ['other', 'Other'],
] as const;
const METHOD = { cash: 'cash', card: 'card', lankaqr: 'LankaQR', credit_note: 'credit note', account: 'on account' } as Record<string, string>;
const day = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/** Customer return (Figma 1-2580, WF-004, blueprint §30.2). */
export function ReturnScreen({
  laneId, laneCode, tenant, shop, creditDays, pinLimitCents, supervisors, initialInvoice, cashier = '',
}: {
  laneId: string; laneCode: string; tenant: string; shop: { name: string; address: string | null; phone: string | null };
  creditDays: number; pinLimitCents: number; supervisors: { id: string; name: string }[]; initialInvoice?: string; cashier?: string;
}) {
  const [slip, setSlip] = useState<ReturnReceiptData | null>(null);
  const [invoice, setInvoice] = useState(initialInvoice ?? '');
  const [sale, setSale] = useState<ReturnableSale | null>(null);
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [supervisor, setSupervisor] = useState(false);
  const [result, setResult] = useState<ReturnResult | null>(null);
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const [laneKey, setLaneKeyState] = useState<string | null>(null);

  useEffect(() => { getLaneKey(laneId).then((k) => setLaneKeyState(k ?? null)).catch(() => undefined); }, [laneId]);

  const find = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!invoice.trim()) return;
    setBusy(true); setError(null); setResult(null);
    const r = await findSaleForReturn(invoice);
    setBusy(false);
    if (!r.sale) { setSale(null); return setError(r.error ?? 'Receipt not found.'); }
    setSale(r.sale);
    setLines(Object.fromEntries(r.sale.lines.map((l) => [l.saleLineId, { checked: false, qty: '', reason: 'changed_mind', restock: 'sellable' as const }])));
    setSettlement(r.sale.payments.some((p) => p.method === 'credit_note') ? 'credit_note' : null);
    setClientUuid(crypto.randomUUID());
  };
  useEffect(() => { if (initialInvoice) void find(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const paidBy = sale ? [...new Set(sale.payments.map((p) => METHOD[p.method] ?? p.method))].join(' + ') : '';
  const paidWithNote = !!sale?.payments.some((p) => p.method === 'credit_note');
  const card = sale?.payments.find((p) => p.method === 'card' || p.method === 'lankaqr');

  const chosen = useMemo(() => {
    if (!sale) return [];
    return sale.lines.flatMap((l) => {
      const s = lines[l.saleLineId];
      if (!s?.checked) return [];
      const weighed = l.itemType === 'weighed';
      const qtyMilli = Math.round(Number(s.qty || (weighed ? (l.qtyMilli - l.returnedMilli) / 1000 : 1)) * 1000);
      return [{ line: l, state: s, qtyMilli, value: divRound(l.netCents * qtyMilli, l.qtyMilli) }];
    });
  }, [sale, lines]);
  const total = chosen.reduce((s, c) => s + c.value, 0);
  const invalid = chosen.find((c) => !(c.qtyMilli > 0) || c.qtyMilli > c.line.qtyMilli - c.line.returnedMilli);

  const options: { key: Settlement; title: string; text: string; disabled?: string }[] = [
    { key: 'cash', title: 'Cash refund', text: `From drawer · supervisor PIN above ${formatRs(pinLimitCents, { decimals: 0 })}`, disabled: paidWithNote ? 'Bill paid with a credit note' : undefined },
    { key: 'original', title: 'Original payment method', text: card ? `${METHOD[card.method]}${card.reference ? ` · ref ${card.reference}` : ''} — refund on the terminal` : 'Card or LankaQR bills only', disabled: paidWithNote ? 'Bill paid with a credit note' : !card ? 'Not paid by card or LankaQR' : undefined },
    { key: 'exchange', title: 'Exchange now', text: 'Issues a credit note to spend straight away on the new items' },
    { key: 'credit_note', title: 'Credit note', text: `Valid ${creditDays} days · usable at any ${tenant} shop` },
    { key: 'credit_balance', title: 'Reduce credit balance', text: sale?.customer ? `${sale.customer.name} owes ${formatRs(sale.customer.balanceDueCents)}` : 'Only for credit customers', disabled: paidWithNote ? 'Bill paid with a credit note' : !sale?.customer ? 'No customer on this bill' : undefined },
  ];

  const submit = async (sup?: { memberId: string; pin: string }) => {
    if (!sale || !settlement) return;
    setBusy(true); setError(null);
    const r = await processReturn({
      clientUuid, laneId, saleId: sale.id, settlement, ...(laneKey ? { laneKey } : {}),
      lines: chosen.map((c) => ({ saleLineId: c.line.saleLineId, qtyMilli: c.qtyMilli, reason: c.state.reason, restock: c.state.restock })),
      ...(sup ? { supervisorMemberId: sup.memberId, supervisorPin: sup.pin } : {}),
    });
    setBusy(false);
    if (!r.ok) {
      if (r.needsSupervisor && !sup) { setSupervisor(true); return null; }
      setError(r.error ?? 'Could not complete the return.');
      return r.error ?? 'Could not complete the return.';
    }
    setSupervisor(false);
    setResult(r);
    const receipt: ReturnReceiptData = {
      tenant, shop, returnNo: r.returnNo!, invoiceNo: sale.invoiceNo, at: new Date().toISOString(), lane: laneCode, cashier: cashier.split(' ')[0] ?? '',
      customer: sale.customer?.name ?? null, totalCents: r.totalCents ?? total, settlement, creditNoteNo: r.creditNote?.noteNo ?? null,
      lines: chosen.map((c) => ({
        name: c.line.name, amountCents: c.value, damaged: c.state.restock === 'damaged',
        qtyLabel: c.line.itemType === 'weighed' ? `${(c.qtyMilli / 1000).toFixed(3)} kg` : `${c.qtyMilli / 1000} pcs`,
        reason: REASONS.find(([k]) => k === c.state.reason)?.[1] ?? c.state.reason,
      })),
    };
    setSlip(receipt);
    // Cash, card and credit-balance returns get a return receipt; credit notes print their own slip below.
    if (!r.creditNote) printJob({ kind: 'return', receipt });
    if (r.creditNote) {
      printJob({ kind: 'credit_note', note: {
        tenant, shop, noteNo: r.creditNote.noteNo, code: r.creditNote.code, amountCents: r.creditNote.amountCents,
        expiresOn: r.creditNote.expiresOn, issuedAt: new Date().toISOString(), lane: laneCode, returnNo: r.returnNo!,
        invoiceNo: sale.invoiceNo, customer: sale.customer?.name ?? null,
      } });
    }
    return null;
  };

  const buttonText = settlement === 'credit_note' ? 'Complete return & print credit note'
    : settlement === 'exchange' ? 'Complete & print exchange credit'
    : settlement === 'cash' ? 'Complete return & refund cash' : 'Complete return';

  if (result?.ok) {
    return (
      <>
        <PageHeader title="Customer return" subtitle="Done" />
        <Card className="flex max-w-lg flex-col gap-3 p-6">
          <Badge tone="success">{result.returnNo}</Badge>
          <p className="text-2xl font-bold text-brand-primary">{formatRs(result.totalCents ?? 0)}</p>
          <p className="text-[13px]">
            {result.settlement === 'cash' ? 'Give this amount from the drawer.'
              : result.settlement === 'original' ? 'Refund this amount on the card / LankaQR terminal.'
              : result.settlement === 'credit_balance' ? 'Taken off the customer’s credit balance.'
              : result.creditNote ? `Credit note ${result.creditNote.noteNo} printed. The code is shown only on the slip.` : ''}
          </p>
          {result.settlement === 'exchange' && result.creditNote ? (
            <Alert tone="info">On the checkout, choose Credit note and scan or type the code from the slip: <b className="font-mono">{result.creditNote.code}</b></Alert>
          ) : null}
          <div className="flex gap-3">
            <Button onClick={() => { setResult(null); setSale(null); setInvoice(''); setSettlement(null); setSlip(null); }}>New return</Button>
            {slip ? <Button variant="secondary" onClick={() => printJob({ kind: 'return', receipt: slip })}>Print return receipt</Button> : null}
            <Link href={`/lane/${laneId}`} className={buttonClass('secondary')}>Back to checkout</Link>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Customer return" subtitle="Scan the receipt, choose items and how to give the value back" />
      <form onSubmit={find} className="flex flex-wrap items-end gap-3">
        <Field label="Receipt" className="w-full sm:w-[300px]">
          <div className="relative">
            <ScanBarcode size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" aria-hidden />
            <Input value={invoice} onChange={(e) => setInvoice(e.target.value.toUpperCase())} placeholder="KDY1-L2-000119" className="pl-9 font-mono" autoFocus />
          </div>
        </Field>
        <Button type="submit" variant="secondary" disabled={busy}>{busy && !sale ? 'Finding…' : 'Find'}</Button>
        {sale ? <Badge tone="success">Found · {day(sale.createdAt)} · {formatRs(sale.totalCents)} · paid {paidBy}</Badge> : null}
      </form>
      {error && !supervisor ? <Alert>{error}</Alert> : null}

      {sale ? (
        <section className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 overflow-x-auto rounded-card border border-border bg-surface">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="bg-surface-muted text-[11px] font-semibold text-text-muted">
                  <th className="w-10 px-3 py-2.5" /><th className="px-3 py-2.5">Item</th><th className="px-3 py-2.5">Sold</th>
                  <th className="px-3 py-2.5">Return</th><th className="px-3 py-2.5">Reason</th><th className="px-3 py-2.5">Put back as</th>
                  <th className="px-3 py-2.5 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {sale.lines.map((l) => {
                  const s = lines[l.saleLineId]!;
                  const left = l.qtyMilli - l.returnedMilli;
                  const blocked = !l.isReturnable || left <= 0;
                  const pick = chosen.find((c) => c.line.saleLineId === l.saleLineId);
                  const set = (patch: Partial<LineState>) => setLines((x) => ({ ...x, [l.saleLineId]: { ...x[l.saleLineId]!, ...patch } }));
                  return (
                    <tr key={l.saleLineId} className="border-t border-border">
                      <td className="px-3 py-2"><input type="checkbox" aria-label={`Return ${l.name}`} disabled={blocked} checked={s.checked} onChange={(e) => set({ checked: e.target.checked })} className="size-4 accent-brand-primary" /></td>
                      <td className="px-3 py-2 font-medium">{l.name}</td>
                      <td className="px-3 py-2 tabular-nums">{formatQty(l.qtyMilli, l.itemType as ItemType)}{l.returnedMilli ? <span className="text-text-muted"> ({formatQty(l.returnedMilli, l.itemType as ItemType)} back)</span> : null}</td>
                      <td className="px-3 py-2">
                        {s.checked ? (
                          <Input value={s.qty} onChange={(e) => set({ qty: e.target.value })} placeholder={l.itemType === 'weighed' ? (left / 1000).toFixed(3) : '1'} inputMode="decimal" className="w-20 py-1.5" aria-label="Quantity to return" />
                        ) : <span className="text-text-muted">0</span>}
                      </td>
                      <td className="px-3 py-2">
                        {blocked ? <Badge>{l.isReturnable ? 'All returned' : 'Non-returnable'}</Badge> : s.checked ? (
                          <Select value={s.reason} onChange={(e) => set({ reason: e.target.value, restock: e.target.value === 'damaged' || e.target.value === 'expired' ? 'damaged' : s.restock })} className="py-1.5">
                            {REASONS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                          </Select>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {s.checked ? (
                          <button type="button" onClick={() => set({ restock: s.restock === 'sellable' ? 'damaged' : 'sellable' })} title="Click to switch">
                            <Badge tone={s.restock === 'sellable' ? 'success' : 'danger'}>{s.restock === 'sellable' ? 'Sellable' : 'Damaged stock'}</Badge>
                          </button>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{pick ? formatRs(pick.value) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Card className="flex flex-col gap-3 p-5 xl:w-[380px]">
            <CardTitle>Give value back as</CardTitle>
            {options.map((o) => (
              <button
                key={o.key} type="button" disabled={!!o.disabled} onClick={() => setSettlement(o.key)}
                className={cn('flex items-start gap-3 rounded-card border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50',
                  settlement === o.key ? 'border-brand-primary bg-brand-light' : 'border-border hover:border-brand-primary')}
                aria-pressed={settlement === o.key}
              >
                <span className={cn('mt-1 size-2.5 shrink-0 rounded-full', settlement === o.key ? 'bg-brand-primary' : 'bg-border-strong')} />
                <span>
                  <span className="block text-[13px] font-semibold">{o.title}</span>
                  <span className="block text-xs text-text-muted">{o.disabled ?? o.text}</span>
                </span>
              </button>
            ))}
            <div className="flex justify-between border-t border-border pt-3 text-[13px] font-semibold">
              <span>Return value</span><span className="tabular-nums">{formatRs(total)}</span>
            </div>
            {invalid ? <Alert tone="warning">{invalid.line.name}: you can return up to {formatQty(invalid.line.qtyMilli - invalid.line.returnedMilli, invalid.line.itemType as ItemType)}.</Alert> : null}
            <Button disabled={busy || !settlement || !chosen.length || !!invalid} onClick={() => void submit()}>{busy ? 'Saving…' : buttonText}</Button>
          </Card>
        </section>
      ) : null}

      {supervisor ? (
        <SupervisorDialog supervisors={supervisors} amount={total} error={error} busy={busy}
          onClose={() => { setSupervisor(false); setError(null); }}
          onSubmit={(memberId, pin) => void submit({ memberId, pin })} />
      ) : null}
    </>
  );
}

function SupervisorDialog({ supervisors, amount, error, busy, onClose, onSubmit }: {
  supervisors: { id: string; name: string }[]; amount: number; error: string | null; busy: boolean;
  onClose: () => void; onSubmit: (memberId: string, pin: string) => void;
}) {
  const [who, setWho] = useState(supervisors[0]?.id ?? '');
  const [pin, setPin] = useState('');
  return (
    <Dialog title="Supervisor approval" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); onSubmit(who, pin); setPin(''); }}>
        <p className="text-[13px] text-text-muted">Cash refund of {formatRs(amount)} needs a supervisor PIN.</p>
        {error ? <Alert>{error}</Alert> : null}
        {supervisors.length ? (
          <>
            <Field label="Supervisor"><Select value={who} onChange={(e) => setWho(e.target.value)}>{supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="PIN"><Input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus /></Field>
            <Button type="submit" disabled={busy || pin.length < 4}>{busy ? 'Checking…' : 'Approve refund'}</Button>
          </>
        ) : <Alert tone="warning">No supervisor has a PIN. Set one in Users &amp; roles, or choose a credit note.</Alert>}
      </form>
    </Dialog>
  );
}
