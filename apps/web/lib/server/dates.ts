import 'server-only';

// Day boundaries in the shop's time zone (Asia/Colombo, UTC+5:30, no daylight saving).
const OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** ISO timestamp of local midnight, `daysAgo` days back (0 = today). */
export function colomboDayStart(daysAgo = 0): string {
  const local = new Date(Date.now() + OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - OFFSET_MS - daysAgo * 86_400_000).toISOString();
}

/** ISO timestamp of the first day of this month, local time. */
export function colomboMonthStart(monthsAgo = 0): string {
  const local = new Date(Date.now() + OFFSET_MS);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - monthsAgo, 1);
  return new Date(start - OFFSET_MS).toISOString();
}

/** YYYY-MM-DD for today in Colombo. */
export function colomboToday(): string {
  return new Date(Date.now() + OFFSET_MS).toISOString().slice(0, 10);
}

export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/** "Now", "12 min", "2 h", "Yesterday", or a date — for last-active columns. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 3) return 'Now';
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h`;
  if (min < 48 * 60) return 'Yesterday';
  return fmtDate(iso);
}
