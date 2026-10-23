'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Lock, MonitorSmartphone, Undo2 } from 'lucide-react';
import { Avatar, Badge, Logo, cn } from '@laneos/ui';

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const hhmm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit' }).format(d);

const linkCls = 'flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-xs font-semibold text-sidebar-text hover:bg-white/10 hover:text-white';

// Top bar of the lane (Figma 1-549); turns red while offline (Figma 11-3260).
export function LaneBar({
  title, laneId, laneCode, shift, cashier, cashierRole = 'Cashier', online = true, queued = 0, onStatus, onLock, onDisplay,
}: {
  title: string;
  laneId: string;
  laneCode: string;
  shift: { shiftNo: number; openedAt: string } | null;
  cashier: string;
  cashierRole?: string;
  online?: boolean;
  queued?: number;
  onStatus?: () => void;
  onLock?: () => void;
  onDisplay?: () => void;
}) {
  const now = useClock();
  return (
    <header className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3', online ? 'bg-sidebar' : 'bg-danger')}>
      <Logo />
      <p className="text-sm font-semibold text-white">{title}</p>
      <Badge tone="brand">Lane {laneCode}</Badge>
      <div className="flex-1" />
      <button type="button" onClick={onStatus} className="flex items-center gap-1.5 text-xs font-medium text-white/80 hover:text-white">
        <span className={cn('size-2 rounded-full', online ? 'bg-[#22c55e]' : 'bg-white')} aria-hidden />
        {online ? (queued ? `Online · ${queued} syncing` : 'Online · synced') : `Offline · ${queued} queued`}
      </button>
      {shift ? <p className="text-xs font-medium text-white/70">Shift #{shift.shiftNo} · since {hhmm(new Date(shift.openedAt))}</p> : null}
      <p className="flex items-center gap-2 text-xs font-semibold text-white">
        <Avatar name={cashier} size={28} />
        {cashier.split(' ')[0]} · {cashierRole}
      </p>
      <nav className="flex items-center gap-1" aria-label="Lane">
        {onDisplay ? <button type="button" onClick={onDisplay} className={linkCls}><MonitorSmartphone size={14} aria-hidden />Display</button> : null}
        <Link href={`/lane/${laneId}/return`} className={linkCls}><Undo2 size={14} aria-hidden />Return</Link>
        {shift ? <Link href={`/lane/${laneId}/shift`} className={linkCls}>Close shift</Link> : null}
        {onLock ? <button type="button" onClick={onLock} className={linkCls}><Lock size={14} aria-hidden />Lock</button> : null}
        <Link href="/backoffice" className={linkCls}>Back office</Link>
      </nav>
      <p className="text-[13px] font-semibold text-white tabular-nums">{now ? hhmm(now) : ''}</p>
    </header>
  );
}
