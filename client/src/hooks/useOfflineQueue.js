import { openDB }  from 'idb';
import { useEffect } from 'react';
import api           from '../api/client';

const DB_NAME    = 'health-coach-offline';
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
    notifyQueueChanged();
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
 *
 * Retries are capped. An entry the server keeps rejecting used to be resent
 * every 60 seconds forever — burning battery and data on a request that was
 * never going to succeed, while the member believed the day was logged. After
 * MAX_ATTEMPTS we stop trying and let the UI say so instead. The entry is
 * never discarded: the member's data stays on the device, and the "Try again
 * now" button in PendingSync resets the counter so a real fix (server back up,
 * app updated) can still drain it.
 */
const MAX_ATTEMPTS = 12;

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

  const live = items.filter(i => (i.attempts || 0) < MAX_ATTEMPTS);
  if (!live.length) {
    // Everything left has exhausted its retries. Don't hammer the network.
    notifyQueueChanged();
    return;
  }

  console.log(`🔄 Syncing ${live.length} queued log(s)…`);

  for (const item of live) {
    try {
      await api.post(`/logs/${item.date}`, item.log);
      await db.delete(STORE, item.key);
      console.log(`✅ Synced queued log for ${item.date}`);
    } catch (err) {
      const attempts = (item.attempts || 0) + 1;
      await db.put(STORE, { ...item, attempts, lastError: err.message });
      console.error(
        `❌ Failed to sync log for ${item.date} (attempt ${attempts}/${MAX_ATTEMPTS}):`,
        err.message
      );
      // Stays in the queue either way — the member's entry is never thrown
      // away just because the server is unhappy.
    }
  }

  // Whether anything drained or not, the badge needs to re-read: a successful
  // pass should clear it, and a failed one may have crossed the stuck threshold.
  notifyQueueChanged();
}

/**
 * Reset the attempt counters and try again immediately.
 * Backs the "Try again now" button on a stuck queue.
 */
export async function retryQueueNow() {
  try {
    const db    = await getDB();
    const items = await db.getAll(STORE);
    for (const item of items) {
      if (item.attempts) await db.put(STORE, { ...item, attempts: 0 });
    }
  } catch (err) {
    console.error('retryQueueNow: could not reset attempts:', err);
  }
  await syncOfflineQueue();
}

/**
 * Returns the count of logs currently in the offline queue.
 */
export async function getQueueCount() {
  try {
    const db = await getDB();
    return (await db.count(STORE));
  } catch {
    return 0;
  }
}

/**
 * Queue status for the UI: how many entries are waiting, and whether any has
 * been waiting long enough to be considered stuck.
 *
 * "Stuck" matters because syncOfflineQueue() retries forever. An entry the
 * server keeps rejecting with a 5xx would sit in IndexedDB indefinitely with
 * nobody told — the member believes the day is logged, the coach sees nothing.
 * After STUCK_AFTER_MS we say so plainly instead.
 */
const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

export async function getQueueStatus() {
  try {
    const db    = await getDB();
    const items = await db.getAll(STORE);
    if (!items.length) return { count: 0, stuck: false, oldestDate: null };
    const oldest = items.reduce((a, b) => (a.queuedAt <= b.queuedAt ? a : b));
    // Stuck on either signal: waiting too long, or out of retries. The second
    // catches a poison entry fast — a server rejecting it every minute hits
    // the cap in about twelve minutes rather than taking a day to admit it.
    const tooOld    = Date.now() - oldest.queuedAt > STUCK_AFTER_MS;
    const exhausted = items.some(i => (i.attempts || 0) >= MAX_ATTEMPTS);
    return {
      count:      items.length,
      stuck:      tooOld || exhausted,
      exhausted,
      oldestDate: oldest.date,
    };
  } catch {
    return { count: 0, stuck: false, exhausted: false, oldestDate: null };
  }
}

// ── Change notification ──────────────────────────────────────────────────────
// The queue is written from saveLogWithFallback and drained from
// syncOfflineQueue, neither of which is a React component. Rather than have
// the badge poll IndexedDB on a timer, both call notifyQueueChanged() and the
// badge re-reads once, when something actually happened.
const queueListeners = new Set();

export function onQueueChange(fn) {
  queueListeners.add(fn);
  return () => queueListeners.delete(fn);
}

function notifyQueueChanged() {
  queueListeners.forEach((fn) => { try { fn(); } catch (_) {} });
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
