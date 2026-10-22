import type { Metadata } from 'next';
import { Planned } from '@/components/backoffice/Planned';

export const metadata: Metadata = { title: 'Purchasing (GRN)' };

export default function PurchasingGRNPage() {
  return (
    <Planned
      title="Purchasing (GRN)"
      frame="1-2351"
      milestone="M6 · Purchasing, batches & loyalty"
      what="Purchase orders, goods received notes with batches and expiry, supplier returns and payments."
    />
  );
}
