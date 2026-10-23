import 'server-only';
import type { OpenPo } from '@/components/backoffice/GrnEditor';
import type { requireTenant } from '@/lib/server/context';

/** Purchase orders that can still be received against. */
export async function openPos(ctx: Awaited<ReturnType<typeof requireTenant>>): Promise<OpenPo[]> {
  const { data } = await ctx.supabase.from('purchase_orders')
    .select('id, po_no, supplier_id, purchase_order_lines(item_id, qty_milli, received_milli, unit_cost_cents)')
    .eq('shop_id', ctx.shop.id).in('status', ['sent', 'partially_received']).order('created_at', { ascending: false });
  return (data ?? []).map((p) => ({
    id: p.id, poNo: p.po_no, supplierId: p.supplier_id,
    lines: p.purchase_order_lines.map((l) => ({ itemId: l.item_id, qtyMilli: l.qty_milli, receivedMilli: l.received_milli, unitCostCents: l.unit_cost_cents })),
  }));
}
