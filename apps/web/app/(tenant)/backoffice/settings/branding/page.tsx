import type { Metadata } from 'next';
import { hasPerm } from '@laneos/core';
import { Card, CardTitle, initials } from '@laneos/ui';
import { SettingsDraft } from '@/components/backoffice/Settings';
import { BrandSwatches, DSwitch, SeasonCards } from '@/components/backoffice/SettingsFields';
import { requireTenant } from '@/lib/server/context';
import { ImageUpload } from '@/components/ImageUpload';
import { PUBLIC_BUCKET, publicUrl } from '@/lib/storage';
import { setLogo } from '../actions';

export const metadata: Metadata = { title: 'Branding & themes' };

// Settings → Branding & themes (Figma 1-3701). Logo upload waits for file storage (see docs/10-ui.md §5).
export default async function BrandingPage() {
  const ctx = await requireTenant();
  const { data: t } = await ctx.supabase.from('tenants').select('brand_color, theme, auto_seasonal_theme').eq('id', ctx.tenant.id).single();
  if (!t) return null;
  const owner = hasPerm(ctx.member.perms, 'settings.manage');
  return (
    <SettingsDraft initial={t} readOnly={!owner}>
      <Card className="flex flex-col gap-3 p-5">
        <CardTitle>Shop logo</CardTitle>
        <div className="flex items-start gap-5">
          {ctx.tenant.logo_path ? null : <span className="flex size-22 shrink-0 items-center justify-center rounded-card bg-brand-primary text-2xl font-bold text-white">{initials(ctx.tenant.name)}</span>}
          <div className="flex flex-col gap-2 text-[13px] text-text-muted">
            <p>Shown on receipts, A4 invoices and the back office. PNG, JPG, WebP or SVG, up to 2 MB; a square logo of at least 512 px prints best. Receipts print it in black and white.</p>
            {owner ? (
              <ImageUpload bucket={PUBLIC_BUCKET} folder={ctx.tenant.id} base="logo" value={ctx.tenant.logo_path} previewUrl={publicUrl(ctx.tenant.logo_path)}
                onChange={setLogo} label="Upload new logo" allowSvg />
            ) : null}
          </div>
        </div>
      </Card>
      <BrandSwatches />
      <Card className="flex flex-col gap-4 p-5">
        <CardTitle>Seasonal themes</CardTitle>
        <SeasonCards />
        <DSwitch name="auto_seasonal_theme" label="Auto-apply seasonal themes" hint="Awurudu 10–16 April · Vesak week · Christmas 1–31 December (while the default theme is chosen)" />
      </Card>
    </SettingsDraft>
  );
}
