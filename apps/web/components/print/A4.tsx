'use client';

import { Fragment, useEffect } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@laneos/ui';

// A4 documents (statement, tax invoice, quotation — Figma 1-1162): a sheet on screen, plain paper when printed.

export function A4({ children, autoPrint = false }: { children: React.ReactNode; autoPrint?: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [autoPrint]);
  return (
    <div className="min-h-screen bg-background py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex w-[210mm] justify-end gap-2 print:hidden">
        <Button variant="secondary" onClick={() => window.close()}>Close</Button>
        <Button onClick={() => window.print()}><Printer size={16} aria-hidden /> Print</Button>
      </div>
      <article className="mx-auto flex min-h-[297mm] w-[210mm] flex-col gap-6 bg-white p-[16mm] text-[12px] leading-relaxed text-black shadow-sm print:min-h-0 print:p-0 print:shadow-none">
        {children}
      </article>
    </div>
  );
}

export function A4Header({
  tenant, shop, title, meta, vatNo,
}: {
  tenant: string; shop: { name: string; address?: string | null; phone?: string | null }; title: string;
  meta: [string, string][]; vatNo?: string | null;
}) {
  return (
    <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-4">
      <div>
        <p className="text-[18px] font-bold">{tenant}</p>
        <p>{shop.name}</p>
        {shop.address ? <p>{shop.address}</p> : null}
        {shop.phone ? <p>Tel {shop.phone.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3')}</p> : null}
        {vatNo ? <p>VAT reg. no {vatNo}</p> : null}
      </div>
      <div className="text-right">
        <p className="text-[20px] font-bold uppercase tracking-wide">{title}</p>
        <dl className="mt-1 grid grid-cols-[auto_auto] justify-end gap-x-3">
          {meta.map(([k, v]) => <Fragment key={k}><dt className="text-black/60">{k}</dt><dd className="font-semibold">{v}</dd></Fragment>)}
        </dl>
      </div>
    </header>
  );
}
