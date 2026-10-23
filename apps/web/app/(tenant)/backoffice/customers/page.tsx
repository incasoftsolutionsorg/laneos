import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, EmptyRow, Input, PageHeader, Table, TD, TH, buttonClass } from '@laneos/ui';
import { CustomerPanel } from '@/components/backoffice/CustomerPanel';
import { AddCustomerButton } from '@/components/backoffice/QuickForms';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Customers & credit' };

const showPhone = (p: string) => p.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3');
const DAY = 86_400_000;
const dm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short' }).format(new Date(iso));

type Row = { id: string; balance_due_cents: number; credit_limit_cents: number; is_active: boolean };

function status(c: Row, oldest: string | undefined, creditDays: number): { tone: 'success' | 'warning' | 'danger' | 'neutral'; text: string } {
  if (!c.is_active) return { tone: 'neutral', text: 'Inactive' };
  if (c.balance_due_cents <= 0) return { tone: 'success', text: 'Good' };
  if (c.credit_limit_cents > 0 && c.balance_due_cents > c.credit_limit_cents) return { tone: 'danger', text: 'Over limit' };
  if (oldest) {
    const left = Math.ceil((new Date(oldest).getTime() + creditDays * DAY - Date.now()) / DAY);
    if (left < 0) return { tone: 'danger', text: `Overdue ${-left} days` };
    if (left <= 7) return { tone: 'warning', text: left === 0 ? 'Due today' : `Due in ${left} days` };
  }
  if (c.credit_limit_cents > 0 && c.balance_due_cents >= c.credit_limit_cents * 0.85) return { tone: 'danger', text: 'Over 85%' };
  return { tone: 'success', text: 'Good' };
}

// Customers & credit (Figma 1-3034): credit customers, settlements and loyalty members.
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ id?: string; q?: string; all?: string }> }) {
  const { id, q, all } = await searchParams;
  const ctx = await requireTenant();
  let query = ctx.supabase.from('customers')
    .select('id, name, phone, credit_limit_cents, balance_due_cents, loyalty_points, is_active')
    .order('balance_due_cents', { ascending: false }).order('name').limit(300);
  if (!all) query = query.eq('is_active', true);
  if (q?.trim()) query = query.or(`name.ilike.%${q.trim().replace(/[%,()]/g, '')}%,phone.ilike.%${q.replace(/\D/g, '').replace(/^0/, '')}%`);
  const [{ data }, { data: credit }, { data: tenant }, { data: shop }] = await Promise.all([
    query,
    ctx.supabase.schema('api').rpc('customer_credit'),
    ctx.supabase.from('tenants').select('customer_credit_days').eq('id', ctx.tenant.id).single(),
    ctx.supabase.from('shops').select('name, address, phone').eq('id', ctx.shop.id).single(),
  ]);
  const rows = data ?? [];
  const oldest = (credit ?? {}) as Record<string, { oldestUnpaid: string | null }>;
  const days = tenant?.customer_credit_days ?? 30;
  const owed = rows.reduce((s, c) => s + Math.max(0, c.balance_due_cents), 0);
  const sel = rows.find((r) => r.id === id) ?? rows.find((r) => r.balance_due_cents > 0) ?? rows[0];
  const canManage = hasPerm(ctx.member.perms, 'customer.manage');
  const firstOwing = rows.find((r) => r.balance_due_cents > 0);
  const selOldest = sel ? oldest[sel.id]?.oldestUnpaid : null;

  return (
    <>
      <PageHeader
        title="Customers & credit"
        subtitle={`Credit customers, settlements and loyalty members · ${formatRs(owed, { decimals: 0 })} owed to you`}
        actions={
          <div className="flex gap-2">
            {canManage && firstOwing ? <Link href={`/backoffice/customers?id=${sel && sel.balance_due_cents > 0 ? sel.id : firstOwing.id}#pay`} className={buttonClass('secondary')}>Receive payment</Link> : null}
            {canManage ? <AddCustomerButton /> : null}
          </div>
        }
      />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-4">
            <form className="w-full max-w-sm"><Input name="q" defaultValue={q} placeholder="Search name or mobile" aria-label="Search customers" />{all ? <input type="hidden" name="all" value="1" /> : null}</form>
            <Link href={all ? '/backoffice/customers' : '/backoffice/customers?all=1'} className="text-xs font-semibold text-brand-primary hover:underline">{all ? 'Hide inactive' : 'Show inactive'}</Link>
          </div>
          <Table>
            <thead>
              <tr><TH>Customer</TH><TH>Phone</TH><TH>Credit limit</TH><TH>Balance due</TH><TH>Loyalty</TH><TH>Status</TH></tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const st = status(c, oldest[c.id]?.oldestUnpaid ?? undefined, days);
                return (
                  <tr key={c.id} className={c.id === sel?.id ? 'bg-brand-light/40' : undefined}>
                    <TD className="font-medium"><Link href={`/backoffice/customers?id=${c.id}${q ? `&q=${encodeURIComponent(q)}` : ''}`} className="hover:underline">{c.name}</Link></TD>
                    <TD className="tabular-nums">{showPhone(c.phone)}</TD>
                    <TD className="tabular-nums">{c.credit_limit_cents > 0 ? formatRs(c.credit_limit_cents, { decimals: 0 }) : '—'}</TD>
                    <TD className="tabular-nums">{formatRs(c.balance_due_cents, { decimals: 0 })}</TD>
                    <TD className="tabular-nums">{c.loyalty_points > 0 ? `${c.loyalty_points.toLocaleString('en-LK')} pts` : '—'}</TD>
                    <TD><Badge tone={st.tone}>{st.text}</Badge></TD>
                  </tr>
                );
              })}
              {rows.length === 0 ? <EmptyRow colSpan={6}>{q ? 'No customer matches that search.' : 'No customers yet. Add one, or attach one at the lane (F7).'}</EmptyRow> : null}
            </tbody>
          </Table>
        </div>
        {sel ? (
          <CustomerPanel
            key={sel.id}
            canManage={canManage}
            c={{
              id: sel.id, name: sel.name, phone: sel.phone, creditLimitCents: sel.credit_limit_cents, balanceCents: sel.balance_due_cents,
              oldest: selOldest ? `${dm(selOldest)} · ${Math.floor((Date.now() - new Date(selOldest).getTime()) / DAY)} days` : null,
            }}
            print={{ tenant: ctx.tenant.name, shop: { name: shop?.name ?? ctx.shop.name, address: shop?.address, phone: shop?.phone }, by: ctx.member.name }}
          />
        ) : null}
      </div>
    </>
  );
}
