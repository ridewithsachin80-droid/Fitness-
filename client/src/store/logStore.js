import { create } from 'zustand';
import { useAuthStore } from './authStore';
import { emptyLog, today } from '../constants';
import api from '../api/client';
import { saveLogWithFallback, getQueuedLog } from '../hooks/useOfflineQueue';
import { mapServerLog, mapQueuedLog, mapToServer, resolveSave } from '../utils/logSync';

// Counts saves, so an answer can tell whether a newer save has started since.
let saveSeq = 0;
let loadSeq = 0;
const saveFlights = new Map();
const sessionNow = () => {
  const { user, sessionVersion } = useAuthStore.getState();
  return { owner: user?.id ?? null, version: sessionVersion };
};
const sessionMatches = (session) => {
  const current = sessionNow();
  return session.owner === current.owner && session.version === current.version;
};

export const useLogStore = create((set, get) => ({
  date:     today(),
  log:      emptyLog(),
  protocol: null,   // Sprint 1+2 shape: { activities, acv, supplements, custom_*, item_overrides, fasting, macros }
  loading:  false,
  saving:   false,
  saved:    false,
  // true when the last save went to the offline queue rather than the server
  queued:   false,
  error:    null,

  // true from the member's first edit until that edit is safely saved (or
  // queued). A background refresh never replaces a day that is dirty.
  dirty:    false,
  // true while the screen is meant to be showing TODAY (as opposed to a past
  // day the member chose to look at). Lets the app move on at midnight.
  followsToday: true,

  /** Switch to a different date and load its log from the API */
  setDate: async (date) => {
    const session = sessionNow();
    const request = ++loadSeq;
    set({ date, loading: true, saved: false, queued: false, error: null, dirty: false, followsToday: date === today() });
    const stillCurrent = () => sessionMatches(session) && request === loadSeq && get().date === date;
    const showQueued = async () => {
      const queued = await getQueuedLog(date, session.owner).catch(() => null);
      if (!queued || !stillCurrent()) return false;
      if (!get().dirty) set({ log: mapQueuedLog(queued), loading: false, saved: true, queued: true });
      else set({ loading: false });
      return true;
    };
    try {
      if (await showQueued()) return;
      if (!stillCurrent()) return;
      const { data } = await api.get(`/logs/${date}`);
      if (!stillCurrent()) return;
      if (await showQueued()) return;
      if (!stillCurrent()) return;
      if (get().dirty) { set({ loading: false }); return; }
      set({
        log: data ? mapServerLog(data) : emptyLog(),
        protocol: data?.protocol ?? null,
        loading: false,
      });
    } catch (err) {
      if (!stillCurrent()) return;
      if (await showQueued()) return;
      if (!stillCurrent()) return;
      console.error('Failed to load log for', date, err);
      set({ ...(get().dirty ? {} : { log: emptyLog(), protocol: null }),
        loading: false, error: 'Failed to load log' });
    }
  },

  /** Update a single field in the current log (marks unsaved) */
  updateLog: (field, value) =>
    set((s) => ({
      log: { ...s.log, [field]: value },
      saved: false,
      queued: false,
      dirty: true,
    })),

  /** Save the current log — uses offline queue when no connection */
  saveLog: () => {
    const { date, log, protocol } = get();
    const snapshotLoad = loadSeq;
    const session = sessionNow();
    const seq = ++saveSeq;
    const key = `${session.owner}:${session.version}:${date}`;
    set({ saving: true, error: null });
    // Preserve save order for this member/day. Otherwise an older timed-out
    // save can overwrite a newer queued edit after that edit was confirmed.
    const job = (saveFlights.get(key) || Promise.resolve()).catch(() => {}).then(async (previous) => {
      if (!sessionMatches(session)) return;
      try {
        const payload = mapToServer(log, protocol);
        // Only a save captured in this same visible-day history can descend
        // from the earlier in-flight edit. Another tab or an explicit reload
        // has its own snapshot and must use the normal conflict rules.
        if (previous?.write && previous.snapshotLoad === snapshotLoad) payload.base_client_write = previous.write;
        const result = await saveLogWithFallback(date, payload);
        if (!sessionMatches(session)) return;
        if (snapshotLoad !== loadSeq) {
          if (seq === saveSeq) set({ saving: false });
          return { ...result, snapshotLoad };
        }
        const patch = resolveSave({ now: get(), sentDate: date, sentLog: log, isLatest: seq === saveSeq, result });
        if (patch) set(patch);
        return { ...result, snapshotLoad };
      } catch (err) {
        if (!sessionMatches(session)) return;
        console.error('Failed to save log:', err);
        if (seq === saveSeq && get().date !== date) { set({ saving: false }); return; }
        if (seq === saveSeq) set({ saving: false, error: ['QUEUE_CONFLICT', 'SAVE_UNCERTAIN'].includes(err.code) ? err.message : err.message?.includes('offline storage')
          ? 'Save failed: storage is unavailable on this device. Keep this page open and reconnect to try again.'
          : 'Save failed. Check your connection and try again.' });
      }
    }).finally(() => {
      if (saveFlights.get(key) === job) saveFlights.delete(key);
    });
    saveFlights.set(key, job);
    return job;
  },

  /** Reload the current date's log (after a real-time update, an offline merge,
   *  or the app coming back to the foreground). Never replaces unsaved edits. */
  reload: async () => {
    const session = sessionNow();
    const request = loadSeq;
    const { date } = get();
    try {
      const queued = await getQueuedLog(date, session.owner).catch(() => null);
      if (!sessionMatches(session) || request !== loadSeq) return;
      if (queued) return; // The queued edit is newer than the server snapshot.
      const { data } = await api.get(`/logs/${date}`);
      if (await getQueuedLog(date, session.owner).catch(() => null)) return;
      const s = get();
      if (!sessionMatches(session) || request !== loadSeq || !data || s.date !== date || s.dirty || s.saving) return;
      set({ log: mapServerLog(data), protocol: data.protocol ?? s.protocol, queued: false });
    } catch (_) {}
  },
}));

// A shared device must not render the previous member's in-memory log while
// the next member's first request is loading. Pending responses are guarded
// above; clear the visible snapshot as soon as authentication changes.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id === previous.user?.id && state.sessionVersion === previous.sessionVersion) return;
  saveSeq++;
  loadSeq++;
  useLogStore.setState({ date: today(), log: emptyLog(), protocol: null,
    loading: false, saving: false, saved: false, queued: false, error: null,
    dirty: false, followsToday: true });
});
