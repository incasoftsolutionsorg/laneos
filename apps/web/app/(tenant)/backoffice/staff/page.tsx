import type { Metadata } from 'next';
import { permsOf } from '@laneos/core';
import { Badge, Card, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Users & roles' };

export default async function StaffPage() {
  const ctx = await requireTenant();
  const [{ data: members }, { data: roles }] = await Promise.all([
    ctx.supabase.from('members').select('id, display_name, phone, all_shops, is_active, user_id, role:roles(name), member_shops(shop:shops(code))').order('display_name'),
    ctx.supabase.from('roles').select('id, key, name, permissions').order('permissions', { ascending: false }),
  ]);

  return (
    <>
      <PageHeader title="Users & roles" subtitle="Everyone who can sign in to this business, and what each role can do." />
      <Table>
        <thead>
          <tr><TH>Name</TH><TH>Role</TH><TH>Shops</TH><TH>Sign-in</TH><TH>Status</TH></tr>
        </thead>
        <tbody>
          {(members ?? []).map((m) => (
            <tr key={m.id}>
              <TD className="font-medium">{m.display_name}</TD>
              <TD>{m.role?.name}</TD>
              <TD>{m.all_shops ? 'All shops' : m.member_shops.map((s) => s.shop?.code).join(', ') || '—'}</TD>
              <TD>{m.user_id ? 'Email + password' : 'PIN only'}</TD>
              <TD>{m.is_active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</TD>
            </tr>
          ))}
          {(members ?? []).length === 0 ? <EmptyRow colSpan={5}>No staff yet.</EmptyRow> : null}
        </tbody>
      </Table>

      <h2 className="text-[15px] font-semibold">Roles</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(roles ?? []).map((r) => (
          <Card key={r.id} className="flex flex-col gap-2 p-4">
            <p className="text-[13px] font-semibold">{r.name}</p>
            <div className="flex flex-wrap gap-1.5">
              {permsOf(Number(r.permissions)).map((p) => <Badge key={p} tone="brand">{p}</Badge>)}
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-text-muted">Inviting staff and setting cashier PINs comes with the staff and PIN-login tasks (milestone M1).</p>
    </>
  );
}
