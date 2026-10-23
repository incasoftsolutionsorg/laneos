'use client';

import { useState } from 'react';
import { formatRs } from '@laneos/core';
import { Alert, Avatar, Badge, Button, Field, Input, Switch, tabClass, tabsClass } from '@laneos/ui';
import { addLaneCustomer, checkCreditNote, findCustomer, setConsent, type CustomerHit, type NoteCheck } from '@/app/(lane)/lane/actions';
import { Dialog } from '../Dialog';

export interface AppliedNote { code: string; noteNo: string; balanceCents: number }

/** Loyalty member / credit note (Figma 11-4756). */
export function CustomerDialog({
  laneId, offline, initialTab = 'member', onAttach, onApplyNote, onClose,
}: {
  laneId: string; offline: boolean; initialTab?: 'member' | 'note';
  onAttach: (c: CustomerHit) => void; onApplyNote: (n: AppliedNote) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [phone, setPhone] = useState('');
  const [hit, setHit] = useState<CustomerHit | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [consent, setConsentState] = useState(false);
  const [code, setCode] = useState('');
  const [note, setNote] = useState<NoteCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = async () => {
    setBusy(true); setError(null); setCreating(false);
    const c = await findCustomer(phone);
    setBusy(false);
    setHit(c);
    if (c) setConsentState(c.marketingConsent);
    else setError('No member with that number. Add them as a new member.');
  };

  const create = async () => {
    setBusy(true); setError(null);
    const r = await addLaneCustomer(name, phone, consent);
    setBusy(false);
    if (r.customer) { setHit(r.customer); setCreating(false); } else setError(r.error ?? 'Could not add the member.');
  };

  const toggleConsent = async (v: boolean) => {
    setConsentState(v);
    if (hit) {
      const r = await setConsent(hit.id, v);
      if (r.error) { setConsentState(!v); setError(r.error); }
    }
  };

  return (
    <Dialog title={tab === 'member' ? 'Loyalty member' : 'Credit note'} onClose={onClose} width={560}>
      <div className={tabsClass()} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'member'} className={tabClass(tab === 'member')} onClick={() => { setTab('member'); setError(null); }}>Loyalty member</button>
        <button type="button" role="tab" aria-selected={tab === 'note'} className={tabClass(tab === 'note')} onClick={() => { setTab('note'); setError(null); }}>Credit note</button>
      </div>

      {tab === 'member' ? (
        <>
          <form onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
            <Field label="Mobile number">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="077 123 4567" autoFocus />
            </Field>
          </form>
          {error ? <Alert tone="warning">{error}</Alert> : null}
          {hit ? (
            <div className="flex items-center gap-3 rounded-card bg-surface-muted p-3">
              <Avatar name={hit.name} size={44} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{hit.name}</p>
                <p className="text-xs text-text-muted">Member since {new Date(hit.since).getFullYear()} · {hit.loyaltyPoints.toLocaleString('en-US')} points</p>
                {hit.balanceDueCents > 0 ? <Badge tone="warning">Owes {formatRs(hit.balanceDueCents)}</Badge> : null}
              </div>
            </div>
          ) : null}
          {creating ? (
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          ) : null}
          {hit || creating ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-semibold">Customer agrees to receive offers by SMS</p>
                <p className="text-xs text-text-muted">Consent saved with time</p>
              </div>
              <Switch on={consent} onChange={toggleConsent} label="SMS offers consent" />
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            {creating ? (
              <Button variant="secondary" onClick={() => setCreating(false)}>Back</Button>
            ) : (
              <Button variant="secondary" disabled={offline} onClick={() => { setCreating(true); setHit(null); setError(null); }}>New member</Button>
            )}
            {creating ? (
              <Button onClick={create} disabled={busy}>{busy ? 'Saving…' : 'Save & attach'}</Button>
            ) : hit ? (
              <Button onClick={() => onAttach(hit)}>Attach to sale</Button>
            ) : (
              <Button onClick={lookup} disabled={busy || offline}>{busy ? 'Looking up…' : 'Find member'}</Button>
            )}
          </div>
          {offline ? <p className="text-xs text-warning">Member look-up needs a connection.</p> : null}
        </>
      ) : (
        <>
          {offline ? <Alert tone="warning">Credit notes need a connection.</Alert> : null}
          <form onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true); setError(null);
            const r = await checkCreditNote(code, laneId);
            setBusy(false);
            setNote(r);
            if (!r.ok) setError(r.error ?? 'Credit note cannot be used.');
          }}>
            <Field label="Credit note code" hint="12 letters and digits from the slip, e.g. K7QF-9M2X-HD4T">
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus disabled={offline} className="font-mono" />
            </Field>
          </form>
          {error ? <Alert>{error}</Alert> : null}
          {note?.ok ? (
            <div className="flex items-center justify-between rounded-card bg-success-soft p-3 text-success">
              <div>
                <p className="text-[13px] font-semibold">{note.noteNo}</p>
                <p className="text-xs">Valid until {note.expiresOn}</p>
              </div>
              <p className="text-xl font-bold">{formatRs(note.balanceCents ?? 0)}</p>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            {note?.ok ? (
              <Button onClick={() => onApplyNote({ code, noteNo: note.noteNo!, balanceCents: note.balanceCents! })}>Use as payment</Button>
            ) : (
              <Button disabled={busy || offline || !code} onClick={async () => {
                setBusy(true); setError(null);
                const r = await checkCreditNote(code, laneId);
                setBusy(false); setNote(r);
                if (!r.ok) setError(r.error ?? 'Credit note cannot be used.');
              }}>{busy ? 'Checking…' : 'Check balance'}</Button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
