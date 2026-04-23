import { openDB }  from 'idb';
import { useEffect } from 'react';
import api           from '../api/client';

const DB_NAME    = 'health-monitor-offline';
const DB_VERSION = 1;
const STORE      = 'log-queue';

// ── IndexedDB helpers ────────────────────────────────────────────────────────

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    },
  });
}

/**
 * Save a log. If online, POST directly to API.
 * If offline, persist to IndexedDB queue and return immediately.
 *
 * @param {string} date  - YYYY-MM-DD
 * @param {object} log   - log payload (server shape)
 * @returns {Promise<{queued: boolean, data?: object}>}
 */
export async function saveLogWithFallback(date, log) {
  if (navigator.onLine) {
    const { data } = await api.post(`/logs/${date}`, log);
    return { queued: false, data };
  }

  // Offline — queue in IndexedDB
  const db = await getDB();
  await db.put(STORE, { key: `log:${date}`, date, log, queuedAt: Date.now() });
  console.log(`📦 Queued offline log for ${date}`);
  return { queued: true };
}

/**
 * Sync all queued offline logs to the server.
 * Call this when the browser comes back online.
 * Removes successfully synced items from the queue.
 */
export async function syncOfflineQueue() {
  let db;
  try {
    db = await getDB();
  } catch (err) {
    console.error('syncOfflineQueue: failed to open DB:', err);
    return;
  }

  const items = await db.getAll(STORE);
  if (!items.length) return;

  console.log(`🔄 Syncing ${items.length} queued log(s)…`);

  for (const item of items) {
    try {
      await api.post(`/logs/${item.date}`, item.log);
      await db.delete(STORE, item.key);
      console.log(`✅ Synced queued log for ${item.date}`);
    } catch (err) {
      console.error(`❌ Failed to sync log for ${item.date}:`, err.message);
      // Leave in queue — will retry next time
    }
  }
}

/**
 * Returns the count of logs currently in the offline queue.
 * Useful for showing a "X logs pending sync" badge.
 */
export async function getQueueCount() {
  try {
    const db = await getDB();
    return (await db.count(STORE));
  } catch {
    return 0;
  }
}

// ── React hook ───────────────────────────────────────────────────────────────

/**
 * Wire up the online event listener once at the app root level.
 * When the browser comes back online, automatically sync the queue.
 *
 * Usage: call useOfflineSync() once in App.jsx or a top-level layout.
 */
export function useOfflineSync() {
  useEffect(() => {
    const handleOnline = () => {
      console.log('🌐 Back online — syncing offline queue…');
      syncOfflineQueue();
    };

    window.addEventListener('online', handleOnline);

    // Also attempt a sync on mount in case we're already online
    // with items left from a previous offline session
    if (navigator.onLine) {
      syncOfflineQueue();
    }

    return () => window.removeEventListener('online', handleOnline);
  }, []);
}
