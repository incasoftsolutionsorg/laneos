'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** Modal dialog (radius 16 per Appendix E.6). Esc and the close button call onClose. `aside` sits
 *  at the right of the title (e.g. the total on the payment dialog). */
export function Dialog({
  title, onClose, children, width = 420, aside,
}: { title: string; onClose: () => void; children: React.ReactNode; width?: number; aside?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('[autofocus], input, button[type="submit"]')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#2b3a4a]/80 p-4 sm:pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="flex w-full flex-col gap-4 rounded-dialog bg-surface p-7 shadow-[0_8px_24px_rgba(15,23,41,0.12)]" style={{ maxWidth: width }}>
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-[22px] font-bold">{title}</h2>
          {aside}
          <button type="button" onClick={onClose} className="rounded p-1 text-text-muted hover:text-text" aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
