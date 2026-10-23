import type { Metadata } from 'next';
import { PageHeader } from '@laneos/ui';
import { GrnEditor } from '@/components/backoffice/GrnEditor';
import { requireTenant } from '@/lib/server/context';
import { purchaseItems, supplierList } from '../../data';
import { openPos } from '../open-pos';

export const metadata: Metadata = { title: 'Receive goods' };

export default async function NewGrnPage({ searchParams }: { searchParams: Promise<{ po?: string }> }) {
  const { po } = await searchParams;
  const ctx = await requireTenant('grn.post');
  const [items, suppliers, pos] = await Promise.all([purchaseItems(ctx), supplierList(ctx), openPos(ctx)]);
  const fromPo = pos.find((p) => p.id === po);
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Receive goods (GRN)" subtitle="Scan items from the delivery, enter batch and expiry, then post to stock" />
      <GrnEditor items={items} suppliers={suppliers} openPos={pos} editable
        grn={{
          supplierId: fromPo?.supplierId ?? '', poId: fromPo?.id ?? '', supplierInvoiceNo: '', receivedOn: today, discountCents: 0,
          lines: (fromPo?.lines ?? []).filter((l) => l.qtyMilli > l.receivedMilli).map((l) => ({
            itemId: l.itemId, batchNo: '', expiryOn: '', qty: String((l.qtyMilli - l.receivedMilli) / 1000), free: '0', cost: (l.unitCostCents / 100).toFixed(2),
          })),
        }} />
    </>
  );
}
