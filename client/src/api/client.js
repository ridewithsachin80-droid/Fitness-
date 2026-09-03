import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { refreshRequestBody, sessionLossReport } from '../utils/session';

/**
 * Tells the server a session could not be restored, so that sessions ending
 * become visible instead of being something only a complaining member reveals.
 *
 * Fire-and-forget by design: it must never delay the logout it is reporting,
 * and its own failure must never surface. `keepalive` lets it survive the
 * navigation to /login that happens immediately afterwards — without it the
 * browser cancels the request and the very failures worth measuring are the
 * ones that go unrecorded.
 */
function reportSessionLoss(reason) {
  try {
    const body = JSON.stringify(sessionLossReport(reason));
    if (typeof fetch === 'function') {
      fetch('/api/auth/session-loss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'include',
      }).catch(() => {});
    }
  } catch (_) { /* diagnostics must never break the app */ }
}

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,    // Send httpOnly refreshToken cookie on every request
  timeout: 35000,
});

// ── Request interceptor — attach access token ─────────────────────────────
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor — silent token refresh on 401 ───────────────────
let isRefreshing = false;
let pendingQueue = [];  // Requests waiting for the refresh to complete

function processPending(error, token = null) {
  pendingQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else       prom.resolve(token);
  });
  pendingQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    // Only attempt refresh on 401, and not for the refresh endpoint itself
    if (
      error.response?.status === 401 &&
      !original._retry &&
      !original.url?.includes('/auth/refresh')
    ) {
      if (isRefreshing) {
        // Another refresh is already in flight — queue this request
        return new Promise((resolve, reject) => {
          pendingQueue.push({ resolve, reject });
        }).then((token) => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        // The fallback copy of the refresh token, for when the cookie is
        // missing or blocked. This line used to read localStorage directly for
        // a key that NOTHING in the client ever wrote, and that the server
        // never returned — so it was always null and the cookie was in truth
        // the only credential. utils/session.js owns it now, and the server
        // returns the token in the body precisely so it can be stored.
        const { data } = await axios.post(
          '/api/auth/refresh',
          refreshRequestBody(),
          { withCredentials: true }
        );

        // The server rotates the refresh token, so store the new one. Missing
        // this would leave a stale copy that expires on the original login's
        // schedule no matter how often the member opens the app.
        useAuthStore.getState().setToken(data.accessToken, data.refreshToken || null);
        processPending(null, data.accessToken);

        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (refreshError) {
        processPending(refreshError, null);
        // Not a deliberate sign-out — the session ran out underneath them.
        // Say so on the login screen instead of appearing to have crashed,
        // and record it so we learn WHY without waiting for a complaint.
        reportSessionLoss('refresh-401');
        useAuthStore.getState().logout('expired');
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
