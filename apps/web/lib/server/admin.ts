import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/** LaneOS staff only. Everything else on /admin calls api.admin_* functions, which check again in the database. */
export const requireAdmin = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/admin/login');
  const { data: ok } = await supabase.schema('api').rpc('is_platform_admin');
  if (!ok) redirect('/admin/login?reason=forbidden');
  return { supabase, userId: data.claims.sub, email: (data.claims.email as string | undefined) ?? '' };
});
