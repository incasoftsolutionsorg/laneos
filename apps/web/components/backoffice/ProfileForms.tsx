'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Avatar, Badge, Button, Card, CardTitle, Field, Input, Select, buttonClass } from '@laneos/ui';
import { changePassword, saveProfile } from '@/app/(tenant)/backoffice/profile/actions';
import { createClient } from '@/lib/supabase/browser';

type Msg = { tone: 'danger' | 'success'; text: string } | null;

/** Profile card (Figma 1-3518, left). */
export function ProfileCard({ name, email, phone, language, roleLine }: { name: string; email: string; phone: string; language: string; roleLine: string }) {
  const router = useRouter();
  const [v, setV] = useState({ name, email, phone, language });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="flex flex-col gap-3.5 p-5">
      <CardTitle>Profile</CardTitle>
      <div className="flex items-center gap-4">
        <Avatar name={name} size={64} />
        <div>
          <p className="text-[17px] font-bold">{name}</p>
          <p className="text-xs text-text-muted">{roleLine}</p>
        </div>
      </div>
      <Field label="Full name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={80} /></Field>
      <Field label="Email" hint="Changing it sends a confirmation link to the new address"><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
      <Field label="Mobile"><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} inputMode="tel" placeholder="077 123 4567" /></Field>
      <Field label="Language">
        <Select value={v.language} onChange={(e) => setV({ ...v, language: e.target.value })}>
          <option value="en">English</option>
          <option value="si">සිංහල (Sinhala)</option>
          <option value="ta">தமிழ் (Tamil)</option>
        </Select>
      </Field>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Button disabled={pending} onClick={() => start(async () => {
        const r = await saveProfile(v);
        setMsg(r.error ? { tone: 'danger', text: r.error } : { tone: 'success', text: r.ok! });
        if (!r.error) router.refresh();
      })}>{pending ? 'Saving…' : 'Save profile'}</Button>
    </Card>
  );
}

/** Password & 2-step verification (Figma 1-3518, right). */
export function SecurityCard({ factorId, required }: { factorId: string | null; required: boolean }) {
  const router = useRouter();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="flex flex-col gap-3.5 p-5">
      <CardTitle>Password & 2-step verification</CardTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="New password"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <Field label="Confirm"><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
      </div>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Button variant="secondary" disabled={pending || !pw.current || !pw.next} onClick={() => start(async () => {
        const r = await changePassword(pw.current, pw.next, pw.confirm);
        setMsg(r.error ? { tone: 'danger', text: r.error } : { tone: 'success', text: r.ok! });
        if (!r.error) setPw({ current: '', next: '', confirm: '' });
      })}>{pending ? 'Changing…' : 'Change password'}</Button>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        {factorId ? <Badge tone="success">Authenticator on</Badge> : <Badge tone={required ? 'danger' : 'neutral'}>Authenticator off</Badge>}
        <span className="flex-1 text-xs text-text-muted">
          {factorId ? 'Codes are required when you sign in.' : required ? 'Your business requires 2-step verification for your role.' : 'Add an authenticator app for a code at sign-in.'}
        </span>
        {factorId ? (
          <button type="button" className="text-xs font-semibold text-danger hover:underline" onClick={() => start(async () => {
            const { error } = await createClient().auth.mfa.unenroll({ factorId });
            setMsg(error ? { tone: 'danger', text: error.code === 'insufficient_aal' ? 'Sign in again with a code before turning this off.' : error.message } : { tone: 'success', text: 'Authenticator removed.' });
            if (!error) router.refresh();
          })}>Turn off</button>
        ) : (
          <Link href="/backoffice/profile/security/enrol-mfa" className={buttonClass('primary')}>Set up</Link>
        )}
      </div>
    </Card>
  );
}

/** TOTP enrolment: QR code → 6-digit code → verified (session becomes aal2). */
export function EnrolMfa({ done = '/backoffice/profile' }: { done?: string }) {
  const router = useRouter();
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      // Drop half-finished enrolments from earlier attempts; Supabase allows only a few unverified factors.
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of list?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `LaneOS ${new Date().toISOString().slice(0, 10)}` });
      if (e) return setError(e.message);
      setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, []);

  return (
    <Card className="flex max-w-lg flex-col gap-4 p-6">
      <CardTitle>Set up your authenticator</CardTitle>
      <ol className="list-decimal space-y-1 pl-5 text-[13px] text-text-muted">
        <li>Open Google Authenticator, Microsoft Authenticator or a similar app.</li>
        <li>Scan this code, or type the key.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {factor ? (
        <div className="flex items-center gap-5">
          {/* The QR is an SVG data URL generated by Supabase Auth. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={factor.qr} alt="QR code for your authenticator app" className="size-40 rounded-card border border-border bg-white p-2" />
          <div className="min-w-0">
            <p className="text-xs text-text-muted">Key</p>
            <p className="break-all font-mono text-[13px]">{factor.secret}</p>
          </div>
        </div>
      ) : !error ? <p className="text-[13px] text-text-muted">Preparing…</p> : null}
      <form className="flex items-end gap-3" onSubmit={(e) => {
        e.preventDefault();
        if (!factor) return;
        start(async () => {
          setError(null);
          const { error: e2 } = await createClient().auth.mfa.challengeAndVerify({ factorId: factor.id, code });
          if (e2) return setError(e2.code === 'mfa_verification_failed' ? 'That code is not right. Wait for a new one and try again.' : e2.message);
          router.push(done);
          router.refresh();
        });
      }}>
        <Field label="6-digit code" className="flex-1">
          <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="font-mono text-lg tracking-[0.3em]" />
        </Field>
        <Button type="submit" disabled={pending || code.length !== 6 || !factor}>{pending ? 'Checking…' : 'Turn on'}</Button>
      </form>
      {error ? <Alert>{error}</Alert> : null}
    </Card>
  );
}
