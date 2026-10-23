import { NextResponse, type NextRequest } from 'next/server';
import type { Json } from '@laneos/db-types';
import { createClient } from '@/lib/supabase/server';

interface PendingTenant {
  businessName: string; shopName: string; shopCode: string; ownerName: string;
  plan?: string; details?: Record<string, string | null | undefined>;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'shop';

// Email links (sign-up confirmation, password reset) land here with a one-time code.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const nextParam = url.searchParams.get('next') ?? '/backoffice';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/backoffice';

  if (!code) return NextResponse.redirect(new URL('/login', url));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(new URL('/login?reason=link', url));

  // First confirmation after sign-up: create the business from the sign-up details.
  const pending = data.user.user_metadata?.pending_tenant as PendingTenant | null | undefined;
  if (pending) {
    const { data: member } = await supabase.from('members').select('id').eq('user_id', data.user.id).maybeSingle();
    if (!member) {
      await supabase.schema('api').rpc('create_tenant', {
        p_name: pending.businessName,
        p_slug: `${slugify(pending.businessName)}-${data.user.id.slice(0, 6)}`,
        p_shop_code: pending.shopCode,
        p_shop_name: pending.shopName,
        p_owner_name: pending.ownerName,
        p_plan: pending.plan ?? 'single',
        p_details: (pending.details ?? {}) as Json,
      });
      await supabase.auth.updateUser({ data: { pending_tenant: null } });
      await supabase.auth.refreshSession(); // the new token carries the tenant claims
    }
  }
  return NextResponse.redirect(new URL(next, url));
}
