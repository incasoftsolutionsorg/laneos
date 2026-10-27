'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { normalizeLkPhone } from '@laneos/core';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export interface FormState { error?: string; message?: string }

const safeNext = (next: unknown) =>
  typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/backoffice';

async function origin() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  // Failed-login lock (Settings → Security, blueprint §27.6): checked and recorded with the service role,
  // because nobody is signed in yet and the counts must not be writable by the browser.
  const admin = createAdminClient();
  const { data: gate } = await admin.schema('api').rpc('login_gate', { p_email: email });
  const g = gate as { locked: boolean; until: string | null } | null;
  if (g?.locked) {
    const mins = g.until ? Math.max(1, Math.ceil((Date.parse(g.until) - Date.now()) / 60_000)) : 15;
    return { error: `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset the password.` };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code !== 'email_not_confirmed') await admin.schema('api').rpc('login_record', { p_email: email, p_ok: false });
    return {
      error: error.code === 'email_not_confirmed'
        ? 'Confirm your email first — check your inbox for the link.'
        : 'That email and password do not match.',
    };
  }
  await admin.schema('api').rpc('login_record', { p_email: email, p_ok: true });

  // "One session per person": signing in here ends this person's other sessions.
  const { data: strict } = await supabase.from('tenants').select('strict_sessions').maybeSingle();
  if (strict?.strict_sessions) await supabase.auth.signOut({ scope: 'others' });
  // An enrolled authenticator means a code is needed before the back office opens.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
    redirect(`/login/mfa?next=${encodeURIComponent(safeNext(form.get('next')))}`);
  }
  redirect(safeNext(form.get('next')));
}

const Register = z.object({
  ownerName: z.string().trim().min(2, 'Enter your name').max(80),
  email: z.email('Enter a valid email'),
  password: z.string().min(10, 'Use at least 10 characters'),
  businessName: z.string().trim().min(2, 'Enter the shop name').max(120),
  shopName: z.string().trim().min(2, 'Enter the first shop name').max(120),
  shopCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, 'Shop code: 2–8 letters or digits, e.g. KDY1'),
  businessRegNo: z.string().trim().max(40).optional(),
  mobile: z.string().trim().refine((v) => normalizeLkPhone(v) != null, 'Enter a mobile number like 077 123 4567'),
  city: z.string().trim().max(60).optional(),
  businessType: z.enum(['grocery', 'supermarket', 'pharmacy', 'hardware', 'other']),
  plan: z.enum(['lite', 'single', 'growth']),
  agree: z.literal('on', { message: 'Agree to the Terms and the Data Processing Agreement to continue' }),
});

export async function register(_: FormState, form: FormData): Promise<FormState> {
  const parsed = Register.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;

  const supabase = await createClient();
  // The business is created after the email is confirmed (app/auth/callback), from this metadata.
  const { error } = await supabase.auth.signUp({
    email: v.email,
    password: v.password,
    options: {
      emailRedirectTo: `${await origin()}/auth/callback?next=/backoffice`,
      data: { pending_tenant: {
        businessName: v.businessName, shopName: v.shopName, shopCode: v.shopCode, ownerName: v.ownerName, plan: v.plan,
        details: { businessRegNo: v.businessRegNo, city: v.city, businessType: v.businessType, mobile: normalizeLkPhone(v.mobile) },
      } },
    },
  });
  if (error) return { error: error.message };
  return { message: `We sent a confirmation link to ${v.email}. Open it to finish setting up your shop.` };
}

export async function requestReset(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim();
  if (!email) return { error: 'Enter your email.' };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/callback?next=/reset-password` });
  // Same answer whether or not the account exists, so the form cannot be used to find accounts.
  return { message: 'If that email has an account, a reset link is on its way.' };
}

export async function updatePassword(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get('password') ?? '');
  if (password.length < 10) return { error: 'Use at least 10 characters.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  // Password changed: end every other session of this user (blueprint §27.5.3).
  await supabase.auth.signOut({ scope: 'others' });
  redirect('/backoffice');
}
