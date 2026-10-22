import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_PERMS, DEFAULT_ROLES, PERM, hasPerm, permsOf } from '../src/permissions';

// The SQL migration defines the same bits and role masks; these tests keep both in step.
const sql = readFileSync(join(__dirname, '../../../supabase/migrations/20261022090100_tenancy_access.sql'), 'utf8');

describe('permission bits', () => {
  it('match public.permissions in the migration', () => {
    const rows = [...sql.matchAll(/\('([a-z_.]+)',\s+(\d+),\s+'/g)].map((m) => [m[1], Number(m[2])]);
    expect(Object.fromEntries(rows)).toEqual(PERM);
  });

  it('are distinct single bits', () => {
    const bits = Object.values(PERM);
    expect(new Set(bits).size).toBe(bits.length);
    for (const b of bits) expect(b & (b - 1)).toBe(0);
  });
});

describe('default roles', () => {
  it('match the masks api.create_tenant seeds', () => {
    const seeded = Object.fromEntries(
      [...sql.matchAll(/\(v_tenant, '([a-z_]+)', '[^']+', (\d+), true\)/g)].map((m) => [m[1], Number(m[2])]),
    );
    expect(seeded).toEqual(DEFAULT_ROLES);
  });

  it('owner has everything, cashier only sells and returns', () => {
    expect(DEFAULT_ROLES.owner).toBe(ALL_PERMS);
    expect(permsOf(DEFAULT_ROLES.cashier)).toEqual(['sale.create', 'return.create']);
    expect(hasPerm(DEFAULT_ROLES.cashier, 'item.edit')).toBe(false);
    expect(hasPerm(DEFAULT_ROLES.manager, 'settings.manage')).toBe(false);
  });
});
