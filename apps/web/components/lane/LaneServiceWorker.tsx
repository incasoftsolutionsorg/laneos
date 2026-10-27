'use client';

import { useEffect } from 'react';

/** Registers the lane's offline service worker (public/lane-sw.js, scope /lane/). Production builds only:
 *  in `next dev` the page changes on every edit and a cached copy would get in the way. */
export function LaneServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/lane-sw.js', { scope: '/lane/' }).catch(() => { /* not fatal: online selling still works */ });
  }, []);
  return null;
}

/** Tells the service worker to drop its cached lane pages (sign-out, device unregistered). */
export function clearLaneCache() {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.getRegistration('/lane/').then((r) => r?.active?.postMessage('laneos:clear'));
}
