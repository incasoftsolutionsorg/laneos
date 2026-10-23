import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPerm } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH, type Tone } from '@laneos/ui';
import { StartCountForm } from '@/components/backoffice/Counts';
import { fmtDateTime } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Stock counts' };

const STATUS: Record<string, [string, Tone]> = { counting: ['Counting', 'warning'], submitted: ['Waiting to post', 'info'], posted: ['Posted', 'success'], cancelled: ['Cancelled', 'neutral'] };

export default async function CountsPage() {
  const ctx = await requireTenant();
  const [{ data: counts }, { data: departments }] = await Promise.all([
    ctx.supabase.from('stock_counts')
      .select('id, count_no, name, status, created_at, posted_at, creator:members!stock_counts_created_by_fkey(display_name), stock_count_lines(counted_milli)')
      .eq('shop_id', ctx.shop.id).order('created_at', { ascending: false }).limit(100),
    ctx.supabase.from('departments').select('id, name').eq('is_active', true).order('sort_order').order('name'),
  ]);
  const rows = counts ?? [];

  return (
    <>
      <PageHeader title="Stock counts" subtitle="Count one section at a time; variances need a manager to post" />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <Table>
            <thead><tr><TH>Count</TH><TH>Section</TH><TH>Counted</TH><TH>Started</TH><TH>By</TH><TH>Status</TH></tr></thead>
            <tbody>
              {rows.map((c) => {
                const total = c.stock_count_lines.length;
                const done = c.stock_count_lines.filter((l) => l.counted_milli != null).length;
                const [text, tone] = STATUS[c.status] ?? [c.status, 'neutral'];
                return (
                  <tr key={c.id}>
                    <TD className="font-mono text-xs"><Link href={`/backoffice/stock/counts/${c.id}`} className="text-brand-primary hover:underline">{c.count_no}</Link></TD>
                    <TD className="font-medium">{c.name}</TD>
                    <TD className="tabular-nums">{done} / {total}</TD>
                    <TD>{fmtDateTime(c.created_at)}</TD>
                    <TD>{c.creator?.display_name}</TD>
                    <TD><Badge tone={tone}>{text}</Badge></TD>
                  </tr>
                );
              })}
              {rows.length === 0 ? <EmptyRow colSpan={6}>No counts yet.</EmptyRow> : null}
            </tbody>
          </Table>
        </div>
        {hasPerm(ctx.member.perms, 'stock.adjust') ? <div className="xl:w-[340px]"><StartCountForm departments={departments ?? []} /></div> : null}
      </div>
    </>
  );
}
