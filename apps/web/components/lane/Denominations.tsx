'use client';

import { formatRs, parseRupees } from '@laneos/core';
import { Input } from '@laneos/ui';

// Sri Lankan notes, largest first; coins are entered as one amount (Figma 11-2885, 1-4331).
export const NOTES = [500000, 100000, 50000, 10000, 5000, 2000] as const;

export type Denoms = Record<string, number>; // note value in cents → count; "coins" → cents

export function denomsTotal(d: Denoms): number {
  return Object.entries(d).reduce((sum, [k, v]) => sum + (k === 'coins' ? v : Number(k) * v), 0);
}

export function DenominationTable({ value, onChange }: { value: Denoms; onChange: (d: Denoms) => void }) {
  const set = (k: string, v: number) => onChange({ ...value, [k]: v });
  return (
    <div className="overflow-hidden rounded-card border border-border">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="bg-surface-muted text-[11px] font-semibold text-text-muted">
            <th className="px-3 py-2.5">Note / coin</th><th className="px-3 py-2.5">Count</th><th className="px-3 py-2.5">Amount</th>
          </tr>
        </thead>
        <tbody>
          {NOTES.map((n) => (
            <tr key={n} className="border-t border-border">
              <td className="px-3 py-1.5">{formatRs(n, { decimals: 0 })}</td>
              <td className="px-3 py-1.5">
                <Input
                  type="number" min={0} max={9999} inputMode="numeric" aria-label={`Number of ${formatRs(n, { decimals: 0 })} notes`}
                  value={value[String(n)] || ''} placeholder="0"
                  onChange={(e) => set(String(n), Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                  className="w-24 py-1.5"
                />
              </td>
              <td className="px-3 py-1.5 tabular-nums">{formatRs(n * (value[String(n)] ?? 0), { decimals: 0 })}</td>
            </tr>
          ))}
          <tr className="border-t border-border">
            <td className="px-3 py-1.5">Coins</td>
            <td className="px-3 py-1.5 text-text-muted">—</td>
            <td className="px-3 py-1.5">
              <Input
                inputMode="decimal" aria-label="Coins total in rupees" placeholder="0.00"
                defaultValue={value.coins ? (value.coins / 100).toFixed(2) : ''}
                onChange={(e) => set('coins', parseRupees(e.target.value || '0') ?? 0)}
                className="w-28 py-1.5"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
