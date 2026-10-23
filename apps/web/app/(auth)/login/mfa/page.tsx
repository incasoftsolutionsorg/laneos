import type { Metadata } from 'next';
import { MfaChallenge } from '@/components/auth/MfaChallenge';
import { safeNext } from '@/lib/security/safe-next';

export const metadata: Metadata = { title: '2-step verification' };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <MfaChallenge next={safeNext(next)} />;
}
