'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Field, Input, type Tone } from '@laneos/ui';
import { Dialog } from '@/components/lane/Dialog';
import { resetShopAccess, setMemberShops } from '@/app/(tenant)/backoffice/access/actions';

export interface AccessRow { id: string; name: string; role: string; roleTone: Tone; owner: boolean; all: boolean; shopIds: string[] }

/** People × shops. Ticking a box gives (or takes away) a shop; "All" covers shops added later too. */
export function AccessMatrix({ rows, shops, canOwner }: { rows: AccessRow[]; shops: { id: string; code: string; name: string }[]; canOwner: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const save = (r: AccessRow, all: boolean, ids: string[]) => {
    setBusy(r.id); setError(null);
    start(async () => {
      const res = await setMemberShops(r.id, all, ids);
      setBusy(null);
      if (res.error) setError(`${r.name}: ${res.error}`); else router.refresh();
    });
  };
  return (
    <div className="flex flex-col gap-2">
      {error ? <Alert>{error}</Alert> : null}
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="bg-surface-muted text-[11px] font-semibold text-text-muted">
              <th className="px-4 py-2.5">Person</th><th className="px-3">Role</th><th className="px-3 text-center">All shops</th>
              {shops.map((s) => <th key={s.id} className="px-3 text-center">{s.code}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const locked = (r.owner && !canOwner) || busy === r.id;
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium">{r.name}</td>
                  <td className="px-3"><Badge tone={r.roleTone}>{r.role}</Badge></td>
                  <td className="px-3 text-center">
                    <input type="checkbox" className="size-4 accent-brand-primary" checked={r.all} disabled={locked} aria-label={`${r.name}: all shops`}
                      onChange={(e) => save(r, e.target.checked, e.target.checked ? [] : r.shopIds.length ? r.shopIds : shops.slice(0, 1).map((s) => s.id))} />
                  </td>
                  {shops.map((s) => (
                    <td key={s.id} className="px-3 text-center">
                      <input type="checkbox" className="size-4 accent-brand-primary" disabled={locked || r.all} aria-label={`${r.name}: ${s.name}`}
                        checked={r.all || r.shopIds.includes(s.id)}
                        onChange={(e) => save(r, false, e.target.checked ? [...r.shopIds, s.id] : r.shopIds.filter((x) => x !== s.id))} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ResetShopButton({ shop }: { shop: { id: string; code: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className="text-xs font-semibold text-danger hover:underline" onClick={() => { setOpen(true); setMsg(null); }}>Reset {shop.code}</button>
      {open ? (
        <Dialog title={`Reset access · ${shop.name}`} onClose={() => setOpen(false)} width={440}>
          <p className="text-[13px] text-text-muted">Signs out everyone who works only at {shop.name} and locks its lanes. People with all-shop access are not affected.</p>
          <Field label="Reason (kept in the audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus /></Field>
          {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
          {msg?.tone === 'success' ? <Button onClick={() => setOpen(false)}>Close</Button> : (
            <Button variant="danger" disabled={pending} onClick={() => start(async () => {
              const r = await resetShopAccess(shop.id, reason);
              setMsg(r.error ? { tone: 'danger', text: r.error } : { tone: 'success', text: r.ok! });
            })}>{pending ? 'Resetting…' : 'Reset access'}</Button>
          )}
        </Dialog>
      ) : null}
    </>
  );
}
