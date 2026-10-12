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
