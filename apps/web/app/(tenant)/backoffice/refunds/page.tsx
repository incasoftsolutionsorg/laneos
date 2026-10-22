import type { Metadata } from 'next';
import { Planned } from '@/components/backoffice/Planned';

export const metadata: Metadata = { title: 'Refunds' };

export default function RefundsPage() {
  return (
    <Planned
      title="Refunds"
      frame="1-2808"
      milestone="M3 · Offline, returns & credit notes"
      what="Every refund with who approved it, how it was paid back and the original bill."
    />
  );
}
