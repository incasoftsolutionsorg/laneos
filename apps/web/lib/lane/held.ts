'use client';

import type { CartLine } from './cart';

// Held bills stay on the lane (Figma 11-2931): they never leave the device and are cleared at shift close.

export interface HeldBill {
  id: string;            // H-01, H-02…
  note: string;
  heldAt: string;
  cart: CartLine[];
  customer: { id: string; name: string; phone: string; balanceDueCents: number; loyaltyPoints?: number } | null;
  totalCents: number;
}

const key = (laneId: string) => `laneos-held-${laneId}`;

export function listHeld(laneId: string): HeldBill[] {
  try {
    return JSON.parse(localStorage.getItem(key(laneId)) ?? '[]') as HeldBill[];
  } catch {
    return [];
  }
}

function save(laneId: string, bills: HeldBill[]) {
  try { localStorage.setItem(key(laneId), JSON.stringify(bills)); } catch { /* storage full or blocked */ }
}

export function holdBill(laneId: string, bill: Omit<HeldBill, 'id' | 'heldAt'>): HeldBill {
  const bills = listHeld(laneId);
  const next = bills.reduce((n, b) => Math.max(n, Number(b.id.slice(2)) || 0), 0) + 1;
  const held: HeldBill = { ...bill, id: `H-${String(next).padStart(2, '0')}`, heldAt: new Date().toISOString() };
  save(laneId, [...bills, held]);
  return held;
}

export function takeHeld(laneId: string, id: string): HeldBill | null {
  const bills = listHeld(laneId);
  const bill = bills.find((b) => b.id === id) ?? null;
  save(laneId, bills.filter((b) => b.id !== id));
  return bill;
}

export function clearHeld(laneId: string) {
  try { localStorage.removeItem(key(laneId)); } catch { /* ignore */ }
}
