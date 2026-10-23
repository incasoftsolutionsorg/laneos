'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@laneos/ui';
import { registerLane } from '@/app/(lane)/lane/actions';
import { setLaneKey } from '@/lib/lane/device';

export function RegisterDeviceButton({ laneId, rotate }: { laneId: string; rotate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        variant={rotate ? 'secondary' : 'primary'}
        disabled={busy}
        onClick={async () => {
          if (rotate && !confirm('Move this lane to this device? The old device will stop working on it.')) return;
          setBusy(true);
          const r = await registerLane(laneId);
          if (r.key) {
            await setLaneKey(laneId, r.key);
            router.push(`/lane/${laneId}/pin`);
          } else {
            setBusy(false);
            setError(r.error ?? 'Could not register.');
          }
        }}
      >
        {busy ? 'Registering…' : rotate ? 'Move here' : 'Register here'}
      </Button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}
