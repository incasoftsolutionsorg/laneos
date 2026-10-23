import type { Metadata } from 'next';
import { CardTitle, Card, PageHeader } from '@laneos/ui';
import { ProfileCard, SecurityCard } from '@/components/backoffice/ProfileForms';
import { SessionsTable, type SessionRow } from '@/components/backoffice/SessionsTable';
import { requireTenant } from '@/lib/server/context';
import { needs2fa } from '@/lib/staff';

export const metadata: Metadata = { title: 'My profile' };

const showPhone = (p: string | null) => (p ? p.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3') : '');


// My profile (Figma 1-3518): personal details, password, 2-step verification and sessions.
export default async function ProfilePage() {
  const ctx = await requireTenant();
  const [{ data: me }, { data: factors }, { data: sessions }] = await Promise.all([
    ctx.supabase.from('members').select('display_name, phone, language').eq('id', ctx.member.id).single(),
    ctx.supabase.auth.mfa.listFactors(),
    ctx.supabase.schema('api').rpc('list_sessions'),
  ]);
  const totp = factors?.totp?.[0] ?? null;

  return (
    <>
      <PageHeader title="My profile" subtitle="Personal details, password, 2-step verification and sessions" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <ProfileCard
          name={me?.display_name ?? ctx.member.name}
          email={ctx.email}
          phone={showPhone(me?.phone ?? null)}
          language={me?.language ?? 'en'}
          roleLine={`${ctx.member.roleName} · ${ctx.tenant.name}`}
        />
        <div className="flex min-w-0 flex-col gap-4">
          <SecurityCard factorId={totp?.id ?? null} required={needs2fa(ctx.tenant.require_2fa, ctx.member.roleKey)} />
          <Card className="flex flex-col gap-3 p-5">
            <CardTitle>Active sessions</CardTitle>
            <SessionsTable rows={(sessions ?? []) as unknown as SessionRow[]} empty="No other sessions." />
          </Card>
        </div>
      </div>
    </>
  );
}
