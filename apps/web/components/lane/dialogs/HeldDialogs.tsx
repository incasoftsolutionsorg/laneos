'use client';

import { useState } from 'react';
import { formatRs } from '@laneos/core';
import { Badge, Button, Field, Input, buttonClass } from '@laneos/ui';
import type { HeldBill } from '@/lib/lane/held';
import { Dialog } from '../Dialog';

const hhmm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** F8: put the current bill aside with a short note. */
export function HoldDialog({ onHold, onClose }: { onHold: (note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState('');
  return (
    <Dialog title="Hold this bill" onClose={onClose} width={420}>
      <form onSubmit={(e) => { e.preventDefault(); onHold(note.trim() || 'Held bill'); }} className="flex flex-col gap-4">
        <Field label="Why is it on hold?" hint="Shown on the held-bills list">
          <Input value={note} onChange={(e) => setNote(e.target.value.slice(0, 60))} placeholder="Customer went to car" autoFocus />
        </Field>
        <Button type="submit">Hold bill</Button>
      </form>
    </Dialog>
  );
}

/** F9: held bills on this lane (Figma 11-2931). */
export function RecallDialog({ bills, onRecall, onClose }: { bills: HeldBill[]; onRecall: (id: string) => void; onClose: () => void }) {
  return (
    <Dialog title="Held bills" onClose={onClose} width={560} aside={<Badge tone="brand">{bills.length} on this lane</Badge>}>
      <ul className="flex flex-col gap-2.5">
        {bills.map((b) => (
          <li key={b.id} className="flex items-center gap-3 rounded-card border border-border p-2.5">
            <Badge tone="brand">{b.id}</Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{b.note}</p>
              <p className="text-xs text-text-muted">{hhmm(b.heldAt)} · {b.cart.length} {b.cart.length === 1 ? 'line' : 'lines'}{b.customer ? ` · ${b.customer.name}` : ''}</p>
            </div>
            <span className="text-[13px] font-bold tabular-nums">{formatRs(b.totalCents)}</span>
            <button type="button" onClick={() => onRecall(b.id)} className={buttonClass('soft')}>Recall</button>
          </li>
        ))}
        {bills.length === 0 ? <li className="py-6 text-center text-[13px] text-text-muted">No held bills.</li> : null}
      </ul>
      <p className="text-xs text-text-muted">Held bills stay on this lane and are cleared when the shift closes.</p>
      <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
    </Dialog>
  );
}
