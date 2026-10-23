'use client';

import { useEffect, useState } from 'react';
import { CreditNoteSlip } from '@/components/print/CreditNoteSlip';
import { LabelSheet } from '@/components/print/Labels';
import { PaymentSlip } from '@/components/print/PaymentSlip';
import { ReturnReceipt } from '@/components/print/ReturnReceipt';
import { Receipt } from '@/components/print/Receipt';
import { ZReport } from '@/components/print/ZReport';
import { PRINT_KEY, type PrintJob } from '@/lib/lane/print';

// Renders one print job and opens the print dialog. The job is removed once read, so a credit-note
// code is never left in storage.
export default function PrintPage() {
  const [job, setJob] = useState<PrintJob | null | undefined>(undefined);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRINT_KEY);
      localStorage.removeItem(PRINT_KEY);
      setJob(raw ? (JSON.parse(raw) as PrintJob) : null);
    } catch {
      setJob(null);
    }
  }, []);

  useEffect(() => {
    if (!job) return;
    const t = setTimeout(() => window.print(), 400); // let the QR code and barcode render first
    const done = () => window.close();
    window.addEventListener('afterprint', done);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [job]);

  if (job === undefined) return null;
  if (job === null) return <p className="p-6 text-[13px]">Nothing to print.</p>;
  return (
    <div className="min-h-screen bg-white py-4 print:py-0">
      {job.kind === 'receipt' ? <Receipt r={job.receipt} />
        : job.kind === 'credit_note' ? <CreditNoteSlip n={job.note} />
        : job.kind === 'labels' ? <LabelSheet labels={job.labels} opts={job.opts} />
        : job.kind === 'payment' ? <PaymentSlip p={job.payment} />
        : job.kind === 'return' ? <ReturnReceipt r={job.receipt} />
        : <ZReport z={job.z} />}
    </div>
  );
}
