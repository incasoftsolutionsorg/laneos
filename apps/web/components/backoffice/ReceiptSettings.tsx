'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Field, Input, Select } from '@laneos/ui';
import { Receipt, type ReceiptData } from '@/components/print/Receipt';
import { setLanePrinter } from '@/app/(tenant)/backoffice/settings/actions';
import { printJob } from '@/lib/lane/print';
import { useDraft } from './Settings';

/** Sample bill drawn with the real receipt template and the unsaved settings (Figma 1-4145, right). */
function sample(base: { tenant: string; shop: ReceiptData['shop'] }, s: ReceiptData['settings']): ReceiptData {
  return {
    ...base, settings: s, invoiceNo: 'KDY1-L2-000124', createdAt: new Date().toISOString(), lane: 'L2', cashier: 'Nimal',
    lines: [
      { name: 'Samba Rice 5kg', qtyLabel: '1', unitCents: 123000, amountCents: 123000 },
      { name: 'Anchor Milk Powder 400g', qtyLabel: '2', unitCents: 118000, amountCents: 236000 },
      { name: 'Carrots', qtyLabel: '0.756', unitCents: 48000, amountCents: 36288 },
      { name: 'Prima Bread', qtyLabel: '1', unitCents: 16000, amountCents: 16000, promo: { name: 'Promotion', cents: 3000 } },
    ],
    itemCount: 5, subtotalCents: 411288, savedCents: 3000, roundingCents: 12, totalCents: 408300,
    payments: [{ label: 'Cash', amountCents: 300000 }, { label: 'LankaQR', amountCents: 108300 }], changeCents: 0,
  };
}

export function ReceiptPreview({ base }: { base: { tenant: string; shop: ReceiptData['shop'] } }) {
  const [paper] = useDraft<string>('receipt_paper');
  const [header] = useDraft<string | null>('receipt_header');
  const [footer] = useDraft<string>('receipt_footer');
  const [logo] = useDraft<boolean>('receipt_print_logo');
  const [vatReg] = useDraft<boolean>('vat_registered');
  const [vatNo] = useDraft<string | null>('vat_no');
  const r = sample(base, { paper: paper === 'a4' ? '80mm' : paper, header, footer, logo, vatNo: vatReg ? vatNo : null });
  return (
    <div className="flex flex-col gap-3 xl:w-[330px] xl:shrink-0">
      <Button variant="secondary" onClick={() => printJob({ kind: 'receipt', receipt: r })}>Test print</Button>
      <div className="rounded-card bg-surface py-3 shadow-sm">
        <Receipt r={r} />
      </div>
      {paper === 'a4' ? <p className="text-[11px] text-text-muted">A4 is used for wholesale invoices; lane receipts stay on the 80 mm roll.</p> : null}
    </div>
  );
}

/** Printer name per lane (QZ Tray uses it once the device task lands). */
export function LanePrinter({ lanes }: { lanes: { id: string; code: string; name: string; printer: string | null }[] }) {
  const [laneId, setLaneId] = useState(lanes[0]?.id ?? '');
  const lane = lanes.find((l) => l.id === laneId);
  const [printer, setPrinter] = useState(lane?.printer ?? '');
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!lane) return null;
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="grid grid-cols-[120px_1fr_auto] items-end gap-3">
        <Field label="Lane">
          <Select value={laneId} onChange={(e) => { setLaneId(e.target.value); setPrinter(lanes.find((l) => l.id === e.target.value)?.printer ?? ''); setMsg(null); }}>
            {lanes.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
          </Select>
        </Field>
        <Field label={`Printer for ${lane.name}`}>
          <Input value={printer} onChange={(e) => setPrinter(e.target.value)} placeholder="XP-80C (USB)" maxLength={60} />
        </Field>
        <Button variant="secondary" disabled={pending} onClick={() => start(async () => {
          const r = await setLanePrinter(laneId, printer);
          setMsg(r.error ? { tone: 'danger', text: r.error } : { tone: 'success', text: r.ok! });
        })}>Save</Button>
      </div>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
    </div>
  );
}
