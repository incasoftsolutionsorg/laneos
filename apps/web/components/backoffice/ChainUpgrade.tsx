import Link from 'next/link';
import { Card, PageHeader, buttonClass } from '@laneos/ui';

/** Shown on head-office pages when the plan has one shop. */
export function ChainUpgrade({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card className="flex max-w-xl flex-col gap-3 p-6">
        <p className="text-[15px] font-semibold">Head office is for businesses with more than one shop</p>
        <p className="text-[13px] text-text-muted">Your plan has one shop. Multi-store (up to 5 shops, transfers) and Chain add shops, central pricing and cross-shop reports.</p>
        <Link href="/backoffice/billing" className={buttonClass('primary', 'w-fit')}>See plans</Link>
      </Card>
    </>
  );
}
