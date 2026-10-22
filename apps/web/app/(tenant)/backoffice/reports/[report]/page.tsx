import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatRs } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH, tabClass, tabsClass } from '@laneos/ui';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Reports' };

const time = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const REPORTS = { sales: 'Recent sales', shifts: 'Shifts & cash' } as const;

export default async function ReportPage({ params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  if (!(report in REPORTS)) notFound();
  const ctx = await requireTenant('reports.view');

  const tabs = (
    <nav className={tabsClass()} aria-label="Reports">
      {Object.entries(REPORTS).map(([key, label]) => (
        <Link key={key} href={`/backoffice/reports/${key}`} className={tabClass(key === report)} aria-current={key === report ? 'page' : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );

  if (report === 'sales') {
    const { data } = await ctx.supabase
      .from('sales')
      .select('id, invoice_no, created_at, subtotal_cents, promo_cents, total_cents, lane:lanes(code), member:members(display_name), sale_payments(method, amount_cents)')
      .eq('shop_id', ctx.shop.id)
      .order('created_at', { ascending: false })
      .limit(100);
    const rows = data ?? [];
    return (
      <>
        <PageHeader title="Reports" subtitle={`${ctx.shop.name} · last 100 bills`} actions={tabs} />
        <Table>
          <thead>
            <tr><TH>Invoice</TH><TH>Time</TH><TH>Lane</TH><TH>Cashier</TH><TH>Paid by</TH><TH>Savings</TH><TH>Total</TH></tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <TD className="font-mono text-xs">{s.invoice_no}</TD>
                <TD>{time(s.created_at)}</TD>
                <TD>{s.lane?.code}</TD>
                <TD>{s.member?.display_name}</TD>
                <TD className="capitalize">{[...new Set(s.sale_payments.map((p) => p.method.replace('_', ' ')))].join(', ')}</TD>
                <TD className="tabular-nums">{s.promo_cents ? formatRs(s.promo_cents) : '—'}</TD>
                <TD className="font-semibold tabular-nums">{formatRs(s.total_cents)}</TD>
              </tr>
            ))}
            {rows.length === 0 ? <EmptyRow colSpan={7}>No sales yet. Open a lane and make the first sale.</EmptyRow> : null}
          </tbody>
        </Table>
      </>
    );
  }

  const { data } = await ctx.supabase
    .from('shifts')
    .select('id, shift_no, status, opened_at, closed_at, opening_float_cents, expected_cash_cents, counted_cash_cents, lane:lanes(code), member:members!shifts_opened_by_fkey(display_name)')
    .eq('shop_id', ctx.shop.id)
    .order('opened_at', { ascending: false })
    .limit(100);
  const rows = data ?? [];
  return (
    <>
      <PageHeader title="Reports" subtitle={`${ctx.shop.name} · shifts and cash variance`} actions={tabs} />
      <Table>
        <thead>
          <tr><TH>Shift</TH><TH>Lane</TH><TH>Cashier</TH><TH>Opened</TH><TH>Closed</TH><TH>Float</TH><TH>Expected</TH><TH>Counted</TH><TH>Variance</TH></tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const variance = s.counted_cash_cents != null && s.expected_cash_cents != null ? s.counted_cash_cents - s.expected_cash_cents : null;
            return (
              <tr key={s.id}>
                <TD className="font-mono text-xs">#{s.shift_no}</TD>
                <TD>{s.lane?.code}</TD>
                <TD>{s.member?.display_name}</TD>
                <TD>{time(s.opened_at)}</TD>
                <TD>{s.closed_at ? time(s.closed_at) : <Badge tone="success">Open</Badge>}</TD>
                <TD className="tabular-nums">{formatRs(s.opening_float_cents)}</TD>
                <TD className="tabular-nums">{s.expected_cash_cents == null ? '—' : formatRs(s.expected_cash_cents)}</TD>
                <TD className="tabular-nums">{s.counted_cash_cents == null ? '—' : formatRs(s.counted_cash_cents)}</TD>
                <TD>
                  {variance == null ? '—' : variance === 0 ? <Badge tone="success">Balanced</Badge>
                    : <Badge tone="danger">{variance > 0 ? 'Over ' : 'Short '}{formatRs(Math.abs(variance))}</Badge>}
                </TD>
              </tr>
            );
          })}
          {rows.length === 0 ? <EmptyRow colSpan={9}>No shifts yet.</EmptyRow> : null}
        </tbody>
      </Table>
    </>
  );
}
