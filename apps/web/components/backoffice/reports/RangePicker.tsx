'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Input, Select } from '@laneos/ui';

const iso = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Date range for reports: presets plus custom from/to (kept in the URL so links and CSV match). */
export function RangePicker({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const path = usePathname();
  const go = (f: string, t: string) => router.push(`${path}?from=${f}&to=${t}`);
  const today = iso(new Date());
  const presets: [string, string, string][] = [
    ['today', today, today],
    ['7', iso(new Date(Date.now() - 6 * 86_400_000)), today],
    ['30', iso(new Date(Date.now() - 29 * 86_400_000)), today],
    ['month', `${today.slice(0, 8)}01`, today],
    ['last', (() => { const d = new Date(`${today.slice(0, 8)}01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })(),
      iso(new Date(Date.parse(`${today.slice(0, 8)}01T00:00:00+05:30`) - 86_400_000))],
  ];
  const current = presets.find(([, f, t]) => f === from && t === to)?.[0] ?? 'custom';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-40"><Select value={current} aria-label="Date range" onChange={(e) => {
        const p = presets.find(([k]) => k === e.target.value);
        if (p) go(p[1], p[2]);
      }}>
        <option value="today">Today</option>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="month">This month</option>
        <option value="last">Last month</option>
        <option value="custom" disabled>Custom</option>
      </Select></div>
      <div className="w-40"><Input type="date" value={from} max={to} aria-label="From" onChange={(e) => e.target.value && go(e.target.value, to)} /></div>
      <span className="text-xs text-text-muted">to</span>
      <div className="w-40"><Input type="date" value={to} min={from} max={today} aria-label="To" onChange={(e) => e.target.value && go(from, e.target.value)} /></div>
    </div>
  );
}
