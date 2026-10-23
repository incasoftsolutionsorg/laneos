import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERM } from '@laneos/core';
import { BackofficeShell } from '@/components/backoffice/Shell';
import { ReturnScreen } from '@/components/lane/ReturnScreen';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Customer return' };

export default async function ReturnPage({ params, searchParams }: {
  params: Promise<{ laneId: string }>; searchParams: Promise<{ invoice?: string }>;
}) {
  const [{ laneId }, { invoice }] = await Promise.all([params, searchParams]);
  const ctx = await requireTenant('return.create');
  const [{ data: lane }, { data: tenant }, { data: shop }, { data: members }] = await Promise.all([
    ctx.supabase.from('lanes').select('id, code').eq('id', laneId).maybeSingle(),
    ctx.supabase.from('tenants').select('credit_note_days, cash_refund_pin_cents').eq('id', ctx.tenant.id).single(),
    ctx.supabase.from('shops').select('name, address, phone').eq('id', ctx.shop.id).single(),
    ctx.supabase.from('members').select('id, display_name, has_pin, role:roles(permissions)').eq('is_active', true).eq('has_pin', true),
  ]);
  if (!lane) notFound();
  // Supervisors approve large cash refunds: shift.manage and a PIN.
  const supervisors = (members ?? [])
    .filter((m) => (Number(m.role?.permissions ?? 0) & PERM['shift.manage']) !== 0)
    .map((m) => ({ id: m.id, name: m.display_name }));

  return (
    <BackofficeShell ctx={ctx} active="/backoffice/credit-notes">
      <ReturnScreen
        laneId={lane.id} laneCode={lane.code} tenant={ctx.tenant.name} shop={shop ?? { name: ctx.shop.name, address: null, phone: null }}
        creditDays={tenant?.credit_note_days ?? 90} pinLimitCents={tenant?.cash_refund_pin_cents ?? 500000}
        supervisors={supervisors} initialInvoice={invoice} cashier={ctx.member.name}
      />
    </BackofficeShell>
  );
}
