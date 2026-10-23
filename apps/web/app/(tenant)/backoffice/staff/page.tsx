import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPerm } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH, buttonClass } from '@laneos/ui';
import { ResetAccessButton, StaffForm } from '@/components/backoffice/StaffForm';
import { ago } from '@/lib/server/dates';
import { ROLE_TONE } from '@/lib/staff';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Users & roles' };

// Users & roles (Figma 1-3237): staff list with 2FA and last activity, add-user panel.
export default async function StaffPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const ctx = await requireTenant();
  const canManage = hasPerm(ctx.member.perms, 'staff.manage');
  const [{ data: members }, { data: roles }, { data: status }, { data: lanes }, { data: tenant }] = await Promise.all([
    ctx.supabase.from('members')
      .select('id, display_name, staff_code, all_shops, is_active, user_id, invite_email, has_pin, role:roles(key, name), member_shops(shop:shops(code))')
      .order('is_active', { ascending: false }).order('created_at'),
    ctx.supabase.from('roles').select('id, key, name, permissions').order('permissions', { ascending: false }),
    canManage ? ctx.supabase.schema('api').rpc('member_status') : Promise.resolve({ data: {} }),
    ctx.supabase.from('lanes').select('code, active_member_id, active_since').not('active_member_id', 'is', null),
    ctx.supabase.from('tenants').select('plan:plans(name, max_staff)').eq('id', ctx.tenant.id).single(),
  ]);
  const everyone = members ?? [];
  const rows = all ? everyone : everyone.filter((m) => m.is_active);
  const inactive = everyone.length - everyone.filter((m) => m.is_active).length;
  const st = (status ?? {}) as Record<string, { twoFactor: boolean; lastActive: string | null }>;
  const onLane = new Map((lanes ?? []).map((l) => [l.active_member_id!, l]));
  const used = everyone.filter((m) => m.is_active).length;
  const canOwner = hasPerm(ctx.member.perms, 'settings.manage');

  return (
    <>
      <PageHeader
        title="Users & roles"
        subtitle={tenant?.plan ? `${used} of ${tenant.plan.max_staff} staff seats used on ${tenant.plan.name}` : `${used} staff`}
        actions={<Link href="/backoffice/staff/roles" className={buttonClass('secondary')}>Roles</Link>}
      />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Table>
            <thead><tr><TH>Name</TH><TH>Role</TH><TH>Lanes / shop</TH><TH>Code</TH><TH>2FA</TH><TH>Last active</TH><TH>Actions</TH></tr></thead>
            <tbody>
              {rows.map((m) => {
                const lane = onLane.get(m.id);
                const s = st[m.id];
                const last = [s?.lastActive, lane?.active_since].filter(Boolean).sort().at(-1);
                return (
                  <tr key={m.id} className={m.is_active ? undefined : 'opacity-60'}>
                    <TD className="font-medium">
                      {m.display_name}
                      {m.invite_email && !m.user_id ? <span className="block text-[11px] font-normal text-text-muted">Invited · {m.invite_email}</span> : null}
                    </TD>
                    <TD><Badge tone={ROLE_TONE[m.role?.key ?? ''] ?? 'neutral'}>{m.role?.name}</Badge></TD>
                    <TD>{lane ? lane.code : m.all_shops ? 'All' : m.member_shops.map((x) => x.shop?.code).join(', ') || '—'}</TD>
                    <TD className="font-mono text-xs">{m.staff_code ?? '—'}</TD>
                    <TD>{!m.is_active ? <Badge>Inactive</Badge> : m.user_id ? (s?.twoFactor ? <Badge tone="success">On</Badge> : <Badge tone="danger">Off</Badge>) : m.has_pin ? 'PIN' : <span className="text-text-muted">No PIN</span>}</TD>
                    <TD>{ago(last)}</TD>
                    <TD>
                      {canManage ? (
                        <span className="flex gap-3 text-xs">
                          <Link href={`/backoffice/staff/${m.id}`} className="font-semibold text-brand-primary hover:underline">Edit</Link>
                          {m.id !== ctx.member.id && m.role?.key !== 'owner' && m.is_active ? <ResetAccessButton memberId={m.id} name={m.display_name} /> : null}
                        </span>
                      ) : '—'}
                    </TD>
                  </tr>
                );
              })}
              {rows.length === 0 ? <EmptyRow colSpan={7}>No staff yet.</EmptyRow> : null}
            </tbody>
          </Table>
          {inactive ? <Link href={all ? '/backoffice/staff' : '/backoffice/staff?all=1'} className="text-xs font-semibold text-brand-primary hover:underline">{all ? 'Hide inactive' : `Show ${inactive} inactive`}</Link> : null}
        </div>
        {canManage ? (
          <div className="xl:w-[340px]">
            <StaffForm roles={(roles ?? []).map((r) => ({ ...r, permissions: Number(r.permissions) }))} shops={ctx.shops} canOwner={canOwner} />
          </div>
        ) : null}
      </div>
    </>
  );
}
