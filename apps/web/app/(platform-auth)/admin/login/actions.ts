'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface AdminLoginState { error?: string }

export async function adminSignIn(_: AdminLoginState, form: FormData): Promise<AdminLoginState> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
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
