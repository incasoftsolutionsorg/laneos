'use client';

import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { isValidGtin } from '@laneos/barcode';
import { formatRs } from '@laneos/core';
import { LABEL_SIZES, unitPriceText, type LabelFormat } from '@/lib/labels';

export interface LabelData {
  name: string;
  priceCents: number;
  itemType: string;
  reason: 'price_changed' | 'new_item' | 'promotion' | 'reduced' | 'manual';
  /** Before the change (price_changed), or the reduced price (reduced). */
  otherPriceCents: number | null;
  barcode: string | null;
  promoText: string | null;
  copies: number;
}

export interface LabelOptions { format: LabelFormat; unitPrice: boolean; barcode: boolean; wasPrice: boolean }

function Bars({ code }: { code: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ean = /^\d{13}$/.test(code) && isValidGtin(code);
    JsBarcode(ref.current, ean ? code.slice(0, 12) : code, { format: ean ? 'EAN13' : 'CODE128', height: 22, width: 1, margin: 0, displayValue: false });
  }, [code]);
  return <svg ref={ref} aria-label={`Barcode ${code}`} className="max-w-full" />;
}

// Shelf labels, stickers and reduced stickers (Figma 11-2830).
export function LabelSheet({ labels, opts }: { labels: LabelData[]; opts: LabelOptions }) {
  const size = LABEL_SIZES[opts.format];
  const all = labels.flatMap((l) => Array.from({ length: l.copies }, () => l));
  return (
    <div className="labels flex flex-wrap gap-[2mm] bg-white p-[4mm] text-black" data-format={opts.format}>
      {all.map((l, i) => {
        const reduced = l.reason === 'reduced' && l.otherPriceCents != null;
        const price = reduced ? l.otherPriceCents! : l.priceCents;
        const was = !reduced && opts.wasPrice && l.reason === 'price_changed' && l.otherPriceCents != null && l.otherPriceCents > l.priceCents ? l.otherPriceCents : null;
        const unit = opts.unitPrice ? unitPriceText(l.name, price, l.itemType) : null;
        return (
          <div key={i} className={`flex flex-col justify-between overflow-hidden border border-black p-[2mm] break-inside-avoid ${reduced ? 'bg-[#fde047]' : ''}`}
            style={{ width: size.w, height: size.h }}>
            {reduced ? <p className="text-[9pt] leading-none font-bold text-[#dc2626]">REDUCED</p> : null}
            <p className="truncate text-[7pt] leading-tight font-semibold">{l.name}</p>
            {was ? <p className="text-[6pt] leading-none text-[#64748b]">Was {formatRs(was)}</p> : null}
            <p className={`leading-none font-bold ${opts.format === 'sticker' ? 'text-[11pt]' : 'text-[14pt]'} ${was ? 'text-[#dc2626]' : ''}`}>
              {reduced ? 'Now ' : ''}{formatRs(price)}{l.itemType === 'weighed' ? ' /kg' : ''}
            </p>
            {l.promoText ? <p className="text-[6pt] leading-none text-[#64748b]">{l.promoText}</p> : unit ? <p className="text-[6pt] leading-none text-[#64748b]">{unit}</p> : null}
            {opts.barcode && l.barcode ? <Bars code={l.barcode} /> : null}
          </div>
        );
      })}
    </div>
  );
}
