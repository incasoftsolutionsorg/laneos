'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, CardTitle, Field, Input } from '@laneos/ui';
import { Dialog } from '@/components/lane/Dialog';
import { addShop, setShopActive, updateShop } from '@/app/(tenant)/backoffice/shops/actions';

type Msg = { tone: 'danger' | 'success'; text: string } | null;

export function AddShopButton({ open: startOpen = false }: { open?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [v, setV] = useState({ code: '', name: '', address: '', phone: '' });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add shop</Button>
      {open ? (
        <Dialog title="Add shop" onClose={() => setOpen(false)} width={480}>
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <Field label="Code" hint="On invoice numbers"><Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase().slice(0, 8) })} placeholder="CMB2" autoFocus /></Field>
            <Field label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Colombo 7" maxLength={120} /></Field>
          </div>
          <Field label="Address"><Input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} maxLength={300} /></Field>
          <Field label="Phone"><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} inputMode="tel" placeholder="011 222 3344" /></Field>
          <p className="text-xs text-text-muted">The shop starts with lane L1, every item at the central price, and shelf labels in its print queue.</p>
          {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await addShop(v);
            if (r.error) return setMsg({ tone: 'danger', text: r.error });
            setOpen(false);
            router.push(`/backoffice/shops/${r.id}`);
            router.refresh();
          })}>{pending ? 'Adding…' : 'Add shop'}</Button>
        </Dialog>
      ) : null}
    </>
  );
}

export function ShopEditor({ shop, canManage }: { shop: { id: string; name: string; address: string; phone: string; isActive: boolean }; canManage: boolean }) {
  const router = useRouter();
  const [v, setV] = useState({ name: shop.name, address: shop.address, phone: shop.phone });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string; ok?: string }>) => start(async () => {
    const r = await fn();
    setMsg(r.error ? { tone: 'danger', text: r.error } : { tone: 'success', text: r.ok! });
    if (!r.error) router.refresh();
  });
  return (
    <Card className="flex flex-col gap-3 p-5">
      <CardTitle>Shop details</CardTitle>
      <Field label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} disabled={!canManage} /></Field>
      <Field label="Address"><Input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} disabled={!canManage} /></Field>
      <Field label="Phone"><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} disabled={!canManage} /></Field>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => run(() => updateShop(shop.id, v))}>Save</Button>
          <Button variant={shop.isActive ? 'danger' : 'secondary'} disabled={pending}
            onClick={() => { if (!shop.isActive || window.confirm('Close this shop? It stops selling; its history stays.')) run(() => setShopActive(shop.id, !shop.isActive)); }}>
            {shop.isActive ? 'Close shop' : 'Reopen shop'}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
