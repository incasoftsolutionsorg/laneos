import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPerm } from '@laneos/core';
import { Badge, EmptyRow, PageHeader, Table, TD, TH } from '@laneos/ui';
import { LaneForm } from '@/components/backoffice/QuickForms';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Devices & lanes' };

export default async function LanesPage() {
  const ctx = await requireTenant();
  const [{ data: lanes }, { data: ent }, { data: shifts }] = await Promise.all([
    ctx.supabase.from('lanes').select('id, code, name, status, invoice_seq, registered_at, last_seen_at').eq('shop_id', ctx.shop.id).order('code'),
    ctx.supabase.from('tenant_entitlements').select('max_lanes_per_shop').maybeSingle(),
    ctx.supabase.from('shifts').select('lane_id, opened_at, member:members!shifts_opened_by_fkey(display_name)').eq('shop_id', ctx.shop.id).eq('status', 'open'),
  ]);
  const open = new Map((shifts ?? []).map((s) => [s.lane_id, s]));
  const rows = lanes ?? [];

  return (
    <>
      <PageHeader title="Devices & lanes" subtitle={`${ctx.shop.name} · ${rows.length} of ${ent?.max_lanes_per_shop ?? '—'} lanes on your plan`} />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <Table>
            <thead>
              <tr><TH>Lane</TH><TH>Name</TH><TH>Device</TH><TH>Shift</TH><TH>Bills</TH><TH>Status</TH><TH /></tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const s = open.get(l.id);
                return (
                  <tr key={l.id}>
                    <TD><Badge tone="brand">{l.code}</Badge></TD>
                    <TD className="font-medium">{l.name}</TD>
                    <TD>{l.registered_at ? 'Registered' : 'Not registered'}</TD>
                    <TD>{s ? `Open · ${s.member?.display_name ?? ''}` : '—'}</TD>
                    <TD className="tabular-nums">{l.invoice_seq}</TD>
                    <TD>{l.status === 'active' ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Disabled</Badge>}</TD>
                    <TD>
                      {l.status === 'active' ? (
                        <Link href={`/lane/${l.id}`} className="text-xs font-semibold text-brand-primary hover:underline">Open checkout</Link>
                      ) : null}
                    </TD>
                  </tr>
                );
              })}
              {rows.length === 0 ? <EmptyRow colSpan={7}>No lanes in this shop.</EmptyRow> : null}
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-text-muted">Device registration (lane key) and session reset buttons come with the lane-binding task.</p>
        </div>
        {hasPerm(ctx.member.perms, 'staff.manage') ? <div className="xl:w-[340px]"><LaneForm /></div> : null}
      </div>
    </>
  );
}
