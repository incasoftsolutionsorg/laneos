import { Skeleton } from '@laneos/ui';

// Shown while a lane screen (checkout, PIN, shift, return) loads.
export default function LaneLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-background" aria-busy="true" aria-label="Loading">
      <div className="h-[60px] bg-sidebar" />
      <div className="flex flex-1 gap-4 p-4">
        <Skeleton className="flex-1" />
        <Skeleton className="w-[380px]" />
      </div>
    </div>
  );
}
