import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Checkout } from '@/components/lane/Checkout';
import { LaneBar } from '@/components/lane/LaneBar';
import { OpenShiftCard } from '@/components/lane/ShiftPanels';
import type { LaneCatalog } from '@/lib/lane/cart';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Checkout' };

export default async function LanePage({ params }: { params: Promise<{ laneId: string }> }) {
  const { laneId } = await params;
  const ctx = await requireTenant('sale.create');
  const { data, error } = await ctx.supabase.schema('api').rpc('lane_catalog', { p_lane: laneId });
  if (error || !data) notFound();
  const catalog = data as unknown as LaneCatalog;

  if (!catalog.shift) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <LaneBar title={`${catalog.tenant.name} · ${catalog.shop.name}`} laneCode={catalog.lane.code} shift={null} cashier={ctx.member.name} />
        <OpenShiftCard laneId={catalog.lane.id} laneName={catalog.lane.name} />
      </div>
    );
  }
  return <Checkout catalog={catalog} cashier={ctx.member.name} />;
}
