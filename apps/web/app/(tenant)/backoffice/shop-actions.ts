'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CTX_COOKIE, requireTenant } from '@/lib/server/context';

/** Switch the shop the back office is looking at (blueprint §27.5.1). Only shops the member may access. */
export async function switchShop(shopId: string, next: string) {
  const ctx = await requireTenant();
  if (!ctx.shops.some((s) => s.id === shopId)) return;
  (await cookies()).set(CTX_COOKIE, shopId, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 180,
  });
  redirect(next.startsWith('/backoffice') ? next : '/backoffice');
}
