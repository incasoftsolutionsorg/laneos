'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, CardTitle, Field, Input, Select } from '@laneos/ui';
import { openTicket, replyToSupport } from '@/app/(tenant)/backoffice/support/actions';

const area = 'rounded-control border border-border-strong bg-surface px-3.5 py-2.5 text-sm focus:border-brand-primary focus:outline-none';

export function NewTicket() {
  const router = useRouter();
  const [v, setV] = useState({ subject: '', body: '', priority: 'normal' });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="flex flex-col gap-3 p-5">
      <CardTitle>Ask LaneOS support</CardTitle>
      <Field label="Title"><Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} maxLength={120} placeholder="Lane L2 does not print" /></Field>
      <Field label="What happened?"><textarea value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} rows={5} maxLength={4000} className={area} /></Field>
      <Field label="How urgent?"><Select value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>
        <option value="low">Low — a question</option><option value="normal">Normal</option><option value="high">High — one lane cannot sell</option><option value="urgent">Urgent — the shop cannot sell</option>
      </Select></Field>
      {error ? <Alert>{error}</Alert> : null}
      <Button disabled={pending} onClick={() => start(async () => {
        const r = await openTicket(v.subject, v.body, v.priority);
        if (r.error) return setError(r.error);
        router.push(`/backoffice/support?id=${r.id}`);
      })}>{pending ? 'Sending…' : 'Send to support'}</Button>
      <p className="text-[11px] text-text-muted">Never send passwords, PINs or credit-note codes. Support may look at your set-up (read-only) to help; you will see it in Activity logs.</p>
    </Card>
  );
}

export function SupportReply({ id }: { id: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = (close: boolean) => start(async () => {
    const r = await replyToSupport(id, body, close);
    if (r.error) return setError(r.error);
    setBody(''); router.refresh();
  });
  return (
    <Card className="flex flex-col gap-3 p-4">
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} className={area} aria-label="Reply" placeholder="Reply…" />
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex gap-2">
        <Button disabled={pending || !body.trim()} onClick={() => send(false)}>Reply</Button>
        <Button variant="secondary" disabled={pending} onClick={() => send(true)}>Close ticket</Button>
      </div>
    </Card>
  );
}
