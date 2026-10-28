/**
 * utils/calibrationMode.js — voice calibration Part C (TEST SITE ONLY). Fixes-2x, bound to the session in Fixes-2y.
 *
 * While an administrator has armed a Part C try for THIS account on the test server:
 *   controlled — the recording is always uploaded (on-device dictation is not used), so the
 *                try reaches the provider leg being tested; the composer shows a label saying so;
 *   natural    — nothing changes, but when on-device dictation is used (no upload) the app
 *                reports that, so it is never mistaken for Gemini or Whisper.
 *
 * Fixes-2y (the 2x kit review, finding 4): the mode is bound to the signed-in account AND the armed
 * session's identity and expiry. It is read again at the start of every recording and fixed for that
 * take (beginCalibrationTake → takeCalibrationMode); it lapses on its own when the session's window ends,
 * and is cleared on Finish (the server stops answering), sign-out or a change of account. The take sends
 * its session key with the upload, so a recording is never counted against a different session.
 *
 * The app asks only on the test site (by address) — production never makes this request — and the server
 * answers only for the armed account. Everyone else: no change at all.
 */
import api from '../api/client';
import { useAuthStore } from '../store/authStore';

const TEST_HOSTS = /(^|\.)fitness-test\.|^localhost$|^127\.0\.0\.1$/;
/** Fixes-3g: also used by the admin calibration panel, to show its loading and error states on the test site only. */
export const onTestSite = () => typeof window !== 'undefined' && TEST_HOSTS.test(window.location?.hostname || '');
/** Who is signed in, and which sign-in (a new sign-in of the same account is a new session too). */
const authKey = () => { const { user, sessionVersion } = useAuthStore.getState(); return user?.id ? `${sessionVersion}:${user.id}` : null; };

let state = null;          // { trial, route, path, say, force_upload, session_key, expires_at, auth } or null
let checkedAt = 0;
let expiryTimer = null;
const listeners = new Set();
const valid = (s) => !!s && onTestSite() && s.auth === authKey() && Date.now() < s.expires_at;
function set(next) {
  state = next;
  clearTimeout(expiryTimer);
  if (state) expiryTimer = setTimeout(() => notify(), Math.max(0, state.expires_at - Date.now()) + 50);   // the label clears when the window ends
  notify();
}
function notify() { const s = calibrationTry(); listeners.forEach(fn => fn(s)); }

/** The armed try for this account and sign-in, if its window is still open. null otherwise (always null off the test site). */
export const calibrationTry = () => (valid(state) ? state : null);
export const calibrationForcesUpload = () => !!calibrationTry()?.force_upload;
export function onCalibrationChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Ask the server. Cached for 5 s unless forced; never asks off the test site or when nobody is signed in. */
export async function refreshCalibrationTry({ force = false } = {}) {
  const auth = authKey();
  if (!onTestSite() || !auth) { if (state) set(null); return null; }
  if (!force && Date.now() - checkedAt < 5000 && (state === null || valid(state))) return calibrationTry();
  checkedAt = Date.now();
  try {
    const { data } = await api.get('/voice-calibration/partc/me');
    const a = data?.armed;
    // An answer that arrives after a sign-out or account change belongs to nobody.
    set(a && authKey() === auth && Number(a.expires_in_ms) > 0 ? { ...a, auth, expires_at: Date.now() + Number(a.expires_in_ms) } : null);
  } catch { set(null); }
  return calibrationTry();
}

/**
 * At the START of a recording: read the mode afresh. Resolves to a frozen snapshot for this take
 * ({ trial, route, force_upload, session_key, auth }) or null. Off the test site: null, with no request.
 */
export function beginCalibrationTake() {
  if (!onTestSite() || !authKey()) return null;
  return refreshCalibrationTry({ force: true }).then(s => (s ? Object.freeze({ trial: s.trial, route: s.route, force_upload: !!s.force_upload, session_key: s.session_key || null, auth: s.auth }) : null)).catch(() => null);
}
/** At the END of a recording: the snapshot taken at its start (never waits more than `ms`; unknown → the ordinary path). */
export async function takeCalibrationMode(pending, ms = 2500) {
  if (!pending) return null;
  let timer;
  const snap = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })]).catch(() => null);
  clearTimeout(timer);
  return snap && snap.auth === authKey() ? snap : null;
}

/** Natural observations: on-device words were used, with no upload. Only for a natural snapshot of the same sign-in. Fire and forget. */
export function reportDeviceDictation(text, lang, snap) {
  const s = snap === undefined ? calibrationTry() : snap;
  if (!s || s.force_upload || s.auth !== authKey()) return;
  api.post('/voice-calibration/partc/device-event', { text: String(text || '').slice(0, 1000), lang, session_key: s.session_key || undefined }).catch(() => {});
}

// Sign-out or a different account: forget the try at once.
useAuthStore.subscribe?.((s, prev) => { if (state && (s.user?.id !== prev?.user?.id || s.sessionVersion !== prev?.sessionVersion)) set(null); });

/** Tests only: forget everything. */
export function __resetCalibrationMode() { clearTimeout(expiryTimer); state = null; checkedAt = 0; listeners.clear(); }
