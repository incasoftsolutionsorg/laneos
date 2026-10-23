// Permission bitmask. The same bits are defined in SQL (app.perm_* in the tenancy migration);
// a unit test keeps the two lists in step. Never reuse or renumber a bit.

export const PERM = {
  'sale.create': 1 << 0,
  'return.create': 1 << 1,
  'item.edit': 1 << 2,
  'stock.adjust': 1 << 3,
  'grn.post': 1 << 4,
  'promotion.manage': 1 << 5,
  'staff.manage': 1 << 6,
  'reports.view': 1 << 7,
  'settings.manage': 1 << 8,
  'cash.pickup': 1 << 9,
  'shift.manage': 1 << 10,
  'transfer.approve': 1 << 11,
  'customer.manage': 1 << 12,
  'supplier.manage': 1 << 13,
} as const;

export type Permission = keyof typeof PERM;

export const ALL_PERMS = Object.values(PERM).reduce((a, b) => a | b, 0);

export function hasPerm(mask: number, perm: Permission): boolean {
  return (mask & PERM[perm]) !== 0;
}

export function permsOf(mask: number): Permission[] {
  return (Object.keys(PERM) as Permission[]).filter((p) => hasPerm(mask, p));
}

function maskOf(...perms: Permission[]): number {
  return perms.reduce((m, p) => m | PERM[p], 0);
}

/** Default roles created for every new tenant (api.create_tenant seeds the same masks). */
export const DEFAULT_ROLES = {
  owner: ALL_PERMS,
  manager: maskOf(
    'sale.create', 'return.create', 'item.edit', 'stock.adjust', 'grn.post', 'promotion.manage',
    'staff.manage', 'reports.view', 'cash.pickup', 'shift.manage', 'customer.manage', 'supplier.manage',
  ),
  cashier: maskOf('sale.create', 'return.create'),
  stock_keeper: maskOf('stock.adjust', 'grn.post'),
  accountant: maskOf('reports.view', 'supplier.manage'),
} as const;

export type RoleKey = keyof typeof DEFAULT_ROLES;

/** Plain-language names for the permission toggles in Users & roles (Figma 1-3237). */
export const PERM_LABEL: Record<Permission, { label: string; hint?: string }> = {
  'sale.create': { label: 'Sell at the lane' },
  'return.create': { label: 'Returns with receipt' },
  'item.edit': { label: 'Edit items & prices' },
  'stock.adjust': { label: 'Stock adjustments', hint: 'Counts, damage, wastage' },
  'grn.post': { label: 'Receive goods (GRN)', hint: 'Purchase orders too' },
  'promotion.manage': { label: 'Promotions & labels' },
  'staff.manage': { label: 'Manage staff', hint: 'Add users, set PINs, reset access' },
  'reports.view': { label: 'View reports' },
  'settings.manage': { label: 'Business settings', hint: 'Owner only by default' },
  'cash.pickup': { label: 'Cash pickups', hint: 'Needs supervisor' },
  'shift.manage': { label: 'Open & close any shift' },
  'transfer.approve': { label: 'Approve transfers' },
  'customer.manage': { label: 'Customers & credit', hint: 'Receive payments, set limits' },
  'supplier.manage': { label: 'Suppliers & payments' },
};
