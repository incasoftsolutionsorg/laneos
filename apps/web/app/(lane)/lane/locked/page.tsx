'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo, buttonClass } from '@laneos/ui';
import { lastLane } from '@/lib/lane/device';

// No dedicated frame (Appendix E.5): a locked lane goes straight back to its PIN screen (Figma 1-198).
export default function LaneLockedPage() {
  const router = useRouter();
  const [none, setNone] = useState(false);
  useEffect(() => {
    const lane = lastLane();
    if (lane) router.replace(`/lane/${lane}/pin`);
    else setNone(true);
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-[20px] bg-surface p-8 text-center">
        <Logo />
        <h1 className="text-xl font-bold">Lane locked</h1>
        <p className="text-[13px] text-text-muted">{none ? 'Choose the lane this device is at.' : 'Opening the PIN screen…'}</p>
        {none ? <Link href="/lane" className={buttonClass('primary', 'w-full')}>Choose a lane</Link> : null}
      </div>
    </main>
  );
}
