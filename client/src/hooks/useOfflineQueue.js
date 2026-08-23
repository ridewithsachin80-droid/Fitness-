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
/**
 * Is this failure worth retrying?
 *
 * A network error, timeout or 5xx will very likely succeed later, so queue it.
 * A 4xx will not — a rejected payload stays rejected however many times we
 * resend it, and queueing it would retry forever and hide a real bug from the
 * member. Auth failures are also excluded: the member needs to log in again,
 * not have their entry silently parked.
 */
function isRetryable(err) {
  if (!err.response) return true;                 // no response at all = network
  const s = err.response.status;
  if (s === 401 || s === 403) return false;       // needs re-login, not a retry
  return s >= 500 || s === 408 || s === 429;
}

export async function saveLogWithFallback(date, log) {
  // Try the request FIRST rather than trusting navigator.onLine.
  //
  // navigator.onLine only reports whether a network interface is up. It says
  // true on hotel WiFi before the captive portal, on one bar of mobile data
  // with nothing getting through, and while the server is down — and in every
  // one of those the POST used to throw and the log was simply lost, because
  // the queue was in the else branch that never ran.
  //
  // A gym basement with one bar is exactly that case, which is the situation
  // this queue exists for.
  if (navigator.onLine) {
    try {
      const { data } = await api.post(`/logs/${date}`, log);
      return { queued: false, data };
    } catch (err) {
      if (!isRetryable(err)) throw err;           // a real error the member must see
      console.warn(`Network failed despite onLine — queueing ${date}:`, err.message);
    }
  }

  // Offline, or the request failed in a way worth retrying
  try {
    const db = await getDB();
    await db.put(STORE, { key: `log:${date}`, date, log, queuedAt: Date.now() });
    console.log(`📦 Queued log for ${date}`);
    return { queued: true };
  } catch (dbErr) {
    // IndexedDB unavailable — private browsing, storage full. Failing loudly
    // is right here: silently dropping the entry would be worse.
    console.error('Could not queue the log:', dbErr);
    throw new Error('Could not save — no connection and offline storage is unavailable.');
  }
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

    // The 'online' event only fires when the interface changes state. A flaky
    // connection that starts working again never fires it, so poll as well.
    const timer = setInterval(() => {
      if (navigator.onLine) syncOfflineQueue().catch(() => {});
    }, 60000);

    // Also attempt a sync on mount in case we're already online
    // with items left from a previous offline session
    if (navigator.onLine) {
      syncOfflineQueue();
    }

    return () => {
      clearInterval(timer);              // without this the poll leaks on unmount
      window.removeEventListener('online', handleOnline);
    };
  }, []);
}
