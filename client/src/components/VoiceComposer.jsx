/**
 * useVoiceComposer — the voice UI both chat surfaces share.
 *
 * Dictation no longer writes into the typing box (a one-line input that hid
 * everything past the first line). It lives in its own card above the input:
 *
 *   speak → live transcript grows in the card
 *   3s pause (or tap mic) → auto-stop → Gemini transcript → review state
 *   review: tap text to edit · mic appends another take · Send sends · ✕ discards
 *
 * "Continue" semantics: each recording session transcribes separately and is
 * appended to what's already in the card, so a member can build a long log in
 * several short takes without losing the earlier ones.
 *
 * Returns { card, micButton, active } as ready-to-place JSX. The host chat
 * renders `card` above its input row, `micButton` inside it, and passes
 * onSend(text) — which should behave exactly like typing that text and
 * pressing send.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { refreshCalibrationTry, onCalibrationChange, calibrationTry } from '../utils/calibrationMode';
import { useSettingsStore, haptic } from '../store/settingsStore';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { VOICE_LANGUAGES, normalizeVoiceLang } from '../utils/voiceLanguage';
// The continue-by-mic and auto-send rules are pure and live in utils, so the
// test suite exercises the same code this component runs rather than a copy.
import {
  applyInterim, applyFinal, applyEdit, startTake, shouldAutoSend,
} from '../utils/voiceComposer';

export function useVoiceComposer({ onSend, accent = 'var(--accent)', autoSend = true, contextKey = '', showLanguage = true }) {
  // null → card hidden. '' → card open, nothing captured yet.
  const [draft, setDraft] = useState(null);
  // Transcript accepted from finished takes; interim results render after it.
  const committedRef = useRef('');
  const taRef = useRef(null);
  const fieldId = useId();
  const statusId = `${fieldId}-status`;
  const errorId = `${fieldId}-error`;
  const editVersionRef = useRef(0);
  const takeEditVersionRef = useRef(0);

  const voiceLang    = useSettingsStore(st => normalizeVoiceLang(st.voiceLang));
  const setVoiceLang = useSettingsStore(st => st.setVoiceLang);

  // Fixes-2x: an armed voice-calibration try on the test site (null everywhere else; production never asks).
  const [calTry, setCalTry] = useState(calibrationTry());
  // Fixes-2y: kept current while the composer stays open (every minute and on returning to the app); the label
  // clears by itself when the session's window ends. Off the test site these make no request.
  useEffect(() => {
    const off = onCalibrationChange(setCalTry);
    refreshCalibrationTry().then(setCalTry);
    const tick = setInterval(() => refreshCalibrationTry(), 60000);
    const again = () => { if (document.visibilityState !== 'hidden') refreshCalibrationTry(); };
    window.addEventListener('focus', again); document.addEventListener('visibilitychange', again);
    return () => { off(); clearInterval(tick); window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again); };
  }, []);
  const voice = useVoiceInput({
    lang: voiceLang,
    contextKey,
    onCancel: () => { committedRef.current = ''; setDraft(null); editVersionRef.current++; },
    onInterim: (t) => {
      if (editVersionRef.current !== takeEditVersionRef.current) return;
      setDraft(applyInterim({ committed: committedRef.current, draft: null }, t).draft);
    },
    onFinal:   (t) => {
      // A retry can finish after the member corrects a failed take. Their edit wins.
      if (editVersionRef.current !== takeEditVersionRef.current) {
        voice.setError('Your edited text is kept. Send it, or add another voice note.');
        return;
      }
      const next = applyFinal({ committed: committedRef.current, draft: null }, t);
      const full = next.draft;
      committedRef.current = next.committed;
      setDraft(full);
      // The pause IS the send. Waiting for a button tap after already waiting
      // for the transcript made a two-second sentence take fifteen. This is
      // safe because the parse result is a PREVIEW — nothing reaches the log
      // until the member taps Apply, so that card is the real review step.
      // Guard against a stray cough producing a one-character AI call.
      if (shouldAutoSend(full, autoSend)) {
        committedRef.current = '';
        setDraft(null);
        haptic(20);
        onSend(full);
      }
    },
  });

  const reset = useCallback(() => {
    committedRef.current = '';
    setDraft(null);
    voice.setError(null);
  }, [voice]);

  // Bottom mic and in-card mic share this: fresh session when the card is
  // closed, append-take when it is open. Edits made in the textarea become the
  // committed base, so a new take continues from what the member sees.
  const record = useCallback(() => {
    if (voice.listening) { voice.stop(); return; }
    if (voice.transcribing || voice.requesting || voice.canRetry) return;
    takeEditVersionRef.current = editVersionRef.current;
    const next = startTake({ committed: committedRef.current, draft });
    committedRef.current = next.committed;
    if (draft === null) setDraft(next.draft);
    haptic(15);
    voice.start();
  }, [voice, draft]);

  const discard = useCallback(() => {
    voice.cancel();
    reset();
    haptic(10);
  }, [voice, reset]);

  const sendDraft = useCallback(() => {
    const text = (draft || '').trim();
    if (!text || voice.transcribing) return;
    voice.cancel();
    reset();
    haptic(20);
    onSend(text);
  }, [draft, voice, reset, onSend]);

  const active = draft !== null || !!voice.error;
  const discardTake = () => {
    voice.discardTake();
    setDraft(committedRef.current);
    haptic(10);
  };
  const canSend = !!(draft || '').trim() && !voice.transcribing && !voice.listening && !voice.requesting;

  const card = !active ? null : (
    <div data-testid="voice-composer" className="mb-2 rounded-2xl border px-3 py-2.5 bg-surface"
      style={{ borderColor: 'var(--border)' }}>
      {calTry && (
        <p data-testid="voice-calibration-banner" className="text-caption font-semibold text-gold mb-1.5">
          Voice calibration try {calTry.trial}: {calTry.route === 'controlled' ? 'the recording goes to the server (on-device words are not used).' : 'recorded as it happens, on-device words included.'}
        </p>
      )}
      {/* Header line: state + language toggle / discard */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div id={statusId} role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1">
          {voice.requesting ? <span className="text-caption text-mid">Allow microphone access to begin…</span> : voice.listening ? (
            <span className="text-caption text-red-400 font-medium flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
              {autoSend ? 'Listening… pause when done, I\'ll send it' : 'Listening… pause to finish, or tap the mic'}
            </span>
          ) : voice.transcribing ? (
            <span className="text-caption font-medium animate-pulse" style={{ color: accent }}>
              ✨ Getting the exact words…
            </span>
          ) : (
            <span className="text-caption font-medium" style={{ color: accent }}>
              {voice.canRetry ? 'Recording kept for retry' : draft?.trim() ? 'Heard this — check and send' : 'Ready when you are'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={discard} aria-label="Discard voice note"
            style={{ minWidth: 44, minHeight: 44 }}
            className="text-lo hover:text-white text-sm leading-none">✕</button>
        </div>
      </div>

      <label className="flex items-center justify-between gap-2 mb-2 text-caption text-mid">
        <span>{voice.listening || voice.requesting || voice.transcribing ? 'Next recording' : 'Voice language'}</span>
        <select data-testid="voice-language" aria-label="Voice language"
          value={voiceLang} onChange={e => setVoiceLang(e.target.value)}
          className="min-w-0 rounded-lg border border-hair bg-surface px-2 text-xs text-white"
          style={{ minHeight: 44, maxWidth: 140 }}>
          {VOICE_LANGUAGES.map(language => <option key={language.value} value={language.value}>{language.label}</option>)}
        </select>
      </label>

      {/* The transcript. A textarea the whole time so "tap to edit" is literal.
          Read-only while capturing to keep the caret from fighting interim
          updates; auto-grows so nothing is ever hidden. */}
      <label htmlFor={fieldId} className="sr-only">Voice transcript</label>
      <textarea
        id={fieldId}
        aria-describedby={voice.error ? `${statusId} ${errorId}` : statusId}
        ref={taRef}
        value={draft || ''}
        readOnly={voice.listening || voice.requesting}
        onChange={(e) => {
          editVersionRef.current++;
          const next = applyEdit({ committed: committedRef.current, draft }, e.target.value);
          setDraft(next.draft); committedRef.current = next.committed;
        }}
        onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
        placeholder={voice.listening ? 'Say it — 2 roti with ghee, ek katori dal…' : ''}
        rows={2}
        className="w-full bg-transparent text-sm text-white placeholder-lo leading-relaxed outline-none resize-none"
        style={{ minHeight: 44 }}
      />

      {voice.error && (
        <p id={errorId} role="status" aria-live="polite" aria-atomic="true" className="text-caption text-warn font-medium mt-1">{voice.error}</p>
      )}

      {voice.canRetry && (
        <div className="flex flex-wrap gap-2 mt-2" data-testid="voice-recovery">
          <button type="button" data-testid="voice-retry" onClick={voice.retry} disabled={voice.transcribing}
            className="rounded-xl border border-gold/40 px-3 text-xs font-semibold text-gold disabled:opacity-40"
            style={{ minHeight: 44 }}>{voice.transcribing ? 'Retrying…' : 'Retry recording'}</button>
          <button type="button" data-testid="voice-discard-take" onClick={discardTake}
            className="rounded-xl border border-hair px-3 text-xs text-mid" style={{ minHeight: 44 }}>
            Discard recording
          </button>
        </div>
      )}

      {/* Review actions */}
      {!voice.listening && (
        <div className="flex items-center gap-2 mt-1.5 pt-2 border-t border-hair">
          <span className="text-eyebrow text-lo">Tap the text to edit</span>
          <span className="flex-1" />
          <button onClick={record} disabled={voice.transcribing || voice.requesting || voice.canRetry}
            aria-label="Add more by voice"
            style={{ minWidth: 44, minHeight: 44 }}
            className="rounded-full border border-white/[0.15] text-mid hover:text-white flex items-center justify-center">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          <button onClick={sendDraft} disabled={!canSend}
            style={{ minHeight: 44, background: canSend ? accent : 'rgb(var(--fit-ink) / 0.08)' }}
            className={`rounded-full px-4 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 ${
              canSend ? 'text-charcoal' : 'text-lo'
            }`}>
            Send ➤
          </button>
        </div>
      )}
    </div>
  );

  const micButton = voice.supported ? (
    <div className="flex items-center flex-shrink-0 gap-0.5">
      {showLanguage && !active && <select data-testid="voice-language-ready" aria-label="Voice language before recording"
        title="Voice language" value={voiceLang} onChange={e => setVoiceLang(e.target.value)}
        className="rounded-lg border border-hair bg-surface text-caption text-mid"
        style={{ minHeight: 44, width: 62, maxWidth: 62 }}>
        {VOICE_LANGUAGES.map(language => <option key={language.value} value={language.value}>{language.value === 'en-IN' ? 'EN' : language.label}</option>)}
      </select>}
    <button onClick={record} disabled={voice.transcribing || voice.requesting || voice.canRetry}
      style={{ minWidth: 44, minHeight: 44 }}
      title={voice.listening ? 'Tap to stop' : active ? 'Add more by voice' : 'Speak your log'}
      className={`flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${
        voice.listening ? 'text-red-400 animate-pulse'
        : voice.transcribing ? 'animate-pulse'
        : 'text-mid hover:text-gold-light'
      }`}
      aria-label={voice.transcribing ? 'Transcribing' : voice.listening ? 'Stop recording' : 'Speak your log'}>
      {voice.transcribing ? (
        <span className="text-base leading-none">✨</span>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      )}
    </button>
    </div>
  ) : null;

  // Launcher starts are idempotent; a second launch must never toggle off
  // an active recording. The mic inside the composer still toggles normally.
  const startRecording = () => {
    if (voice.listening || voice.transcribing || voice.requesting || voice.canRetry) return;
    takeEditVersionRef.current = editVersionRef.current;
    const next = startTake({ committed: committedRef.current, draft });
    committedRef.current = next.committed;
    if (draft === null) setDraft(next.draft);
    voice.start();
  };
  const cancelCapture = () => {
    voice.cancel();
    if (!draft?.trim()) { committedRef.current = ''; setDraft(null); }
  };
  return { card, micButton, active, startRecording, cancelCapture };
}

export default useVoiceComposer;
