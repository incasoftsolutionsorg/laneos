import type { Metadata } from 'next';
import { PageHeader } from '@laneos/ui';
import { ItemForm } from '@/components/items/ItemForm';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Add item' };

export default async function NewItemPage() {
  const ctx = await requireTenant('item.edit');
  const { data: departments } = await ctx.supabase.from('departments').select('id, name').eq('is_active', true).order('sort_order').order('name');
  return (
    <>
      <PageHeader title="Add item" subtitle="The price goes into the standard price list; lanes pick it up on their next sync and a shelf label is queued." />
      <ItemForm
        departments={departments ?? []}
        values={{
          name: '', brand: '', departmentId: null, itemType: 'standard', taxClass: 'standard', plu: null, barcodes: [],
          price: '', mrp: '', cost: '', wholesale: '', minPrice: '', reorderLevel: '0',
          isReturnable: true, trackBatches: false, isPinned: false,
        }}
      />
    </>
  );
}
