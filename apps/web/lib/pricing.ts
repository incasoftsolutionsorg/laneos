import 'server-only';
import type { requireTenant } from '@/lib/server/context';

type Ctx = Awaited<ReturnType<typeof requireTenant>>;

/** Items with their central (default list) price and barcodes, for the pricing pickers. */
export async function pricingItems(ctx: Ctx) {
  const [{ data: items }, { data: prices }, { data: codes }] = await Promise.all([
    ctx.supabase.from('items').select('id, name, plu, mrp_cents').eq('is_active', true).order('name').limit(5000),
    ctx.supabase.from('price_list_items').select('item_id, price_cents, price_list:price_lists!inner(is_default)').eq('price_list.is_default', true).limit(5000),
    ctx.supabase.from('barcodes').select('item_id, code').limit(10000),
  ]);
  const central = new Map((prices ?? []).map((p) => [p.item_id, p.price_cents]));
  const bc = new Map<string, string[]>();
  for (const b of codes ?? []) bc.set(b.item_id, [...(bc.get(b.item_id) ?? []), b.code]);
  return (items ?? []).map((i) => ({ id: i.id, name: i.name, plu: i.plu, mrpCents: i.mrp_cents, barcodes: bc.get(i.id) ?? [], centralCents: central.get(i.id) ?? null }));
}
