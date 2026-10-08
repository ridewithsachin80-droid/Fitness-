/**
 * useHealthConnect.js
 *
 * Reads steps, heart rate, sleep, SpO₂, HRV and calories from Android Health
 * Connect (which Samsung, Garmin, FITTR and others write into) and POSTs them
 * to our backend — WHEN a bridge to Health Connect exists.
 *
 * ── It does not exist today, and this file must not pretend otherwise ────────
 *
 * Health Connect is an Android SDK. There is no web API for it: no browser,
 * Chrome included, defines `window.HealthConnect`, and the Android wrapper in
 * android/ is a Trusted Web Activity, which cannot hand a web page a native
 * object. So `healthConnectSupported()` is false for every member on every
 * phone, and the screen has to say so instead of offering a Sync button.
 *
 * This hook used to answer a tap with "not available in this browser. Use
 * Chrome on Android 14+", which sent members off to change browsers for
 * something no browser can do.
 *
 * The reading code below is kept for the day a native shell injects
 * `window.HealthConnect` with this shape. Until then nothing calls it.
 *
 * Flow, once a bridge exists:
 *   1. Check the bridge is there
 *   2. Request permissions
 *   3. Read records
 *   4. POST to /api/trackers/healthconnect/sync
 */

import { useState, useCallback } from 'react';
import api from '../api/client';

/* Permission data types we want to read */
const READ_PERMISSIONS = [
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'HeartRate' },
  { accessType: 'read', recordType: 'RestingHeartRate' },
  { accessType: 'read', recordType: 'SleepSession' },
  { accessType: 'read', recordType: 'OxygenSaturation' },
  { accessType: 'read', recordType: 'HeartRateVariabilitySdnn' },
  { accessType: 'read', recordType: 'TotalCaloriesBurned' },
  { accessType: 'read', recordType: 'Distance' },
];

/** True only when a native shell has injected the Health Connect bridge. */
export function healthConnectSupported() {
  return typeof window !== 'undefined' && !!window.HealthConnect;
}

/** What the screen says when it is not. One wording, used everywhere. */
export const HEALTH_CONNECT_UNSUPPORTED =
  'FitLife cannot read Android Health Connect yet, so this device cannot sync here.';

