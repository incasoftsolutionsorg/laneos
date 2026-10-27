'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { formatRs } from '@laneos/core';
import { Alert, Button, Card, CardTitle, Field, Input, buttonClass, cn, inputClass, tabClass, tabsClass } from '@laneos/ui';
import { savePromotion, type PromoFormState } from '@/app/(tenant)/backoffice/promotions/actions';

type Kind = 'multi_buy' | 'percent_off' | 'mix_match' | 'threshold';

const KINDS: [Kind, string][] = [['multi_buy', 'Multi-buy'], ['mix_match', 'Mix & match'], ['percent_off', 'Item discount'], ['threshold', 'Spend X']];

export interface PromoValues {
  id?: string; name: string; kind: Kind; buyQty: string; bundlePrice: string; percent: string;
  threshold?: string; discount?: string; membersOnly?: boolean;
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
          {KINDS.map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={tabClass(kind === k)} onClick={() => setKind(k)}>{t}</button>
          ))}
        </div>
        {kind === 'multi_buy' || kind === 'mix_match' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Buy" hint={kind === 'mix_match' ? 'Pieces of any of the chosen items' : 'Pieces of the same item'}><Input name="buyQty" type="number" min={2} max={100} defaultValue={values.buyQty || '3'} /></Field>
            <Field label="For (Rs)" hint="Price of the whole group"><Input name="bundlePrice" defaultValue={values.bundlePrice} inputMode="decimal" placeholder="450.00" /></Field>
          </div>
        ) : kind === 'threshold' ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="When the bill reaches (Rs)" hint="After item promotions"><Input name="threshold" defaultValue={values.threshold} inputMode="decimal" placeholder="5000" /></Field>
            <Field label="Rupees off" hint="Either this"><Input name="discount" defaultValue={values.discount} inputMode="decimal" placeholder="250" /></Field>
            <Field label="or % off" hint="or this"><Input name="percent" type="number" min={0.01} max={100} step="0.01" defaultValue={values.percent} /></Field>
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
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="membersOnly" defaultChecked={values.membersOnly} className="size-4 accent-brand-primary" />
          Loyalty members only (a customer must be on the bill)
        </label>
        <p className="text-xs text-text-muted">Promotions never stack: each item gets its single best deal, mix-and-match replaces item deals only when it saves more, and one spend-X discount applies to the bill (BR-021).</p>
      </Card>

      {kind === 'threshold' ? null : <Card className="flex flex-col gap-3 p-5">
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
      </Card>}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : values.id ? 'Save promotion' : 'Create promotion'}</Button>
        <Link href="/backoffice/promotions" className={buttonClass('secondary')}>Cancel</Link>
      </div>
    </form>
  );
}
