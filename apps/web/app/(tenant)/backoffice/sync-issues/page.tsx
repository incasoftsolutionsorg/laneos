import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH, chipClass } from '@laneos/ui';
import { ReasonAction } from '@/components/backoffice/RowActions';
import { fmtDateTime } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';
import { resolveSyncIssue } from '../credit-notes/actions';

export const metadata: Metadata = { title: 'Sync issues' };

const WHY: Record<string, string> = {
  PRICE_MISMATCH: 'Prices changed while the lane was offline',
  SHIFT_NOT_OPEN: 'The shift was closed before the sale synced',
  ITEM_INACTIVE: 'An item was removed from the catalogue',
  UNDERPAID: 'Payment did not cover the server total',
  LANE_KEY_INVALID: 'The lane device was re-registered',
};

// Offline sales the server refused when the lane synced them (WF-003). No dedicated frame: built
// from the lane offline queue design (Figma 11-3260, Appendix E.5).
export default async function SyncIssuesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await requireTenant();
  const { filter = 'open' } = await searchParams;
  let q = ctx.supabase
    .from('sync_issues')
    .select('id, client_uuid, payload, error_code, error_message, status, resolution_note, created_at, resolved_at, lane:lanes(code), resolver:members(display_name)')
    .eq('shop_id', ctx.shop.id).order('created_at', { ascending: false }).limit(200);
  if (filter !== 'all') q = q.eq('status', 'open');
  const { data } = await q;
  const rows = data ?? [];
  const canResolve = hasPerm(ctx.member.perms, 'shift.manage');

  return (
    <>
      <PageHeader title="Sync issues" subtitle="Offline sales the server could not accept. Check each one and record what you did." />
      <div className="flex gap-2">
        <Link href="/backoffice/sync-issues" className={chipClass(filter !== 'all')}>Open</Link>
        <Link href="/backoffice/sync-issues?filter=all" className={chipClass(filter === 'all')}>All</Link>
      </div>
      <Table>
        <thead><tr><TH>When</TH><TH>Lane</TH><TH>Invoice</TH><TH>Lane total</TH><TH>Problem</TH><TH>Status</TH>{canResolve ? <TH>Actions</TH> : null}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const p = r.payload as { invoiceNo?: string; expectedTotalCents?: number; lines?: unknown[] };
            return (
              <tr key={r.id}>
                <TD>{fmtDateTime(r.created_at)}</TD>
                <TD>{r.lane?.code}</TD>
                <TD className="font-mono text-xs">{p.invoiceNo ?? '—'}</TD>
                <TD className="tabular-nums">{p.expectedTotalCents != null ? formatRs(p.expectedTotalCents) : '—'} · {p.lines?.length ?? 0} lines</TD>
                <TD><span className="font-semibold">{WHY[r.error_code] ?? r.error_code}</span>{r.error_message ? <span className="block text-xs text-text-muted">{r.error_message}</span> : null}</TD>
                <TD>{r.status === 'open' ? <Badge tone="warning">Open</Badge> : <Badge tone={r.status === 'resolved' ? 'success' : 'neutral'}>{r.status}{r.resolver ? ` · ${r.resolver.display_name}` : ''}</Badge>}</TD>
                {canResolve ? (
                  <TD>
                    {r.status === 'open' ? (
                      <div className="flex gap-3">
                        <ReasonAction label="Resolved" title="Mark as resolved" action={resolveSyncIssue} hidden={{ id: r.id, status: 'resolved' }} submitLabel="Mark resolved" />
                        <ReasonAction label="Discard" title="Discard this sale" action={resolveSyncIssue} hidden={{ id: r.id, status: 'discarded' }} danger submitLabel="Discard" />
                      </div>
                    ) : r.resolution_note ?? '—'}
                  </TD>
                ) : null}
              </tr>
            );
          })}
          {rows.length === 0 ? <EmptyRow colSpan={canResolve ? 7 : 6}>No sync issues. Offline sales are syncing cleanly.</EmptyRow> : null}
        </tbody>
      </Table>
    </>
  );
}
