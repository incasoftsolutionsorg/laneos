import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyRow, Input, PageHeader, Select, Table, TD, TH, chipClass, cn } from '@laneos/ui';
import { ChainUpgrade } from '@/components/backoffice/ChainUpgrade';
import { requireChain } from '@/lib/chain';

export const metadata: Metadata = { title: 'Stock across shops' };

interface Row { id: string; name: string; itemType: string; reorderMilli: number; shops: Record<string, number> }

const qty = (m: number, weighed: boolean) => (weighed ? `${(m / 1000).toFixed(1)} kg` : (m / 1000).toLocaleString('en-LK', { maximumFractionDigits: 0 }));

// Stock across shops (Figma 3-1035, not read — built from blueprint E.2; compare when Figma access returns).
export default async function StockAcrossShopsPage({ searchParams }: { searchParams: Promise<{ q?: string; dept?: string; low?: string }> }) {
  const { q = '', dept = '', low } = await searchParams;
  const { ctx, enabled } = await requireChain('stock.adjust');
  if (!enabled) return <ChainUpgrade title="Stock across shops" />;
  const [{ data }, { data: shops }, { data: depts }] = await Promise.all([
    ctx.supabase.schema('api').rpc('stock_across_shops', { p_search: q, p_department: (dept || null) as string, p_low_only: !!low }),
    ctx.supabase.from('shops').select('id, code, name').eq('is_active', true).order('code'),
    ctx.supabase.from('departments').select('id, name').eq('is_active', true).order('name'),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const base = (extra: Record<string, string>) => `/backoffice/stock-across-shops?${new URLSearchParams({ ...(q ? { q } : {}), ...(dept ? { dept } : {}), ...extra })}`;

  return (
    <>
      <PageHeader title="Stock across shops" subtitle="Sellable stock per shop. Red = at or below the re-order level; ask a shop with spare stock for a transfer." />
      <form className="flex flex-wrap items-center gap-3">
        <div className="w-72"><Input name="q" defaultValue={q} placeholder="Search item or barcode" aria-label="Search items" /></div>
        <div className="w-52"><Select name="dept" defaultValue={dept} aria-label="Department"><option value="">All departments</option>{(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
        {low ? <input type="hidden" name="low" value="1" /> : null}
        <button type="submit" className={chipClass(false)}>Apply</button>
        <Link href={low ? base({}) : base({ low: '1' })} className={chipClass(!!low)}>Low stock only</Link>
      </form>
      <Table>
        <thead><tr><TH>Item</TH>{(shops ?? []).map((s) => <TH key={s.id} className="text-right">{s.code}</TH>)}<TH className="text-right">Total</TH><TH /></tr></thead>
        <tbody>
          {rows.map((r) => {
            const w = r.itemType === 'weighed';
            const total = Object.values(r.shops).reduce((a, b) => a + b, 0);
            const short = (shops ?? []).find((s) => (r.shops[s.id] ?? 0) <= r.reorderMilli && r.reorderMilli > 0);
            const spare = short ? (shops ?? []).filter((s) => s.id !== short.id).sort((a, b) => (r.shops[b.id] ?? 0) - (r.shops[a.id] ?? 0))[0] : undefined;
            return (
              <tr key={r.id}>
                <TD className="font-medium">{r.name}</TD>
                {(shops ?? []).map((s) => {
                  const v = r.shops[s.id] ?? 0;
                  return <TD key={s.id} className={cn('text-right tabular-nums', v < 0 ? 'font-semibold text-danger' : r.reorderMilli > 0 && v <= r.reorderMilli ? 'text-danger' : '')}>{qty(v, w)}</TD>;
                })}
                <TD className="text-right font-semibold tabular-nums">{qty(total, w)}</TD>
                <TD className="text-right">
                  {short && spare && (r.shops[spare.id] ?? 0) > r.reorderMilli ? (
                    <Link href={`/backoffice/transfers/new?item=${r.id}&from=${spare.id}`} className="text-xs font-semibold text-brand-primary hover:underline">Transfer from {spare.code}</Link>
                  ) : null}
                </TD>
              </tr>
            );
          })}
          {rows.length === 0 ? <EmptyRow colSpan={(shops ?? []).length + 3}>{q || low ? 'Nothing matches.' : 'No items yet.'}</EmptyRow> : null}
        </tbody>
      </Table>
      {rows.length === 200 ? <p className="text-xs text-text-muted">Showing the first 200 items — search to narrow down.</p> : null}
    </>
  );
}
