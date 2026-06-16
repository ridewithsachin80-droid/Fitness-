/**
 * useHealthConnect.js
 *
 * React hook that wraps the Android Web Health Connect API.
 * Reads steps, heart rate, sleep, SpO₂, HRV, and calories from
 * Health Connect (which Samsung, Garmin, Fitbit, etc. all write into),
 * then POSTs the data to our backend.
 *
 * Docs: https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started
 *
 * Flow:
 *   1. Check availability  (Android 14+ / Chrome on Android)
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

  /* Check whether the Web Health Connect API exists in this browser */
  const isAvailable = useCallback(() => {
    return typeof window !== 'undefined' && !!window.HealthConnect;
  }, []);

  const sync = useCallback(async () => {
    setStatus('checking');
    setError(null);

    /* ── 1. Availability ─────────────────────────────────── */
    if (!isAvailable()) {
      setStatus('unavailable');
      setError('Android Health Connect is not available in this browser. Use Chrome on Android 14+.');
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
