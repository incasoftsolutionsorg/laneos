'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Field, Input } from '@laneos/ui';
import { Dialog } from '@/components/lane/Dialog';
import type { NoteActionState } from '@/app/(tenant)/backoffice/credit-notes/actions';

type Action = (prev: NoteActionState, form: FormData) => Promise<NoteActionState>;

/** A small table-row action that asks for a reason (and optional extra fields) in a dialog. */
export function ReasonAction({
  label, title, action, hidden, fields = [], danger, submitLabel = 'Confirm',
}: {
  label: string; title: string; action: Action; hidden: Record<string, string>;
  fields?: { name: string; label: string; type?: string; defaultValue?: string }[];
  danger?: boolean; submitLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: NoteActionState, form: FormData) => {
    const r = await action(prev, form);
    if (!r.error) setOpen(false);
    return r;
  }, {});
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={danger ? 'text-xs font-semibold text-danger hover:underline' : 'text-xs font-semibold text-brand-primary hover:underline'}>{label}</button>
      {open ? (
        <Dialog title={title} onClose={() => setOpen(false)}>
          <form action={formAction} className="flex flex-col gap-4">
            {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            {state.error ? <Alert>{state.error}</Alert> : null}
            {fields.map((f) => (
              <Field key={f.name} label={f.label}><Input name={f.name} type={f.type ?? 'text'} defaultValue={f.defaultValue} required /></Field>
            ))}
            <Field label="Reason"><Input name="reason" required minLength={3} maxLength={200} autoFocus /></Field>
            <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={pending}>{pending ? 'Saving…' : submitLabel}</Button>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
