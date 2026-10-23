import { activeSeason, brandStyle } from '@laneos/ui';
import { IdleSignout } from '@/components/backoffice/IdleSignout';
import { Sidebar } from '@/components/backoffice/Sidebar';
import type { requireTenant } from '@/lib/server/context';

type Ctx = Awaited<ReturnType<typeof requireTenant>>;

/** Sidebar + main column used by every back-office screen (Figma 1-256), and by the lane's
 *  close-shift and return screens, which the design shows inside the back office. */
export function BackofficeShell({ ctx, active, children }: { ctx: Ctx; active?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background" style={tenantBrand(ctx.tenant)}>
      <Sidebar
        tenantName={ctx.tenant.name}
        shopLabel={`${ctx.shop.name} · ${ctx.shop.code}`}
        userName={ctx.member.name}
        roleName={ctx.member.roleName}
        perms={ctx.member.perms}
        multiShop={ctx.shops.length > 1}
        shops={ctx.shops}
        shopId={ctx.shop.id}
        chain={(ctx.tenant.entitlements?.max_shops ?? 1) > 1 || ctx.shops.length > 1}
        active={active}
      />
      <main className="flex min-w-0 flex-1 flex-col gap-[18px] p-7">{children}</main>
      <IdleSignout minutes={ctx.tenant.idle_timeout_min} />
    </div>
  );
}

/** The shop's brand colour, or the seasonal theme's while one is active (Settings → Branding). */
export function tenantBrand(t: { brand_color: string; theme: string; auto_seasonal_theme: boolean }) {
  return brandStyle(activeSeason(t.theme, t.auto_seasonal_theme)?.color ?? t.brand_color) as React.CSSProperties | undefined;
}
