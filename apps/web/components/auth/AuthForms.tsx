'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Alert, Button, Field, Input, Select, buttonClass, cn } from '@laneos/ui';
import { CITIES, SIGNUP_PLANS } from '@/lib/plans';
import { register, requestReset, signIn, updatePassword, type FormState } from '@/app/(auth)/actions';

const initial: FormState = {};

// Client-side attributes are UX only. The server actions must enforce the same rules.
function PasswordInput({ autoComplete, minLength }: { autoComplete: string; minLength?: number }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        name="password"
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={72} // bcrypt limit used by Supabase Auth
        required
        className="pr-16"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        className="absolute inset-y-0 right-3 text-xs font-semibold text-brand-primary"
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-[30px] font-bold text-text">{title}</h1>
      <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
    </div>
  );
}

export function LoginForm({ next, reason }: { next?: string; reason?: string }) {
  const [state, action, pending] = useActionState(signIn, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Heading title="Welcome back" subtitle="Sign in to your shop back office." />
      {/* Only fixed messages are rendered; unknown reasons show nothing */}
      {reason === 'reset' ? <Alert tone="warning">Your access was reset. Sign in again.</Alert> : null}
      {reason === 'link' ? <Alert tone="warning">That link has expired. Request a new one.</Alert> : null}
      {state.error ? <Alert>{state.error}</Alert> : null}
      {/* Can be edited by the user: the signIn action must run safeNext() on it again */}
      <input type="hidden" name="next" value={next ?? ''} />
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="owner@yourshop.lk" />
      </Field>
      <Field label="Password">
        <PasswordInput autoComplete="current-password" />
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-[13px] font-semibold text-brand-primary">Forgot password?</Link>
      </div>
      <Button type="submit" disabled={pending} className="w-full">{pending ? 'Signing in…' : 'Sign in'}</Button>
      <div className="flex items-center gap-2.5">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-text-muted">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <Link href="/lane" className={buttonClass('secondary', 'w-full')}>Cashier PIN login</Link>
      <p className="flex gap-1.5 text-[13px]">
        <span className="text-text-muted">New shop?</span>
        <Link href="/register" className="font-semibold text-brand-primary">Create an account</Link>
      </p>
    </form>
  );
}

/** Sign-up (Figma 1-90): shop details, plan, owner account in one form. */
export function RegisterForm() {
  const [state, action, pending] = useActionState(register, initial);
  const [plan, setPlan] = useState('single');
  if (state.message) {
    return (
      <div className="flex flex-col gap-4">
        <Heading title="Check your email" subtitle="One more step." />
        <Alert tone="success">{state.message}</Alert>
        <Link href="/login" className="text-[13px] font-semibold text-brand-primary">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <h1 className="text-[26px] font-bold text-text">Create your shop account</h1>
      {state.error ? <Alert>{state.error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Shop name"><Input name="businessName" required maxLength={120} placeholder="ABC Supermarket" /></Field>
        <Field label="Business registration no."><Input name="businessRegNo" maxLength={40} placeholder="PV 00123456" /></Field>
        <Field label="Owner name"><Input name="ownerName" required maxLength={80} autoComplete="name" /></Field>
        <Field label="Mobile"><Input name="mobile" required inputMode="tel" autoComplete="tel" placeholder="077 123 4567" /></Field>
        <Field label="Email"><Input name="email" type="email" required maxLength={254} autoComplete="email" /></Field>
        <Field label="Password" hint="At least 10 characters"><PasswordInput autoComplete="new-password" minLength={10} /></Field>
        <Field label="City">
          <Select name="city" defaultValue="Kandy">{CITIES.map((c) => <option key={c}>{c}</option>)}</Select>
        </Field>
        <Field label="Business type">
          <Select name="businessType" defaultValue="supermarket">
            <option value="grocery">Grocery / kade</option><option value="supermarket">Supermarket</option>
            <option value="pharmacy">Pharmacy</option><option value="hardware">Hardware</option><option value="other">Other</option>
          </Select>
        </Field>
        <Field label="First shop (branch) name"><Input name="shopName" required maxLength={80} placeholder="Kandy" /></Field>
        <Field label="Shop code" hint="Printed on invoice numbers">
          <Input name="shopCode" required minLength={2} maxLength={8} pattern="[A-Za-z0-9]{2,8}" title="2 to 8 letters or digits" autoCapitalize="characters" placeholder="KDY1" className="uppercase" />
        </Field>
      </div>
      <p className="text-[13px] font-semibold">Choose a plan</p>
      <input type="hidden" name="plan" value={plan} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="radiogroup" aria-label="Plan">
        {SIGNUP_PLANS.map((p) => {
          const contact = 'contact' in p;
          const on = plan === p.id;
          const body = (
            <>
              <span className="flex items-center justify-between text-[13px] font-semibold">{p.name}{on ? <span className="text-[11px] text-brand-primary">Selected</span> : null}</span>
              <span className="mt-auto text-[16px] font-bold text-brand-primary">{p.price}</span>
              <span className="text-[11px] text-text-muted">{p.text}</span>
            </>
          );
          const cls = cn('flex min-h-32 flex-col gap-1 rounded-card border p-3 text-left', on ? 'border-brand-primary bg-brand-light' : 'border-border bg-surface hover:border-border-strong');
          return contact
            ? <a key={p.id} href="mailto:sales@laneos.lk?subject=Chain%20plan" className={cls}>{body}</a>
            : <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setPlan(p.id)} className={cls}>{body}</button>;
        })}
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="agree" required className="size-4 accent-brand-primary" />
        I agree to the Terms and the Data Processing Agreement
      </label>
      <div className="flex items-center justify-between gap-3">
        <Link href="/login" className={buttonClass('secondary')}>Back</Link>
        <Button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Start free trial'}</Button>
      </div>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestReset, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Heading title="Reset your password" subtitle="We will email you a link to choose a new password." />
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <Field label="Email">
        <Input name="email" type="email" required maxLength={254} autoComplete="email" />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">{pending ? 'Sending…' : 'Send reset link'}</Button>
      <Link href="/login" className="text-[13px] font-semibold text-brand-primary">Back to sign in</Link>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Heading title="Choose a new password" subtitle="Your other devices will be signed out." />
      {state.error ? <Alert>{state.error}</Alert> : null}
      <Field label="New password" hint="At least 10 characters">
        <PasswordInput autoComplete="new-password" minLength={10} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">{pending ? 'Saving…' : 'Save password'}</Button>
    </form>
  );
}