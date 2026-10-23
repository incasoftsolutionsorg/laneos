'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatRs, type ItemType } from '@laneos/core';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Select, buttonClass, cn } from '@laneos/ui';
import { countAction, recordCount, startCount, type CountState } from '@/app/(tenant)/backoffice/stock/counts/actions';

export function StartCountForm({ departments }: { departments: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(startCount, {} as CountState);
  const [name, setName] = useState('');
  return (
    <Card className="p-5">
      <form action={action} className="flex flex-col gap-3.5">
        <CardTitle>Start a count</CardTitle>
        {state.error ? <Alert>{state.error}</Alert> : null}
        <Field label="Category" hint="Every active item in it goes on the count sheet">
          <Select name="departmentId" defaultValue="" onChange={(e) => { const d = departments.find((x) => x.id === e.target.value); if (d && !name) setName(d.name); }}>
            <option value="">Whole shop</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Section name"><Input name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dairy · Aisle 3" required maxLength={80} /></Field>
        <Button type="submit" disabled={pending}>{pending ? 'Starting…' : 'Start count'}</Button>
        <p className="text-xs text-text-muted">System quantities are frozen when the count starts; sales during the count do not change the sheet.</p>
      </form>
    </Card>
  );
}

export interface CountLine { id: string; name: string; itemType: ItemType; systemMilli: number; countedMilli: number | null; costCents: number; by: string | null }

const fmt = (milli: number, t: ItemType) => (t === 'weighed' ? (milli / 1000).toFixed(3) : String(milli / 1000));

/** The count sheet (Figma 11-3268). Each counted value saves when you leave the box. */
export function CountSheet({ countId, status, lines, canPost, editable }: { countId: string; status: string; lines: CountLine[]; canPost: boolean; editable: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (a: 'submit' | 'post' | 'cancel' | 'reopen') => {
    if (a === 'cancel' && !confirm('Cancel this count? Nothing is posted.')) return;
    setBusy(true); setError(null);
    const r = await countAction(countId, a);
    setBusy(false);
    if (r.error) setError(r.error); else router.refresh();
  };

  return (
    <>
      <div className="flex flex-wrap gap-3">
        {status === 'counting' ? (
          <>
            <Link href="/backoffice/stock/counts" className={buttonClass('secondary')}>Pause count</Link>
            <Button onClick={() => run('submit')} disabled={busy}>Submit for approval</Button>
            <Button variant="secondary" onClick={() => run('cancel')} disabled={busy}>Cancel count</Button>
          </>
        ) : status === 'submitted' ? (
          <>
            {canPost ? <Button onClick={() => run('post')} disabled={busy}>Post variances to stock</Button> : <Badge tone="warning">Waiting for a manager to post</Badge>}
            <Button variant="secondary" onClick={() => run('reopen')} disabled={busy}>Reopen for counting</Button>
          </>
        ) : <Badge tone={status === 'posted' ? 'success' : 'neutral'}>{status === 'posted' ? 'Posted to stock' : 'Cancelled'}</Badge>}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-left text-[13px]">
          <thead><tr className="bg-surface-muted text-[11px] font-semibold text-text-muted">
            <th className="px-4 py-2.5">Item</th><th className="px-4 py-2.5">System</th><th className="px-4 py-2.5">Counted</th>
            <th className="px-4 py-2.5">Variance</th><th className="px-4 py-2.5">Value</th><th className="px-4 py-2.5">By</th>
          </tr></thead>
          <tbody>
            {lines.map((l) => <Line key={l.id} line={l} editable={editable} onSaved={() => router.refresh()} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Line({ line, editable, onSaved }: { line: CountLine; editable: boolean; onSaved: () => void }) {
  const [value, setValue] = useState(line.countedMilli == null ? '' : fmt(line.countedMilli, line.itemType));
  const [err, setErr] = useState<string | null>(null);
  const counted = line.countedMilli;
  const diff = counted == null ? null : counted - line.systemMilli;
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2 font-medium">{line.name}</td>
      <td className="px-4 py-2 tabular-nums">{fmt(line.systemMilli, line.itemType)}</td>
      <td className="px-4 py-2">
        {editable ? (
          <>
            <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className={cn('w-24 py-1.5', err && 'border-danger')} aria-label={`Counted ${line.name}`}
              onBlur={async () => {
                if (value === (counted == null ? '' : fmt(counted, line.itemType))) return;
                const r = await recordCount(line.id, value);
                setErr(r.error ?? null);
                if (!r.error) onSaved();
              }} />
            {err ? <span className="block text-xs text-danger">{err}</span> : null}
          </>
        ) : counted == null ? '—' : fmt(counted, line.itemType)}
      </td>
      <td className="px-4 py-2">{diff == null ? '—' : <Badge tone={diff === 0 ? 'success' : diff < 0 ? 'danger' : 'info'}>{diff > 0 ? '+' : ''}{fmt(diff, line.itemType)}</Badge>}</td>
      <td className="px-4 py-2 tabular-nums">{diff == null ? '—' : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${formatRs(Math.abs(Math.round((diff * line.costCents) / 1000)), { decimals: 0 })}`}</td>
      <td className="px-4 py-2">{line.by ?? '—'}</td>
    </tr>
  );
}
