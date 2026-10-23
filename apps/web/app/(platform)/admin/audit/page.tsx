import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyRow, Input, PageHeader, Table, TD, TH, buttonClass, chipClass } from '@laneos/ui';
import { fmtDateTime } from '@/lib/server/dates';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'Platform audit' };

interface Row { id: string; at: string; tenant: string | null; tenantId: string | null; action: string; entity: string; actor: string | null; data: Record<string, unknown> }

// Audit (Figma 3-4771, not read — compare when Figma access returns): every tenant's activity plus platform actions.
export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ action?: string; tenant?: string; before?: string }> }) {
  const { action = '', tenant = '', before } = await searchParams;
  const { supabase } = await requireAdmin();
  const { data } = await supabase.schema('api').rpc('admin_audit', { p_tenant: (tenant || null) as string, p_action: action, p_before: (before || null) as string });
  const rows = (data ?? []) as unknown as Row[];
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(action ? { action } : {}), ...(tenant ? { tenant } : {}), ...extra }).toString();
  return (
    <>
      <PageHeader title="Audit" subtitle="Platform actions and every business's activity log" />
      <div className="flex flex-wrap items-center gap-2">
        {[['', 'Everything'], ['platform.', 'Platform staff'], ['support.', 'Support views'], ['security.', 'Security'], ['settings.', 'Settings'], ['member.', 'Staff'], ['export.', 'Exports']].map(([k, t]) => (
          <Link key={k} href={`/admin/audit?${new URLSearchParams({ ...(k ? { action: k } : {}), ...(tenant ? { tenant } : {}) })}`} className={chipClass(k === action)}>{t}</Link>
        ))}
        <form className="w-60">{action ? <input type="hidden" name="action" value={action} /> : null}<Input name="action" defaultValue={action} placeholder="Action starts with…" aria-label="Action prefix" /></form>
      </div>
      {tenant ? <p className="text-xs text-text-muted">One business only · <Link href={`/admin/audit?${new URLSearchParams(action ? { action } : {})}`} className="font-semibold text-brand-primary">show all</Link></p> : null}
      <Table>
        <thead><tr><TH>When</TH><TH>Business</TH><TH>Who</TH><TH>Action</TH><TH>Details</TH></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <TD className="whitespace-nowrap">{fmtDateTime(r.at)}</TD>
              <TD>{r.tenantId ? <Link href={`/admin/audit?${qs({ tenant: r.tenantId })}`} className="hover:underline">{r.tenant}</Link> : <span className="text-text-muted">Platform</span>}</TD>
              <TD className="text-xs">{r.actor ?? 'System'}</TD>
              <TD className="font-mono text-xs">{r.action}</TD>
              <TD className="max-w-[420px] truncate text-xs text-text-muted" title={JSON.stringify(r.data)}>
                {Object.entries(r.data ?? {}).filter(([, v]) => v != null && typeof v !== 'object').slice(0, 4).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') || r.entity}
              </TD>
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={5}>Nothing matches.</EmptyRow> : null}
        </tbody>
      </Table>
      {rows.length === 200 ? <Link href={`/admin/audit?${qs({ before: rows.at(-1)!.at })}`} className={buttonClass('secondary', 'w-fit')}>Older</Link> : null}
    </>
  );
}
