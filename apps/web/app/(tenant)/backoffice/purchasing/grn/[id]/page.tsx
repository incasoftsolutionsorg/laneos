import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasPerm } from '@laneos/core';
import { Badge, PageHeader } from '@laneos/ui';
import { GrnEditor } from '@/components/backoffice/GrnEditor';
import { requireTenant } from '@/lib/server/context';
import { purchaseItems, supplierList } from '../../data';
import { openPos } from '../open-pos';

export const metadata: Metadata = { title: 'GRN' };

export default async function GrnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const { data: g } = await ctx.supabase.from('grns')
    .select('id, grn_no, status, supplier_id, po_id, supplier_invoice_no, received_on, discount_cents, total_cents, paid_cents, grn_lines(item_id, batch_no, expiry_on, qty_milli, free_milli, unit_cost_cents)')
    .eq('id', id).maybeSingle();
  if (!g) notFound();
  const [items, suppliers, pos] = await Promise.all([purchaseItems(ctx), supplierList(ctx), openPos(ctx)]);
  const editable = g.status === 'draft' && hasPerm(ctx.member.perms, 'grn.post');

  return (
    <>
      <PageHeader title={g.grn_no} subtitle={g.status === 'draft' ? 'Draft — not in stock yet' : 'Posted to stock'}
        actions={g.status === 'draft' ? <Badge>Draft</Badge> : g.paid_cents >= g.total_cents ? <Badge tone="success">Paid</Badge> : <Badge tone="warning">Posted · payable</Badge>} />
      <GrnEditor items={items} suppliers={suppliers} openPos={pos} editable={editable}
        grn={{
          id: g.id, supplierId: g.supplier_id, poId: g.po_id ?? '', supplierInvoiceNo: g.supplier_invoice_no ?? '', receivedOn: g.received_on, discountCents: g.discount_cents,
          lines: g.grn_lines.map((l) => ({
            itemId: l.item_id, batchNo: l.batch_no ?? '', expiryOn: l.expiry_on ?? '', qty: String(l.qty_milli / 1000), free: String(l.free_milli / 1000), cost: (l.unit_cost_cents / 100).toFixed(2),
          })),
        }} />
    </>
  );
}
