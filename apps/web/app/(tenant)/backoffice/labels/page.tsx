import type { Metadata } from 'next';
import { formatRs } from '@laneos/core';
import { PageHeader } from '@laneos/ui';
import { LabelQueue, type QueueRow } from '@/components/backoffice/LabelQueue';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Print labels' };

export default async function LabelsPage() {
  const ctx = await requireTenant('item.edit');
  const [{ data: queue }, { data: items }] = await Promise.all([
    ctx.supabase.from('label_queue')
      .select('id, item_id, reason, copies, old_price_cents, item:items(name, item_type, barcodes(code, pack_qty), price_list_items(price_cents, price_lists!inner(is_default)), promotion_items(promotion:promotions(name, kind, buy_qty, bundle_price_cents, percent_bp, is_active)))')
      .eq('shop_id', ctx.shop.id).is('printed_at', null).eq('item.price_list_items.price_lists.is_default', true)
      .order('created_at').limit(500),
    ctx.supabase.from('items').select('id, name').eq('is_active', true).order('name').limit(5000),
  ]);

  const rows: QueueRow[] = (queue ?? []).flatMap((q) => {
    const it = q.item;
    if (!it) return [];
    const promo = it.promotion_items.map((p) => p.promotion).find((p) => p?.is_active);
    return [{
      id: q.id, itemId: q.item_id, name: it.name, itemType: it.item_type, reason: q.reason, copies: q.copies,
      priceCents: it.price_list_items[0]?.price_cents ?? 0, otherPriceCents: q.old_price_cents,
      barcode: it.barcodes.find((b) => b.pack_qty === 1)?.code ?? null,
      promoText: promo ? (promo.kind === 'multi_buy' ? `${promo.buy_qty} for ${formatRs(promo.bundle_price_cents ?? 0, { decimals: 0 })}` : `${(promo.percent_bp ?? 0) / 100}% off`) : null,
    }];
  });

  return (
    <>
      <PageHeader title="Print labels" subtitle="Shelf labels after price changes, item stickers and reduced stickers" />
      <LabelQueue rows={rows} items={items ?? []} />
    </>
  );
}
