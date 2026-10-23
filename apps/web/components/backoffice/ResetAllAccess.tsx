'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Card, CardTitle, Field, Input } from '@laneos/ui';
import { Dialog } from '@/components/lane/Dialog';
import { resetAllAccess } from '@/app/(tenant)/backoffice/settings/actions';

/** Danger zone: sign everyone out (blueprint §27.5.4). Asks for a reason and the word RESET. */
export function ResetAllAccess({ shopName, multiShop }: { shopName: string; multiShop: boolean }) {
  const [scope, setScope] = useState<'tenant' | 'shop' | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const close = () => { setScope(null); setReason(''); setConfirm(''); setMsg(null); };
  return (
    <Card className="flex flex-col gap-3 border-danger/40 p-5">
      <CardTitle>Reset all access</CardTitle>
      <p className="text-[13px] text-text-muted">If a password or device may be in the wrong hands, sign everyone out at once. Every lane locks; staff sign in or enter their PIN again.</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" onClick={() => setScope('tenant')}>Reset the whole business</Button>
        {multiShop ? <Button variant="secondary" onClick={() => setScope('shop')}>Reset {shopName} only</Button> : null}
      </div>
      {scope ? (
        <Dialog title={scope === 'tenant' ? 'Reset the whole business' : `Reset ${shopName}`} onClose={close} width={460}>
          <Field label="Reason (kept in the audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus /></Field>
          <Field label='Type RESET to confirm'><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
          {msg?.tone === 'success' ? (
            <Button onClick={() => (scope === 'tenant' ? window.location.assign('/login?reason=reset') : close())}>OK</Button>
          ) : (
            <Button variant="danger" disabled={pending || confirm !== 'RESET'} onClick={() => start(async () => {
              const r = await resetAllAccess(scope, reason);
              setMsg(r.error ? { tone: 'danger', text: r.error } : { tone: 'success', text: r.ok! });
            })}>{pending ? 'Resetting…' : 'Sign everyone out'}</Button>
          )}
        </Dialog>
      ) : null}
    </Card>
  );
}
