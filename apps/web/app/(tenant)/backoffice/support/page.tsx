import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyRow, PageHeader, Table, TD, TH, cn } from '@laneos/ui';
import { NewTicket, SupportReply } from '@/components/backoffice/SupportForms';
import { ago, fmtDateTime } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Help & support' };

// Help & support (no frame): where businesses open the tickets LaneOS staff answer in /admin/tickets.
export default async function SupportPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const ctx = await requireTenant();
  const [{ data: tickets }, { data: sel }] = await Promise.all([
    ctx.supabase.from('support_tickets').select('id, ticket_no, subject, status, updated_at').order('updated_at', { ascending: false }).limit(50),
    id ? ctx.supabase.from('support_tickets').select('id, ticket_no, subject, status, ticket_messages(id, body, is_staff, created_at)').eq('id', id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return (
    <>
      <PageHeader title="Help & support" subtitle="Questions and problems go to the LaneOS team; replies show here." />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {sel ? (
            <div className="flex flex-col gap-3">
              <p className="text-[15px] font-semibold">#{sel.ticket_no} {sel.subject} <Badge tone={sel.status === 'pending' ? 'warning' : sel.status === 'open' ? 'info' : 'success'}>{sel.status === 'pending' ? 'waiting for you' : sel.status}</Badge></p>
              {[...sel.ticket_messages].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((m) => (
                <Card key={m.id} className={cn('flex flex-col gap-1 p-4', m.is_staff ? 'mr-10 border-brand-primary/40' : 'ml-10')}>
                  <span className="text-[11px] text-text-muted">{m.is_staff ? 'LaneOS support' : 'You'} · {fmtDateTime(m.created_at)}</span>
                  <p className="whitespace-pre-wrap text-[13px]">{m.body}</p>
                </Card>
              ))}
              {sel.status !== 'closed' ? <SupportReply id={sel.id} /> : null}
            </div>
          ) : null}
          <Table>
            <thead><tr><TH>#</TH><TH>Title</TH><TH>Status</TH><TH>Updated</TH></tr></thead>
            <tbody>
              {(tickets ?? []).map((t) => (
                <tr key={t.id} className={t.id === id ? 'bg-brand-light/40' : undefined}>
                  <TD className="tabular-nums">{t.ticket_no}</TD>
                  <TD className="font-medium"><Link href={`/backoffice/support?id=${t.id}`} className="hover:underline">{t.subject}</Link></TD>
                  <TD><Badge tone={t.status === 'pending' ? 'warning' : t.status === 'open' ? 'info' : 'success'}>{t.status === 'pending' ? 'waiting for you' : t.status}</Badge></TD>
                  <TD>{ago(t.updated_at)}</TD>
                </tr>
              ))}
              {(tickets ?? []).length === 0 ? <EmptyRow colSpan={4}>No tickets yet.</EmptyRow> : null}
            </tbody>
          </Table>
        </div>
        <div className="xl:w-[380px]"><NewTicket /></div>
      </div>
    </>
  );
}
