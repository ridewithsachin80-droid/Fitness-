// Retry data is held only by the current in-memory conversation. Never persist
// these snapshots: photos and health descriptions are private member data.
let sequence = 0;

export const nextRequestId = () => `ai-${Date.now()}-${++sequence}`;
export const requestSnapshot = value => JSON.parse(JSON.stringify(value));

export function requestBelongsToChat(request, auth, chat, day) {
  return !!request && !request.invalidated && request.day === day && chat.dayKey === request.day
    && request.owner === (auth.user?.id ?? null)
    && request.sessionVersion === auth.sessionVersion
    && chat.messages.some(m => m.requestId === request.id || m.requestIds?.includes(request.id));
}

// Do not echo upstream error bodies: they can include provider names, keys,
// prompts or internal URLs. The member needs an action, not diagnostics.
export function requestFailureMessage(error, kind = 'text', online = typeof navigator !== 'undefined' ? navigator.onLine : undefined) {
  const status = error?.response?.status;
  if (status === 401 || status === 403) return 'Please sign in again before trying this request.';
  if (status === 429) return 'FitLife is busy right now. Your request is kept — try again shortly.';
  if (status === 413) return kind === 'photo'
    ? 'That photo is too large. Replace it with a smaller photo and try again.'
    : 'That message is too long. Edit it into a shorter update and try again.';
  if (kind === 'photo' && !error?.response && /readable image|read the photo/i.test(error?.message || '')) {
    return 'That photo could not be read. Try again or replace it with another photo.';
  }
  // Fixes-3j (UX review finding 2): say it is the connection. The phone knows when it is offline; with no answer at
  // all while it thinks it is online, it may be the network or FitLife, so say exactly that. Water and weight work
  // offline from the Today tiles, so point there.
  const phoneOffline = online === false;
  if (phoneOffline) return kind === 'photo'
    ? "You're offline. Your photo is kept here — tap Retry when you're back online."
    : "You're offline. Your message is kept here — tap Retry when you're back online. Water and weight can still be logged from the Today tiles.";
  // A timeout also has no response (axios sets error.request), so it is told apart first (QA review of 3j, finding 1).
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
    return 'That took too long. Your request is kept — try again when your connection is ready.';
  }
  if (!error?.response && (error?.request || /network error/i.test(error?.message || ''))) return kind === 'photo'
    ? 'No answer from FitLife — check your internet. Your photo is kept here; tap Retry.'
    : 'No answer from FitLife — check your internet. Your message is kept here; tap Retry.';
  return kind === 'photo'
    ? 'Your photo could not be analysed. It is kept here — check your connection and try again.'
    : 'Your message could not be processed. It is kept here — try again or edit it below.';
}
