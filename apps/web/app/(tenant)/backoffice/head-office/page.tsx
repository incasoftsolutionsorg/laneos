import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, Card, CardTitle, PageHeader, buttonClass, tabClass, tabsClass } from '@laneos/ui';
import { ChainUpgrade } from '@/components/backoffice/ChainUpgrade';
import { ShopBars } from '@/components/backoffice/reports/ShopBars';
import { requireChain, type ChainReportShop, type ChainShop } from '@/lib/chain';
import { colomboToday, fmtDateTime } from '@/lib/server/dates';

export const metadata: Metadata = { title: 'Head office' };

/** "Rs 3.92M" for big totals, "Rs 384,250" below a million (Figma 3-261). */
const big = (cents: number) => (Math.abs(cents) >= 100_000_000 ? `Rs ${(cents / 100_000_000).toFixed(2)}M` : formatRs(cents, { decimals: 0 }));
const pct = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);

// Head office overview (Figma 3-261): today across shops, revenue by shop, lanes & sync, shop cards.
export default async function HeadOfficePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range = 'today' } = await searchParams;
  const { ctx, enabled } = await requireChain();
  if (!enabled) return <ChainUpgrade title="All shops overview" />;
  const today = colomboToday();
  const from = range === 'week' ? new Date(Date.parse(today) - 6 * 86_400_000).toISOString().slice(0, 10) : range === 'month' ? `${today.slice(0, 8)}01` : today;
  const [{ data: ov }, { data: rep }] = await Promise.all([
    ctx.supabase.schema('api').rpc('chain_overview'),
    range === 'today' ? Promise.resolve({ data: null }) : ctx.supabase.schema('api').rpc('chain_report', { p_from: from, p_to: today }),
  ]);
  const shops = (ov ?? []) as unknown as ChainShop[];
  const ranged = new Map(((rep ?? []) as unknown as ChainReportShop[]).map((r) => [r.id, r.sales]));
  const sum = (f: (s: ChainShop) => number) => shops.reduce((t, s) => t + f(s), 0);
  const revenue = sum((s) => s.salesToday);
  const bills = sum((s) => s.billsToday);
  const change = pct(revenue, sum((s) => s.salesYesterday));
  const alerts = shops.flatMap((s) => [
    ...s.offlineLanes.map((l) => ({ code: `${s.code} ${l}`, text: 'Lane offline with an open shift', tone: 'warning' as const })),
    ...(s.lowStock ? [{ code: s.code, text: `${s.lowStock} low stock items`, tone: 'danger' as const }] : []),
    ...(s.lastVariance ? [{ code: s.code, text: `Cash variance ${formatRs(Math.abs(s.lastVariance), { decimals: 0 })}`, tone: 'danger' as const }] : []),
    ...(s.syncIssues ? [{ code: s.code, text: `${s.syncIssues} sync issues`, tone: 'warning' as const }] : []),
    ...(s.damagePending ? [{ code: s.code, text: `${s.damagePending} damage reports waiting`, tone: 'warning' as const }] : []),
  ]);
  const urgent = alerts.filter((a) => a.tone === 'danger').length;
  const lastPush = shops.find((s) => s.lastPricePush)?.lastPricePush;
  const tabs = [['today', 'Today'], ['week', 'Week'], ['month', 'Month']] as const;

  return (
    <>
      <PageHeader
        title="All shops overview"
        subtitle={`${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())} · live`}
        actions={
          <div className="flex gap-2">
            <Link href={`/backoffice/revenue?from=${from}&to=${today}`} className={buttonClass('secondary')}>Reports</Link>
            {hasPerm(ctx.member.perms, 'settings.manage') ? <Link href="/backoffice/shops?add=1" className={buttonClass('primary')}>+ Add shop</Link> : null}
          </div>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Revenue today" value={big(revenue)} delta={change == null ? null : `${change > 0 ? '+' : ''}${change}%`} good={(change ?? 0) >= 0} note={`${shops.length} shops`} />
        <Kpi label="Bills today" value={bills.toLocaleString('en-LK')} note={bills ? `avg ${formatRs(Math.round(revenue / bills), { decimals: 0 })}` : '—'} />
        <Kpi label="Stock value" value={big(sum((s) => s.stockValue))} note="at cost" />
        <Kpi label="Open alerts" value={String(alerts.length)} delta={urgent ? `${urgent} urgent` : null} good={false} note="across shops" />
      </div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch">
        <Card className="flex min-w-0 flex-1 flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Revenue by shop ({range === 'today' ? 'today' : range === 'week' ? 'last 7 days' : 'this month'})</CardTitle>
            <nav className={tabsClass()} aria-label="Range">
              {tabs.map(([k, t]) => <Link key={k} href={`/backoffice/head-office?range=${k}`} className={tabClass(k === range)} aria-current={k === range ? 'page' : undefined}>{t}</Link>)}
            </nav>
          </div>
          <ShopBars highlight={ctx.shop.id} bars={shops.map((s) => ({ id: s.id, code: s.code, name: s.name, value: range === 'today' ? s.salesToday : ranged.get(s.id) ?? 0, note: range === 'today' ? `${s.billsToday} bills` : undefined }))} />
        </Card>
        <Card className="flex flex-col gap-2.5 p-5 xl:w-[330px]">
          <CardTitle>Lanes & sync</CardTitle>
          <Line label="Lanes online" value={`${sum((s) => s.lanesOnline)} / ${sum((s) => s.lanes)}`} strong />
          <Line label="Sync issues" value={String(sum((s) => s.syncIssues))} />
          <Line label="Last price push" value={lastPush ? fmtDateTime(lastPush) : '—'} />
          <div className="mt-1 flex flex-col gap-2 border-t border-border pt-3">
            {alerts.slice(0, 6).map((a, i) => (
              <p key={i} className="flex items-center gap-2 text-xs"><Badge tone={a.tone}>{a.code}</Badge>{a.text}</p>
            ))}
            {alerts.length === 0 ? <p className="text-xs text-text-muted">No alerts. Every shop looks fine.</p> : null}
          </div>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {shops.map((s) => {
          const status = !s.isActive ? <Badge>Closed</Badge>
            : s.offlineLanes.length ? <Badge tone="warning">{s.offlineLanes.length} lane offline</Badge>
            : s.lowStock > 5 ? <Badge tone="danger">Low stock</Badge>
            : s.lanesOnline ? <Badge tone="success">Online</Badge> : <Badge>No lane online</Badge>;
          return (
            <Link key={s.id} href={`/backoffice/shops/${s.id}`}>
              <Card className="flex h-full flex-col gap-1 p-4 transition hover:border-brand-primary">
                <div className="flex items-center justify-between"><Badge tone="success">{s.code}</Badge>{status}</div>
                <p className="mt-6 text-[15px] font-semibold">{s.name}</p>
                <p className="text-[20px] font-bold text-brand-primary tabular-nums">{formatRs(s.salesToday, { decimals: 0 })}</p>
                <p className="text-xs text-text-muted">Lanes {s.lanesOnline}/{s.lanes} · {s.lowStock} stock alerts</p>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function Kpi({ label, value, delta, good = true, note }: { label: string; value: string; delta?: string | null; good?: boolean; note: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-[24px] font-bold tabular-nums">{value}</span>
      <span className="text-xs">{delta ? <span className={good ? 'font-semibold text-success' : 'font-semibold text-danger'}>{delta} </span> : null}<span className="text-text-muted">{note}</span></span>
    </Card>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex justify-between text-[13px]"><span className="text-text-muted">{label}</span><span className={strong ? 'font-semibold' : ''}>{value}</span></div>;
}
