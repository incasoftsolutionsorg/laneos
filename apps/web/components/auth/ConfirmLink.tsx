'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Card, Logo } from '@laneos/ui';
import { createClient } from '@/lib/supabase/browser';

export function ConfirmLink({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    // PKCE links carry ?code=… — the server callback handles those.
    if (query.get('code')) {
      window.location.replace(`/auth/callback?code=${encodeURIComponent(query.get('code')!)}&next=${encodeURIComponent(next)}`);
      return;
    }
    if (params.get('error_description')) return setError(params.get('error_description')!.replace(/\+/g, ' '));
    const access = params.get('access_token');
    const refresh = params.get('refresh_token');
    if (!access || !refresh) return setError('This link is incomplete or has already been used.');
    // Drop the tokens from the address bar before anything else runs.
    history.replaceState(null, '', window.location.pathname + window.location.search);
    createClient().auth.setSession({ access_token: access, refresh_token: refresh }).then(({ error: e }) => {
      if (e) setError(e.message);
      else window.location.replace(next);
    });
  }, [next]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="flex w-full max-w-sm flex-col items-center gap-4 p-7 text-center">
        <Logo />
        {error ? (
          <>
            <Alert>{error}</Alert>
            <Link href="/forgot-password" className="text-[13px] font-semibold text-brand-primary">Send me a new link</Link>
          </>
        ) : <p className="text-[13px] text-text-muted">Signing you in…</p>}
      </Card>
    </div>
  );
}
