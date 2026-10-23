import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs } from '@laneos/core';
import { Card, CardTitle, PageHeader } from '@laneos/ui';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'Platform overview' };

interface Overview {
  tenants: Record<string, number> | null; mrr: number; newThisMonth: number; overdue: { count: number; amount: number };
  lanesOnline: number; lanes: number; salesToday: { count: number; amount: number }; openTickets: number; syncIssues: number;
  signups: { day: string; n: number }[];
}

// Platform overview (Figma 3-2775, not read — built from blueprint E.1.5; compare when Figma access returns).
export default async function AdminOverviewPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.schema('api').rpc('admin_overview');
  const o = data as unknown as Overview;
  const t = o.tenants ?? {};
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  const maxSign = Math.max(1, ...o.signups.map((s) => s.n));
  const cards: [string, string, string, string?][] = [
    ['Monthly recurring revenue', formatRs(o.mrr, { decimals: 0 }), `${t.active ?? 0} paying tenants`],
    ['Tenants', String(total), `${t.trial ?? 0} on trial · ${o.newThisMonth} new this month`, '/admin/tenants'],
    ['Overdue', formatRs(o.overdue.amount, { decimals: 0 }), `${o.overdue.count} invoices`, '/admin/overdue'],
    ['Lanes online', `${o.lanesOnline} / ${o.lanes}`, `${o.salesToday.count.toLocaleString('en-LK')} bills today`, '/admin/live-activity'],
    ['Sales through LaneOS today', formatRs(o.salesToday.amount, { decimals: 0 }), 'all tenants'],
    ['Open tickets', String(o.openTickets), `${o.syncIssues} unresolved sync issues`, '/admin/tickets'],
  ];
  return (
    <>
      <PageHeader title="Platform overview" subtitle="Every LaneOS business at a glance" />
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map(([k, v, note, href]) => {
          const body = (
            <Card className="flex h-full flex-col gap-1 p-4 transition hover:border-platform-accent">
              <span className="text-xs text-text-muted">{k}</span><span className="text-[22px] font-bold tabular-nums">{v}</span><span className="text-xs text-text-muted">{note}</span>
            </Card>
          );
          return href ? <Link key={k} href={href}>{body}</Link> : <div key={k}>{body}</div>;
        })}
      </div>
      <Card className="flex flex-col gap-3 p-5">
        <CardTitle>Sign-ups, last 30 days</CardTitle>
        <div className="flex h-28 items-end gap-1" role="list" aria-label="Sign-ups per day">
          {o.signups.map((s) => (
            <span key={s.day} role="listitem" aria-label={`${s.day}: ${s.n}`} title={`${s.day}: ${s.n}`} className="flex h-full flex-1 items-end">
              <span className="w-full rounded-t-[4px] bg-platform-accent/70" style={{ height: `${s.n ? Math.max(4, (s.n / maxSign) * 100) : 0}%` }} />
            </span>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-text-muted"><span>{o.signups[0]?.day}</span><span>today</span></div>
      </Card>
      <div className="flex flex-wrap gap-2 text-xs text-text-muted">
        {Object.entries(t).map(([k, n]) => <span key={k} className="rounded-control border border-border bg-surface px-2.5 py-1">{k.replace('_', ' ')}: <b className="text-text">{n}</b></span>)}
      </div>
    </>
  );
}
