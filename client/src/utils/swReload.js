/**
 * Reload when a NEW version of the app takes over — never on the first install
 * (17 Oct 2026). The offline helper claims the page on a member's very first
 * visit too, and the old rule reloaded then: a few seconds after opening the
 * site, the page reloaded and wiped a half-typed phone number, PIN or an open
 * panel. Only a version replacing another version needs the reload.
 */
export function watchForNewVersion(container = typeof navigator !== 'undefined' ? navigator.serviceWorker : null,
  reload = () => window.location.reload()) {
  if (!container) return;
  let inControl = !!container.controller;
  let reloading = false;
  container.addEventListener('controllerchange', () => {
    if (!inControl) { inControl = true; return; } // first install: nothing old to replace
    if (reloading) return;
    reloading = true;
    reload();
  });
}
