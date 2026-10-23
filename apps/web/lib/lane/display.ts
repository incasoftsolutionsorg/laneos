'use client';

// The checkout screen publishes the current basket; the customer display window (same browser,
// second monitor) listens. Nothing leaves the device.

export interface DisplayState {
  tenantName: string;
  lines: { name: string; detail: string; amountCents: number; promo?: { name: string; cents: number } }[];
  totalCents: number;
  savingsCents: number;
  status: 'idle' | 'selling' | 'paid';
  changeCents?: number;
  promotion?: { name: string; detail: string } | null;
}

const channelName = (laneId: string) => `laneos-display-${laneId}`;

export function publishDisplay(laneId: string, state: DisplayState) {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(channelName(laneId));
  ch.postMessage(state);
  ch.close();
  // localStorage (not sessionStorage) so a display window opened later starts with the current basket.
  try { localStorage.setItem(channelName(laneId), JSON.stringify(state)); } catch { /* ignore */ }
}

export function subscribeDisplay(laneId: string, onState: (s: DisplayState) => void): () => void {
  try {
    const last = localStorage.getItem(channelName(laneId));
    if (last) onState(JSON.parse(last) as DisplayState);
  } catch { /* ignore */ }
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const ch = new BroadcastChannel(channelName(laneId));
  ch.onmessage = (e) => onState(e.data as DisplayState);
  return () => ch.close();
}
