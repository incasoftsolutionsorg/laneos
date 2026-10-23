'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Card, CardTitle, Field, Input } from '@laneos/ui';
import { Dialog } from '@/components/lane/Dialog';
import { addLane, createCustomer, createSupplier, type PartyFormState } from '@/app/(tenant)/backoffice/parties-actions';

const initial: PartyFormState = {};

function Saved({ ok, what }: { ok?: number; what: string }) {
  return ok ? <Alert tone="success">{what} added.</Alert> : null;
}

function Check({ name, label }: { name: string; label: string }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" name={name} className="size-4 accent-brand-primary" />
      {label}
    </label>
  );
}

/** "+ Add customer" button and dialog (Figma 1-3034). */
export function AddCustomerButton() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (prev: PartyFormState, form: FormData) => {
    const r = await createCustomer(prev, form);
    if (!r.error) setOpen(false);
    return r;
  }, initial);
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add customer</Button>
      {open ? (
        <Dialog title="Add customer" onClose={() => setOpen(false)} width={460}>
          <form action={action} className="flex flex-col gap-3.5">
            {state.error ? <Alert>{state.error}</Alert> : null}
            <Field label="Name"><Input name="name" required maxLength={120} autoFocus /></Field>
            <Field label="Mobile"><Input name="phone" required inputMode="tel" placeholder="077 123 4567" /></Field>
            <Field label="Email (optional)"><Input name="email" type="email" /></Field>
            <Field label="Credit limit (Rs)" hint="0 = cash customer only"><Input name="creditLimit" inputMode="decimal" defaultValue="0" /></Field>
            <Check name="marketingConsent" label="Agreed to receive SMS offers" />
            <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Add customer'}</Button>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

/** "+ Add supplier" button and dialog (Figma 1-2121). */
export function AddSupplierButton() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (prev: PartyFormState, form: FormData) => {
    const r = await createSupplier(prev, form);
    if (!r.error) setOpen(false);
    return r;
  }, initial);
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add supplier</Button>
      {open ? (
        <Dialog title="Add supplier" onClose={() => setOpen(false)} width={520}>
          <form action={action} className="flex flex-col gap-3.5">
            {state.error ? <Alert>{state.error}</Alert> : null}
            <Field label="Name"><Input name="name" required maxLength={120} autoFocus /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contact person"><Input name="contactName" maxLength={80} /></Field>
              <Field label="Mobile"><Input name="phone" inputMode="tel" placeholder="077 123 4567" /></Field>
              <Field label="Email"><Input name="email" type="email" /></Field>
              <Field label="VAT no."><Input name="vatNo" maxLength={30} /></Field>
              <Field label="Payment terms (days)"><Input name="paymentTermsDays" type="number" min={0} max={365} defaultValue={30} /></Field>
            </div>
            <Check name="isSaleOrReturn" label="Sale-or-return supplier (unsold goods go back)" />
            <Check name="dailyDelivery" label="Delivers daily (bread, milk, vegetables)" />
            <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Add supplier'}</Button>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

export function LaneForm() {
  const [state, action, pending] = useActionState(addLane, initial);
  return (
    <Card className="p-5">
      <form key={state.ok} action={action} className="flex flex-col gap-3.5">
        <CardTitle>Add lane</CardTitle>
        {state.error ? <Alert>{state.error}</Alert> : <Saved ok={state.ok} what="Lane" />}
        <Field label="Lane name" hint="Lanes count toward your plan's limit"><Input name="name" required maxLength={60} placeholder="Lane 2" /></Field>
        <Button type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add lane'}</Button>
      </form>
    </Card>
  );
}
