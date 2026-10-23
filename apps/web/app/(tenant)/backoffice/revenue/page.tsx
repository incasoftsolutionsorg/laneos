import type { Metadata } from 'next';
import { formatRs } from '@laneos/core';
import { Card, CardTitle, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { ChainUpgrade } from '@/components/backoffice/ChainUpgrade';
import { RangePicker } from '@/components/backoffice/reports/RangePicker';
import { ShopBars } from '@/components/backoffice/reports/ShopBars';
import { requireChain, type ChainReportShop } from '@/lib/chain';
import { readRange } from '@/lib/reports';

export const metadata: Metadata = { title: 'Revenue & reports' };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');

// Revenue (chain reports) (Figma 3-1676, not read — built from blueprint E.2; compare when Figma access returns).
export default async function RevenuePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { ctx, enabled } = await requireChain();
  if (!enabled) return <ChainUpgrade title="Revenue & reports" />;
  const { from, to } = readRange(sp.from, sp.to);
  const { data } = await ctx.supabase.schema('api').rpc('chain_report', { p_from: from, p_to: to });
  const rows = (data ?? []) as unknown as ChainReportShop[];
  const t = rows.reduce((a, r) => ({ sales: a.sales + r.sales, bills: a.bills + r.bills, line: a.line + r.lineSales, margin: a.margin + r.margin, returns: a.returns + r.returns, wholesale: a.wholesale + r.wholesale }),
    { sales: 0, bills: 0, line: 0, margin: 0, returns: 0, wholesale: 0 });

  return (
    <>
      <PageHeader title="Revenue & reports" subtitle={`All shops · ${from} to ${to}`} actions={<RangePicker from={from} to={to} />} />
      <div className="grid gap-4 md:grid-cols-4">
        {([['Net sales', formatRs(t.sales - t.returns, { decimals: 0 })], ['Bills', t.bills.toLocaleString('en-LK')], ['Gross margin', pct(t.margin, t.line)], ['Wholesale invoices', formatRs(t.wholesale, { decimals: 0 })]] as const).map(([k, v]) => (
          <Card key={k} className="flex flex-col gap-1 p-4"><span className="text-xs text-text-muted">{k}</span><span className="text-xl font-bold tabular-nums">{v}</span></Card>
        ))}
      </div>
      <Card className="flex flex-col gap-3 p-5">
        <CardTitle>Sales by shop</CardTitle>
        <ShopBars highlight={ctx.shop.id} bars={rows.map((r) => ({ id: r.id, code: r.code, name: r.name, value: r.sales, note: `${r.bills} bills` }))} />
      </Card>
      <Table>
        <thead><tr><TH>Shop</TH><TH className="text-right">Sales</TH><TH className="text-right">Share</TH><TH className="text-right">Bills</TH><TH className="text-right">Average bill</TH><TH className="text-right">Margin</TH><TH className="text-right">Returns</TH><TH className="text-right">Wholesale</TH></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <TD className="font-medium">{r.code} · {r.name}</TD>
              <TD className="text-right tabular-nums">{formatRs(r.sales, { decimals: 0 })}</TD>
              <TD className="text-right tabular-nums">{pct(r.sales, t.sales)}</TD>
              <TD className="text-right tabular-nums">{r.bills.toLocaleString('en-LK')}</TD>
              <TD className="text-right tabular-nums">{r.bills ? formatRs(Math.round(r.sales / r.bills), { decimals: 0 }) : '—'}</TD>
              <TD className="text-right tabular-nums">{pct(r.margin, r.lineSales)}</TD>
              <TD className="text-right tabular-nums">{formatRs(r.returns, { decimals: 0 })}</TD>
              <TD className="text-right tabular-nums">{formatRs(r.wholesale, { decimals: 0 })}</TD>
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={8}>No shops.</EmptyRow> : null}
        </tbody>
      </Table>
      <p className="text-xs text-text-muted">One shop in detail: open it from the sidebar's shop menu and use Reports.</p>
    </>
  );
}
