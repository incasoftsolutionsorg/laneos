import { formatRs } from '@laneos/core';
import { cn } from '@laneos/ui';

const OPEN_HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7 am – 9 pm

const label = (h: number) => (h === 0 ? '12' : h > 12 ? String(h - 12) : String(h));

// "Sales by hour" (Figma 1-434): one series, the current hour in the brand colour.
export function HourlyBars({ byHour, currentHour }: { byHour: { hour: number; cents: number }[]; currentHour: number }) {
  const values = new Map(byHour.map((b) => [b.hour, b.cents]));
  const hours = [...new Set([...OPEN_HOURS, ...byHour.map((b) => b.hour)])].sort((a, b) => a - b);
  const max = Math.max(1, ...values.values());

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex h-[190px] items-end justify-between gap-0.5" aria-hidden>
        {hours.map((h) => {
          const cents = values.get(h) ?? 0;
          const height = cents === 0 ? 2 : Math.max(6, Math.round((cents / max) * 170));
          return (
            <div key={h} className="group relative flex flex-1 flex-col items-center gap-1.5">
              <span className="pointer-events-none absolute -top-8 z-10 hidden rounded-md bg-text px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-white group-hover:block">
                {label(h)}{h >= 12 ? ' pm' : ' am'} · {formatRs(cents, { decimals: 0 })}
              </span>
              <div
                className={cn('w-full max-w-[26px] rounded-t-[4px]', h === currentHour ? 'bg-brand-primary' : 'bg-chart-bar')}
                style={{ height }}
              />
              <span className="text-[10px] text-text-muted">{label(h)}</span>
            </div>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>Sales by hour today</caption>
        <tbody>
          {hours.map((h) => (
            <tr key={h}><th scope="row">{h}:00</th><td>{formatRs(values.get(h) ?? 0, { decimals: 0 })}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
