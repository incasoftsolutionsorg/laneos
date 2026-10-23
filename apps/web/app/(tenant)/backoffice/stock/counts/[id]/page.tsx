import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatRs, hasPerm, type ItemType } from '@laneos/core';
import { PageHeader, StatCard } from '@laneos/ui';
import { CountSheet, type CountLine } from '@/components/backoffice/Counts';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Stock count' };

// Stock count sheet (Figma 11-3268).
export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const { data: c } = await ctx.supabase.from('stock_counts')
    .select('id, count_no, name, status, stock_count_lines(id, system_milli, counted_milli, item:items(name, item_type, cost_cents), counter:members(display_name))')
    .eq('id', id).maybeSingle();
  if (!c) notFound();

  const lines: CountLine[] = c.stock_count_lines
    .map((l) => ({
      id: l.id, name: l.item?.name ?? '', itemType: (l.item?.item_type ?? 'standard') as ItemType, systemMilli: l.system_milli,
      countedMilli: l.counted_milli, costCents: l.item?.cost_cents ?? 0, by: l.counter?.display_name?.split(' ')[0] ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const counted = lines.filter((l) => l.countedMilli != null);
  const variance = counted.reduce((s, l) => s + Math.round(((l.countedMilli! - l.systemMilli) * l.costCents) / 1000), 0);
  const off = counted.filter((l) => l.countedMilli !== l.systemMilli).length;
  const canAdjust = hasPerm(ctx.member.perms, 'stock.adjust');

  return (
    <>
      <PageHeader title="Stock count" subtitle={`${c.count_no} · count one section at a time; variances need a manager to post`} />
      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Section" value={c.name} delta={`${lines.length} items`} note="frozen for count" />
        <StatCard label="Counted" value={`${counted.length} / ${lines.length}`} delta={lines.length ? `${Math.round((counted.length / lines.length) * 100)}%` : '—'} note={c.status === 'counting' ? 'in progress' : c.status} />
        <StatCard label="Variance so far" value={`${variance < 0 ? '−' : variance > 0 ? '+' : ''}${formatRs(Math.abs(variance), { decimals: 0 })}`} delta={`${off} items`} deltaTone={off ? 'danger' : 'success'} note={variance < 0 ? 'short' : variance > 0 ? 'over' : 'at cost'} />
      </section>
      <CountSheet countId={c.id} status={c.status} lines={lines} editable={canAdjust && c.status === 'counting'}
        canPost={hasPerm(ctx.member.perms, 'shift.manage') && canAdjust} />
    </>
  );
}
