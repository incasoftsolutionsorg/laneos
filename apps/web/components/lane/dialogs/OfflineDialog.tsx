'use client';

import { useEffect, useState } from 'react';
import { formatRs } from '@laneos/core';
import { Badge, Button, Card } from '@laneos/ui';
import type { QueuedSale } from '@/lib/lane/device';
import { Dialog } from '../Dialog';

const hhmm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Offline · still selling (Figma 11-3260). */
export function OfflineDialog({
  queue, online, offlineSince, nextRetryAt, onRetry, onClose,
}: {
  queue: QueuedSale[]; online: boolean; offlineSince: string | null; nextRetryAt: number | null;
  onRetry: () => void; onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const waiting = queue.reduce((s, q) => s + q.totalCents, 0);
  const retryIn = nextRetryAt ? Math.max(0, Math.round((nextRetryAt - now) / 1000)) : null;

  return (
    <Dialog title={online ? 'Back online' : 'Offline · still selling'} onClose={onClose} width={640}>
      <p className="-mt-2 text-[13px] text-text-muted">
        {online
          ? 'The connection is back. Queued sales are being sent now.'
          : `The internet dropped${offlineSince ? ` at ${hhmm(offlineSince)}` : ''}. Sales are saved on this lane and will sync automatically.`}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-xs text-text-muted">Waiting to sync</p>
          <p className="text-2xl font-bold">{queue.length} {queue.length === 1 ? 'sale' : 'sales'}</p>
          <p className="text-xs"><span className="font-semibold text-danger">{formatRs(waiting, { decimals: 0 })}</span>{offlineSince ? <span className="text-text-muted"> since {hhmm(offlineSince)}</span> : null}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-muted">Next retry</p>
          <p className="text-2xl font-bold">{retryIn == null ? '—' : `${retryIn} s`}</p>
          <p className="text-xs"><span className="font-semibold text-success">auto</span> <span className="text-text-muted">backoff</span></p>
        </Card>
      </div>
      <div className="max-h-56 overflow-y-auto rounded-card border border-border">
        <table className="w-full text-left text-[13px]">
          <thead><tr className="bg-surface-muted text-[11px] font-semibold text-text-muted"><th className="px-4 py-2.5">Sale</th><th className="px-4 py-2.5">Time</th><th className="px-4 py-2.5">Total</th><th className="px-4 py-2.5">Status</th></tr></thead>
          <tbody>
            {queue.map((q) => (
              <tr key={q.clientUuid} className="border-t border-border">
                <td className="px-4 py-2.5 font-mono text-xs">{q.invoiceNo ?? 'number at sync'}</td>
                <td className="px-4 py-2.5">{hhmm(q.queuedAt)}</td>
                <td className="px-4 py-2.5 tabular-nums">{formatRs(q.totalCents, { decimals: 0 })}</td>
                <td className="px-4 py-2.5"><Badge tone="warning">{q.attempts ? `Retry ${q.attempts}` : 'Queued'}</Badge></td>
              </tr>
            ))}
            {queue.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-text-muted">Nothing waiting.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="text-xs font-semibold text-warning">Not available offline: credit notes, member look-up and returns.</p>
      <div className="flex justify-between">
        <Button variant="secondary" onClick={onRetry}>Retry now</Button>
        <Button onClick={onClose}>Continue selling</Button>
      </div>
    </Dialog>
  );
}
