import type { Metadata } from 'next';
import { formatRs, hasPerm } from '@laneos/core';
import { Alert, Badge, Button, Card, CardTitle, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { PlanPicker } from '@/components/backoffice/PlanPicker';
import { colomboToday, fmtDate } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Plan & billing' };

const DAY = 86_400_000;
const month = (d: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(`${d}T00:00:00+05:30`));

// Plan & billing (Figma 11-4771). Online payment waits for PayHere merchant credentials.
export default async function BillingPage() {
  const ctx = await requireTenant();
  const today = colomboToday();
  const [{ data: t }, { data: plans }, { data: invoices }, { count: lanes }, { count: staff }, { count: shops }] = await Promise.all([
    ctx.supabase.from('tenants').select('status, trial_ends_on, next_charge_on, plan:plans(id, name, price_cents, per_shop, max_lanes_per_shop, max_shops, max_staff)').eq('id', ctx.tenant.id).single(),
    ctx.supabase.from('plans').select('id, name, price_cents, per_shop, is_custom, description, sort_order').eq('is_active', true).order('sort_order'),
    ctx.supabase.from('saas_invoices').select('id, invoice_no, period_start, amount_cents, status, due_on').order('period_start', { ascending: false }).limit(24),
    ctx.supabase.from('lanes').select('id', { count: 'exact', head: true }).eq('shop_id', ctx.shop.id),
    ctx.supabase.from('members').select('id', { count: 'exact', head: true }).eq('is_active', true),
    ctx.supabase.from('shops').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ]);
  const { data: shopList } = await ctx.supabase.from('shops').select('id, code, name').eq('is_active', true).order('code');
  const plan = t?.plan;
  if (!t || !plan) return null;
  const monthly = plan.per_shop ? plan.price_cents * (shops ?? 1) : plan.price_cents;
  const overdue = (invoices ?? []).filter((i) => i.status === 'open' && i.due_on < today);
  const worst = overdue.at(-1);
  const daysLate = worst ? Math.floor((Date.parse(today) - Date.parse(worst.due_on)) / DAY) : 0;
  const owner = hasPerm(ctx.member.perms, 'settings.manage');
  const list = plans ?? [];
  const next = list[list.findIndex((p) => p.id === plan.id) + 1];

  return (
    <>
      {worst ? (
        <Alert tone="warning">Your subscription payment is {daysLate} day{daysLate === 1 ? '' : 's'} overdue. If it stays unpaid the account can be suspended: lanes stop selling, but you can still view and export data.</Alert>
      ) : null}
      <PageHeader
        title="Plan & billing"
        subtitle={`${plan.name} · ${formatRs(monthly, { decimals: 0 })} / month${plan.per_shop ? ` (${shops} shop${shops === 1 ? '' : 's'})` : ''}`}
        actions={<Button disabled title="Online payment opens once LaneOS's PayHere merchant account is connected">Pay with PayHere</Button>}
      />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <Card className="flex flex-col gap-3 p-5 xl:w-[300px] xl:shrink-0">
          <CardTitle>Your plan</CardTitle>
          <p className="text-[22px] font-bold text-brand-primary">{plan.name}</p>
          <Line label="Lanes" value={`${lanes ?? 0} of ${plan.max_lanes_per_shop}${plan.max_shops > 1 ? ' per shop' : ''}`} />
          {plan.max_shops > 1 ? <Line label="Shops" value={`${shops ?? 0} of ${plan.max_shops}`} /> : null}
          <Line label="Staff" value={`${staff ?? 0} of ${plan.max_staff}`} />
          {t.status === 'trial' && t.trial_ends_on ? <Line label="Free trial ends" value={fmtDate(t.trial_ends_on)} /> : null}
          <Line label="Next charge" value={t.next_charge_on ? fmtDate(t.next_charge_on) : '—'} />
          {plan.per_shop ? (
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              <p className="text-xs font-semibold">Per shop</p>
              {(shopList ?? []).map((sh) => <Line key={sh.id} label={`${sh.code} · ${sh.name}`} value={formatRs(plan.price_cents, { decimals: 0 })} />)}
              <Line label="Monthly total" value={formatRs(monthly, { decimals: 0 })} />
            </div>
          ) : null}
          {next && owner ? <p className="rounded-control bg-brand-light px-3 py-2 text-center text-xs font-semibold text-brand-primary">Need more? {next.name} is below.</p> : null}
        </Card>
        <div className="min-w-0 flex-1">
          <Table>
            <thead><tr><TH>Invoice</TH><TH>Period</TH><TH>Amount</TH><TH>Status</TH></tr></thead>
            <tbody>
              {(invoices ?? []).map((i) => {
                const late = i.status === 'open' && i.due_on < today ? Math.floor((Date.parse(today) - Date.parse(i.due_on)) / DAY) : 0;
                return (
                  <tr key={i.id}>
                    <TD className="font-mono text-xs">{i.invoice_no}</TD>
                    <TD>{month(i.period_start)}</TD>
                    <TD className="tabular-nums">{formatRs(i.amount_cents, { decimals: 0 })}</TD>
                    <TD>{i.status === 'paid' ? <Badge tone="success">Paid</Badge> : i.status === 'void' ? <Badge>Void</Badge> : late ? <Badge tone="danger">Overdue {late} days</Badge> : <Badge tone="warning">Due {fmtDate(i.due_on)}</Badge>}</TD>
                  </tr>
                );
              })}
              {(invoices ?? []).length === 0 ? <EmptyRow colSpan={4}>No invoices yet{t.status === 'trial' ? ' — you are on the free trial' : ''}.</EmptyRow> : null}
            </tbody>
          </Table>
        </div>
      </div>
      <h2 className="text-[15px] font-semibold">Plans</h2>
      <PlanPicker
        current={plan.id}
        canChange={owner}
        plans={(plans ?? []).map((p) => ({ id: p.id, name: p.name, priceCents: p.price_cents, perShop: p.per_shop, custom: p.is_custom, description: p.description }))}
      />
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-[13px]"><span className="text-text-muted">{label}</span><span className="font-semibold">{value}</span></div>;
}
