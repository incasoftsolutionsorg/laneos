'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity, CreditCard, Eye, LayoutGrid, LifeBuoy, LogOut, Receipt, ScrollText, Shield, TriangleAlert, Users, type LucideIcon,
} from 'lucide-react';
import { Logo, cn } from '@laneos/ui';

const NAV: { label: string; href: string; icon: LucideIcon }[] = [
  { label: 'Overview', href: '/admin', icon: LayoutGrid },
  { label: 'Tenants', href: '/admin/tenants', icon: Users },
  { label: 'Billing', href: '/admin/billing', icon: Receipt },
  { label: 'Plans', href: '/admin/plans', icon: CreditCard },
  { label: 'Overdue', href: '/admin/overdue', icon: TriangleAlert },
  { label: 'Support tickets', href: '/admin/tickets', icon: LifeBuoy },
  { label: 'Live activity', href: '/admin/live-activity', icon: Activity },
  { label: 'Support view', href: '/admin/impersonation', icon: Eye },
  { label: 'Security', href: '/admin/security', icon: Shield },
  { label: 'Audit', href: '/admin/audit', icon: ScrollText },
];

/** Platform admin sidebar. Indigo accent (`platform-accent`) so staff never mistake it for a tenant back office. */
export function AdminSidebar({ email }: { email: string }) {
  const path = usePathname();
  return (
    <nav className="sticky top-0 flex h-screen w-[232px] shrink-0 flex-col gap-0.5 overflow-y-auto bg-sidebar p-4" aria-label="Platform admin">
      <div className="mb-3 flex items-center gap-2.5 p-2">
        <Logo />
        <div>
          <p className="text-sm font-bold text-white">LaneOS</p>
          <p className="text-[11px] font-semibold text-platform-accent">Platform admin</p>
        </div>
      </div>
      {NAV.map((n) => {
        const on = n.href === '/admin' ? path === '/admin' : path === n.href || path.startsWith(`${n.href}/`);
        const Icon = n.icon;
        return (
          <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined}
            className={cn('flex items-center gap-2.5 rounded-control px-3 py-2 text-[13px]', on ? 'bg-platform-accent font-semibold text-white' : 'font-medium text-sidebar-text hover:bg-sidebar-raised')}>
            <Icon size={16} className={on ? 'text-white' : 'text-sidebar-muted'} aria-hidden />{n.label}
          </Link>
        );
      })}
      <div className="flex-1" />
      <div className="flex items-center gap-2 rounded-[10px] bg-sidebar-raised p-2.5">
        <p className="min-w-0 flex-1 truncate text-xs text-sidebar-text">{email}</p>
        <form action="/auth/signout" method="post">
          <button type="submit" className="rounded p-1 text-sidebar-muted hover:text-white" aria-label="Sign out" title="Sign out"><LogOut size={15} aria-hidden /></button>
        </form>
      </div>
    </nav>
  );
}
