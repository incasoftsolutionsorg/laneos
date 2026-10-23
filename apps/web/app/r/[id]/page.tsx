import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Receipt, type ReceiptData } from '@/components/print/Receipt';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Your receipt', robots: { index: false, follow: false } };

interface PublicReceipt {
  tenant: string;
  shop: { name: string; code: string; address: string | null; phone: string | null };
  lane: string; cashier: string; invoiceNo: string; createdAt: string;
  subtotalCents: number; promoCents: number; roundingCents: number; totalCents: number; paidCents: number; changeCents: number;
  lines: { name: string; itemType: string; qtyMilli: number; unitPriceCents: number; grossCents: number; promoCents: number }[];
  payments: { method: string; amountCents: number }[];
}

const METHOD: Record<string, string> = { cash: 'Cash', card: 'Card', lankaqr: 'LankaQR', credit_note: 'Credit note', account: 'On account' };

// Digital receipt (ACT-009): public, by the unguessable token printed as a QR code. No customer details.
export default async function DigitalReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{32}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.schema('api').rpc('public_receipt', { p_token: id });
  if (!data) notFound();
  const r = data as unknown as PublicReceipt;

  const receipt: ReceiptData = {
    tenant: r.tenant, shop: r.shop, invoiceNo: r.invoiceNo, createdAt: r.createdAt, lane: r.lane, cashier: r.cashier,
    lines: r.lines.map((l) => ({
      name: l.name,
      qtyLabel: l.itemType === 'weighed' ? (l.qtyMilli / 1000).toFixed(3) : String(l.qtyMilli / 1000),
      unitCents: l.unitPriceCents, amountCents: l.grossCents,
      promo: l.promoCents ? { name: 'Promotion', cents: l.promoCents } : null,
    })),
    itemCount: r.lines.reduce((n, l) => n + (l.itemType === 'weighed' ? 1 : l.qtyMilli / 1000), 0),
    subtotalCents: r.subtotalCents, savedCents: r.promoCents, roundingCents: r.roundingCents, totalCents: r.totalCents,
    payments: r.payments.map((p) => ({ label: METHOD[p.method] ?? p.method, amountCents: p.amountCents })),
    changeCents: r.changeCents,
  };

  return (
    <main className="min-h-screen bg-background py-8">
      <div className="mx-auto w-fit rounded-card shadow-sm">
        <Receipt r={receipt} />
      </div>
    </main>
  );
}
