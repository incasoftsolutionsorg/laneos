'use client';

import { createContext, useContext, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Alert, Button, Card, cn } from '@laneos/ui';
import { saveSettings } from '@/app/(tenant)/backoffice/settings/actions';

// Settings sub-navigation and the shared "Save changes" flow (Figma 1-3701, 1-3902, 1-4145).

const TABS = [
  { href: '/backoffice/settings', label: 'General' },
  { href: '/backoffice/settings/branding', label: 'Branding & themes' },
  { href: '/backoffice/settings/tax', label: 'Tax & rates' },
  { href: '/backoffice/settings/receipt', label: 'Receipt & printer' },
  { href: '/backoffice/lanes', label: 'Devices' },
  { href: '/backoffice/settings/security', label: 'Security' },
  { href: '/backoffice/promotions', label: 'Promotions & loyalty' },
  { href: '/backoffice/billing', label: 'Plan & billing' },
  { href: '/backoffice/support', label: 'Help & support' },
];

export function SettingsNav() {
  const path = usePathname();
  return (
    <Card className="flex h-fit flex-col gap-0.5 p-2 lg:w-[220px] lg:shrink-0">
      <nav aria-label="Settings" className="flex flex-col gap-0.5">
        {TABS.map((t) => {
          const active = t.href === '/backoffice/settings' ? path === t.href : path === t.href || path.startsWith(`${t.href}/`);
          return (
            <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined}
              className={cn('rounded-control px-3 py-2 text-[13px]', active ? 'bg-brand-light font-semibold text-brand-primary' : 'text-text hover:bg-surface-muted')}>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </Card>
  );
}

type Value = string | number | boolean | null;
interface Draft { values: Record<string, Value>; set: (k: string, v: Value) => void }
const DraftContext = createContext<Draft | null>(null);

/** Holds a tab's changed tenant fields; the header's "Save changes" sends only those. */
export function SettingsDraft({ initial, children, readOnly }: { initial: Record<string, Value>; children: React.ReactNode; readOnly?: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== initial[k]));
  const dirty = Object.keys(changed).length > 0;

  return (
    <DraftContext.Provider value={{ values, set: (k, v) => { setMsg(null); setValues((x) => ({ ...x, [k]: v })); } }}>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {readOnly ? <Alert tone="info">Only the owner can change these settings.</Alert> : null}
        {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
        <fieldset disabled={readOnly || pending} className="contents">{children}</fieldset>
        {!readOnly ? (
          <div className="sticky bottom-4 flex justify-end">
            <Button disabled={!dirty || pending} className="shadow-lg" onClick={() => start(async () => {
              const r = await saveSettings(changed);
              setMsg(r.error ? { tone: 'danger', text: r.error } : { tone: 'success', text: r.ok! });
              if (!r.error) router.refresh();
            })}>{pending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</Button>
          </div>
        ) : null}
      </div>
    </DraftContext.Provider>
  );
}

export function useDraft<T extends Value>(key: string): [T, (v: T) => void] {
  const d = useContext(DraftContext);
  if (!d) throw new Error('useDraft outside SettingsDraft');
  return [d.values[key] as T, (v: T) => d.set(key, v)];
}
