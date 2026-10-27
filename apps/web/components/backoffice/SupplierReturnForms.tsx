'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { formatRs } from '@laneos/core';
import { Alert, Button, Card, CardTitle, Field, Input, Select, cn } from '@laneos/ui';
import { answerSupplierReturn, createSupplierReturn } from '@/app/(tenant)/backoffice/purchasing/returns/actions';
import { ItemSearch } from './ItemSearch';

export interface DamagedRow { id: string; reportNo: string; itemId: string; itemName: string; remainingMilli: number; unitCostCents: number; weighed: boolean }
export interface RItem { id: string; name: string; barcodes: string[]; plu: number | null; costCents: number | null; supplierId: string | null; weighed: boolean }

interface Line { key: string; damageReportId?: string; itemId: string; name: string; qty: string; costCents: number; weighed: boolean; max?: number }

const toMilli = (q: string) => Math.round(Number(q) * 1000);

/** New supplier return: damaged stock waiting for a decision, and/or sellable stock (sale-or-return unsold). */
export function SupplierReturnEditor({ suppliers, damaged, items, preset }: {
  suppliers: { id: string; name: string; saleOrReturn: boolean }[]; damaged: DamagedRow[]; items: RItem[];
  preset?: { supplierId?: string; reportId?: string };
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(preset?.supplierId ?? '');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>(() => {
    const d = damaged.find((x) => x.id === preset?.reportId);
    return d ? [{ key: d.id, damageReportId: d.id, itemId: d.itemId, name: `${d.itemName} · damaged (${d.reportNo})`, qty: String(d.remainingMilli / 1000), costCents: d.unitCostCents, weighed: d.weighed, max: d.remainingMilli }] : [];
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const used = new Set(lines.map((l) => l.key));
  const value = lines.reduce((s, l) => s + Math.round((toMilli(l.qty || '0') * l.costCents) / 1000), 0);

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Card className="flex flex-col gap-3 p-5">
          <CardTitle>Damaged stock waiting for a decision</CardTitle>
          {damaged.length === 0 ? <p className="text-xs text-text-muted">Nothing is waiting. Damaged goods are reported in Damaged goods.</p> : (
            <div className="flex flex-col gap-1.5">
              {damaged.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span><span className="font-mono text-xs">{d.reportNo}</span> · {d.itemName} · {(d.remainingMilli / 1000).toLocaleString('en-LK')}{d.weighed ? ' kg' : ''} left</span>
                  <button type="button" disabled={used.has(d.id)} className="text-xs font-semibold text-brand-primary hover:underline disabled:opacity-40"
                    onClick={() => setLines((ls) => [...ls, { key: d.id, damageReportId: d.id, itemId: d.itemId, name: `${d.itemName} · damaged (${d.reportNo})`, qty: String(d.remainingMilli / 1000), costCents: d.unitCostCents, weighed: d.weighed, max: d.remainingMilli }])}>
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <CardTitle>Sellable stock (sale-or-return unsold, wrong delivery)</CardTitle>
          <ItemSearch items={items} exclude={new Set(lines.filter((l) => !l.damageReportId).map((l) => l.itemId))}
            onPick={(i) => setLines((ls) => [...ls, { key: `s-${i.id}`, itemId: i.id, name: i.name, qty: '', costCents: i.costCents ?? 0, weighed: i.weighed }])} />
        </Card>
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead><tr className="bg-surface-muted text-[11px] font-semibold text-text-muted"><th className="px-4 py-2.5">Item</th><th className="px-3">Quantity</th><th className="px-3 text-right">Cost</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className="border-t border-border">
                  <td className="px-4 py-2">{l.name}</td>
                  <td className="px-3"><div className="w-28"><Input value={l.qty} inputMode="decimal" aria-label={`Quantity of ${l.name}`}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></div></td>
                  <td className="px-3 text-right tabular-nums">{formatRs(Math.round((toMilli(l.qty || '0') * l.costCents) / 1000), { decimals: 0 })}</td>
                  <td className="px-2"><button type="button" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="p-1 text-text-muted hover:text-danger"><Trash2 size={14} /></button></td>
                </tr>
              ))}
              {lines.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-text-muted">Add damaged reports or items to send back.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      <Card className="flex flex-col gap-3 p-5 xl:w-[320px]">
        <CardTitle>Return note</CardTitle>
        <Field label="Supplier">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Choose…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.saleOrReturn ? ' · sale-or-return' : ''}</option>)}
          </Select>
        </Field>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Collected by the rep" /></Field>
        <div className="flex justify-between text-[13px] font-semibold"><span>Value at cost</span><span className="tabular-nums">{formatRs(value, { decimals: 0 })}</span></div>
        <p className="text-xs text-text-muted">Stock leaves the shop now. When the supplier answers, record the credit (it lowers what you owe) or the refusal (the goods come back).</p>
        {error ? <Alert>{error}</Alert> : null}
        <Button disabled={pending || !lines.length || !supplierId} onClick={() => start(async () => {
          setError(null);
          const r = await createSupplierReturn({
            supplierId, note,
            lines: lines.map((l) => (l.damageReportId ? { damageReportId: l.damageReportId, qtyMilli: toMilli(l.qty) } : { itemId: l.itemId, qtyMilli: toMilli(l.qty) })),
          });
          if (r.error) return setError(r.error);
          router.push(`/backoffice/purchasing/returns/${r.id}`);
        })}>{pending ? 'Saving…' : 'Send return'}</Button>
      </Card>
    </div>
  );
}

/** Supplier's answer on a sent return. */
export function SupplierReturnAnswer({ id, valueCents }: { id: string; valueCents: number }) {
  const router = useRouter();
  const [mode, setMode] = useState<'credit' | 'reject'>('credit');
  const [credit, setCredit] = useState(String(valueCents / 100));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="flex flex-col gap-3 p-5">
      <CardTitle>Supplier&apos;s answer</CardTitle>
      <div className="flex w-fit gap-1 rounded-control bg-surface-muted p-1" role="radiogroup" aria-label="Answer">
        {([['credit', 'Credited'], ['reject', 'Refused']] as const).map(([k, t]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
            className={cn('rounded-md px-3 py-1.5 text-xs font-semibold', mode === k ? 'bg-surface text-text shadow-sm' : 'text-text-muted')}>{t}</button>
        ))}
      </div>
      {mode === 'credit' ? <Field label="Credit (Rs)" hint="Lowers what you owe this supplier"><Input value={credit} onChange={(e) => setCredit(e.target.value)} inputMode="decimal" /></Field> : null}
      <Field label={mode === 'reject' ? 'Why did they refuse?' : 'Credit note no. / note (optional)'}><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      {mode === 'reject' ? <p className="text-xs text-text-muted">Damaged items go back to “waiting for a decision”; sellable items go back into stock.</p> : null}
      {error ? <Alert>{error}</Alert> : null}
      <Button variant={mode === 'reject' ? 'danger' : 'primary'} disabled={pending} onClick={() => start(async () => {
        setError(null);
        const r = await answerSupplierReturn(id, mode, credit, note);
        if (r.error) setError(r.error); else router.refresh();
      })}>{pending ? 'Saving…' : mode === 'credit' ? 'Record credit' : 'Record refusal'}</Button>
    </Card>
  );
}
