import type { Metadata } from 'next';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { PERM, PERM_LABEL, type Permission } from '@laneos/core';
import { Badge, PageHeader, Table, TD, TH, buttonClass } from '@laneos/ui';
import { requireTenant } from '@/lib/server/context';
import { ROLE_TONE } from '@/lib/staff';

export const metadata: Metadata = { title: 'Roles' };

// Roles view (Figma 1-3237 "Roles" button): what each role can do by default. Per-person changes are made on the user.
export default async function RolesPage() {
  const ctx = await requireTenant();
  const [{ data: roles }, { data: members }] = await Promise.all([
    ctx.supabase.from('roles').select('id, key, name, permissions').order('permissions', { ascending: false }),
    ctx.supabase.from('members').select('role_id').eq('is_active', true),
  ]);
  const count = new Map<string, number>();
  for (const m of members ?? []) count.set(m.role_id, (count.get(m.role_id) ?? 0) + 1);
  const list = roles ?? [];
  return (
    <>
      <PageHeader title="Roles" subtitle="Default permissions per role. Turn single permissions on or off for one person from their Edit page."
        actions={<Link href="/backoffice/staff" className={buttonClass('secondary')}>Back to users</Link>} />
      <Table>
        <thead>
          <tr>
            <TH>Permission</TH>
            {list.map((r) => <TH key={r.id} className="text-center"><Badge tone={ROLE_TONE[r.key] ?? 'neutral'}>{r.name}</Badge><span className="mt-1 block font-normal">{count.get(r.id) ?? 0} people</span></TH>)}
          </tr>
        </thead>
        <tbody>
          {(Object.keys(PERM) as Permission[]).map((p) => (
            <tr key={p}>
              <TD><span className="font-medium">{PERM_LABEL[p].label}</span>{PERM_LABEL[p].hint ? <span className="block text-[11px] text-text-muted">{PERM_LABEL[p].hint}</span> : null}</TD>
              {list.map((r) => (
                <TD key={r.id} className="text-center">
                  {(Number(r.permissions) & PERM[p]) !== 0 ? <Check size={16} className="mx-auto text-success" aria-label="Yes" /> : <span className="text-text-muted" aria-label="No">—</span>}
                </TD>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
