import type { Metadata } from 'next';
import { Badge, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { ChainUpgrade } from '@/components/backoffice/ChainUpgrade';
import { CancelSchedule, ScheduleForm } from '@/components/backoffice/PricingForms';
import { PricingTabs } from '@/components/backoffice/PricingTabs';
import { requireChain } from '@/lib/chain';
import { fmtDateTime } from '@/lib/server/dates';
import { pricingItems } from '@/lib/pricing';

export const metadata: Metadata = { title: 'Scheduled price changes' };

const STATUS = { scheduled: ['Scheduled', 'info'], applied: ['Applied', 'success'], cancelled: ['Cancelled', 'neutral'] } as const;

// Scheduled price changes (WF-007). pg_cron applies due changes every minute; opening this page applies any that are late.
export default async function SchedulesPage() {
  const { ctx, enabled } = await requireChain('item.edit');
  if (!enabled) return <ChainUpgrade title="Scheduled price changes" />;
  await ctx.supabase.schema('api').rpc('apply_due_price_schedules');
  const [items, { data: shops }, { data }] = await Promise.all([
    pricingItems(ctx),
    ctx.supabase.from('shops').select('id, code, name').eq('is_active', true).order('code'),
    ctx.supabase.from('price_schedules').select('id, name, starts_at, status, applied_at, price_schedule_lines(id, shop_id)').order('starts_at', { ascending: false }).limit(100),
  ]);
  const minStart = new Date(Date.now() + 5.5 * 3600_000 + 5 * 60_000).toISOString().slice(0, 16);
  return (
    <>
      <PageHeader title="Central pricing" subtitle="Price changes that start at a set time — e.g. Monday 06:00, before the shops open" />
      <PricingTabs active="schedules" />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <Table>
            <thead><tr><TH>Name</TH><TH>Starts</TH><TH>Items</TH><TH>Where</TH><TH>Status</TH><TH /></tr></thead>
            <tbody>
              {(data ?? []).map((s) => {
                const [text, tone] = STATUS[s.status];
                const shopLines = s.price_schedule_lines.filter((l) => l.shop_id).length;
                return (
                  <tr key={s.id}>
                    <TD className="font-medium">{s.name}</TD>
                    <TD>{fmtDateTime(s.starts_at)}</TD>
                    <TD className="tabular-nums">{s.price_schedule_lines.length}</TD>
                    <TD>{shopLines === 0 ? 'All shops' : shopLines === s.price_schedule_lines.length ? 'Some shops' : 'Mixed'}</TD>
                    <TD><Badge tone={tone}>{text}</Badge></TD>
                    <TD className="text-right">{s.status === 'scheduled' ? <CancelSchedule id={s.id} /> : s.applied_at ? <span className="text-xs text-text-muted">{fmtDateTime(s.applied_at)}</span> : null}</TD>
                  </tr>
                );
              })}
              {(data ?? []).length === 0 ? <EmptyRow colSpan={6}>No price changes yet.</EmptyRow> : null}
            </tbody>
          </Table>
        </div>
        <div className="xl:w-[480px]"><ScheduleForm items={items} shops={shops ?? []} minStart={minStart} /></div>
      </div>
    </>
  );
}
