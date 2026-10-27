'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';

// Building blocks for the 80 mm print templates (Figma 11-285, 11-1635, 11-1759): Roboto Mono,
// dashed rules, label/value rows. Width 72 mm = the printable area of an 80 mm roll.

export function Paper({ children, width = '72mm' }: { children: React.ReactNode; width?: string }) {
  return (
    <article className="receipt mx-auto bg-white px-3 py-4 font-mono text-[11px] leading-[1.55] text-black" style={{ width }}>
      {children}
    </article>
  );
}

export const Rule = () => <div className="my-1.5 text-center tracking-[-0.05em] text-black/70" aria-hidden>--------------------------------</div>;

export function Row({ label, value, bold, big }: { label: React.ReactNode; value?: React.ReactNode; bold?: boolean; big?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''} ${big ? 'text-[15px] font-bold' : ''}`}>
      <span>{label}</span>
      {value != null ? <span className="text-right tabular-nums">{value}</span> : null}
    </div>
  );
}

/** Shop name and address with the logo on the left; the logo prints in black and white (thermal printers). */
export function ShopHeader({ name, lines, logo = true, logoUrl }: { name: string; lines: (string | null | undefined)[]; logo?: boolean; logoUrl?: string | null }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return (
    <header className="flex items-start gap-3">
      {logo && logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-[52px] shrink-0 object-contain grayscale contrast-200" />
      ) : logo ? <span className="flex size-[52px] shrink-0 items-center justify-center rounded-md bg-black text-[15px] font-bold text-white">{initials}</span> : null}
      <div className={`flex-1 ${logo ? 'text-right' : 'text-center'}`}>
        <p className="text-[12px] font-bold uppercase">{name}</p>
        {lines.filter(Boolean).map((l) => <p key={l}>{l}</p>)}
      </div>
    </header>
  );
}

export function Qr({ text, size = 84 }: { text: string; size?: number }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then(setSvg).catch(() => setSvg(''));
  }, [text]);
  return <span className="inline-block" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} aria-label="QR code" />;
}

export function Code128({ value, height = 34 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, value, { format: 'CODE128', height, width: 1.2, margin: 0, displayValue: false });
  }, [value, height]);
  return <svg ref={ref} aria-label={`Barcode ${value}`} />;
}

export const printDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso)).replace(',', '');
