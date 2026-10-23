import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH, chipClass } from '@laneos/ui';
import { PaySupplier } from '@/components/backoffice/PaySupplier';
import { PaymentDecision } from '@/components/backoffice/PaymentDecision';
import { PurchasingTabs } from '@/components/backoffice/PurchasingTabs';
import { fmtDateTime } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Supplier payments' };

const METHOD: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque' };

// Supplier payments (Figma 11-3921).
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const { supplier } = await searchParams;
  const ctx = await requireTenant();
  const [{ data: suppliers }, { data: payments }, { data: tenant }] = await Promise.all([
    ctx.supabase.from('suppliers').select('id, name, balance_due_cents').eq('is_active', true).order('balance_due_cents', { ascending: false }),
    ctx.supabase.from('supplier_payments')
      .select('id, payment_no, method, reference, amount_cents, status, created_at, supplier:suppliers(name), creator:members!supplier_payments_created_by_fkey(display_name)')
      .order('created_at', { ascending: false }).limit(100),
    ctx.supabase.from('tenants').select('supplier_payment_approval_cents').eq('id', ctx.tenant.id).single(),
  ]);
  const chosen = (suppliers ?? []).find((s) => s.id === supplier);
  const { data: grns } = chosen
    ? await ctx.supabase.from('grns').select('id, grn_no, received_on, due_on, total_cents, paid_cents')
        .eq('supplier_id', chosen.id).eq('status', 'posted').order('received_on')
    : { data: [] };
  const open = (grns ?? []).filter((g) => g.paid_cents < g.total_cents);
  const canPay = hasPerm(ctx.member.perms, 'supplier.manage');
  const isOwner = hasPerm(ctx.member.perms, 'settings.manage');

  return (
    <>
      <PageHeader title="Supplier payments" subtitle="Pay what is due on received goods; large payments need the owner" />
      <PurchasingTabs active="/backoffice/purchasing/payments" />
      {canPay ? (
        <>
          <div className="flex flex-wrap gap-2">
            {(suppliers ?? []).filter((s) => s.balance_due_cents > 0 || s.id === supplier).map((s) => (
              <Link key={s.id} href={`/backoffice/purchasing/payments?supplier=${s.id}`} className={chipClass(s.id === supplier)}>
                {s.name} · {formatRs(s.balance_due_cents, { decimals: 0 })}
              </Link>
            ))}
            {(suppliers ?? []).every((s) => s.balance_due_cents <= 0) ? <p className="text-[13px] text-text-muted">Nothing is payable right now.</p> : null}
          </div>
          {chosen ? (
            <PaySupplier key={chosen.id} supplier={{ id: chosen.id, name: chosen.name, balanceCents: chosen.balance_due_cents }} isOwner={isOwner}
              limitCents={tenant?.supplier_payment_approval_cents ?? 5000000}
              grns={open.map((g) => ({ id: g.id, grnNo: g.grn_no, receivedOn: g.received_on, dueOn: g.due_on, openCents: g.total_cents - g.paid_cents }))} />
          ) : null}
        </>
      ) : null}
      <Table>
        <thead><tr><TH>Payment</TH><TH>Supplier</TH><TH>Method</TH><TH>Amount</TH><TH>By</TH><TH>When</TH><TH>Status</TH></tr></thead>
        <tbody>
          {(payments ?? []).map((p) => (
            <tr key={p.id}>
              <TD className="font-mono text-xs">{p.payment_no}</TD>
              <TD className="font-medium">{p.supplier?.name}</TD>
              <TD>{METHOD[p.method]}{p.reference ? ` · ${p.reference}` : ''}</TD>
              <TD className="tabular-nums">{formatRs(p.amount_cents)}</TD>
              <TD>{p.creator?.display_name}</TD>
              <TD>{fmtDateTime(p.created_at)}</TD>
              <TD>
                {p.status === 'pending_approval'
                  ? (isOwner ? <PaymentDecision id={p.id} /> : <Badge tone="warning">Needs approval</Badge>)
                  : <Badge tone={p.status === 'paid' ? 'success' : 'neutral'}>{p.status === 'paid' ? 'Paid' : 'Rejected'}</Badge>}
              </TD>
            </tr>
          ))}
          {(payments ?? []).length === 0 ? <EmptyRow colSpan={7}>No supplier payments yet.</EmptyRow> : null}
        </tbody>
      </Table>
    </>
  );
}
