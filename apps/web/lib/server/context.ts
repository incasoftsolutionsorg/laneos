import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { hasPerm, type Permission } from '@laneos/core';
import { createClient } from '@/lib/supabase/server';

/** Not secret: which shop the user is looking at (blueprint §27.5.1). __Host- needs HTTPS. */
export const CTX_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-laneos-ctx' : 'laneos-ctx';

export interface Shop { id: string; code: string; name: string }

/** The signed-in user, their membership, tenant and shops. Cached per request. */
export const getContext = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/login');
  const userId = data.claims.sub;
  const email = (data.claims.email as string | undefined) ?? '';

  const findMember = () => supabase
    .from('members')
    .select('id, display_name, tenant_id, all_shops, perms_add, perms_remove, role:roles(key, name, permissions)')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  let { data: member } = await findMember();
  // First sign-in after a staff invite: link the invited membership to this login.
  if (!member && (await supabase.schema('api').rpc('claim_invite')).data) ({ data: member } = await findMember());

  if (!member) return { supabase, userId, email, member: null } as const;

  const [{ data: tenant }, { data: allShops }, { data: memberShops }] = await Promise.all([
    supabase.from('tenants').select('id, name, plan_id, status, rounding_unit_cents, brand_color, theme, auto_seasonal_theme, idle_timeout_min, require_2fa, logo_path, entitlements:tenant_entitlements(max_shops, transfers, head_office)').eq('id', member.tenant_id).single(),
    // Oldest first: with no shop chosen yet, the business's first shop is the default.
    supabase.from('shops').select('id, code, name').eq('is_active', true).order('created_at'),
    supabase.from('member_shops').select('shop_id').eq('member_id', member.id),
  ]);

  const allowed = new Set((memberShops ?? []).map((s) => s.shop_id));
  const shops: Shop[] = (allShops ?? []).filter((s) => member.all_shops || allowed.has(s.id));
  const chosen = (await cookies()).get(CTX_COOKIE)?.value;
  const shop = shops.find((s) => s.id === chosen) ?? shops[0] ?? null;
  const role = member.role!;

  return {
    supabase,
    userId,
    email,
    member: { id: member.id, name: member.display_name, roleKey: role.key, roleName: role.name, perms: (Number(role.permissions) | Number(member.perms_add)) & ~Number(member.perms_remove) },
    tenant: tenant!,
    shops,
    shop,
  } as const;
});

export type AppContext = Awaited<ReturnType<typeof getContext>>;
export type TenantContext = Extract<AppContext, { member: { id: string } }>;

/** For pages inside the back office: a member with a shop, or redirect. */
export async function requireTenant(perm?: Permission): Promise<TenantContext & { shop: Shop }> {
  const ctx = await getContext();
  if (!ctx.member) redirect('/welcome');
  if (!ctx.shop) redirect('/welcome');
  if (perm && !hasPerm(ctx.member.perms, perm)) notFound();
  return ctx as TenantContext & { shop: Shop };
}
