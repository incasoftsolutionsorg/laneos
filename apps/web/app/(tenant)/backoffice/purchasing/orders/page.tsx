import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, Card, CardTitle, PageHeader, buttonClass } from '@laneos/ui';
import { PoSuggestions, type Suggestion } from '@/components/backoffice/PoSuggestions';
import { PurchasingTabs } from '@/components/backoffice/PurchasingTabs';
import { PO_STATUS } from '@/lib/purchasing';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Purchase orders' };


// Purchase orders (Figma 11-3669).
export default async function OrdersPage() {
  const ctx = await requireTenant();
  const [{ data: suggestions }, { data: orders }] = await Promise.all([
    ctx.supabase.schema('api').rpc('po_suggestions', { p_shop: ctx.shop.id }),
    ctx.supabase.from('purchase_orders').select('id, po_no, status, total_cents, supplier:suppliers(name)')
      .eq('shop_id', ctx.shop.id).order('created_at', { ascending: false }).limit(20),
  ]);
  const canOrder = hasPerm(ctx.member.perms, 'grn.post');

  return (
    <>
      <PageHeader title="Purchase orders" subtitle="Suggested orders from re-order levels, and sent orders"
        actions={canOrder ? <Link href="/backoffice/purchasing/orders/new" className={buttonClass('primary')}>+ New PO</Link> : null} />
      <PurchasingTabs active="/backoffice/purchasing/orders" />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1"><PoSuggestions rows={(suggestions ?? []) as unknown as Suggestion[]} canOrder={canOrder} /></div>
        <Card className="flex flex-col gap-3 p-5 xl:w-[380px]">
          <CardTitle>Orders</CardTitle>
          {(orders ?? []).map((o) => {
            const [text, tone] = PO_STATUS[o.status] ?? [o.status, 'neutral'];
            return (
              <Link key={o.id} href={`/backoffice/purchasing/orders/${o.id}`} className="flex items-center justify-between gap-3 rounded-control p-1 hover:bg-surface-muted">
                <span>
                  <span className="block text-[13px] font-semibold">{o.po_no} · {o.supplier?.name}</span>
                  <span className="block text-xs text-text-muted">{formatRs(o.total_cents, { decimals: 0 })}</span>
                </span>
                <Badge tone={tone}>{text}</Badge>
              </Link>
            );
          })}
          {(orders ?? []).length === 0 ? <p className="text-[13px] text-text-muted">No orders yet.</p> : null}
        </Card>
      </div>
    </>
  );
}
