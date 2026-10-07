import { useEffect, useRef, useState } from 'react';

/**
 * A tap-to-start, tap-to-stop recorder for the voice pilot. Stops by itself
 * after `maxMs`. Gives back a Blob, its type and length, and a blob: URL to
 * play the take back before sending. Uses whatever audio type the phone
 * records (webm on Android, mp4 on iPhone).
 */
export default function useRecorder({ maxMs = 15000 } = {}) {
  const [state, setState] = useState('idle');   // idle | recording | done | denied | unsupported
  const [take, setTake] = useState(null);       // { blob, type, ms, url }
  const rec = useRef(null), chunks = useRef([]), started = useRef(0), timer = useRef(null), stream = useRef(null);

  const cleanup = () => { clearTimeout(timer.current); stream.current?.getTracks?.().forEach(t => t.stop()); stream.current = null; };
  useEffect(() => () => { cleanup(); if (take?.url) URL.revokeObjectURL(take.url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (typeof window === 'undefined' || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return; }
    try { stream.current = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (_) { setState('denied'); return; }
    chunks.current = [];
    const r = new window.MediaRecorder(stream.current);
    r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const type = (r.mimeType || chunks.current[0]?.type || 'audio/webm').split(';')[0];
      const blob = new Blob(chunks.current, { type });
      if (take?.url) URL.revokeObjectURL(take.url);
      setTake({ blob, type, ms: Date.now() - started.current, url: URL.createObjectURL(blob) });
      setState('done'); cleanup();
    };
    rec.current = r; started.current = Date.now();
    r.start();
    setState('recording');
    timer.current = setTimeout(() => stop(), maxMs);
  };
  const stop = () => { if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); };
  const reset = () => { if (take?.url) URL.revokeObjectURL(take.url); setTake(null); setState('idle'); };
  return { state, take, start, stop, reset };
}

/** base64 of a Blob, without the data: prefix. */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read the recording'));
    r.readAsDataURL(blob);
  });
}
