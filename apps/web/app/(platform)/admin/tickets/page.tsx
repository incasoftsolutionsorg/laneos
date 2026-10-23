import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyRow, PageHeader, Table, TD, TH, chipClass } from '@laneos/ui';
import { ago } from '@/lib/server/dates';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'Support tickets' };

const PRIORITY = { low: 'neutral', normal: 'info', high: 'warning', urgent: 'danger' } as const;

// Support tickets (Figma 3-4234, not read — compare when Figma access returns). Businesses open them from Back office → Help & support.
export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = 'active' } = await searchParams;
  const { supabase } = await requireAdmin();
  let q = supabase.from('support_tickets').select('id, ticket_no, subject, priority, status, updated_at, tenant:tenants(name)').order('updated_at', { ascending: false }).limit(200);
  if (status === 'active') q = q.in('status', ['open', 'pending']);
  else if (status) q = q.eq('status', status as 'open');
  const { data } = await q;
  return (
    <>
      <PageHeader title="Support tickets" subtitle="Open = waiting for LaneOS · Pending = waiting for the business" />
      <div className="flex gap-2">{[['active', 'Open & pending'], ['resolved', 'Resolved'], ['closed', 'Closed'], ['', 'All']].map(([k, t]) => <Link key={k} href={`/admin/tickets?status=${k}`} className={chipClass(k === status)}>{t}</Link>)}</div>
      <Table>
        <thead><tr><TH>#</TH><TH>Subject</TH><TH>Business</TH><TH>Priority</TH><TH>Status</TH><TH>Updated</TH></tr></thead>
        <tbody>
          {(data ?? []).map((t) => (
            <tr key={t.id}>
              <TD className="tabular-nums">{t.ticket_no}</TD>
              <TD className="font-medium"><Link href={`/admin/tickets/${t.id}`} className="hover:underline">{t.subject}</Link></TD>
              <TD>{t.tenant?.name}</TD>
              <TD><Badge tone={PRIORITY[t.priority]}>{t.priority}</Badge></TD>
              <TD><Badge tone={t.status === 'open' ? 'warning' : t.status === 'pending' ? 'info' : 'success'}>{t.status}</Badge></TD>
              <TD>{ago(t.updated_at)}</TD>
            </tr>
          ))}
          {(data ?? []).length === 0 ? <EmptyRow colSpan={6}>No tickets here.</EmptyRow> : null}
        </tbody>
      </Table>
    </>
  );
}
