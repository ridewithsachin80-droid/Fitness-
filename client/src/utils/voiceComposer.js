/**
 * utils/voiceComposer.js — how a spoken take turns into text on the card.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * The rules below lived inside `useVoiceComposer`, spread across a `useState`
 * and a `useRef` and tangled with haptics, a speech-recognition hook and a
 * send callback. None of that runs in Node, so `test-coach-view.js` kept a
 * hand-written model of the state machine under a comment saying "mirrors the
 * voice composer's continue-by-mic state machine".
 *
 * That copy had already drifted: its `final` step did not `.trim()` the joined
 * transcript, while the shipped one does. A leading space is invisible in a
 * test and reaches the parser in production.
 *
 * The state is two strings. Keeping them here, as plain functions, means the
 * component and the suite exercise the same rules.
 *
 * ── THE TWO THINGS THIS HAS TO GET RIGHT ────────────────────────────────────
 *
 * CONTINUE. Tapping the mic again continues the sentence rather than starting
 * over. "2 roti with ghee" then "aur ek katori dal" is one message, joined by
 * exactly one space. Interim results render after the committed text and never
 * overwrite it — a half-recognised word must not eat a finished take.
 *
 * EDITS WIN. If the member fixes "rothi" to "roti" in the textarea, the next
 * take continues from what they can SEE, not from what was originally heard.
 */

/**
 * Join two fragments with exactly one space, tolerating either being empty.
 *
 * Each side is trimmed BEFORE joining, not just the result. Trimming only the
 * result cleans the ends and leaves the seam: a second take arriving as
 * "  500 ml water  " produced "weight 82.5   500 ml water" — three spaces in
 * the middle, invisible on screen, sent to the parser exactly like that.
 * Speech APIs pad their fragments, so this is the normal case, not an edge one.
 */
export function join(a, b) {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  return x && y ? `${x} ${y}` : x || y || '';
}

/** `draft: null` means the card is closed. `''` means open and empty. */
export const EMPTY = { committed: '', draft: null };

/**
 * Start a take. Whatever is on the card becomes the base to continue from —
 * including manual edits, which is the point.
 */
export function startTake(state) {
  const draft = state.draft;
  return { committed: (draft || '').trim(), draft: draft === null ? '' : draft };
}

/** A partial result: shown after the committed text, never replacing it. */
export function applyInterim(state, text) {
  return { committed: state.committed, draft: join(state.committed, text) };
}

/** A finished take is accepted into the committed transcript. */
export function applyFinal(state, text) {
  const full = join(state.committed, text).trim();
  return { committed: full, draft: full };
}

/** A manual edit becomes both what is shown and the base for the next take. */
export function applyEdit(_state, text) {
  return { committed: text, draft: text };
}

/** Take the text and close the card. */
export function drain(state) {
  return { text: (state.draft || '').trim(), state: { ...EMPTY } };
}

/**
 * Should a finished take send itself, without waiting for a button?
 *
 * The pause IS the send. Waiting for a tap after already waiting for the
 * transcript made a two-second sentence take fifteen. It is safe because the
 * parse result is a PREVIEW — nothing reaches the log until the member taps
 * Apply, so that card is the real review step.
 *
 * The length floor stops a cough or a stray "um" turning into an AI call.
 */
export const AUTO_SEND_MIN_CHARS = 2;

export function shouldAutoSend(text, autoSend = true) {
  return !!autoSend && String(text || '').trim().length >= AUTO_SEND_MIN_CHARS;
}


/**
 * What the card shows after a finished take, given whether it auto-sent.
 * Same rule as shouldAutoSend, expressed as the outcome rather than the verdict.
 */
export function autoSendDecision({ text, autoSend }) {
  const full = String(text || '').trim();
  return shouldAutoSend(full, autoSend)
    ? { sent: full, cardOpen: false }
    : { sent: null, cardOpen: full.length > 0 };
}

/**
 * Where a finished recording's transcript comes from.
 *
 * Real report, 28 Aug 2026: "76.7kg 500ml water" took 10–15 seconds to reach
 * the AI. The hook was uploading the audio to Gemini even when on-device
 * recognition had ALREADY produced the words the member watched appear on
 * screen — a second opinion nobody asked for, which also risked sending text
 * different from what they had just read.
 *
 * So: an on-device transcript wins outright and the network is skipped. Gemini
 * stays as the fallback for browsers with no recognition (iOS Safari), where it
 * is the only way to get a transcript at all. Under ~1KB of audio is a
 * tap-and-release with no speech in it and is worth neither.
 */
export const MIN_AUDIO_BYTES = 1000;

export function transcriptionRoute({ webSpeechText, blobBytes = Infinity }) {
  if (webSpeechText) return { source: 'on-device', uploads: false };
  if (blobBytes < MIN_AUDIO_BYTES) return { source: 'none', uploads: false };
  return { source: 'gemini', uploads: true };
}

/**
 * A small stateful wrapper over the functions above, for tests and for anything
 * that wants the machine without React. The component holds its own state, so
 * this is a convenience rather than the source of truth.
 */
export function createComposerModel() {
  let s = { ...EMPTY };
  return {
    record()   { s = startTake(s); },
    interim(t) { s = applyInterim(s, t); },
    final(t)   { s = applyFinal(s, t); },
    edit(t)    { s = applyEdit(s, t); },
    send()     { const { text, state } = drain(s); s = state; return text; },
    discard()  { s = { ...EMPTY }; },
    get draft()     { return s.draft; },
    get committed() { return s.committed; },
  };
}
