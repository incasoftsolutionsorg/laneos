// LaneOS UI kit (Figma 1-4) plus the inputs, tables, badges, chips and tabs drawn on the screens.
// Presentational only: no hooks, so they render in server and client components.

import { clsx, type ClassValue } from 'clsx';
import type {
  ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';

export const cn = (...v: ClassValue[]) => clsx(v);

// Buttons -----------------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'soft';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-primary text-white hover:bg-brand-dark',
  secondary: 'bg-surface text-text border border-border hover:bg-surface-muted',
  danger: 'bg-danger text-white hover:brightness-95',
  soft: 'bg-brand-light text-brand-primary hover:bg-brand-soft',
};

/** Class string for buttons, also used on <Link> so links look like buttons. */
export function buttonClass(variant: ButtonVariant = 'primary', extra?: ClassValue) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-control px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap',
    'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary',
    'disabled:cursor-not-allowed disabled:opacity-50',
    buttonVariants[variant],
    extra,
  );
}

export function Button({
  variant = 'primary', className, type = 'button', ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}

// Surfaces ----------------------------------------------------------------------------------

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-border bg-surface', className)} {...props} />;
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('text-[15px] font-semibold text-text', className)}>{children}</h2>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold text-text">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13px] text-text-muted">{subtitle}</p> : null}
      </div>
      {actions}
    </header>
  );
}

export function StatCard({
  label, value, delta, deltaTone = 'success', note,
}: { label: string; value: ReactNode; delta?: string; deltaTone?: 'success' | 'danger' | 'muted'; note?: string }) {
  return (
    <Card className="flex min-w-0 flex-1 flex-col gap-1.5 p-[18px]">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="text-2xl font-bold text-text">{value}</p>
      {delta || note ? (
        <p className="flex gap-1.5 text-xs">
          {delta ? (
            <span className={cn('font-semibold', {
              'text-success': deltaTone === 'success',
              'text-danger': deltaTone === 'danger',
              'text-text-muted': deltaTone === 'muted',
            })}>{delta}</span>
          ) : null}
          {note ? <span className="text-text-muted">{note}</span> : null}
        </p>
      ) : null}
    </Card>
  );
}

// Badges, chips, tabs -------------------------------------------------------------------------

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'neutral';

const toneClasses: Record<Tone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  brand: 'bg-brand-light text-brand-primary',
  neutral: 'bg-surface-sunken text-text-muted',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-[3px] text-[11px] font-semibold whitespace-nowrap', toneClasses[tone], className)}>
      {children}
    </span>
  );
}

export function chipClass(active: boolean) {
  return cn(
    'inline-flex rounded-full px-3 py-[7px] text-xs font-medium whitespace-nowrap transition-colors',
    active ? 'bg-brand-primary text-white' : 'border border-border bg-surface text-text hover:bg-surface-muted',
  );
}

export function tabsClass() {
  return 'inline-flex gap-1 rounded-[10px] bg-surface-sunken p-1';
}

export function tabClass(active: boolean) {
  return cn(
    'rounded-[7px] px-3.5 py-[7px] text-xs whitespace-nowrap',
    active ? 'bg-surface font-semibold text-text shadow-sm' : 'font-medium text-text-muted hover:text-text',
  );
}

// Form controls ------------------------------------------------------------------------------

export function Field({
  label, error, hint, children, className,
}: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-xs font-semibold text-text">{label}</span>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : hint ? <span className="text-xs text-text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass = cn(
  'w-full rounded-control border border-border-strong bg-surface px-3.5 py-[11px] text-sm text-text',
  'placeholder:text-text-placeholder focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-light',
  'aria-[invalid=true]:border-danger',
);

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputClass, 'appearance-auto', className)} {...props} />;
}

/** On/off switch (Figma toggles). Controlled: pass `on` and `onChange`. */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50', on ? 'bg-brand-primary' : 'bg-border-strong')}
    >
      <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left]', on ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

export function Alert({ tone = 'danger', children }: { tone?: Tone; children: ReactNode }) {
  return <div role="alert" className={cn('rounded-control px-3 py-2.5 text-[13px]', toneClasses[tone])}>{children}</div>;
}

// Tables --------------------------------------------------------------------------------------

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Card className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left">{children}</table>
    </Card>
  );
}

export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('bg-surface-muted px-4 py-[11px] text-[11px] font-semibold text-text-muted whitespace-nowrap', className)} {...props} />;
}

export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-t border-border px-4 py-2.5 text-[13px] text-text', className)} {...props} />;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="border-t border-border px-4 py-10 text-center text-[13px] text-text-muted">{children}</td>
    </tr>
  );
}

// Identity --------------------------------------------------------------------------------------

export function Logo({ size = 34, inverted = false }: { size?: number; inverted?: boolean }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[9px] font-bold',
        inverted ? 'bg-surface text-brand-primary' : 'bg-brand-primary text-white')}
      style={{ width: size, height: size, fontSize: size * 0.53 }}
      aria-hidden
    >
      L
    </span>
  );
}

/** Two-letter badge text: first letters of the first two words that start with a letter or digit
 *  ("Bananas (Ambul) per kg" → "BP", not "B("). */
export function initials(name: string) {
  return name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand-primary"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

// Product card (lane) -----------------------------------------------------------------------------

const thumbColors = ['bg-brand-light', 'bg-warning-soft', 'bg-info-soft', 'bg-[#fce7f3]', 'bg-[#ede9fe]', 'bg-[#ffedd5]', 'bg-[#e0f2fe]', 'bg-success-soft'];

export function ProductCard({
  name, price, meta, colorIndex = 0, onClick, disabled,
}: { name: string; price: string; meta: string; colorIndex?: number; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full flex-col gap-2 rounded-card border border-border bg-surface p-2.5 text-left transition hover:border-brand-primary focus-visible:outline-2 focus-visible:outline-brand-primary disabled:opacity-50"
    >
      <span className={cn('flex h-[92px] w-full items-center justify-center rounded-control text-[22px] font-bold text-brand-primary', thumbColors[colorIndex % thumbColors.length])}>
        {initials(name)}
      </span>
      <span className="line-clamp-2 min-h-[32px] text-[13px] font-semibold leading-tight text-text">{name}</span>
      <span className="flex items-center justify-between gap-1">
        <span className="text-sm font-bold text-brand-primary">{price}</span>
        <span className="text-[11px] text-text-muted">{meta}</span>
      </span>
    </button>
  );
}

// States (Figma 11-4920) -------------------------------------------------------------------------

/** Empty or error panel: icon, title, one line of help and the next action. */
export function EmptyState({
  icon, title, children, action, tone = 'neutral',
}: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; tone?: 'neutral' | 'danger' }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-12 text-center">
      {icon ? (
        <span className={cn('flex size-14 items-center justify-center rounded-full', tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-brand-light text-brand-primary')}>{icon}</span>
      ) : null}
      <p className="text-[17px] font-semibold text-text">{title}</p>
      {children ? <div className="text-[13px] text-text-muted">{children}</div> : null}
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Grey placeholder block while a page loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-card bg-surface-sunken', className)} aria-hidden />;
}
