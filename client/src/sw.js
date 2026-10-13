import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { clientsClaim } from 'workbox-core';
import { PRIVATE_API_CACHE, LEGACY_API_CACHES, CLEAR_PRIVATE_API_CACHES, clearPrivateApiCaches, privateCacheKey, isPrivateApiRequest } from './utils/privateApiCache';

let privateCacheEpoch = 0;

// Precache all Vite-built assets (injected by vite-plugin-pwa)
precacheAndRoute(self.__WB_MANIFEST);

// Delete precaches from previous versions — without this, old hashed bundles
// linger and can be served after an update.
cleanupOutdatedCaches();

// ── Update handling ──────────────────────────────────────────────────────────
// With injectManifest we must wire this ourselves; vite-plugin-pwa only does it
// automatically for generateSW. Without the SKIP_WAITING listener the new worker
// stays stuck in "waiting" forever, so updateSW(true) reloads the page while the
// OLD worker is still in control — the user reloads and still sees the old app.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === CLEAR_PRIVATE_API_CACHES) {
    privateCacheEpoch++;
    event.waitUntil(clearPrivateApiCaches().finally(() => event.ports?.[0]?.postMessage({ cleared: true })));
  }
});

// Take control of already-open pages as soon as this worker activates,
// instead of waiting for every tab to close first.
clientsClaim();

// Keep offline reads, partitioned by the authenticated session. Authentication
// endpoints and requests without an access token are never runtime-cached.
registerRoute(
  context => context.url.origin === self.location.origin && isPrivateApiRequest(context),
  new NetworkFirst({ cacheName: PRIVATE_API_CACHE, networkTimeoutSeconds: 10,
    plugins: [{ cacheKeyWillBeUsed: privateCacheKey,
      handlerWillStart: ({ state }) => { state.epoch = privateCacheEpoch; },
      cacheWillUpdate: async ({ response, state }) => response.status === 200 && state.epoch === privateCacheEpoch ? response : null,
      // Also cover a logout occurring between cacheWillUpdate and cache.put.
      cacheDidUpdate: async ({ cacheName, request, state }) => {
        if (state.epoch !== privateCacheEpoch) await (await caches.open(cacheName)).delete(request);
      } }],
  })
);
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all(LEGACY_API_CACHES.map(name => caches.delete(name))));
});

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
        ? [{ action: 'ack', title: '\u2705 OK, Done!' }]
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
