'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatRs } from '@laneos/core';
import { Alert, Badge, Button, Card, CardTitle, EmptyRow, Input, Switch, Table, TD, TH, inputClass, tabClass, tabsClass, type Tone } from '@laneos/ui';
import { labelsAction, queueItems } from '@/app/(tenant)/backoffice/labels/actions';
import type { LabelData } from '@/components/print/Labels';
import { LABEL_SIZES, type LabelFormat } from '@/lib/labels';
import { printJob } from '@/lib/lane/print';

export interface QueueRow extends LabelData { id: string; itemId: string }

const REASON: Record<LabelData['reason'], { tone: Tone; text: string }> = {
  price_changed: { tone: 'warning', text: 'Price changed' },
  new_item: { tone: 'info', text: 'New item' },
  promotion: { tone: 'success', text: 'Promotion' },
  reduced: { tone: 'danger', text: 'Reduced' },
  manual: { tone: 'neutral', text: 'Added' },
};

function Option({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px] font-semibold">
      {label}
      <Switch on={on} onChange={onChange} label={label} />
    </div>
  );
}

// Print labels (Figma 11-3929): the queue fills itself on price changes, promotions and reduced stock.
export function LabelQueue({ rows, items }: { rows: QueueRow[]; items: { id: string; name: string }[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(() => new Set(rows.map((r) => r.id)));
  const [format, setFormat] = useState<LabelFormat>('shelf');
  const [unitPrice, setUnitPrice] = useState(true);
  const [barcode, setBarcode] = useState(true);
  const [wasPrice, setWasPrice] = useState(true);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = rows.filter((r) => selected.has(r.id));
  const count = chosen.reduce((n, r) => n + r.copies, 0);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s.length < 2 ? [] : items.filter((i) => i.name.toLowerCase().includes(s)).slice(0, 8);
  }, [q, items]);

  const print = async () => {
    if (!chosen.length) return;
    printJob({ kind: 'labels', labels: chosen, opts: { format, unitPrice, barcode, wasPrice } });
    setBusy(true);
    const r = await labelsAction(chosen.map((c) => c.id), 'printed');
    setBusy(false);
    if (r.error) setError(r.error); else router.refresh();
  };

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="relative max-w-md">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add an item to print…" aria-label="Add an item" className={inputClass} />
          {matches.length ? (
            <ul className="absolute z-10 mt-1 w-full rounded-card border border-border bg-surface py-1 shadow-lg">
              {matches.map((m) => (
                <li key={m.id}>
                  <button type="button" className="w-full px-3 py-2 text-left text-[13px] hover:bg-surface-muted"
                    onClick={async () => { setQ(''); const r = await queueItems([m.id]); if (r.error) setError(r.error); else router.refresh(); }}>
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {error ? <Alert>{error}</Alert> : null}
        <Table>
          <thead>
            <tr>
              <TH className="w-10"><input type="checkbox" aria-label="Select all" className="size-4 accent-brand-primary" checked={selected.size === rows.length && rows.length > 0}
                onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></TH>
              <TH>Item</TH><TH>Price</TH><TH>Reason</TH><TH>Copies</TH><TH />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <TD><input type="checkbox" aria-label={`Print ${r.name}`} className="size-4 accent-brand-primary" checked={selected.has(r.id)}
                  onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></TD>
                <TD className="font-medium">{r.name}</TD>
                <TD className="tabular-nums">{formatRs(r.reason === 'reduced' && r.otherPriceCents != null ? r.otherPriceCents : r.priceCents)}</TD>
                <TD><Badge tone={REASON[r.reason].tone}>{REASON[r.reason].text}</Badge></TD>
                <TD>
                  <Input type="number" min={1} max={100} defaultValue={r.copies} className="w-20 py-1.5" aria-label="Copies"
                    onBlur={async (e) => { const n = Number(e.target.value); if (n !== r.copies && n >= 1 && n <= 100) { await labelsAction([r.id], 'copies', n); router.refresh(); } }} />
                </TD>
                <TD><button type="button" className="text-xs font-semibold text-danger hover:underline" onClick={async () => { await labelsAction([r.id], 'remove'); router.refresh(); }}>Remove</button></TD>
              </tr>
            ))}
            {rows.length === 0 ? <EmptyRow colSpan={6}>Nothing to print. Labels appear here when prices change, promotions start or stock is reduced.</EmptyRow> : null}
          </tbody>
        </Table>
      </div>
      <Card className="flex flex-col gap-3.5 p-5 xl:w-[340px]">
        <CardTitle>Label format</CardTitle>
        <div className={tabsClass()} role="tablist">
          {(Object.keys(LABEL_SIZES) as LabelFormat[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={format === f} className={tabClass(format === f)} onClick={() => setFormat(f)}>{LABEL_SIZES[f].label}</button>
          ))}
        </div>
        <Option on={unitPrice} onChange={setUnitPrice} label="Show unit price (per kg)" />
        <Option on={barcode} onChange={setBarcode} label="Show barcode" />
        <Option on={wasPrice} onChange={setWasPrice} label={'Show "was" price on price drops'} />
        <Button onClick={print} disabled={!count || busy}>{busy ? 'Saving…' : `Print ${count} ${count === 1 ? 'label' : 'labels'}`}</Button>
        <p className="text-xs text-text-muted">Prints through the browser. Printed labels leave the queue.</p>
      </Card>
    </div>
  );
}
