import type { Metadata } from 'next';
import { hasPerm } from '@laneos/core';
import { Card, CardTitle } from '@laneos/ui';
import { ResetAllAccess } from '@/components/backoffice/ResetAllAccess';
import { SettingsDraft } from '@/components/backoffice/Settings';
import { DNumber, DSegment, DSwitch } from '@/components/backoffice/SettingsFields';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Security settings' };

// Settings → Security (frame 11-4365 not read — Figma limit; built from blueprint §27.6).
export default async function SecuritySettingsPage() {
  const ctx = await requireTenant();
  const { data: t } = await ctx.supabase.from('tenants')
    .select('require_2fa, strict_sessions, idle_timeout_min, lane_lock_min, failed_login_limit, failed_login_lock_min, pin_length_min, pin_change_days, credit_note_cash_out, export_owner_only, login_alerts')
    .eq('id', ctx.tenant.id).single();
  if (!t) return null;
  const owner = hasPerm(ctx.member.perms, 'settings.manage');

  return (
    <SettingsDraft initial={t} readOnly={!owner}>
      <Card className="flex flex-col gap-4 p-5">
        <CardTitle>Sign-in</CardTitle>
        <DSegment name="require_2fa" label="Require 2-step verification for" options={[['owners', 'Owners'], ['managers', 'Owners & managers'], ['all', 'Everyone with a login']]} />
        <div className="grid gap-4 md:grid-cols-3">
          <DNumber name="idle_timeout_min" label="Back office signs out after" min={10} max={120} suffix="min idle" />
          <DNumber name="failed_login_limit" label="Lock after" min={3} max={10} suffix="wrong passwords" later />
          <DNumber name="failed_login_lock_min" label="Lock for" min={5} max={60} suffix="minutes" later />
        </div>
        <DSwitch name="strict_sessions" label="One session per person" hint="Signing in on a new device ends the old one" later />
        <DSwitch name="login_alerts" label="Email the owner about new-device sign-ins" later />
      </Card>
      <Card className="flex flex-col gap-4 p-5">
        <CardTitle>Lanes & PINs</CardTitle>
        <div className="grid gap-4 md:grid-cols-3">
          <DNumber name="lane_lock_min" label="Lane locks after" min={1} max={15} suffix="min idle" />
          <DNumber name="pin_length_min" label="Shortest PIN" min={4} max={6} suffix="digits" />
          <DNumber name="pin_change_days" label="Ask for a new PIN every" min={30} max={180} suffix="days (blank = never)" later />
        </div>
      </Card>
      <Card className="flex flex-col gap-4 p-5">
        <CardTitle>Money & data</CardTitle>
        <DSwitch name="credit_note_cash_out" label="Allow cashing out credit notes" hint="Off: credit notes can only be spent" later />
        <DSwitch name="export_owner_only" label="Only owners can export data" hint="CSV exports from reports and lists" />
      </Card>
      {owner ? <ResetAllAccess shopName={ctx.shop.name} multiShop={ctx.shops.length > 1} /> : null}
    </SettingsDraft>
  );
}
