import type { Metadata } from 'next';
import Link from 'next/link';
import { formatQty, formatRs, type ItemType } from '@laneos/core';
import { Badge, Card, CardTitle, EmptyRow, PageHeader, StatCard, Table, TD, TH, buttonClass } from '@laneos/ui';
import { HourlyBars } from '@/components/backoffice/HourlyBars';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Dashboard' };

interface Dashboard {
  salesCents: number;
  bills: number;
  lastWeekSalesCents: number;
  lastWeekBills: number;
  marginBp: number | null;
  byHour: { hour: number; cents: number }[];
  topItems: { name: string; itemType: ItemType; qtyMilli: number; netCents: number; marginBp: number | null }[];
  lowStock: number;
  outOfStock: number;
  damagedUnits: number;
  attention: { name: string; itemType: ItemType; qtyMilli: number }[];
  lanes: { id: string; code: string; name: string; status: string; cashier: string | null; salesCents: number }[];
}

const pct = (bp: number) => `${(bp / 100).toFixed(1)}%`;

function change(now: number, before: number): { text: string; tone: 'success' | 'danger' | 'muted' } {
  if (before === 0) return { text: now > 0 ? 'New' : '—', tone: 'muted' };
  const delta = ((now - before) / before) * 100;
  return { text: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`, tone: delta >= 0 ? 'success' : 'danger' };
}

export default async function DashboardPage() {
  const ctx = await requireTenant();
  const { data, error } = await ctx.supabase.schema('api').rpc('dashboard', { p_shop: ctx.shop.id });
  if (error) throw new Error(error.message);
  const d = data as unknown as Dashboard;

  const now = new Date();
  const colombo = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', ...opts }).format(now);
  const hour = Number(colombo({ hour: 'numeric', hour12: false }));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const weekday = colombo({ weekday: 'long' });
  const firstName = ctx.member.name.split(' ')[0];

  const sales = change(d.salesCents, d.lastWeekSalesCents);
  const bills = change(d.bills, d.lastWeekBills);
  const alerts = d.lowStock + d.outOfStock;

  return (
    <>
      <PageHeader
        title={`${greeting}, ${firstName}`}
        subtitle={`${colombo({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${ctx.shop.name} shop`}
        actions={<Link href="/lane" className={buttonClass('primary')}>New sale</Link>}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Today">
        <StatCard label="Today's sales" value={formatRs(d.salesCents, { decimals: 0 })} delta={sales.text} deltaTone={sales.tone} note={`vs last ${weekday}`} />
        <StatCard
          label="Bills"
          value={d.bills.toLocaleString('en-US')}
          delta={bills.text}
          deltaTone={bills.tone}
          note={d.bills > 0 ? `avg ${formatRs(Math.round(d.salesCents / d.bills), { decimals: 0 })}` : undefined}
        />
        <StatCard
          label="Gross margin"
          value={d.marginBp == null ? '—' : pct(d.marginBp)}
          note={d.marginBp == null ? 'needs item costs and sales' : 'on items with a cost price'}
        />
        <StatCard
          label="Stock alerts"
          value={alerts}
          delta={d.outOfStock > 0 ? `${d.outOfStock} out of stock` : undefined}
          deltaTone="danger"
          note={`${d.lowStock} low stock`}
        />
      </section>

      <section className="flex flex-col gap-4 xl:flex-row">
        <Card className="flex min-w-0 flex-1 flex-col gap-3.5 p-5">
          <CardTitle>Sales by hour · today</CardTitle>
          <HourlyBars byHour={d.byHour} currentHour={hour} />
        </Card>
        <Card className="flex shrink-0 flex-col gap-3.5 p-5 xl:w-[380px]">
          <CardTitle>Needs attention</CardTitle>
          {d.attention.map((a) => (
            <p key={a.name} className="flex items-center gap-2.5 text-xs">
              <Badge tone={a.qtyMilli <= 0 ? 'danger' : 'warning'}>{a.qtyMilli <= 0 ? 'Out of stock' : 'Low stock'}</Badge>
              <span className="flex-1">{a.name} · {formatQty(Math.max(a.qtyMilli, 0), a.itemType)} left</span>
            </p>
          ))}
          {d.outOfStock > 0 ? (
            <p className="flex items-center gap-2.5 text-xs">
              <Badge tone="danger">Out of stock</Badge>
              <Link href="/backoffice/items?filter=out" className="flex-1 hover:underline">{d.outOfStock} items need re-ordering</Link>
            </p>
          ) : null}
          {d.damagedUnits > 0 ? (
            <p className="flex items-center gap-2.5 text-xs">
              <Badge tone="warning">Damaged</Badge>
              <span className="flex-1">{formatQty(d.damagedUnits, 'standard')} units waiting for a decision</span>
            </p>
          ) : null}
          {d.attention.length === 0 && d.outOfStock === 0 && d.damagedUnits === 0 ? (
            <p className="flex items-center gap-2.5 text-xs">
              <Badge tone="success">All good</Badge>
              <span>Nothing needs attention right now</span>
            </p>
          ) : null}
        </Card>
      </section>

      <section className="flex flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1">
          <Table>
            <thead>
              <tr><TH>Top items today</TH><TH>Qty</TH><TH>Sales</TH><TH>Margin</TH></tr>
            </thead>
            <tbody>
              {d.topItems.map((t) => (
                <tr key={t.name}>
                  <TD>{t.name}</TD>
                  <TD>{formatQty(t.qtyMilli, t.itemType)}</TD>
                  <TD>{formatRs(t.netCents, { decimals: 0 })}</TD>
                  <TD>{t.marginBp == null ? '—' : pct(t.marginBp)}</TD>
                </tr>
              ))}
              {d.topItems.length === 0 ? <EmptyRow colSpan={4}>No sales yet today.</EmptyRow> : null}
            </tbody>
          </Table>
        </div>
        <Card className="flex shrink-0 flex-col gap-3.5 p-5 xl:w-[380px]">
          <div className="flex items-center justify-between">
            <CardTitle>Lanes</CardTitle>
            <Link href="/backoffice/lanes" className="text-xs font-semibold text-brand-primary">Manage</Link>
          </div>
          {d.lanes.map((l) => (
            <div key={l.id} className="flex items-center gap-2.5">
              <Badge tone="brand">{l.code}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">{l.cashier ?? l.name}</p>
                <p className="text-xs text-text-muted">{formatRs(l.salesCents, { decimals: 0 })}</p>
              </div>
              {l.status !== 'active' ? (
                <Badge tone="danger">Disabled</Badge>
              ) : l.cashier ? (
                <Badge tone="success">Shift open</Badge>
              ) : (
                <Badge tone="neutral">No shift</Badge>
              )}
            </div>
          ))}
        </Card>
      </section>
    </>
  );
}
