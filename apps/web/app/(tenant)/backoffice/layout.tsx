import Link from 'next/link';
import { Alert } from '@laneos/ui';
import { BackofficeShell } from '@/components/backoffice/Shell';
import { requireTenant } from '@/lib/server/context';
import { needs2fa } from '@/lib/staff';

export default async function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();
  // Settings → Security "Require 2-step verification": a standing reminder until an authenticator is set up.
  // (The proxy already demands the code from anyone who has one.) Reads the session's factors locally.
  let setup2fa = false;
  if (needs2fa(ctx.tenant.require_2fa, ctx.member.roleKey)) {
    const { data: aal } = await ctx.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setup2fa = aal?.nextLevel === 'aal1';
  }
  return (
    <BackofficeShell ctx={ctx}>
      {setup2fa ? (
        <Alert tone="warning">
          Your business requires 2-step verification for your role.{' '}
          <Link href="/backoffice/profile/security/enrol-mfa" className="font-semibold underline">Set it up now</Link> — it takes a minute.
        </Alert>
      ) : null}
      {children}
    </BackofficeShell>
  );
}
