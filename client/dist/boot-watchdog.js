/* Boot watchdog. Loaded as a FILE from index.html, never inline.
 *
 * The production security policy (helmet, script-src 'self') blocks inline
 * scripts and onclick="" attributes. When this lived inline in index.html it
 * was refused on the live site ("Refused to execute inline script", login:48),
 * so the recovery screen could never appear and its button did nothing.
 *
 * A PWA can white-screen for reasons the app code never gets to handle: a
 * stale service worker serving an index.html whose hashed chunks were purged
 * by a new deploy, a refresh landing mid-rollout, or a script crash before
 * React mounts. If React has not marked itself booted within 10 s, this shows
 * a recovery screen whose button wipes service workers and caches and reloads
 * clean. window.__fitlifeBooted is set by main.jsx after mount.
 *
 * Plain ES5-style JavaScript on purpose: it must run on the oldest phone that
 * can open the app, before anything else has loaded.
 */
window.__fitlifeRecover = async function () {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(function (r) { return r.unregister(); }));
    }
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }
  } catch (e) { /* best effort, reload regardless */ }
  location.reload();
};
document.addEventListener('DOMContentLoaded', function () {
  var btn = document.getElementById('boot-reload');
  // Looked up at click time, so a test (or a later fix) can replace it.
  if (btn) btn.addEventListener('click', function () { window.__fitlifeRecover(); });
});
setTimeout(function () {
  if (!window.__fitlifeBooted) {
    var el = document.getElementById('boot-fallback');
    if (el) el.style.display = 'block';
  }
}, 10000);
