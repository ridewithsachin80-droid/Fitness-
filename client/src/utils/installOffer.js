/**
 * utils/installOffer.js — Fixes-3j (independent QA review of 3j, finding 2).
 * Chrome sends its install offer ("beforeinstallprompt") once per page load, often while Today is still loading. It is
 * caught here from the app's first moment (main.jsx) and kept, so the install card can show whenever it mounts,
 * including after the member visits another day and comes back.
 */
let offer = null;
const listeners = new Set();
let started = false;

export function captureInstallOffer(win = typeof window !== 'undefined' ? window : null) {
  if (!win || started) return;
  started = true;
  win.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); offer = e; listeners.forEach(f => f(e)); });
  win.addEventListener('appinstalled', () => { offer = null; listeners.forEach(f => f(null)); });
}
export const getInstallOffer = () => offer;
export const clearInstallOffer = () => { offer = null; };
/** Called with the offer when it arrives (or null once installed); returns an unsubscribe function. */
export function onInstallOffer(f) { listeners.add(f); return () => listeners.delete(f); }
