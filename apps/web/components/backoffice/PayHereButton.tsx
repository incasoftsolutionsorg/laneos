'use client';

import { useState, useTransition } from 'react';
import { Button } from '@laneos/ui';
import { startPayhere } from '@/app/(tenant)/backoffice/billing/actions';

/** Posts a signed checkout form to PayHere for one invoice (WF-008); PayHere then calls /api/payhere/notify. */
export function PayHereButton({ invoiceId, label = 'Pay with PayHere', enabled }: { invoiceId: string | null; label?: string; enabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!enabled || !invoiceId) {
    return <Button disabled title={enabled ? 'No open invoice to pay' : 'Online payment opens once the PayHere merchant account is connected'}>{label}</Button>;
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <Button disabled={pending} onClick={() => start(async () => {
        setError(null);
        const r = await startPayhere(invoiceId);
        if (r.error || !r.url || !r.fields) return setError(r.error ?? 'Could not start the payment.');
        const form = document.createElement('form');
        form.method = 'post';
        form.action = r.url;
        for (const [k, v] of Object.entries(r.fields)) {
          const input = document.createElement('input');
          input.type = 'hidden'; input.name = k; input.value = v;
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
      })}>{pending ? 'Opening PayHere…' : label}</Button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}
