import type { Metadata } from 'next';
import Link from 'next/link';
import { formatQty, formatRs, hasPerm, type ItemType } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH, buttonClass, chipClass } from '@laneos/ui';
import { ExpiryActions } from '@/components/backoffice/ExpiryActions';
import { colomboToday } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Expiry & near-expiry' };

const WINDOWS = [['1', 'Expiring in 1 day'], ['3', '3 days'], ['7', '7 days'], ['expired', 'Expired']] as const;
const dm = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00+05:30`));

interface Row { batchId: string; itemId: string; name: string; itemType: ItemType; batchNo: string | null; expiryOn: string; leftMilli: number; unitCostCents: number }

// Expiry & near-expiry (Figma 11-3474). Quantities left per batch are inferred first-expiry-first-out.
export default async function ExpiryPage({ searchParams }: { searchParams: Promise<{ within?: string }> }) {
  const { within = '3' } = await searchParams;
  const ctx = await requireTenant();
  const expired = within === 'expired';
  const { data, error } = await ctx.supabase.schema('api').rpc('expiry_list', { p_shop: ctx.shop.id, p_within_days: expired ? -1 : Math.min(30, Math.max(0, Number(within) || 3)) });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const { data: prices } = await ctx.supabase.from('price_list_items').select('item_id, price_cents, price_lists!inner(is_default)').eq('price_lists.is_default', true).in('item_id', rows.map((r) => r.itemId));
  const price = new Map((prices ?? []).map((p) => [p.item_id, p.price_cents]));
  const today = colomboToday();
  const canAct = hasPerm(ctx.member.perms, 'stock.adjust') || hasPerm(ctx.member.perms, 'item.edit');

  return (
    <>
      <PageHeader title="Expiry & near-expiry" subtitle="Batches expiring soon, reduced stickers and write-offs"
        actions={<Link href="/backoffice/labels" className={buttonClass('secondary')}>Print reduced stickers</Link>} />
      <div className="flex flex-wrap gap-2">
        {WINDOWS.map(([k, t]) => <Link key={k} href={`/backoffice/stock/expiry?within=${k}`} className={chipClass(within === k)}>{t}</Link>)}
      </div>
      <Table>
        <thead><tr><TH>Item</TH><TH>Batch</TH><TH>Expiry</TH><TH>Qty left</TH><TH>Cost</TH><TH>Suggested price</TH>{canAct ? <TH>Action</TH> : null}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const list = price.get(r.itemId) ?? null;
            const days = Math.round((new Date(`${r.expiryOn}T00:00:00+05:30`).getTime() - new Date(`${today}T00:00:00+05:30`).getTime()) / 86_400_000);
            // Suggest halfway between cost and list price, never below cost.
            const suggest = list != null ? Math.max(r.unitCostCents, Math.round((list + r.unitCostCents) / 2 / 100) * 100) : null;
            return (
              <tr key={r.batchId}>
                <TD className="font-medium">{r.name}</TD>
                <TD className="font-mono text-xs">{r.batchNo ?? '—'}</TD>
                <TD>{dm(r.expiryOn)} {days < 0 ? <Badge tone="danger">Expired</Badge> : days <= 1 ? <Badge tone="warning">{days === 0 ? 'Today' : 'Tomorrow'}</Badge> : null}</TD>
                <TD className="tabular-nums">{formatQty(r.leftMilli, r.itemType)}</TD>
                <TD className="tabular-nums">{formatRs(r.unitCostCents)}</TD>
                <TD className="tabular-nums">{days < 0 || suggest == null || list == null ? '—' : `${formatRs(suggest)} (−${Math.round((1 - suggest / list) * 100)}%)`}</TD>
                {canAct ? (
                  <TD><ExpiryActions itemId={r.itemId} name={r.name} batchNo={r.batchNo} leftMilli={r.leftMilli} itemType={r.itemType} suggestCents={suggest} expired={days < 0} /></TD>
                ) : null}
              </tr>
            );
          })}
          {rows.length === 0 ? <EmptyRow colSpan={canAct ? 7 : 6}>{expired ? 'No expired stock left on the shelf.' : 'Nothing expires in this window. Expiry dates come from GRNs.'}</EmptyRow> : null}
        </tbody>
      </Table>
      <p className="text-xs text-text-muted">Quantity left is worked out from current stock, oldest batches sold first (FEFO).</p>
    </>
  );
}
