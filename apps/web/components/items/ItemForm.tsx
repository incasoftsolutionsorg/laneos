'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { isValidGtin } from '@laneos/barcode';
import { Alert, Badge, Button, Card, Field, Input, Select, Switch, buttonClass, cn, tabClass, tabsClass } from '@laneos/ui';
import { deactivateItem, saveItem, type ItemFormState } from '@/app/(tenant)/backoffice/items/actions';

export interface ItemFormValues {
  id?: string; name: string; brand: string; departmentId: string | null; itemType: string; taxClass: string;
  plu: number | null; barcodes: { code: string; packQty: number }[];
  price: string; mrp: string; cost: string; wholesale: string; minPrice: string; reorderLevel: string;
  isReturnable: boolean; trackBatches: boolean; isPinned: boolean;
}

const initial: ItemFormState = {};
const TYPES = [['standard', 'Standard'], ['weighed', 'Weighed'], ['pack', 'Pack'], ['open_price', 'Open price']] as const;

function Toggle({ name, label, hint, defaultOn }: { name: string; label: string; hint: string; defaultOn: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-[13px] font-semibold">{label}</span>
        <span className="block text-xs text-text-muted">{hint}</span>
      </span>
      {on ? <input type="hidden" name={name} value="on" /> : null}
      <Switch on={on} onChange={setOn} label={label} />
    </div>
  );
}

