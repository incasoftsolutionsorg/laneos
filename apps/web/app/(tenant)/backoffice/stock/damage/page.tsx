import type { Metadata } from 'next';
import { Planned } from '@/components/backoffice/Planned';

export const metadata: Metadata = { title: 'Damaged goods' };

export default function DamagedgoodsPage() {
  return (
    <Planned
      title="Damaged goods"
      frame="1-1849"
      milestone="M4 · MVP features complete"
      what="Report damaged stock, keep it out of sellable stock and decide: write off, return to supplier or sell reduced (blueprint §30.1)."
    />
  );
}
