import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, Card, CardTitle, PageHeader, Table, TD, TH, buttonClass, cn } from '@laneos/ui';
import { TransferSteps } from '@/components/backoffice/TransferForms';
import { TRANSFER_STATUS, requireChain } from '@/lib/chain';
import { fmtDateTime } from '@/lib/server/dates';

export const metadata: Metadata = { title: 'Transfer' };

const q = (milli: number | null, weighed: boolean) => (milli == null ? '—' : `${(milli / 1000).toLocaleString('en-LK', { maximumFractionDigits: 3 })}${weighed ? ' kg' : ''}`);

// Transfer detail with the WF-006 timeline and the step the user can take.
export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireChain('stock.adjust');
  const { data: t } = await ctx.supabase.from('transfers')
    .select('*, from:shops!transfers_from_shop_id_fkey(id, code, name), to:shops!transfers_to_shop_id_fkey(id, code, name), transfer_lines(item_id, qty_requested_milli, qty_sent_milli, qty_received_milli, unit_cost_cents, item:items(name, item_type))')
    .eq('id', id).maybeSingle();
  if (!t || !t.from || !t.to) notFound();
  const { data: who } = await ctx.supabase.from('members').select('user_id, display_name').not('user_id', 'is', null);
  const name = (uid: string | null) => (uid ? who?.find((m) => m.user_id === uid)?.display_name ?? 'Someone' : null);
  const st = TRANSFER_STATUS[t.status]!;
  const shopIds = new Set(ctx.shops.map((s) => s.id));
  const lines = t.transfer_lines.map((l) => ({
    itemId: l.item_id, name: l.item?.name ?? '', weighed: l.item?.item_type === 'weighed',
    requested: l.qty_requested_milli, sent: l.qty_sent_milli, received: l.qty_received_milli, cost: l.unit_cost_cents,
  }));
  const value = lines.reduce((s, l) => s + Math.round(((l.sent ?? l.requested) * l.cost) / 1000), 0);
  const steps: [string, string | null, string | null][] = [
    ['Requested', name(t.requested_by), t.created_at],
    [t.status === 'rejected' ? 'Rejected' : 'Approved', name(t.approved_by), t.approved_at],
    ['Dispatched', name(t.dispatched_by), t.dispatched_at],
    ['Received', name(t.received_by), t.received_at],
    ['Closed', name(t.closed_by), t.closed_at],
  ];

  return (
    <>
      <PageHeader title={t.transfer_no} subtitle={<span className="flex items-center gap-2">{t.from.code} → {t.to.code}<Badge tone={st.tone}>{st.text}</Badge></span>}
        actions={<Link href="/backoffice/transfers" className={buttonClass('secondary')}>All transfers</Link>} />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Table>
            <thead><tr><TH>Item</TH><TH>Requested</TH><TH>Sent</TH><TH>Received</TH><TH>Difference</TH></tr></thead>
            <tbody>
              {lines.map((l) => {
                const diff = l.sent != null && l.received != null ? l.received - l.sent : null;
                return (
                  <tr key={l.itemId}>
                    <TD className="font-medium">{l.name}</TD>
                    <TD className="tabular-nums">{q(l.requested, l.weighed)}</TD>
                    <TD className="tabular-nums">{q(l.sent, l.weighed)}</TD>
                    <TD className="tabular-nums">{q(l.received, l.weighed)}</TD>
                    <TD className={cn('tabular-nums', diff ? 'font-semibold text-danger' : '')}>{diff == null ? '—' : diff === 0 ? '0' : q(diff, l.weighed)}</TD>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="text-xs text-text-muted">Value at cost {formatRs(value, { decimals: 0 })}{t.note ? ` · Note: ${t.note}` : ''}{t.variance_note ? ` · ${t.variance_note}` : ''}</p>
          <TransferSteps id={t.id} status={t.status} lines={lines}
            can={{
              approve: hasPerm(ctx.member.perms, 'transfer.approve'),
              dispatch: shopIds.has(t.from.id), receive: shopIds.has(t.to.id),
              cancel: t.requested_by === ctx.userId || hasPerm(ctx.member.perms, 'transfer.approve'),
            }} />
        </div>
        <Card className="flex flex-col gap-3 p-5 xl:w-[300px]">
          <CardTitle>Timeline</CardTitle>
          {steps.map(([label, by, at]) => (
            <div key={label} className={cn('flex flex-col border-l-2 pl-3', at ? 'border-brand-primary' : 'border-border')}>
              <span className={cn('text-[13px] font-semibold', !at && 'text-text-muted')}>{label}</span>
              <span className="text-xs text-text-muted">{at ? `${by ?? ''} · ${fmtDateTime(at)}` : 'Not yet'}</span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
