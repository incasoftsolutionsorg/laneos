import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH, buttonClass } from '@laneos/ui';
import { PurchasingTabs } from '@/components/backoffice/PurchasingTabs';
import { fmtDate } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Goods received' };

export default async function GrnListPage() {
  const ctx = await requireTenant();
  const { data } = await ctx.supabase.from('grns')
    .select('id, grn_no, status, supplier_invoice_no, received_on, due_on, total_cents, paid_cents, supplier:suppliers(name), po:purchase_orders(po_no)')
    .eq('shop_id', ctx.shop.id).order('created_at', { ascending: false }).limit(200);
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Goods received" subtitle="Deliveries posted to stock, with batches, expiry and what is still payable"
        actions={hasPerm(ctx.member.perms, 'grn.post') ? <Link href="/backoffice/purchasing/grn/new" className={buttonClass('primary')}>Receive goods</Link> : null} />
      <PurchasingTabs active="/backoffice/purchasing/grn" />
      <Table>
        <thead><tr><TH>GRN</TH><TH>Supplier</TH><TH>Invoice</TH><TH>PO</TH><TH>Received</TH><TH>Due</TH><TH>Total</TH><TH>Open</TH><TH>Status</TH></tr></thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id}>
              <TD className="font-mono text-xs"><Link href={`/backoffice/purchasing/grn/${g.id}`} className="text-brand-primary hover:underline">{g.grn_no}</Link></TD>
              <TD className="font-medium">{g.supplier?.name}</TD>
              <TD>{g.supplier_invoice_no ?? '—'}</TD>
              <TD className="font-mono text-xs">{g.po?.po_no ?? '—'}</TD>
              <TD>{fmtDate(g.received_on)}</TD>
              <TD>{g.due_on ? fmtDate(g.due_on) : '—'}</TD>
              <TD className="tabular-nums">{formatRs(g.total_cents)}</TD>
              <TD className="tabular-nums">{g.status === 'posted' ? formatRs(g.total_cents - g.paid_cents) : '—'}</TD>
              <TD>{g.status === 'draft' ? <Badge>Draft</Badge> : g.paid_cents >= g.total_cents ? <Badge tone="success">Paid</Badge> : <Badge tone="warning">Posted</Badge>}</TD>
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={9}>No deliveries yet.</EmptyRow> : null}
        </tbody>
      </Table>
    </>
  );
}
