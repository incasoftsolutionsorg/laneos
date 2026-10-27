'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { reportSyncIssue } from '@/app/(lane)/lane/actions';
import { enqueueSale, listQueue, removeQueued, type QueuedSale } from './device';

export type PostResult =
  | { kind: 'ok'; data: { id: string; invoiceNo: string; totalCents: number; changeCents: number; receiptToken: string; pointsEarned?: number; pointsRedeemed?: number } }
  | { kind: 'network' }
  | { kind: 'rejected'; code: string; message: string };

/** POST one sale. A network failure (no answer, timeout, 5xx) is retryable; anything else is a business answer. */
export async function postSale(payload: Record<string, unknown>, laneKey: string | null): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch('/api/lane/sales', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': String(payload.clientUuid),
        ...(laneKey ? { 'X-Lane-Key': laneKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { kind: 'network' };
  }
  const json = await res.json().catch(() => null);
  if (res.ok && json) return { kind: 'ok', data: json };
  if (res.status >= 500 || json?.error?.code === 'BUSY_RETRY') return { kind: 'network' };
  return { kind: 'rejected', code: json?.error?.code ?? 'INTERNAL', message: json?.error?.message ?? 'Rejected' };
}

const BACKOFF = [5, 10, 20, 30, 60];

/** The lane's offline queue (Figma 11-3260): sales saved on the device and synced with backoff. */
export function useSaleQueue(laneId: string, laneKey: string | null) {
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [online, setOnline] = useState(true);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null);
  const attempt = useRef(0);
  const syncing = useRef(false);

  const refresh = useCallback(async () => setQueue(await listQueue(laneId)), [laneId]);

  const markOffline = useCallback(() => {
    setOnline(false);
    setOfflineSince((s) => s ?? new Date().toISOString());
  }, []);

  const syncNow = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const items = await listQueue(laneId);
      for (const item of items) {
        const r = await postSale(item.payload, laneKey);
        if (r.kind === 'network') {
          markOffline();
          await enqueueSale({ ...item, attempts: item.attempts + 1, status: 'queued' });
          const wait = BACKOFF[Math.min(attempt.current, BACKOFF.length - 1)]!;
          attempt.current += 1;
          setNextRetryAt(Date.now() + wait * 1000);
          return;
        }
        if (r.kind === 'rejected') {
          // The server refused it (e.g. price changed): hand it to the back office (Sync issues).
          await reportSyncIssue(laneId, item.clientUuid, item.payload, r.code, r.message).catch(() => undefined);
        }
        await removeQueued(item.clientUuid);
      }
      attempt.current = 0;
      setNextRetryAt(null);
      setOnline(true);
      setOfflineSince(null);
    } finally {
      syncing.current = false;
      await refresh();
    }
  }, [laneId, laneKey, markOffline, refresh]);

  const enqueue = useCallback(async (sale: QueuedSale) => {
    await enqueueSale(sale);
    markOffline();
    attempt.current = 0;
    setNextRetryAt(Date.now() + BACKOFF[0]! * 1000);
    await refresh();
  }, [markOffline, refresh]);

  useEffect(() => {
    void refresh().then(() => listQueue(laneId)).then((q) => { if (q.length) void syncNow(); });
    const goOnline = () => void syncNow();
    const goOffline = () => markOffline();
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    if (!navigator.onLine) markOffline();
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, [laneId, markOffline, refresh, syncNow]);

  // Retry timer.
  useEffect(() => {
    if (nextRetryAt == null) return;
    const t = setTimeout(() => void syncNow(), Math.max(0, nextRetryAt - Date.now()));
    return () => clearTimeout(t);
  }, [nextRetryAt, syncNow]);

  return { queue, online, offlineSince, nextRetryAt, enqueue, syncNow, markOffline };
}
