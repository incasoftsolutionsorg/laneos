'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, CardTitle, Field, Input, Select, Switch } from '@laneos/ui';
import {
  addAdmin, endSupport, generateInvoices, removeAdmin, replyTicket, resetPlatform, savePlan, setInvoice, startSupport, updateTenant,
} from '@/app/(platform)/admin/actions';

type Msg = { tone: 'danger' | 'success'; text: string } | null;

function useRun() {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string; ok?: string } | undefined>) => start(async () => {
    const r = await fn();
    if (!r) return;
    setMsg(r.error ? { tone: 'danger', text: r.error } : { tone: 'success', text: r.ok ?? 'Done.' });
    if (!r.error) router.refresh();
  });
  return { msg, pending, run };
}

/** Status, plan, trial end and entitlement overrides for one tenant; every change needs a reason (audited). */
export function TenantControls({ id, status, planId, trialEndsOn, ent, plans }: {
  id: string; status: string; planId: string; trialEndsOn: string | null;
  ent: { max_shops: number; max_lanes_per_shop: number; transfers: boolean; head_office: boolean };
  plans: { id: string; name: string }[];
}) {
  const [v, setV] = useState({ status, planId, trialEndsOn: trialEndsOn ?? '', maxShops: String(ent.max_shops), maxLanes: String(ent.max_lanes_per_shop), transfers: ent.transfers, headOffice: ent.head_office, reason: '' });
  const { msg, pending, run } = useRun();
  return (
    <Card className="flex flex-col gap-3 p-5">
      <CardTitle>Account controls</CardTitle>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status"><Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
          {['trial', 'active', 'past_due', 'suspended', 'cancelled'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select></Field>
        <Field label="Plan"><Select value={v.planId} onChange={(e) => setV({ ...v, planId: e.target.value })}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Trial ends"><Input type="date" value={v.trialEndsOn} onChange={(e) => setV({ ...v, trialEndsOn: e.target.value })} /></Field>
        <div />
        <Field label="Max shops"><Input type="number" min={1} value={v.maxShops} onChange={(e) => setV({ ...v, maxShops: e.target.value })} /></Field>
        <Field label="Max lanes per shop"><Input type="number" min={1} value={v.maxLanes} onChange={(e) => setV({ ...v, maxLanes: e.target.value })} /></Field>
      </div>
      <div className="flex items-center justify-between text-[13px]">Transfers<Switch on={v.transfers} onChange={(on) => setV({ ...v, transfers: on })} label="Transfers" /></div>
      <div className="flex items-center justify-between text-[13px]">Head office<Switch on={v.headOffice} onChange={(on) => setV({ ...v, headOffice: on })} label="Head office" /></div>
      <Field label="Reason (recorded in the tenant's activity log)"><Input value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} maxLength={200} /></Field>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Button disabled={pending || v.reason.trim().length < 3} onClick={() => run(() => {
        const p: Record<string, unknown> = { reason: v.reason, status: v.status, transfers: v.transfers, headOffice: v.headOffice, maxShops: Number(v.maxShops), maxLanesPerShop: Number(v.maxLanes) };
        if (v.planId !== planId) p.planId = v.planId;
        if (v.trialEndsOn !== (trialEndsOn ?? '')) p.trialEndsOn = v.trialEndsOn || null;
        return updateTenant(id, p);
      })}>{pending ? 'Saving…' : 'Save changes'}</Button>
      <p className="text-[11px] text-text-muted">Suspended or cancelled: lanes and wholesale stop selling; the back office stays readable. A plan change resets the limits to the plan&apos;s, then the overrides above apply.</p>
    </Card>
  );
}

export function StartSupport({ tenantId }: { tenantId: string }) {
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState('30');
  const { msg, pending, run } = useRun();
  return (
    <Card className="flex flex-col gap-3 p-5">
      <CardTitle>Support view</CardTitle>
      <p className="text-xs text-text-muted">Read-only look at this business&apos;s set-up and health, time-boxed. The business sees it in its activity log.</p>
      <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ticket #12: lane L2 not syncing" maxLength={300} /></Field>
      <Field label="For"><Select value={minutes} onChange={(e) => setMinutes(e.target.value)}>{[15, 30, 60, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}</Select></Field>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Button variant="secondary" disabled={pending || reason.trim().length < 5} onClick={() => run(() => startSupport(tenantId, reason, Number(minutes)))}>Start support view</Button>
    </Card>
  );
}

export function EndSupport({ id }: { id: string }) {
  const { pending, run } = useRun();
  return <Button variant="danger" disabled={pending} onClick={() => run(() => endSupport(id))}>End support view</Button>;
}

export function PlanEditor({ plan }: { plan?: Record<string, string | boolean> }) {
  const [v, setV] = useState<Record<string, string | boolean>>(plan ?? { id: '', name: '', price: '', maxShops: '1', maxLanesPerShop: '1', maxStaff: '5', perShop: false, headOffice: false, transfers: false, isCustom: false, isActive: true, description: '', sortOrder: '9' });
  const { msg, pending, run } = useRun();
  const t = (k: string, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label}><Input value={String(v[k] ?? '')} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...extra} /></Field>
  );
  const b = (k: string, label: string) => <div className="flex items-center justify-between text-[13px]">{label}<Switch on={!!v[k]} onChange={(on) => setV({ ...v, [k]: on })} label={label} /></div>;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <CardTitle>{plan ? `Edit ${String(plan.name)}` : 'New plan'}</CardTitle>
      <div className="grid grid-cols-2 gap-3">
        {t('id', 'Id', { disabled: !!plan })}{t('name', 'Name')}{t('price', 'Price (Rs / month)', { inputMode: 'decimal' })}{t('sortOrder', 'Order', { type: 'number' })}
        {t('maxShops', 'Max shops', { type: 'number' })}{t('maxLanesPerShop', 'Lanes per shop', { type: 'number' })}{t('maxStaff', 'Staff seats', { type: 'number' })}
      </div>
      {t('description', 'Description (sign-up card)')}
      {b('perShop', 'Price is per shop')}{b('transfers', 'Transfers')}{b('headOffice', 'Head office')}{b('isCustom', 'Custom (arranged by sales)')}{b('isActive', 'Offered')}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Button disabled={pending} onClick={() => run(() => savePlan(v))}>{pending ? 'Saving…' : 'Save plan'}</Button>
    </Card>
  );
}

