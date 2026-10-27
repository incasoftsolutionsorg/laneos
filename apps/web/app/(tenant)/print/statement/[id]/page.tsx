import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatRs } from '@laneos/core';
import { A4, A4Header } from '@/components/print/A4';
import { fmtDate } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';
import { publicUrl } from '@/lib/storage';

export const metadata: Metadata = { title: 'Customer statement' };

const KIND = { sale: 'Sale on account', payment: 'Payment', return: 'Return credit', adjustment: 'Adjustment' } as const;

// Customer statement (Figma 1-3034 "Print statement"): every ledger line with a running balance.
export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant('customer.manage');
  const [{ data: c }, { data: lines }, { data: shop }, { data: tenant }] = await Promise.all([
    ctx.supabase.from('customers').select('id, name, phone, credit_limit_cents, balance_due_cents').eq('id', id).maybeSingle(),
    ctx.supabase.from('customer_ledger').select('id, kind, amount_cents, note, created_at').eq('customer_id', id).order('created_at').order('id').limit(1000),
    ctx.supabase.from('shops').select('name, address, phone').eq('id', ctx.shop.id).single(),
    ctx.supabase.from('tenants').select('vat_no, customer_credit_days').eq('id', ctx.tenant.id).single(),
  ]);
  if (!c) notFound();
  let running = 0;
  const rows = (lines ?? []).map((l) => ({ ...l, balance: (running += l.amount_cents) }));

  return (
    <A4>
      <A4Header
        logoUrl={publicUrl(ctx.tenant.logo_path)}
        tenant={ctx.tenant.name}
        shop={{ name: shop?.name ?? ctx.shop.name, address: shop?.address, phone: shop?.phone }}
        vatNo={tenant?.vat_no}
        title="Statement"
        meta={[['Date', fmtDate(new Date().toISOString())], ['Terms', `${tenant?.customer_credit_days ?? 30} days`]]}
      />
      <section className="flex justify-between">
        <div>
          <p className="text-black/60">Customer</p>
          <p className="text-[14px] font-bold">{c.name}</p>
          <p>{c.phone.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3')}</p>
        </div>
        <div className="text-right">
          <p className="text-black/60">Credit limit</p>
          <p className="font-semibold">{c.credit_limit_cents > 0 ? formatRs(c.credit_limit_cents) : 'Cash only'}</p>
        </div>
      </section>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-black text-[11px] uppercase">
            <th className="py-1.5">Date</th><th>Details</th><th>Reference</th>
            <th className="text-right">Charges</th><th className="text-right">Payments</th><th className="text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-black/15">
              <td className="py-1.5">{fmtDate(r.created_at)}</td>
              <td>{KIND[r.kind]}</td>
              <td className="font-mono text-[11px]">{r.note ?? ''}</td>
              <td className="text-right tabular-nums">{r.amount_cents > 0 ? formatRs(r.amount_cents) : ''}</td>
              <td className="text-right tabular-nums">{r.amount_cents < 0 ? formatRs(-r.amount_cents) : ''}</td>
              <td className="text-right tabular-nums">{formatRs(r.balance)}</td>
            </tr>
          ))}
          {rows.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-black/60">No account activity.</td></tr> : null}
        </tbody>
      </table>
      <div className="ml-auto w-64 border-t-2 border-black pt-2 text-[14px]">
        <div className="flex justify-between font-bold"><span>Balance due</span><span className="tabular-nums">{formatRs(c.balance_due_cents)}</span></div>
      </div>
      <p className="mt-auto text-center text-black/60">Please pay within the agreed terms. Thank you for your business.</p>
    </A4>
  );
}
