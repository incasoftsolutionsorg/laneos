import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { InvoiceActions } from '@/components/admin/AdminForms';
import { STATUS_TONE } from '@/lib/admin-ui';
import { fmtDate } from '@/lib/server/dates';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'Overdue accounts' };

interface Inv { id: string; invoiceNo: string; tenantId: string; tenant: string; amount: number; status: string; dueOn: string }

// Overdue accounts (Figma 3-4028, not read — compare when Figma access returns). Suspend from the tenant page.
export default async function OverduePage() {
  const { supabase } = await requireAdmin();
  const [{ data }, { data: tenants }] = await Promise.all([
    supabase.schema('api').rpc('admin_invoices', { p_status: 'open' }),
    supabase.schema('api').rpc('admin_tenants', { p_search: '', p_status: '' }),
  ]);
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const info = new Map(((tenants ?? []) as unknown as { id: string; status: string; owner: string | null }[]).map((t) => [t.id, t]));
  const rows = ((data ?? []) as unknown as Inv[]).filter((i) => i.dueOn < today)
    .map((i) => ({ ...i, days: Math.floor((Date.parse(today) - Date.parse(i.dueOn)) / 86_400_000) }))
    .sort((a, b) => b.days - a.days);
  return (
    <>
      <PageHeader title="Overdue accounts" subtitle={`${rows.length} unpaid invoices past due · ${formatRs(rows.reduce((s, r) => s + r.amount, 0), { decimals: 0 })}`} />
      <Table>
        <thead><tr><TH>Tenant</TH><TH>Owner</TH><TH>Invoice</TH><TH className="text-right">Amount</TH><TH>Due</TH><TH>Late</TH><TH>Account</TH><TH /></tr></thead>
        <tbody>
          {rows.map((i) => {
            const t = info.get(i.tenantId);
            return (
              <tr key={i.id}>
                <TD className="font-medium"><Link href={`/admin/tenants/${i.tenantId}`} className="hover:underline">{i.tenant}</Link></TD>
                <TD className="text-xs">{t?.owner ?? '—'}</TD>
                <TD className="font-mono text-xs">{i.invoiceNo}</TD>
                <TD className="text-right tabular-nums">{formatRs(i.amount, { decimals: 0 })}</TD>
                <TD>{fmtDate(i.dueOn)}</TD>
                <TD><Badge tone={i.days > 14 ? 'danger' : 'warning'}>{i.days} days</Badge></TD>
                <TD>{t ? <Badge tone={STATUS_TONE[t.status] ?? 'neutral'}>{t.status.replace('_', ' ')}</Badge> : '—'}</TD>
                <TD><InvoiceActions id={i.id} status={i.status} /></TD>
              </tr>
            );
          })}
          {rows.length === 0 ? <EmptyRow colSpan={8}>Nobody is overdue.</EmptyRow> : null}
        </tbody>
      </Table>
      <p className="text-xs text-text-muted">More than 14 days late: consider setting the account to “past due” or “suspended” on the tenant page (suspended accounts cannot sell).</p>
    </>
  );
}
