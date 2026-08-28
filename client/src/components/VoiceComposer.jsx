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
import { useCallback, useRef, useState } from 'react';
import { useSettingsStore, haptic } from '../store/settingsStore';
import { useVoiceInput } from '../hooks/useVoiceInput';

const join = (a, b) => (a && b ? `${a} ${b}` : a || b || '');

export function useVoiceComposer({ onSend, accent = '#D4AF37', autoSend = true }) {
  // null → card hidden. '' → card open, nothing captured yet.
  const [draft, setDraft] = useState(null);
  // Transcript accepted from finished takes; interim results render after it.
  const committedRef = useRef('');
  const taRef = useRef(null);

  const voiceLang    = useSettingsStore(st => st.voiceLang || 'en-IN');
  const setVoiceLang = useSettingsStore(st => st.setVoiceLang);

  const voice = useVoiceInput({
    lang: voiceLang,
    onInterim: (t) => setDraft(join(committedRef.current, t)),
    onFinal:   (t) => {
      const full = join(committedRef.current, t).trim();
      committedRef.current = full;
      setDraft(full);
      // The pause IS the send. Waiting for a button tap after already waiting
      // for the transcript made a two-second sentence take fifteen. This is
      // safe because the parse result is a PREVIEW — nothing reaches the log
      // until the member taps Apply, so that card is the real review step.
      // Guard against a stray cough producing a one-character AI call.
      if (autoSend && full.length >= 2) {
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
    if (voice.transcribing) return;
    committedRef.current = (draft || '').trim();
    if (draft === null) setDraft('');
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
  const canSend = !!(draft || '').trim() && !voice.transcribing && !voice.listening;

  const card = !active ? null : (
    <div className="mb-2 rounded-2xl border px-3 py-2.5 bg-[#1A1C20]"
      style={{ borderColor: `${accent}59` }}>
      {/* Header line: state + language toggle / discard */}
      <div className="flex items-center justify-between mb-1.5">
        {voice.listening ? (
          <span className="text-[11px] text-red-400 font-medium flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
            {autoSend ? 'Listening… pause when done, I\'ll send it' : 'Listening… pause to finish, or tap the mic'}
          </span>
        ) : voice.transcribing ? (
          <span className="text-[11px] font-medium animate-pulse" style={{ color: accent }}>
            ✨ Getting the exact words…
          </span>
        ) : (
          <span className="text-[11px] font-medium" style={{ color: accent }}>
            Heard this — check and send
          </span>
        )}
        <div className="flex items-center gap-2">
          {voice.listening && setVoiceLang && (
            <button
              onClick={() => setVoiceLang(voiceLang === 'hi-IN' ? 'en-IN' : 'hi-IN')}
              className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/[0.18] text-[#9EA3B0]">
              {voiceLang === 'hi-IN' ? 'हिं' : 'EN'}
            </button>
          )}
          <button onClick={discard} aria-label="Discard voice note"
            style={{ minWidth: 28, minHeight: 28 }}
            className="text-[#7E8596] hover:text-white text-sm leading-none">✕</button>
        </div>
      </div>

      {/* The transcript. A textarea the whole time so "tap to edit" is literal.
          Read-only while capturing to keep the caret from fighting interim
          updates; auto-grows so nothing is ever hidden. */}
      <textarea
        ref={taRef}
        value={draft || ''}
        readOnly={voice.listening || voice.transcribing}
        onChange={(e) => { setDraft(e.target.value); committedRef.current = e.target.value; }}
        onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
        placeholder={voice.listening ? 'Say it — 2 roti with ghee, ek katori dal…' : ''}
        rows={2}
        className="w-full bg-transparent text-sm text-white placeholder-[#7E8596] leading-relaxed outline-none resize-none"
        style={{ minHeight: 44 }}
      />

      {voice.error && (
        <p className="text-[11px] text-amber-400 font-medium mt-1">{voice.error}</p>
      )}

      {/* Review actions */}
      {!voice.listening && (
        <div className="flex items-center gap-2 mt-1.5 pt-2 border-t border-white/[0.07]">
          <span className="text-[10px] text-[#7E8596]">Tap the text to edit</span>
          <span className="flex-1" />
          <button onClick={record} disabled={voice.transcribing}
            aria-label="Add more by voice"
            style={{ minWidth: 34, minHeight: 34 }}
            className="rounded-full border border-white/[0.15] text-[#9EA3B0] hover:text-white flex items-center justify-center">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          <button onClick={sendDraft} disabled={!canSend}
            style={{ minHeight: 34, background: canSend ? accent : 'rgba(255,255,255,0.08)' }}
            className={`rounded-full px-4 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 ${
              canSend ? 'text-[#121316]' : 'text-[#7E8596]'
            }`}>
            Send ➤
          </button>
        </div>
      )}
    </div>
  );

  const micButton = voice.supported ? (
    <button onClick={record} disabled={voice.transcribing}
      style={{ minWidth: 40, minHeight: 40 }}
      title={voice.listening ? 'Tap to stop' : active ? 'Add more by voice' : 'Speak your log'}
      className={`flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${
        voice.listening ? 'text-red-400 animate-pulse'
        : voice.transcribing ? 'animate-pulse'
        : 'text-[#9EA3B0] hover:text-[#F0E2B6]'
      }`}
      {...(voice.transcribing ? { 'aria-label': 'Transcribing' } : {})}>
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
  ) : null;

  return { card, micButton, active };
}

export default useVoiceComposer;
