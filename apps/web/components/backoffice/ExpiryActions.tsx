'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatQty, type ItemType } from '@laneos/core';
import { Alert, Button, Field, Input } from '@laneos/ui';
import { Dialog } from '@/components/lane/Dialog';
import { reducedSticker, writeOffBatch } from '@/app/(tenant)/backoffice/stock/expiry/actions';

export function ExpiryActions({ itemId, name, batchNo, leftMilli, itemType, suggestCents, expired }: {
  itemId: string; name: string; batchNo: string | null; leftMilli: number; itemType: ItemType; suggestCents: number | null; expired: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<'sticker' | 'writeoff' | null>(null);
  const [price, setPrice] = useState(suggestCents != null ? (suggestCents / 100).toFixed(2) : '');
  const [copies, setCopies] = useState(String(Math.max(1, Math.min(100, Math.round(leftMilli / 1000)))));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<{ error?: string }>) => {
    setBusy(true); setError(null);
    const r = await fn();
    setBusy(false);
    if (r.error) setError(r.error); else { setOpen(null); router.refresh(); }
  };

  return (
    <>
      <span className="flex gap-3 text-xs font-semibold">
        {!expired ? <button type="button" className="text-brand-primary hover:underline" onClick={() => setOpen('sticker')}>Sticker</button> : null}
        <button type="button" className="text-danger hover:underline" onClick={() => setOpen('writeoff')}>Write off</button>
      </span>
      {open === 'sticker' ? (
        <Dialog title={`Reduced sticker · ${name}`} onClose={() => setOpen(null)}>
          {error ? <Alert>{error}</Alert> : null}
          <Field label="Reduced price (Rs)"><Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" autoFocus /></Field>
          <Field label="Stickers"><Input value={copies} onChange={(e) => setCopies(e.target.value)} type="number" min={1} max={100} /></Field>
          <p className="text-xs text-text-muted">The sticker is queued in Print labels. The lane keeps charging the list price until markdown pricing (M6); reduce the price on the item if it must ring up lower.</p>
          <Button disabled={busy} onClick={() => run(() => reducedSticker(itemId, price, Number(copies) || 1))}>Queue sticker</Button>
        </Dialog>
      ) : null}
      {open === 'writeoff' ? (
        <Dialog title={`Write off · ${name}`} onClose={() => setOpen(null)}>
          {error ? <Alert>{error}</Alert> : null}
          <p className="text-[13px]">Remove {formatQty(leftMilli, itemType)}{batchNo ? ` of batch ${batchNo}` : ''} from stock as wastage?</p>
          <Button variant="danger" disabled={busy} onClick={() => run(() => writeOffBatch(itemId, leftMilli, batchNo))}>Write off</Button>
        </Dialog>
      ) : null}
    </>
  );
}
