'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Trash2, TriangleAlert } from 'lucide-react';
import { formatRs, parseRupees } from '@laneos/core';
import { Alert, Button, Card, CardTitle, Field, Input, Select, buttonClass } from '@laneos/ui';
import { saveGrn } from '@/app/(tenant)/backoffice/purchasing/actions';
import type { PurchaseItem } from '@/app/(tenant)/backoffice/purchasing/data';
import { ItemSearch } from './ItemSearch';

interface Line { itemId: string; batchNo: string; expiryOn: string; qty: string; free: string; cost: string }
export interface OpenPo { id: string; poNo: string; supplierId: string; lines: { itemId: string; qtyMilli: number; receivedMilli: number; unitCostCents: number }[] }

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const daysTo = (d: string) => Math.round((new Date(`${d}T00:00:00+05:30`).getTime() - new Date(`${today()}T00:00:00+05:30`).getTime()) / 86_400_000);

// Receive goods (Figma 1-2351, WF-005).
export function GrnEditor({ grn, items, suppliers, openPos, editable }: {
  grn: { id?: string; supplierId: string; poId: string; supplierInvoiceNo: string; receivedOn: string; discountCents: number; lines: Line[] };
  items: PurchaseItem[]; suppliers: { id: string; name: string }[]; openPos: OpenPo[]; editable: boolean;
}) {
  const router = useRouter();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [supplierId, setSupplierId] = useState(grn.supplierId);
  const [poId, setPoId] = useState(grn.poId);
  const [invoice, setInvoice] = useState(grn.supplierInvoiceNo);
  const [receivedOn, setReceivedOn] = useState(grn.receivedOn);
  const [discount, setDiscount] = useState(grn.discountCents ? (grn.discountCents / 100).toFixed(2) : '');
  const [lines, setLines] = useState<Line[]>(grn.lines);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const posForSupplier = openPos.filter((p) => p.supplierId === supplierId);
  const choosePo = (id: string) => {
    setPoId(id);
    const po = openPos.find((p) => p.id === id);
    if (po && lines.length === 0) {
      setLines(po.lines.filter((l) => l.qtyMilli > l.receivedMilli).map((l) => ({
        itemId: l.itemId, batchNo: '', expiryOn: '', qty: String((l.qtyMilli - l.receivedMilli) / 1000), free: '0', cost: (l.unitCostCents / 100).toFixed(2),
      })));
    }
  };

  const units = (l: Line) => Number(l.qty || 0);
  const lineCents = (l: Line) => Math.round(units(l) * (parseRupees(l.cost || '0') ?? 0));
  const subtotal = lines.reduce((s, l) => s + lineCents(l), 0);
  const discountCents = parseRupees(discount || '0') ?? 0;
  const soon = lines.filter((l) => l.expiryOn && daysTo(l.expiryOn) <= 7);

  const save = async (post: boolean) => {
    if (!supplierId) return setError('Choose the supplier.');
    if (!lines.length) return setError('Add the delivered items.');
    const bad = lines.find((l) => !(units(l) > 0) || parseRupees(l.cost) == null || Number(l.free || 0) < 0);
    if (bad) return setError(`${byId.get(bad.itemId)?.name}: enter the quantity and unit cost.`);
    const missingExpiry = lines.find((l) => byId.get(l.itemId)?.trackBatches && !l.expiryOn);
    if (post && missingExpiry) return setError(`${byId.get(missingExpiry.itemId)?.name} tracks batches: enter its expiry date.`);
    if (post && !confirm(`Post ${lines.length} lines (${formatRs(subtotal - discountCents)}) to stock? This cannot be edited afterwards.`)) return;
    setBusy(true); setError(null);
    const r = await saveGrn({
      id: grn.id, supplierId, poId: poId || null, supplierInvoiceNo: invoice, receivedOn, discountCents,
      lines: lines.map((l) => ({ itemId: l.itemId, batchNo: l.batchNo || undefined, expiryOn: l.expiryOn || null, qtyMilli: Math.round(units(l) * 1000), freeMilli: Math.round(Number(l.free || 0) * 1000), unitCostCents: parseRupees(l.cost)! })),
    }, post);
    setBusy(false);
    if (r.error) return setError(r.error);
    router.push(`/backoffice/purchasing/grn/${r.id}`);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Supplier">
          <Select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setPoId(''); }} disabled={!editable}>
            <option value="">Choose…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Purchase order">
          <Select value={poId} onChange={(e) => choosePo(e.target.value)} disabled={!editable || !supplierId}>
            <option value="">{posForSupplier.length ? 'None (optional)' : 'No open orders'}</option>
            {posForSupplier.map((p) => <option key={p.id} value={p.id}>{p.poNo}</option>)}
          </Select>
        </Field>
        <Field label="Supplier invoice no."><Input value={invoice} onChange={(e) => setInvoice(e.target.value.slice(0, 40))} disabled={!editable} placeholder="INV-88412" /></Field>
        <Field label="Received date"><Input type="date" value={receivedOn} max={today()} onChange={(e) => setReceivedOn(e.target.value)} disabled={!editable} /></Field>
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {editable ? <ItemSearch items={items} exclude={new Set(lines.map((l) => l.itemId))} placeholder="Scan or search a delivered item"
            onPick={(i) => setLines((ls) => [...ls, { itemId: i.id, batchNo: '', expiryOn: '', qty: String(i.caseQty), free: '0', cost: i.costCents != null ? (i.costCents / 100).toFixed(2) : '' }])} /> : null}
          <div className="overflow-x-auto rounded-card border border-border bg-surface">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="bg-surface-muted text-[11px] font-semibold text-text-muted">
                <th className="px-3 py-2.5">Item</th><th className="px-3 py-2.5">Batch</th><th className="px-3 py-2.5">Expiry</th>
                <th className="px-3 py-2.5">Units</th><th className="px-3 py-2.5">Free</th><th className="px-3 py-2.5">Unit cost</th><th className="px-3 py-2.5">Line total</th><th />
              </tr></thead>
              <tbody>
                {lines.map((l, idx) => {
                  const it = byId.get(l.itemId);
                  const set = (patch: Partial<Line>) => setLines((ls) => ls.map((x, j) => (j === idx ? { ...x, ...patch } : x)));
                  const u = units(l);
                  return (
                    <tr key={l.itemId} className="border-t border-border align-top">
                      <td className="px-3 py-2 font-medium">{it?.name}{it && it.caseQty > 1 && u > 0 && u % it.caseQty === 0 ? <span className="block text-xs font-normal text-text-muted">{u / it.caseQty} × {it.caseQty}</span> : null}</td>
                      <td className="px-3 py-2">{editable ? <Input value={l.batchNo} onChange={(e) => set({ batchNo: e.target.value.slice(0, 40) })} className="w-28 py-1.5" aria-label="Batch" /> : l.batchNo || '—'}</td>
                      <td className="px-3 py-2">{editable ? <Input type="date" value={l.expiryOn} min={today()} onChange={(e) => set({ expiryOn: e.target.value })} className="w-40 py-1.5" aria-label="Expiry" /> : l.expiryOn || '—'}</td>
                      <td className="px-3 py-2">{editable ? <Input value={l.qty} onChange={(e) => set({ qty: e.target.value })} inputMode="decimal" className="w-20 py-1.5" aria-label="Units" /> : u}</td>
                      <td className="px-3 py-2">{editable ? <Input value={l.free} onChange={(e) => set({ free: e.target.value })} inputMode="decimal" className="w-16 py-1.5" aria-label="Free units" /> : l.free}</td>
                      <td className="px-3 py-2">{editable ? <Input value={l.cost} onChange={(e) => set({ cost: e.target.value })} inputMode="decimal" className="w-24 py-1.5" aria-label="Unit cost" /> : l.cost}</td>
                      <td className="px-3 py-2 tabular-nums">{formatRs(lineCents(l))}</td>
                      <td className="px-2 py-2">{editable ? <button type="button" aria-label="Remove line" className="p-1 text-text-muted hover:text-danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== idx))}><Trash2 size={14} /></button> : null}</td>
                    </tr>
                  );
                })}
                {lines.length === 0 ? <tr><td colSpan={8} className="px-3 py-8 text-center text-text-muted">Scan items from the delivery, or choose a purchase order.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <Card className="flex flex-col gap-2.5 p-5 xl:w-[340px]">
          <CardTitle>GRN summary</CardTitle>
          <Row label="Lines" value={String(lines.length)} />
          <Row label="Total units" value={String(lines.reduce((s, l) => s + units(l), 0))} />
          <Row label="Free issues" value={String(lines.reduce((s, l) => s + Number(l.free || 0), 0))} />
          <Row label="Subtotal" value={formatRs(subtotal)} />
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-text-muted">Discount</span>
            {editable ? <Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder="0.00" className="w-28 py-1 text-right" aria-label="Discount" /> : <span>− {formatRs(discountCents)}</span>}
          </div>
          <div className="mt-1 flex justify-between border-t border-border pt-3 text-[13px] font-bold"><span>Payable to supplier</span><span>{formatRs(subtotal - discountCents)}</span></div>
          {soon.map((l) => (
            <p key={l.itemId} className="flex gap-2 rounded-control bg-warning-soft p-2.5 text-xs font-semibold text-warning">
              <TriangleAlert size={14} className="shrink-0" aria-hidden />{byId.get(l.itemId)?.name} expires within 7 days
            </p>
          ))}
          {editable ? (
            <>
              <Button onClick={() => save(true)} disabled={busy}>{busy ? 'Saving…' : 'Post GRN'}</Button>
              <Button variant="secondary" onClick={() => save(false)} disabled={busy}>Save draft</Button>
            </>
          ) : <Link href="/backoffice/purchasing/grn" className={buttonClass('secondary')}>Back to GRNs</Link>}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-[13px]"><span className="text-text-muted">{label}</span><span className="tabular-nums">{value}</span></div>;
}
