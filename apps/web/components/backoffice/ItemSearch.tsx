'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn, inputClass } from '@laneos/ui';

export interface PickItem { id: string; name: string; barcodes?: string[]; plu?: number | null }

/** Type-ahead over a preloaded item list (name, barcode or PLU). Calls onPick and clears. */
export function ItemSearch<T extends PickItem>({ items, onPick, placeholder = 'Search or scan an item', exclude }: {
  items: T[]; onPick: (item: T) => void; placeholder?: string; exclude?: Set<string>;
}) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return items
      .filter((i) => !exclude?.has(i.id))
      .filter((i) => i.name.toLowerCase().includes(s) || i.barcodes?.some((b) => b.toLowerCase() === s) || String(i.plu ?? '') === s)
      .slice(0, 8);
  }, [q, items, exclude]);

  const pick = (i: T) => { onPick(i); setQ(''); };

  return (
    <div className="relative">
      <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" aria-hidden />
      <input
        value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className={cn(inputClass, 'pl-9')}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (matches[0]) pick(matches[0]); } }}
      />
      {matches.length ? (
        <ul className="absolute z-20 mt-1 w-full rounded-card border border-border bg-surface py-1 shadow-lg">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-[13px] hover:bg-surface-muted" onClick={() => pick(m)}>{m.name}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
