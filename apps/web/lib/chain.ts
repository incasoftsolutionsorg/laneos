import 'server-only';
import type { Permission } from '@laneos/core';
import { requireTenant } from '@/lib/server/context';

/** Head-office pages: a member with the permission, on a plan that allows more than one shop. */
export async function requireChain(perm: Permission = 'reports.view') {
  const ctx = await requireTenant(perm);
  const enabled = (ctx.tenant.entitlements?.max_shops ?? 1) > 1 || ctx.shops.length > 1;
  return { ctx, enabled };
}

export interface ChainShop {
  id: string; code: string; name: string; isActive: boolean;
  salesToday: number; billsToday: number; salesYesterday: number; lanes: number; lanesOnline: number; offlineLanes: string[];
  stockValue: number; lowStock: number; syncIssues: number; damagePending: number; lastVariance: number | null; lastPricePush: string | null;
}

export interface ChainReportShop {
  id: string; code: string; name: string; sales: number; bills: number; lineSales: number; margin: number; returns: number;
  wholesale: number; damageValue: number; damageReports: number; damagePending: number; wastage: number; days: { day: string; net: number }[];
}

export const TRANSFER_STATUS: Record<string, { text: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' }> = {
  requested: { text: 'Requested', tone: 'info' },
  approved: { text: 'Approved', tone: 'brand' },
  rejected: { text: 'Rejected', tone: 'danger' },
  in_transit: { text: 'In transit', tone: 'warning' },
  received: { text: 'Received', tone: 'success' },
  received_with_variance: { text: 'Variance to check', tone: 'danger' },
  closed: { text: 'Closed', tone: 'success' },
  cancelled: { text: 'Cancelled', tone: 'neutral' },
};
