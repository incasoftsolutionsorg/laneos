import type { Metadata } from 'next';
import { hasPerm } from '@laneos/core';
import { Card, CardTitle } from '@laneos/ui';
import { SettingsDraft } from '@/components/backoffice/Settings';
import { DMoney, DNumber, DSelect, DSwitch, DText } from '@/components/backoffice/SettingsFields';
import { ShopDetails } from '@/components/backoffice/ShopDetails';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Settings' };

// Settings → General (no separate frame; fields from the register form 1-90 and blueprint §30).
export default async function GeneralSettingsPage() {
  const ctx = await requireTenant();
  const [{ data: t }, { data: shop }] = await Promise.all([
    ctx.supabase.from('tenants')
      .select('name, business_reg_no, city, business_type, embedded_barcode_mode, credit_note_days, credit_note_any_shop, cash_refund_pin_cents')
      .eq('id', ctx.tenant.id).single(),
    ctx.supabase.from('shops').select('name, address, phone').eq('id', ctx.shop.id).single(),
  ]);
  if (!t) return null;
  const owner = hasPerm(ctx.member.perms, 'settings.manage');

  return (
    <SettingsDraft initial={t} readOnly={!owner}>
      <Card className="flex flex-col gap-4 p-5">
        <CardTitle>Business</CardTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <DText name="name" label="Business name" maxLength={120} />
          <DText name="business_reg_no" label="Business registration no." placeholder="PV 00123456" maxLength={40} />
          <DText name="city" label="City" maxLength={60} />
          <DSelect name="business_type" label="Business type" options={[['grocery', 'Grocery / kade'], ['supermarket', 'Supermarket'], ['pharmacy', 'Pharmacy'], ['hardware', 'Hardware'], ['other', 'Other']]} />
          <DSelect name="embedded_barcode_mode" label="Scale barcodes (20–29…)" hint="What the 5 digits after the PLU mean" options={[['weight', 'Weight (grams)'], ['price', 'Price (cents)']]} />
        </div>
      </Card>
      <Card className="flex flex-col gap-4 p-5">
        <CardTitle>Returns & credit notes</CardTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <DNumber name="credit_note_days" label="Credit notes valid for" min={30} max={365} suffix="days" />
          <DMoney name="cash_refund_pin_cents" label="Supervisor PIN for cash refunds above (Rs)" />
        </div>
        <DSwitch name="credit_note_any_shop" label="Credit notes work at every shop" hint="Off: only at the shop that issued them" />
      </Card>
      <ShopDetails shop={{ name: shop?.name ?? ctx.shop.name, address: shop?.address ?? '', phone: shop?.phone ?? '' }} code={ctx.shop.code} readOnly={!owner} />
    </SettingsDraft>
  );
}
