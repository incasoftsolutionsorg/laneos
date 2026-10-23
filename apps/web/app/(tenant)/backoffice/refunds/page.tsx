import type { Metadata } from 'next';
import { formatRs } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, StatCard, Table, TD, TH } from '@laneos/ui';
import { colomboDayStart, colomboMonthStart, colomboToday, fmtDateTime } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Refunds & credit notes' };

const SETTLEMENT: Record<string, string> = {
  cash: 'Cash', original: 'Card / LankaQR', exchange: 'Exchange', credit_note: 'Credit note', credit_balance: 'Credit balance',
};

// Refunds & credit notes (Figma 1-2808). Large cash refunds are approved at the lane with a
// supervisor PIN, so there is no pending-approval queue here (see docs/10-ui.md).
export default async function RefundsPage() {
  const ctx = await requireTenant('reports.view');
  const today = colomboToday();
  const [{ data: returns }, { data: open }, { data: redeemed }, { data: expired }] = await Promise.all([
    ctx.supabase.from('returns')
      .select('id, return_no, settlement, total_cents, created_at, sale:sales(invoice_no), lane:lanes(code), member:members!returns_member_id_fkey(display_name), approver:members!returns_approved_by_fkey(display_name)')
      .eq('shop_id', ctx.shop.id).order('created_at', { ascending: false }).limit(100),
    ctx.supabase.from('credit_notes').select('balance_cents').in('status', ['active', 'partially_used']).gte('expires_on', today),
    ctx.supabase.from('credit_note_redemptions').select('amount_cents').gte('created_at', colomboMonthStart()),
    ctx.supabase.from('credit_notes').select('balance_cents').in('status', ['active', 'partially_used', 'expired']).lt('expires_on', today).gte('expires_on', colomboDayStart(30).slice(0, 10)),
  ]);
  const rows = returns ?? [];
  const todayStart = colomboDayStart();
  const todays = rows.filter((r) => r.created_at >= todayStart);
  const sum = (xs: { balance_cents?: number; amount_cents?: number; total_cents?: number }[] | null, k: 'balance_cents' | 'amount_cents' | 'total_cents') =>
    (xs ?? []).reduce((s, x) => s + (x[k] ?? 0), 0);

  return (
    <>
      <PageHeader title="Refunds & credit notes" subtitle="Every refund is logged with cashier, lane and approver" />
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Refunded today" value={formatRs(sum(todays, 'total_cents'), { decimals: 0 })} delta={`${todays.length} ${todays.length === 1 ? 'refund' : 'refunds'}`} deltaTone="danger" note={ctx.shop.name} />
        <StatCard label="Credit notes outstanding" value={formatRs(sum(open, 'balance_cents'), { decimals: 0 })} delta={`${(open ?? []).length} notes`} note="liability" />
        <StatCard label="Redeemed this month" value={formatRs(sum(redeemed, 'amount_cents'), { decimals: 0 })} delta={`${(redeemed ?? []).length} uses`} note="all shops" />
        <StatCard label="Expired notes" value={formatRs(sum(expired, 'balance_cents'), { decimals: 0 })} delta={`${(expired ?? []).length} notes`} note="last 30 days" />
      </section>
      <Table>
        <thead>
          <tr><TH>Refund</TH><TH>Invoice</TH><TH>Lane / cashier</TH><TH>Method</TH><TH>Amount</TH><TH>Approved by</TH><TH>Time</TH><TH>Status</TH></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <TD className="font-mono text-xs">{r.return_no}</TD>
              <TD className="font-mono text-xs">{r.sale?.invoice_no}</TD>
              <TD>{r.lane?.code} · {r.member?.display_name?.split(' ')[0]}</TD>
              <TD>{SETTLEMENT[r.settlement]}</TD>
              <TD className="tabular-nums">{formatRs(r.total_cents)}</TD>
              <TD>{r.approver?.display_name ?? '—'}</TD>
              <TD>{fmtDateTime(r.created_at)}</TD>
              <TD><Badge tone="success">Completed</Badge></TD>
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={8}>No refunds yet. Returns are made from a lane (Lane → Return).</EmptyRow> : null}
        </tbody>
      </Table>
    </>
  );
}
