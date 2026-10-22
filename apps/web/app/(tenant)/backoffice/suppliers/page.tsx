import type { Metadata } from 'next';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { SupplierForm } from '@/components/backoffice/QuickForms';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Suppliers' };

export default async function SuppliersPage() {
  const ctx = await requireTenant();
  const { data } = await ctx.supabase
    .from('suppliers')
    .select('id, name, phone, email, payment_terms_days, is_sale_or_return, balance_due_cents, is_active')
    .order('name');
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Suppliers" subtitle={`${rows.length} suppliers · ${formatRs(rows.reduce((s, r) => s + r.balance_due_cents, 0), { decimals: 0 })} payable`} />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <Table>
            <thead>
              <tr><TH>Supplier</TH><TH>Contact</TH><TH>Terms</TH><TH>Payable</TH><TH>Type</TH></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <TD className="font-medium">{s.name}</TD>
                  <TD>{s.phone ?? s.email ?? '—'}</TD>
                  <TD>{s.payment_terms_days} days</TD>
                  <TD className="tabular-nums">{formatRs(s.balance_due_cents)}</TD>
                  <TD>{s.is_sale_or_return ? <Badge tone="brand">Sale-or-return</Badge> : <Badge>Outright</Badge>}</TD>
                </tr>
              ))}
              {rows.length === 0 ? <EmptyRow colSpan={5}>No suppliers yet.</EmptyRow> : null}
            </tbody>
          </Table>
        </div>
        {hasPerm(ctx.member.perms, 'supplier.manage') ? <div className="xl:w-[340px]"><SupplierForm /></div> : null}
      </div>
    </>
  );
}
