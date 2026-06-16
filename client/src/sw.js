import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

// Precache all Vite-built assets
precacheAndRoute(self.__WB_MANIFEST);

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
