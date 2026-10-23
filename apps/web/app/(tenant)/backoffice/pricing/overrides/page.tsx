import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH, cn } from '@laneos/ui';
import { ChainUpgrade } from '@/components/backoffice/ChainUpgrade';
import { ClearOverride } from '@/components/backoffice/PricingForms';
import { PricingTabs } from '@/components/backoffice/PricingTabs';
import { requireChain } from '@/lib/chain';
import { fmtDateTime } from '@/lib/server/dates';
import { pricingItems } from '@/lib/pricing';

export const metadata: Metadata = { title: 'Shop price overrides' };

export default async function OverridesPage() {
  const { ctx, enabled } = await requireChain('item.edit');
  if (!enabled) return <ChainUpgrade title="Shop price overrides" />;
  const [items, { data }] = await Promise.all([
    pricingItems(ctx),
    ctx.supabase.from('shop_prices').select('shop_id, item_id, price_cents, updated_at, shop:shops(code, name), item:items(name)').order('updated_at', { ascending: false }),
  ]);
  const central = new Map(items.map((i) => [i.id, i.centralCents]));
  return (
    <>
      <PageHeader title="Central pricing" subtitle="Every item a shop sells at its own price" />
      <PricingTabs active="overrides" />
      <Table>
        <thead><tr><TH>Shop</TH><TH>Item</TH><TH className="text-right">Central</TH><TH className="text-right">Shop price</TH><TH className="text-right">Difference</TH><TH>Changed</TH><TH /></tr></thead>
        <tbody>
          {(data ?? []).map((o) => {
            const c = central.get(o.item_id) ?? null;
            const d = c == null ? null : o.price_cents - c;
            return (
              <tr key={`${o.shop_id}-${o.item_id}`}>
                <TD><Badge tone="success">{o.shop?.code}</Badge></TD>
                <TD className="font-medium"><Link href={`/backoffice/pricing/lists?id=${o.item_id}`} className="hover:underline">{o.item?.name}</Link></TD>
                <TD className="text-right tabular-nums">{c == null ? '—' : formatRs(c)}</TD>
                <TD className="text-right font-semibold tabular-nums">{formatRs(o.price_cents)}</TD>
                <TD className={cn('text-right tabular-nums', d && d > 0 ? 'text-danger' : d && d < 0 ? 'text-success' : '')}>{d == null ? '—' : formatRs(d, { sign: true })}</TD>
                <TD>{fmtDateTime(o.updated_at)}</TD>
                <TD className="text-right"><ClearOverride shopId={o.shop_id} itemId={o.item_id} /></TD>
              </tr>
            );
          })}
          {(data ?? []).length === 0 ? <EmptyRow colSpan={7}>Every shop sells at the central price.</EmptyRow> : null}
        </tbody>
      </Table>
    </>
  );
}
