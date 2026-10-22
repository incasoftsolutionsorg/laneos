import { Logo } from '@laneos/ui';

// Two-panel layout from Figma 1-34: brand panel on the left, form on the right.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="hidden flex-1 flex-col justify-between bg-brand-primary p-16 lg:flex">
        <div className="flex items-center gap-3">
          <Logo inverted />
          <span className="text-[22px] font-bold text-white">LaneOS</span>
        </div>
        <div className="flex flex-col gap-3.5">
          <p className="text-[46px] leading-tight font-bold text-white">Sell faster.<br />Count smarter.</p>
          <p className="max-w-[480px] text-base text-brand-soft">
            Cloud POS for grocery shops, supermarkets and franchise chains. Works offline and prints instantly.
          </p>
        </div>
        <div className="flex gap-3">
          {[
            ['3,000+', 'items per shop'],
            ['< 50 ms', 'per scan'],
            ['Offline', 'lanes keep selling'],
          ].map(([value, label]) => (
            <div key={label} className="flex flex-col gap-1 rounded-card bg-brand-dark p-4">
              <span className="text-xl font-bold text-white">{value}</span>
              <span className="text-xs text-brand-soft">{label}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-[#9fd5c7]">© 2026 LaneOS · Incasoft Solutions</p>
      </aside>
      <main className="flex w-full flex-col justify-center px-6 py-12 sm:px-24 lg:w-[620px]">
        <div className="mx-auto flex w-full max-w-[428px] flex-col gap-4">{children}</div>
      </main>
    </div>
  );
}
