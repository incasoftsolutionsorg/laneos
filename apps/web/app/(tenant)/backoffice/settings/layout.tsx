import { PageHeader } from '@laneos/ui';
import { SettingsNav } from '@/components/backoffice/Settings';

// Settings tabs share one header and the left sub-navigation (Figma 1-3701, 1-3902, 1-4145).
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" subtitle="Business details, branding, tax, receipts and security" />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <SettingsNav />
        {children}
      </div>
    </>
  );
}
