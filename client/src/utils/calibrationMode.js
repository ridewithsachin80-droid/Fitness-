/**
 * utils/calibrationMode.js — Fixes-2x, voice calibration Part C (TEST SITE ONLY).
 *
 * While an administrator has armed a Part C try for THIS account on the test server:
 *   controlled — the recording is always uploaded (on-device dictation is not used), so the
 *                try reaches the provider leg being tested; the composer shows a label saying so;
 *   natural    — nothing changes, but when on-device dictation is used (no upload) the app
 *                reports that, so it is never mistaken for Gemini or Whisper.
 * The app asks only on the test site (by address) — production never makes this request —
 * and the server answers only for the armed account. Everyone else: no change at all.
 */
import api from '../api/client';

const TEST_HOSTS = /(^|\.)fitness-test\.|^localhost$|^127\.0\.0\.1$/;
const onTestSite = () => typeof window !== 'undefined' && TEST_HOSTS.test(window.location?.hostname || '');
let state = null;          // { trial, route, path, say, force_upload } or null
let checkedAt = 0;
const listeners = new Set();

export async function refreshCalibrationTry() {
  if (!onTestSite()) { state = null; return null; }
  if (Date.now() - checkedAt < 5000) return state;
  checkedAt = Date.now();
  try { const { data } = await api.get('/voice-calibration/partc/me'); state = data?.armed || null; }
  catch { state = null; }
  listeners.forEach(fn => fn(state));
  return state;
}
export const calibrationTry = () => state;
export const calibrationForcesUpload = () => !!state?.force_upload;
export function onCalibrationChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Natural observations: on-device words were used, with no upload. Fire and forget. */
export function reportDeviceDictation(text, lang) {
  if (!state || state.force_upload) return;
  api.post('/voice-calibration/partc/device-event', { text: String(text || '').slice(0, 1000), lang }).catch(() => {});
}
