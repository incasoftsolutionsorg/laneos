'use client';

import { useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import type { EmbeddedMode } from '@laneos/barcode';
import { formatRs, formatStock } from '@laneos/core';
import { Alert, Badge, Button, cn, initials } from '@laneos/ui';
import { resolveScan, type CatalogIndex, type CatalogItem, type CatalogPromotion } from '@/lib/lane/cart';
import { Dialog } from '../Dialog';

const TAX: Record<string, string> = { standard: 'VAT standard', exempt: 'VAT exempt', zero: 'Zero-rated' };

function promoText(p: CatalogPromotion) {
  if (p.kind === 'multi_buy') return `${p.buyQty} for ${formatRs(p.bundlePriceCents ?? 0, { decimals: 0 })}`;
  return `${(p.percentBp ?? 0) / 100}% off`;
}

/** F6 price check (Figma 11-2965): scan without adding to the sale. */
export function PriceCheckDialog({
  index, items, promotions, mode, shopCode, onAdd, onClose,
}: {
  index: CatalogIndex; items: CatalogItem[]; promotions: CatalogPromotion[]; mode: EmbeddedMode; shopCode: string;
  onAdd: (item: CatalogItem) => void; onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = (e: React.FormEvent) => {
    e.preventDefault();
    const q = code.trim();
    if (!q) return;
    if (!/^[0-9A-Z-]+$/i.test(q)) {
      const hits = items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
      setItem(hits[0] ?? null);
      setError(hits.length ? null : 'No item matches.');
      return;
    }
    const r = resolveScan(index, q, mode);
    setItem(r.ok ? r.item : null);
    setError(r.ok ? null : r.message);
  };

  const promos = item ? promotions.filter((p) => p.itemIds.includes(item.id)) : [];

  return (
    <Dialog title="Price check" onClose={onClose} width={520} aside={<Badge>F6</Badge>}>
      <form onSubmit={lookup} className="relative">
        <ScanBarcode size={18} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-text-muted" aria-hidden />
        <input
          value={code} onChange={(e) => setCode(e.target.value)} autoFocus aria-label="Scan or type barcode, PLU or name"
          placeholder="Scan or type barcode, PLU or name"
          className="w-full rounded-control border border-brand-primary py-3 pr-3 pl-10 text-[14px] focus:ring-2 focus:ring-brand-light focus:outline-none"
        />
      </form>
      {error ? <Alert tone="warning">{error}</Alert> : null}
      {item ? (
        <div className="flex gap-4 rounded-card bg-surface-muted p-3">
          <span className="flex size-[68px] shrink-0 items-center justify-center rounded-control bg-brand-light text-xl font-bold text-brand-primary">{initials(item.name)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">{item.name}</p>
            <p className="text-[22px] font-bold text-brand-primary">
              {item.priceCents == null ? 'Open price' : `${formatRs(item.priceCents)}${item.itemType === 'weighed' ? ' / kg' : ''}`}
            </p>
            <p className="text-xs text-text-muted">
              {[item.mrpCents != null ? `MRP ${formatRs(item.mrpCents, { decimals: 0 })}` : null, TAX[item.taxClass ?? 'standard'],
                item.itemType === 'open_price' ? null : `Stock ${formatStock(item.stockMilli, item.itemType)} in ${shopCode}`]
                .filter(Boolean).join(' · ')}
            </p>
            <div className={cn('mt-1 flex flex-wrap gap-1.5', promos.length ? '' : 'hidden')}>
              {promos.map((p) => <Badge key={p.id} tone="success">{p.name} · {promoText(p)}</Badge>)}
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex justify-between">
        <Button variant="secondary" onClick={onClose}>Close</Button>
        <Button disabled={!item} onClick={() => item && onAdd(item)}>Add to sale</Button>
      </div>
    </Dialog>
  );
}
