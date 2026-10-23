import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, Card, CardTitle, EmptyRow, PageHeader, Table, TD, TH, buttonClass, type Tone } from '@laneos/ui';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Promotions & loyalty' };

const dm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short' }).format(new Date(iso));

// Promotions & loyalty (Figma 1-4807).
export default async function PromotionsPage() {
  const ctx = await requireTenant();
  const [{ data: promos }, { data: customers }] = await Promise.all([
    ctx.supabase.from('promotions')
      .select('id, name, kind, buy_qty, bundle_price_cents, percent_bp, starts_at, ends_at, is_active, promotion_items(item:items(name))')
      .order('created_at', { ascending: false }).limit(100),
    ctx.supabase.from('customers').select('loyalty_points').eq('is_active', true),
  ]);
  const rows = promos ?? [];
  const uses = await Promise.all(rows.slice(0, 50).map((p) =>
    ctx.supabase.from('sale_lines').select('id', { count: 'exact', head: true }).eq('promotion_id', p.id).then((r) => r.count ?? 0)));
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
      <PageHeader title="Promotions & loyalty" subtitle="Multi-buy and item discounts; the lane and the server apply the same rules"
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
                    <TD>{p.kind === 'multi_buy' ? `Multi-buy · ${p.buy_qty} for ${formatRs(p.bundle_price_cents ?? 0, { decimals: 0 })}` : `Item discount · ${(p.percent_bp ?? 0) / 100}%`}</TD>
                    <TD>{names.length === 1 ? names[0] : `${names.length} items`}</TD>
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
          <Line label="Points outstanding" value={`${(customers ?? []).reduce((s, c) => s + c.loyalty_points, 0).toLocaleString('en-US')} pts`} />
          <p className="text-xs text-text-muted">Earn and redeem rules, threshold and mix-and-match offers come with promotions v2 and loyalty (milestone M6).</p>
        </Card>
      </div>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-[13px]"><span className="text-text-muted">{label}</span><span className="font-semibold">{value}</span></div>;
}
