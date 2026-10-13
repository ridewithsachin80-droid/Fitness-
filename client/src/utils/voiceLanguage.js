/** Shared preference for every voice entry point. Unknown stored values fall back safely. */
export const VOICE_LANGUAGES = Object.freeze([
  { value: 'en-IN', label: 'English', speechLabel: 'English (India)' },
  { value: 'hi-IN', label: 'हिन्दी', speechLabel: 'Hindi' },
  { value: 'kn-IN', label: 'ಕನ್ನಡ', speechLabel: 'Kannada' },
]);

export function normalizeVoiceLang(value) {
  return VOICE_LANGUAGES.some(language => language.value === value) ? value : 'en-IN';
}
