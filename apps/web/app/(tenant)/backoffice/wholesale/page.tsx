import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { WholesaleEditor, type WsItem } from '@/components/backoffice/WholesaleEditor';
import { colomboToday, fmtDate } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Wholesale billing' };

// Wholesale invoice (Figma 1-1162) + recent invoices and quotations. ?from=<quotation id> converts a quotation.
export default async function WholesalePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const ctx = await requireTenant('sale.create');
  const today = colomboToday();
  const [{ data: items }, { data: list }, { data: codes }, { data: customers }, { data: t }, { data: rate }, { data: docs }, { data: quote }] = await Promise.all([
    ctx.supabase.from('items').select('id, name, plu, tax_class, wholesale_cents').eq('is_active', true).order('name').limit(5000),
    ctx.supabase.from('price_list_items').select('item_id, price_cents, price_list:price_lists!inner(is_default)').eq('price_list.is_default', true).limit(5000),
    ctx.supabase.from('barcodes').select('item_id, code, pack_qty').limit(10000),
    ctx.supabase.from('customers').select('id, name, phone, credit_limit_cents, balance_due_cents').eq('is_active', true).order('name').limit(1000),
    ctx.supabase.from('tenants').select('vat_registered, prices_include_vat, customer_credit_days').eq('id', ctx.tenant.id).single(),
    ctx.supabase.from('tax_rates').select('rate_bp').eq('tax_class', 'standard').lte('effective_from', today).order('effective_from', { ascending: false }).limit(1).maybeSingle(),
    ctx.supabase.from('wholesale_docs').select('id, kind, doc_no, status, buyer_name, total_cents, paid_cents, created_at, valid_until').eq('shop_id', ctx.shop.id).order('created_at', { ascending: false }).limit(30),
    from ? ctx.supabase.from('wholesale_docs').select('id, kind, customer_id, buyer_name, buyer_address, buyer_vat_no, buyer_phone, wholesale_doc_lines(item_id, pack_qty, qty, price_cents, discount_bp, line_no)').eq('id', from).eq('kind', 'quotation').maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const price = new Map((list ?? []).map((p) => [p.item_id, p.price_cents]));
  const bc = new Map<string, { codes: string[]; packs: Set<number> }>();
  for (const b of codes ?? []) {
    const e = bc.get(b.item_id) ?? { codes: [], packs: new Set<number>() };
    e.codes.push(b.code); if (b.pack_qty > 1) e.packs.add(b.pack_qty);
    bc.set(b.item_id, e);
  }
  const wsItems: WsItem[] = (items ?? []).filter((i) => price.has(i.id) || i.wholesale_cents != null).map((i) => ({
    id: i.id, name: i.name, plu: i.plu, taxClass: i.tax_class, barcodes: bc.get(i.id)?.codes ?? [],
    listCents: price.get(i.id) ?? i.wholesale_cents ?? 0, wholesaleCents: i.wholesale_cents,
    packs: [...(bc.get(i.id)?.packs ?? [])].sort((a, b) => a - b),
  }));
  const canInvoice = hasPerm(ctx.member.perms, 'customer.manage');

  return (
    <>
      <PageHeader title="Wholesale invoice" subtitle={quote ? `Converting quotation for ${quote.buyer_name}` : 'Sell in cases to retailers with wholesale prices and credit terms'} />
      {!canInvoice ? <p className="text-[13px] text-text-muted">You can prepare quotations. Issuing an invoice needs the Customers &amp; credit permission.</p> : null}
      <WholesaleEditor
        key={quote?.id ?? 'new'}
        items={wsItems}
        customers={(customers ?? []).map((c) => ({ id: c.id, name: c.name, phone: c.phone, limitCents: c.credit_limit_cents, balanceCents: c.balance_due_cents }))}
        vat={{ registered: !!t?.vat_registered, included: t?.prices_include_vat ?? true, rateBp: rate?.rate_bp ?? 0 }}
        creditDays={t?.customer_credit_days ?? 30}
        initial={quote ? {
          quotationId: quote.id, customerId: quote.customer_id,
          buyer: { name: quote.buyer_name, address: quote.buyer_address ?? '', vatNo: quote.buyer_vat_no ?? '', phone: quote.buyer_phone ?? '' },
          lines: [...quote.wholesale_doc_lines].sort((a, b) => a.line_no - b.line_no).map((l) => ({ itemId: l.item_id, packQty: l.pack_qty, qty: l.qty, priceCents: l.price_cents, discountBp: l.discount_bp })),
        } : undefined}
      />
      <h2 className="text-[15px] font-semibold">Recent invoices & quotations</h2>
      <Table>
        <thead><tr><TH>No.</TH><TH>Date</TH><TH>Buyer</TH><TH>Total</TH><TH>Balance</TH><TH>Status</TH><TH /></tr></thead>
        <tbody>
          {(docs ?? []).map((d) => (
            <tr key={d.id}>
              <TD className="font-mono text-xs">{d.doc_no}</TD>
              <TD>{fmtDate(d.created_at)}</TD>
              <TD>{d.buyer_name}</TD>
              <TD className="tabular-nums">{formatRs(d.total_cents, { decimals: 0 })}</TD>
              <TD className="tabular-nums">{d.kind === 'invoice' ? formatRs(d.total_cents - d.paid_cents, { decimals: 0 }) : '—'}</TD>
              <TD>
                {d.kind === 'invoice' ? <Badge tone="success">Invoice</Badge>
                  : d.status === 'converted' ? <Badge>Quotation · invoiced</Badge>
                  : d.valid_until && d.valid_until < today ? <Badge tone="warning">Quotation · expired</Badge>
                  : <Badge tone="info">Quotation</Badge>}
              </TD>
              <TD>
                <span className="flex gap-3 text-xs font-semibold">
                  <Link href={`/print/wholesale/${d.id}`} target="_blank" className="text-brand-primary hover:underline">Print A4</Link>
                  {d.kind === 'quotation' && d.status === 'open' && canInvoice ? <Link href={`/backoffice/wholesale?from=${d.id}`} className="text-brand-primary hover:underline">Invoice it</Link> : null}
                </span>
              </TD>
            </tr>
          ))}
          {(docs ?? []).length === 0 ? <EmptyRow colSpan={7}>No wholesale invoices or quotations yet.</EmptyRow> : null}
        </tbody>
      </Table>
    </>
  );
}
