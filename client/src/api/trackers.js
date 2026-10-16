import { refreshRequestBody } from '../utils/session';
import { useAuthStore } from '../store/authStore';
/**
 * api/trackers.js
 * Client-side API helpers for the tracker integration.
 */

import api from './client';

/** Get which providers are currently connected for the logged-in user */
export const getTrackerStatus = () =>
  api.get('/trackers/status').then(r => r.data);

/** Trigger a server-side sync for an OAuth provider (fitbit / whoop / polar) */
export const syncOAuthProvider = (provider) =>
  api.post(`/trackers/sync/${provider}`).then(r => r.data);

/** Get the last N days of merged tracker data */
export const getTrackerData = (days = 7) =>
  api.get(`/trackers/data?days=${days}`).then(r => r.data);

/** Disconnect a provider */
export const disconnectTracker = (provider) =>
  api.delete(`/trackers/${provider}`).then(r => r.data);

/**
 * Get the OAuth redirect URL for a provider.
 * Navigating to this URL starts the OAuth flow.
 */
export const getOAuthUrl = (provider) =>
  `/api/trackers/oauth/${provider}`;

/**
 * Renew the session cookie before leaving the app for a tracker's sign-in page
 * (fix, 10 Oct 2026, UI-012). That page is a full navigation to
 * /api/trackers/oauth/<provider>, which can only be signed in by the
 * accessToken COOKIE — and that cookie lapses after about 15 minutes even
 * though the app itself keeps working (it renews its own copy on demand). So
 * "Connect Fitbit" after a while in the app showed {"error":"Token expired"}.
 */
export async function renewSessionCookie() {
  // Through the app's own client (withCredentials, base /api). Its 401 retry
  // skips /auth/refresh, so a dead session fails here instead of looping.
  const { data } = await api.post('/auth/refresh', refreshRequestBody());
  useAuthStore.getState().setToken(data.accessToken, data.refreshToken || null);
}
