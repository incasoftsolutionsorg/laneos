import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Card, EmptyState, Logo, buttonClass } from '@laneos/ui';

// 404 for every route (Figma 11-4920 "not found" state).
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6">
      <Logo />
      <Card className="w-full max-w-lg">
        <EmptyState icon={<SearchX size={26} aria-hidden />} title="We could not find that page"
          action={<><Link href="/backoffice" className={buttonClass('primary')}>Back office</Link><Link href="/lane" className={buttonClass('secondary')}>Checkout</Link></>}>
          The link may be old, or the item, bill or shop may belong to another business or a shop you cannot open.
        </EmptyState>
      </Card>
    </div>
  );
}
