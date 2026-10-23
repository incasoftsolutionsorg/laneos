import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatRs } from '@laneos/core';
import { Badge, Card, CardTitle, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { StartSupport, TenantControls } from '@/components/admin/AdminForms';
import { STATUS_TONE } from '@/lib/admin-ui';
import { fmtDate, fmtDateTime } from '@/lib/server/dates';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'Tenant' };

interface Detail {
  tenant: { id: string; name: string; slug: string; status: string; planId: string; createdAt: string; trialEndsOn: string | null; nextChargeOn: string | null; city: string | null; businessRegNo: string | null; businessType: string | null; mrr: number };
  entitlements: { max_shops: number; max_lanes_per_shop: number; transfers: boolean; head_office: boolean };
  shops: { code: string; name: string; isActive: boolean; lanes: number }[];
  people: { name: string; role: string; email: string | null; active: boolean; twoFactor: boolean }[];
  invoices: { id: string; invoiceNo: string; periodStart: string; amount: number; status: string; dueOn: string }[];
  tickets: { id: string; no: number; subject: string; status: string; updatedAt: string }[];
  usage: { sales30: number; amount30: number; items: number };
  support: { id: string; reason: string; startedAt: string; endedAt: string | null; expiresAt: string; mine: boolean }[];
}

// Tenant detail (Figma 3-3320, not read — built from blueprint E.1.5; compare when Figma access returns).
export default async function AdminTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAdmin();
  const [{ data }, { data: plans }] = await Promise.all([
    supabase.schema('api').rpc('admin_tenant', { p_tenant: id }),
    supabase.from('plans').select('id, name').order('sort_order'),
  ]);
  if (!data) notFound();
  const d = data as unknown as Detail;
  const t = d.tenant;
  return (
    <>
      <PageHeader title={t.name} subtitle={<span className="flex items-center gap-2"><Badge tone={STATUS_TONE[t.status] ?? 'neutral'}>{t.status.replace('_', ' ')}</Badge>{t.slug} · since {fmtDate(t.createdAt)}</span>} />
      <div className="grid gap-4 md:grid-cols-4">
        {([['MRR', formatRs(t.mrr, { decimals: 0 })], ['Bills, last 30 days', d.usage.sales30.toLocaleString('en-LK')], ['Sales, last 30 days', formatRs(d.usage.amount30, { decimals: 0 })], ['Items', d.usage.items.toLocaleString('en-LK')]] as const).map(([k, v]) => (
          <Card key={k} className="flex flex-col gap-1 p-4"><span className="text-xs text-text-muted">{k}</span><span className="text-xl font-bold tabular-nums">{v}</span></Card>
        ))}
      </div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Card className="flex flex-col gap-2 p-5">
            <CardTitle>Business</CardTitle>
            <p className="text-[13px] text-text-muted">{[t.city, t.businessType, t.businessRegNo && `Reg. ${t.businessRegNo}`].filter(Boolean).join(' · ') || '—'}</p>
            <div className="flex flex-wrap gap-2">{d.shops.map((s) => <span key={s.code} className="rounded-control border border-border px-2.5 py-1 text-[13px]"><b>{s.code}</b> {s.name} · {s.lanes} lanes{s.isActive ? '' : ' · closed'}</span>)}</div>
          </Card>
          <Table>
            <thead><tr><TH>Person</TH><TH>Role</TH><TH>Login</TH><TH>2FA</TH></tr></thead>
            <tbody>
              {d.people.map((p, i) => (
                <tr key={i} className={p.active ? undefined : 'opacity-60'}>
                  <TD className="font-medium">{p.name}</TD><TD>{p.role}</TD><TD className="text-xs">{p.email ?? 'PIN only'}</TD>
                  <TD>{p.email ? (p.twoFactor ? <Badge tone="success">On</Badge> : <Badge tone="danger">Off</Badge>) : '—'}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
          <Table>
            <thead><tr><TH>Invoice</TH><TH>Period</TH><TH className="text-right">Amount</TH><TH>Due</TH><TH>Status</TH></tr></thead>
            <tbody>
              {d.invoices.map((i) => (
                <tr key={i.id}><TD className="font-mono text-xs">{i.invoiceNo}</TD><TD>{i.periodStart.slice(0, 7)}</TD><TD className="text-right tabular-nums">{formatRs(i.amount, { decimals: 0 })}</TD><TD>{fmtDate(i.dueOn)}</TD>
                  <TD><Badge tone={i.status === 'paid' ? 'success' : i.status === 'void' ? 'neutral' : 'warning'}>{i.status}</Badge></TD></tr>
              ))}
              {d.invoices.length === 0 ? <EmptyRow colSpan={5}>No invoices yet.</EmptyRow> : null}
            </tbody>
          </Table>
          <Card className="flex flex-col gap-2 p-5">
            <CardTitle>Tickets</CardTitle>
            {d.tickets.map((k) => <Link key={k.id} href={`/admin/tickets/${k.id}`} className="flex justify-between text-[13px] hover:underline"><span>#{k.no} {k.subject}</span><span className="text-text-muted">{k.status} · {fmtDateTime(k.updatedAt)}</span></Link>)}
            {d.tickets.length === 0 ? <p className="text-xs text-text-muted">No tickets.</p> : null}
          </Card>
          <Card className="flex flex-col gap-2 p-5">
            <CardTitle>Support views</CardTitle>
            {d.support.map((s) => <p key={s.id} className="text-[13px]">{fmtDateTime(s.startedAt)} · {s.reason}<span className="text-text-muted"> · {s.endedAt ? 'ended' : new Date(s.expiresAt) > new Date() ? 'active' : 'expired'}</span></p>)}
            {d.support.length === 0 ? <p className="text-xs text-text-muted">Never viewed by support.</p> : null}
          </Card>
        </div>
        <div className="flex flex-col gap-4 xl:w-[360px]">
          <TenantControls id={t.id} status={t.status} planId={t.planId} trialEndsOn={t.trialEndsOn} ent={d.entitlements} plans={plans ?? []} />
          <StartSupport tenantId={t.id} />
        </div>
      </div>
    </>
  );
}
