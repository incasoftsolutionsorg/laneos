import type { Metadata } from 'next';
import Link from 'next/link';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, Card, CardTitle, EmptyRow, PageHeader, Table, TD, TH, buttonClass } from '@laneos/ui';
import { AddSupplierButton } from '@/components/backoffice/QuickForms';
import { fmtDate } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Suppliers' };

const showPhone = (p: string | null) => (p ? p.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3') : null);
const dm = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00+05:30`));

// Suppliers (Figma 1-2121): list + the selected supplier's panel.
export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const ctx = await requireTenant();
  const [{ data }, { data: lastGrns }] = await Promise.all([
    ctx.supabase.from('suppliers')
      .select('id, name, contact_name, phone, email, vat_no, payment_terms_days, is_sale_or_return, daily_delivery, balance_due_cents, is_active')
      .order('name'),
    ctx.supabase.from('grns').select('id, grn_no, supplier_id, received_on, total_cents').eq('status', 'posted').order('received_on', { ascending: false }).limit(500),
  ]);
  const rows = data ?? [];
  const last = new Map<string, string>();
  for (const g of lastGrns ?? []) if (!last.has(g.supplier_id)) last.set(g.supplier_id, g.received_on);
  const sel = rows.find((r) => r.id === id) ?? rows.find((r) => r.balance_due_cents > 0) ?? rows[0];
  const recent = (lastGrns ?? []).filter((g) => g.supplier_id === sel?.id).slice(0, 5);
  const canManage = hasPerm(ctx.member.perms, 'supplier.manage');
  const canOrder = hasPerm(ctx.member.perms, 'grn.post');

  return (
    <>
      <PageHeader title="Suppliers" subtitle={`${rows.length} suppliers · ${formatRs(rows.reduce((s, r) => s + r.balance_due_cents, 0), { decimals: 0 })} payable`}
        actions={canManage ? <AddSupplierButton /> : null} />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <Table>
            <thead><tr><TH>Supplier</TH><TH>Contact</TH><TH>Type</TH><TH>Payable</TH><TH>Last GRN</TH><TH>Actions</TH></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={s.id === sel?.id ? 'bg-brand-light/40' : undefined}>
                  <TD className="font-medium">{s.name}</TD>
                  <TD className="tabular-nums">{showPhone(s.phone) ?? s.email ?? '—'}</TD>
                  <TD>{s.is_sale_or_return ? <Badge tone="brand">Sale-or-return</Badge> : s.daily_delivery ? <Badge tone="info">Daily delivery</Badge> : <Badge>Regular</Badge>}</TD>
                  <TD className="tabular-nums">{formatRs(s.balance_due_cents, { decimals: 0 })}</TD>
                  <TD>{last.has(s.id) ? dm(last.get(s.id)!) : '—'}</TD>
                  <TD>
                    <span className="flex gap-3 text-xs font-semibold">
                      <Link href={`/backoffice/suppliers?id=${s.id}`} className="text-brand-primary hover:underline">View</Link>
                      {canManage && s.balance_due_cents > 0 ? <Link href={`/backoffice/purchasing/payments?supplier=${s.id}`} className="text-brand-primary hover:underline">Pay</Link> : null}
                    </span>
                  </TD>
                </tr>
              ))}
              {rows.length === 0 ? <EmptyRow colSpan={6}>No suppliers yet.</EmptyRow> : null}
            </tbody>
          </Table>
        </div>
        {sel ? (
          <Card className="flex flex-col gap-3 p-5 xl:w-[360px]">
            <CardTitle>{sel.name}</CardTitle>
            <Line label="Contact" value={[sel.contact_name, showPhone(sel.phone)].filter(Boolean).join(' · ') || sel.email || '—'} />
            <Line label="Terms" value={sel.payment_terms_days ? `Credit ${sel.payment_terms_days} days` : 'Cash on delivery'} />
            <Line label="VAT no." value={sel.vat_no ?? '—'} />
            <div className="border-t border-border pt-3">
              <p className="text-xs text-text-muted">Balance payable</p>
              <p className={`text-2xl font-bold ${sel.balance_due_cents > 0 ? 'text-danger' : ''}`}>{formatRs(sel.balance_due_cents, { decimals: 0 })}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {canManage ? <Link href={`/backoffice/purchasing/payments?supplier=${sel.id}`} className={buttonClass('primary')}>Pay supplier</Link> : null}
              {canOrder ? <Link href={`/backoffice/purchasing/orders/new?supplier=${sel.id}`} className={buttonClass('secondary')}>New PO</Link> : null}
            </div>
            <Link href={`/backoffice/purchasing/returns/new?supplier=${sel.id}`} className={buttonClass('soft')}>Return goods / damaged</Link>
            <p className="text-[13px] font-semibold">Recent GRNs</p>
            {recent.map((g) => (
              <Link key={g.id} href={`/backoffice/purchasing/grn/${g.id}`} className="flex justify-between text-[13px] hover:underline">
                <span className="text-text-muted">{g.grn_no} · {fmtDate(g.received_on)}</span><span className="font-semibold tabular-nums">{formatRs(g.total_cents, { decimals: 0 })}</span>
              </Link>
            ))}
            {recent.length === 0 ? <p className="text-xs text-text-muted">No deliveries yet.</p> : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 text-[13px]"><span className="text-text-muted">{label}</span><span className="text-right font-medium">{value}</span></div>;
}
