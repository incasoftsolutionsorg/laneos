import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs } from '@laneos/core';
import { Badge, Card, CardTitle, EmptyRow, PageHeader, Table, TD, TH, chipClass } from '@laneos/ui';
import { GenerateInvoices, InvoiceActions } from '@/components/admin/AdminForms';
import { fmtDate } from '@/lib/server/dates';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'Platform billing' };

interface Inv { id: string; invoiceNo: string; tenantId: string; tenant: string; plan: string; periodStart: string; amount: number; status: string; dueOn: string; paidAt: string | null; reference: string | null }

// Platform billing (Figma 3-3802, not read — built from blueprint WF-008; compare when Figma access returns).
// PayHere webhooks will mark invoices paid; until the merchant account exists, staff mark bank transfers by hand.
export default async function AdminBillingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = '' } = await searchParams;
  const { supabase } = await requireAdmin();
  const { data } = await supabase.schema('api').rpc('admin_invoices', { p_status: status });
  const rows = (data ?? []) as unknown as Inv[];
  const open = rows.filter((r) => r.status === 'open').reduce((s, r) => s + r.amount, 0);
  const nextMonth = new Date(Date.now() + 5.5 * 3600_000);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  return (
    <>
      <PageHeader title="Billing" subtitle={`${rows.length} invoices${status ? ` (${status})` : ''} · ${formatRs(open, { decimals: 0 })} open`} />
      <Card className="flex flex-col gap-3 p-5">
        <CardTitle>Monthly invoices</CardTitle>
        <p className="text-xs text-text-muted">One invoice per active tenant (and trials that ended) per month, due on the 8th. Running it again only adds tenants that have none.</p>
        <GenerateInvoices defaultPeriod={nextMonth.toISOString().slice(0, 7)} />
      </Card>
      <div className="flex gap-2">{['', 'open', 'paid', 'void'].map((s) => <Link key={s} href={`/admin/billing${s ? `?status=${s}` : ''}`} className={chipClass(s === status)}>{s || 'All'}</Link>)}</div>
      <Table>
        <thead><tr><TH>Invoice</TH><TH>Tenant</TH><TH>Plan</TH><TH>Period</TH><TH className="text-right">Amount</TH><TH>Due</TH><TH>Status</TH><TH /></tr></thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id}>
              <TD className="font-mono text-xs">{i.invoiceNo}</TD>
              <TD><Link href={`/admin/tenants/${i.tenantId}`} className="hover:underline">{i.tenant}</Link></TD>
              <TD>{i.plan}</TD>
              <TD>{i.periodStart.slice(0, 7)}</TD>
              <TD className="text-right tabular-nums">{formatRs(i.amount, { decimals: 0 })}</TD>
              <TD>{fmtDate(i.dueOn)}</TD>
              <TD><Badge tone={i.status === 'paid' ? 'success' : i.status === 'void' ? 'neutral' : 'warning'}>{i.status}</Badge></TD>
              <TD><InvoiceActions id={i.id} status={i.status} /></TD>
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={8}>No invoices.</EmptyRow> : null}
        </tbody>
      </Table>
    </>
  );
}
