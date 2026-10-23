'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Re-renders the server page every few seconds while the tab is visible. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  const [at, setAt] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') { router.refresh(); setAt(new Date()); }
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return <span className="text-xs text-text-muted">Updated {at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · every {seconds} s</span>;
}
