import { Skeleton } from '@laneos/ui';

// Shown inside the shell while a back-office page loads.
export default function BackofficeLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-72" />
      <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-80" />
    </div>
  );
}
