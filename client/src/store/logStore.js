import { create } from 'zustand';
import { emptyLog, today } from '../constants';
import api from '../api/client';
import { saveLogWithFallback } from '../hooks/useOfflineQueue';

export const useLogStore = create((set, get) => ({
  date:     today(),
  log:      emptyLog(),
  protocol: null,   // { activities: [...ids] | null, acv: [...ids] | null, supplements: [...ids] | null }
  loading:  false,
  saving:   false,
  saved:    false,
  error:    null,

  /** Switch to a different date and load its log from the API */
  setDate: async (date) => {
    set({ date, loading: true, saved: false, error: null });
    try {
      const { data } = await api.get(`/logs/${date}`);
      set({
        log:      data ? mapServerLog(data) : emptyLog(),
        protocol: data?.protocol ?? null,
        loading:  false,
      });
    } catch (err) {
      console.error('Failed to load log for', date, err);
      set({ log: emptyLog(), protocol: null, loading: false, error: 'Failed to load log' });
    }
  },

  /** Update a single field in the current log (marks unsaved) */
  updateLog: (field, value) =>
    set((s) => ({
      log: { ...s.log, [field]: value },
      saved: false,
    })),

  /** Save the current log — uses offline queue when no connection */
  saveLog: async () => {
    const { date, log } = get();
    set({ saving: true, error: null });
    try {
      const payload = mapToServer(log);
      const result  = await saveLogWithFallback(date, payload);
      if (result.queued) {
        // Saved offline — optimistically mark as saved, show queued indicator
        set({ saving: false, saved: true });
      } else {
        set({ saving: false, saved: true, log: mapServerLog(result.data) });
      }
    } catch (err) {
      console.error('Failed to save log:', err);
      set({ saving: false, error: 'Save failed. Check your connection and try again.' });
    }
  },

  /** Reload the current date's log (called after real-time update) */
  reload: async () => {
    const { date } = get();
    try {
      const { data } = await api.get(`/logs/${date}`);
      if (data) set({ log: mapServerLog(data) });
    } catch (_) {}
  },
}));

// ── Field mapping helpers ────────────────────────────────────────────────────

/** Map server response fields → client log shape */
function mapServerLog(row) {
  return {
    weight:      row.weight_kg ? String(row.weight_kg) : '',
    activities:  row.activities  ?? {},
    acv:         row.acv         ?? {},
    food:        row.food_items  ?? [],
    water:       row.water_ml    ?? 0,
    supplements: row.supplements ?? {},
    sleep:       row.sleep       ?? { bedtime: '', waketime: '', quality: 0 },
    notes:       row.notes       ?? '',
    savedAt:     row.saved_at    ?? null,
  };
}

/** Map client log shape → server request body */
function mapToServer(log) {
  return {
    weight_kg:   log.weight ? parseFloat(log.weight) : null,
    activities:  log.activities,
    acv:         log.acv,
    food_items:  log.food,
    water_ml:    log.water,
    supplements: log.supplements,
    sleep:       log.sleep,
    notes:       log.notes,
  };
}
