import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Card, PageHeader } from '@laneos/ui';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Settings' };

const SECTIONS = [
  { href: '/backoffice/lanes', title: 'Devices & lanes', text: 'Checkout lanes in this shop and how many your plan allows.', ready: true },
  { href: '/backoffice/settings/branding', title: 'Branding', text: 'Logo, colours and receipt header.', ready: false },
  { href: '/backoffice/settings/security', title: 'Security', text: 'Session limits, 2FA rules and reset all access.', ready: false },
];

export default async function SettingsPage() {
  const ctx = await requireTenant();
  return (
    <>
      <PageHeader title="Settings" subtitle={`${ctx.tenant.name} · ${ctx.tenant.plan_id} plan`} />
      <div className="grid max-w-3xl gap-3">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="flex items-center gap-4 p-4 transition hover:border-brand-primary">
              <div className="flex-1">
                <p className="text-[13px] font-semibold">{s.title}{s.ready ? '' : ' · planned'}</p>
                <p className="text-xs text-text-muted">{s.text}</p>
              </div>
              <ChevronRight size={16} className="text-text-muted" aria-hidden />
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
