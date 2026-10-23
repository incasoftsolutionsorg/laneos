'use client';

import { useEffect, useRef } from 'react';

/** Signs the back office out after the tenant's idle timeout (Settings → Security, blueprint §27.5.2). */
export function IdleSignout({ minutes }: { minutes: number }) {
  const last = useRef(Date.now());
  useEffect(() => {
    const touch = () => { last.current = Date.now(); };
    const events = ['keydown', 'pointerdown', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - last.current < minutes * 60_000) return;
      clearInterval(t);
      const form = document.createElement('form');
      form.method = 'post';
      form.action = '/auth/signout';
      document.body.appendChild(form);
      form.submit();
    }, 30_000);
    return () => { events.forEach((e) => window.removeEventListener(e, touch)); clearInterval(t); };
  }, [minutes]);
  return null;
}
