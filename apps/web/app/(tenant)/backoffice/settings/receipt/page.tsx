import type { Metadata } from 'next';
import { hasPerm } from '@laneos/core';
import { Card, CardTitle } from '@laneos/ui';
import { LanePrinter, ReceiptPreview } from '@/components/backoffice/ReceiptSettings';
import { SettingsDraft } from '@/components/backoffice/Settings';
import { DSegment, DSwitch, DText } from '@/components/backoffice/SettingsFields';
import { requireTenant } from '@/lib/server/context';
import { publicUrl } from '@/lib/storage';

export const metadata: Metadata = { title: 'Receipt & printer' };

// Settings → Receipt & printer (Figma 1-4145): layout, printer per lane, cash drawer; live preview.
export default async function ReceiptSettingsPage() {
  const ctx = await requireTenant();
  const [{ data: t }, { data: shop }, { data: lanes }] = await Promise.all([
    ctx.supabase.from('tenants')
      .select('receipt_paper, receipt_header, receipt_footer, receipt_print_logo, receipt_silent, receipt_open_drawer, receipt_local_language, vat_registered, vat_no')
      .eq('id', ctx.tenant.id).single(),
    ctx.supabase.from('shops').select('name, address, phone').eq('id', ctx.shop.id).single(),
    ctx.supabase.from('lanes').select('id, code, name, printer_name').eq('shop_id', ctx.shop.id).order('code'),
  ]);
  if (!t) return null;
  const owner = hasPerm(ctx.member.perms, 'settings.manage');
  const phone = shop?.phone?.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '0$1 $2 $3');

  return (
    <SettingsDraft initial={t} readOnly={!owner}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <Card className="flex flex-1 flex-col gap-4 p-5">
          <CardTitle>Receipt & printer</CardTitle>
          <DSegment name="receipt_paper" label="Paper width" options={[['80mm', '80 mm'], ['58mm', '58 mm'], ['a4', 'A4 (wholesale)']]} />
          <DText name="receipt_header" label="Header text" placeholder={`${ctx.tenant.name.toUpperCase()} - ${ctx.shop.name.toUpperCase()}`} maxLength={120} />
          <DText name="receipt_footer" label="Footer text" maxLength={200} />
          <DSwitch name="receipt_print_logo" label="Print logo" hint="1-bit logo, 576 px wide" />
          <DSwitch name="receipt_silent" label="Silent printing (QZ Tray)" hint="No print dialog at the lane — needs QZ Tray on the lane PC" />
          <DSwitch name="receipt_open_drawer" label="Open cash drawer for cash sales" hint="ESC/POS drawer kick" />
          <DSwitch name="receipt_local_language" label="Print in Sinhala / Tamil" hint="Printed as an image" />
          {owner ? <LanePrinter lanes={(lanes ?? []).map((l) => ({ id: l.id, code: l.code, name: l.name, printer: l.printer_name }))} /> : null}
        </Card>
        <ReceiptPreview logoUrl={publicUrl(ctx.tenant.logo_path)} base={{ tenant: ctx.tenant.name, shop: { name: shop?.name ?? ctx.shop.name, address: shop?.address, phone } }} />
      </div>
    </SettingsDraft>
  );
}
