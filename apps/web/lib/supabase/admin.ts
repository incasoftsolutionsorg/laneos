import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@laneos/db-types';

/** Service-role client. Only for Auth admin calls (staff invites); never for tenant data, which goes through RLS. */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
