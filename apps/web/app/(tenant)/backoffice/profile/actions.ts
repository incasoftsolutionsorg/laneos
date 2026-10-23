'use server';

import { revalidatePath } from 'next/cache';
import { createClient as createPlainClient } from '@supabase/supabase-js';
import { normalizeLkPhone } from '@laneos/core';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';

export interface ProfileResult { error?: string; ok?: string }

export async function saveProfile(v: { name: string; email: string; phone: string; language: string }): Promise<ProfileResult> {
  const ctx = await requireTenant();
  if (v.name.trim().length < 2) return { error: 'Enter your full name.' };
  const phone = v.phone.trim() ? normalizeLkPhone(v.phone) : null;
  if (v.phone.trim() && !phone) return { error: 'Enter a mobile number like 077 123 4567.' };
  const { error } = await ctx.supabase.schema('api').rpc('update_profile', { p_name: v.name, p_phone: phone ?? '', p_language: v.language });
  if (error) return { error: dbErrorText(error) };
  let ok = 'Profile saved.';
  const email = v.email.trim().toLowerCase();
  if (email && email !== ctx.email.toLowerCase()) {
    // Supabase sends a confirmation link to the new address; the change applies once it is opened.
    const { error: emailError } = await ctx.supabase.auth.updateUser({ email });
    if (emailError) return { error: emailError.message };
    ok = `Profile saved. Open the link we sent to ${email} to confirm the new email.`;
  }
  revalidatePath('/backoffice', 'layout');
  return { ok };
}

/** Change password: the current password is checked first, then every other session ends (blueprint §27.5.3). */
export async function changePassword(current: string, next: string, confirm: string): Promise<ProfileResult> {
  const ctx = await requireTenant();
  if (next.length < 10) return { error: 'Use at least 10 characters for the new password.' };
  if (next !== confirm) return { error: 'The new passwords do not match.' };
  if (next === current) return { error: 'Choose a password you have not used here.' };
  // Check the current password on a throw-away client so this session's cookies are untouched.
  const probe = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { error: wrong } = await probe.auth.signInWithPassword({ email: ctx.email, password: current });
  if (wrong) return { error: 'Your current password is not right.' };
  await probe.auth.signOut({ scope: 'local' });
  const { error } = await ctx.supabase.auth.updateUser({ password: next });
  if (error) return { error: error.code === 'insufficient_aal' ? 'Enter a code from your authenticator first (sign in again).' : error.message };
  await ctx.supabase.auth.signOut({ scope: 'others' });
  revalidatePath('/backoffice/profile');
  return { ok: 'Password changed. You were signed out on every other device.' };
}
