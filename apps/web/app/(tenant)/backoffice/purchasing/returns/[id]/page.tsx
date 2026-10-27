import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatRs, hasPerm } from '@laneos/core';
import { Badge, Card, CardTitle, PageHeader, Table, TD, TH, buttonClass } from '@laneos/ui';
import { SupplierReturnAnswer } from '@/components/backoffice/SupplierReturnForms';
import { fmtDateTime } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Supplier return' };

const STATUS = { sent: ['Waiting for supplier', 'warning'], credited: ['Credited', 'success'], rejected: ['Refused', 'danger'] } as const;

export default async function SupplierReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  const { data: r } = await ctx.supabase.from('supplier_returns')
    .select('*, supplier:suppliers(id, name), supplier_return_lines(id, qty_milli, unit_cost_cents, line_cents, damage_report_id, item:items(name, item_type), report:damage_reports(report_no))')
    .eq('id', id).maybeSingle();
  if (!r) notFound();
  const [text, tone] = STATUS[r.status];
  return (
    <>
      <PageHeader title={r.return_no} subtitle={<span className="flex items-center gap-2">{r.supplier?.name}<Badge tone={tone}>{text}</Badge></span>}
        actions={<Link href="/backoffice/purchasing/returns" className={buttonClass('secondary')}>All returns</Link>} />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <Table>
            <thead><tr><TH>Item</TH><TH>From</TH><TH className="text-right">Quantity</TH><TH className="text-right">Cost</TH><TH className="text-right">Value</TH></tr></thead>
            <tbody>
              {r.supplier_return_lines.map((l) => (
                <tr key={l.id}>
                  <TD className="font-medium">{l.item?.name}</TD>
                  <TD>{l.damage_report_id ? <Badge tone="warning">Damaged · {l.report?.report_no}</Badge> : <Badge>Sellable stock</Badge>}</TD>
                  <TD className="text-right tabular-nums">{(l.qty_milli / 1000).toLocaleString('en-LK')}{l.item?.item_type === 'weighed' ? ' kg' : ''}</TD>
                  <TD className="text-right tabular-nums">{formatRs(l.unit_cost_cents)}</TD>
                  <TD className="text-right tabular-nums">{formatRs(l.line_cents, { decimals: 0 })}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-text-muted">Sent {fmtDateTime(r.created_at)}{r.note ? ` · ${r.note}` : ''}</p>
        </div>
        <div className="flex flex-col gap-4 xl:w-[340px]">
          <Card className="flex flex-col gap-2 p-5">
            <CardTitle>Value</CardTitle>
            <div className="flex justify-between text-[13px]"><span className="text-text-muted">At cost</span><span className="font-semibold tabular-nums">{formatRs(r.value_cents)}</span></div>
            {r.credit_cents != null ? <div className="flex justify-between text-[13px]"><span className="text-text-muted">Credited</span><span className="font-semibold tabular-nums">{formatRs(r.credit_cents)}</span></div> : null}
            {r.answered_at ? <p className="text-xs text-text-muted">Answered {fmtDateTime(r.answered_at)}{r.answer_note ? ` · ${r.answer_note}` : ''}</p> : null}
          </Card>
          {r.status === 'sent' && hasPerm(ctx.member.perms, 'supplier.manage') ? <SupplierReturnAnswer id={r.id} valueCents={r.value_cents} /> : null}
        </div>
      </div>
    </>
  );
}
