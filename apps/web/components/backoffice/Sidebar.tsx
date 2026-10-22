'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Box, ChartColumn, Clock, DollarSign, LayoutGrid, LogOut, Receipt, Settings, Shield, ShoppingCart, Tag,
  TriangleAlert, Truck, Undo2, Users, type LucideIcon,
} from 'lucide-react';
import { Avatar, Logo, cn } from '@laneos/ui';

interface NavItem { label: string; href: string; icon: LucideIcon; match?: string[] }

// Order and labels from the Figma sidebar (frames 1-256 and 1-1429).
const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/backoffice', icon: LayoutGrid },
  { label: 'Checkout', href: '/lane', icon: ShoppingCart },
  { label: 'Wholesale billing', href: '/backoffice/wholesale', icon: Tag },
  { label: 'Inventory', href: '/backoffice/items', icon: Box },
  { label: 'Damaged goods', href: '/backoffice/stock/damage', icon: TriangleAlert },
  { label: 'Suppliers', href: '/backoffice/suppliers', icon: Truck },
  { label: 'Purchasing (GRN)', href: '/backoffice/purchasing', icon: Receipt },
  { label: 'Returns', href: '/backoffice/credit-notes', icon: Undo2 },
  { label: 'Refunds', href: '/backoffice/refunds', icon: DollarSign },
  { label: 'Customers & credit', href: '/backoffice/customers', icon: Users },
  { label: 'Reports', href: '/backoffice/reports/sales', icon: ChartColumn },
  { label: 'Shifts & cash', href: '/backoffice/reports/shifts', icon: Clock },
  { label: 'Users & roles', href: '/backoffice/staff', icon: Shield },
  { label: 'Settings', href: '/backoffice/settings', icon: Settings, match: ['/backoffice/lanes'] },
];

function isActive(path: string, item: NavItem) {
  if (item.href === '/backoffice') return path === '/backoffice';
  return [item.href, ...(item.match ?? [])].some((h) => path === h || path.startsWith(`${h}/`));
}

export function Sidebar({
  tenantName, shopLabel, userName, roleName,
}: { tenantName: string; shopLabel: string; userName: string; roleName: string }) {
  const path = usePathname();
  return (
    <nav className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col gap-0.5 overflow-y-auto bg-sidebar p-4" aria-label="Back office">
      <div className="mb-2.5 flex items-center gap-2.5 p-2">
        <Logo />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{tenantName}</p>
          <p className="truncate text-[11px] text-sidebar-muted">{shopLabel}</p>
        </div>
      </div>
      {NAV.map((item) => {
        const active = isActive(path, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-control px-3 py-[9px] text-[13px] transition-colors',
              active ? 'bg-brand-primary font-semibold text-white' : 'font-medium text-sidebar-text hover:bg-sidebar-raised',
            )}
          >
            <Icon size={17} className={active ? 'text-white' : 'text-sidebar-muted'} aria-hidden />
            {item.label}
          </Link>
        );
      })}
      <div className="flex-1" />
      <div className="flex items-center gap-2.5 rounded-[10px] bg-sidebar-raised p-2.5">
        <Avatar name={userName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white">{userName}</p>
          <p className="truncate text-[11px] text-sidebar-muted">{roleName}</p>
        </div>
        <form action="/auth/signout" method="post">
          <button type="submit" className="rounded p-1 text-sidebar-muted hover:text-white" aria-label="Sign out" title="Sign out">
            <LogOut size={16} aria-hidden />
          </button>
        </form>
      </div>
    </nav>
  );
}
