import type { Metadata } from 'next';
import { ConfirmLink } from '@/components/auth/ConfirmLink';
import { safeNext } from '@/lib/security/safe-next';

export const metadata: Metadata = { title: 'Signing you in' };

// Landing page for invite links (staff invites, businesses created by LaneOS staff). Supabase puts the session
// in the URL fragment for these links, which a server route cannot read, so the browser finishes the sign-in.
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <ConfirmLink next={safeNext(next, '/reset-password')} />;
}
