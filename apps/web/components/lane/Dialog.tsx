'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** Modal dialog (radius 16 per Appendix E.6). Esc and the close button call onClose. */
export function Dialog({
  title, onClose, children, width = 420,
}: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, button[type="submit"]')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="flex w-full flex-col gap-4 rounded-dialog bg-surface p-6 shadow-xl" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-text-muted hover:text-text" aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
