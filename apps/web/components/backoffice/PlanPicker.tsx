'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatRs } from '@laneos/core';
import { Alert, Badge, Button, Card, cn } from '@laneos/ui';
import { changePlan } from '@/app/(tenant)/backoffice/billing/actions';

export interface PlanCard { id: string; name: string; priceCents: number; perShop: boolean; custom: boolean; description: string | null }

/** Plans from the sign-up page (Figma 1-90), with switch buttons for the owner. */
export function PlanPicker({ plans, current, canChange }: { plans: PlanCard[]; current: string; canChange: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
        {plans.map((p) => (
          <Card key={p.id} className={cn('flex flex-col gap-2 p-4', p.id === current && 'border-brand-primary')}>
            <div className="flex items-center justify-between"><p className="text-[14px] font-bold">{p.name}</p>{p.id === current ? <Badge tone="success">Current</Badge> : null}</div>
            <p className="text-[18px] font-bold text-brand-primary">{p.custom ? 'Custom' : `${formatRs(p.priceCents, { decimals: 0 })}`}<span className="text-xs font-normal text-text-muted">{p.custom ? '' : p.perShop ? ' / shop / month' : ' / month'}</span></p>
            <p className="flex-1 text-xs text-text-muted">{p.description}</p>
            {canChange && p.id !== current ? (
              p.custom ? <a href="mailto:sales@laneos.lk?subject=Chain%20plan" className="text-xs font-semibold text-brand-primary hover:underline">Talk to us</a> : (
                <Button variant="soft" disabled={pending} onClick={() => start(async () => {
                  const r = await changePlan(p.id);
                  setMsg(r.error ? { tone: 'danger', text: r.error } : { tone: 'success', text: r.ok! });
                  if (!r.error) router.refresh();
                })}>Switch to {p.name}</Button>
              )
            ) : null}
          </Card>
        ))}
      </div>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
    </div>
  );
}
