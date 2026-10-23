import type { Metadata } from 'next';
import { formatQty, formatRs, hasPerm, type ItemType } from '@laneos/core';
import { EmptyRow, PageHeader, StatCard, Table, TD, TH } from '@laneos/ui';
import { DamageActions, DamageForm } from '@/components/backoffice/Damage';
import { colomboMonthStart } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

/** Value at cost of a damaged quantity (server-side; Damage.tsx is a client module). */
const damageValue = (qtyMilli: number, unitCostCents: number) => formatRs(Math.round((qtyMilli * unitCostCents) / 1000), { decimals: 0 });

export const metadata: Metadata = { title: 'Damaged goods' };

const REASON: Record<string, string> = { broken: 'Broken', leaking: 'Leaking', crushed: 'Crushed', pest: 'Pest', expired: 'Expired', temperature: 'Temp.', other: 'Other' };

// Damaged goods (Figma 1-1849, blueprint §30.1).
export default async function DamagePage() {
  const ctx = await requireTenant();
  const month = colomboMonthStart();
  const [{ data: reports }, { data: decisions }, { data: items }] = await Promise.all([
    ctx.supabase.from('damage_reports')
      .select('id, report_no, qty_milli, remaining_milli, unit_cost_cents, reason, source, status, created_at, reported_by, item:items(name, item_type)')
      .eq('shop_id', ctx.shop.id).order('created_at', { ascending: false }).limit(200),
    ctx.supabase.from('damage_decisions').select('decision, qty_milli, markdown_price_cents, decided_at, report:damage_reports!inner(shop_id, unit_cost_cents)')
      .eq('report.shop_id', ctx.shop.id).gte('decided_at', month),
    ctx.supabase.from('items').select('id, name, item_type, cost_cents').eq('is_active', true).neq('item_type', 'open_price').order('name').limit(5000),
  ]);
  const rows = reports ?? [];
  const value = (qty: number, cost: number) => Math.round((qty * cost) / 1000);
  const waiting = rows.filter((r) => ['awaiting_decision', 'awaiting_approval', 'reported'].includes(r.status));
  const sent = rows.filter((r) => r.status === 'sent_to_supplier');
  const writtenOff = (decisions ?? []).filter((d) => d.decision === 'write_off').reduce((s, d) => s + value(d.qty_milli, d.report?.unit_cost_cents ?? 0), 0);
  const reducedDecisions = (decisions ?? []).filter((d) => d.decision === 'reduced_sale');
  const recovered = reducedDecisions.reduce((s, d) => s + value(d.qty_milli, d.markdown_price_cents ?? 0), 0);
  const canAdjust = hasPerm(ctx.member.perms, 'stock.adjust');
  const day = 86_400_000;

  return (
    <>
      <PageHeader title="Damaged goods" subtitle="Keep damaged stock aside until a manager decides" />
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting decision" value={`${waiting.length} ${waiting.length === 1 ? 'report' : 'reports'}`} delta={formatRs(waiting.reduce((s, r) => s + value(r.remaining_milli, r.unit_cost_cents), 0), { decimals: 0 })} deltaTone="danger" note="at cost" />
        <StatCard label="Sent to supplier" value={sent.length} delta={formatRs(sent.reduce((s, r) => s + value(r.qty_milli, r.unit_cost_cents), 0), { decimals: 0 })} note="credit pending" />
        <StatCard label="Written off (this month)" value={formatRs(writtenOff, { decimals: 0 })} note="at cost" />
        <StatCard label="Recovered value" value={formatRs(recovered, { decimals: 0 })} delta={`${reducedDecisions.length} reports`} note="reduced-price stock" />
      </section>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        {canAdjust ? (
          <div className="xl:w-[360px]">
            <DamageForm items={(items ?? []).map((i) => ({ id: i.id, name: i.name, itemType: i.item_type as ItemType, costCents: i.cost_cents }))} />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <Table>
            <thead><tr><TH>Report</TH><TH>Item</TH><TH>Qty</TH><TH>Reason</TH><TH>Value</TH><TH>Age</TH><TH>Decision</TH></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <TD className="font-mono text-xs">{r.report_no}</TD>
                  <TD className="font-medium">{r.item?.name}{r.source === 'customer_return' ? <span className="block text-xs font-normal text-text-muted">customer return</span> : null}</TD>
                  <TD className="tabular-nums">{formatQty(r.status === 'awaiting_decision' ? r.remaining_milli : r.qty_milli, (r.item?.item_type ?? 'standard') as ItemType)}</TD>
                  <TD>{REASON[r.reason]}</TD>
                  <TD className="tabular-nums">{damageValue(r.qty_milli, r.unit_cost_cents)}</TD>
                  <TD>{Math.floor((Date.now() - new Date(r.created_at).getTime()) / day)} d</TD>
                  <TD>{canAdjust ? (
                    <DamageActions id={r.id} reportNo={r.report_no} remainingMilli={r.remaining_milli} itemType={(r.item?.item_type ?? 'standard') as ItemType}
                      status={r.status} canApprove={r.reported_by !== ctx.member.id} />
                  ) : r.status.replace(/_/g, ' ')}</TD>
                </tr>
              ))}
              {rows.length === 0 ? <EmptyRow colSpan={7}>No damage reported. Damaged customer returns also appear here.</EmptyRow> : null}
            </tbody>
          </Table>
        </div>
      </div>
    </>
  );
}
