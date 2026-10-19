/**
 * Shared one-tap dictation. On-device words are used immediately when present;
 * recorded audio is the fallback. A failed take stays only in bounded memory
 * until Retry, Discard, a new session, or unmount. It is never persisted.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useAuthStore } from '../store/authStore';
import { transcriptionRoute } from '../utils/voiceComposer';
import { normalizeVoiceLang } from '../utils/voiceLanguage';
import { today } from '../constants';

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const hasRecorder = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;
const MAX_SECONDS = 30;
export const MAX_RETAINED_AUDIO_BYTES = 4_000_000;
const SILENCE_MS = 3000;
const VOICE_RMS = 0.035;
const MIC_BLOCKED = 'Microphone blocked — allow microphone access in your browser settings, then try again.';
const SR_ERRORS = {
  'not-allowed': MIC_BLOCKED,
  'service-not-allowed': MIC_BLOCKED,
  'audio-capture': 'No microphone found. Connect one, or type your log.',
};

function authIdentity() {
  const { user, sessionVersion } = useAuthStore.getState();
  return `${sessionVersion}:${user?.role || ''}:${user?.id || ''}`;
}
function pickMime() {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    .find(mime => window.MediaRecorder?.isTypeSupported?.(mime)) || '';
}

export function useVoiceInput({ lang = 'en-IN', onInterim, onFinal, onCancel, contextKey = '', silenceMs = SILENCE_MS } = {}) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [error, setError] = useState(null);
  const optsRef = useRef({});
  optsRef.current = { lang: normalizeVoiceLang(lang), onInterim, onFinal, onCancel, contextKey: String(contextKey), silenceMs };
  const mountedRef = useRef(true);
  const captureId = useRef(0);
  const sessionRef = useRef(null);
  const startingRef = useRef(false);
  const listeningRef = useRef(false);
  const processingRef = useRef(false);
  const stoppingRef = useRef(false);
  const recogRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const chunkBytesRef = useRef(0);
  const oversizedRef = useRef(false);
  const finalTextRef = useRef('');
  const failedTakeRef = useRef(null);
  const requestRef = useRef(null);
  const readerRef = useRef(null);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const silenceIvRef = useRef(null);
  const heardRef = useRef(false);
  const lastVoiceRef = useRef(0);
  const stopRef = useRef(null);

  const current = session => mountedRef.current && session?.id === captureId.current && session.auth === authIdentity() && session.day === today() && session.context === optsRef.current.contextKey;
  const releaseStream = (stream = streamRef.current) => {
    stream?.getTracks().forEach(track => track.stop());
    if (streamRef.current === stream) streamRef.current = null;
  };
  const stopSilenceWatch = () => {
    clearInterval(silenceIvRef.current);
    silenceIvRef.current = null;
    try { audioCtxRef.current?.close()?.catch?.(() => {}); } catch { /* already closed */ }
    audioCtxRef.current = null;
  };
  const clearTake = () => { failedTakeRef.current = null; if (mountedRef.current) setCanRetry(false); };

  const cancel = useCallback(() => {
    captureId.current++;
    sessionRef.current = null;
    startingRef.current = false;
    listeningRef.current = false;
    processingRef.current = false;
    stoppingRef.current = true;
    clearTimeout(timerRef.current);
    stopSilenceWatch();
    requestRef.current?.abort();
    requestRef.current = null;
    try { readerRef.current?.abort(); } catch { /* already read */ }
    readerRef.current = null;
    const recognition = recogRef.current;
    recogRef.current = null;
    if (recognition) {
      recognition.onresult = recognition.onerror = recognition.onend = null;
      try { recognition.abort(); } catch { /* inactive */ }
    }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = recorder.onerror = null;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* inactive */ }
    }
    chunksRef.current = [];
    chunkBytesRef.current = 0;
    finalTextRef.current = '';
    clearTake();
    releaseStream();
    if (mountedRef.current) {
      setListening(false); setRequesting(false); setTranscribing(false); setError(null);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidateChangedContext = session => {
    if (mountedRef.current && session?.id === captureId.current && !current(session)) {
      cancel(); optsRef.current.onCancel?.();
    }
  };

  const transcribe = useCallback(async (take, session) => {
    if (!current(session)) { invalidateChangedContext(session); return; }
    processingRef.current = true;
    setTranscribing(true);
    setError(null);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        readerRef.current = reader;
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reader.onabort = () => reject(new Error('Recording read interrupted'));
        reader.readAsDataURL(take.blob);
      });
      if (!current(session) || controller.signal.aborted) { invalidateChangedContext(session); return; }
      const { data } = await api.post('/ai-chat/voice-transcribe', {
        audio: base64, mimeType: take.blob.type || 'audio/webm', langHint: take.lang,
      }, { timeout: 30000, signal: controller.signal });
      if (!current(session) || controller.signal.aborted) { invalidateChangedContext(session); return; }
      const transcript = String(data?.transcript || '').trim();
      if (!transcript) {
        failedTakeRef.current = take;
        setCanRetry(true);
        // Fixes-2n (B18): the server refuses a fallback answer in another language
        // or script, or one the engine itself was unsure of. Nothing is sent on;
        // the take is kept for Retry.
        setError(data?.rejected === 'wrong_script' || data?.rejected === 'wrong_language'
          ? "That came back in a different language from the one you chose. Retry this recording, check your voice language, or type your log."
          : "Couldn't make out the words. Retry this recording, or discard it and speak closer to the microphone.");
      } else {
        clearTake();
        optsRef.current.onFinal?.(transcript);
      }
    } catch (err) {
      if (!current(session) || controller.signal.aborted) { invalidateChangedContext(session); return; }
      failedTakeRef.current = take;
      setCanRetry(true);
      setError(err?.response?.status === 429
        ? 'Voice is busy. Wait a moment, then retry this recording. Your words are kept here.'
        : "Couldn't finish that recording. Check your connection, then retry. Your words are kept here.");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; readerRef.current = null; }
      if (current(session)) { processingRef.current = false; setTranscribing(false); }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(async () => {
    if (!listeningRef.current) return;
    const session = sessionRef.current;
    stoppingRef.current = true;
    listeningRef.current = false;
    processingRef.current = true; // also locks the short recorder/recognition flush
    setListening(false);
    setTranscribing(true);
    clearTimeout(timerRef.current);
    stopSilenceWatch();
    const recognition = recogRef.current;
    const recorder = recorderRef.current;
    const stream = streamRef.current;
    // Stop audio tracks promptly; transcription never needs an open microphone.
    const audioStopped = new Promise(resolve => {
      if (!recorder || recorder.state === 'inactive') { releaseStream(stream); resolve(); return; }
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); releaseStream(stream); resolve(); } };
      const timer = setTimeout(finish, 1000);
      recorder.onstop = finish;
      try { recorder.stop(); } catch { finish(); }
    });
    const recognitionStopped = new Promise(resolve => {
      if (!recognition) { resolve(); return; }
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(finish, 400);
      try { recognition.addEventListener('end', finish, { once: true }); } catch { /* older browser */ }
      try { recognition.stop(); } catch { finish(); }
    });
    await Promise.all([audioStopped, recognitionStopped]);
    if (!current(session)) { invalidateChangedContext(session); return; }
    if (recognition) recognition.onresult = recognition.onerror = recognition.onend = null;
    if (recorder) recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
    recorderRef.current = null;
    recogRef.current = null;
    const text = finalTextRef.current;
    if (transcriptionRoute({ webSpeechText: text }).source === 'on-device') {
      chunksRef.current = [];
      processingRef.current = false;
      setTranscribing(false);
      optsRef.current.onFinal?.(text);
      return;
    }
    const blob = new Blob(chunksRef.current, { type: recorder?.mimeType || session.mime || 'audio/webm' });
    chunksRef.current = [];
    chunkBytesRef.current = 0;
    if (oversizedRef.current || blob.size > MAX_RETAINED_AUDIO_BYTES) {
      processingRef.current = false; setTranscribing(false);
      setError('That recording is too large. Try a shorter voice note, or type your log.');
    } else if (transcriptionRoute({ webSpeechText: text, blobBytes: blob.size }).source === 'none') {
      processingRef.current = false; setTranscribing(false);
      setError("Didn't hear anything. Tap the microphone and start speaking, or type your log.");
    } else {
      await transcribe({ blob, lang: session.lang, auth: session.auth, day: session.day, context: session.context }, session);
    }
  }, [transcribe]); // eslint-disable-line react-hooks/exhaustive-deps
  stopRef.current = stop;

  const start = useCallback(async () => {
    if (startingRef.current || listeningRef.current || processingRef.current || failedTakeRef.current) return false;
    if (!hasRecorder && !SR) { setError('Voice is unavailable in this browser. You can type your log instead.'); return false; }
    const session = { id: ++captureId.current, auth: authIdentity(), lang: optsRef.current.lang, mime: '', day: today(), context: optsRef.current.contextKey };
    sessionRef.current = session;
    startingRef.current = true;
    stoppingRef.current = false;
    chunksRef.current = [];
    chunkBytesRef.current = 0;
    oversizedRef.current = false;
    finalTextRef.current = '';
    setError(null); setRequesting(true);
    if (hasRecorder) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
          noiseSuppression: true, echoCancellation: true, autoGainControl: true, channelCount: 1,
        } });
        if (!current(session)) { stream.getTracks().forEach(track => track.stop()); invalidateChangedContext(session); return false; }
        streamRef.current = stream;
        session.mime = pickMime();
        const recorder = session.mime ? new MediaRecorder(stream, { mimeType: session.mime }) : new MediaRecorder(stream);
        recorderRef.current = recorder;
        recorder.ondataavailable = event => {
          if (!current(session) || !event.data?.size || oversizedRef.current) return;
          if (chunkBytesRef.current + event.data.size > MAX_RETAINED_AUDIO_BYTES) {
            oversizedRef.current = true; chunksRef.current = []; chunkBytesRef.current = 0;
            stopRef.current?.(); return;
          }
          chunkBytesRef.current += event.data.size;
          chunksRef.current.push(event.data);
        };
        recorder.onerror = () => { if (current(session)) stopRef.current?.(); };
        recorder.start(250);
      } catch (err) {
        if (!current(session)) { invalidateChangedContext(session); return false; }
        recorderRef.current = null;
        releaseStream();
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError' || !SR) {
          startingRef.current = false; setRequesting(false);
          setError(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? MIC_BLOCKED
            : err?.name === 'NotFoundError' ? SR_ERRORS['audio-capture'] : "Couldn't open the microphone. Check it is connected and not being used by another app, or type your log.");
          return false;
        }
      }
    }
    if (!current(session)) { invalidateChangedContext(session); return false; }
    startingRef.current = false;
    listeningRef.current = true;
    setRequesting(false); setListening(true);
    heardRef.current = false;
    lastVoiceRef.current = Date.now();
    if (SR) {
      const recognition = new SR();
      recogRef.current = recognition;
      recognition.lang = session.lang; // preference changes apply to the NEXT take
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      let precedingFinals = '';
      recognition.onresult = event => {
        if (!current(session)) { invalidateChangedContext(session); return; }
        let finals = '', interim = '';
        for (let i = 0; i < event.results.length; i++) {
          const words = event.results[i][0].transcript;
          if (event.results[i].isFinal) finals += `${words} `; else interim += words;
        }
        finalTextRef.current = `${precedingFinals} ${finals}`.trim();
        heardRef.current = true; lastVoiceRef.current = Date.now();
        optsRef.current.onInterim?.(`${precedingFinals} ${finals}${interim}`.trim());
      };
      recognition.onerror = event => {
        if (current(session) && SR_ERRORS[event.error] && !recorderRef.current) {
          cancel(); setError(SR_ERRORS[event.error]);
        }
      };
      recognition.onend = () => {
        if (current(session) && listeningRef.current && !stoppingRef.current) {
          precedingFinals = finalTextRef.current;
          try { recognition.start(); } catch { /* already restarting */ }
        }
      };
      try { recognition.start(); } catch {
        if (!recorderRef.current) { cancel(); setError("Couldn't start voice input. Try again, or type your log."); return false; }
      }
    }
    let analyser = null, samples = null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && streamRef.current) {
      try {
        const ctx = new AC(); audioCtxRef.current = ctx;
        ctx.resume?.().catch(() => {});
        const source = ctx.createMediaStreamSource(streamRef.current);
        analyser = ctx.createAnalyser(); analyser.fftSize = 512; source.connect(analyser);
        samples = new Uint8Array(analyser.fftSize);
      } catch { analyser = null; }
    }
    silenceIvRef.current = setInterval(() => {
      if (!current(session)) { invalidateChangedContext(session); return; }
      if (analyser) {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) { const amplitude = (sample - 128) / 128; sum += amplitude * amplitude; }
        if (Math.sqrt(sum / samples.length) > VOICE_RMS) { heardRef.current = true; lastVoiceRef.current = Date.now(); }
      }
      if (heardRef.current && Date.now() - lastVoiceRef.current > optsRef.current.silenceMs) stopRef.current?.();
    }, 200);
    timerRef.current = setTimeout(() => stopRef.current?.(), MAX_SECONDS * 1000);
    return true;
  }, [cancel]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    const take = failedTakeRef.current;
    if (!take || processingRef.current || startingRef.current || listeningRef.current) return false;
    if (take.auth !== authIdentity() || take.day !== today() || take.context !== optsRef.current.contextKey) { cancel(); optsRef.current.onCancel?.(); return false; }
    const session = { id: ++captureId.current, auth: take.auth, lang: take.lang, day: take.day, context: take.context };
    sessionRef.current = session;
    transcribe(take, session);
    return true;
  }, [cancel, transcribe]);
  const discardTake = useCallback(() => { cancel(); }, [cancel]);
  const toggle = useCallback(() => { listeningRef.current ? stop() : start(); }, [start, stop]);

  // A retained take cannot be retried into a different day, even if this screen
  // stays open through midnight without another render or request.
  useEffect(() => {
    if (!listening && !requesting && !transcribing && !canRetry) return;
    const timer = setInterval(() => invalidateChangedContext(sessionRef.current), 1000);
    return () => clearInterval(timer);
  }, [listening, requesting, transcribing, canRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sessionRef.current && sessionRef.current.context !== String(contextKey)) {
      cancel(); optsRef.current.onCancel?.();
    }
  }, [contextKey, cancel]);

  useEffect(() => {
    mountedRef.current = true;
    let identity = authIdentity();
    const unsubscribe = useAuthStore.subscribe(() => {
      const next = authIdentity();
      if (next !== identity) { identity = next; cancel(); optsRef.current.onCancel?.(); }
    });
    return () => { unsubscribe(); mountedRef.current = false; cancel(); };
  }, [cancel]);

  return {
    supported: !!(SR || hasRecorder), hasAccurateEngine: hasRecorder,
    listening, requesting, transcribing, canRetry, error, setError,
    start, stop, toggle, cancel, retry, discardTake,
  };
}
export default useVoiceInput;
