import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { EmptyRow, Input, PageHeader, Table, TD, TH, cn } from '@laneos/ui';
import { ChainUpgrade } from '@/components/backoffice/ChainUpgrade';
import { ItemPriceEditor } from '@/components/backoffice/PricingForms';
import { PricingTabs } from '@/components/backoffice/PricingTabs';
import { requireChain } from '@/lib/chain';
import { pricingItems } from '@/lib/pricing';

export const metadata: Metadata = { title: 'Central pricing' };

// Central pricing (Figma 3-1491, not read — built from blueprint §26 / WF-007; compare when Figma access returns).
export default async function PricingListsPage({ searchParams }: { searchParams: Promise<{ q?: string; id?: string }> }) {
  const { q = '', id } = await searchParams;
  const { ctx, enabled } = await requireChain('item.edit');
  if (!enabled) return <ChainUpgrade title="Central pricing" />;
  const [items, { data: shops }, { data: overrides }] = await Promise.all([
    pricingItems(ctx),
    ctx.supabase.from('shops').select('id, code, name').eq('is_active', true).order('code'),
    ctx.supabase.from('shop_prices').select('shop_id, item_id, price_cents'),
  ]);
  const ov = new Map<string, Record<string, number>>();
  for (const o of overrides ?? []) ov.set(o.item_id, { ...(ov.get(o.item_id) ?? {}), [o.shop_id]: o.price_cents });
  const s = q.trim().toLowerCase();
  const rows = (s ? items.filter((i) => i.name.toLowerCase().includes(s) || i.barcodes.includes(s.toUpperCase())) : items.filter((i) => ov.has(i.id)).concat(items.filter((i) => !ov.has(i.id)))).slice(0, 60);
  const sel = items.find((i) => i.id === id);

  return (
    <>
      <PageHeader title="Central pricing" subtitle="One central price per item; a shop can have its own. Changes reach lanes on their next catalogue refresh." />
      <PricingTabs active="lists" />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <form className="max-w-sm"><Input name="q" defaultValue={q} placeholder="Search item or barcode" aria-label="Search items" /></form>
          <Table>
            <thead><tr><TH>Item</TH><TH className="text-right">Central</TH>{(shops ?? []).map((sh) => <TH key={sh.id} className="text-right">{sh.code}</TH>)}</tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className={i.id === id ? 'bg-brand-light/40' : undefined}>
                  <TD className="font-medium"><Link href={`/backoffice/pricing/lists?id=${i.id}${q ? `&q=${encodeURIComponent(q)}` : ''}`} className="hover:underline">{i.name}</Link></TD>
                  <TD className="text-right tabular-nums">{i.centralCents == null ? '—' : formatRs(i.centralCents)}</TD>
                  {(shops ?? []).map((sh) => {
                    const o = ov.get(i.id)?.[sh.id];
                    return <TD key={sh.id} className={cn('text-right tabular-nums', o != null ? 'font-semibold text-brand-primary' : 'text-text-muted')}>{o != null ? formatRs(o) : '·'}</TD>;
                  })}
                </tr>
              ))}
              {rows.length === 0 ? <EmptyRow colSpan={2 + (shops ?? []).length}>No item matches.</EmptyRow> : null}
            </tbody>
          </Table>
          <p className="text-xs text-text-muted">“·” = the shop sells at the central price. Click an item to change prices.</p>
        </div>
        {sel && hasPerm(ctx.member.perms, 'item.edit') ? (
          <div className="xl:w-[420px]"><ItemPriceEditor key={sel.id} item={sel} shops={shops ?? []} overrides={ov.get(sel.id) ?? {}} /></div>
        ) : null}
      </div>
    </>
  );
}
