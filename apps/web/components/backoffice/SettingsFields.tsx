'use client';

import { BRAND_SWATCHES, Card, CardTitle, Field, Input, SEASONS, Select, Switch, Badge, cn } from '@laneos/ui';
import { useDraft } from './Settings';

// Inputs bound to the settings draft by tenant column name.

export function DText({ name, label, hint, placeholder, maxLength }: { name: string; label: string; hint?: string; placeholder?: string; maxLength?: number }) {
  const [v, set] = useDraft<string | null>(name);
  return <Field label={label} hint={hint}><Input value={v ?? ''} onChange={(e) => set(e.target.value === '' ? null : e.target.value)} placeholder={placeholder} maxLength={maxLength} /></Field>;
}

export function DNumber({ name, label, hint, min, max, suffix, later }: { name: string; label: string; hint?: string; min?: number; max?: number; suffix?: string; later?: boolean }) {
  const [v, set] = useDraft<number | null>(name);
  return (
    <Field label={label} hint={later ? 'Saved now; enforced in a later release' : hint}>
      <div className="flex items-center gap-2">
        <Input type="number" value={v ?? ''} min={min} max={max} disabled={later} onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))} />
        {suffix ? <span className="shrink-0 text-xs text-text-muted">{suffix}</span> : null}
      </div>
    </Field>
  );
}

/** Rupee amount stored in cents. */
export function DMoney({ name, label, hint }: { name: string; label: string; hint?: string }) {
  const [v, set] = useDraft<number>(name);
  return (
    <Field label={label} hint={hint}>
      <Input inputMode="decimal" value={v == null ? '' : String(v / 100)} onChange={(e) => {
        const n = Number(e.target.value.replace(/[^\d.]/g, ''));
        if (Number.isFinite(n)) set(Math.round(n * 100));
      }} />
    </Field>
  );
}

export function DSelect({ name, label, hint, options }: { name: string; label: string; hint?: string; options: [string | number, string][] }) {
  const [v, set] = useDraft<string | number | boolean | null>(name);
  const parse = (raw: string) => (raw === 'true' ? true : raw === 'false' ? false : typeof options[0]?.[0] === 'number' ? Number(raw) : raw);
  return (
    <Field label={label} hint={hint}>
      <Select value={String(v ?? '')} onChange={(e) => set(parse(e.target.value))}>
        {options.map(([k, t]) => <option key={String(k)} value={String(k)}>{t}</option>)}
      </Select>
    </Field>
  );
}

/** `later`: the setting is shown (blueprint §27.6) but nothing enforces it yet, so it cannot be changed. */
export function DSwitch({ name, label, hint, later }: { name: string; label: string; hint?: string; later?: boolean }) {
  const [v, set] = useDraft<boolean>(name);
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-[13px] font-semibold">{label}{later ? <Badge className="ml-2">Later</Badge> : null}</p>
        {hint ? <p className="text-[11px] text-text-muted">{hint}</p> : null}
      </div>
      <Switch on={!!v} onChange={set} label={label} disabled={later} />
    </div>
  );
}

/** Segmented control (paper width, 2FA rule). */
export function DSegment({ name, label, options }: { name: string; label: string; options: [string, string][] }) {
  const [v, set] = useDraft<string>(name);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold">{label}</span>
      <div className="flex w-fit gap-1 rounded-control bg-surface-muted p-1" role="radiogroup" aria-label={label}>
        {options.map(([k, t]) => (
          <button key={k} type="button" role="radio" aria-checked={v === k} onClick={() => set(k)}
            className={cn('rounded-md px-4 py-1.5 text-xs font-semibold', v === k ? 'bg-surface text-text shadow-sm' : 'text-text-muted')}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Brand colour swatches (Figma 1-3701). */
export function BrandSwatches() {
  const [v, set] = useDraft<string>('brand_color');
  return (
    <Card className="flex w-fit flex-col gap-3 p-5">
      <CardTitle>Brand colour</CardTitle>
      <div className="flex gap-3" role="radiogroup" aria-label="Brand colour">
        {BRAND_SWATCHES.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={v?.toUpperCase() === c} aria-label={c} onClick={() => set(c)}
            className={cn('size-9 rounded-full ring-offset-2', v?.toUpperCase() === c && 'ring-2 ring-text')}
            style={{ backgroundColor: c }} />
        ))}
      </div>
    </Card>
  );
}

/** Seasonal theme cards (Figma 1-3701). */
export function SeasonCards() {
  const [theme, setTheme] = useDraft<string>('theme');
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {SEASONS.map((s) => {
        const active = theme === s.key;
        return (
          <div key={s.key} className={cn('overflow-hidden rounded-card border bg-surface', active ? 'border-brand-primary' : 'border-border')}>
            <div className="flex items-center gap-2.5 px-3 py-4 text-[13px] font-semibold text-white" style={{ backgroundColor: s.color }}>
              <span className="size-6 rounded-md" style={{ backgroundColor: s.accent }} aria-hidden />{s.name}
            </div>
            <div className="flex flex-col items-start gap-2 p-3">
              <p className="text-[11px] text-text-muted">{s.text}</p>
              {active ? <Badge tone="success">Active</Badge> : (
                <button type="button" onClick={() => setTheme(s.key)} className="rounded-control bg-brand-light px-4 py-1.5 text-xs font-semibold text-brand-primary">Apply</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
