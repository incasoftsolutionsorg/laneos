import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasPerm } from '@laneos/core';
import { PinScreen } from '@/components/lane/PinScreen';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Cashier PIN' };

export default async function PinPage({ params }: { params: Promise<{ laneId: string }> }) {
  const { laneId } = await params;
  const ctx = await requireTenant('sale.create');
  const [{ data: lane }, { data: cashiers }] = await Promise.all([
    ctx.supabase.from('lanes').select('id, code, registered_at, shop:shops(name)').eq('id', laneId).maybeSingle(),
    ctx.supabase.schema('api').rpc('lane_cashiers', { p_lane: laneId }),
  ]);
  if (!lane) notFound();

  return (
    <PinScreen
      laneId={lane.id}
      laneLabel={`Lane ${lane.code} · ${ctx.tenant.name} ${lane.shop?.name ?? ''}`}
      cashiers={(cashiers ?? []) as { id: string; name: string; locked: boolean }[]}
      registered={lane.registered_at != null}
      canRegister={hasPerm(ctx.member.perms, 'staff.manage')}
    />
  );
}
