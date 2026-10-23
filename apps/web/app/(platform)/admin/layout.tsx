import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { requireAdmin } from '@/lib/server/admin';

// Platform admin shell (Figma 3-2775 family). Every page is for LaneOS staff only.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireAdmin();
  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar email={email} />
      <main className="flex min-w-0 flex-1 flex-col gap-[18px] p-7">{children}</main>
    </div>
  );
}
