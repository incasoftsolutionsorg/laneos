import 'server-only';
import type { requireTenant } from '@/lib/server/context';

type Ctx = Awaited<ReturnType<typeof requireTenant>>;

/** Items for purchasing pickers: name, barcodes, PLU, last cost, case size and preferred supplier. */
export async function purchaseItems(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from('items')
    .select('id, name, item_type, plu, cost_cents, supplier_id, track_batches, barcodes(code, pack_qty)')
    .eq('is_active', true).neq('item_type', 'open_price').order('name').limit(5000);
  return (data ?? []).map((i) => ({
    id: i.id, name: i.name, itemType: i.item_type, plu: i.plu, costCents: i.cost_cents, supplierId: i.supplier_id, trackBatches: i.track_batches,
    barcodes: i.barcodes.map((b) => b.code), caseQty: Math.max(1, ...i.barcodes.map((b) => b.pack_qty)),
  }));
}

export type PurchaseItem = Awaited<ReturnType<typeof purchaseItems>>[number];

export async function supplierList(ctx: Ctx) {
  const { data } = await ctx.supabase.from('suppliers').select('id, name, payment_terms_days').eq('is_active', true).order('name');
  return data ?? [];
}
