'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { formatRs } from '@laneos/core';
import { Alert, Button, Card, CardTitle, Field, Input, Select, cn } from '@laneos/ui';
import { cancelPriceSchedule, savePriceSchedule, setShopPrice } from '@/app/(tenant)/backoffice/pricing/actions';
import { ItemSearch } from './ItemSearch';

type Msg = { tone: 'danger' | 'success'; text: string } | null;
export interface PShop { id: string; code: string; name: string }
export interface PItem { id: string; name: string; barcodes: string[]; plu: number | null; centralCents: number | null; mrpCents: number | null }

/** One item's central price and each shop's price (override or central). */
export function ItemPriceEditor({ item, shops, overrides }: { item: PItem; shops: PShop[]; overrides: Record<string, number> }) {
  const router = useRouter();
  const [central, setCentral] = useState(item.centralCents == null ? '' : String(item.centralCents / 100));
  const [shopText, setShopText] = useState<Record<string, string>>(() => Object.fromEntries(shops.map((s) => [s.id, overrides[s.id] != null ? String(overrides[s.id]! / 100) : ''])));
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string; ok?: string }>) => start(async () => {
    const r = await fn();
    setMsg(r.error ? { tone: 'danger', text: r.error } : { tone: 'success', text: r.ok! });
    if (!r.error) router.refresh();
  });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <CardTitle>{item.name}</CardTitle>
        <p className="text-xs text-text-muted">{item.mrpCents ? `MRP ${formatRs(item.mrpCents)} · ` : ''}Changes go to every lane on its next catalogue refresh and put shelf labels in the print queue.</p>
      </div>
      <div className="flex items-end gap-3">
        <Field label="Central price (all shops without their own)" className="flex-1"><Input value={central} onChange={(e) => setCentral(e.target.value)} inputMode="decimal" /></Field>
        <Button disabled={pending} onClick={() => run(() => savePriceSchedule(`Price change · ${item.name}`, 'now', [{ itemId: item.id, shopId: null, priceText: central }]))}>Change now</Button>
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-xs font-semibold">Shop prices</p>
        {shops.map((s) => {
          const has = overrides[s.id] != null;
          return (
            <div key={s.id} className="flex items-center gap-3">
              <span className="w-40 text-[13px]"><span className="font-semibold">{s.code}</span> · {s.name}</span>
              <div className="w-32"><Input value={shopText[s.id] ?? ''} placeholder={item.centralCents == null ? '' : `Central ${item.centralCents / 100}`} inputMode="decimal"
                onChange={(e) => setShopText({ ...shopText, [s.id]: e.target.value })} aria-label={`Price at ${s.name}`} /></div>
              <Button variant="secondary" disabled={pending || !shopText[s.id]} onClick={() => run(() => setShopPrice(s.id, item.id, shopText[s.id]!))}>Set</Button>
              {has ? <button type="button" disabled={pending} className="text-xs font-semibold text-danger hover:underline" onClick={() => run(() => setShopPrice(s.id, item.id, null))}>Use central</button> : null}
            </div>
          );
        })}
      </div>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
    </Card>
  );
}

export function ClearOverride({ shopId, itemId }: { shopId: string; itemId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} className="text-xs font-semibold text-danger hover:underline"
      onClick={() => start(async () => { await setShopPrice(shopId, itemId, null); router.refresh(); })}>
      {pending ? 'Clearing…' : 'Use central'}
    </button>
  );
}

interface SLine { item: PItem; shopId: string; price: string }

/** New scheduled price change (WF-007): name, start, items × (all shops | one shop) × new price. */
export function ScheduleForm({ items, shops, minStart }: { items: PItem[]; shops: PShop[]; minStart: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState(minStart);
  const [lines, setLines] = useState<SLine[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="flex flex-col gap-3 p-5">
      <CardTitle>Schedule a price change</CardTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Avurudu prices" maxLength={80} /></Field>
        <Field label="Starts (Sri Lanka time)"><Input type="datetime-local" value={startsAt} min={minStart} onChange={(e) => setStartsAt(e.target.value)} /></Field>
      </div>
      <ItemSearch items={items} onPick={(item) => setLines((ls) => [...ls, { item, shopId: '', price: item.centralCents == null ? '' : String(item.centralCents / 100) }])} />
      {lines.map((l, i) => (
        <div key={`${l.item.id}-${i}`} className="flex items-center gap-3">
          <span className="flex-1 text-[13px]">{l.item.name}<span className="block text-[11px] text-text-muted">now {l.item.centralCents == null ? '—' : formatRs(l.item.centralCents)}</span></span>
          <div className="w-40"><Select value={l.shopId} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, shopId: e.target.value } : x)))} aria-label="Shops">
            <option value="">All shops (central)</option>
            {shops.map((s) => <option key={s.id} value={s.id}>{s.code} only</option>)}
          </Select></div>
          <div className="w-28"><Input value={l.price} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} inputMode="decimal" aria-label="New price" /></div>
          <button type="button" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="p-1 text-text-muted hover:text-danger"><Trash2 size={14} /></button>
        </div>
      ))}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Button className="w-fit" disabled={pending || !lines.length} onClick={() => start(async () => {
        const r = await savePriceSchedule(name, startsAt, lines.map((l) => ({ itemId: l.item.id, shopId: l.shopId || null, priceText: l.price })));
        setMsg(r.error ? { tone: 'danger', text: r.error } : { tone: 'success', text: r.ok! });
        if (!r.error) { setLines([]); setName(''); router.refresh(); }
      })}>{pending ? 'Saving…' : 'Schedule'}</Button>
    </Card>
  );
}

export function CancelSchedule({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} className={cn('text-xs font-semibold text-danger hover:underline', pending && 'opacity-50')}
      onClick={() => start(async () => { await cancelPriceSchedule(id); router.refresh(); })}>Cancel</button>
  );
}
