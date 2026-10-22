import type { Metadata } from 'next';
import { Planned } from '@/components/backoffice/Planned';

export const metadata: Metadata = { title: 'Wholesale billing' };

export default function WholesalebillingPage() {
  return (
    <Planned
      title="Wholesale billing"
      frame="1-1162"
      milestone="a later milestone (scope to be confirmed)"
      what="Bills for wholesale customers with their own price list, quotations and A4 tax invoices."
    />
  );
}
