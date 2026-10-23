import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs } from '@laneos/core';
import { Card, CardTitle, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { AutoRefresh } from '@/components/admin/AutoRefresh';
import { ago } from '@/lib/server/dates';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'Live activity' };

interface Live {
  tenants: { id: string; name: string; lanesOnline: number; sales: number; amount: number; lastSale: string | null }[];
  perMinute: { at: string; n: number }[];
  syncIssues: { tenant: string; code: string; at: string }[];
  signIns: number;
}

// Live activity (Figma 3-4387, not read — compare when Figma access returns). Refreshes every 30 s.
export default async function LiveActivityPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.schema('api').rpc('admin_live');
  const l = data as unknown as Live;
  const max = Math.max(1, ...l.perMinute.map((m) => m.n));
  const active = l.tenants.filter((t) => t.lanesOnline || t.sales);
  return (
    <>
      <PageHeader title="Live activity" subtitle={`Last hour · ${l.perMinute.reduce((s, m) => s + m.n, 0)} bills · ${l.signIns} sign-ins`} actions={<AutoRefresh seconds={30} />} />
      <Card className="flex flex-col gap-3 p-5">
        <CardTitle>Bills per minute</CardTitle>
        <div className="flex h-28 items-end gap-px" role="list" aria-label="Bills per minute, last hour">
          {l.perMinute.map((m) => (
            <span key={m.at} role="listitem" title={`${new Date(m.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit' })}: ${m.n}`} className="flex h-full flex-1 items-end">
              <span className="w-full rounded-t-[2px] bg-platform-accent/70" style={{ height: `${m.n ? Math.max(4, (m.n / max) * 100) : 0}%` }} />
            </span>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-text-muted"><span>60 min ago</span><span>now</span></div>
      </Card>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <Table>
            <thead><tr><TH>Business</TH><TH className="text-right">Lanes online</TH><TH className="text-right">Bills (1 h)</TH><TH className="text-right">Sales (1 h)</TH><TH>Last sale</TH></tr></thead>
            <tbody>
              {active.map((t) => (
                <tr key={t.id}>
                  <TD className="font-medium"><Link href={`/admin/tenants/${t.id}`} className="hover:underline">{t.name}</Link></TD>
                  <TD className="text-right tabular-nums">{t.lanesOnline}</TD>
                  <TD className="text-right tabular-nums">{t.sales}</TD>
                  <TD className="text-right tabular-nums">{formatRs(t.amount, { decimals: 0 })}</TD>
                  <TD>{ago(t.lastSale)}</TD>
                </tr>
              ))}
              {active.length === 0 ? <EmptyRow colSpan={5}>No lanes online and no sales in the last hour.</EmptyRow> : null}
            </tbody>
          </Table>
        </div>
        <Card className="flex flex-col gap-2 p-5 xl:w-[340px]">
          <CardTitle>Unresolved sync issues</CardTitle>
          {l.syncIssues.map((s, i) => <p key={i} className="text-[13px]"><b>{s.tenant}</b> · <span className="font-mono text-xs">{s.code}</span> <span className="text-text-muted">· {ago(s.at)}</span></p>)}
          {l.syncIssues.length === 0 ? <p className="text-xs text-text-muted">None.</p> : null}
        </Card>
      </div>
    </>
  );
}
