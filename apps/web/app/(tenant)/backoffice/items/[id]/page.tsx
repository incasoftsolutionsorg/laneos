import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, PageHeader } from '@laneos/ui';
import { ItemForm } from '@/components/items/ItemForm';
import { ItemPhoto } from '@/components/items/ItemPhoto';
import { publicUrl } from '@/lib/storage';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Edit item' };

const rupees = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant('item.edit');

  const [{ data: item }, { data: departments }, { data: price }, { data: barcodes }] = await Promise.all([
    ctx.supabase.from('items').select('*').eq('id', id).maybeSingle(),
    ctx.supabase.from('departments').select('id, name').eq('is_active', true).order('sort_order').order('name'),
    ctx.supabase.from('price_list_items').select('price_cents, price_lists!inner(is_default)').eq('item_id', id).eq('price_lists.is_default', true).maybeSingle(),
    ctx.supabase.from('barcodes').select('code, pack_qty').eq('item_id', id).order('pack_qty').order('created_at'),
  ]);
  if (!item) notFound();

  return (
    <>
      <PageHeader title={item.name} subtitle="Edit item · price changes queue new shelf labels" />
      <Card className="flex max-w-3xl items-center justify-between gap-4 p-4">
        <div><p className="text-[13px] font-semibold">Photo</p><p className="text-xs text-text-muted">PNG, JPG or WebP up to 2 MB. Kept with the item for the back office; lanes do not show photos yet.</p></div>
        <ItemPhoto itemId={item.id} folder={`${ctx.tenant.id}/items`} value={item.image_path} previewUrl={publicUrl(item.image_path)} />
      </Card>
      <ItemForm
        departments={departments ?? []}
        values={{
          id: item.id, name: item.name, brand: item.brand ?? '', departmentId: item.department_id, itemType: item.item_type,
          taxClass: item.tax_class, plu: item.plu, barcodes: (barcodes ?? []).map((b) => ({ code: b.code, packQty: b.pack_qty })),
          price: rupees(price?.price_cents), mrp: rupees(item.mrp_cents), cost: rupees(item.cost_cents),
          wholesale: rupees(item.wholesale_cents), minPrice: rupees(item.min_price_cents),
          reorderLevel: String(item.reorder_level_milli / 1000),
          isReturnable: item.is_returnable, trackBatches: item.track_batches, isPinned: item.is_pinned,
        }}
      />
    </>
  );
}
