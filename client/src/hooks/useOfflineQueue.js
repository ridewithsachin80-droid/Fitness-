import { openDB }  from 'idb';
import { useEffect } from 'react';
import api           from '../api/client';
import { useAuthStore } from '../store/authStore';
import { createQueue } from '../utils/offlineQueueCore';

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

/** The signed-in member. Every queued entry belongs to exactly one. */
const currentOwner = () => useAuthStore.getState().user?.id ?? null;

/**
 * One sync pass across ALL open tabs. Web Locks is the only cross-tab mutex a
 * browser offers; where it is missing, the per-tab single-flight in the core
 * plus the revision check still keep entries from being lost.
 */
function crossTabLock(fn) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  if (!locks?.request) return fn();
  return locks.request('fitlife-offline-sync', { ifAvailable: true },
    (held) => (held ? fn() : { sent: 0, skipped: 'locked' }));
}

// The rules live in utils/offlineQueueCore.js so server/scripts/
// test-offline-queue.js can run the real thing. This file only supplies the
// browser pieces: IndexedDB, the API client, the signed-in member.
const queue = createQueue({
  getDB,
  store:    STORE,
  post:     (date, log) => api.post(`/logs/${date}`, log),
  getOwner: currentOwner,
  onChange: () => notifyQueueChanged(),
  lock:     crossTabLock,
});

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

/**
 * Save a log. If online, POST directly to API.
 * If offline, persist to IndexedDB queue and return immediately.
 *
 * @param {string} date  - YYYY-MM-DD
 * @param {object} log   - log payload (server shape)
 * @returns {Promise<{queued: boolean, data?: object}>}
 */
export async function saveLogWithFallback(date, log) {
  // Who this entry belongs to is decided NOW, when the member makes the edit —
  // not later, when the queue happens to drain.
  const owner = currentOwner();

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
      // This save is newer than anything still queued for the same day.
      await queue.supersede(date, owner);
      return { queued: false, data };
    } catch (err) {
      if (!isRetryable(err)) throw err;           // a real error the member must see
      console.warn(`Network failed despite onLine — queueing ${date}:`, err.message);
    }
  }

  // Offline, or the request failed in a way worth retrying
  try {
    await queue.enqueue(date, log, owner);
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
 * Send the signed-in member's queued logs to the server.
 *
 * Only entries that belong to the current member are sent. Retries are capped
 * (MAX_ATTEMPTS in the core): an entry the server keeps rejecting is left on
 * the device and the UI says so, rather than being resent every minute
 * forever. Entries are never discarded.
 */
export async function syncOfflineQueue() {
  try {
    return await queue.sync();
  } catch (err) {
    console.error('syncOfflineQueue failed:', err);
    notifyQueueChanged();
  }
}

/**
 * Reset the attempt counters and try again immediately.
 * Backs the "Try again now" button on a stuck queue.
 */
export async function retryQueueNow() {
  try {
    return await queue.retryNow();
  } catch (err) {
    console.error('retryQueueNow failed:', err);
  }
}

/** Count of the signed-in member's logs waiting in the queue. */
export async function getQueueCount() {
  return (await getQueueStatus()).count;
}

/**
 * Queue status for the UI, for the signed-in member only: how many entries
 * are waiting, whether any is stuck, and how many ownerless entries from
 * before owner-tagging are waiting to be claimed.
 */
export async function getQueueStatus() {
  try {
    return await queue.status();
  } catch {
    return { count: 0, stuck: false, exhausted: false, oldestDate: null, unclaimed: 0, unclaimedDates: [] };
  }
}

/** "These are mine — send them." For entries queued before owner-tagging. */
export async function claimLegacyEntries() {
  return queue.claimLegacy();
}

/** "Not mine." Stops asking this member; the entries stay for their owner. */
export async function dismissLegacyEntries() {
  return queue.dismissLegacy();
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

// The hook is called from App.jsx AND useTodayModel.js. Two sets of timers and
// listeners meant two sync passes racing over the same entries. The wiring is
// now installed once however many components mount it.
let mounts   = 0;
let teardown = null;

function installSyncWiring() {
  const handleOnline = () => {
    console.log('🌐 Back online — syncing offline queue…');
    syncOfflineQueue();
  };
  window.addEventListener('online', handleOnline);

  // The 'online' event only fires when the interface changes state. A flaky
  // connection that starts working again never fires it, so poll as well.
  const timer = setInterval(() => {
    if (navigator.onLine) syncOfflineQueue();
  }, 60000);

  // A member's entries can only be sent once we know who is signed in. On a
  // cold start that is after the session restore, so sync when it lands — and
  // re-read the badge, since "my queue" depends on who "me" is.
  let lastOwner = currentOwner();
  const unsubscribe = useAuthStore.subscribe((state) => {
    const owner = state.user?.id ?? null;
    if (owner === lastOwner) return;
    lastOwner = owner;
    notifyQueueChanged();
    if (owner != null && navigator.onLine) syncOfflineQueue();
  });

  // Also attempt a sync on mount in case we're already online
  // with items left from a previous offline session
  if (navigator.onLine) syncOfflineQueue();

  return () => {
    clearInterval(timer);              // without this the poll leaks on unmount
    window.removeEventListener('online', handleOnline);
    unsubscribe();
  };
}

/**
 * Wire up the online listener, the poll and the sign-in trigger.
 * Safe to call from more than one component: the wiring exists once.
 */
export function useOfflineSync() {
  useEffect(() => {
    mounts += 1;
    if (mounts === 1) teardown = installSyncWiring();
    return () => {
      mounts -= 1;
      if (mounts === 0 && teardown) { teardown(); teardown = null; }
    };
  }, []);
}
