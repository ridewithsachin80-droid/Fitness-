import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

// Precache all Vite-built assets
precacheAndRoute(self.__WB_MANIFEST);

// ── Activation ───────────────────────────────────────────────────────────────
// registerType:'autoUpdate' in vite.config.js relies on this — for the
// injectManifest strategy (a custom sw.js, as opposed to the auto-generated
// default), Workbox does NOT add skip-waiting/claim behavior automatically.
// Without this, a newly deployed service worker sits in "waiting" forever on
// any device that never fully closes and reopens the PWA, so that device
// keeps running an old SW indefinitely — including whatever push-notification
// code (or bugs) existed in it at the time, regardless of how many times the
// app has been redeployed since.
self.skipWaiting();
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
// Also respond to an explicit skip-waiting message, in case any future
// update strategy switches back to prompt-based updates.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// API routes: network first
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/logs'),
  new NetworkFirst({ cacheName: 'api-logs-cache', networkTimeoutSeconds: 10 })
);
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({ cacheName: 'api-cache', networkTimeoutSeconds: 5 })
);

// ── Push notification handler ─────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { return; }

  const { title, body, icon, badge, tag, data, requireInteraction } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:    icon  || '/icons/icon-192.png',
      badge:   badge || '/icons/icon-192.png',
      tag:     tag   || 'reminder',
      data:    data  || {},
      requireInteraction: !!requireInteraction,
      vibrate: [200, 100, 200, 100, 200],
      actions: data?.requiresAck
        ? [{ action: 'ack', title: '✅ OK, Done!' }]
        : [{ action: 'open', title: 'Open App' }],
    })
  );
});

// ── Notification click handler ────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data  = event.notification.data || {};
  const ackId = data.ackId;

  if (event.action === 'ack' && ackId) {
    event.waitUntil(
      fetch('/api/reminders/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ack_id: ackId }),
      }).catch(() => clients.openWindow('/'))
    );
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      for (const w of wins) {
        if (w.url.includes(self.location.origin) && 'focus' in w) {
          w.postMessage({ type: 'REMINDER', data });
          return w.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});
