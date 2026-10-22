import type { Metadata } from 'next';
import { Planned } from '@/components/backoffice/Planned';

export const metadata: Metadata = { title: 'Returns & credit notes' };

export default function ReturnscreditnotesPage() {
  return (
    <Planned
      title="Returns & credit notes"
      frame="1-2808"
      milestone="M3 · Offline, returns & credit notes"
      what="Returns with refund, exchange or credit note, and credit notes customers spend later (blueprint §30.2)."
    />
  );
}
