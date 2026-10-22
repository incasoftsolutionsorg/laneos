'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Alert, Button, Field, Input, buttonClass } from '@laneos/ui';
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

export function RegisterForm() {
  const [state, action, pending] = useActionState(register, initial);
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
      <Heading title="Create your shop" subtitle="Start on the single-shop plan. You can add lanes and shops later." />
      {state.error ? <Alert>{state.error}</Alert> : null}
      <Field label="Your name">
        <Input name="ownerName" required maxLength={100} autoComplete="name" />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" required maxLength={254} autoComplete="email" />
      </Field>
      <Field label="Password" hint="At least 10 characters">
        <PasswordInput autoComplete="new-password" minLength={10} />
      </Field>
      <Field label="Business name">
        <Input name="businessName" required maxLength={120} placeholder="ABC Supermarket" />
      </Field>
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <Field label="First shop">
          <Input name="shopName" required maxLength={80} placeholder="Kandy" />
        </Field>
        <Field label="Shop code">
          <Input
            name="shopCode"
            required
            minLength={2}
            maxLength={8}
            pattern="[A-Za-z0-9]{2,8}"
            title="2 to 8 letters or digits"
            autoCapitalize="characters"
            placeholder="KDY1"
            className="uppercase"
          />
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="w-full">{pending ? 'Creating…' : 'Create account'}</Button>
      <p className="flex gap-1.5 text-[13px]">
        <span className="text-text-muted">Already have an account?</span>
        <Link href="/login" className="font-semibold text-brand-primary">Sign in</Link>
      </p>
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