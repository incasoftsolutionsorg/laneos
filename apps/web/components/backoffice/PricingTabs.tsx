import Link from 'next/link';
import { tabClass, tabsClass } from '@laneos/ui';

const TABS = [['lists', 'Prices by shop'], ['overrides', 'Shop overrides'], ['schedules', 'Scheduled changes']] as const;

export function PricingTabs({ active }: { active: (typeof TABS)[number][0] }) {
  return (
    <nav className={tabsClass()} aria-label="Central pricing">
      {TABS.map(([k, t]) => <Link key={k} href={`/backoffice/pricing/${k}`} className={tabClass(k === active)} aria-current={k === active ? 'page' : undefined}>{t}</Link>)}
    </nav>
  );
}
