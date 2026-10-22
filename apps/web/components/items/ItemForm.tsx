'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Alert, Button, Card, CardTitle, Field, Input, Select, buttonClass } from '@laneos/ui';
import { saveItem, type ItemFormState } from '@/app/(tenant)/backoffice/items/actions';

export interface ItemFormValues {
  id?: string; name: string; departmentId: string | null; itemType: string; taxClass: string; plu: number | null;
  barcode: string | null; price: string; mrp: string; cost: string; reorderLevel: string;
  isReturnable: boolean; trackBatches: boolean; isPinned: boolean;
}

const initial: ItemFormState = {};

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-brand-primary" />
      {label}
    </label>
  );
}

export function ItemForm({ values, departments }: { values: ItemFormValues; departments: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveItem, initial);
  const err = (k: string) => state.fieldErrors?.[k];
  const isNew = !values.id;

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-4">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      {state.error ? <Alert>{state.error}</Alert> : null}

      <Card className="flex flex-col gap-4 p-5">
        <CardTitle>Item</CardTitle>
        <Field label="Name" error={err('name')}>
          <Input name="name" defaultValue={values.name} required maxLength={120} placeholder="Anchor Milk Powder 400g" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Category">
            <Select name="departmentId" defaultValue={values.departmentId ?? ''}>
              <option value="">No category</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Type" hint="Weighed: price per kg, sold by scale label">
            <Select name="itemType" defaultValue={values.itemType}>
              <option value="standard">Standard</option>
              <option value="weighed">Weighed</option>
              <option value="pack">Pack</option>
              <option value="open_price">Open price</option>
            </Select>
          </Field>
          <Field label="Tax class">
            <Select name="taxClass" defaultValue={values.taxClass}>
              <option value="standard">Standard</option>
              <option value="exempt">Exempt</option>
              <option value="zero">Zero-rated</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Barcode" error={err('barcode')} hint="EAN-13, UPC or your own code">
            <Input name="barcode" defaultValue={values.barcode ?? ''} inputMode="numeric" maxLength={32} />
          </Field>
          <Field label="PLU" error={err('plu')} hint="1–99999; needed for scale labels">
            <Input name="plu" type="number" min={1} max={99999} defaultValue={values.plu ?? ''} />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <CardTitle>Price and stock</CardTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Selling price (Rs)" error={err('priceCents')}>
            <Input name="price" defaultValue={values.price} inputMode="decimal" placeholder="1,230.00" required />
          </Field>
          <Field label="MRP (Rs)" error={err('mrpCents')} hint="Price can never be above MRP">
            <Input name="mrp" defaultValue={values.mrp} inputMode="decimal" />
          </Field>
          <Field label="Cost (Rs)" error={err('costCents')} hint="Used for margin reports">
            <Input name="cost" defaultValue={values.cost} inputMode="decimal" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Re-order level" hint="Pieces, or kg for weighed items">
            <Input name="reorderLevel" type="number" min={0} step="0.001" defaultValue={values.reorderLevel} />
          </Field>
          {isNew ? (
            <Field label="Opening stock" hint="Recorded in the stock ledger">
              <Input name="openingStock" type="number" min={0} step="0.001" defaultValue="0" />
            </Field>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-5">
          <Check name="isPinned" label="Pin on lane" defaultChecked={values.isPinned} />
          <Check name="isReturnable" label="Returnable" defaultChecked={values.isReturnable} />
          <Check name="trackBatches" label="Track batches and expiry" defaultChecked={values.trackBatches} />
        </div>
      </Card>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : isNew ? 'Add item' : 'Save changes'}</Button>
        <Link href="/backoffice/items" className={buttonClass('secondary')}>Cancel</Link>
      </div>
    </form>
  );
}
