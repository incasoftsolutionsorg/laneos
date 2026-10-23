import Link from 'next/link';
import { tabClass, tabsClass } from '@laneos/ui';

const TABS = [
  ['/backoffice/purchasing/orders', 'Purchase orders'],
  ['/backoffice/purchasing/grn', 'Goods received'],
  ['/backoffice/purchasing/payments', 'Supplier payments'],
] as const;

export function PurchasingTabs({ active }: { active: (typeof TABS)[number][0] }) {
  return (
    <nav className={tabsClass()} aria-label="Purchasing">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} className={tabClass(href === active)} aria-current={href === active ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
