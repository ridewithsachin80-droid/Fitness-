import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useHandsFree — a spoken conversation for someone who cannot see the screen.
 *
 * THE SITUATION THIS IS BUILT FOR
 * ------------------------------
 * The member is across the room, or cooking, or wearing earbuds. They cannot
 * see the phone and will not look at it. So every single thing this does has
 * to be audible: what it heard, what it is about to save, and what it saved.
 * A silent failure is indistinguishable from success to someone who is not
 * looking, and they will assume their food was logged when it was not.
 *
 * THE FLOW
 * --------
 *   idle       listening for the wake phrase
 *   ready      "Yes?"                      — waiting for the command
 *   confirming "I heard two roti. Log it?" — waiting for yes or no
 *   working    posting
 *   speaking   reading the result back
 *
 * Everything unrecognised is READ BACK BEFORE IT IS SAVED. Logging straight
 * away would be faster, but a misheard sentence writes to the member's day and
 * they would never know — there is no screen showing them what happened.
 *
 * THE HARD PART: IT HEARS ITSELF
 * ------------------------------
 * Speech recognition does not know the difference between the member's voice
 * and the phone's own speaker. Left running while speaking, the app hears its
 * own confirmation prompt, treats it as a command, and talks to itself in a
 * loop — genuinely, not theoretically.
 *
 * So recognition is STOPPED before every utterance and restarted only after
 * the utterance ends, with a short guard delay for the speaker to settle.
 * Every state change goes through `say()` for that reason; nothing should
 * call speechSynthesis directly.
 *
 * WHAT THIS IS NOT
 * ----------------
 * This works while the app is OPEN and the screen is on. Browsers suspend
 * microphone capture when a tab is backgrounded or the phone locks. Logging
 * from a locked phone is the Shortcut path, not this one.
 */

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

/** Recognition restart is delayed so the speaker has stopped ringing. */
const SPEAKER_SETTLE_MS = 350;

/** How long to wait for a command or a yes/no before giving up, out loud. */
const REPLY_TIMEOUT_MS = 12000;

const WAKE_PHRASES = ['hey fitlife', 'hey fit life', 'ok fitlife', 'ok fit life', 'hello fitlife'];

// Hinglish matters here: a member saying "haan" must not be treated as a no,
// and "nahi" must never be read as agreement.
const YES = ['yes', 'yeah', 'yep', 'correct', 'right', 'ok', 'okay', 'sure', 'haan', 'ha', 'theek', 'thik', 'save it', 'log it', 'do it'];
const NO  = ['no', 'nope', 'nahi', 'na', 'cancel', 'stop', 'forget it', 'wrong'];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Whole-word match. "ha" inside "chalo" must not read as yes. */
function saidOneOf(text, list) {
  const words = norm(text).split(' ');
  return list.some(p => p.includes(' ') ? norm(text).includes(p) : words.includes(p));
}

function heardWake(text) {
  const t = norm(text);
  return WAKE_PHRASES.some(p => t.includes(p));
}

/** The words after the wake phrase, when a member says it all in one breath. */
function afterWake(text) {
  const t = norm(text);
  for (const p of WAKE_PHRASES) {
    const at = t.indexOf(p);
    if (at > -1) return t.slice(at + p.length).trim();
  }
  return '';
}

