import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH, buttonClass } from '@laneos/ui';
import { PurchasingTabs } from '@/components/backoffice/PurchasingTabs';
import { fmtDate } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Supplier returns' };

const RETURN_STATUS = { sent: ['Waiting for supplier', 'warning'], credited: ['Credited', 'success'], rejected: ['Refused', 'danger'] } as const;

// Supplier returns (blueprint SLICE-008 / §30.1; no Figma frame): goods sent back and the supplier's answer.
export default async function SupplierReturnsPage() {
  const ctx = await requireTenant();
  const { data } = await ctx.supabase.from('supplier_returns')
    .select('id, return_no, status, value_cents, credit_cents, created_at, supplier:suppliers(name), supplier_return_lines(id)')
    .eq('shop_id', ctx.shop.id).order('created_at', { ascending: false }).limit(200);
  const rows = data ?? [];
  const waiting = rows.filter((r) => r.status === 'sent').reduce((s, r) => s + r.value_cents, 0);
  return (
    <>
      <PageHeader title="Purchasing" subtitle={`Supplier returns · ${formatRs(waiting, { decimals: 0 })} waiting for a supplier's answer`}
        actions={hasPerm(ctx.member.perms, 'stock.adjust') ? <Link href="/backoffice/purchasing/returns/new" className={buttonClass('primary')}>+ Return goods</Link> : null} />
      <PurchasingTabs active="/backoffice/purchasing/returns" />
      <Table>
        <thead><tr><TH>Return</TH><TH>Supplier</TH><TH>Sent</TH><TH>Lines</TH><TH className="text-right">Value</TH><TH className="text-right">Credit</TH><TH>Status</TH></tr></thead>
        <tbody>
          {rows.map((r) => {
            const [text, tone] = RETURN_STATUS[r.status];
            return (
              <tr key={r.id}>
                <TD className="font-mono text-xs"><Link href={`/backoffice/purchasing/returns/${r.id}`} className="text-brand-primary hover:underline">{r.return_no}</Link></TD>
                <TD>{r.supplier?.name}</TD>
                <TD>{fmtDate(r.created_at)}</TD>
                <TD className="tabular-nums">{r.supplier_return_lines.length}</TD>
                <TD className="text-right tabular-nums">{formatRs(r.value_cents, { decimals: 0 })}</TD>
                <TD className="text-right tabular-nums">{r.credit_cents != null ? formatRs(r.credit_cents, { decimals: 0 }) : '—'}</TD>
                <TD><Badge tone={tone}>{text}</Badge></TD>
              </tr>
            );
          })}
          {rows.length === 0 ? <EmptyRow colSpan={7}>No supplier returns yet.</EmptyRow> : null}
        </tbody>
      </Table>
    </>
  );
}
