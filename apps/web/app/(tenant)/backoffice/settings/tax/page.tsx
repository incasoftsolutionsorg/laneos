import type { Metadata } from 'next';
import { hasPerm } from '@laneos/core';
import { Card, CardTitle, EmptyRow, Table, TD, TH } from '@laneos/ui';
import { SettingsDraft } from '@/components/backoffice/Settings';
import { DMoney, DNumber, DSelect, DSwitch, DText } from '@/components/backoffice/SettingsFields';
import { NewRateButton, PriceRuleButton } from '@/components/backoffice/TaxForms';
import { colomboToday, fmtDate } from '@/lib/server/dates';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Tax & rates' };

const CLASS = { standard: 'Standard', exempt: 'Exempt (rice, flour, bread)', zero: 'Zero rated' } as const;

// Settings → Tax & rates (Figma 1-3902): VAT registration, tax classes, price rates, other rates.
export default async function TaxSettingsPage() {
  const ctx = await requireTenant();
  const today = colomboToday();
  const [{ data: t }, { data: rates }, { data: lists }, { data: items }] = await Promise.all([
    ctx.supabase.from('tenants')
      .select('vat_registered, vat_no, prices_include_vat, rounding_unit_cents, customer_credit_days, damage_approval_cents, supplier_payment_approval_cents')
      .eq('id', ctx.tenant.id).single(),
    ctx.supabase.from('tax_rates').select('tax_class, rate_bp, effective_from').order('effective_from', { ascending: false }),
    ctx.supabase.from('price_lists').select('id, name, is_default, discount_bp, applies_to').order('is_default', { ascending: false }).order('name'),
    ctx.supabase.from('items').select('tax_class').eq('is_active', true),
  ]);
  if (!t) return null;
  const owner = hasPerm(ctx.member.perms, 'settings.manage');
  const count = new Map<string, number>();
  for (const i of items ?? []) count.set(i.tax_class, (count.get(i.tax_class) ?? 0) + 1);
  // Rate in force today per class, plus any rate that starts later.
  const classes = (['standard', 'exempt', 'zero'] as const).map((c) => {
    const rows = (rates ?? []).filter((r) => r.tax_class === c);
    return { cls: c, now: rows.find((r) => r.effective_from <= today), next: rows.filter((r) => r.effective_from > today).at(-1) };
  });

  return (
    <SettingsDraft initial={t} readOnly={!owner}>
      <Card className="flex flex-col gap-4 p-5">
        <CardTitle>VAT registration</CardTitle>
        <DSwitch name="vat_registered" label="This shop is VAT registered" hint='Receipts print "Tax invoice" with your VAT number' />
        <div className="grid gap-4 md:grid-cols-3">
          <DText name="vat_no" label="VAT number" placeholder="123456789-7000" maxLength={30} />
          <div className="flex flex-col gap-1.5"><span className="text-xs font-semibold">Standard rate</span><span className="py-2 text-[13px] font-semibold">{(classes[0]!.now?.rate_bp ?? 0) / 100}%</span></div>
          <DSelect name="prices_include_vat" label="Prices" options={[['true', 'Tax inclusive'], ['false', 'Tax added at the till']]} />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between"><CardTitle>Tax classes</CardTitle>{owner ? <NewRateButton today={today} /> : null}</div>
          <Table>
            <thead><tr><TH>Class</TH><TH>Rate</TH><TH>Effective from</TH><TH>Items</TH></tr></thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.cls}>
                  <TD>{CLASS[c.cls]}</TD>
                  <TD className="tabular-nums">{(c.now?.rate_bp ?? 0) / 100}%{c.next ? <span className="block text-[11px] text-warning">{c.next.rate_bp / 100}% from {fmtDate(c.next.effective_from)}</span> : null}</TD>
                  <TD>{c.now && c.now.rate_bp > 0 ? fmtDate(c.now.effective_from) : '—'}</TD>
                  <TD className="tabular-nums">{(count.get(c.cls) ?? 0).toLocaleString('en-LK')}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between"><CardTitle>Price rates</CardTitle>{owner ? <PriceRuleButton label="+ New price list" /> : null}</div>
          <Table>
            <thead><tr><TH>Price list</TH><TH>Rule</TH><TH>Applies to</TH><TH /></tr></thead>
            <tbody>
              {(lists ?? []).map((l) => (
                <tr key={l.id}>
                  <TD>{l.name}{l.is_default ? ' (default)' : ''}</TD>
                  <TD>{l.is_default || !l.discount_bp ? 'List price' : `−${l.discount_bp / 100}%`}</TD>
                  <TD>{l.is_default ? 'Everyone' : l.applies_to ?? '—'}</TD>
                  <TD className="text-right">{owner && !l.is_default ? <PriceRuleButton label="Edit" rule={{ id: l.id, name: l.name, discountBp: l.discount_bp, appliesTo: l.applies_to }} /> : null}</TD>
                </tr>
              ))}
              {(lists ?? []).length === 0 ? <EmptyRow colSpan={4}>No price lists.</EmptyRow> : null}
            </tbody>
          </Table>
          <p className="text-[11px] text-text-muted">Wholesale invoices use each item&apos;s wholesale price; these lists are the rules for buyer groups.</p>
        </Card>
      </div>

      <Card className="flex flex-col gap-4 p-5">
        <CardTitle>Other rates</CardTitle>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DSelect name="rounding_unit_cents" label="Cash rounding" options={[[1, 'None'], [10, '10 cents'], [50, '50 cents'], [100, 'Rs 1'], [500, 'Rs 5'], [1000, 'Rs 10']]} />
          <DNumber name="customer_credit_days" label="Customer credit" min={0} max={180} suffix="days" />
          <DMoney name="damage_approval_cents" label="Damage needs approval above (Rs)" />
          <DMoney name="supplier_payment_approval_cents" label="Supplier payments need approval above (Rs)" />
        </div>
      </Card>
    </SettingsDraft>
  );
}
