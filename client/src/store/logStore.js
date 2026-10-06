import { create } from 'zustand';
import { emptyLog, today } from '../constants';
import api from '../api/client';
import { saveLogWithFallback } from '../hooks/useOfflineQueue';
import { mapServerLog, mapToServer, resolveSave } from '../utils/logSync';

// Counts saves, so an answer can tell whether a newer save has started since.
let saveSeq = 0;

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
    set({ date, loading: true, saved: false, queued: false, error: null, dirty: false, followsToday: date === today() });
    try {
      const { data } = await api.get(`/logs/${date}`);
      if (get().date !== date) return;            // the member has already moved on again
      set({
        log:      data ? mapServerLog(data) : emptyLog(),
        protocol: data?.protocol ?? null,
        loading:  false,
      });
    } catch (err) {
      console.error('Failed to load log for', date, err);
      if (get().date !== date) return;
      set({ log: emptyLog(), protocol: null, loading: false, error: 'Failed to load log' });
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
  saveLog: async () => {
    const { date, log, protocol } = get();
    const seq = ++saveSeq;
    set({ saving: true, error: null });
    try {
      const payload = mapToServer(log, protocol);
      const result  = await saveLogWithFallback(date, payload);
      // What happens next depends on what the member did while the save was in
      // flight — see resolveSave in utils/logSync.js. In short: the server's
      // copy replaces the screen only if nothing here has changed since.
      const patch = resolveSave({ now: get(), sentDate: date, sentLog: log, isLatest: seq === saveSeq, result });
      if (patch) set(patch);
    } catch (err) {
      console.error('Failed to save log:', err);
      if (seq === saveSeq) set({ saving: false, error: 'Save failed. Check your connection and try again.' });
    }
  },

  /** Reload the current date's log (after a real-time update, an offline merge,
   *  or the app coming back to the foreground). Never replaces unsaved edits. */
  reload: async () => {
    const { date } = get();
    try {
      const { data } = await api.get(`/logs/${date}`);
      const s = get();
      if (!data || s.date !== date || s.dirty || s.saving) return;
      set({ log: mapServerLog(data), protocol: data.protocol ?? s.protocol });
    } catch (_) {}
  },
}));
