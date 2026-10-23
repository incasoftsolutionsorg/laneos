'use client';

import { useState } from 'react';
import { formatRs } from '@laneos/core';
import { cn } from '@laneos/ui';

/** Daily sales bars (Figma 1-4536). One series: no legend; the card title names it. The last day is
 *  drawn in the brand colour. Hover or focus a bar for the day's figures. */
export function DailyBars({ days }: { days: { day: string; net: number; bills: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.net));
  const label = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00+05:30`));
  const step = Math.ceil(days.length / 16); // keep axis labels from colliding on long ranges
  const h = hover != null ? days[hover] : null;

  return (
    <div className="relative">
      <div className="flex h-40 items-end gap-0.5" role="list" aria-label="Net sales per day">
        {days.map((d, i) => (
          <button
            key={d.day}
            type="button"
            role="listitem"
            aria-label={`${label(d.day)}: ${formatRs(d.net, { decimals: 0 })}, ${d.bills} bills`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            className="flex h-full flex-1 items-end focus:outline-none"
          >
            <span
              className={cn('w-full rounded-t-[4px] transition-opacity', i === days.length - 1 ? 'bg-brand-primary' : 'bg-chart-bar', hover != null && hover !== i && 'opacity-60')}
              style={{ height: `${Math.max(d.net > 0 ? 2 : 0, (d.net / max) * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-0.5 text-[10px] text-text-muted" aria-hidden>
        {days.map((d, i) => <span key={d.day} className="flex-1 text-center">{i % step === 0 ? d.day.slice(8).replace(/^0/, '') : ''}</span>)}
      </div>
      {h ? (
        <div className="pointer-events-none absolute top-0 rounded-control border border-border bg-surface px-3 py-2 text-xs shadow-md"
          style={{ left: `clamp(0px, calc(${((hover! + 0.5) / days.length) * 100}% - 70px), calc(100% - 140px))` }}>
          <p className="font-semibold">{label(h.day)}</p>
          <p className="tabular-nums">{formatRs(h.net, { decimals: 0 })} · {h.bills} bills</p>
        </div>
      ) : null}
    </div>
  );
}
