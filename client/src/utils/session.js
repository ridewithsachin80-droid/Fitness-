/**
 * utils/session.js — everything the app persists about "who is signed in".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The session depended on exactly one thing: the httpOnly `refreshToken`
 * cookie. `api/client.js` read a backup copy out of localStorage on every 401
 * — but nothing in the entire client ever wrote it, and the server never
 * returned it, so it could not have. The fallback was dead code that always
 * evaluated to null. The moment the cookie went, the session went with it.
 *
 * That is survivable on Android. On iPhone it is not:
 *
 *   - A home-screen PWA has a SEPARATE cookie jar from Safari. Log in inside
 *     Safari, then "Add to Home Screen", and the installed app starts with no
 *     cookie at all — it has never seen a login, so it looks brand new.
 *   - WebKit evicts site data far more aggressively than Chrome, and a
 *     standalone web app that has not been opened in a while can lose all of
 *     it, cookies included.
 *
 * So the token is now persisted here as a genuine second copy. The cookie
 * stays primary; this is the fallback, and it is refreshed on every successful
 * call because the server now rotates the token on refresh.
 *
 * SECURITY TRADE-OFF, STATED PLAINLY
 * ----------------------------------
 * An httpOnly cookie cannot be read by JavaScript; a localStorage value can.
 * If this app ever renders untrusted HTML, this copy is reachable by script
 * that a cookie would have been safe from. The risk is accepted deliberately:
 * the alternative, measured against real members, is being logged out and
 * shown a registration screen, which is a certain harm rather than a
 * conditional one. The cookie remains primary and still httpOnly.
 *
 * Every read and write is wrapped. Safari in Private Browsing THROWS on
 * localStorage writes rather than failing quietly, and an uncaught throw
 * during boot is a white screen — which is a worse bug than the one this file
 * fixes.
 */

const REFRESH_KEY = 'fl-refresh-token';
const MEMBER_KEY  = 'fl-last-member';
const SEEN_KEY    = 'fl-last-seen';

/**
 * The key the dead fallback used. Nothing ever wrote it, so there is nothing
 * to migrate — but if a build ever did, honour it once and move it across
 * rather than logging that member out on the upgrade.
 */
const LEGACY_REFRESH_KEY = 'refreshToken';

// ── Storage primitives ──────────────────────────────────────────────────────
// A storage failure must never become an app failure.

