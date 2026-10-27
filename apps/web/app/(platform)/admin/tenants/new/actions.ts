'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { normalizeLkPhone } from '@laneos/core';
import type { Json } from '@laneos/db-types';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/server/admin';

export interface NewTenantState { error?: string }

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'shop';

/** SLICE-001: LaneOS staff set up a business for a customer. The owner gets an invite email (or, if they already
 *  have a LaneOS login, simply finds the business when they sign in). */
export async function createTenantForCustomer(_: NewTenantState, form: FormData): Promise<NewTenantState> {
  const { supabase } = await requireAdmin();
  const v = Object.fromEntries(form) as Record<string, string>;
  const email = (v.email ?? '').trim().toLowerCase();
  const code = (v.shopCode ?? '').trim().toUpperCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter the owner's email." };
  if ((v.ownerName ?? '').trim().length < 2) return { error: "Enter the owner's name." };
  if ((v.businessName ?? '').trim().length < 2) return { error: 'Enter the business name.' };
  if ((v.shopName ?? '').trim().length < 2) return { error: "Enter the first shop's name." };
  if (!/^[A-Z0-9]{2,8}$/.test(code)) return { error: 'Shop code: 2–8 letters or digits, e.g. KDY1.' };
  const mobile = v.mobile?.trim() ? normalizeLkPhone(v.mobile) : null;
  if (v.mobile?.trim() && !mobile) return { error: 'Enter a mobile number like 077 123 4567.' };

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const origin = `${h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')}://${host}`;
  const { error: inviteError } = await createAdminClient().auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
    data: { display_name: v.ownerName!.trim() },
  });
  if (inviteError && !inviteError.message.toLowerCase().includes('already been registered')) return { error: `Invite failed: ${inviteError.message}` };

  const { data, error } = await supabase.schema('api').rpc('admin_create_tenant', {
    p_owner_email: email, p_name: v.businessName!.trim(), p_slug: `${slugify(v.businessName!)}-${Math.random().toString(36).slice(2, 8)}`,
    p_shop_code: code, p_shop_name: v.shopName!.trim(), p_owner_name: v.ownerName!.trim(), p_plan: v.plan ?? 'single', p_trial: v.trial === 'on',
    p_details: { city: v.city || null, businessType: v.businessType || null, businessRegNo: v.businessRegNo || null, mobile } as Json,
  });
  if (error) return { error: error.message.replace(/^[A-Z_]+: ?/, '').replace(/^./, (c) => c.toUpperCase()) };
  redirect(`/admin/tenants/${data as string}`);
}
