import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { hasPerm } from '@laneos/core';
import { Badge, Card, CardTitle, PageHeader, buttonClass } from '@laneos/ui';
import { ResetAccessButton, StaffForm } from '@/components/backoffice/StaffForm';
import { ROLE_TONE } from '@/lib/staff';
import { fmtDateTime } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Edit user' };

const showPhone = (p: string | null) => (p ? p.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3') : '');

// Edit one staff member: role, shops, PIN, single-permission changes, active (Figma 1-3237 "Edit").
export default async function EditStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant('staff.manage');
  const [{ data: m }, { data: roles }, { data: audit }] = await Promise.all([
    ctx.supabase.from('members')
      .select('id, display_name, staff_code, phone, all_shops, is_active, user_id, invite_email, has_pin, role_id, perms_add, perms_remove, role:roles(key, name, permissions), member_shops(shop_id)')
      .eq('id', id).maybeSingle(),
    ctx.supabase.from('roles').select('id, key, name, permissions').order('permissions', { ascending: false }),
    ctx.supabase.from('audit_log').select('id, action, created_at').eq('entity_id', id).order('created_at', { ascending: false }).limit(8),
  ]);
  if (!m || !m.role) notFound();
  const perms = (Number(m.role.permissions) | Number(m.perms_add)) & ~Number(m.perms_remove);

  return (
    <>
      <PageHeader
        title={m.display_name}
        subtitle={<span className="flex items-center gap-2"><Badge tone={ROLE_TONE[m.role.key] ?? 'neutral'}>{m.role.name}</Badge>{m.user_id ? 'Signs in with email' : m.invite_email ? `Invited · ${m.invite_email}` : 'PIN-only cashier'}</span>}
        actions={
          <div className="flex items-center gap-3">
            {m.user_id ? <Link href={`/backoffice/staff/${m.id}/sessions`} className={buttonClass('secondary')}>Sessions</Link> : null}
            {m.id !== ctx.member.id && m.role.key !== 'owner' ? <ResetAccessButton memberId={m.id} name={m.display_name} className={buttonClass('danger')} /> : null}
          </div>
        }
      />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="max-w-xl flex-1">
          <StaffForm
            roles={(roles ?? []).map((r) => ({ ...r, permissions: Number(r.permissions) }))}
            shops={ctx.shops}
            canOwner={hasPerm(ctx.member.perms, 'settings.manage')}
            initial={{
              id: m.id, name: m.display_name, login: m.invite_email ?? '', staffCode: m.staff_code ?? '', phone: showPhone(m.phone),
              roleId: m.role_id, shop: m.all_shops ? 'all' : m.member_shops[0]?.shop_id ?? 'all', perms, active: m.is_active,
              hasLogin: !!m.user_id, hasPin: !!m.has_pin,
            }}
          />
        </div>
        <Card className="flex flex-col gap-2 p-5 xl:w-[340px]">
          <CardTitle>Recent changes</CardTitle>
          {(audit ?? []).map((a) => (
            <div key={a.id} className="flex justify-between gap-3 text-[13px]">
              <span className="font-mono text-xs">{a.action}</span><span className="text-text-muted">{fmtDateTime(a.created_at)}</span>
            </div>
          ))}
          {(audit ?? []).length === 0 ? <p className="text-xs text-text-muted">Nothing recorded yet.</p> : null}
        </Card>
      </div>
    </>
  );
}
