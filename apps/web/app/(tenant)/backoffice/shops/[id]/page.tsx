import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, Card, CardTitle, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { ChainUpgrade } from '@/components/backoffice/ChainUpgrade';
import { ShopEditor } from '@/components/backoffice/ShopForms';
import { requireChain, type ChainShop } from '@/lib/chain';
import { ago } from '@/lib/server/dates';
import { ROLE_TONE } from '@/lib/staff';

export const metadata: Metadata = { title: 'Shop' };

const showPhone = (p: string | null) => (p ? p.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3') : '');

// Shop detail (Figma 3-792, not read — built from blueprint E.2; compare when Figma access returns).
export default async function ShopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, enabled } = await requireChain();
  if (!enabled) return <ChainUpgrade title="Shop" />;
  const [{ data: shop }, { data: lanes }, { data: members }, { data: ov }, { data: transfers }] = await Promise.all([
    ctx.supabase.from('shops').select('id, code, name, address, phone, is_active').eq('id', id).maybeSingle(),
    ctx.supabase.from('lanes').select('id, code, name, status, registered_at, last_seen_at, active_member:members!lanes_active_member_id_fkey(display_name)').eq('shop_id', id).order('code'),
    ctx.supabase.from('members').select('id, display_name, all_shops, role:roles(key, name), member_shops(shop_id)').eq('is_active', true).order('display_name'),
    ctx.supabase.schema('api').rpc('chain_overview'),
    ctx.supabase.from('transfers').select('id, transfer_no, status, from_shop_id, to_shop_id, created_at').or(`from_shop_id.eq.${id},to_shop_id.eq.${id}`).order('created_at', { ascending: false }).limit(5),
  ]);
  if (!shop) notFound();
  const st = ((ov ?? []) as unknown as ChainShop[]).find((s) => s.id === id);
  const staff = (members ?? []).filter((m) => m.all_shops || m.member_shops.some((x) => x.shop_id === id));

  return (
    <>
      <PageHeader title={`${shop.name}`} subtitle={<span className="flex items-center gap-2"><Badge tone="success">{shop.code}</Badge>{shop.is_active ? 'Open' : 'Closed'}</span>} />
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Sales today" value={st ? formatRs(st.salesToday, { decimals: 0 }) : '—'} />
        <Stat label="Bills today" value={st ? String(st.billsToday) : '—'} />
        <Stat label="Stock value (cost)" value={st ? formatRs(st.stockValue, { decimals: 0 }) : '—'} />
        <Stat label="Low stock items" value={st ? String(st.lowStock) : '—'} />
      </div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Card className="flex flex-col gap-3 p-5">
            <CardTitle>Lanes</CardTitle>
            <Table>
              <thead><tr><TH>Lane</TH><TH>Device</TH><TH>Cashier</TH><TH>Last seen</TH><TH>Status</TH></tr></thead>
              <tbody>
                {(lanes ?? []).map((l) => (
                  <tr key={l.id}>
                    <TD className="font-medium">{l.code} · {l.name}</TD>
                    <TD>{l.registered_at ? 'Registered' : <span className="text-text-muted">Not registered</span>}</TD>
                    <TD>{l.active_member?.display_name ?? '—'}</TD>
                    <TD>{ago(l.last_seen_at)}</TD>
                    <TD>{l.status === 'active' ? <Badge tone="success">Active</Badge> : <Badge>Disabled</Badge>}</TD>
                  </tr>
                ))}
                {(lanes ?? []).length === 0 ? <EmptyRow colSpan={5}>No lanes.</EmptyRow> : null}
              </tbody>
            </Table>
          </Card>
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between"><CardTitle>Staff with access</CardTitle><Link href="/backoffice/access" className="text-xs font-semibold text-brand-primary hover:underline">Users & access</Link></div>
            <div className="flex flex-wrap gap-2">
              {staff.map((m) => <span key={m.id} className="flex items-center gap-1.5 rounded-control border border-border px-2.5 py-1 text-[13px]">{m.display_name}<Badge tone={ROLE_TONE[m.role?.key ?? ''] ?? 'neutral'}>{m.all_shops ? 'All shops' : m.role?.name}</Badge></span>)}
              {staff.length === 0 ? <p className="text-xs text-text-muted">Nobody yet.</p> : null}
            </div>
          </Card>
          <Card className="flex flex-col gap-2 p-5">
            <div className="flex items-center justify-between"><CardTitle>Recent transfers</CardTitle><Link href="/backoffice/transfers" className="text-xs font-semibold text-brand-primary hover:underline">All transfers</Link></div>
            {(transfers ?? []).map((t) => (
              <Link key={t.id} href={`/backoffice/transfers/${t.id}`} className="flex justify-between text-[13px] hover:underline">
                <span className="font-mono text-xs">{t.transfer_no}</span><span className="text-text-muted">{t.from_shop_id === id ? 'Out' : 'In'} · {t.status.replace(/_/g, ' ')}</span>
              </Link>
            ))}
            {(transfers ?? []).length === 0 ? <p className="text-xs text-text-muted">No transfers.</p> : null}
          </Card>
        </div>
        <div className="xl:w-[340px]">
          <ShopEditor canManage={hasPerm(ctx.member.perms, 'settings.manage')} shop={{ id: shop.id, name: shop.name, address: shop.address ?? '', phone: showPhone(shop.phone), isActive: shop.is_active }} />
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <Card className="flex flex-col gap-1 p-4"><span className="text-xs text-text-muted">{label}</span><span className="text-xl font-bold tabular-nums">{value}</span></Card>;
}
