'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { normalizeLkPhone } from '@laneos/core';
import type { Json } from '@laneos/db-types';
import { dbErrorText } from '@/lib/server/errors';
import { requireTenant } from '@/lib/server/context';
import { createAdminClient } from '@/lib/supabase/admin';

export interface StaffResult { error?: string; ok?: string }

async function origin() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  return `${h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')}://${host}`;
}

export interface MemberInput {
  name: string; login: string; roleId: string; shop: string; pin?: string; phone?: string;
  /** Effective permission mask chosen in the form; turned into grants/removals against the role. */
  perms: number; roleMask: number;
}

const overrides = (perms: number, role: number) => ({ permsAdd: perms & ~role, permsRemove: role & ~perms });

/** Add user (Figma 1-3237). An email gets an invite to sign in; a code makes a PIN-only cashier. */
export async function addMember(v: MemberInput): Promise<StaffResult> {
  const ctx = await requireTenant('staff.manage');
  const login = v.login.trim();
  const email = login.includes('@') ? login.toLowerCase() : null;
  if (v.name.trim().length < 2) return { error: 'Enter the full name.' };
  if (!email && !/^[A-Za-z0-9]{2,8}$/.test(login)) return { error: 'Enter an email (managers) or a 2–8 character cashier code, e.g. C104.' };
  if (!email && !v.pin) return { error: 'Cashiers sign in with a PIN — set one (4–6 digits).' };
  const phone = v.phone?.trim() ? normalizeLkPhone(v.phone) : null;
  if (v.phone?.trim() && !phone) return { error: 'Enter a mobile number like 077 123 4567.' };

  const { data: id, error } = await ctx.supabase.schema('api').rpc('add_member', { p: {
    name: v.name, roleId: v.roleId, allShops: v.shop === 'all', shopIds: v.shop === 'all' ? [] : [v.shop],
    staffCode: email ? null : login.toUpperCase(), inviteEmail: email, pin: v.pin || null, phone, ...overrides(v.perms, v.roleMask),
  } });
  if (error) {
    if (error.code === '23505') return { error: error.message.includes('code') ? 'Another person already uses that code.' : 'That email is already invited.' };
    return { error: error.message.startsWith('PLAN_LIMIT') ? `All staff seats on your plan are used (${error.message.replace(/\D+/g, '')}). Change plan in Plan & billing.` : dbErrorText(error) };
  }
  if (email) {
    const { error: inviteError } = await createAdminClient().auth.admin.inviteUserByEmail(email, {
      // Invite links carry the session in the URL fragment; /auth/confirm finishes sign-in, then they choose a password.
      redirectTo: `${await origin()}/auth/confirm?next=/reset-password`,
      data: { display_name: v.name.trim() },
    });
    if (inviteError) {
      // The membership stays; it links on first sign-in with that email (api.claim_invite).
      revalidatePath('/backoffice/staff');
      return { ok: id as string, error: inviteError.message.includes('already been registered')
        ? `${email} already has a LaneOS login — they will join this business next time they sign in.`
        : `Saved, but the invite email failed: ${inviteError.message}` };
    }
  }
  revalidatePath('/backoffice/staff');
  return { ok: id as string };
}

export async function updateMember(id: string, v: MemberInput & { active: boolean; staffCode: string }): Promise<StaffResult> {
  const ctx = await requireTenant('staff.manage');
  const phone = v.phone?.trim() ? normalizeLkPhone(v.phone) : null;
  if (v.phone?.trim() && !phone) return { error: 'Enter a mobile number like 077 123 4567.' };
  const { data: before } = await ctx.supabase.from('members').select('role_id, all_shops, is_active, perms_add, perms_remove, member_shops(shop_id)').eq('id', id).single();
  if (!before) return { error: 'Not found.' };
  const o = overrides(v.perms, v.roleMask);
  const shopIds = v.shop === 'all' ? [] : [v.shop];
  const shopsChanged = (v.shop === 'all') !== before.all_shops || (v.shop !== 'all' && before.member_shops.map((s) => s.shop_id).join() !== v.shop);
  const p: Record<string, unknown> = { id, name: v.name, staffCode: v.staffCode, phone };
  if (v.roleId !== before.role_id) p.roleId = v.roleId;
  if (shopsChanged) Object.assign(p, { allShops: v.shop === 'all', shopIds });
  if (v.active !== before.is_active) p.isActive = v.active;
  if (o.permsAdd !== Number(before.perms_add) || o.permsRemove !== Number(before.perms_remove)) Object.assign(p, o);
  const { error } = await ctx.supabase.schema('api').rpc('update_member', { p: p as Json });
  if (error) return { error: error.code === '23505' ? 'Another person already uses that code.' : dbErrorText(error) };
  if (v.pin) {
    const { error: pinError } = await ctx.supabase.schema('api').rpc('set_pin', { p_member: id, p_pin: v.pin });
    if (pinError) return { error: dbErrorText(pinError) };
  }
  revalidatePath('/backoffice/staff');
  return { ok: 'Saved.' };
}

/** Reset access (blueprint §27.5.4). Sign-in users lose every session; PIN-only cashiers are locked off their lanes. */
export async function resetMemberAccess(memberId: string, reason: string): Promise<StaffResult> {
  const ctx = await requireTenant('staff.manage');
  if (reason.trim().length < 3) return { error: 'Give a short reason (kept in the audit log).' };
  const { data: m } = await ctx.supabase.from('members').select('id, user_id').eq('id', memberId).single();
  if (!m) return { error: 'Not found.' };
  if (m.user_id) {
    const { error } = await ctx.supabase.schema('api').rpc('reset_access', { p_scope: 'user', p_id: m.user_id, p_reason: reason.trim() });
    if (error) return { error: dbErrorText(error) };
  }
  const { data: lanes } = await ctx.supabase.from('lanes').select('id').eq('active_member_id', memberId);
  for (const l of lanes ?? []) {
    const { error } = await ctx.supabase.schema('api').rpc('reset_access', { p_scope: 'lane', p_id: l.id, p_reason: reason.trim() });
    if (error) return { error: dbErrorText(error) };
  }
  revalidatePath('/backoffice/staff');
  return { ok: m.user_id ? 'Signed out everywhere. They must sign in again.' : `Locked off ${lanes?.length ?? 0} lane(s). They must enter their PIN again.` };
}

export async function endSession(sessionId: string): Promise<StaffResult> {
  const ctx = await requireTenant();
  const { error } = await ctx.supabase.schema('api').rpc('end_session', { p_session: sessionId });
  if (error) return { error: dbErrorText(error) };
  revalidatePath('/backoffice/staff');
  revalidatePath('/backoffice/profile');
  return { ok: 'Session ended.' };
}
