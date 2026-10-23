import type { Metadata } from 'next';
import { Alert, PageHeader } from '@laneos/ui';
import { EnrolMfa } from '@/components/backoffice/ProfileForms';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'My 2-step verification' };

// Platform admins have no tenant profile; this is their 2-step set-up (required for staff, blueprint §27.7).
export default async function AdminProfilePage() {
  const { supabase, email } = await requireAdmin();
  const { data } = await supabase.auth.mfa.listFactors();
  const on = (data?.totp ?? []).length > 0;
  return (
    <>
      <PageHeader title="My 2-step verification" subtitle={email} />
      {on ? <Alert tone="success">Your authenticator is on. You enter a code at every sign-in.</Alert> : <EnrolMfa done="/admin/security" />}
    </>
  );
}
