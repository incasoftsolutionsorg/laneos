'use client';

import type { CreditNoteData } from '@/components/print/CreditNoteSlip';
import type { LabelData, LabelOptions } from '@/components/print/Labels';
import type { PaymentSlipData } from '@/components/print/PaymentSlip';
import type { ReceiptData } from '@/components/print/Receipt';
import type { ReturnReceiptData } from '@/components/print/ReturnReceipt';
import type { ZData } from '@/components/print/ZReport';

// Browser printing until QZ Tray is wired (device task): the job is handed to /lane/print through
// localStorage (same origin), which renders the template and opens the print dialog.

export type PrintJob =
  | { kind: 'receipt'; receipt: ReceiptData }
  | { kind: 'credit_note'; note: CreditNoteData }
  | { kind: 'z'; z: ZData }
  | { kind: 'labels'; labels: LabelData[]; opts: LabelOptions }
  | { kind: 'payment'; payment: PaymentSlipData }
  | { kind: 'return'; receipt: ReturnReceiptData };

export const PRINT_KEY = 'laneos-print-job';

export function printJob(job: PrintJob) {
  try {
    localStorage.setItem(PRINT_KEY, JSON.stringify(job));
  } catch {
    return;
  }
  window.open('/lane/print', 'laneos-print', job.kind === 'labels' ? 'width=900,height=760' : 'width=420,height=760');
}
