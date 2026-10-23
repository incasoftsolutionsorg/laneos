'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, CardTitle, Field, Input } from '@laneos/ui';
import { saveShop } from '@/app/(tenant)/backoffice/settings/actions';

const showPhone = (p: string) => p.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3');

/** The current shop's name, address and phone — printed on receipts and A4 documents. */
export function ShopDetails({ shop, code, readOnly }: { shop: { name: string; address: string; phone: string }; code: string; readOnly: boolean }) {
  const router = useRouter();
  const [v, setV] = useState({ ...shop, phone: showPhone(shop.phone) });
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="flex flex-col gap-4 p-5">
      <CardTitle>Shop {code}</CardTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Shop name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} disabled={readOnly} /></Field>
        <Field label="Phone"><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} inputMode="tel" placeholder="081 222 3344" disabled={readOnly} /></Field>
        <Field label="Address" className="md:col-span-2"><Input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} maxLength={300} disabled={readOnly} /></Field>
      </div>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      {!readOnly ? (
        <Button variant="secondary" className="w-fit" disabled={pending} onClick={() => start(async () => {
          const r = await saveShop(v);
          setMsg(r.error ? { tone: 'danger', text: r.error } : { tone: 'success', text: r.ok! });
          if (!r.error) router.refresh();
        })}>{pending ? 'Saving…' : 'Save shop details'}</Button>
      ) : null}
    </Card>
  );
}
