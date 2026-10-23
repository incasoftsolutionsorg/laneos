'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field, Input, Select } from '@laneos/ui';
import { Dialog } from '@/components/lane/Dialog';
import { savePriceRule, setTaxRate } from '@/app/(tenant)/backoffice/settings/actions';

type Msg = string | null;

/** New rate for a tax class from a date (BR-060: rates are effective-dated, history is kept). */
export function NewRateButton({ today }: { today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ cls: 'standard', rate: '18', from: today });
  const [error, setError] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>New rate</Button>
      {open ? (
        <Dialog title="New tax rate" onClose={() => setOpen(false)} width={420}>
          <p className="text-[13px] text-text-muted">Bills before the start date keep the old rate.</p>
          <Field label="Class">
            <Select value={v.cls} onChange={(e) => setV({ ...v, cls: e.target.value })}>
              <option value="standard">Standard</option><option value="exempt">Exempt</option><option value="zero">Zero rated</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rate (%)"><Input value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} inputMode="decimal" /></Field>
            <Field label="Starts on"><Input type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} /></Field>
          </div>
          {error ? <Alert>{error}</Alert> : null}
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await setTaxRate(v.cls, v.rate, v.from);
            if (r.error) return setError(r.error);
            setOpen(false); router.refresh();
          })}>{pending ? 'Saving…' : 'Save rate'}</Button>
        </Dialog>
      ) : null}
    </>
  );
}

/** Add or edit a price list rule ("Wholesale A · −8 % · Retailers"). */
export function PriceRuleButton({ rule, label }: { rule?: { id: string; name: string; discountBp: number; appliesTo: string | null }; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: rule?.name ?? '', pct: rule ? String(rule.discountBp / 100) : '', to: rule?.appliesTo ?? '' });
  const [error, setError] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-brand-primary hover:underline">{label}</button>
      {open ? (
        <Dialog title={rule ? `Edit ${rule.name}` : 'New price list'} onClose={() => setOpen(false)} width={420}>
          <Field label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={60} placeholder="Wholesale A" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Below list price (%)"><Input value={v.pct} onChange={(e) => setV({ ...v, pct: e.target.value })} inputMode="decimal" placeholder="8" /></Field>
            <Field label="Applies to"><Input value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} maxLength={60} placeholder="Retailers" /></Field>
          </div>
          {error ? <Alert>{error}</Alert> : null}
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await savePriceRule(rule?.id ?? null, v.name, v.pct || '0', v.to);
            if (r.error) return setError(r.error);
            setOpen(false); router.refresh();
          })}>{pending ? 'Saving…' : 'Save'}</Button>
        </Dialog>
      ) : null}
    </>
  );
}
