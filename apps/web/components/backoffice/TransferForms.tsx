'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Alert, Button, Card, CardTitle, Field, Input, Select } from '@laneos/ui';
import { requestTransfer, transferAction } from '@/app/(tenant)/backoffice/transfers/actions';
import { ItemSearch } from './ItemSearch';

export interface TItem { id: string; name: string; barcodes: string[]; plu: number | null; weighed: boolean }
interface Line { item: TItem; qty: string }

const toMilli = (qty: string) => Math.round(Number(qty) * 1000);
const unit = (w: boolean) => (w ? 'kg' : 'pcs');

/** New transfer request (Figma 3-1283, not read): the receiving shop asks another shop for stock. */
export function TransferRequest({ shops, items, toShopId, preset }: {
  shops: { id: string; code: string; name: string }[]; items: TItem[]; toShopId: string; preset?: { itemId: string; fromShopId?: string };
}) {
  const router = useRouter();
  const [to, setTo] = useState(toShopId);
  const [from, setFrom] = useState(preset?.fromShopId ?? shops.find((s) => s.id !== toShopId)?.id ?? '');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>(() => {
    const it = items.find((i) => i.id === preset?.itemId);
    return it ? [{ item: it, qty: '' }] : [];
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card className="flex max-w-3xl flex-col gap-4 p-5">
      <CardTitle>Request stock</CardTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From (sends)"><Select value={from} onChange={(e) => setFrom(e.target.value)}>{shops.filter((s) => s.id !== to).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select></Field>
        <Field label="To (receives)"><Select value={to} onChange={(e) => setTo(e.target.value)}>{shops.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select></Field>
      </div>
      <ItemSearch items={items} exclude={new Set(lines.map((l) => l.item.id))} onPick={(item) => setLines((ls) => [...ls, { item, qty: '' }])} />
      <div className="flex flex-col gap-2">
        {lines.map((l, i) => (
          <div key={l.item.id} className="flex items-center gap-3">
            <span className="flex-1 text-[13px] font-medium">{l.item.name}</span>
            <div className="w-28"><Input value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} inputMode="decimal" placeholder="0" aria-label={`Quantity of ${l.item.name}`} /></div>
            <span className="w-8 text-xs text-text-muted">{unit(l.item.weighed)}</span>
            <button type="button" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="p-1 text-text-muted hover:text-danger"><Trash2 size={14} /></button>
          </div>
        ))}
        {lines.length === 0 ? <p className="text-xs text-text-muted">Search for the items you need.</p> : null}
      </div>
      <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Weekend promotion stock" /></Field>
      {error ? <Alert>{error}</Alert> : null}
      <Button className="w-fit" disabled={pending || !lines.length || !from} onClick={() => start(async () => {
        setError(null);
        const r = await requestTransfer({ fromShopId: from, toShopId: to, note, lines: lines.map((l) => ({ itemId: l.item.id, qtyMilli: toMilli(l.qty) })) });
        if (r.error) return setError(r.error);
        router.push(`/backoffice/transfers/${r.id}`);
      })}>{pending ? 'Sending…' : 'Send request'}</Button>
    </Card>
  );
}

export interface TLine { itemId: string; name: string; weighed: boolean; requested: number; sent: number | null; received: number | null }

/** The step the current user can take on a transfer: approve/reject, dispatch, receive, close, cancel. */
export function TransferSteps({ id, status, lines, can }: {
  id: string; status: string; lines: TLine[];
  can: { approve: boolean; dispatch: boolean; receive: boolean; cancel: boolean };
}) {
  const router = useRouter();
  const step = status === 'approved' && can.dispatch ? 'dispatch' : status === 'in_transit' && can.receive ? 'receive' : null;
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.itemId, String((step === 'receive' ? l.sent ?? l.requested : l.requested) / 1000)])));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (action: string, body: Parameters<typeof transferAction>[2] = {}) => start(async () => {
    setError(null);
    const r = await transferAction(id, action, body);
    if (r.error) setError(r.error); else router.refresh();
  });
  const qtyLines = () => lines.map((l) => ({ itemId: l.itemId, qtyMilli: toMilli(qty[l.itemId] ?? '0') }));

  const actions: React.ReactNode[] = [];
  if (status === 'requested' && can.approve) {
    actions.push(<Button key="a" disabled={pending} onClick={() => run('approve')}>Approve</Button>);
    actions.push(<Button key="r" variant="danger" disabled={pending} onClick={() => run('reject', { note })}>Reject</Button>);
  }
  if (step === 'dispatch') actions.push(<Button key="d" disabled={pending} onClick={() => run('dispatch', { lines: qtyLines() })}>Dispatch (stock leaves this shop)</Button>);
  if (step === 'receive') actions.push(<Button key="rc" disabled={pending} onClick={() => run('receive', { lines: qtyLines(), note })}>Receive (stock enters this shop)</Button>);
  if (status === 'received_with_variance' && can.approve) actions.push(<Button key="c" disabled={pending || note.length < 3} onClick={() => run('close', { note })}>Accept variance & close</Button>);
  if ((status === 'requested' || status === 'approved') && can.cancel) actions.push(<Button key="x" variant="secondary" disabled={pending} onClick={() => run('cancel')}>Cancel transfer</Button>);
  if (!actions.length) return null;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <CardTitle>{step === 'dispatch' ? 'Dispatch' : step === 'receive' ? 'Receive' : 'Next step'}</CardTitle>
      {step ? (
        <div className="flex flex-col gap-2">
          {lines.map((l) => (
            <div key={l.itemId} className="flex items-center gap-3">
              <span className="flex-1 text-[13px]">{l.name}</span>
              <span className="text-xs text-text-muted">{step === 'receive' ? 'sent' : 'asked'} {((step === 'receive' ? l.sent ?? 0 : l.requested) / 1000).toLocaleString('en-LK')}</span>
              <div className="w-24"><Input value={qty[l.itemId] ?? ''} onChange={(e) => setQty({ ...qty, [l.itemId]: e.target.value })} inputMode="decimal" aria-label={`${step} quantity of ${l.name}`} /></div>
              <span className="w-8 text-xs text-text-muted">{unit(l.weighed)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {status === 'requested' || step === 'receive' || status === 'received_with_variance' ? (
        <Field label={status === 'received_with_variance' ? 'Why do the quantities differ?' : 'Note (optional)'}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">{actions}</div>
    </Card>
  );
}
