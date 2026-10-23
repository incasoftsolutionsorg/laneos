'use client';

import { ErrorPanel } from '@/components/ErrorPanel';

// Lane error: sales already saved on the device (offline queue) are not affected.
export default function LaneError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center bg-background p-6">
      <ErrorPanel error={error} reset={reset} home="/lane" homeLabel="Choose lane" />
    </div>
  );
}