/* How far back to look (24 h) */
function timeRange() {
  const end   = new Date();
  const start = new Date(end - 24 * 60 * 60 * 1000);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

export default function useHealthConnect() {
  const [status,   setStatus]   = useState('idle');   // idle|checking|requesting|reading|syncing|done|error|unavailable
  const [error,    setError]    = useState(null);
  const [metrics,  setMetrics]  = useState(null);

  /* Is there a bridge to Health Connect at all? See the note at the top. */
  const isAvailable = useCallback(() => healthConnectSupported(), []);

  const sync = useCallback(async () => {
    setStatus('checking');
    setError(null);

    /* ── 1. Availability ─────────────────────────────────── */
    if (!isAvailable()) {
      setStatus('unavailable');
      setError(HEALTH_CONNECT_UNSUPPORTED);
      return null;
    }

    try {
      /* ── 2. Request permissions ──────────────────────── */
      setStatus('requesting');
      const granted = await window.HealthConnect.requestPermission(READ_PERMISSIONS);
      const grantedTypes = new Set(granted.map(p => p.recordType));

      /* ── 3. Read records ─────────────────────────────── */
      setStatus('reading');
      const range = timeRange();
      const result = {};

      /* Steps */
      if (grantedTypes.has('Steps')) {
        const { records } = await window.HealthConnect.readRecords('Steps', {
          timeRangeFilter: { startTime: range.startTime, endTime: range.endTime },
        });
        result.steps = records.reduce((sum, r) => sum + (r.count || 0), 0);
      }

      /* Heart Rate */
      if (grantedTypes.has('HeartRate')) {
        const { records } = await window.HealthConnect.readRecords('HeartRate', {
          timeRangeFilter: { startTime: range.startTime, endTime: range.endTime },
        });
        const samples = records.flatMap(r =>
          (r.samples || []).map(s => ({ time: s.time, bpm: s.beatsPerMinute }))
        );
        const bpms = samples.map(s => s.bpm).filter(Boolean);
        result.heart_rate = {
          samples,
          avg: bpms.length ? Math.round(bpms.reduce((a,b) => a+b,0) / bpms.length) : null,
          min: bpms.length ? Math.min(...bpms) : null,
          max: bpms.length ? Math.max(...bpms) : null,
        };
      }

      /* Resting Heart Rate */
      if (grantedTypes.has('RestingHeartRate')) {
        const { records } = await window.HealthConnect.readRecords('RestingHeartRate', {
          timeRangeFilter: { startTime: range.startTime, endTime: range.endTime },
        });
        if (records.length) {
          if (!result.heart_rate) result.heart_rate = {};
          result.heart_rate.resting = records[records.length - 1]?.beatsPerMinute;
        }
      }

      /* Sleep */
      if (grantedTypes.has('SleepSession')) {
        const { records } = await window.HealthConnect.readRecords('SleepSession', {
          timeRangeFilter: { startTime: range.startTime, endTime: range.endTime },
        });
        if (records.length) {
          const session = records[0];
          const stageMap = {};
          for (const stage of session.stages || []) {
            const start  = new Date(stage.startTime);
            const end    = new Date(stage.endTime);
            const mins   = (end - start) / 60000;
            const key    = stage.stage?.toLowerCase().replace('sleep_stage_', '') || 'unknown';
            stageMap[key] = (stageMap[key] || 0) + mins;
          }
          const totalMs = new Date(session.endTime) - new Date(session.startTime);
          result.sleep = {
            start:         session.startTime,
            end:           session.endTime,
            total_minutes: Math.round(totalMs / 60000),
            stages:        stageMap,
          };
        }
      }

      /* SpO₂ */
      if (grantedTypes.has('OxygenSaturation')) {
        const { records } = await window.HealthConnect.readRecords('OxygenSaturation', {
          timeRangeFilter: { startTime: range.startTime, endTime: range.endTime },
        });
        if (records.length) {
          const vals = records.map(r => r.percentage).filter(Boolean);
          result.spo2 = {
            avg: vals.length ? +(vals.reduce((a,b) => a+b,0) / vals.length).toFixed(1) : null,
            min: vals.length ? Math.min(...vals) : null,
          };
        }
      }

      /* HRV */
      if (grantedTypes.has('HeartRateVariabilitySdnn')) {
        const { records } = await window.HealthConnect.readRecords('HeartRateVariabilitySdnn', {
          timeRangeFilter: { startTime: range.startTime, endTime: range.endTime },
        });
        if (records.length) {
          result.hrv = { sdnn: records[records.length - 1]?.heartRateVariabilityMillis };
        }
      }

      /* Calories */
      if (grantedTypes.has('TotalCaloriesBurned')) {
        const { records } = await window.HealthConnect.readRecords('TotalCaloriesBurned', {
          timeRangeFilter: { startTime: range.startTime, endTime: range.endTime },
        });
        result.calories = Math.round(
          records.reduce((sum, r) => sum + (r.energy?.inKilocalories || 0), 0)
        );
      }

      /* Distance */
      if (grantedTypes.has('Distance')) {
        const { records } = await window.HealthConnect.readRecords('Distance', {
          timeRangeFilter: { startTime: range.startTime, endTime: range.endTime },
        });
        result.distance_m = Math.round(
          records.reduce((sum, r) => sum + (r.distance?.inMeters || 0), 0)
        );
      }

      /* ── 4. POST to backend ───────────────────────────── */
      setStatus('syncing');
      await api.post('/trackers/healthconnect/sync', result);

      setMetrics(result);
      setStatus('done');
      return result;

    } catch (err) {
      console.error('Health Connect sync error:', err);
      setError(err.message || 'Failed to sync Health Connect data');
      setStatus('error');
      return null;
    }
  }, [isAvailable]);

  return { sync, status, error, metrics, isAvailable };
}
