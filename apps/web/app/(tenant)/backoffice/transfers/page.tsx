import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPerm } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH, buttonClass, chipClass } from '@laneos/ui';
import { ChainUpgrade } from '@/components/backoffice/ChainUpgrade';
import { TRANSFER_STATUS, requireChain } from '@/lib/chain';
import { fmtDateTime } from '@/lib/server/dates';

export const metadata: Metadata = { title: 'Transfers' };

const FILTERS = [['open', 'Open'], ['all', 'All']] as const;
const OPEN = ['requested', 'approved', 'in_transit', 'received_with_variance'];

// Transfers (Figma 3-1283, not read — built from WF-006; compare when Figma access returns).
export default async function TransfersPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show = 'open' } = await searchParams;
  const { ctx, enabled } = await requireChain('stock.adjust');
  if (!enabled) return <ChainUpgrade title="Transfers" />;
  let q = ctx.supabase.from('transfers')
    .select('id, transfer_no, status, created_at, note, from:shops!transfers_from_shop_id_fkey(code, name), to:shops!transfers_to_shop_id_fkey(code, name), transfer_lines(id)')
    .order('created_at', { ascending: false }).limit(200);
  if (show === 'open') q = q.in('status', OPEN as never);
  const { data } = await q;

  return (
    <>
      <PageHeader title="Transfers" subtitle="Stock moving between shops: request → approve → dispatch → receive"
        actions={<Link href="/backoffice/transfers/new" className={buttonClass('primary')}>+ Request stock</Link>} />
      <div className="flex gap-2">{FILTERS.map(([k, t]) => <Link key={k} href={`/backoffice/transfers?show=${k}`} className={chipClass(k === show)}>{t}</Link>)}</div>
      <Table>
        <thead><tr><TH>No.</TH><TH>From</TH><TH>To</TH><TH>Items</TH><TH>Requested</TH><TH>Status</TH></tr></thead>
        <tbody>
          {(data ?? []).map((t) => {
            const st = TRANSFER_STATUS[t.status]!;
            return (
              <tr key={t.id}>
                <TD className="font-mono text-xs"><Link href={`/backoffice/transfers/${t.id}`} className="text-brand-primary hover:underline">{t.transfer_no}</Link></TD>
                <TD>{t.from?.code} · {t.from?.name}</TD>
                <TD>{t.to?.code} · {t.to?.name}</TD>
                <TD className="tabular-nums">{t.transfer_lines.length}</TD>
                <TD>{fmtDateTime(t.created_at)}</TD>
                <TD><Badge tone={st.tone}>{st.text}</Badge></TD>
              </tr>
            );
          })}
          {(data ?? []).length === 0 ? <EmptyRow colSpan={6}>{show === 'open' ? 'No open transfers.' : 'No transfers yet.'}</EmptyRow> : null}
        </tbody>
      </Table>
      {!hasPerm(ctx.member.perms, 'transfer.approve') ? <p className="text-xs text-text-muted">A manager with “Approve transfers” approves requests and accepts variances.</p> : null}
    </>
  );
}
