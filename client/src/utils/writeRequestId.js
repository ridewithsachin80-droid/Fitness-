// Stable for one reviewed submission, distinct across tabs and new reviews.
export const writeRequestId = () => `review-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}`;
