import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs } from '@laneos/core';
import { Badge, EmptyRow, Input, PageHeader, Table, TD, TH, buttonClass, chipClass } from '@laneos/ui';
import { STATUS_TONE } from '@/lib/admin-ui';
import { ago } from '@/lib/server/dates';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'Tenants' };

interface TenantRow {
  id: string; name: string; slug: string; status: string; plan: string; city: string | null; createdAt: string; mrr: number;
  shops: number; lanes: number; staff: number; lastSale: string | null; overdue: number; owner: string | null;
}

// Tenants (Figma 3-3026, not read — built from blueprint E.1.5; compare when Figma access returns).
export default async function AdminTenantsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q = '', status = '' } = await searchParams;
  const { supabase } = await requireAdmin();
  const { data } = await supabase.schema('api').rpc('admin_tenants', { p_search: q, p_status: status });
  const rows = (data ?? []) as unknown as TenantRow[];
  const filters = ['', 'trial', 'active', 'past_due', 'suspended', 'cancelled'];
  return (
    <>
      <PageHeader title="Tenants" subtitle={`${rows.length} businesses`} actions={<Link href="/admin/tenants/new" className={buttonClass('primary')}>+ New tenant</Link>} />
      <div className="flex flex-wrap items-center gap-2">
        <form className="w-72"><Input name="q" defaultValue={q} placeholder="Search name or slug" aria-label="Search tenants" />{status ? <input type="hidden" name="status" value={status} /> : null}</form>
        {filters.map((f) => <Link key={f} href={`/admin/tenants?${new URLSearchParams({ ...(q ? { q } : {}), ...(f ? { status: f } : {}) })}`} className={chipClass(f === status)}>{f ? f.replace('_', ' ') : 'All'}</Link>)}
      </div>
      <Table>
        <thead><tr><TH>Business</TH><TH>Owner</TH><TH>Plan</TH><TH>Status</TH><TH className="text-right">Shops / lanes</TH><TH className="text-right">MRR</TH><TH>Last sale</TH><TH className="text-right">Overdue</TH></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <TD className="font-medium"><Link href={`/admin/tenants/${t.id}`} className="hover:underline">{t.name}</Link><span className="block text-[11px] font-normal text-text-muted">{t.city ?? t.slug}</span></TD>
              <TD className="text-xs">{t.owner ?? '—'}</TD>
              <TD>{t.plan}</TD>
              <TD><Badge tone={STATUS_TONE[t.status] ?? 'neutral'}>{t.status.replace('_', ' ')}</Badge></TD>
              <TD className="text-right tabular-nums">{t.shops} / {t.lanes}</TD>
              <TD className="text-right tabular-nums">{formatRs(t.mrr, { decimals: 0 })}</TD>
              <TD>{ago(t.lastSale)}</TD>
              <TD className="text-right tabular-nums">{t.overdue ? <span className="font-semibold text-danger">{formatRs(t.overdue, { decimals: 0 })}</span> : '—'}</TD>
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={8}>No tenants match.</EmptyRow> : null}
        </tbody>
      </Table>
    </>
  );
}
