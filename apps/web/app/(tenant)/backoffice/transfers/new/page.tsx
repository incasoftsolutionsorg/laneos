import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, buttonClass } from '@laneos/ui';
import { ChainUpgrade } from '@/components/backoffice/ChainUpgrade';
import { TransferRequest } from '@/components/backoffice/TransferForms';
import { requireChain } from '@/lib/chain';

export const metadata: Metadata = { title: 'Request stock' };

export default async function NewTransferPage({ searchParams }: { searchParams: Promise<{ item?: string; from?: string }> }) {
  const { item, from } = await searchParams;
  const { ctx, enabled } = await requireChain('stock.adjust');
  if (!enabled) return <ChainUpgrade title="Request stock" />;
  const [{ data: shops }, { data: items }, { data: codes }] = await Promise.all([
    ctx.supabase.from('shops').select('id, code, name').eq('is_active', true).order('code'),
    ctx.supabase.from('items').select('id, name, plu, item_type').eq('is_active', true).order('name').limit(5000),
    ctx.supabase.from('barcodes').select('item_id, code').limit(10000),
  ]);
  const bc = new Map<string, string[]>();
  for (const b of codes ?? []) bc.set(b.item_id, [...(bc.get(b.item_id) ?? []), b.code]);
  return (
    <>
      <PageHeader title="Request stock" subtitle="Ask another shop to send items; a manager approves, the other shop dispatches"
        actions={<Link href="/backoffice/transfers" className={buttonClass('secondary')}>Back</Link>} />
      <TransferRequest
        shops={shops ?? []}
        toShopId={ctx.shop.id}
        preset={item ? { itemId: item, fromShopId: from } : undefined}
        items={(items ?? []).map((i) => ({ id: i.id, name: i.name, plu: i.plu, barcodes: bc.get(i.id) ?? [], weighed: i.item_type === 'weighed' }))}
      />
    </>
  );
}
