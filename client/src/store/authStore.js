import { create } from 'zustand';

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

  /** Called on logout or 401 that can't be refreshed */
  logout: () => {
    set({ accessToken: null, user: null, isRestoring: false });
    window.location.href = '/login';
  },
}));
