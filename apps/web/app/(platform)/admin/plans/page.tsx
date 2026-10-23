import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs } from '@laneos/core';
import { Badge, PageHeader, Table, TD, TH } from '@laneos/ui';
import { PlanEditor } from '@/components/admin/AdminForms';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'Plans' };

// Plans (Figma 3-3565, not read — compare when Figma access returns). The sign-up page lists the same plans in lib/plans.ts.
export default async function AdminPlansPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: plans }, { data: tenants }] = await Promise.all([
    supabase.from('plans').select('*').order('sort_order'),
    supabase.schema('api').rpc('admin_tenants', { p_search: '', p_status: '' }),
  ]);
  const count = new Map<string, number>();
  for (const t of (tenants ?? []) as unknown as { planId: string; status: string }[]) if (t.status !== 'cancelled') count.set(t.planId, (count.get(t.planId) ?? 0) + 1);
  const sel = (plans ?? []).find((p) => p.id === id);
  return (
    <>
      <PageHeader title="Plans" subtitle="What each plan costs and allows. Changes apply to tenants when their plan is (re)set." />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <Table>
            <thead><tr><TH>Plan</TH><TH className="text-right">Price</TH><TH className="text-right">Shops</TH><TH className="text-right">Lanes / shop</TH><TH className="text-right">Staff</TH><TH>Features</TH><TH className="text-right">Tenants</TH></tr></thead>
            <tbody>
              {(plans ?? []).map((p) => (
                <tr key={p.id} className={p.id === id ? 'bg-brand-light/40' : undefined}>
                  <TD className="font-medium"><Link href={`/admin/plans?id=${p.id}`} className="hover:underline">{p.name}</Link><span className="block text-[11px] font-normal text-text-muted">{p.id}{p.is_active ? '' : ' · not offered'}</span></TD>
                  <TD className="text-right tabular-nums">{p.is_custom ? 'Custom' : `${formatRs(p.price_cents, { decimals: 0 })}${p.per_shop ? ' / shop' : ''}`}</TD>
                  <TD className="text-right tabular-nums">{p.max_shops}</TD>
                  <TD className="text-right tabular-nums">{p.max_lanes_per_shop}</TD>
                  <TD className="text-right tabular-nums">{p.max_staff}</TD>
                  <TD className="flex flex-wrap gap-1">{p.transfers ? <Badge tone="brand">Transfers</Badge> : null}{p.head_office ? <Badge tone="info">Head office</Badge> : null}</TD>
                  <TD className="text-right tabular-nums">{count.get(p.id) ?? 0}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div className="xl:w-[380px]">
          <PlanEditor key={sel?.id ?? 'new'} plan={sel ? {
            id: sel.id, name: sel.name, price: String(sel.price_cents / 100), maxShops: String(sel.max_shops), maxLanesPerShop: String(sel.max_lanes_per_shop),
            maxStaff: String(sel.max_staff), perShop: sel.per_shop, headOffice: sel.head_office, transfers: sel.transfers, isCustom: sel.is_custom,
            isActive: sel.is_active, description: sel.description ?? '', sortOrder: String(sel.sort_order),
          } : undefined} />
        </div>
      </div>
    </>
  );
}
