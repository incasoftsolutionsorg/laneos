import type { Metadata } from 'next';
import { Planned } from '@/components/backoffice/Planned';

export const metadata: Metadata = { title: 'Branding' };

export default function BrandingPage() {
  return (
    <Planned
      title="Branding"
      frame="1-3701"
      milestone="a later milestone"
      what="Logo, colours and receipt header for white-label tenants."
    />
  );
}
