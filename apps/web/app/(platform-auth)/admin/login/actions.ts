'use server';

import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export interface AdminLoginState { error?: string }

export async function adminSignIn(_: AdminLoginState, form: FormData): Promise<AdminLoginState> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const admin = createAdminClient();
  const { data: gate } = await admin.schema('api').rpc('login_gate', { p_email: email });
  if ((gate as { locked: boolean } | null)?.locked) return { error: 'Too many wrong passwords. Try again later.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  await admin.schema('api').rpc('login_record', { p_email: email, p_ok: !error });
  if (error) return { error: 'That email and password do not match.' };
  const { data: ok } = await supabase.schema('api').rpc('is_platform_admin');
  if (!ok) {
    await supabase.auth.signOut();
    return { error: 'That account is not a LaneOS platform admin.' };
  }
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') redirect('/login/mfa?next=/admin');
  redirect('/admin');
}
