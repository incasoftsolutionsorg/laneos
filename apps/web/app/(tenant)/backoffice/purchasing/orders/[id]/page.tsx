import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasPerm } from '@laneos/core';
import { Badge, PageHeader } from '@laneos/ui';
import { PoEditor } from '@/components/backoffice/PoEditor';
import { requireTenant } from '@/lib/server/context';
import { purchaseItems, supplierList } from '../../data';
import { PO_STATUS } from '@/lib/purchasing';

export const metadata: Metadata = { title: 'Purchase order' };

export default async function PoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const { data: po } = await ctx.supabase.from('purchase_orders')
    .select('id, po_no, status, supplier_id, expected_on, note, created_at, purchase_order_lines(item_id, qty_milli, unit_cost_cents, received_milli)')
    .eq('id', id).maybeSingle();
  if (!po) notFound();
  const [items, suppliers] = await Promise.all([purchaseItems(ctx), supplierList(ctx)]);
  const [text, tone] = PO_STATUS[po.status] ?? [po.status, 'neutral'];
  const editable = po.status === 'draft' && hasPerm(ctx.member.perms, 'grn.post');

  return (
    <>
      <PageHeader title={po.po_no} subtitle="Purchase order" actions={<Badge tone={tone}>{text}</Badge>} />
      <PoEditor items={items} suppliers={suppliers} editable={editable}
        po={{
          id: po.id, poNo: po.po_no, status: po.status, supplierId: po.supplier_id, expectedOn: po.expected_on ?? '', note: po.note ?? '',
          lines: po.purchase_order_lines.map((l) => ({ itemId: l.item_id, qtyMilli: l.qty_milli, unitCostCents: l.unit_cost_cents, receivedMilli: l.received_milli })),
        }} />
    </>
  );
}
