'use client';

// Device-local storage for a lane (blueprint §27.5.1): the lane key lives in IndexedDB, is never a
// cookie, and is sent only as the X-Lane-Key header. The offline sale queue lives here too.

const DB_NAME = 'laneos';
const DB_VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'clientUuid' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const getLaneKey = (laneId: string) =>
  run<string | undefined>('keys', 'readonly', (s) => s.get(laneId) as IDBRequest<string | undefined>);
export const setLaneKey = (laneId: string, key: string) => run('keys', 'readwrite', (s) => s.put(key, laneId));

export interface QueuedSale {
  clientUuid: string;
  laneId: string;
  invoiceNo: string | null;
  totalCents: number;
  queuedAt: string;
  attempts: number;
  status: 'queued' | 'syncing' | 'failed';
  lastError?: string;
  payload: Record<string, unknown>;
}

export const enqueueSale = (sale: QueuedSale) => run('queue', 'readwrite', (s) => s.put(sale));
export const removeQueued = (clientUuid: string) => run('queue', 'readwrite', (s) => s.delete(clientUuid));
export async function listQueue(laneId: string): Promise<QueuedSale[]> {
  const all = await run<QueuedSale[]>('queue', 'readonly', (s) => s.getAll() as IDBRequest<QueuedSale[]>);
  return all.filter((q) => q.laneId === laneId).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

const LAST_LANE = 'laneos-last-lane';
export const rememberLane = (laneId: string) => { try { localStorage.setItem(LAST_LANE, laneId); } catch { /* private mode */ } };
export const lastLane = () => { try { return localStorage.getItem(LAST_LANE); } catch { return null; } };
