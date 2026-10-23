'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftRight, Box, Building2, ChartColumn, Clock, CreditCard, DollarSign, LayoutGrid, LogOut, Receipt, ScrollText, Settings,
  Shield, ShoppingCart, Store, Tag, TriangleAlert, Truck, Undo2, Users, type LucideIcon,
} from 'lucide-react';
import { Avatar, Logo, cn } from '@laneos/ui';
import { switchShop } from '@/app/(tenant)/backoffice/shop-actions';

interface NavItem { label: string; href: string; icon: LucideIcon; match?: string[] }

// Order and labels from the Figma sidebar (frames 1-256 and 1-1429).
const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/backoffice', icon: LayoutGrid },
  { label: 'Checkout', href: '/lane', icon: ShoppingCart },
  { label: 'Wholesale billing', href: '/backoffice/wholesale', icon: Tag },
  { label: 'Inventory', href: '/backoffice/items', icon: Box, match: ['/backoffice/labels', '/backoffice/stock/counts', '/backoffice/stock/expiry', '/backoffice/stock/wastage'] },
  { label: 'Damaged goods', href: '/backoffice/stock/damage', icon: TriangleAlert },
  { label: 'Suppliers', href: '/backoffice/suppliers', icon: Truck },
  { label: 'Purchasing (GRN)', href: '/backoffice/purchasing', icon: Receipt, match: ['/backoffice/purchasing'] },
  { label: 'Returns', href: '/backoffice/credit-notes', icon: Undo2 },
  { label: 'Refunds', href: '/backoffice/refunds', icon: DollarSign },
  { label: 'Customers & credit', href: '/backoffice/customers', icon: Users },
  { label: 'Reports', href: '/backoffice/reports/sales', icon: ChartColumn, match: ['margin', 'items', 'stock', 'damage', 'credit-notes', 'tax'].map((k) => `/backoffice/reports/${k}`) },
  { label: 'Shifts & cash', href: '/backoffice/reports/shifts', icon: Clock },
  { label: 'Users & roles', href: '/backoffice/staff', icon: Shield },
  { label: 'Settings', href: '/backoffice/settings', icon: Settings, match: ['/backoffice/lanes', '/backoffice/promotions', '/backoffice/billing', '/backoffice/profile', '/backoffice/support'] },
];

// Head office sidebar (Figma 3-261).
const CHAIN_NAV: NavItem[] = [
  { label: 'Overview', href: '/backoffice/head-office', icon: LayoutGrid },
  { label: 'Shops', href: '/backoffice/shops', icon: Store },
  { label: 'Stock across shops', href: '/backoffice/stock-across-shops', icon: Box },
  { label: 'Transfers', href: '/backoffice/transfers', icon: ArrowLeftRight },
  { label: 'Central pricing', href: '/backoffice/pricing', icon: Tag },
  { label: 'Revenue & reports', href: '/backoffice/revenue', icon: ChartColumn },
  { label: 'Damage & wastage', href: '/backoffice/damage-across-shops', icon: TriangleAlert },
  { label: 'Activity logs', href: '/backoffice/activity-logs', icon: ScrollText },
  { label: 'Users & access', href: '/backoffice/access', icon: Users },
  { label: 'Plan & billing', href: '/backoffice/plan', icon: CreditCard },
  { label: 'Settings', href: '/backoffice/settings', icon: Settings },
];

const CHAIN_PATHS = CHAIN_NAV.filter((n) => n.href !== '/backoffice/settings').map((n) => n.href);

function isActive(path: string, item: NavItem) {
  if (item.href === '/backoffice') return path === '/backoffice';
  return [item.href, ...(item.match ?? [])].some((h) => path === h || path.startsWith(`${h}/`));
}

export function Sidebar({
  tenantName, shopLabel, userName, roleName, active, shops, shopId, chain,
}: {
  tenantName: string; shopLabel: string; userName: string; roleName: string;
  perms?: number; multiShop?: boolean;
  /** Path to highlight when the page lives outside /backoffice (e.g. the lane's return screen). */
  active?: string;
  shops?: { id: string; code: string; name: string }[];
  shopId?: string;
  /** Head office is available (more than one shop allowed). */
  chain?: boolean;
}) {
  const pathname = usePathname();
  const path = active ?? pathname;
  const inChain = !!chain && CHAIN_PATHS.some((h) => path === h || path.startsWith(`${h}/`));
  const nav = inChain ? CHAIN_NAV : NAV;
  return (
    <nav className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col gap-0.5 overflow-y-auto bg-sidebar p-4" aria-label="Back office">
      <div className="mb-2.5 flex items-center gap-2.5 p-2">
        <Logo />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{tenantName}</p>
          <p className="truncate text-[11px] text-sidebar-muted">{inChain ? `Head office · ${shops?.length ?? 1} shops` : shopLabel}</p>
        </div>
      </div>
      {chain ? (
        <div className="mb-2 flex flex-col gap-1.5 rounded-control bg-sidebar-raised p-2">
          {inChain ? null : (
            <Link href="/backoffice/head-office" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold text-white hover:bg-sidebar">
              <Building2 size={14} aria-hidden /> Head office
            </Link>
          )}
          {shops && shops.length > 1 ? (
            <label className="flex flex-col gap-1 px-2 text-[11px] text-sidebar-muted">
              {inChain ? 'Open a shop' : 'Shop'}
              <select
                value={inChain ? '' : shopId}
                onChange={(e) => e.target.value && void switchShop(e.target.value, inChain ? '/backoffice' : path)}
                className="rounded-md border border-sidebar bg-sidebar px-2 py-1.5 text-xs text-white"
              >
                {inChain ? <option value="">Choose…</option> : null}
                {shops.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      {nav.map((item) => {
        const on = isActive(path, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-control px-3 py-[9px] text-[13px] transition-colors',
              on ? 'bg-brand-primary font-semibold text-white' : 'font-medium text-sidebar-text hover:bg-sidebar-raised',
            )}
          >
            <Icon size={17} className={on ? 'text-white' : 'text-sidebar-muted'} aria-hidden />
            {item.label}
          </Link>
        );
      })}
      <div className="flex-1" />
      <div className="flex items-center gap-2.5 rounded-[10px] bg-sidebar-raised p-2.5">
        <Link href="/backoffice/profile" className="flex min-w-0 flex-1 items-center gap-2.5" title="My profile">
          <Avatar name={userName} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{userName}</p>
            <p className="truncate text-[11px] text-sidebar-muted">{roleName}{inChain ? ' · Head office' : ''}</p>
          </div>
        </Link>
        <form action="/auth/signout" method="post">
          <button type="submit" className="rounded p-1 text-sidebar-muted hover:text-white" aria-label="Sign out" title="Sign out">
            <LogOut size={16} aria-hidden />
          </button>
        </form>
      </div>
    </nav>
  );
}
