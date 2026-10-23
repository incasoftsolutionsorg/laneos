import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyRow, PageHeader, Select, Table, TD, TH, buttonClass, chipClass } from '@laneos/ui';
import { ChainUpgrade } from '@/components/backoffice/ChainUpgrade';
import { requireChain } from '@/lib/chain';
import { fmtDateTime } from '@/lib/server/dates';

export const metadata: Metadata = { title: 'Activity logs' };

// Groups of audit actions (prefix before the dot).
const GROUPS = [
  ['', 'Everything'], ['settings', 'Settings'], ['member', 'Staff'], ['security', 'Security'], ['session', 'Sessions'], ['price', 'Prices'],
  ['transfer', 'Transfers'], ['shop', 'Shops'], ['return', 'Returns'], ['credit_note', 'Credit notes'], ['wholesale', 'Wholesale'],
  ['customer', 'Customers'], ['export', 'Exports'], ['plan', 'Plan'],
] as const;

const PAGE = 100;

// Activity logs (Figma 3-2111, not read — built from blueprint E.2; compare when Figma access returns). Owner only (audit_log RLS).
export default async function ActivityLogsPage({ searchParams }: { searchParams: Promise<{ g?: string; who?: string; before?: string }> }) {
  const { g = '', who = '', before } = await searchParams;
  const { ctx, enabled } = await requireChain('settings.manage');
  if (!enabled) return <ChainUpgrade title="Activity logs" />;
  let q = ctx.supabase.from('audit_log').select('id, action, entity, entity_id, data, actor_id, created_at').order('created_at', { ascending: false }).limit(PAGE);
  if (g) q = q.like('action', `${g}.%`);
  if (who) q = q.eq('actor_id', who);
  if (before) q = q.lt('created_at', before);
  const [{ data }, { data: people }] = await Promise.all([q, ctx.supabase.from('members').select('user_id, display_name').not('user_id', 'is', null)]);
  const name = new Map((people ?? []).map((p) => [p.user_id!, p.display_name]));
  const rows = data ?? [];
  const link = (extra: Record<string, string>) => `/backoffice/activity-logs?${new URLSearchParams({ ...(g ? { g } : {}), ...(who ? { who } : {}), ...extra })}`;

  return (
    <>
      <PageHeader title="Activity logs" subtitle="Who changed what, across every shop. Kept for audit; nobody can edit it." />
      <div className="flex flex-wrap items-center gap-2">
        {GROUPS.map(([k, t]) => <Link key={k} href={`/backoffice/activity-logs?${new URLSearchParams({ ...(k ? { g: k } : {}), ...(who ? { who } : {}) })}`} className={chipClass(k === g)}>{t}</Link>)}
      </div>
      <form className="flex items-center gap-2">
        {g ? <input type="hidden" name="g" value={g} /> : null}
        <div className="w-64"><Select name="who" defaultValue={who} aria-label="Person">
          <option value="">Everyone</option>
          {(people ?? []).map((p) => <option key={p.user_id} value={p.user_id!}>{p.display_name}</option>)}
        </Select></div>
        <button type="submit" className={chipClass(false)}>Filter</button>
      </form>
      <Table>
        <thead><tr><TH>When</TH><TH>Who</TH><TH>What</TH><TH>Details</TH></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <TD className="whitespace-nowrap">{fmtDateTime(r.created_at)}</TD>
              <TD>{r.actor_id ? name.get(r.actor_id) ?? 'LaneOS support' : 'System'}</TD>
              <TD className="font-mono text-xs">{r.action}</TD>
              <TD className="max-w-[480px] truncate text-xs text-text-muted" title={JSON.stringify(r.data)}>
                {Object.entries((r.data ?? {}) as Record<string, unknown>).filter(([, v]) => v != null && typeof v !== 'object').slice(0, 4).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') || r.entity}
              </TD>
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={4}>No activity matches.</EmptyRow> : null}
        </tbody>
      </Table>
      {rows.length === PAGE ? <Link href={link({ before: rows.at(-1)!.created_at })} className={buttonClass('secondary', 'w-fit')}>Older</Link> : null}
    </>
  );
}
