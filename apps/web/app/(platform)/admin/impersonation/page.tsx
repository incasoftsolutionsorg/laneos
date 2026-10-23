import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs } from '@laneos/core';
import { Alert, Badge, Card, CardTitle, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { EndSupport } from '@/components/admin/AdminForms';
import { ago, fmtDateTime } from '@/lib/server/dates';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'Support view' };

interface View {
  settings: Record<string, unknown>;
  lanes: { shop: string; code: string; status: string; registered: boolean; lastSeen: string | null; shiftOpen: boolean }[];
  counts: { items: number; itemsNoPrice: number; negativeStock: number; salesToday: number };
  syncIssues: { lane: string; code: string; message: string; at: string }[];
  recentSales: { invoice: string; total: number; at: string }[];
}

const SHOWN = ['name', 'status', 'plan_id', 'rounding_unit_cents', 'embedded_barcode_mode', 'vat_registered', 'prices_include_vat', 'receipt_paper', 'receipt_silent', 'credit_note_days', 'require_2fa', 'lane_lock_min', 'catalog_version'];

// Support view / impersonation (Figma 3-4617, not read — compare when Figma access returns).
// Read-only, time-boxed, audited in the tenant's own activity log. No customer personal data.
export default async function SupportViewPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant } = await searchParams;
  const { supabase, userId } = await requireAdmin();
  const { data: sessions } = await supabase.from('support_sessions')
    .select('id, admin_id, tenant_id, reason, started_at, expires_at, ended_at, tenant:tenants(name)').order('started_at', { ascending: false }).limit(50);
  const active = (sessions ?? []).find((s) => s.admin_id === userId && s.tenant_id === tenant && !s.ended_at && new Date(s.expires_at) > new Date());
  const { data: view, error } = active ? await supabase.schema('api').rpc('admin_support_view', { p_tenant: tenant! }) : { data: null, error: null };
  const v = view as unknown as View | null;

  return (
    <>
      <PageHeader title="Support view" subtitle="Start one from a tenant's page. It ends by itself; every view is in the tenant's activity log." />
      {active && v ? (
        <>
          <Alert tone="warning">Viewing <b>{active.tenant?.name}</b> read-only until {fmtDateTime(active.expires_at)} · {active.reason}</Alert>
          <div className="flex gap-3"><EndSupport id={active.id} /><Link href={`/admin/tenants/${tenant}`} className="self-center text-xs font-semibold text-brand-primary hover:underline">Tenant page</Link></div>
          <div className="grid gap-4 md:grid-cols-4">
            {([['Active items', v.counts.items], ['Items without a price', v.counts.itemsNoPrice], ['Items below zero stock', v.counts.negativeStock], ['Bills today', v.counts.salesToday]] as const).map(([k, n]) => (
              <Card key={k} className="flex flex-col gap-1 p-4"><span className="text-xs text-text-muted">{k}</span><span className="text-xl font-bold tabular-nums">{n}</span></Card>
            ))}
          </div>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <Table>
                <thead><tr><TH>Lane</TH><TH>Device</TH><TH>Shift</TH><TH>Last seen</TH></tr></thead>
                <tbody>{v.lanes.map((l) => <tr key={`${l.shop}${l.code}`}><TD>{l.shop} {l.code}{l.status !== 'active' ? ' (disabled)' : ''}</TD><TD>{l.registered ? 'Registered' : 'Not registered'}</TD><TD>{l.shiftOpen ? <Badge tone="success">Open</Badge> : '—'}</TD><TD>{ago(l.lastSeen)}</TD></tr>)}</tbody>
              </Table>
              <Table>
                <thead><tr><TH>Sync issue</TH><TH>Lane</TH><TH>Message</TH><TH>When</TH></tr></thead>
                <tbody>
                  {v.syncIssues.map((s, i) => <tr key={i}><TD className="font-mono text-xs">{s.code}</TD><TD>{s.lane}</TD><TD className="text-xs">{s.message}</TD><TD>{ago(s.at)}</TD></tr>)}
                  {v.syncIssues.length === 0 ? <EmptyRow colSpan={4}>No open sync issues.</EmptyRow> : null}
                </tbody>
              </Table>
            </div>
            <div className="flex flex-col gap-4 xl:w-[360px]">
              <Card className="flex flex-col gap-1.5 p-5">
                <CardTitle>Settings</CardTitle>
                {SHOWN.map((k) => <div key={k} className="flex justify-between gap-3 text-xs"><span className="text-text-muted">{k}</span><span className="font-mono">{String(v.settings[k] ?? '—')}</span></div>)}
              </Card>
              <Card className="flex flex-col gap-1.5 p-5">
                <CardTitle>Last bills</CardTitle>
                {v.recentSales.map((s) => <div key={s.invoice} className="flex justify-between text-xs"><span className="font-mono">{s.invoice}</span><span>{formatRs(s.total)} · {ago(s.at)}</span></div>)}
              </Card>
            </div>
          </div>
        </>
      ) : error ? <Alert>{error.message}</Alert> : null}
      <h2 className="text-[15px] font-semibold">Recent support views</h2>
      <Table>
        <thead><tr><TH>Business</TH><TH>Reason</TH><TH>Started</TH><TH>Status</TH></tr></thead>
        <tbody>
          {(sessions ?? []).map((s) => (
            <tr key={s.id}>
              <TD><Link href={`/admin/tenants/${s.tenant_id}`} className="hover:underline">{s.tenant?.name}</Link></TD>
              <TD className="text-xs">{s.reason}</TD>
              <TD>{fmtDateTime(s.started_at)}</TD>
              <TD>{s.ended_at ? <Badge>Ended</Badge> : new Date(s.expires_at) > new Date() ? <Link href={`/admin/impersonation?tenant=${s.tenant_id}`}><Badge tone="warning">Active</Badge></Link> : <Badge>Expired</Badge>}</TD>
            </tr>
          ))}
          {(sessions ?? []).length === 0 ? <EmptyRow colSpan={4}>No support views yet.</EmptyRow> : null}
        </tbody>
      </Table>
    </>
  );
}
