'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Avatar, Button, Logo, cn } from '@laneos/ui';
import { changeLanePin, registerLane, unlockLane } from '@/app/(lane)/lane/actions';
import { getLaneKey, rememberLane, setLaneKey } from '@/lib/lane/device';

interface Cashier { id: string; name: string; locked: boolean }

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'] as const;

// "Who is selling?" (Figma 1-198): pick a cashier, type a 4–6 digit PIN on a registered lane.
export function PinScreen({
  laneId, laneLabel, cashiers, registered, canRegister,
}: { laneId: string; laneLabel: string; cashiers: Cashier[]; registered: boolean; canRegister: boolean }) {
  const router = useRouter();
  const [key, setKey] = useState<string | null | undefined>(undefined); // undefined = still loading
  const [who, setWho] = useState<string | null>(cashiers.length === 1 ? cashiers[0]!.id : null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // PIN change when the tenant's interval has passed: old PIN kept in memory only until the change is sent.
  const [stage, setStage] = useState<'pin' | 'new' | 'confirm'>('pin');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');

  useEffect(() => {
    rememberLane(laneId);
    getLaneKey(laneId).then((k) => setKey(k ?? null)).catch(() => setKey(null));
  }, [laneId]);

  const submit = useCallback(async () => {
    if (!who) return setError('Choose who is selling first.');
    if (pin.length < 4) return setError('Enter your 4–6 digit PIN.');
    if (stage === 'new') { setNewPin(pin); setPin(''); setStage('confirm'); return; }
    setBusy(true);
    if (stage === 'confirm') {
      if (pin !== newPin) { setBusy(false); setPin(''); setStage('new'); return setError('The two new PINs do not match. Type the new PIN again.'); }
      const c = await changeLanePin(laneId, key ?? null, who, oldPin, newPin);
      setBusy(false); setPin('');
      if (c.ok) { setOldPin(''); setNewPin(''); router.replace(`/lane/${laneId}`); return; }
      setStage('new');
      return setError(c.error ?? 'Could not change the PIN.');
    }
    const r = await unlockLane(laneId, key ?? null, who, pin);
    setBusy(false);
    if (r.code === 'PIN_EXPIRED') { setOldPin(pin); setPin(''); setStage('new'); return; }
    setPin('');
    if (r.ok) router.replace(`/lane/${laneId}`);
    else setError(r.error ?? 'Could not unlock.');
  }, [key, laneId, newPin, oldPin, pin, router, stage, who]);

  const press = useCallback((k: (typeof KEYS)[number]) => {
    setError(null);
    if (k === 'C') setPin('');
    else if (k === 'OK') void submit();
    else setPin((p) => (p.length < 6 ? p + k : p));
  }, [submit]);

  // Physical keyboard and number pad work too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key as (typeof KEYS)[number]);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') press('OK');
      else if (e.key === 'Escape') press('C');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  const register = async () => {
    setBusy(true);
    const r = await registerLane(laneId);
    setBusy(false);
    if (r.key) {
      await setLaneKey(laneId, r.key);
      setKey(r.key);
      router.refresh();
    } else setError(r.error ?? 'Could not register this device.');
  };

  const needsDevice = key === null || !registered;

  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-6">
      <div className="flex w-full max-w-[460px] flex-col items-center gap-[18px] rounded-[20px] bg-surface p-8 shadow-[0_8px_24px_rgba(15,23,41,0.12)]">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-[13px] font-semibold">{laneLabel}</span>
        </div>

        {key === undefined ? (
          <p className="text-[13px] text-text-muted">Checking this device…</p>
        ) : needsDevice ? (
          <div className="flex w-full flex-col items-center gap-3 text-center">
            <h1 className="text-[22px] font-bold">Register this device</h1>
            <p className="text-[13px] text-text-muted">
              {registered
                ? 'This lane is registered to another device. Registering here signs the old device out of this lane.'
                : 'Cashiers can sign in with a PIN only on a registered lane device.'}
            </p>
            {error ? <Alert>{error}</Alert> : null}
            {canRegister ? (
              <Button onClick={register} disabled={busy} className="w-full">{busy ? 'Registering…' : 'Register this device for the lane'}</Button>
            ) : (
              <Alert tone="warning">Ask a manager to register this device.</Alert>
            )}
            <Link href="/lane" className="text-[13px] font-semibold text-brand-primary">Choose another lane</Link>
          </div>
        ) : (
          <>
            <h1 className="text-[22px] font-bold">{stage === 'pin' ? 'Who is selling?' : 'Choose a new PIN'}</h1>
            {cashiers.length === 0 ? (
              <Alert tone="warning">Nobody has a PIN for this shop yet. Set PINs in Users &amp; roles.</Alert>
            ) : (
              <div className="flex flex-wrap justify-center gap-3" role="radiogroup" aria-label="Cashier">
                {cashiers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={who === c.id}
                    disabled={c.locked}
                    onClick={() => { setWho(c.id); setError(null); setStage('pin'); setPin(''); setOldPin(''); setNewPin(''); }}
                    className={cn('flex w-[76px] flex-col items-center gap-1.5 rounded-card border p-2.5 disabled:opacity-40',
                      who === c.id ? 'border-brand-primary bg-brand-light' : 'border-border bg-surface hover:border-brand-primary')}
                    title={c.locked ? 'Locked for 15 minutes after wrong PINs' : undefined}
                  >
                    <Avatar name={c.name} size={44} />
                    <span className="max-w-full truncate text-xs font-semibold">{c.name.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-[13px] text-text-muted">
              {stage === 'pin' ? 'Enter your 4–6 digit PIN' : stage === 'new' ? 'Your PIN is due for a change. Type a new 4–6 digit PIN.' : 'Type the new PIN again'}
            </p>
            <div className="flex gap-[13px]" aria-label={`${pin.length} digits entered`}>
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className={cn('size-3.5 rounded-full', i < pin.length ? 'bg-brand-primary' : 'bg-border-strong')} />
              ))}
            </div>
            {error ? <Alert>{error}</Alert> : null}
            <div className="grid grid-cols-3 gap-3">
              {KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  disabled={busy}
                  className={cn('flex h-[62px] w-[84px] items-center justify-center rounded-card text-[22px] font-semibold',
                    k === 'OK' ? 'bg-brand-primary text-white hover:bg-brand-dark' : 'bg-surface-muted text-text hover:bg-surface-sunken')}
                  aria-label={k === 'C' ? 'Clear' : k === 'OK' ? 'Sign in' : k}
                >
                  {k}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-muted">5 wrong PINs lock this cashier for 15 minutes</p>
          </>
        )}
      </div>
    </main>
  );
}
