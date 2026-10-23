import type { Metadata } from 'next';
import { Badge, Card, Logo, PageHeader } from '@laneos/ui';
import { RegisterDeviceButton } from '@/components/lane/RegisterDeviceButton';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Register device' };

// "Register device" flow from Devices & lanes (Figma 11-4125; no dedicated frame, Appendix E.5).
export default async function RegisterDevicePage() {
  const ctx = await requireTenant('staff.manage');
  const { data: lanes } = await ctx.supabase.from('lanes').select('id, code, name, status, registered_at').eq('shop_id', ctx.shop.id).order('code');

  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-6">
      <Card className="flex w-full max-w-xl flex-col gap-5 p-8">
        <div className="flex items-center gap-3">
          <Logo />
          <PageHeader title="Register this device" subtitle={`${ctx.tenant.name} · ${ctx.shop.name}. Pick the lane this PC or tablet sits at.`} />
        </div>
        <ul className="flex flex-col gap-2">
          {(lanes ?? []).map((l) => (
            <li key={l.id} className="flex items-center gap-3 rounded-card border border-border p-3">
              <Badge tone="brand">{l.code}</Badge>
              <span className="flex-1 text-[13px] font-semibold">{l.name}</span>
              {l.registered_at ? <Badge tone="success">Registered</Badge> : <Badge>Not registered</Badge>}
              {l.status === 'active' ? <RegisterDeviceButton laneId={l.id} rotate={!!l.registered_at} /> : <Badge tone="danger">Disabled</Badge>}
            </li>
          ))}
        </ul>
        <p className="text-xs text-text-muted">
          Registering creates a secret key kept only in this browser. Registering a lane again moves it to this device and
          the old device can no longer sell on it.
        </p>
      </Card>
    </main>
  );
}