// Add / edit item (Figma 1-1846).
export function ItemForm({ values, departments }: { values: ItemFormValues; departments: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveItem, initial);
  const [type, setType] = useState(values.itemType);
  const [codes, setCodes] = useState(values.barcodes);
  const [newCode, setNewCode] = useState('');
  const [newPack, setNewPack] = useState('1');
  const [codeError, setCodeError] = useState<string | null>(null);
  const err = (k: string) => state.fieldErrors?.[k];
  const isNew = !values.id;

  const addCode = () => {
    const code = newCode.trim().toUpperCase();
    const pack = Math.trunc(Number(newPack) || 1);
    if (!/^[0-9A-Z-]{1,32}$/.test(code)) return setCodeError('Digits, capital letters and dashes only.');
    if (/^\d{8}$|^\d{12,14}$/.test(code) && !isValidGtin(code)) return setCodeError('The check digit is wrong — scan it again.');
    if (codes.some((c) => c.code === code)) return setCodeError('Already on this item.');
    if (pack < 1 || pack > 1000) return setCodeError('Units per scan: 1–1000.');
    setCodes((c) => [...c, { code, packQty: pack }]);
    setNewCode(''); setNewPack('1'); setCodeError(null);
  };

  return (
    <Card className="max-w-[880px] p-7">
      <form action={action} className="flex flex-col gap-5">
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
        <input type="hidden" name="itemType" value={type} />
        <input type="hidden" name="barcodes" value={JSON.stringify(codes)} />
        {state.error ? <Alert>{state.error}</Alert> : null}

        <div className="grid gap-6 md:grid-cols-[1fr_280px]">
          <div className="flex flex-col gap-4">
            <Field label="Item name" error={err('name')}>
              <Input name="name" defaultValue={values.name} required maxLength={120} placeholder="Anchor Full Cream Milk Powder 400g" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category">
                <Select name="departmentId" defaultValue={values.departmentId ?? ''}>
                  <option value="">No category</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </Field>
              <Field label="Brand"><Input name="brand" defaultValue={values.brand} maxLength={60} placeholder="Anchor" /></Field>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold">Item type</span>
              <div className={tabsClass()} role="tablist" aria-label="Item type">
                {TYPES.map(([k, t]) => (
                  <button key={k} type="button" role="tab" aria-selected={type === k} className={tabClass(type === k)} onClick={() => setType(k)}>{t}</button>
                ))}
              </div>
              <span className="text-xs text-text-muted">
                {type === 'weighed' ? 'Price is per kg; sold by scale label or by typing the weight.'
                  : type === 'open_price' ? 'The cashier types the price (never above the MRP).'
                  : type === 'pack' ? 'Sold as a pack of several units.' : 'Sold by the piece.'}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold">Barcodes</span>
              <div className="flex flex-wrap items-center gap-2">
                {codes.map((c, i) => (
                  <button key={c.code} type="button" title="Remove" onClick={() => setCodes((x) => x.filter((y) => y.code !== c.code))}
                    className={cn('rounded-full px-3 py-[7px] text-xs font-medium', i === 0 && c.packQty === 1 ? 'bg-brand-primary text-white' : 'border border-border bg-surface')}>
                    {c.packQty > 1 ? `Case ×${c.packQty}: ` : ''}{c.code} ✕
                  </button>
                ))}
                {codes.length === 0 ? <span className="text-xs text-text-muted">No barcode yet</span> : null}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Scan or type a barcode" className="w-56"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCode(); } }} aria-label="New barcode" />
                <Input value={newPack} onChange={(e) => setNewPack(e.target.value)} type="number" min={1} max={1000} className="w-24" aria-label="Units per scan" title="Units per scan (case barcode)" />
                <Button variant="secondary" onClick={addCode}>+ Add barcode</Button>
              </div>
              {codeError || err('barcodes') ? <span className="text-xs text-danger">{codeError ?? err('barcodes')}</span> : <span className="text-xs text-text-muted">Units per scan above 1 makes a case barcode.</span>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="PLU" error={err('plu')} hint={type === 'weighed' ? 'Needed for scale labels' : '1–99999, optional'}>
                <Input name="plu" type="number" min={1} max={99999} defaultValue={values.plu ?? ''} placeholder="—" />
              </Field>
              <Field label="Tax class">
                <Select name="taxClass" defaultValue={values.taxClass}>
                  <option value="standard">VAT standard</option><option value="exempt">VAT exempt</option><option value="zero">Zero-rated</option>
                </Select>
              </Field>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Retail price" error={err('priceCents')}><Input name="price" defaultValue={values.price} inputMode="decimal" placeholder="Rs 0.00" required /></Field>
              <Field label="MRP" error={err('mrpCents')}><Input name="mrp" defaultValue={values.mrp} inputMode="decimal" placeholder="Rs 0.00" /></Field>
              <Field label="Wholesale"><Input name="wholesale" defaultValue={values.wholesale} inputMode="decimal" placeholder="Rs 0.00" /></Field>
              <Field label="Minimum" error={err('minPriceCents')}><Input name="minPrice" defaultValue={values.minPrice} inputMode="decimal" placeholder="Rs 0.00" /></Field>
              <Field label="Cost" hint="For margins"><Input name="cost" defaultValue={values.cost} inputMode="decimal" placeholder="Rs 0.00" /></Field>
              <Field label="Re-order at" hint={type === 'weighed' ? 'kg' : 'pieces'}><Input name="reorderLevel" type="number" min={0} step="0.001" defaultValue={values.reorderLevel} /></Field>
            </div>
            {isNew ? (
              <Field label="Opening stock" hint={`${type === 'weighed' ? 'kg' : 'pieces'} · recorded in the stock ledger`}>
                <Input name="openingStock" type="number" min={0} step="0.001" defaultValue="0" />
              </Field>
            ) : null}
            <p className="rounded-control bg-surface-muted p-3 text-xs text-text-muted">Item photos come with the storage task.</p>
          </div>
        </div>

        <Toggle name="trackBatches" label="Track batches & expiry" hint="Ask for expiry date on every GRN" defaultOn={values.trackBatches} />
        <Toggle name="isReturnable" label="Returnable" hint="Customers may return this item" defaultOn={values.isReturnable} />
        <Toggle name="isPinned" label="Pin on lane" hint="Shown on the lane's Pinned tab" defaultOn={values.isPinned} />

        <div className="flex flex-wrap items-center gap-3">
          {values.id ? (
            <Button variant="danger" formAction={deactivateItem} formNoValidate name="back" value="1"
              onClick={(e) => { if (!confirm('Remove this item from sale? Past sales keep it.')) e.preventDefault(); }}>
              Delete item
            </Button>
          ) : <Badge>New item</Badge>}
          <div className="flex-1" />
          <Link href="/backoffice/items" className={buttonClass('secondary')}>Cancel</Link>
          <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save item'}</Button>
        </div>
      </form>
    </Card>
  );
}
