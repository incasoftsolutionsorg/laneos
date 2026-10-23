import { hasPerm } from '@laneos/core';
import { REPORT_TABS, loadReport, readRange, reportTable, toCsv, type ReportKey } from '@/lib/reports';
import { getContext } from '@/lib/server/context';

// CSV export of a report tab (Figma 1-4536 "Export CSV"). Owner-only when Settings → Security says so.
export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const ctx = await getContext();
  if (!ctx.member || !ctx.shop || !hasPerm(ctx.member.perms, 'reports.view')) return new Response('Forbidden', { status: 403 });
  if (!(report in REPORT_TABS)) return new Response('Not found', { status: 404 });
  const { data: t } = await ctx.supabase.from('tenants').select('export_owner_only').eq('id', ctx.tenant.id).single();
  if (t?.export_owner_only && !hasPerm(ctx.member.perms, 'settings.manage')) return new Response('Only owners can export data', { status: 403 });
  const url = new URL(req.url);
  const { from, to } = readRange(url.searchParams.get('from') ?? undefined, url.searchParams.get('to') ?? undefined);
  const key = report as ReportKey;
  const csv = toCsv(reportTable(key, await loadReport({ ...ctx, shop: ctx.shop }, key, from, to)));
  await ctx.supabase.schema('api').rpc('audit_export', { p_what: `report.${key}`, p_from: from, p_to: to }).then(() => undefined, () => undefined);
  return new Response(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="laneos-${key}-${ctx.shop.code}-${from}-to-${to}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
