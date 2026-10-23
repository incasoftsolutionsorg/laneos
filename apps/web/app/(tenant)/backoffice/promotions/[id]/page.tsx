import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@laneos/ui';
import { PromotionForm } from '@/components/backoffice/PromotionForm';
import { promoItems } from '../items';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Edit promotion' };

const day = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : '');

export default async function EditPromotionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant('promotion.manage');
  const { data: p } = await ctx.supabase.from('promotions').select('*, promotion_items(item_id)').eq('id', id).maybeSingle();
  if (!p) notFound();
  return (
    <>
      <PageHeader title={p.name} subtitle="Edit promotion" />
      <PromotionForm
        items={await promoItems(ctx)}
        values={{
          id: p.id, name: p.name, kind: p.kind, buyQty: String(p.buy_qty ?? ''), percent: p.percent_bp ? String(p.percent_bp / 100) : '',
          bundlePrice: p.bundle_price_cents != null ? (p.bundle_price_cents / 100).toFixed(2) : '',
          startsOn: day(p.starts_at), endsOn: day(p.ends_at), isActive: p.is_active, itemIds: p.promotion_items.map((x) => x.item_id),
        }}
      />
    </>
  );
}
