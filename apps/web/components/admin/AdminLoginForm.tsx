'use client';

import { useActionState } from 'react';
import { Alert, Button, Card, Field, Input, Logo } from '@laneos/ui';
import { adminSignIn, type AdminLoginState } from '@/app/(platform-auth)/admin/login/actions';

export function AdminLoginForm({ forbidden }: { forbidden: boolean }) {
  const [state, action, pending] = useActionState(adminSignIn, {} as AdminLoginState);
  return (
    <Card className="flex w-full max-w-sm flex-col gap-4 p-7">
      <div className="flex items-center gap-3"><Logo /><div><p className="text-[17px] font-bold">LaneOS</p><p className="text-xs font-semibold text-platform-accent">Platform admin</p></div></div>
      {forbidden ? <Alert tone="warning">That account is not a LaneOS platform admin.</Alert> : null}
      {state.error ? <Alert>{state.error}</Alert> : null}
      <form action={action} className="flex flex-col gap-4">
        <Field label="Staff email"><Input name="email" type="email" autoComplete="username" required /></Field>
        <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <Button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <p className="text-xs text-text-muted">Staff accounts need 2-step verification once set up; every action here is audited.</p>
    </Card>
  );
}
