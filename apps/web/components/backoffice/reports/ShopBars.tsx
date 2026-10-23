'use client';

import { useState } from 'react';
import { formatRs } from '@laneos/core';
import { cn } from '@laneos/ui';

/** Revenue by shop (Figma 3-261). One series, so no legend; the highlighted bar is the shop open in the back office. */
export function ShopBars({ bars, highlight }: { bars: { id: string; code: string; name: string; value: number; note?: string }[]; highlight?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const h = hover != null ? bars[hover] : null;
  return (
    <div className="relative">
      <div className="flex h-44 items-end gap-2" role="list" aria-label="Revenue by shop">
        {bars.map((b, i) => (
          <button key={b.id} type="button" role="listitem" aria-label={`${b.name}: ${formatRs(b.value, { decimals: 0 })}`}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            className="flex h-full flex-1 items-end focus:outline-none">
            <span className={cn('w-full rounded-t-[4px]', b.id === highlight ? 'bg-brand-primary' : 'bg-chart-bar', hover != null && hover !== i && 'opacity-60')}
              style={{ height: `${Math.max(b.value > 0 ? 2 : 0, (b.value / max) * 100)}%` }} />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2 text-[10px] text-text-muted" aria-hidden>
        {bars.map((b) => <span key={b.id} className="flex-1 truncate text-center">{b.code}</span>)}
      </div>
      {h ? (
        <div className="pointer-events-none absolute top-0 rounded-control border border-border bg-surface px-3 py-2 text-xs shadow-md"
          style={{ left: `clamp(0px, calc(${((hover! + 0.5) / bars.length) * 100}% - 80px), calc(100% - 160px))` }}>
          <p className="font-semibold">{h.name}</p>
          <p className="tabular-nums">{formatRs(h.value, { decimals: 0 })}{h.note ? ` · ${h.note}` : ''}</p>
        </div>
      ) : null}
    </div>
  );
}
