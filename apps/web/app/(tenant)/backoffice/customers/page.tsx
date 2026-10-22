import type { Metadata } from 'next';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { CustomerForm } from '@/components/backoffice/QuickForms';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Customers & credit' };

const showPhone = (p: string) => p.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3');

export default async function CustomersPage() {
  const ctx = await requireTenant();
  const { data: customers } = await ctx.supabase
    .from('customers')
    .select('id, name, phone, credit_limit_cents, balance_due_cents, loyalty_points, is_active')
    .order('name')
    .limit(200);
  const rows = customers ?? [];
  const owed = rows.reduce((s, c) => s + c.balance_due_cents, 0);

  return (
    <>
      <PageHeader title="Customers & credit" subtitle={`${rows.length} customers · ${formatRs(owed, { decimals: 0 })} owed to you`} />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <Table>
            <thead>
              <tr><TH>Name</TH><TH>Mobile</TH><TH>Credit limit</TH><TH>Balance due</TH><TH>Points</TH><TH>Status</TH></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD className="tabular-nums">{showPhone(c.phone)}</TD>
                  <TD className="tabular-nums">{c.credit_limit_cents > 0 ? formatRs(c.credit_limit_cents, { decimals: 0 }) : 'Cash only'}</TD>
                  <TD className="tabular-nums">{formatRs(c.balance_due_cents)}</TD>
                  <TD className="tabular-nums">{c.loyalty_points}</TD>
                  <TD>
                    {!c.is_active ? <Badge>Inactive</Badge>
                      : c.credit_limit_cents > 0 && c.balance_due_cents > c.credit_limit_cents ? <Badge tone="danger">Over limit</Badge>
                      : c.balance_due_cents > 0 ? <Badge tone="warning">Owes</Badge>
                      : <Badge tone="success">Clear</Badge>}
                  </TD>
                </tr>
              ))}
              {rows.length === 0 ? <EmptyRow colSpan={6}>No customers yet.</EmptyRow> : null}
            </tbody>
          </Table>
        </div>
        {hasPerm(ctx.member.perms, 'customer.manage') ? <div className="xl:w-[340px]"><CustomerForm /></div> : null}
      </div>
    </>
  );
}
