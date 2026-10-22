import { Sidebar } from '@/components/backoffice/Sidebar';
import { requireTenant } from '@/lib/server/context';

export default async function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        tenantName={ctx.tenant.name}
        shopLabel={`${ctx.shop.name} · ${ctx.shop.code}`}
        userName={ctx.member.name}
        roleName={ctx.member.roleName}
      />
      <main className="flex min-w-0 flex-1 flex-col gap-[18px] p-7">{children}</main>
    </div>
  );
}
