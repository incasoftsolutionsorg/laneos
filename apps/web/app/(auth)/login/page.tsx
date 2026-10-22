import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/AuthForms';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  return <LoginForm next={next} reason={reason} />;
}
