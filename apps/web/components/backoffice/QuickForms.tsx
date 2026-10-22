'use client';

import { useActionState } from 'react';
import { Alert, Button, Card, CardTitle, Field, Input } from '@laneos/ui';
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

export function CustomerForm() {
  const [state, action, pending] = useActionState(createCustomer, initial);
  return (
    <Card className="p-5">
      <form key={state.ok} action={action} className="flex flex-col gap-3.5">
        <CardTitle>Add customer</CardTitle>
        {state.error ? <Alert>{state.error}</Alert> : <Saved ok={state.ok} what="Customer" />}
        <Field label="Name"><Input name="name" required maxLength={120} /></Field>
        <Field label="Mobile"><Input name="phone" required inputMode="tel" placeholder="077 123 4567" /></Field>
        <Field label="Email (optional)"><Input name="email" type="email" /></Field>
        <Field label="Credit limit (Rs)" hint="0 = cash customer only"><Input name="creditLimit" inputMode="decimal" defaultValue="0" /></Field>
        <Check name="marketingConsent" label="Agreed to receive SMS offers" />
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Add customer'}</Button>
      </form>
    </Card>
  );
}

export function SupplierForm() {
  const [state, action, pending] = useActionState(createSupplier, initial);
  return (
    <Card className="p-5">
      <form key={state.ok} action={action} className="flex flex-col gap-3.5">
        <CardTitle>Add supplier</CardTitle>
        {state.error ? <Alert>{state.error}</Alert> : <Saved ok={state.ok} what="Supplier" />}
        <Field label="Name"><Input name="name" required maxLength={120} /></Field>
        <Field label="Mobile (optional)"><Input name="phone" inputMode="tel" placeholder="077 123 4567" /></Field>
        <Field label="Email (optional)"><Input name="email" type="email" /></Field>
        <Field label="Payment terms (days)"><Input name="paymentTermsDays" type="number" min={0} max={365} defaultValue={30} /></Field>
        <Check name="isSaleOrReturn" label="Sale-or-return supplier" />
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Add supplier'}</Button>
      </form>
    </Card>
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
