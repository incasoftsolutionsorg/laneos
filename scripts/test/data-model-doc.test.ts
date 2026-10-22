// Keeps docs/08-data-model.md in step with supabase/migrations: every table a migration creates
// and every migration file must be documented there.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../..');
const migrationsDir = join(root, 'supabase/migrations');
const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
const doc = readFileSync(join(root, 'docs/08-data-model.md'), 'utf8');

const created = new Set<string>();
const dropped = new Set<string>();
for (const file of migrations) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8');
  for (const m of sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)) created.add(m[1]!);
  for (const m of sql.matchAll(/drop table (?:if exists )?public\.(\w+)/gi)) dropped.add(m[1]!);
}
const tables = [...created].filter((t) => !dropped.has(t));

describe('docs/08-data-model.md', () => {
  it('finds tables in the migrations', () => {
    expect(tables.length).toBeGreaterThan(20);
  });

  it.each(tables)('documents table %s in the table catalogue', (table) => {
    expect(doc, `add a "#### \`${table}\`" section to docs/08-data-model.md §3`).toContain(`#### \`${table}\``);
  });

  it.each(migrations)('lists migration %s in the migration log', (file) => {
    expect(doc, `add ${file} to docs/08-data-model.md §7`).toContain(`\`${file}\``);
  });

  it.each([...dropped])('no longer documents dropped table %s', (table) => {
    expect(doc).not.toContain(`#### \`${table}\``);
  });
});
