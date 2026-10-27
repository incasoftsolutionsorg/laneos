import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH, buttonClass, chipClass, type Tone } from '@laneos/ui';
import { ReasonAction } from '@/components/backoffice/RowActions';
import { colomboToday, fmtDate } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';
import { cancelNote, cashOutNote, extendNote } from './actions';

export const metadata: Metadata = { title: 'Returns & credit notes' };

const FILTERS = [['open', 'Open'], ['used', 'Used'], ['expired', 'Expired'], ['all', 'All']] as const;

// Returns & credit notes (Figma 1-2808 / blueprint §30.2). Returns themselves happen at a lane.
export default async function CreditNotesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await requireTenant();
  const { filter = 'open' } = await searchParams;
  const today = colomboToday();

  let q = ctx.supabase
    .from('credit_notes')
    .select('id, note_no, code_last4, amount_cents, balance_cents, expires_on, status, created_at, shop:shops(code), customer:customers(name), ret:returns(return_no, sale:sales(invoice_no))')
    .order('created_at', { ascending: false })
    .limit(200);
  if (filter === 'open') q = q.in('status', ['active', 'partially_used']).gte('expires_on', today);
  if (filter === 'used') q = q.in('status', ['used', 'cancelled', 'cashed_out']);
  if (filter === 'expired') q = q.or(`status.eq.expired,and(status.in.(active,partially_used),expires_on.lt.${today})`);
  const [{ data }, { data: lanes }, { data: t }] = await Promise.all([
    q,
    ctx.supabase.from('lanes').select('id, code').eq('shop_id', ctx.shop.id).eq('status', 'active').order('code'),
    ctx.supabase.from('tenants').select('credit_note_cash_out').eq('id', ctx.tenant.id).single(),
  ]);
  const canCashOut = !!t?.credit_note_cash_out && hasPerm(ctx.member.perms, 'shift.manage');
  const rows = data ?? [];
  const canManage = hasPerm(ctx.member.perms, 'settings.manage');
  const canReturn = hasPerm(ctx.member.perms, 'return.create');

  const status = (r: (typeof rows)[number]): { tone: Tone; text: string } => {
    if (['active', 'partially_used'].includes(r.status) && r.expires_on < today) return { tone: 'neutral', text: 'Expired' };
    switch (r.status) {
      case 'active': return { tone: 'success', text: 'Active' };
      case 'partially_used': return { tone: 'warning', text: 'Part used' };
      case 'used': return { tone: 'neutral', text: 'Used' };
      case 'cancelled': return { tone: 'danger', text: 'Cancelled' };
      default: return { tone: 'neutral', text: r.status.replace('_', ' ') };
    }
  };

  return (
    <>
      <PageHeader
        title="Returns & credit notes"
        subtitle="Credit notes are money the shop owes customers. Codes are never stored; only the last 4 characters are shown."
        actions={canReturn && lanes?.length ? (
          <div className="flex gap-2">
            {lanes.map((l) => <Link key={l.id} href={`/lane/${l.id}/return`} className={buttonClass(l === lanes[0] ? 'primary' : 'secondary')}>New return · {l.code}</Link>)}
          </div>
        ) : null}
      />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([k, t]) => <Link key={k} href={`/backoffice/credit-notes${k === 'open' ? '' : `?filter=${k}`}`} className={chipClass(filter === k)}>{t}</Link>)}
        <Link href="/backoffice/refunds" className="ml-auto text-[13px] font-semibold text-brand-primary">All refunds →</Link>
      </div>
      <Table>
        <thead>
          <tr><TH>Credit note</TH><TH>Code</TH><TH>From return</TH><TH>Customer</TH><TH>Amount</TH><TH>Balance</TH><TH>Valid until</TH><TH>Status</TH>{canManage ? <TH>Actions</TH> : null}</tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = status(r);
            const live = ['active', 'partially_used', 'expired'].includes(r.status);
            return (
              <tr key={r.id}>
                <TD className="font-mono text-xs">{r.note_no}</TD>
                <TD className="font-mono text-xs">••••-{r.code_last4}</TD>
                <TD className="font-mono text-xs">{r.ret ? `${r.ret.return_no} · ${r.ret.sale?.invoice_no ?? ''}` : 'Goodwill'}</TD>
                <TD>{r.customer?.name ?? '—'}</TD>
                <TD className="tabular-nums">{formatRs(r.amount_cents)}</TD>
                <TD className="font-semibold tabular-nums">{formatRs(r.balance_cents)}</TD>
                <TD>{fmtDate(r.expires_on)}</TD>
                <TD><Badge tone={s.tone}>{s.text}</Badge></TD>
                {canManage ? (
                  <TD>
                    {live ? (
                      <div className="flex gap-3">
                        <ReasonAction label="Extend" title={`Extend ${r.note_no}`} action={extendNote} hidden={{ id: r.id }}
                          fields={[{ name: 'days', label: 'Extra days', type: 'number', defaultValue: '30' }]} submitLabel="Extend" />
                        {r.status !== 'expired' ? (
                          <ReasonAction label="Cancel" title={`Cancel ${r.note_no}`} action={cancelNote} hidden={{ id: r.id }} danger submitLabel="Cancel credit note" />
                        ) : null}
                        {canCashOut ? (
                          <ReasonAction label="Cash out" title={`Pay out ${formatRs(r.balance_cents)} for ${r.note_no}`} action={cashOutNote} hidden={{ id: r.id }} danger submitLabel="Pay out in cash" />
                        ) : null}
                      </div>
                    ) : '—'}
                  </TD>
                ) : null}
              </tr>
            );
          })}
          {rows.length === 0 ? <EmptyRow colSpan={canManage ? 9 : 8}>No credit notes here.</EmptyRow> : null}
        </tbody>
      </Table>
    </>
  );
}
