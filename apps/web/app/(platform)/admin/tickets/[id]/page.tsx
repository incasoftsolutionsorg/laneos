import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, PageHeader, buttonClass, cn } from '@laneos/ui';
import { TicketReply } from '@/components/admin/AdminForms';
import { fmtDateTime } from '@/lib/server/dates';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'Ticket' };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAdmin();
  const { data: t } = await supabase.from('support_tickets')
    .select('id, ticket_no, subject, priority, status, created_at, tenant_id, tenant:tenants(name), ticket_messages(id, body, is_staff, created_at)')
    .eq('id', id).maybeSingle();
  if (!t) notFound();
  const msgs = [...t.ticket_messages].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return (
    <>
      <PageHeader title={`#${t.ticket_no} ${t.subject}`} subtitle={<span className="flex items-center gap-2">{t.tenant?.name}<Badge>{t.priority}</Badge><Badge tone={t.status === 'open' ? 'warning' : 'info'}>{t.status}</Badge></span>}
        actions={<div className="flex gap-2"><Link href={`/admin/tenants/${t.tenant_id}`} className={buttonClass('secondary')}>Tenant</Link><Link href="/admin/tickets" className={buttonClass('secondary')}>All tickets</Link></div>} />
      <div className="flex max-w-3xl flex-col gap-3">
        {msgs.map((m) => (
          <Card key={m.id} className={cn('flex flex-col gap-1 p-4', m.is_staff ? 'ml-10 border-platform-accent/40' : 'mr-10')}>
            <span className="text-[11px] text-text-muted">{m.is_staff ? 'LaneOS support' : t.tenant?.name} · {fmtDateTime(m.created_at)}</span>
            <p className="whitespace-pre-wrap text-[13px]">{m.body}</p>
          </Card>
        ))}
        <TicketReply id={t.id} status={t.status} />
      </div>
    </>
  );
}