function readRaw(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

function writeRaw(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
}

function removeRaw(key) {
  try { localStorage.removeItem(key); } catch (_) { /* nothing to do */ }
}

// ── Refresh token fallback ──────────────────────────────────────────────────

/** A JWT is three dot-separated segments. Anything else is not worth sending. */
function looksLikeToken(t) {
  return typeof t === 'string' && t.length >= 20 && t.split('.').length === 3;
}

/**
 * Stores the refresh token as a fallback for when the cookie is unavailable.
 * Called on login AND on every successful refresh, because the server rotates
 * the token — storing only the login copy would leave a value that outlives
 * its own expiry and fails at the worst moment.
 */
export function storeRefreshToken(token) {
  if (!looksLikeToken(token)) return false;
  return writeRaw(REFRESH_KEY, token);
}

export function getStoredRefreshToken() {
  const current = readRaw(REFRESH_KEY);
  if (looksLikeToken(current)) return current;

  const legacy = readRaw(LEGACY_REFRESH_KEY);
  if (looksLikeToken(legacy)) {
    writeRaw(REFRESH_KEY, legacy);
    removeRaw(LEGACY_REFRESH_KEY);
    return legacy;
  }
  return null;
}

export function clearRefreshToken() {
  removeRaw(REFRESH_KEY);
  removeRaw(LEGACY_REFRESH_KEY);
}

/**
 * The body to send to /auth/refresh. An empty object when nothing is stored,
 * so the server falls through to the cookie exactly as it did before.
 */
export function refreshRequestBody() {
  const stored = getStoredRefreshToken();
  return stored ? { refreshToken: stored } : {};
}

// ── Who was last signed in on this device ───────────────────────────────────

/**
 * Remembering the member's name and phone turns "register again" into
 * "welcome back, enter your PIN". It grants no access on its own — the PIN is
 * still required — so it is a display hint, not a credential.
 *
 * Only members are remembered. A coach or admin signing in on a shared laptop
 * should not leave their identity on the screen for whoever picks it up next.
 */
export function rememberMember(user) {
  if (!user || user.role !== 'patient') return false;
  const name  = typeof user.name  === 'string' ? user.name.trim() : '';
  const phone = typeof user.phone === 'string' ? user.phone.replace(/\D/g, '') : '';
  if (!name && phone.length !== 10) return false;
  return writeRaw(MEMBER_KEY, JSON.stringify({
    name,
    phone: phone.length === 10 ? phone : '',
    at: Date.now(),
  }));
}

/** @returns {{name: string, phone: string}|null} */
export function getRememberedMember() {
  const raw = readRaw(MEMBER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const name  = typeof parsed.name  === 'string' ? parsed.name  : '';
    const phone = typeof parsed.phone === 'string' ? parsed.phone : '';
    if (!name && !phone) return null;
    return { name, phone };
  } catch (_) {
    // Corrupt value: drop it rather than letting it throw on every boot.
    removeRaw(MEMBER_KEY);
    return null;
  }
}

export function forgetMember() {
  removeRaw(MEMBER_KEY);
}

// ── Last-seen stamp, for diagnosing session loss ────────────────────────────

/** Written on every successful refresh, so a later failure can say how long. */
export function markSeen() {
  writeRaw(SEEN_KEY, String(Date.now()));
}

/** @returns {number|null} whole days since the last successful session. */
export function daysSinceSeen() {
  const raw = readRaw(SEEN_KEY);
  if (!raw) return null;
  const then = Number(raw);
  if (!Number.isFinite(then) || then <= 0) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  return days >= 0 ? days : null;
}

// ── Environment facts ───────────────────────────────────────────────────────

/** True when running as an installed home-screen app rather than in a tab. */
export function isStandalone() {
  try {
    if (typeof window === 'undefined') return false;
    if (window.navigator && window.navigator.standalone === true) return true;   // iOS
    if (typeof window.matchMedia !== 'function') return false;
    const mq = window.matchMedia('(display-mode: standalone)');
    return !!(mq && mq.matches);
  } catch (_) { return false; }
}

export function platformName() {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/iPhone|iPod|iPad/.test(ua)) return 'ios';
    // iPadOS 13+ reports itself as a Mac. The touch-point count is what
    // separates a real desktop Safari from an iPad pretending to be one.
    if (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'other';
  } catch (_) { return 'other'; }
}

/**
 * Everything known about a session that just ended, for the server-side
 * diagnostic log.
 *
 * Deliberately carries no personal data and no token: only which platform,
 * whether it was installed to the home screen, whether a fallback copy
 * existed, and how long it had been. That is enough to tell the three causes
 * apart — separate cookie jar, storage eviction, or expiry — and not enough to
 * identify anyone.
 */
export function sessionLossReport(reason) {
  return {
    reason:     String(reason == null ? 'unknown' : reason).slice(0, 40),
    platform:   platformName(),
    standalone: isStandalone(),
    had_token:  getStoredRefreshToken() !== null,
    days_since: daysSinceSeen(),
  };
}

/**
 * Clears what a signed-out session must not leave behind.
 *
 * `deliberate` distinguishes tapping "Log out" from being timed out:
 *   - deliberate      → forget the member too. They chose to leave; the next
 *                       person to pick up the phone should not see their name.
 *   - not deliberate  → keep the hint. This is exactly the case the hint
 *                       exists for, and it is what turns a lost session into
 *                       "welcome back" rather than a registration form.
 */
export function clearSession({ deliberate = false } = {}) {
  clearRefreshToken();
  if (deliberate) forgetMember();
}
