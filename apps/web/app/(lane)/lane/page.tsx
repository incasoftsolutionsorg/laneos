import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, Logo, buttonClass } from '@laneos/ui';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Choose a lane' };

export default async function LanePickerPage() {
  const ctx = await requireTenant('sale.create');
  const { data: lanes } = await ctx.supabase.from('lanes').select('id, code, name, status').eq('shop_id', ctx.shop.id).order('code');

  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-6">
      <Card className="flex w-full max-w-lg flex-col gap-5 p-8">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <h1 className="text-xl font-bold">{ctx.tenant.name} · {ctx.shop.name}</h1>
            <p className="text-[13px] text-text-muted">Choose the lane this device is at.</p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {(lanes ?? []).map((l) => (
            l.status === 'active' ? (
              <Link key={l.id} href={`/lane/${l.id}`} className="flex items-center gap-3 rounded-card border border-border p-3 transition hover:border-brand-primary">
                <Badge tone="brand">{l.code}</Badge>
                <span className="flex-1 text-[13px] font-semibold">{l.name}</span>
                <span className="text-xs font-semibold text-brand-primary">Open</span>
              </Link>
            ) : (
              <div key={l.id} className="flex items-center gap-3 rounded-card border border-border p-3 opacity-60">
                <Badge>{l.code}</Badge>
                <span className="flex-1 text-[13px] font-semibold">{l.name}</span>
                <Badge tone="danger">Disabled</Badge>
              </div>
            )
          ))}
        </div>
        <p className="text-xs text-text-muted">
          Cashier PIN login on a registered lane comes with the PIN-login task. For now, sign in as staff and pick a lane.
        </p>
        <Link href="/backoffice" className={buttonClass('secondary')}>Back office</Link>
      </Card>
    </main>
  );
}
