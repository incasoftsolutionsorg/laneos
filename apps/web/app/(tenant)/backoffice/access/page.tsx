import type { Metadata } from 'next';
import Link from 'next/link';
import { hasPerm } from '@laneos/core';
import { PageHeader, buttonClass } from '@laneos/ui';
import { AccessMatrix, ResetShopButton } from '@/components/backoffice/AccessMatrix';
import { ChainUpgrade } from '@/components/backoffice/ChainUpgrade';
import { requireChain } from '@/lib/chain';
import { ROLE_TONE } from '@/lib/staff';

export const metadata: Metadata = { title: 'Users & access' };

// Chain users and access (Figma 3-2328, not read — built from blueprint E.2 / §27.5; compare when Figma access returns).
export default async function AccessPage() {
  const { ctx, enabled } = await requireChain('staff.manage');
  if (!enabled) return <ChainUpgrade title="Users & access" />;
  const [{ data: members }, { data: shops }] = await Promise.all([
    ctx.supabase.from('members').select('id, display_name, all_shops, role:roles(key, name), member_shops(shop_id)').eq('is_active', true).order('display_name'),
    ctx.supabase.from('shops').select('id, code, name').eq('is_active', true).order('code'),
  ]);
  const canOwner = hasPerm(ctx.member.perms, 'settings.manage');
  return (
    <>
      <PageHeader title="Users & access" subtitle="Who works in which shop. A change signs that person out so it applies at once."
        actions={<Link href="/backoffice/staff" className={buttonClass('secondary')}>Add or edit people</Link>} />
      <AccessMatrix
        canOwner={canOwner}
        shops={shops ?? []}
        rows={(members ?? []).map((m) => ({
          id: m.id, name: m.display_name, role: m.role?.name ?? '', roleTone: ROLE_TONE[m.role?.key ?? ''] ?? 'neutral',
          owner: m.role?.key === 'owner', all: m.all_shops, shopIds: m.member_shops.map((x) => x.shop_id),
        }))}
      />
      {canOwner ? (
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs text-text-muted">Reset one shop&apos;s access (lost device, staff change):</span>
          {(shops ?? []).map((s) => <ResetShopButton key={s.id} shop={s} />)}
        </div>
      ) : null}
    </>
  );
}
