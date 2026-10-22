import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@laneos/ui';
import { ItemForm } from '@/components/items/ItemForm';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Edit item' };

const rupees = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant('item.edit');

  const [{ data: item }, { data: departments }, { data: price }, { data: barcode }] = await Promise.all([
    ctx.supabase.from('items').select('*').eq('id', id).maybeSingle(),
    ctx.supabase.from('departments').select('id, name').eq('is_active', true).order('sort_order').order('name'),
    ctx.supabase.from('price_list_items').select('price_cents, price_lists!inner(is_default)').eq('item_id', id).eq('price_lists.is_default', true).maybeSingle(),
    ctx.supabase.from('barcodes').select('code').eq('item_id', id).order('created_at').limit(1).maybeSingle(),
  ]);
  if (!item) notFound();

  return (
    <>
      <PageHeader title={item.name} subtitle="Edit item" />
      <ItemForm
        departments={departments ?? []}
        values={{
          id: item.id, name: item.name, departmentId: item.department_id, itemType: item.item_type, taxClass: item.tax_class,
          plu: item.plu, barcode: barcode?.code ?? null, price: rupees(price?.price_cents), mrp: rupees(item.mrp_cents),
          cost: rupees(item.cost_cents), reorderLevel: String(item.reorder_level_milli / 1000),
          isReturnable: item.is_returnable, trackBatches: item.track_batches, isPinned: item.is_pinned,
        }}
      />
    </>
  );
}
