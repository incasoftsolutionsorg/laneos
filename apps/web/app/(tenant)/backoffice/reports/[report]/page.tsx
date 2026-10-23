import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, Card, CardTitle, EmptyRow, PageHeader, Table, TD, TH, buttonClass, cn, tabClass, tabsClass } from '@laneos/ui';
import { DailyBars } from '@/components/backoffice/reports/DailyBars';
import { RangePicker } from '@/components/backoffice/reports/RangePicker';
import {
  REPORT_TABS, formatCell, loadReport, readRange, reportTable,
  type DamageData, type NotesData, type ReportKey, type SalesData, type TaxData,
} from '@/lib/reports';
import { fmtDateTime } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Reports' };

// Reports (Figma 1-4536): Sales, Margin, Items, Stock, Damage & wastage, Credit notes, Tax; date range;
// CSV export. "Shifts & cash" (sidebar) is the shift list below.
export default async function ReportPage({ params, searchParams }: { params: Promise<{ report: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { report } = await params;
  if (report === 'shifts') return <ShiftsReport />;
  if (!(report in REPORT_TABS)) notFound();
  const key = report as ReportKey;
  const ctx = await requireTenant('reports.view');
  const sp = await searchParams;
  const { from, to } = readRange(sp.from, sp.to);
  const { data: t } = await ctx.supabase.from('tenants').select('export_owner_only').eq('id', ctx.tenant.id).single();
  const canExport = !t?.export_owner_only || hasPerm(ctx.member.perms, 'settings.manage');
  const data = await loadReport(ctx, key, from, to);
  const table = reportTable(key, data);
  const q = `from=${from}&to=${to}`;

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`${ctx.shop.name} · sales, margin, stock, damage and tax`}
        actions={canExport ? <a href={`/backoffice/reports/${key}/csv?${q}`} className={buttonClass('secondary')} download>Export CSV</a> : null}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className={tabsClass()} aria-label="Reports">
          {(Object.entries(REPORT_TABS) as [ReportKey, string][]).map(([k, label]) => (
            <Link key={k} href={`/backoffice/reports/${k}?${q}`} className={tabClass(k === key)} aria-current={k === key ? 'page' : undefined}>{label}</Link>
          ))}
        </nav>
        {key === 'stock' ? <span className="text-xs text-text-muted">Stock is as of now</span> : <RangePicker from={from} to={to} />}
      </div>

      {key === 'sales' ? <SalesSummary d={data as SalesData} /> : null}
      {key === 'damage' ? <Stats items={[['Damage value', (data as DamageData).byReason.reduce((s, r) => s + r.value, 0)], ['Wastage written off', (data as DamageData).wastage]]} extra={`${(data as DamageData).pending} damage reports waiting for a decision`} /> : null}
      {key === 'credit-notes' ? <Stats items={[['Issued', (data as NotesData).issued], ['Redeemed', (data as NotesData).redeemed], ['Outstanding', (data as NotesData).outstanding]]} extra={`${(data as NotesData).issuedCount} credit notes issued in the period`} /> : null}
      {key === 'tax' && !(data as TaxData).registered ? <p className="text-[13px] text-text-muted">Not VAT registered — sales are shown by tax class without VAT. Turn on VAT in Settings → Tax &amp; rates.</p> : null}
      {key === 'tax' && (data as TaxData).registered ? <p className="text-[13px] text-text-muted">VAT reg. no {(data as TaxData).vatNo ?? '—'} · prices {(data as TaxData).included ? 'include' : 'exclude'} VAT · rate in force on the last day of the range.</p> : null}

      <Table>
        <thead><tr>{table.cols.map((c, i) => <TH key={c.label} className={cn(i > 0 && 'text-right')}>{c.label}</TH>)}</tr></thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={ri}>{r.map((v, i) => <TD key={i} className={cn(i > 0 ? 'text-right tabular-nums' : 'font-medium')}>{formatCell(v, table.cols[i]!.kind)}</TD>)}</tr>
          ))}
          {table.rows.length === 0 ? <EmptyRow colSpan={table.cols.length}>Nothing in this period.</EmptyRow> : null}
        </tbody>
      </Table>
      {key === 'margin' ? <p className="text-xs text-text-muted">Cost is the average cost when each bill was rung up (bills from before this report existed use today&apos;s cost).</p> : null}
    </>
  );
}

function SalesSummary({ d }: { d: SalesData }) {
  const t = d.totals;
  const rows: [string, string, boolean?][] = [
    ['Net sales', formatRs(t.net - t.returns, { decimals: 0 }), true],
    ['Bills', t.bills.toLocaleString('en-LK')],
    ['Average bill', t.bills ? formatRs(Math.round(t.net / t.bills), { decimals: 0 }) : '—'],
    ['Gross margin', t.lineSales ? `${Math.round((t.margin / t.lineSales) * 1000) / 10}%` : '—'],
    ['Promotions given', formatRs(t.promo, { decimals: 0 })],
    ['Returns', formatRs(t.returns, { decimals: 0 })],
    ['Wastage', formatRs(t.wastage, { decimals: 0 })],
  ];
  if (t.wholesale) rows.push(['Wholesale invoices', formatRs(t.wholesale, { decimals: 0 })]);
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch">
      <Card className="flex min-w-0 flex-1 flex-col gap-3 p-5">
        <CardTitle>Daily sales</CardTitle>
        <DailyBars days={d.days} />
      </Card>
      <Card className="flex flex-col gap-2.5 p-5 xl:w-75">
        <CardTitle>Totals</CardTitle>
        {rows.map(([k, v, strong]) => (
          <div key={k} className={cn('flex justify-between text-[13px]', strong && 'font-semibold')}>
            <span className={strong ? '' : 'text-text-muted'}>{k}</span><span className="tabular-nums">{v}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function Stats({ items, extra }: { items: [string, number][]; extra: string }) {
  return (
    <div className="flex flex-wrap gap-4">
      {items.map(([k, v]) => (
        <Card key={k} className="flex min-w-45 flex-col gap-1 p-4">
          <span className="text-xs text-text-muted">{k}</span><span className="text-xl font-bold tabular-nums">{formatRs(v, { decimals: 0 })}</span>
        </Card>
      ))}
      <p className="self-end text-xs text-text-muted">{extra}</p>
    </div>
  );
}

async function ShiftsReport() {
  const ctx = await requireTenant('reports.view');
  const { data } = await ctx.supabase
    .from('shifts')
    .select('id, shift_no, status, opened_at, closed_at, opening_float_cents, expected_cash_cents, counted_cash_cents, lane:lanes(code), member:members!shifts_opened_by_fkey(display_name)')
    .eq('shop_id', ctx.shop.id)
    .order('opened_at', { ascending: false })
    .limit(100);
  const rows = data ?? [];
  return (
    <>
      <PageHeader title="Shifts & cash" subtitle={`${ctx.shop.name} · shifts and cash variance`} />
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
                <TD>{fmtDateTime(s.opened_at)}</TD>
                <TD>{s.closed_at ? fmtDateTime(s.closed_at) : <Badge tone="success">Open</Badge>}</TD>
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
