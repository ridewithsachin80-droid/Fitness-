/**
 * useVoiceInput — one voice implementation for the whole app.
 *
 * Why two engines run at once:
 *   Web Speech (on-device) is instant but inaccurate for Indian English and
 *   Hinglish — food words like bhindi, rajma, katori come back mangled, and it
 *   truncates at the first pause. So it is used ONLY as live feedback while the
 *   member speaks. The actual transcript comes from recording the audio and
 *   sending it to Gemini (/ai-chat/voice-transcribe), the same pipeline photo
 *   logging already uses. If Gemini is unreachable, the Web Speech text is kept
 *   as the fallback — worst case equals the old behaviour, never worse.
 *
 * Support matrix:
 *   Chrome/Android:  live preview + Gemini transcript
 *   iOS Safari:      no Web Speech → recording + Gemini transcript (mic finally
 *                    works on iOS, previously the button was hidden)
 *   Neither API:     supported=false → consumers hide the mic button
 *
 * Contract:
 *   const v = useVoiceInput({ lang, onInterim, onFinal });
 *   v.supported / v.listening / v.transcribing / v.error / v.toggle()
 *
 *   onInterim(text) — fires while speaking (live preview, may be wrong)
 *   onFinal(text)   — fires once after stop, with the best transcript available.
 *   Consumers fill their input box from these; sending stays a manual tap.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';

const SR = typeof window !== 'undefined'
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

const hasRecorder = typeof window !== 'undefined'
  && !!(navigator.mediaDevices?.getUserMedia) && !!window.MediaRecorder;

const MAX_SECONDS = 30;   // cost cap; a meal description fits comfortably

// Human messages per Web Speech error code. 'no-speech' is handled at stop()
// instead — in continuous mode it fires on every pause and must not abort.
const SR_ERRORS = {
  'not-allowed':         'Microphone blocked — allow mic access in your browser settings',
  'service-not-allowed': 'Microphone blocked — allow mic access in your browser settings',
  'audio-capture':       'No microphone found on this device',
};

function pickMime() {
  const candidates = [
    'audio/webm;codecs=opus',  // Chrome, Android
    'audio/webm',
    'audio/mp4',               // iOS Safari
    'audio/ogg;codecs=opus',   // Firefox
  ];
  return candidates.find(m => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}

export function useVoiceInput({ lang = 'en-IN', onInterim, onFinal } = {}) {
  const [listening, setListening]       = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError]               = useState(null);

  // Callbacks and lang go through a ref so recognition handlers never close
  // over stale props.
  const optsRef = useRef({});
  optsRef.current = { lang, onInterim, onFinal };

  const recogRef     = useRef(null);
  const recorderRef  = useRef(null);
  const streamRef    = useRef(null);
  const chunksRef    = useRef([]);
  const mimeRef      = useRef('');
  const finalTextRef = useRef('');   // Web Speech accumulated finals (fallback text)
  const listeningRef = useRef(false);
  const stoppingRef  = useRef(false);
  const timerRef     = useRef(null);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const startRecognition = useCallback(() => {
    if (!SR) return;
    const r = new SR();
    recogRef.current = r;
    r.lang = optsRef.current.lang;
    r.continuous = true;        // do not cut off at the first pause
    r.interimResults = true;    // live text while speaking — the box feels alive
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      let finals = '', interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finals += t + ' ';
        else interim += t;
      }
      finalTextRef.current = finals.trim();
      optsRef.current.onInterim?.((finals + interim).trim());
    };
    r.onerror = (e) => {
      const msg = SR_ERRORS[e.error];
      // A hard mic error with no recording running means voice is dead — stop.
      if (msg && !recorderRef.current) { setError(msg); stop(); }
      // Otherwise (no-speech, aborted, network): recording continues; Gemini
      // will transcribe regardless, so the preview quietly going away is fine.
    };
    r.onend = () => {
      // Android Chrome ends recognition spontaneously on silence. While the
      // session is still live, restart so long descriptions are not truncated.
      if (listeningRef.current && !stoppingRef.current) {
        try { r.start(); } catch { /* already restarting */ }
      }
    };
    try { r.start(); } catch { /* concurrent start — ignore */ }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(async () => {
    if (!listeningRef.current) return;
    stoppingRef.current = true;
    listeningRef.current = false;
    setListening(false);
    clearTimeout(timerRef.current);

    try { recogRef.current?.stop(); } catch { /* not started */ }

    const recorder = recorderRef.current;
    const webSpeechText = finalTextRef.current;

    if (recorder && recorder.state !== 'inactive') {
      const stopped = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.stop();
      await stopped;
      releaseStream();

      const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
      chunksRef.current = [];

      // Under ~1KB is a tap-and-release with no speech in it.
      if (blob.size < 1000) {
        if (webSpeechText) optsRef.current.onFinal?.(webSpeechText);
        else setError("Didn't hear anything — tap the mic and start speaking");
        return;
      }

      setTranscribing(true);
      try {
        const base64 = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload  = () => resolve(String(fr.result).split(',')[1]);
          fr.onerror = () => reject(new Error('read failed'));
          fr.readAsDataURL(blob);
        });
        const { data } = await api.post('/ai-chat/voice-transcribe', {
          audio: base64,
          mimeType: mimeRef.current || 'audio/webm',
          langHint: optsRef.current.lang,
        }, { timeout: 30000 });

        const transcript = String(data?.transcript || '').trim();
        if (transcript) optsRef.current.onFinal?.(transcript);
        else if (webSpeechText) optsRef.current.onFinal?.(webSpeechText);
        else setError("Couldn't make out any words — try again a little closer to the mic");
      } catch {
        // Server or network failed — degrade to the on-device text if we have it.
        if (webSpeechText) optsRef.current.onFinal?.(webSpeechText);
        else setError("Couldn't reach the transcription service — check your connection");
      } finally {
        setTranscribing(false);
      }
      return;
    }

    // Web Speech only (no recorder available)
    releaseStream();
    if (webSpeechText) optsRef.current.onFinal?.(webSpeechText);
    else setError("Didn't hear anything — tap the mic and start speaking");
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(async () => {
    if (listeningRef.current) return;
    setError(null);
    finalTextRef.current = '';
    chunksRef.current = [];
    stoppingRef.current = false;

    if (!hasRecorder && !SR) {
      setError('Voice input is not supported in this browser');
      return;
    }

    if (hasRecorder) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mime = pickMime();
        mimeRef.current = mime;
        const rec = mime ? new MediaRecorder(stream, { mimeType: mime })
                         : new MediaRecorder(stream);
        recorderRef.current = rec;
        rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
        rec.start(250);
      } catch (err) {
        recorderRef.current = null;
        releaseStream();
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
          setError('Microphone blocked — allow mic access in your browser settings');
          return;   // permission refused: Web Speech would be blocked too
        }
        if (!SR) {
          setError("Couldn't start the microphone on this device");
          return;
        }
        // Recorder failed for another reason but Web Speech exists — degrade.
      }
    } else {
      recorderRef.current = null;
    }

    startRecognition();
    listeningRef.current = true;
    setListening(true);
    timerRef.current = setTimeout(stop, MAX_SECONDS * 1000);
  }, [startRecognition, stop]);

  const toggle = useCallback(() => {
    listeningRef.current ? stop() : start();
  }, [start, stop]);

  // Unmount: kill everything without firing callbacks.
  useEffect(() => () => {
    stoppingRef.current = true;
    listeningRef.current = false;
    clearTimeout(timerRef.current);
    try { recogRef.current?.abort(); } catch { /* noop */ }
    try { recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  return {
    supported: !!(SR || hasRecorder),
    // Consumers can tell members the transcript improves after they stop:
    hasAccurateEngine: hasRecorder,
    listening, transcribing, error, setError,
    start, stop, toggle,
  };
}

export default useVoiceInput;
