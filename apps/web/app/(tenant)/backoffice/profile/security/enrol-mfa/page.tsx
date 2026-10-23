import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, buttonClass } from '@laneos/ui';
import { EnrolMfa } from '@/components/backoffice/ProfileForms';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Set up 2-step verification' };

export default async function EnrolMfaPage() {
  await requireTenant();
  return (
    <>
      <PageHeader title="2-step verification" subtitle="A code from your phone at every sign-in, so a stolen password alone is not enough."
        actions={<Link href="/backoffice/profile" className={buttonClass('secondary')}>Back</Link>} />
      <EnrolMfa />
    </>
  );
}
