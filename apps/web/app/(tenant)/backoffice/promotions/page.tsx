import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, Card, CardTitle, EmptyRow, PageHeader, Table, TD, TH, buttonClass, type Tone } from '@laneos/ui';
import { requireTenant } from '@/lib/server/context';
import { SettingsDraft } from '@/components/backoffice/Settings';
import { DMoney, DNumber, DSwitch } from '@/components/backoffice/SettingsFields';

export const metadata: Metadata = { title: 'Promotions & loyalty' };

const dm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short' }).format(new Date(iso));

// Promotions & loyalty (Figma 1-4807).
function kindText(p: { kind: string; buy_qty: number | null; bundle_price_cents: number | null; percent_bp: number | null; threshold_cents: number | null; discount_cents: number | null }) {
  const rs = (c: number | null) => formatRs(c ?? 0, { decimals: 0 });
  switch (p.kind) {
    case 'multi_buy': return `Multi-buy · ${p.buy_qty} for ${rs(p.bundle_price_cents)}`;
    case 'mix_match': return `Mix & match · any ${p.buy_qty} for ${rs(p.bundle_price_cents)}`;
    case 'threshold': return `Spend ${rs(p.threshold_cents)} · ${p.discount_cents ? `${rs(p.discount_cents)} off` : `${(p.percent_bp ?? 0) / 100}% off`}`;
    default: return `Item discount · ${(p.percent_bp ?? 0) / 100}%`;
  }
}

export default async function PromotionsPage() {
  const ctx = await requireTenant();
  const [{ data: promos }, { data: customers }, { data: t }] = await Promise.all([
    ctx.supabase.from('promotions')
      .select('id, name, kind, buy_qty, bundle_price_cents, percent_bp, threshold_cents, discount_cents, members_only, starts_at, ends_at, is_active, promotion_items(item:items(name))')
      .order('created_at', { ascending: false }).limit(100),
    ctx.supabase.from('customers').select('loyalty_points').eq('is_active', true),
    ctx.supabase.from('tenants').select('loyalty_enabled, loyalty_spend_cents, loyalty_point_value_cents, loyalty_min_redeem').eq('id', ctx.tenant.id).single(),
  ]);
  const rows = promos ?? [];
  const uses = await Promise.all(rows.slice(0, 50).map((p) =>
    (p.kind === 'threshold'
      ? ctx.supabase.from('sales').select('id', { count: 'exact', head: true }).eq('basket_promotion_id', p.id)
      : ctx.supabase.from('sale_lines').select('id', { count: 'exact', head: true }).eq('promotion_id', p.id)).then((r) => r.count ?? 0)));
  const points = (customers ?? []).reduce((s, c) => s + c.loyalty_points, 0);
  const now = new Date().toISOString();
  const canEdit = hasPerm(ctx.member.perms, 'promotion.manage');

  const status = (p: (typeof rows)[number]): { tone: Tone; text: string } => {
    if (!p.is_active) return { tone: 'neutral', text: 'Stopped' };
    if (p.starts_at > now) return { tone: 'info', text: 'Scheduled' };
    if (p.ends_at && p.ends_at <= now) return { tone: 'neutral', text: 'Ended' };
    return { tone: 'success', text: 'Active' };
  };

  return (
    <>
      <PageHeader title="Promotions & loyalty" subtitle="Multi-buy, mix & match, item discounts and spend-X deals; the lane and the server apply the same rules"
        actions={canEdit ? <Link href="/backoffice/promotions/new" className={buttonClass('primary')}>+ New promotion</Link> : null} />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <Table>
            <thead><tr><TH>Promotion</TH><TH>Type</TH><TH>Items</TH><TH>Dates</TH><TH>Uses</TH><TH>Status</TH></tr></thead>
            <tbody>
              {rows.map((p, i) => {
                const s = status(p);
                const names = p.promotion_items.map((x) => x.item?.name).filter(Boolean);
                return (
                  <tr key={p.id}>
                    <TD className="font-medium">{canEdit ? <Link href={`/backoffice/promotions/${p.id}`} className="hover:underline">{p.name}</Link> : p.name}</TD>
                    <TD>{kindText(p)}{p.members_only ? <Badge tone="brand" className="ml-2">Members</Badge> : null}</TD>
                    <TD>{p.kind === 'threshold' ? 'Whole bill' : names.length === 1 ? names[0] : `${names.length} items`}</TD>
                    <TD>{dm(p.starts_at)}–{p.ends_at ? dm(p.ends_at) : 'open'}</TD>
                    <TD className="tabular-nums">{i < 50 ? uses[i] : '—'}</TD>
                    <TD><Badge tone={s.tone}>{s.text}</Badge></TD>
                  </tr>
                );
              })}
              {rows.length === 0 ? <EmptyRow colSpan={6}>No promotions yet.</EmptyRow> : null}
            </tbody>
          </Table>
        </div>
        <Card className="flex flex-col gap-3 p-5 xl:w-[340px]">
          <CardTitle>Loyalty</CardTitle>
          <Line label="Members" value={(customers ?? []).length.toLocaleString('en-US')} />
          <Line label="Points outstanding" value={`${points.toLocaleString('en-US')} pts`} />
          {t ? <Line label="Value if all are spent" value={formatRs(points * t.loyalty_point_value_cents, { decimals: 0 })} /> : null}
          {t ? (
            <SettingsDraft initial={t} readOnly={!hasPerm(ctx.member.perms, 'settings.manage')}>
              <DSwitch name="loyalty_enabled" label="Customers earn and spend points" hint="Members are customers attached at the lane (F7)" />
              <DMoney name="loyalty_spend_cents" label="Spend per point (Rs)" hint="E.g. Rs 100 = 1 point" />
              <DMoney name="loyalty_point_value_cents" label="A point is worth (Rs)" />
              <DNumber name="loyalty_min_redeem" label="Smallest number of points to spend" min={1} max={100000} />
            </SettingsDraft>
          ) : null}
        </Card>
      </div>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-[13px]"><span className="text-text-muted">{label}</span><span className="font-semibold">{value}</span></div>;
}
