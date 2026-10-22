import type { Metadata } from 'next';
import { Planned } from '@/components/backoffice/Planned';

export const metadata: Metadata = { title: 'Security settings' };

export default function SecuritysettingsPage() {
  return (
    <Planned
      title="Security settings"
      frame="11-4365"
      milestone="M1 · Tenancy, login & catalogue"
      what="Session limits, 2FA rules for owners and the reset-all-access button (blueprint §27.6)."
    />
  );
}