export function useHandsFree({ enabled, onCommand, onLog }) {
  const [state, setState]     = useState('off');
  const [heard, setHeard]     = useState('');
  const [error, setError]     = useState(null);

  const recogRef   = useRef(null);
  const stateRef   = useRef('off');
  const pendingRef = useRef(null);      // the sentence awaiting yes/no
  const timerRef   = useRef(null);
  const speakingRef = useRef(false);
  const cbRef      = useRef({ onCommand, onLog });
  cbRef.current    = { onCommand, onLog };

  const setPhase = (s) => { stateRef.current = s; setState(s); };

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const stopRecognition = useCallback(() => {
    try { recogRef.current?.stop(); } catch (_) { /* not running */ }
  }, []);

  const startRecognition = useCallback(() => {
    if (!recogRef.current || speakingRef.current) return;
    try { recogRef.current.start(); } catch (_) { /* already running */ }
  }, []);

  /**
   * Speak, with recognition held down for the duration.
   *
   * `onEnd` runs after the speaker has settled, which is where the next phase
   * begins. Doing it on `onend` alone was not enough — the tail of the
   * utterance was still being picked up.
   */
  const say = useCallback((text, onEnd) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!synth) { onEnd?.(); return; }

    speakingRef.current = true;
    stopRecognition();
    try { synth.cancel(); } catch (_) {}

    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-IN';
    u.rate = 1.0;

    const finish = () => {
      setTimeout(() => {
        speakingRef.current = false;
        onEnd?.();
      }, SPEAKER_SETTLE_MS);
    };
    u.onend   = finish;
    // Some engines never fire onend if the utterance is interrupted. Without
    // this the whole dialogue stalls silently, which for a member who cannot
    // see the screen is the worst possible failure.
    u.onerror = finish;

    try { synth.speak(u); } catch (_) { finish(); }
  }, [stopRecognition]);

  /** Back to waiting for the wake phrase, listening again. */
  const toIdle = useCallback(() => {
    clearTimer();
    pendingRef.current = null;
    setPhase('idle');
    startRecognition();
  }, [startRecognition]);

  /** Nothing said in time. Say so — silence would look like it was working. */
  const armTimeout = useCallback((message) => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      say(message, toIdle);
    }, REPLY_TIMEOUT_MS);
  }, [say, toIdle]);

  const askToConfirm = useCallback((sentence) => {
    pendingRef.current = sentence;
    setPhase('confirming');
    // Reading it back is the only way the member can catch a mishearing.
    say(`I heard: ${sentence}. Should I log that?`, () => {
      startRecognition();
      armTimeout("I didn't hear you, so I haven't logged anything.");
    });
  }, [say, startRecognition, armTimeout]);

  const submit = useCallback(async (sentence) => {
    clearTimer();
    setPhase('working');
    try {
      const reply = await cbRef.current.onLog(sentence);
      say(reply || 'Logged.', toIdle);
    } catch (_) {
      say('That did not save. Please try again.', toIdle);
    }
  }, [say, toIdle]);

  const handleFinal = useCallback((text) => {
    if (!text || speakingRef.current) return;
    const phase = stateRef.current;
    setHeard(text);

    if (phase === 'idle') {
      if (!heardWake(text)) return;
      const rest = afterWake(text);
      // "Hey FitLife, two roti and dal" in one breath skips the prompt.
      if (rest.length > 2) { askToConfirm(rest); return; }
      setPhase('ready');
      say('Yes?', () => {
        startRecognition();
        armTimeout('Still here when you need me.');
      });
      return;
    }

    if (phase === 'ready') {
      clearTimer();
      const handled = cbRef.current.onCommand?.(norm(text));
      if (handled) {
        // A navigation command. Say what happened — the member cannot see it.
        say(handled, toIdle);
      } else {
        askToConfirm(text.trim());
      }
      return;
    }

    if (phase === 'confirming') {
      clearTimer();
      if (saidOneOf(text, YES))      { submit(pendingRef.current); return; }
      if (saidOneOf(text, NO))       { say('Okay, nothing logged.', toIdle); return; }
      // Neither. Do NOT guess — treat the new sentence as a correction and
      // read that back instead. Guessing here writes the wrong thing to
      // someone who cannot see what was written.
      askToConfirm(text.trim());
      return;
    }
  }, [askToConfirm, say, startRecognition, armTimeout, submit, toIdle]);

  useEffect(() => {
    if (!enabled) {
      stopRecognition(); clearTimer();
      try { window.speechSynthesis?.cancel(); } catch (_) {}
      recogRef.current = null;
      setPhase('off');
      return undefined;
    }
    if (!SR) { setError('This browser cannot listen for voice commands.'); setPhase('off'); return undefined; }

    const r = new SR();
    r.lang = 'en-IN';
    r.continuous = true;
    r.interimResults = false;   // only settled text; interim churns the state machine

    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) handleFinal(e.results[i][0].transcript);
      }
    };
    r.onerror = (e) => {
      // 'no-speech' fires constantly in continuous mode and is not a fault.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Microphone permission is needed for hands-free.');
        setPhase('off');
      }
    };
    // Chrome ends recognition on its own every so often. Restart, unless we
    // are mid-utterance — restarting then is how it starts hearing itself.
    r.onend = () => {
      if (stateRef.current !== 'off' && !speakingRef.current) {
        try { r.start(); } catch (_) {}
      }
    };

    recogRef.current = r;
    setPhase('idle');
    try { r.start(); } catch (_) {}

    return () => {
      try { r.stop(); } catch (_) {}
      clearTimer();
      try { window.speechSynthesis?.cancel(); } catch (_) {}
      recogRef.current = null;
    };
  }, [enabled, handleFinal, stopRecognition]);

  return { state, heard, error, supported: !!SR };
}

export const __test = { norm, saidOneOf, heardWake, afterWake, YES, NO, WAKE_PHRASES };
