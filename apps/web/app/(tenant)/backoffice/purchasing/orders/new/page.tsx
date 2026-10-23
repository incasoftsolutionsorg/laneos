import type { Metadata } from 'next';
import { PageHeader } from '@laneos/ui';
import { PoEditor } from '@/components/backoffice/PoEditor';
import { requireTenant } from '@/lib/server/context';
import { purchaseItems, supplierList } from '../../data';

export const metadata: Metadata = { title: 'New purchase order' };

export default async function NewPoPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const { supplier = '' } = await searchParams;
  const ctx = await requireTenant('grn.post');
  const [items, suppliers] = await Promise.all([purchaseItems(ctx), supplierList(ctx)]);
  return (
    <>
      <PageHeader title="New purchase order" subtitle={`${ctx.shop.name} · the supplier's items are listed first`} />
      <PoEditor items={items} suppliers={suppliers} editable po={{ status: 'draft', supplierId: supplier, expectedOn: '', note: '', lines: [] }} />
    </>
  );
}
