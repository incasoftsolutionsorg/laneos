import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, CardTitle, PageHeader, Table, TD, TH } from '@laneos/ui';
import { AdminList, PlatformReset } from '@/components/admin/AdminForms';
import { ago, fmtDateTime } from '@/lib/server/dates';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'Platform security' };

interface Sec {
  admins: { userId: string; email: string; since: string; lastSignIn: string | null; twoFactor: boolean; me: boolean }[];
  lastPlatformReset: { reset_at: string; reason: string } | null;
  tenantsWithout2fa: number;
}

// Platform security (Figma 3-4959, not read — built from blueprint §27; compare when Figma access returns).
export default async function AdminSecurityPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.schema('api').rpc('admin_security');
  const s = data as unknown as Sec;
  return (
    <>
      <PageHeader title="Security" subtitle="Who can reach every tenant, and the platform-wide emergency switch" />
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="flex flex-col gap-1 p-4"><span className="text-xs text-text-muted">Platform admins</span><span className="text-xl font-bold">{s.admins.length}</span></Card>
        <Card className="flex flex-col gap-1 p-4"><span className="text-xs text-text-muted">Admins without 2-step</span><span className={`text-xl font-bold ${s.admins.some((a) => !a.twoFactor) ? 'text-danger' : ''}`}>{s.admins.filter((a) => !a.twoFactor).length}</span></Card>
        <Card className="flex flex-col gap-1 p-4"><span className="text-xs text-text-muted">Businesses whose owner has no 2-step</span><span className="text-xl font-bold">{s.tenantsWithout2fa}</span></Card>
      </div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <Table>
            <thead><tr><TH>Admin</TH><TH>Since</TH><TH>Last sign-in</TH><TH>2-step</TH></tr></thead>
            <tbody>
              {s.admins.map((a) => (
                <tr key={a.userId}>
                  <TD className="font-medium">{a.email}{a.me ? <Badge tone="brand" className="ml-2">You</Badge> : null}</TD>
                  <TD>{fmtDateTime(a.since)}</TD>
                  <TD>{ago(a.lastSignIn)}</TD>
                  <TD>{a.twoFactor ? <Badge tone="success">On</Badge> : <Badge tone="danger">Off</Badge>}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-text-muted">Turn on your own 2-step verification in <Link href="/admin/profile" className="font-semibold text-brand-primary">My 2-step</Link>. Last platform reset: {s.lastPlatformReset ? `${fmtDateTime(s.lastPlatformReset.reset_at)} · ${s.lastPlatformReset.reason}` : 'never'}.</p>
        </div>
        <div className="flex flex-col gap-4 xl:w-[380px]">
          <AdminList admins={s.admins} />
          <PlatformReset />
        </div>
      </div>
      <Card className="flex flex-col gap-1 p-5">
        <CardTitle>Rules in force</CardTitle>
        <ul className="list-disc pl-5 text-[13px] text-text-muted">
          <li>Row-level security is forced on every table; staff reach tenant data only through audited api.admin_* functions.</li>
          <li>Support views are read-only, time-boxed and written into the tenant&apos;s own activity log.</li>
          <li>Anyone with an authenticator must enter a code before any private page (proxy).</li>
        </ul>
      </Card>
    </>
  );
}
