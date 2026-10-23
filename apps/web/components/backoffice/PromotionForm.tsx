'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { formatRs } from '@laneos/core';
import { Alert, Button, Card, CardTitle, Field, Input, buttonClass, cn, inputClass, tabClass, tabsClass } from '@laneos/ui';
import { savePromotion, type PromoFormState } from '@/app/(tenant)/backoffice/promotions/actions';

export interface PromoValues {
  id?: string; name: string; kind: 'multi_buy' | 'percent_off'; buyQty: string; bundlePrice: string; percent: string;
  startsOn: string; endsOn: string; isActive: boolean; itemIds: string[];
}

export function PromotionForm({ values, items }: { values: PromoValues; items: { id: string; name: string; priceCents: number | null }[] }) {
  const [state, action, pending] = useActionState(savePromotion, {} as PromoFormState);
  const [kind, setKind] = useState(values.kind);
  const [chosen, setChosen] = useState(new Set(values.itemIds));
  const [q, setQ] = useState('');
  const [active, setActive] = useState(values.isActive);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => chosen.has(i.id) || !s || i.name.toLowerCase().includes(s)).slice(0, 200);
  }, [items, q, chosen]);

  return (
    <form action={action} className="flex max-w-[960px] flex-col gap-4">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <input type="hidden" name="kind" value={kind} />
      {active ? <input type="hidden" name="isActive" value="on" /> : null}
      {[...chosen].map((id) => <input key={id} type="hidden" name="itemIds" value={id} />)}
      {state.error ? <Alert>{state.error}</Alert> : null}

      <Card className="flex flex-col gap-4 p-5">
        <CardTitle>Promotion</CardTitle>
        <Field label="Name on receipt and display"><Input name="name" defaultValue={values.name} required maxLength={80} placeholder="3 Prima breads for Rs 450" /></Field>
        <div className={tabsClass()} role="tablist" aria-label="Type">
          <button type="button" role="tab" aria-selected={kind === 'multi_buy'} className={tabClass(kind === 'multi_buy')} onClick={() => setKind('multi_buy')}>Multi-buy</button>
          <button type="button" role="tab" aria-selected={kind === 'percent_off'} className={tabClass(kind === 'percent_off')} onClick={() => setKind('percent_off')}>Item discount</button>
        </div>
        {kind === 'multi_buy' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Buy" hint="Pieces of the same item"><Input name="buyQty" type="number" min={2} max={100} defaultValue={values.buyQty || '3'} /></Field>
            <Field label="For (Rs)" hint="Price of the whole group"><Input name="bundlePrice" defaultValue={values.bundlePrice} inputMode="decimal" placeholder="450.00" /></Field>
          </div>
        ) : (
          <Field label="Discount (%)" hint="Off each chosen item"><Input name="percent" type="number" min={0.01} max={100} step="0.01" defaultValue={values.percent || '5'} className="sm:w-48" /></Field>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Starts"><Input name="startsOn" type="date" defaultValue={values.startsOn} /></Field>
          <Field label="Ends" hint="Leave empty to run until stopped"><Input name="endsOn" type="date" defaultValue={values.endsOn} /></Field>
          <label className="flex items-center gap-2 self-center text-[13px] font-semibold">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-brand-primary" /> Active
          </label>
        </div>
        <p className="text-xs text-text-muted">When several promotions cover an item, the customer gets the single best one (BR-021).</p>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Items · {chosen.size} chosen</CardTitle>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items" aria-label="Search items" className={cn(inputClass, 'max-w-xs py-2')} />
        </div>
        <ul className="grid max-h-[360px] gap-1 overflow-y-auto sm:grid-cols-2">
          {shown.map((i) => (
            <li key={i.id}>
              <label className={cn('flex items-center gap-2 rounded-control px-2 py-1.5 text-[13px] hover:bg-surface-muted', chosen.has(i.id) && 'bg-brand-light')}>
                <input type="checkbox" checked={chosen.has(i.id)} className="size-4 accent-brand-primary"
                  onChange={(e) => setChosen((s) => { const n = new Set(s); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} />
                <span className="flex-1 truncate">{i.name}</span>
                <span className="text-xs text-text-muted tabular-nums">{i.priceCents != null ? formatRs(i.priceCents) : ''}</span>
              </label>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : values.id ? 'Save promotion' : 'Create promotion'}</Button>
        <Link href="/backoffice/promotions" className={buttonClass('secondary')}>Cancel</Link>
      </div>
    </form>
  );
}
