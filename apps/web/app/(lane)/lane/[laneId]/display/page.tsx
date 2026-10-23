'use client';

import { use, useEffect, useState } from 'react';
import { formatRs } from '@laneos/core';
import { subscribeDisplay, type DisplayState } from '@/lib/lane/display';

// Customer-facing display on the lane's second screen (Figma 11-2973). Opened from the lane bar;
// it only listens to the checkout window on the same device.
export default function CustomerDisplayPage({ params }: { params: Promise<{ laneId: string }> }) {
  const { laneId } = use(params);
  const [s, setS] = useState<DisplayState | null>(null);
  useEffect(() => subscribeDisplay(laneId, setS), [laneId]);

  const initials = (s?.tenantName ?? 'LaneOS').split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

  return (
    <main className="flex h-screen bg-surface">
      <section className="flex min-w-0 flex-1 flex-col gap-4 p-7">
        <header className="flex items-center gap-3">
          <span className="flex size-[52px] items-center justify-center rounded-card bg-brand-primary text-[15px] font-bold text-white">{initials}</span>
          <div>
            <p className="text-xl font-bold">{s?.tenantName ?? 'Welcome'}</p>
            <p className="text-xs text-text-muted">{s?.status === 'paid' ? 'Thank you for shopping with us!' : 'Welcome! Your items appear here.'}</p>
          </div>
        </header>
        <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {(s?.lines ?? []).map((l, i) => (
            <li key={i}>
              <div className="flex justify-between py-2 text-[19px]">
                <span>{l.name} <span className="text-[15px] text-text-muted">{l.detail}</span></span>
                <span className="font-semibold tabular-nums">{formatRs(l.amountCents)}</span>
              </div>
              {l.promo ? (
                <div className="flex justify-between pb-2 pl-2 text-[17px] text-success">
                  <span>{l.promo.name}</span><span className="tabular-nums">−{formatRs(l.promo.cents)}</span>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between rounded-card bg-brand-light px-6 py-5 text-brand-primary">
          <span className="text-2xl font-bold">{s?.status === 'paid' && s.changeCents ? `Change ${formatRs(s.changeCents)}` : 'Total'}</span>
          <span className="text-[42px] font-bold tabular-nums">{formatRs(s?.totalCents ?? 0)}</span>
        </div>
        {s?.savingsCents ? <p className="text-sm font-semibold text-success">You saved {formatRs(s.savingsCents)} today</p> : <p className="text-sm">&nbsp;</p>}
      </section>
      {s?.promotion ? (
        <aside className="hidden w-[36%] flex-col items-center justify-center gap-3 bg-danger p-8 text-center text-white md:flex">
          <p className="text-sm font-semibold text-warning-soft">Offer</p>
          <p className="text-3xl font-bold">{s.promotion.name}</p>
          <p className="text-[56px] leading-none font-bold">{s.promotion.detail}</p>
        </aside>
      ) : null}
    </main>
  );
}
