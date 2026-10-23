'use client';

import { ErrorPanel } from '@/components/ErrorPanel';

export default function BackofficeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel error={error} reset={reset} home="/backoffice" homeLabel="Dashboard" />;
}
