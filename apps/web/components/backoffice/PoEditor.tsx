'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatRs, parseRupees } from '@laneos/core';
import { Alert, Button, Card, CardTitle, Field, Input, Select, buttonClass } from '@laneos/ui';
import { poAction, savePo } from '@/app/(tenant)/backoffice/purchasing/actions';
import type { PurchaseItem } from '@/app/(tenant)/backoffice/purchasing/data';
import { ItemSearch } from './ItemSearch';

interface Line { itemId: string; qty: string; cost: string }

export function PoEditor({ po, items, suppliers, editable }: {
  po: { id?: string; poNo?: string; status: string; supplierId: string; expectedOn: string; note: string; lines: { itemId: string; qtyMilli: number; unitCostCents: number; receivedMilli: number }[] };
  items: PurchaseItem[]; suppliers: { id: string; name: string }[]; editable: boolean;
}) {
  const router = useRouter();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [supplierId, setSupplierId] = useState(po.supplierId);
  const [expectedOn, setExpectedOn] = useState(po.expectedOn);
  const [note, setNote] = useState(po.note);
  const [lines, setLines] = useState<Line[]>(po.lines.map((l) => ({ itemId: l.itemId, qty: String(l.qtyMilli / 1000), cost: (l.unitCostCents / 100).toFixed(2) })));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const total = lines.reduce((s, l) => s + Math.round(Number(l.qty || 0) * (parseRupees(l.cost || '0') ?? 0)), 0);
  const received = new Map(po.lines.map((l) => [l.itemId, l.receivedMilli]));

  const save = async (send: boolean) => {
    if (!supplierId) return setError('Choose the supplier.');
    const parsed = lines.map((l) => ({ itemId: l.itemId, qtyMilli: Math.round(Number(l.qty) * 1000), unitCostCents: parseRupees(l.cost) ?? -1 }));
    if (!parsed.length) return setError('Add at least one item.');
    if (parsed.some((l) => !(l.qtyMilli > 0) || l.unitCostCents < 0)) return setError('Every line needs a quantity and a unit cost.');
    setBusy(true); setError(null);
    const r = await savePo({ id: po.id, supplierId, expectedOn: expectedOn || null, note, lines: parsed }, send);
    setBusy(false);
    if (r.error) return setError(r.error);
    router.push(`/backoffice/purchasing/orders/${r.id}`);
    router.refresh();
  };

  const act = async (a: 'send' | 'cancel' | 'close') => {
    if (a === 'cancel' && !confirm('Cancel this purchase order?')) return;
    setBusy(true);
    const r = await poAction(po.id!, a);
    setBusy(false);
    if (r.error) setError(r.error); else router.refresh();
  };

  return (
    <div className="flex max-w-[1000px] flex-col gap-4">
      {error ? <Alert>{error}</Alert> : null}
      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <Field label="Supplier">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={!editable}>
            <option value="">Choose…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Expected delivery"><Input type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} disabled={!editable} /></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} disabled={!editable} /></Field>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Items</CardTitle>
          {editable ? (
            <div className="w-full max-w-sm">
              <ItemSearch items={supplierId ? [...items].sort((a, b) => Number(b.supplierId === supplierId) - Number(a.supplierId === supplierId)) : items}
                exclude={new Set(lines.map((l) => l.itemId))}
                onPick={(i) => setLines((ls) => [...ls, { itemId: i.id, qty: String(i.caseQty > 1 ? i.caseQty : 1), cost: i.costCents != null ? (i.costCents / 100).toFixed(2) : '' }])} />
            </div>
          ) : null}
        </div>
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-left text-[13px]">
            <thead><tr className="bg-surface-muted text-[11px] font-semibold text-text-muted">
              <th className="px-3 py-2.5">Item</th><th className="px-3 py-2.5">Order (units)</th><th className="px-3 py-2.5">Unit cost (Rs)</th>
              <th className="px-3 py-2.5">Line total</th>{editable ? null : <th className="px-3 py-2.5">Received</th>}<th />
            </tr></thead>
            <tbody>
              {lines.map((l, idx) => {
                const it = byId.get(l.itemId);
                const set = (patch: Partial<Line>) => setLines((ls) => ls.map((x, j) => (j === idx ? { ...x, ...patch } : x)));
                const qty = Number(l.qty || 0);
                return (
                  <tr key={l.itemId} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{it?.name}{it && it.caseQty > 1 ? <span className="block text-xs font-normal text-text-muted">{qty % it.caseQty === 0 ? `${qty / it.caseQty} × ${it.caseQty}` : `case of ${it.caseQty}`}</span> : null}</td>
                    <td className="px-3 py-2">{editable ? <Input value={l.qty} onChange={(e) => set({ qty: e.target.value })} inputMode="decimal" className="w-24 py-1.5" aria-label="Quantity" /> : qty}</td>
                    <td className="px-3 py-2">{editable ? <Input value={l.cost} onChange={(e) => set({ cost: e.target.value })} inputMode="decimal" className="w-28 py-1.5" aria-label="Unit cost" /> : l.cost}</td>
                    <td className="px-3 py-2 tabular-nums">{formatRs(Math.round(qty * (parseRupees(l.cost || '0') ?? 0)))}</td>
                    {editable ? null : <td className="px-3 py-2 tabular-nums">{(received.get(l.itemId) ?? 0) / 1000}</td>}
                    <td className="px-2">{editable ? <button type="button" aria-label="Remove line" className="p-1 text-text-muted hover:text-danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== idx))}><Trash2 size={14} /></button> : null}</td>
                  </tr>
                );
              })}
              {lines.length === 0 ? <tr><td colSpan={6} className="px-3 py-8 text-center text-text-muted">Search above to add items.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <p className="self-end text-[15px] font-bold">Total {formatRs(total)}</p>
      </Card>

      <div className="flex flex-wrap gap-3">
        {editable ? (
          <>
            <Button onClick={() => save(true)} disabled={busy}>Save & send to supplier</Button>
            <Button variant="secondary" onClick={() => save(false)} disabled={busy}>Save draft</Button>
          </>
        ) : null}
        {po.id && (po.status === 'sent' || po.status === 'partially_received') ? (
          <Link href={`/backoffice/purchasing/grn/new?po=${po.id}`} className={buttonClass('primary')}>Receive goods</Link>
        ) : null}
        {po.id && po.status === 'draft' && !editable ? <Button onClick={() => act('send')} disabled={busy}>Send</Button> : null}
        {po.id && po.status === 'partially_received' ? <Button variant="secondary" onClick={() => act('close')} disabled={busy}>Close (rest not coming)</Button> : null}
        {po.id && (po.status === 'draft' || po.status === 'sent') ? <Button variant="danger" onClick={() => act('cancel')} disabled={busy}>Cancel order</Button> : null}
        <Link href="/backoffice/purchasing/orders" className={buttonClass('secondary')}>Back</Link>
      </div>
    </div>
  );
}
