'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { decidePayment } from '@/app/(tenant)/backoffice/purchasing/actions';

export function PaymentDecision({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const run = async (approve: boolean) => {
    const r = await decidePayment(id, approve);
    if (r.error) setError(r.error); else router.refresh();
  };
  return (
    <span className="flex gap-3 text-xs font-semibold">
      <button type="button" className="text-brand-primary hover:underline" onClick={() => run(true)}>Approve</button>
      <button type="button" className="text-danger hover:underline" onClick={() => run(false)}>Reject</button>
      {error ? <span className="text-danger">{error}</span> : null}
    </span>
  );
}
