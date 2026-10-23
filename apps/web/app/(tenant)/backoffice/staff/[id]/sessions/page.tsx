import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, buttonClass } from '@laneos/ui';
import { SessionsTable, type SessionRow } from '@/components/backoffice/SessionsTable';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Staff sessions' };

// A staff member's signed-in devices (Figma 1-3518 "Active sessions", blueprint §27.5.7).
export default async function StaffSessionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant('staff.manage');
  const { data: m } = await ctx.supabase.from('members').select('id, display_name, user_id').eq('id', id).maybeSingle();
  if (!m) notFound();
  const { data } = m.user_id ? await ctx.supabase.schema('api').rpc('list_sessions', { p_user: m.user_id }) : { data: [] };
  return (
    <>
      <PageHeader title={`${m.display_name} · sessions`} subtitle="Every device signed in as this person. End one, or use Reset access to end them all."
        actions={<Link href={`/backoffice/staff/${m.id}`} className={buttonClass('secondary')}>Back</Link>} />
      <SessionsTable rows={(data ?? []) as unknown as SessionRow[]} empty={m.user_id ? 'Not signed in anywhere.' : 'PIN-only cashiers have no sign-in sessions.'} />
    </>
  );
}
