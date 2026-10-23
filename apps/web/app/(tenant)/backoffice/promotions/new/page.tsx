import type { Metadata } from 'next';
import { PageHeader } from '@laneos/ui';
import { PromotionForm } from '@/components/backoffice/PromotionForm';
import { promoItems } from '../items';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'New promotion' };

export default async function NewPromotionPage() {
  const ctx = await requireTenant('promotion.manage');
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="New promotion" subtitle="Lanes pick it up on their next catalogue load; a shelf label is queued for each item." />
      <PromotionForm items={await promoItems(ctx)} values={{ name: '', kind: 'multi_buy', buyQty: '3', bundlePrice: '', percent: '', startsOn: today, endsOn: '', isActive: true, itemIds: [] }} />
    </>
  );
}
