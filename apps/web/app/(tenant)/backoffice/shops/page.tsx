import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { ChainUpgrade } from '@/components/backoffice/ChainUpgrade';
import { AddShopButton } from '@/components/backoffice/ShopForms';
import { requireChain, type ChainShop } from '@/lib/chain';

export const metadata: Metadata = { title: 'Shops' };

// Shops (Figma 3-507, not read — built from blueprint E.2; compare when Figma access returns).
export default async function ShopsPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const { add } = await searchParams;
  const { ctx, enabled } = await requireChain();
  if (!enabled) return <ChainUpgrade title="Shops" />;
  const [{ data: shops }, { data: ov }, { data: members }] = await Promise.all([
    ctx.supabase.from('shops').select('id, code, name, address, phone, is_active').order('is_active', { ascending: false }).order('code'),
    ctx.supabase.schema('api').rpc('chain_overview'),
    ctx.supabase.from('members').select('id, all_shops, member_shops(shop_id)').eq('is_active', true),
  ]);
  const stats = new Map(((ov ?? []) as unknown as ChainShop[]).map((s) => [s.id, s]));
  const staffAt = (id: string) => (members ?? []).filter((m) => m.all_shops || m.member_shops.some((x) => x.shop_id === id)).length;
  const max = ctx.tenant.entitlements?.max_shops ?? 1;
  const active = (shops ?? []).filter((s) => s.is_active).length;
  const canManage = hasPerm(ctx.member.perms, 'settings.manage');

  return (
    <>
      <PageHeader title="Shops" subtitle={`${active} of ${max} shops on your plan`} actions={canManage && active < max ? <AddShopButton open={add === '1'} /> : null} />
      <Table>
        <thead><tr><TH>Code</TH><TH>Shop</TH><TH>Address</TH><TH>Lanes online</TH><TH>Staff</TH><TH>Sales today</TH><TH>Status</TH></tr></thead>
        <tbody>
          {(shops ?? []).map((s) => {
            const st = stats.get(s.id);
            return (
              <tr key={s.id}>
                <TD><Badge tone="success">{s.code}</Badge></TD>
                <TD className="font-medium"><Link href={`/backoffice/shops/${s.id}`} className="hover:underline">{s.name}</Link></TD>
                <TD className="text-text-muted">{s.address ?? '—'}</TD>
                <TD className="tabular-nums">{st ? `${st.lanesOnline} / ${st.lanes}` : '—'}</TD>
                <TD className="tabular-nums">{staffAt(s.id)}</TD>
                <TD className="tabular-nums">{st ? formatRs(st.salesToday, { decimals: 0 }) : '—'}</TD>
                <TD>{s.is_active ? <Badge tone="success">Open</Badge> : <Badge>Closed</Badge>}</TD>
              </tr>
            );
          })}
          {(shops ?? []).length === 0 ? <EmptyRow colSpan={7}>No shops.</EmptyRow> : null}
        </tbody>
      </Table>
      {active >= max && canManage ? <p className="text-xs text-text-muted">All shops on your plan are in use. <Link href="/backoffice/plan" className="font-semibold text-brand-primary">Change plan</Link> to add more.</p> : null}
    </>
  );
}