export function GenerateInvoices({ defaultPeriod }: { defaultPeriod: string }) {
  const [period, setPeriod] = useState(defaultPeriod);
  const { msg, pending, run } = useRun();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Month"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
      <Button disabled={pending} onClick={() => run(() => generateInvoices(period))}>{pending ? 'Creating…' : 'Create invoices'}</Button>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
    </div>
  );
}

export function InvoiceActions({ id, status }: { id: string; status: string }) {
  const [ref, setRef] = useState('');
  const { msg, pending, run } = useRun();
  if (status !== 'open') return <span className="text-xs text-text-muted">{status === 'paid' ? 'Paid' : 'Void'}</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="w-32"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Bank ref" aria-label="Payment reference" /></span>
      <button type="button" disabled={pending} className="text-xs font-semibold text-success hover:underline" onClick={() => run(() => setInvoice(id, 'paid', ref))}>Mark paid</button>
      <button type="button" disabled={pending} className="text-xs font-semibold text-text-muted hover:underline" onClick={() => run(() => setInvoice(id, 'void', ref))}>Void</button>
      {msg?.tone === 'danger' ? <span className="text-xs text-danger">{msg.text}</span> : null}
    </span>
  );
}

export function TicketReply({ id, status }: { id: string; status: string }) {
  const [body, setBody] = useState('');
  const [next, setNext] = useState(status === 'open' ? 'pending' : status);
  const { msg, pending, run } = useRun();
  return (
    <Card className="flex flex-col gap-3 p-5">
      <Field label="Reply to the business">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4000}
          className="rounded-control border border-border-strong bg-surface px-3.5 py-2.5 text-sm focus:border-brand-primary focus:outline-none" />
      </Field>
      <div className="flex items-end gap-3">
        <Field label="Status"><Select value={next} onChange={(e) => setNext(e.target.value)}>{['open', 'pending', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
        <Button disabled={pending || (!body.trim() && next === status)} onClick={() => run(async () => { const r = await replyTicket(id, body, next); if (!r.error) setBody(''); return r; })}>Send</Button>
      </div>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
    </Card>
  );
}

export function AdminList({ admins }: { admins: { userId: string; email: string; me: boolean }[] }) {
  const [email, setEmail] = useState('');
  const { msg, pending, run } = useRun();
  return (
    <Card className="flex flex-col gap-3 p-5">
      <CardTitle>Add a platform admin</CardTitle>
      <div className="flex items-end gap-3">
        <Field label="LaneOS login email" className="flex-1"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Button disabled={pending || !email} onClick={() => run(() => addAdmin(email))}>Add</Button>
      </div>
      {admins.filter((a) => !a.me).map((a) => (
        <div key={a.userId} className="flex items-center justify-between text-[13px]">{a.email}
          <button type="button" className="text-xs font-semibold text-danger hover:underline" onClick={() => { if (window.confirm(`Remove ${a.email}?`)) run(() => removeAdmin(a.userId)); }}>Remove</button>
        </div>
      ))}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
    </Card>
  );
}

export function PlatformReset() {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const { msg, pending, run } = useRun();
  return (
    <Card className="flex flex-col gap-3 border-danger/40 p-5">
      <CardTitle>Sign everyone out</CardTitle>
      <p className="text-xs text-text-muted">Ends every session of every tenant and admin and locks every lane. For a leaked key or a security incident only.</p>
      <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
      <Field label="Type SIGN OUT EVERYONE"><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Button variant="danger" disabled={pending || confirm !== 'SIGN OUT EVERYONE' || reason.trim().length < 5} onClick={() => run(async () => {
        const r = await resetPlatform(reason);
        if (!r.error) window.location.assign('/admin/login');
        return r;
      })}>Sign everyone out</Button>
    </Card>
  );
}
