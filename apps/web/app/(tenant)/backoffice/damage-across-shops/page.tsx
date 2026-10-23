import type { Metadata } from 'next';
import { formatRs } from '@laneos/core';
import { Badge, Card, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { ChainUpgrade } from '@/components/backoffice/ChainUpgrade';
import { RangePicker } from '@/components/backoffice/reports/RangePicker';
import { requireChain, type ChainReportShop } from '@/lib/chain';
import { readRange } from '@/lib/reports';
import { fmtDateTime } from '@/lib/server/dates';

export const metadata: Metadata = { title: 'Damage & wastage' };

// Damage across shops (Figma 3-1921, not read — built from blueprint E.2; compare when Figma access returns).
export default async function DamageAcrossShopsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { ctx, enabled } = await requireChain();
  if (!enabled) return <ChainUpgrade title="Damage & wastage" />;
  const { from, to } = readRange(sp.from, sp.to);
  const [{ data }, { data: pending }] = await Promise.all([
    ctx.supabase.schema('api').rpc('chain_report', { p_from: from, p_to: to }),
    ctx.supabase.from('damage_reports').select('id, report_no, qty_milli, unit_cost_cents, reason, status, created_at, shop:shops(code), item:items(name)')
      .in('status', ['reported', 'awaiting_approval', 'awaiting_decision']).order('created_at').limit(50),
  ]);
  const rows = ((data ?? []) as unknown as ChainReportShop[]).sort((a, b) => b.damageValue + b.wastage - (a.damageValue + a.wastage));
  const total = rows.reduce((s, r) => s + r.damageValue + r.wastage, 0);
  const sales = rows.reduce((s, r) => s + r.sales, 0);

  return (
    <>
      <PageHeader title="Damage & wastage" subtitle={`All shops · ${from} to ${to}`} actions={<RangePicker from={from} to={to} />} />
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="flex flex-col gap-1 p-4"><span className="text-xs text-text-muted">Damage + wastage (cost)</span><span className="text-xl font-bold tabular-nums">{formatRs(total, { decimals: 0 })}</span></Card>
        <Card className="flex flex-col gap-1 p-4"><span className="text-xs text-text-muted">Share of sales</span><span className="text-xl font-bold tabular-nums">{sales ? `${Math.round((total / sales) * 1000) / 10}%` : '—'}</span></Card>
        <Card className="flex flex-col gap-1 p-4"><span className="text-xs text-text-muted">Waiting for a decision</span><span className="text-xl font-bold tabular-nums">{rows.reduce((s, r) => s + r.damagePending, 0)}</span></Card>
      </div>
      <Table>
        <thead><tr><TH>Shop</TH><TH className="text-right">Damage reports</TH><TH className="text-right">Damage value</TH><TH className="text-right">Wastage</TH><TH className="text-right">% of sales</TH><TH className="text-right">Pending</TH></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <TD className="font-medium">{r.code} · {r.name}</TD>
              <TD className="text-right tabular-nums">{r.damageReports}</TD>
              <TD className="text-right tabular-nums">{formatRs(r.damageValue, { decimals: 0 })}</TD>
              <TD className="text-right tabular-nums">{formatRs(r.wastage, { decimals: 0 })}</TD>
              <TD className="text-right tabular-nums">{r.sales ? `${Math.round(((r.damageValue + r.wastage) / r.sales) * 1000) / 10}%` : '—'}</TD>
              <TD className="text-right">{r.damagePending ? <Badge tone="warning">{r.damagePending}</Badge> : '0'}</TD>
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={6}>No shops.</EmptyRow> : null}
        </tbody>
      </Table>
      <h2 className="text-[15px] font-semibold">Waiting for a decision</h2>
      <Table>
        <thead><tr><TH>Report</TH><TH>Shop</TH><TH>Item</TH><TH className="text-right">Value</TH><TH>Reported</TH><TH>Status</TH></tr></thead>
        <tbody>
          {(pending ?? []).map((d) => (
            <tr key={d.id}>
              <TD className="font-mono text-xs">{d.report_no}</TD>
              <TD>{d.shop?.code}</TD>
              <TD>{d.item?.name}</TD>
              <TD className="text-right tabular-nums">{formatRs(Math.round((d.qty_milli * d.unit_cost_cents) / 1000), { decimals: 0 })}</TD>
              <TD>{fmtDateTime(d.created_at)}</TD>
              <TD><Badge tone="warning">{d.status.replace(/_/g, ' ')}</Badge></TD>
            </tr>
          ))}
          {(pending ?? []).length === 0 ? <EmptyRow colSpan={6}>Nothing waiting.</EmptyRow> : null}
        </tbody>
      </Table>
      <p className="text-xs text-text-muted">Decisions are made in each shop's Damaged goods screen (choose the shop in the sidebar).</p>
    </>
  );
}
