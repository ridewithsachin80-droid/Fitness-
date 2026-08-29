import { create } from 'zustand';
import { disconnectSocket } from '../hooks/useSync';

/**
 * Global auth state.
 * accessToken is kept in memory only — never localStorage.
 * The httpOnly refreshToken cookie handles session persistence.
 *
 * On hard refresh: the token is gone, but App.jsx calls /api/auth/refresh
 * using the cookie, which silently restores the session.
 */
export const useAuthStore = create((set) => ({
  accessToken: null,
  user: null,           // { id, name, role }
  isRestoring: true,    // true while checking session on first load

  /** Called after successful login (OTP verify or email/password) */
  login: (token, user) =>
    set({ accessToken: token, user, isRestoring: false }),

  /** Called after a silent token refresh */
  setToken: (token) =>
    set({ accessToken: token }),

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
