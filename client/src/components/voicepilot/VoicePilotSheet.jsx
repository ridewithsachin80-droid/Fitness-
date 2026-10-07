import { useEffect, useState } from 'react';
import { Sheet, Pressable, Icon } from '../primitives';
import api from '../../api/client';
import { haptic } from '../../store/settingsStore';
import useRecorder, { blobToBase64 } from './useRecorder';

/**
 * VoicePilotSheet — Phase 8: a member invited to the Kannada voice pilot
 * records the phrases, one at a time. First they read what is recorded and
 * agree; they can stop and delete everything at any time.
 */
function PhraseRecorder({ phrase, onSaved }) {
  const r = useRecorder({ maxMs: 15000 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const send = async () => {
    if (!r.take) return;
    setBusy(true); setMsg('');
    try {
      const audio = await blobToBase64(r.take.blob);
      const { data } = await api.post('/voice-pilot/sample', { phrase_id: phrase.id, audio, mimeType: r.take.type, duration_ms: r.take.ms }, { timeout: 90000 });
      haptic(30); r.reset(); onSaved(phrase.id, data?.heard || null);
    } catch (e) { setMsg(e.response?.data?.error || 'Could not send it. Check your connection and try again.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-2 space-y-2" data-testid={`vp-rec-${phrase.id}`}>
      {r.state === 'unsupported' && <p className="text-caption text-red-300">This phone's browser cannot record. Try Chrome on Android or Safari on iPhone.</p>}
      {r.state === 'denied' && <p className="text-caption text-red-300">The microphone is blocked. Allow it for this site in your browser settings, then try again.</p>}
      {r.state !== 'done' && (
        <Pressable variant={r.state === 'recording' ? 'primary' : 'secondary'} className="w-full" data-testid="vp-record"
          onPress={() => { haptic(10); r.state === 'recording' ? r.stop() : r.start(); }}>
          <Icon name="mic" size={16} className="inline-block mr-1.5 -mt-0.5" />
          {r.state === 'recording' ? 'Stop' : phrase.recorded ? 'Record again' : 'Record'}
        </Pressable>
      )}
      {r.state === 'done' && r.take && (
        <>
          <audio controls src={r.take.url} className="w-full" data-testid="vp-playback" />
          <div className="grid grid-cols-2 gap-2">
            <Pressable variant="secondary" disabled={busy} onPress={r.reset}>Again</Pressable>
            <Pressable variant="primary" disabled={busy} onPress={send} data-testid="vp-send">{busy ? 'Sending…' : 'Send'}</Pressable>
          </div>
        </>
      )}
      {msg && <p className="text-caption text-red-300">{msg}</p>}
    </div>
  );
}

export default function VoicePilotSheet({ open, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.get('/voice-pilot/me').then(({ data }) => setData(data)).catch(() => setError('Could not load the pilot.'));
  useEffect(() => { if (open) { setError(''); load(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const consent = async () => { try { await api.post('/voice-pilot/consent'); haptic(20); load(); } catch (e) { setError('Could not save that. Try again.'); } };
  const withdraw = async () => {
    if (!window.confirm('Stop the voice test and delete all your recordings now?')) return;
    try { await api.post('/voice-pilot/withdraw'); onChanged?.(); onClose(); } catch (e) { setError(e.response?.data?.error || 'Could not delete just now. Try again.'); }
  };
  const saved = (id, heard) => { setData(d => ({ ...d, phrases: d.phrases.map(p => p.id === id ? { ...p, recorded: true, heard } : p) })); setOpenId(null); onChanged?.(); };

  const phrases = data?.phrases || [];
  const done = phrases.filter(p => p.recorded).length;
  return (
    <Sheet open={open} onClose={onClose} eyebrow="Kannada voice test" title={data?.consented ? `${done} of ${phrases.length} recorded` : 'Help us understand Kannada'}>
      {error && <p className="text-caption text-red-300 mb-2">{error}</p>}
      {!data ? <p className="text-sm text-mid">Loading…</p> : !data.invited ? <p className="text-sm text-mid">You are not part of the voice test.</p> : !data.consented ? (
        <div className="space-y-3" data-testid="vp-consent">
          <p className="text-sm text-white leading-relaxed">Your coach is testing how well FitLife understands Kannada mixed with English. You read out {phrases.length} short lines, the way you would log your day.</p>
          <ul className="text-caption text-mid space-y-1.5 leading-relaxed">
            <li>Your voice is recorded and turned into text by two speech services (Google Gemini and Whisper on Groq).</li>
            <li>Only your coach hears the recordings. They are stored privately and deleted after 90 days.</li>
            <li>Nothing you record is added to your food log.</li>
            <li>You can stop at any time and delete every recording at once.</li>
          </ul>
          <Pressable variant="primary" className="w-full" onPress={consent} data-testid="vp-agree">I agree, let's start</Pressable>
          <Pressable variant="secondary" className="w-full" onPress={onClose}>Not now</Pressable>
        </div>
      ) : (
        <div data-testid="vp-phrases">
          <p className="text-caption text-mid mb-2">Tap a line, say it the way you normally speak, and send. Up to 15 seconds each.</p>
          <ul className="space-y-1.5">
            {phrases.map(p => (
              <li key={p.id} className="rounded-2xl bg-charcoal border border-hair px-3 py-2.5">
                <button type="button" onClick={() => setOpenId(openId === p.id ? null : p.id)} className="w-full text-left flex items-start gap-2" style={{ minHeight: 44 }} data-testid={`vp-phrase-${p.id}`}>
                  <span className={`mt-0.5 w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center ${p.recorded ? 'bg-gold text-charcoal' : 'border border-white/[0.2]'}`}>{p.recorded && <Icon name="check" size={12} />}</span>
                  <span className="min-w-0">
                    <span className={`block text-sm ${p.free ? 'text-gold-light' : 'text-white'} font-semibold leading-snug`}>{p.say}</span>
                    <span className="block text-caption text-mid">{p.means}</span>
                    {p.heard && <span className="block text-caption text-lo mt-0.5">Heard: &ldquo;{p.heard}&rdquo;</span>}
                  </span>
                </button>
                {openId === p.id && <PhraseRecorder phrase={p} onSaved={saved} />}
              </li>
            ))}
          </ul>
          <button type="button" onClick={withdraw} className="mt-4 text-caption text-lo underline" style={{ minHeight: 40 }} data-testid="vp-withdraw">Stop and delete my recordings</button>
        </div>
      )}
    </Sheet>
  );
}
