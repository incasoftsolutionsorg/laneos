'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Avatar, Badge, Logo, cn } from '@laneos/ui';

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

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

// Top bar of the lane (Figma 1-549).
export function LaneBar({
  title, laneCode, shift, cashier, onCloseShift,
}: {
  title: string;
  laneCode: string;
  shift: { shiftNo: number; openedAt: string } | null;
  cashier: string;
  onCloseShift?: () => void;
}) {
  const online = useOnline();
  const now = useClock();
  return (
    <header className="flex flex-wrap items-center gap-4 bg-sidebar px-5 py-3">
      <Logo />
      <p className="text-sm font-semibold text-white">{title}</p>
      <Badge tone="brand">Lane {laneCode}</Badge>
      <div className="flex-1" />
      <p className="flex items-center gap-1.5 text-xs font-medium text-sidebar-muted">
        <span className={cn('size-2 rounded-full', online ? 'bg-[#22c55e]' : 'bg-warning')} aria-hidden />
        {online ? 'Online' : 'Offline — sales need a connection for now'}
      </p>
      {shift ? (
        <p className="text-xs font-medium text-sidebar-muted">Shift #{shift.shiftNo} · since {hhmm(new Date(shift.openedAt))}</p>
      ) : null}
      <p className="flex items-center gap-2 text-xs font-semibold text-white">
        <Avatar name={cashier} size={28} />
        {cashier}
      </p>
      {onCloseShift ? (
        <button type="button" onClick={onCloseShift} className="rounded-control border border-sidebar-raised px-3 py-1.5 text-xs font-semibold text-sidebar-text hover:bg-sidebar-raised">
          Close shift
        </button>
      ) : null}
      <Link href="/backoffice" className="text-xs font-semibold text-sidebar-text hover:text-white">Back office</Link>
      <p className="text-[13px] font-semibold text-white tabular-nums">{now ? hhmm(now) : ''}</p>
    </header>
  );
}
