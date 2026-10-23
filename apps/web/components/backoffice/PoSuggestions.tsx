'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatQty, formatRs, type ItemType } from '@laneos/core';
import { Alert, Button, EmptyRow, Table, TD, TH } from '@laneos/ui';
import { savePo } from '@/app/(tenant)/backoffice/purchasing/actions';

export interface Suggestion {
  itemId: string; name: string; itemType: ItemType; stockMilli: number; reorderMilli: number; unitCostCents: number | null;
  supplierId: string | null; supplierName: string | null; caseQty: number; suggestMilli: number;
}

// Suggested orders from re-order levels (left table of Figma 11-3669).
export function PoSuggestions({ rows, canOrder }: { rows: Suggestion[]; canOrder: boolean }) {
  const router = useRouter();
  const orderable = rows.filter((r) => r.supplierId);
  const [selected, setSelected] = useState(() => new Set(orderable.map((r) => r.itemId)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const bySupplier = new Map<string, Suggestion[]>();
    for (const r of orderable.filter((x) => selected.has(x.itemId))) bySupplier.set(r.supplierId!, [...(bySupplier.get(r.supplierId!) ?? []), r]);
    setBusy(true); setError(null);
    for (const [supplierId, lines] of bySupplier) {
      const res = await savePo({ supplierId, lines: lines.map((l) => ({ itemId: l.itemId, qtyMilli: l.suggestMilli, unitCostCents: l.unitCostCents ?? 0 })) }, false);
      if (res.error) { setError(res.error); break; }
    }
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert>{error}</Alert> : null}
      <Table>
        <thead><tr>
          {canOrder ? <TH className="w-10" /> : null}
          <TH>Suggested item</TH><TH>Stock</TH><TH>Re-order at</TH><TH>Order</TH><TH>Supplier</TH><TH>Cost</TH>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId}>
              {canOrder ? (
                <TD><input type="checkbox" aria-label={`Order ${r.name}`} disabled={!r.supplierId} checked={selected.has(r.itemId)} className="size-4 accent-brand-primary"
                  onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(r.itemId); else n.delete(r.itemId); return n; })} /></TD>
              ) : null}
              <TD className="font-medium">{r.name}</TD>
              <TD className="tabular-nums">{formatQty(Math.max(r.stockMilli, 0), r.itemType)}</TD>
              <TD className="tabular-nums">{formatQty(r.reorderMilli, r.itemType)}</TD>
              <TD className="tabular-nums">{formatQty(r.suggestMilli, r.itemType)}{r.caseQty > 1 ? <span className="text-text-muted"> ({r.suggestMilli / 1000 / r.caseQty} cases)</span> : null}</TD>
              <TD>{r.supplierName ?? <span className="text-text-muted">No supplier set — receive once or set on the item</span>}</TD>
              <TD className="tabular-nums">{r.unitCostCents != null ? formatRs(Math.round((r.suggestMilli / 1000) * r.unitCostCents), { decimals: 0 }) : '—'}</TD>
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={canOrder ? 7 : 6}>Nothing is at or below its re-order level.</EmptyRow> : null}
        </tbody>
      </Table>
      {canOrder && orderable.length ? (
        <Button className="self-start" onClick={create} disabled={busy || selected.size === 0}>
          {busy ? 'Creating…' : `Create draft orders for ${selected.size} ${selected.size === 1 ? 'item' : 'items'}`}
        </Button>
      ) : null}
    </div>
  );
}
