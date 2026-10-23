import { Check } from 'lucide-react';
import { Logo } from '@laneos/ui';

// Sign-up (Figma 1-90): narrow brand panel with the trial promise, wide form for shop details and plans.
export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="hidden w-[310px] shrink-0 flex-col gap-6 bg-brand-primary p-10 lg:flex">
        <div className="flex items-center gap-3">
          <Logo inverted />
          <span className="text-[19px] font-bold text-white">LaneOS</span>
        </div>
        <p className="text-[26px] leading-tight font-bold text-white">Start your 14-day free trial</p>
        <ul className="flex flex-col gap-3 text-[13px] text-brand-soft">
          {['Set up items by CSV in minutes', 'Weighed items & scale labels', 'Credit notes, returns & damaged goods', 'Add shops when you grow'].map((t) => (
            <li key={t} className="flex items-center gap-2.5"><Check size={15} aria-hidden />{t}</li>
          ))}
        </ul>
      </aside>
      <main className="flex flex-1 justify-center px-6 py-10 sm:px-12">
        <div className="flex w-full max-w-[640px] flex-col gap-4">{children}</div>
      </main>
    </div>
  );
}
