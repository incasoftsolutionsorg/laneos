import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Checkout } from '@/components/lane/Checkout';
import { LaneBar } from '@/components/lane/LaneBar';
import { OpenShiftCard } from '@/components/lane/ShiftPanels';
import type { LaneCatalog } from '@/lib/lane/cart';
import { requireTenant } from '@/lib/server/context';
import { publicUrl } from '@/lib/storage';

export const metadata: Metadata = { title: 'Checkout' };

export default async function LanePage({ params }: { params: Promise<{ laneId: string }> }) {
  const { laneId } = await params;
  const ctx = await requireTenant('sale.create');
  const { data, error } = await ctx.supabase.schema('api').rpc('lane_catalog', { p_lane: laneId });
  if (error || !data) notFound();
  const catalog = data as unknown as LaneCatalog;

  // A registered lane sells only after a cashier unlocks it with a PIN (blueprint THR-001).
  if (catalog.lane.registered && !catalog.activeMember) redirect(`/lane/${laneId}/pin`);
  const cashier = catalog.activeMember?.name ?? ctx.member.name;
  const cashierRole = catalog.activeMember ? 'Cashier' : ctx.member.roleName;

  if (!catalog.shift) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <LaneBar title={`${catalog.tenant.name} · ${catalog.shop.name}`} laneId={laneId} laneCode={catalog.lane.code} shift={null} cashier={cashier} cashierRole={cashierRole} />
        <OpenShiftCard laneId={catalog.lane.id} laneCode={catalog.lane.code} cashier={cashier} />
      </div>
    );
  }
  const [{ data: t }, { data: shop }] = await Promise.all([
    ctx.supabase.from('tenants').select('receipt_paper, receipt_header, receipt_footer, receipt_print_logo, vat_registered, vat_no, lane_lock_min').eq('id', ctx.tenant.id).single(),
    ctx.supabase.from('shops').select('address, phone').eq('id', catalog.shop.id).single(),
  ]);
  const receipt = t ? {
    settings: { paper: t.receipt_paper, header: t.receipt_header, footer: t.receipt_footer, logo: t.receipt_print_logo, vatNo: t.vat_registered ? t.vat_no : null, logoUrl: publicUrl(ctx.tenant.logo_path) },
    address: shop?.address ?? null,
    phone: shop?.phone ? shop.phone.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3') : null,
  } : undefined;
  return <Checkout catalog={catalog} cashier={cashier} cashierRole={cashierRole} receipt={receipt} lockMinutes={t?.lane_lock_min} />;
}
