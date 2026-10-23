import type { Metadata } from 'next';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { formatRs, formatStock, hasPerm, type ItemType } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH, buttonClass, chipClass, cn, inputClass, type Tone } from '@laneos/ui';
import { requireTenant } from '@/lib/server/context';
import { deactivateItem } from './actions';

export const metadata: Metadata = { title: 'Inventory' };

interface Row {
  id: string; name: string; itemType: ItemType; plu: number | null; barcode: string | null; department: string | null;
  priceCents: number | null; qtyMilli: number; damagedMilli: number; reorderLevelMilli: number;
}

const FILTERS = [
  ['all', 'All'], ['low', 'Low stock'], ['out', 'Out of stock'], ['damaged', 'Damaged'], ['weighed', 'Weighed'],
] as const;
const PAGE = 25;

function status(r: Row): { tone: Tone; text: string } {
  if (r.damagedMilli > 0) return { tone: 'danger', text: `Damaged ${formatStock(r.damagedMilli, r.itemType)}` };
  if (r.itemType !== 'open_price' && r.qtyMilli <= 0) return { tone: 'neutral', text: 'Out of stock' };
  if (r.reorderLevelMilli > 0 && r.qtyMilli <= r.reorderLevelMilli) return { tone: 'warning', text: 'Low stock' };
  if (r.itemType === 'weighed') return { tone: 'info', text: 'Weighed' };
  return { tone: 'success', text: 'In stock' };
}

export default async function InventoryPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; filter?: string; page?: string }> }) {
  const ctx = await requireTenant();
  const { q = '', filter = 'all', page = '1' } = await searchParams;
  const pageNo = Math.max(1, Number(page) || 1);

  const { data, error } = await ctx.supabase.schema('api').rpc('list_items', {
    p_shop: ctx.shop.id, p_search: q, p_filter: filter, p_limit: PAGE, p_offset: (pageNo - 1) * PAGE,
  });
  if (error) throw new Error(error.message);
  const { total, rows } = data as unknown as { total: number; rows: Row[] };
  const canEdit = hasPerm(ctx.member.perms, 'item.edit');

  const href = (p: Record<string, string | number>) => {
    const params = new URLSearchParams({ q, filter, page: String(pageNo), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) });
    if (!params.get('q')) params.delete('q');
    if (params.get('filter') === 'all') params.delete('filter');
    if (params.get('page') === '1') params.delete('page');
    const s = params.toString();
    return `/backoffice/items${s ? `?${s}` : ''}`;
  };

  const first = total === 0 ? 0 : (pageNo - 1) * PAGE + 1;
  const last = Math.min(pageNo * PAGE, total);

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle={`${total.toLocaleString('en-US')} ${filter === 'all' ? 'items' : 'matching items'} · ${ctx.shop.name}`}
        actions={canEdit ? (
          <div className="flex gap-3">
            <Link href="/backoffice/labels" className={buttonClass('secondary')}>Labels</Link>
            <Link href="/backoffice/stock/counts" className={buttonClass('secondary')}>Stock count</Link>
            <Link href="/backoffice/items/import" className={buttonClass('secondary')}>Import CSV</Link>
            <Link href="/backoffice/items/new" className={buttonClass('primary')}>+ Add item</Link>
          </div>
        ) : null}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <form action="/backoffice/items" className="relative w-full sm:w-[340px]">
          <Search size={16} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-text-placeholder" aria-hidden />
          {filter !== 'all' ? <input type="hidden" name="filter" value={filter} /> : null}
          <input name="q" defaultValue={q} placeholder="Search items, PLU or barcode" aria-label="Search items" className={cn(inputClass, 'pl-9')} />
        </form>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([key, text]) => (
            <Link key={key} href={href({ filter: key, page: 1 })} className={chipClass(filter === key)} aria-current={filter === key ? 'true' : undefined}>
              {text}
            </Link>
          ))}
        </div>
      </div>

      <Table>
        <thead>
          <tr>
            <TH>Item</TH><TH>Barcode / PLU</TH><TH>Category</TH><TH>Price</TH><TH>Stock</TH><TH>Damaged</TH><TH>Status</TH>
            {canEdit ? <TH>Actions</TH> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = status(r);
            return (
              <tr key={r.id}>
                <TD className="font-medium">{r.name}</TD>
                <TD className="tabular-nums">{r.barcode ?? (r.plu ? `PLU ${String(r.plu).padStart(5, '0')}` : '—')}</TD>
                <TD>{r.department ?? '—'}</TD>
                <TD className="tabular-nums whitespace-nowrap">
                  {r.priceCents == null ? '—' : `${formatRs(r.priceCents, { decimals: r.priceCents % 100 ? 2 : 0 })}${r.itemType === 'weighed' ? '/kg' : ''}`}
                </TD>
                <TD className="tabular-nums">{r.itemType === 'open_price' ? '—' : formatStock(r.qtyMilli, r.itemType)}</TD>
                <TD className="tabular-nums">{formatStock(r.damagedMilli, r.itemType)}</TD>
                <TD><Badge tone={s.tone}>{s.text}</Badge></TD>
                {canEdit ? (
                  <TD>
                    <div className="flex gap-3 text-xs font-semibold">
                      <Link href={`/backoffice/items/${r.id}`} className="text-brand-primary hover:underline">Edit</Link>
                      <form action={deactivateItem}>
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit" className="text-danger hover:underline">Remove</button>
                      </form>
                    </div>
                  </TD>
                ) : null}
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <EmptyRow colSpan={canEdit ? 8 : 7}>
              {q || filter !== 'all' ? 'No items match.' : 'No items yet. Add your first item to start selling.'}
            </EmptyRow>
          ) : null}
        </tbody>
      </Table>

      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-text-muted">Showing {first}–{last} of {total.toLocaleString('en-US')}</p>
        {pageNo > 1 ? <Link href={href({ page: pageNo - 1 })} className={buttonClass('secondary')}>Previous</Link> : null}
        {last < total ? <Link href={href({ page: pageNo + 1 })} className={buttonClass('secondary')}>Next</Link> : null}
      </div>
    </>
  );
}
