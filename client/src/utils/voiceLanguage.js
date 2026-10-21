/** Shared preference for every voice entry point. Unknown stored values fall back safely. */
export const VOICE_LANGUAGES = Object.freeze([
  { value: 'en-IN', label: 'English', speechLabel: 'English (India)' },
  { value: 'hi-IN', label: 'हिन्दी', speechLabel: 'Hindi' },
  { value: 'kn-IN', label: 'ಕನ್ನಡ', speechLabel: 'Kannada' },
]);

export function normalizeVoiceLang(value) {
  return VOICE_LANGUAGES.some(language => language.value === value) ? value : 'en-IN';
}

// ── Fixes-2u: words a speech engine invents from silence ─────────────────────
// The same narrow rule as server/services/voiceLanguage.js (generatedText); the
// two lists are checked against each other by the server test suite. A dictated
// sentence is ignored only when EVERY sentence in it is subtitle/credit
// boilerplate ("Transcription by ESO. Translation by —", "Thanks for watching").
// Nothing is ever stripped out of a real sentence.
export const GENERATED_CREDITS = [
  /^(?:transcri(?:ption|bed|pt)|translat(?:ion|ed)|subtit(?:les?|led|ling)|captions?|captioned|sous-titr\w*|untertitel\w*|sottotitoli\w*)(?:\s+(?:by|from|of|par|von|di))?(?:\s+\S.{0,47})?$/iu,
  /^(?:thank\s+you\s+(?:very\s+much\s+|so\s+much\s+)?for\s+watching|thanks\s+for\s+watching|please\s+(?:like\s+and\s+)?subscribe(?:\s+to\s+.{0,30})?|like\s+and\s+subscribe|(?:subtitles\s+by\s+the\s+)?amara\.?org(?:\s+community)?)$/iu,
];
export function generatedText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const sentences = t.split(/(?<=[.!?।])\s+|\s*[\r\n]+\s*/u)
    .map(x => x.replace(/^[\s"'“”(\[]+/u, '').replace(/[\s.!?।,;:—–\-…"'“”()\[\]]+$/u, '').trim())
    .filter(Boolean);
  return sentences.length > 0 && sentences.every(x => GENERATED_CREDITS.some(rx => rx.test(x)));
}
