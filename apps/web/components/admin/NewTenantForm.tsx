'use client';

import { useActionState } from 'react';
import { Alert, Button, Card, Field, Input, Select } from '@laneos/ui';
import { createTenantForCustomer, type NewTenantState } from '@/app/(platform)/admin/tenants/new/actions';

export function NewTenantForm({ plans }: { plans: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createTenantForCustomer, {} as NewTenantState);
  return (
    <Card className="max-w-2xl p-6">
      <form action={action} className="flex flex-col gap-4">
        {state.error ? <Alert>{state.error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name"><Input name="businessName" required maxLength={120} /></Field>
          <Field label="Business registration no."><Input name="businessRegNo" maxLength={40} /></Field>
          <Field label="Owner name"><Input name="ownerName" required maxLength={80} /></Field>
          <Field label="Owner email" hint="Gets the invite; an existing LaneOS login is reused"><Input name="email" type="email" required /></Field>
          <Field label="Owner mobile"><Input name="mobile" inputMode="tel" placeholder="077 123 4567" /></Field>
          <Field label="City"><Input name="city" maxLength={60} /></Field>
          <Field label="First shop name"><Input name="shopName" required maxLength={80} placeholder="Kandy" /></Field>
          <Field label="Shop code"><Input name="shopCode" required maxLength={8} placeholder="KDY1" className="uppercase" /></Field>
          <Field label="Business type">
            <Select name="businessType" defaultValue="supermarket">
              <option value="grocery">Grocery / kade</option><option value="supermarket">Supermarket</option>
              <option value="pharmacy">Pharmacy</option><option value="hardware">Hardware</option><option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Plan"><Select name="plan" defaultValue="single">{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="trial" defaultChecked className="size-4 accent-brand-primary" />
          Start with the 14-day free trial (otherwise active and billed from today)
        </label>
        <Button type="submit" disabled={pending} className="w-fit">{pending ? 'Creating…' : 'Create tenant and send invite'}</Button>
      </form>
    </Card>
  );
}
