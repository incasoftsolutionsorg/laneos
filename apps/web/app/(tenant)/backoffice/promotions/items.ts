import 'server-only';
import type { requireTenant } from '@/lib/server/context';

/** Active items with their standard price, for the promotion item picker. */
export async function promoItems(ctx: Awaited<ReturnType<typeof requireTenant>>) {
  const { data } = await ctx.supabase
    .from('items')
    .select('id, name, price_list_items(price_cents, price_lists!inner(is_default))')
    .eq('is_active', true).eq('price_list_items.price_lists.is_default', true)
    .order('name').limit(5000);
  return (data ?? []).map((i) => ({ id: i.id, name: i.name, priceCents: i.price_list_items[0]?.price_cents ?? null }));
}
