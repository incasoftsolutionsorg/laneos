'use server';

import { revalidatePath } from 'next/cache';
import type { Json } from '@laneos/db-types';
import type { ImportProblem, ImportRow } from '@/lib/import/items';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

/** One chunk (≤ 250 rows) of an already-validated file. The database applies each row on its own. */
export async function importChunk(rows: ImportRow[]): Promise<{ created: number; updated: number; problems: ImportProblem[]; error?: string }> {
  const ctx = await requireTenant('item.edit');
  if (rows.length > 250) return { created: 0, updated: 0, problems: [], error: 'Send at most 250 rows at a time.' };
  const { data, error } = await ctx.supabase.schema('api').rpc('import_items', { p_shop: ctx.shop.id, p_rows: rows as unknown as Json });
  if (error) return { created: 0, updated: 0, problems: [], error: dbErrorText(error) };
  const r = data as unknown as { created: number; updated: number; errors: ImportProblem[] };
  revalidatePath('/backoffice/items');
  return { created: r.created, updated: r.updated, problems: r.errors };
}
