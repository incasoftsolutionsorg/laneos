'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Field, Input } from '@laneos/ui';
import { createClient } from '@/lib/supabase/browser';

/** Second sign-in step: a 6-digit code from the authenticator app (blueprint §27.4). */
export function MfaChallenge({ next }: { next: string }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const verify = () => start(async () => {
    setError(null);
    const supabase = createClient();
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) return setError('Your session has ended. Sign in again.');
    const totp = factors.totp[0];
    if (!totp) return window.location.assign(next);
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
    if (e) return setError(e.code === 'mfa_verification_failed' ? 'That code is not right. Wait for a new one and try again.' : e.message);
    window.location.assign(next); // full load so the proxy sees the upgraded session
  });

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); verify(); }}>
        <div>
          <h1 className="text-[30px] font-bold text-text">Enter your code</h1>
          <p className="mt-1 text-sm text-text-muted">Open your authenticator app and type the 6-digit code for LaneOS.</p>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        <Field label="6-digit code">
          <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric"
            autoComplete="one-time-code" autoFocus className="font-mono text-xl tracking-[0.4em]" />
        </Field>
        <Button type="submit" disabled={pending || code.length !== 6}>{pending ? 'Checking…' : 'Verify'}</Button>
      </form>
      <form action="/auth/signout" method="post" className="text-center">
        <button type="submit" className="text-xs font-semibold text-brand-primary hover:underline">Use a different account</button>
      </form>
    </div>
  );
}
