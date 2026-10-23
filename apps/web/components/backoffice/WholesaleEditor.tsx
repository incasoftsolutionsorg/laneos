'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { divRound, formatRs, parseRupees } from '@laneos/core';
import { Alert, Button, Card, CardTitle, Field, Input, Select, cn } from '@laneos/ui';
import { saveWholesale, type WholesaleInput } from '@/app/(tenant)/backoffice/wholesale/actions';
import { ItemSearch } from './ItemSearch';

export interface WsItem {
  id: string; name: string; barcodes: string[]; plu: number | null; taxClass: string;
  listCents: number; wholesaleCents: number | null; packs: number[];
}
export interface WsCustomer { id: string; name: string; phone: string; limitCents: number; balanceCents: number }
interface Line { item: WsItem; packQty: number; qty: number; priceText: string; discText: string }

const packLabel = (n: number) => (n === 1 ? 'Each' : `Case of ${n}`);
const defaultPrice = (i: WsItem, pack: number) => (i.wholesaleCents ?? i.listCents) * pack;

/** Wholesale invoice (Figma 1-1162): sell in cases with wholesale prices and credit terms. Totals here
 *  are a preview; api.save_wholesale recomputes them. */
export function WholesaleEditor({
  items, customers, vat, creditDays, initial,
}: {
  items: WsItem[]; customers: WsCustomer[];
  vat: { registered: boolean; included: boolean; rateBp: number }; creditDays: number;
  initial?: { quotationId: string; customerId: string | null; buyer: { name: string; address: string; vatNo: string; phone: string }; lines: { itemId: string; packQty: number; qty: number; priceCents: number; discountBp: number }[] };
}) {
  const router = useRouter();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [customerId, setCustomerId] = useState(initial?.customerId ?? '');
  const [buyer, setBuyer] = useState(initial?.buyer ?? { name: '', address: '', vatNo: '', phone: '' });
  const [lines, setLines] = useState<Line[]>(() => (initial?.lines ?? []).flatMap((l) => {
    const item = byId.get(l.itemId);
    return item ? [{ item, packQty: l.packQty, qty: l.qty, priceText: String(l.priceCents / 100), discText: l.discountBp ? String(l.discountBp / 100) : '' }] : [];
  }));
  const [cases, setCases] = useState('1');
  const [terms, setTerms] = useState<'cash' | 'credit' | 'cheque'>('credit');
  const [paidText, setPaidText] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string; id?: string } | null>(null);
  const [pending, start] = useTransition();
  const customer = customers.find((c) => c.id === customerId) ?? null;

  const calc = lines.map((l) => {
    const price = parseRupees(l.priceText || '0') ?? 0;
    const bp = Math.round(Number(l.discText || 0) * 100);
    const gross = price * l.qty;
    return { price, bp, gross, total: gross - divRound(gross * bp, 10000) };
  });
  const subtotal = calc.reduce((s, c) => s + c.gross, 0);
  const discount = calc.reduce((s, c) => s + c.gross - c.total, 0);
  const net = subtotal - discount;
  const standardNet = calc.reduce((s, c, i) => s + (lines[i]!.item.taxClass === 'standard' ? c.total : 0), 0);
  const vatCents = !vat.registered ? 0 : vat.included ? divRound(standardNet * vat.rateBp, 10000 + vat.rateBp) : divRound(standardNet * vat.rateBp, 10000);
  const total = net + (vat.registered && !vat.included ? vatCents : 0);
  const paid = terms === 'cash' ? total : Math.min(total, parseRupees(paidText || '0') ?? 0);
  const balance = total - paid;

  const add = (item: WsItem) => {
    const pack = item.packs.at(-1) ?? 1;
    const qty = Math.max(1, Math.floor(Number(cases) || 1));
    setLines((ls) => [...ls, { item, packQty: pack, qty, priceText: String(defaultPrice(item, pack) / 100), discText: '' }]);
    setCases('1');
  };
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = (kind: WholesaleInput['kind']) => start(async () => {
    setMsg(null);
    const r = await saveWholesale({
      kind, customerId: customerId || null,
      buyerName: buyer.name || customer?.name || '', buyerAddress: buyer.address, buyerVatNo: buyer.vatNo, buyerPhone: buyer.phone || customer?.phone || '',
      terms, paidCents: kind === 'invoice' ? paid : 0, chequeNo, note: '', fromQuotationId: kind === 'invoice' ? initial?.quotationId ?? null : null,
      lines: lines.map((l, i) => ({ itemId: l.item.id, packQty: l.packQty, qty: l.qty, priceCents: calc[i]!.price, discountBp: calc[i]!.bp })),
    });
    if (r.error) return setMsg({ tone: 'danger', text: r.error });
    setMsg({ tone: 'success', text: `${kind === 'invoice' ? 'Invoice' : 'Quotation'} ${r.docNo} saved.`, id: r.id });
    window.open(`/print/wholesale/${r.id}`, 'laneos-a4', 'width=900,height=1000');
    setLines([]); setPaidText(''); setChequeNo('');
    router.refresh();
  });

  const busy = pending || !lines.length;
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Card className="flex flex-col gap-3 p-5">
          <CardTitle>Customer</CardTitle>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Credit customer" hint={customer ? `Owes ${formatRs(customer.balanceCents, { decimals: 0 })} · limit ${customer.limitCents ? formatRs(customer.limitCents, { decimals: 0 }) : 'cash only'}` : 'Needed for credit; leave empty for a cash buyer'}>
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— Cash buyer —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Name on invoice"><Input value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} placeholder={customer?.name ?? 'Shop or buyer name'} maxLength={120} /></Field>
            <Field label="Address"><Input value={buyer.address} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} maxLength={300} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Buyer VAT no."><Input value={buyer.vatNo} onChange={(e) => setBuyer({ ...buyer, vatNo: e.target.value })} maxLength={30} /></Field>
              <Field label="Phone"><Input value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} placeholder={customer?.phone.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3')} maxLength={20} /></Field>
            </div>
          </div>
        </Card>
        <div className="flex items-end gap-3">
          <div className="flex-1"><ItemSearch items={items} onPick={add} placeholder="Scan or search item…" /></div>
          <Field label="Cases" className="w-24"><Input value={cases} onChange={(e) => setCases(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></Field>
        </div>
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="bg-surface-muted text-[11px] font-semibold text-text-muted">
                <th className="px-3 py-2.5">Item</th><th className="px-3">Unit</th><th className="px-3">Qty</th><th className="px-3 text-right">List price</th>
                <th className="px-3">Wholesale</th><th className="px-3">Disc. %</th><th className="px-3 text-right">Line total</th><th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{l.item.name}</td>
                  <td className="px-3">
                    <div className="w-32"><Select value={l.packQty} aria-label="Unit" onChange={(e) => {
                      const pack = Number(e.target.value);
                      update(i, { packQty: pack, priceText: String(defaultPrice(l.item, pack) / 100) });
                    }}>
                      {[1, ...l.item.packs.filter((p) => p > 1)].map((p) => <option key={p} value={p}>{packLabel(p)}</option>)}
                    </Select></div>
                  </td>
                  <td className="px-3"><div className="w-16"><Input value={l.qty} onChange={(e) => update(i, { qty: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} inputMode="numeric" aria-label="Quantity" /></div></td>
                  <td className="px-3 text-right tabular-nums text-text-muted">{formatRs(l.item.listCents * l.packQty, { decimals: 0 })}</td>
                  <td className="px-3"><div className="w-28"><Input value={l.priceText} onChange={(e) => update(i, { priceText: e.target.value })} inputMode="decimal" aria-label="Wholesale price" /></div></td>
                  <td className="px-3"><div className="w-16"><Input value={l.discText} onChange={(e) => update(i, { discText: e.target.value })} placeholder="—" inputMode="decimal" aria-label="Discount percent" /></div></td>
                  <td className="px-3 text-right font-semibold tabular-nums">{formatRs(calc[i]!.total, { decimals: 0 })}</td>
                  <td className="px-2"><button type="button" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="p-1 text-text-muted hover:text-danger"><Trash2 size={14} /></button></td>
                </tr>
              ))}
              {lines.length === 0 ? <tr><td colSpan={8} className="px-3 py-8 text-center text-text-muted">Search for an item, set the number of cases and press Enter.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <Card className="flex flex-col gap-3 p-5 xl:w-[340px] xl:shrink-0">
        <CardTitle>Invoice summary</CardTitle>
        <Row label="Subtotal" value={formatRs(subtotal, { decimals: 0 })} />
        <Row label="Trade discount" value={discount ? `− ${formatRs(discount, { decimals: 0 })}` : formatRs(0, { decimals: 0 })} />
        <Row label={vat.registered ? `VAT ${vat.rateBp / 100}% ${vat.included ? '(included)' : ''}` : 'VAT (not registered)'} value={formatRs(vatCents, { decimals: 0 })} />
        <div className="border-t border-border pt-3"><Row label="Total" value={formatRs(total, { decimals: 0 })} strong /></div>
        <p className="text-xs font-semibold">Payment terms</p>
        <div className="flex w-fit gap-1 rounded-control bg-surface-muted p-1" role="radiogroup" aria-label="Payment terms">
          {([['cash', 'Cash'], ['credit', `Credit ${creditDays} days`], ['cheque', 'Cheque']] as const).map(([k, t]) => (
            <button key={k} type="button" role="radio" aria-checked={terms === k} onClick={() => setTerms(k)}
              className={cn('rounded-md px-3 py-1.5 text-xs font-semibold', terms === k ? 'bg-surface text-text shadow-sm' : 'text-text-muted')}>{t}</button>
          ))}
        </div>
        {terms === 'cheque' ? <Field label="Cheque no."><Input value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} maxLength={30} /></Field> : null}
        {terms !== 'cash' ? <Field label="Paid now"><Input value={paidText} onChange={(e) => setPaidText(e.target.value)} inputMode="decimal" placeholder="Rs 0" /></Field> : null}
        <Row label="Balance on account" value={formatRs(balance, { decimals: 0 })} strong />
        {balance > 0 && !customer ? <p className="text-xs text-danger">Choose a credit customer to leave a balance.</p> : null}
        {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
        <Button disabled={busy || (balance > 0 && !customer)} onClick={() => submit('invoice')}>{pending ? 'Saving…' : 'Generate invoice'}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => submit('quotation')}>Save quotation</Button>
        {msg?.id ? <Button variant="soft" onClick={() => window.open(`/print/wholesale/${msg.id}`, 'laneos-a4', 'width=900,height=1000')}>Print A4 again</Button> : null}
      </Card>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={cn('flex justify-between text-[13px]', strong && 'font-semibold')}><span className={strong ? '' : 'text-text-muted'}>{label}</span><span className="tabular-nums">{value}</span></div>;
}
