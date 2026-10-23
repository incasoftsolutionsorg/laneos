'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { Button, Card, EmptyState, buttonClass } from '@laneos/ui';

/** Shared error state (Figma 11-4920 "error"): what happened, a retry, and a way out. Never shows stack traces. */
export function ErrorPanel({ error, reset, home, homeLabel }: { error: Error & { digest?: string }; reset: () => void; home: string; homeLabel: string }) {
  useEffect(() => { console.error(error); }, [error]);
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  return (
    <Card className="mx-auto w-full max-w-lg">
      <EmptyState tone="danger" icon={<TriangleAlert size={26} aria-hidden />}
        title={offline ? 'No connection' : 'Something went wrong'}
        action={<><Button onClick={reset}>Try again</Button><Link href={home} className={buttonClass('secondary')}>{homeLabel}</Link></>}>
        <p>{offline ? 'This page needs the internet. Check the shop’s Wi-Fi or mobile data, then try again.' : 'Nothing was lost. Try again; if it keeps happening, send LaneOS support this reference.'}</p>
        {error.digest && !offline ? <p className="mt-2 font-mono text-xs">Ref {error.digest}</p> : null}
      </EmptyState>
    </Card>
  );
}
