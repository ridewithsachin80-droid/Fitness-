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

// Bind each request to the sign-in that created it. A silent refresh keeps
// that identity; sign-out or another login changes it, even for the same user.
const sessionNow = () => {
  const state = useAuthStore.getState();
  return { owner: state.user?.id ?? null, version: state.sessionVersion };
};
const sameSession = (a, b) => a?.owner === b?.owner && a?.version === b?.version;
const sessionChanged = () => new axios.CanceledError('Session changed. Please try again in your current account.');
function assertSession(session) {
  if (!sameSession(session, sessionNow())) throw sessionChanged();
}

api.interceptors.request.use((config) => {
  config._authSession ||= sessionNow();
  assertSession(config._authSession);
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  else delete config.headers.Authorization;
  return config;
}, (error) => { throw error; }, { synchronous: true });

// One refresh per session. A new account must never join the old account's
// refresh, and a late old response must not restore a deliberately ended one.
let refreshFlight = null;
function refreshFor(session) {
  if (refreshFlight && sameSession(refreshFlight.session, session)) return refreshFlight.promise;
  const flight = { session, promise: null };
  flight.promise = (async () => {
    try {
      assertSession(session);
      const { data } = await axios.post('/api/auth/refresh', refreshRequestBody(), {
        withCredentials: true,
        timeout: 35000,
      });
      assertSession(session);
      if (data.user?.id != null && data.user.id !== session.owner) {
        // A cookie changed in another tab. Never combine its account with this
        // tab's edits, even though the refresh itself was valid.
        useAuthStore.getState().logout('expired');
        throw sessionChanged();
      }
      if (!data.accessToken) throw new Error('Session refresh returned no access token. Please retry.');
      useAuthStore.getState().setToken(data.accessToken, data.refreshToken || null);
      return data.accessToken;
    } catch (error) {
      // No network, timeout, rate limit and server errors do not prove expiry.
      // Keep the session and let saving queue/retry instead of throwing away
      // the member's current screen and fallback token.
      if (sameSession(session, sessionNow()) && [401, 403].includes(error.response?.status)) {
        reportSessionLoss(`refresh-${error.response.status}`);
        useAuthStore.getState().logout('expired');
      }
      throw error;
    } finally {
      if (refreshFlight === flight) refreshFlight = null;
    }
  })();
  refreshFlight = flight;
  return flight.promise;
}

api.interceptors.response.use(
  (response) => {
    assertSession(response.config._authSession);
    return response;
  },
  async (error) => {
    const original = error.config;
    if (!original) throw error;
    assertSession(original._authSession);
    if (error.response?.status !== 401 || original._retry ||
        original.url?.includes('/auth/refresh') || original._authSession.owner == null) throw error;

    original._retry = true;
    // Another request may already have refreshed while this 401 was in flight.
    // Reuse that token once instead of performing a second refresh.
    const token = useAuthStore.getState().accessToken;
    if (!token || original.headers.Authorization === `Bearer ${token}`) {
      await refreshFor(original._authSession);
    }
    assertSession(original._authSession);
    return api(original);
  }
);

export default api;
