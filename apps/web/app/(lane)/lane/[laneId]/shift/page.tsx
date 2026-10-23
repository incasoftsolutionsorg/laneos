import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hasPerm } from '@laneos/core';
import { Card, PageHeader, buttonClass } from '@laneos/ui';
import { BackofficeShell } from '@/components/backoffice/Shell';
import { CloseShift, type ShiftSummary } from '@/components/lane/CloseShift';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Close shift' };

export default async function ShiftPage({ params }: { params: Promise<{ laneId: string }> }) {
  const { laneId } = await params;
  const ctx = await requireTenant('sale.create');
  const { data: lane } = await ctx.supabase.from('lanes').select('id, code').eq('id', laneId).maybeSingle();
  if (!lane) notFound();
  const { data: shift } = await ctx.supabase.from('shifts').select('id').eq('lane_id', laneId).eq('status', 'open').maybeSingle();

  let summary: ShiftSummary | null = null;
  if (shift) {
    const { data, error } = await ctx.supabase.schema('api').rpc('shift_summary', { p_shift: shift.id });
    if (error) throw new Error(error.message);
    summary = { ...(data as unknown as ShiftSummary), tenant: ctx.tenant.name };
  }

  return (
    <BackofficeShell ctx={ctx} active="/backoffice/reports/shifts">
      {summary ? (
        <CloseShift s={summary} canPickup={hasPerm(ctx.member.perms, 'cash.pickup')} />
      ) : (
        <>
          <PageHeader title="Close shift" subtitle={`Lane ${lane.code}`} />
          <Card className="flex max-w-lg flex-col gap-3 p-6">
            <p className="text-[13px]">Lane {lane.code} has no open shift.</p>
            <div className="flex gap-3">
              <Link href={`/lane/${laneId}`} className={buttonClass('primary')}>Open a shift</Link>
              <Link href="/backoffice/reports/shifts" className={buttonClass('secondary')}>Past shifts</Link>
            </div>
          </Card>
        </>
      )}
    </BackofficeShell>
  );
}
