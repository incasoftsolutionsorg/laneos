import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatRs } from '@laneos/core';
import { A4, A4Header } from '@/components/print/A4';
import { fmtDate } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Wholesale document' };

const TERMS = { cash: 'Cash', credit: 'Credit', cheque: 'Cheque' } as const;

// A4 tax invoice / quotation (Figma 1-1162 "Print A4 invoice"). "Tax invoice" only when VAT registered.
export default async function WholesalePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant('sale.create');
  const [{ data: d }, { data: t }] = await Promise.all([
    ctx.supabase.from('wholesale_docs')
      .select('*, shop:shops(name, address, phone), wholesale_doc_lines(line_no, item_name, unit_label, qty, price_cents, discount_bp, line_total_cents)')
      .eq('id', id).maybeSingle(),
    ctx.supabase.from('tenants').select('vat_registered, vat_no').eq('id', ctx.tenant.id).single(),
  ]);
  if (!d || !d.shop) notFound();
  const vatReg = !!t?.vat_registered;
  const title = d.kind === 'quotation' ? 'Quotation' : vatReg ? 'Tax invoice' : 'Invoice';
  const lines = [...d.wholesale_doc_lines].sort((a, b) => a.line_no - b.line_no);
  const meta: [string, string][] = [['No.', d.doc_no], ['Date', fmtDate(d.created_at)]];
  if (d.kind === 'quotation' && d.valid_until) meta.push(['Valid until', fmtDate(d.valid_until)]);
  if (d.kind === 'invoice') meta.push(['Terms', d.terms === 'credit' ? `Credit ${d.credit_days} days` : TERMS[d.terms]]);
  if (d.due_on) meta.push(['Due', fmtDate(d.due_on)]);

  return (
    <A4 autoPrint>
      <A4Header tenant={ctx.tenant.name} shop={d.shop} vatNo={vatReg ? t?.vat_no : null} title={title} meta={meta} />
      <section>
        <p className="text-black/60">{d.kind === 'quotation' ? 'Prepared for' : 'Bill to'}</p>
        <p className="text-[14px] font-bold">{d.buyer_name}</p>
        {d.buyer_address ? <p>{d.buyer_address}</p> : null}
        {d.buyer_phone ? <p>Tel {d.buyer_phone.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3')}</p> : null}
        {d.buyer_vat_no ? <p>VAT reg. no {d.buyer_vat_no}</p> : null}
      </section>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-black text-[11px] uppercase">
            <th className="py-1.5">#</th><th>Item</th><th>Unit</th><th className="text-right">Qty</th>
            <th className="text-right">Price</th><th className="text-right">Disc.</th><th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.line_no} className="border-b border-black/15">
              <td className="py-1.5">{l.line_no}</td><td>{l.item_name}</td><td>{l.unit_label}</td>
              <td className="text-right tabular-nums">{l.qty}</td>
              <td className="text-right tabular-nums">{formatRs(l.price_cents)}</td>
              <td className="text-right tabular-nums">{l.discount_bp ? `${l.discount_bp / 100}%` : ''}</td>
              <td className="text-right tabular-nums">{formatRs(l.line_total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto flex w-72 flex-col gap-1">
        <Sum label="Subtotal" v={formatRs(d.subtotal_cents)} />
        {d.discount_cents ? <Sum label="Trade discount" v={`− ${formatRs(d.discount_cents)}`} /> : null}
        {vatReg ? <Sum label={d.vat_included ? 'VAT (included)' : 'VAT'} v={formatRs(d.vat_cents)} /> : null}
        <div className="border-t-2 border-black pt-1"><Sum label="Total" v={formatRs(d.total_cents)} bold /></div>
        {d.kind === 'invoice' ? <><Sum label="Paid" v={formatRs(d.paid_cents)} /><Sum label="Balance due" v={formatRs(d.total_cents - d.paid_cents)} bold /></> : null}
      </div>
      <footer className="mt-auto grid grid-cols-2 gap-10 pt-10">
        <p className="border-t border-black pt-1 text-center text-black/60">Prepared by</p>
        <p className="border-t border-black pt-1 text-center text-black/60">{d.kind === 'quotation' ? 'Accepted by' : 'Received in good condition'}</p>
      </footer>
    </A4>
  );
}

function Sum({ label, v, bold }: { label: string; v: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? 'text-[14px] font-bold' : ''}`}><span>{label}</span><span className="tabular-nums">{v}</span></div>;
}
