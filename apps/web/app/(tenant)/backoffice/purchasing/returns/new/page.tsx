import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, buttonClass } from '@laneos/ui';
import { SupplierReturnEditor } from '@/components/backoffice/SupplierReturnForms';
import { purchaseItems } from '../../data';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Return goods' };

export default async function NewSupplierReturnPage({ searchParams }: { searchParams: Promise<{ supplier?: string; report?: string }> }) {
  const { supplier, report } = await searchParams;
  const ctx = await requireTenant('stock.adjust');
  const [items, { data: suppliers }, { data: damaged }] = await Promise.all([
    purchaseItems(ctx),
    ctx.supabase.from('suppliers').select('id, name, is_sale_or_return').eq('is_active', true).order('name'),
    ctx.supabase.from('damage_reports').select('id, report_no, item_id, remaining_milli, unit_cost_cents, item:items(name, item_type, supplier_id)')
      .eq('shop_id', ctx.shop.id).in('status', ['reported', 'awaiting_decision']).gt('remaining_milli', 0).order('created_at'),
  ]);
  // A report opened from Damaged goods suggests the item's preferred supplier.
  const fromReport = (damaged ?? []).find((d) => d.id === report);
  return (
    <>
      <PageHeader title="Return goods to a supplier" subtitle="Damaged stock or unsold sale-or-return stock goes back; the supplier credits or refuses it"
        actions={<Link href="/backoffice/purchasing/returns" className={buttonClass('secondary')}>Back</Link>} />
      <SupplierReturnEditor
        suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name, saleOrReturn: s.is_sale_or_return }))}
        damaged={(damaged ?? []).map((d) => ({ id: d.id, reportNo: d.report_no, itemId: d.item_id, itemName: d.item?.name ?? '', remainingMilli: d.remaining_milli, unitCostCents: d.unit_cost_cents, weighed: d.item?.item_type === 'weighed' }))}
        items={items.map((i) => ({ id: i.id, name: i.name, barcodes: i.barcodes, plu: i.plu, costCents: i.costCents, supplierId: i.supplierId, weighed: i.itemType === 'weighed' }))}
        preset={{ supplierId: supplier ?? fromReport?.item?.supplier_id ?? undefined, reportId: report }}
      />
    </>
  );
}
