'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PERM, PERM_LABEL, type Permission } from '@laneos/core';
import { Alert, Button, Card, CardTitle, Field, Input, Select, Switch } from '@laneos/ui';
import { Dialog } from '@/components/lane/Dialog';
import { addMember, endSession, resetMemberAccess, updateMember } from '@/app/(tenant)/backoffice/staff/actions';

export interface RoleOpt { id: string; key: string; name: string; permissions: number }
export interface ShopOpt { id: string; code: string; name: string }

/** The four toggles the design shows when adding someone; the edit page shows every permission. */
const QUICK: Permission[] = ['return.create', 'cash.pickup', 'item.edit', 'stock.adjust'];

export interface StaffInitial {
  id: string; name: string; login: string; staffCode: string; phone: string; roleId: string; shop: string; perms: number;
  active: boolean; hasLogin: boolean; hasPin: boolean;
}

/** Add user panel (Figma 1-3237) and the edit form (same fields). */
export function StaffForm({ roles, shops, initial, canOwner }: { roles: RoleOpt[]; shops: ShopOpt[]; initial?: StaffInitial; canOwner: boolean }) {
  const router = useRouter();
  const editing = !!initial;
  const pickable = roles.filter((r) => canOwner || r.key !== 'owner');
  const cashier = pickable.find((r) => r.key === 'cashier') ?? pickable[0]!;
  const [name, setName] = useState(initial?.name ?? '');
  const [login, setLogin] = useState(initial?.login ?? '');
  const [code, setCode] = useState(initial?.staffCode ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [roleId, setRoleId] = useState(initial?.roleId ?? cashier.id);
  const [shop, setShop] = useState(initial?.shop ?? shops[0]?.id ?? 'all');
  const [pin, setPin] = useState('');
  const [active, setActive] = useState(initial?.active ?? true);
  const role = roles.find((r) => r.id === roleId)!;
  const [perms, setPerms] = useState(initial?.perms ?? role.permissions);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success' | 'warning'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const lockedOwner = editing && role.key === 'owner' && !canOwner;

  const changeRole = (id: string) => {
    setRoleId(id);
    setPerms(roles.find((r) => r.id === id)!.permissions); // a new role starts from its own defaults
  };
  const toggle = (p: Permission, on: boolean) => setPerms((m) => (on ? m | PERM[p] : m & ~PERM[p]));

  const save = () => start(async () => {
    setMsg(null);
    const base = { name, login, roleId, shop, pin: pin || undefined, phone, perms, roleMask: role.permissions };
    const r = initial ? await updateMember(initial.id, { ...base, active, staffCode: code }) : await addMember(base);
    if (r.error) return setMsg({ tone: r.ok ? 'warning' : 'danger', text: r.error });
    setMsg({ tone: 'success', text: editing ? 'Saved. A change to role, shops or permissions signs them out so it applies at once.' : `${name} added.` });
    setPin('');
    if (!editing) { setName(''); setLogin(''); setPerms(cashier.permissions); setRoleId(cashier.id); }
    router.refresh();
  });

  const list = editing ? (Object.keys(PERM) as Permission[]) : QUICK;
  return (
    <Card className="flex flex-col gap-3.5 p-5">
      <CardTitle>{editing ? 'Edit user' : 'Add user'}</CardTitle>
      <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
      {initial ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sign-in"><Input value={initial.hasLogin ? initial.login : 'PIN only'} disabled /></Field>
          <Field label="Staff code"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))} /></Field>
        </div>
      ) : (
        <Field label="Email (managers) or cashier code" hint="An email gets an invite to sign in; a code is for PIN-only cashiers">
          <Input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="C104" />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role">
          <Select value={roleId} onChange={(e) => changeRole(e.target.value)} disabled={lockedOwner}>
            {(lockedOwner ? roles : pickable).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>
        <Field label="Shop">
          <Select value={shop} onChange={(e) => setShop(e.target.value)} disabled={lockedOwner}>
            {shops.map((s) => <option key={s.id} value={s.id}>{s.name} {s.code}</option>)}
            <option value="all">All shops</option>
          </Select>
        </Field>
      </div>
      <Field label={initial?.hasPin ? 'New PIN (leave blank to keep)' : 'PIN'} hint="4–6 digits, used to unlock a lane">
        <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} type="password" inputMode="numeric" autoComplete="new-password" />
      </Field>
      {editing ? <Field label="Mobile (optional)"><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="077 123 4567" /></Field> : null}
      <p className="text-[13px] font-semibold">Permissions</p>
      <div className="flex flex-col gap-2.5">
        {list.map((p) => (
          <div key={p} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium">{PERM_LABEL[p].label}</p>
              {PERM_LABEL[p].hint ? <p className="text-[11px] text-text-muted">{PERM_LABEL[p].hint}</p> : null}
            </div>
            <Switch on={(perms & PERM[p]) !== 0} onChange={(on) => toggle(p, on)} label={PERM_LABEL[p].label}
              disabled={lockedOwner || (p === 'settings.manage' && !canOwner)} />
          </div>
        ))}
      </div>
      {editing ? (
        <div className="flex items-center justify-between border-t border-border pt-3">
          <div><p className="text-[13px] font-medium">Active</p><p className="text-[11px] text-text-muted">Inactive staff cannot sign in; their PIN is cleared</p></div>
          <Switch on={active} onChange={setActive} label="Active" disabled={lockedOwner} />
        </div>
      ) : null}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Button onClick={save} disabled={pending || lockedOwner || !name.trim() || (!editing && !login.trim())}>
        {pending ? 'Saving…' : editing ? 'Save changes' : 'Create user'}
      </Button>
    </Card>
  );
}

/** "Reset access" link with a reason dialog. */
export function ResetAccessButton({ memberId, name, className }: { memberId: string; name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setMsg(null); }} className={className ?? 'font-semibold text-brand-primary hover:underline'}>Reset access</button>
      {open ? (
        <Dialog title={`Reset access · ${name}`} onClose={() => setOpen(false)} width={440}>
          <p className="text-[13px] text-text-muted">Signs {name} out of every device and lane straight away. Use it when a phone is lost, someone leaves, or a password may be known.</p>
          <Field label="Reason (kept in the audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus /></Field>
          {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setOpen(false)}>{msg?.tone === 'success' ? 'Close' : 'Cancel'}</Button>
            {msg?.tone !== 'success' ? (
              <Button variant="danger" disabled={pending} onClick={() => start(async () => {
                const r = await resetMemberAccess(memberId, reason);
                setMsg(r.error ? { tone: 'danger', text: r.error } : { tone: 'success', text: r.ok! });
              })}>{pending ? 'Resetting…' : 'Reset access'}</Button>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

export function EndSessionButton({ id, current }: { id: string; current: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button type="button" disabled={pending} className="text-xs font-semibold text-danger hover:underline disabled:opacity-50"
        onClick={() => start(async () => {
          const r = await endSession(id);
          if (r.error) setError(r.error);
          else if (current) window.location.href = '/login';
          else router.refresh();
        })}>
        {pending ? 'Ending…' : current ? 'Sign out here' : 'End session'}
      </button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}
