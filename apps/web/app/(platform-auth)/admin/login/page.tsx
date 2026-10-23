import type { Metadata } from 'next';
import { AdminLoginForm } from '@/components/admin/AdminLoginForm';

export const metadata: Metadata = { title: 'LaneOS admin sign in' };

// Admin login (Figma 3-2736, not read — compare when Figma access returns). Separate from shop sign-in.
export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar p-6">
      <AdminLoginForm forbidden={reason === 'forbidden'} />
    </div>
  );
}
