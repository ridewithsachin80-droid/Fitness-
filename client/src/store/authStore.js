import { create } from 'zustand';
import { disconnectSocket } from '../hooks/useSync';
import {
  storeRefreshToken,
  rememberMember,
  clearSession,
  markSeen,
} from '../utils/session';

/**
 * Global auth state.
 * accessToken is kept in memory only — never localStorage.
 * Session persistence is the httpOnly refreshToken cookie, with a fallback
 * copy in localStorage for clients whose cookie jar does not survive (see
 * utils/session.js).
 *
 * On hard refresh: the token is gone, but App.jsx calls /api/auth/refresh
 * using the cookie, which silently restores the session.
 */
export const useAuthStore = create((set) => ({
  accessToken: null,
  user: null,           // { id, name, role }
  isRestoring: true,    // true while checking session on first load

  /**
   * Called after a successful login (PIN, OTP verify, or email/password) and
   * after the cold-start session restore.
   *
   * `refreshToken` is the fallback copy. The cookie remains primary; this is
   * what survives an iPhone home-screen app having its own cookie jar, or
   * WebKit clearing site data. Passing it is optional so an older caller
   * cannot break — it simply gets the previous cookie-only behaviour.
   */
  login: (token, user, refreshToken = null) => {
    if (refreshToken) storeRefreshToken(refreshToken);
    rememberMember(user);
    markSeen();
    set({ accessToken: token, user, isRestoring: false });
  },

  /** Called after a silent token refresh. The server ROTATES the refresh
   *  token, so the stored copy must be replaced or it outlives its own
   *  expiry and fails at the worst possible moment. */
  setToken: (token, refreshToken = null) => {
    if (refreshToken) storeRefreshToken(refreshToken);
    markSeen();
    set({ accessToken: token });
  },

  /** Called when session is confirmed gone (refresh failed) */
  setRestored: () =>
    set({ isRestoring: false }),

  /**
   * Called on logout, or on a 401 that could not be refreshed.
   *
   * `reason` explains WHY to the login screen. Being silently dumped back to
   * login mid-sentence — which is what an expired refresh token does on a PWA
   * that has been open for days — reads as the app breaking. sessionStorage
   * carries it because this is a full document load, so in-memory state does
   * not survive; sessionStorage clears itself when the tab closes, so a stale
   * message can never greet someone on a fresh launch.
   */
  logout: (reason = null) => {
    disconnectSocket();   // close WS before clearing state to avoid reconnect race
    try {
      if (reason) sessionStorage.setItem('fl-logout-reason', reason);
      else        sessionStorage.removeItem('fl-logout-reason');
    } catch (_) {}

    // A stored refresh token MUST go on the way out. Leaving it behind means
    // the next boot silently signs the previous member back in — which, on a
    // shared phone, is worse than the bug this fallback was added to fix.
    //
    // `reason === null` is a deliberate sign-out (the member tapped Log out);
    // anything else is the session ending underneath them. Only the deliberate
    // case forgets WHO they were, because remembering the name is exactly what
    // turns an unexpected logout into "welcome back" instead of a
    // registration form.
    clearSession({ deliberate: reason === null });

    set({ accessToken: null, user: null, isRestoring: false });
    window.location.href = '/login';
  },
}));

/**
 * Reads and clears the logout reason. One-shot: refreshing the login page
 * should not keep re-showing "your session expired".
 */
export function takeLogoutReason() {
  try {
    const r = sessionStorage.getItem('fl-logout-reason');
    if (r) sessionStorage.removeItem('fl-logout-reason');
    return r;
  } catch (_) { return null; }
}
