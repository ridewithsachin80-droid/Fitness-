import { useEffect, useState } from 'react';
import { Sheet, Pressable, Icon } from '../primitives';
import api from '../../api/client';
import { haptic } from '../../store/settingsStore';
import useRecorder, { blobToBase64 } from '../voicepilot/useRecorder';

/**
 * VoiceCalibrationSheet — Fixes-2x. A volunteer records their planned slots: the quiet set,
 * the set with everyday noise, then a few recordings with no speech at all.
 *
 * What was heard is NOT shown: recording a line again is for a recording problem (cut off,
 * the wrong line, interrupted), never for "it got me wrong", so it asks for that reason and
 * keeps the earlier take.
 */
const PHONE = { android_budget: 'Android, about ₹12,000 or less', android_mid: 'Android, above ₹12,000', iphone: 'iPhone' };
const BROWSER = { chrome: 'Chrome', safari: 'Safari', samsung: 'Samsung Internet', other: 'Other' };
const REASON = { cut_off: 'It got cut off', wrong_line: 'I said the wrong line', interrupted: 'Something interrupted me', other: 'Something else', replacement: 'My coach asked me to record it again' };
const OS = { android: 'Android', ios: 'iOS (iPhone)', other: 'Other', unknown: "I don't know" };
/** Fixes-2y: a first guess at the phone from the browser itself; the volunteer checks and corrects it. */
function guessDevice() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const iphone = /iPhone|iPad/.test(ua), android = /Android/.test(ua);
  const model = android ? (ua.match(/Android [^;)]*;\s*([^;)]+?)(?:\s+Build\/|\))/)?.[1] || '') : iphone ? 'iPhone' : '';
  const osv = android ? (ua.match(/Android (\d+(?:\.\d+)?)/)?.[1] || '') : iphone ? (ua.match(/OS (\d+[_.]\d+)/)?.[1] || '').replace('_', '.') : '';
  const bv = ua.match(/SamsungBrowser\/(\d+(?:\.\d+)?)/)?.[1] || ua.match(/(?:Chrome|CriOS)\/(\d+)/)?.[1] || ua.match(/Version\/(\d+(?:\.\d+)?)/)?.[1] || '';
  return { make: iphone ? 'Apple' : '', model: model === 'K' ? '' : model, os: iphone ? 'ios' : android ? 'android' : 'unknown', os_version: osv, browser_version: bv };
}
const GROUPS = [['q', 'Quiet room', 'A closed room, fan off. Hold the phone as you normally would.'],
  ['n', 'Everyday noise', 'Fan on full, plus kitchen, TV or road noise, as at home. Not louder than usual.'],
  ['x', 'No speech', 'Nobody speaks to the phone in these. Six seconds each.']];

function SlotRecorder({ slot, reasons, onSaved }) {
  const r = useRecorder({ maxMs: slot.kind === 'control' ? 8000 : 15000 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [reason, setReason] = useState(slot.replacement_requested ? 'replacement' : '');
  const [note, setNote] = useState('');
  const again = slot.takes > 0;
  const send = async () => {
    if (!r.take) return;
    if (again && !reason) { setMsg('Say why you are recording it again.'); return; }
    setBusy(true); setMsg('');
    try {
      const audio = await blobToBase64(r.take.blob);
      await api.post('/voice-calibration/take', { slot: slot.slot, audio, mimeType: r.take.type, duration_ms: r.take.ms, ...(again ? { retake_reason: reason, retake_note: note || undefined } : {}) }, { timeout: 90000 });
      haptic(30); r.reset(); onSaved(slot.slot);
    } catch (e) { setMsg(e.response?.data?.error || 'Could not send it. Check your connection and try again.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-2 space-y-2" data-testid={`vc-rec-${slot.slot}`}>
      {again && (
        <div className="space-y-1.5" data-testid="vc-reason">
          <p className="text-caption text-mid">Already recorded. The first recording is kept either way. Why record it again?</p>
          <select value={reason} onChange={e => setReason(e.target.value)} aria-label="Why record it again" style={{ minHeight: 40 }}
            className="w-full rounded-xl bg-charcoal border border-white/[0.12] text-caption text-white px-2">
            <option value="">Choose a reason…</option>
            {(reasons || Object.keys(REASON)).filter(k => k !== 'replacement' || slot.replacement_requested).map(k => <option key={k} value={k}>{REASON[k] || k}</option>)}
          </select>
          {reason === 'other' && <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="What happened?" aria-label="What happened"
            className="w-full rounded-xl bg-charcoal border border-white/[0.12] text-caption text-white px-2" style={{ minHeight: 40 }} />}
        </div>
      )}
      {r.state === 'unsupported' && <p className="text-caption text-red-300">This phone's browser cannot record. Try Chrome on Android or Safari on iPhone.</p>}
      {r.state === 'denied' && <p className="text-caption text-red-300">The microphone is blocked. Allow it for this site in your browser settings, then try again.</p>}
      {r.state !== 'done' && (
        <Pressable variant={r.state === 'recording' ? 'primary' : 'secondary'} className="w-full" data-testid="vc-record"
          onPress={() => { haptic(10); r.state === 'recording' ? r.stop() : r.start(); }}>
          <Icon name="mic" size={16} className="inline-block mr-1.5 -mt-0.5" />
          {r.state === 'recording' ? 'Stop' : again ? 'Record again' : 'Record'}
        </Pressable>
      )}
      {r.state === 'done' && r.take && (
        <>
          <audio controls src={r.take.url} className="w-full" data-testid="vc-playback" />
          <div className="grid grid-cols-2 gap-2">
            <Pressable variant="secondary" disabled={busy} onPress={r.reset}>Discard</Pressable>
            <Pressable variant="primary" disabled={busy} onPress={send} data-testid="vc-send">{busy ? 'Sending…' : 'Send'}</Pressable>
          </div>
        </>
      )}
      {msg && <p className="text-caption text-red-300">{msg}</p>}
    </div>
  );
}

export default function VoiceCalibrationSheet({ open, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [openSlot, setOpenSlot] = useState(null);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState('');
  const [browser, setBrowser] = useState('');
  const [installed, setInstalled] = useState(false);
  const [device, setDevice] = useState(guessDevice);
  const load = () => api.get('/voice-calibration/me').then(({ data }) => setData(data)).catch(() => setError('Could not load the voice test.'));
  useEffect(() => { if (open) { setError(''); load(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const consent = async () => {
    if (!phone || !browser) { setError('Choose your phone and browser first.'); return; }
    if (['make', 'model', 'os_version', 'browser_version'].some(k => !String(device[k] || '').trim())) { setError('Fill in your phone\'s details, or tap "I don\'t know" for any you are not sure of.'); return; }
    try { await api.post('/voice-calibration/consent', { phone_type: phone, browser, installed_app: installed, device }); haptic(20); setError(''); load(); onChanged?.(); }
    catch (e) { setError(e.response?.data?.error || 'Could not save that. Try again.'); }
  };
  const withdraw = async () => {
    if (!window.confirm('Stop the voice test and delete all your recordings now?')) return;
    try { await api.post('/voice-calibration/withdraw'); onChanged?.(); onClose(); } catch (e) { setError(e.response?.data?.error || 'Could not delete just now. Try again.'); }
  };
  const saved = (slot) => { setData(d => ({ ...d, slots: d.slots.map(s => s.slot === slot ? { ...s, takes: s.takes + 1 } : s) })); setOpenSlot(null); onChanged?.(); };

  const slots = data?.slots || [];
  const done = slots.filter(s => s.takes > 0).length;
  const groupOf = (s) => (s.kind === 'control' ? 'x' : s.place);
  return (
    <Sheet open={open} onClose={onClose} eyebrow="Voice test" title={data?.consented ? `${done} of ${slots.length} recorded` : 'Help tune voice logging'}>
      {error && <p className="text-caption text-red-300 mb-2">{error}</p>}
      {!data ? <p className="text-sm text-mid">Loading…</p> : !data.invited ? <p className="text-sm text-mid">You are not part of the voice test.</p> : !data.consented ? (
        <div className="space-y-3" data-testid="vc-consent">
          <p className="text-sm text-white leading-relaxed">Your coach is checking how well FitLife's voice logging hears people on real phones. You record {slots.length} short clips, about 30 minutes in all: {data.group === 'kn' ? 'English and Kannada lines' : data.group === 'hi' ? 'English and Hindi lines' : 'English lines'} to read, each once in a quiet room and once with everyday noise, plus 6 clips of six seconds with no speech at all.</p>
          <ul className="text-caption text-mid space-y-1.5 leading-relaxed">
            <li>Each recording is checked for speech by FitLife and turned into text by two speech services (Google Gemini and Whisper on Groq), the same way voice logging does it.</li>
            <li>Your coach, authorised FitLife administrators and a fluent listener they choose can listen to the recordings to note what was actually said, and read what was heard. Your phone's make, model and software versions, and your browser, are noted. Results are shared for review with a code, never your name. Recordings are stored privately and deleted after 90 days.</li>
            <li>Nothing you record is added to your food log.</li>
            <li>FitLife does not learn or store a model of your voice from this.</li>
            <li>You can stop at any time and delete every recording at once.</li>
          </ul>
          <label className="block text-caption text-mid">Your phone
            <select value={phone} onChange={e => setPhone(e.target.value)} aria-label="Your phone" style={{ minHeight: 44 }} data-testid="vc-phone"
              className="mt-1 w-full rounded-xl bg-charcoal border border-white/[0.12] text-sm text-white px-2">
              <option value="">Choose…</option>{(data.phones || Object.keys(PHONE)).map(k => <option key={k} value={k}>{PHONE[k] || k}</option>)}
            </select>
          </label>
          <label className="block text-caption text-mid">Your browser
            <select value={browser} onChange={e => setBrowser(e.target.value)} aria-label="Your browser" style={{ minHeight: 44 }} data-testid="vc-browser"
              className="mt-1 w-full rounded-xl bg-charcoal border border-white/[0.12] text-sm text-white px-2">
              <option value="">Choose…</option>{(data.browsers || Object.keys(BROWSER)).map(k => <option key={k} value={k}>{BROWSER[k] || k}</option>)}
            </select>
          </label>
          <fieldset className="space-y-1.5" data-testid="vc-device">
            <legend className="text-caption text-mid">Your phone's details (we filled in what your browser tells us; correct anything wrong)</legend>
            {[['make', 'Make', 'e.g. Redmi, Samsung, Apple'], ['model', 'Model', 'e.g. 12C, Galaxy A14'], ['os_version', 'Android or iOS version', 'e.g. 13, 17.5'], ['browser_version', 'Browser version', 'e.g. 129']].map(([k, label, hint]) => (
              <div key={k}>
                <span className="block text-caption text-mid mb-0.5" id={`vc-device-${k}-label`}>{label}</span>
                <div className="flex items-center gap-2">
                  <input value={device[k] || ''} onChange={e => setDevice({ ...device, [k]: e.target.value })} maxLength={40} placeholder={hint} aria-label={label} data-testid={`vc-device-${k}`}
                    className="flex-1 min-w-0 rounded-xl bg-charcoal border border-white/[0.12] text-sm text-white px-2" style={{ minHeight: 44 }} />
                  <button type="button" onClick={() => setDevice({ ...device, [k]: 'unknown' })} aria-pressed={device[k] === 'unknown'} aria-label={`${label}: I don't know`}
                    className={`rounded-xl border text-caption font-semibold px-2 ${device[k] === 'unknown' ? 'border-gold text-gold' : 'border-white/[0.16] text-mid'}`} style={{ minHeight: 44 }}>I don't know</button>
                </div>
              </div>
            ))}
            <label className="block text-caption text-mid">Phone system
              <select value={device.os || 'unknown'} onChange={e => setDevice({ ...device, os: e.target.value })} aria-label="Phone system" style={{ minHeight: 44 }}
                className="mt-0.5 w-full rounded-xl bg-charcoal border border-white/[0.12] text-sm text-white px-2">
                {(data.oses || Object.keys(OS)).map(k => <option key={k} value={k}>{OS[k] || k}</option>)}
              </select>
            </label>
          </fieldset>
          <label className="flex items-center gap-2 text-caption text-mid" style={{ minHeight: 40 }}>
            <input type="checkbox" checked={installed} onChange={e => setInstalled(e.target.checked)} /> I opened FitLife from its icon on my home screen
          </label>
          <Pressable variant="primary" className="w-full" onPress={consent} data-testid="vc-agree">I agree, let's start</Pressable>
          <Pressable variant="secondary" className="w-full" onPress={onClose}>Not now</Pressable>
        </div>
      ) : (
        <div data-testid="vc-slots">
          <p className="text-caption text-mid mb-2">Tap a clip, record it, listen back, and send. Say each line the way you normally speak.</p>
          {GROUPS.map(([g, title, how]) => {
            const mine = slots.filter(s => groupOf(s) === g);
            if (!mine.length) return null;
            return (
              <section key={g} className="mb-3" data-testid={`vc-group-${g}`}>
                <p className="text-sm font-semibold text-white">{title} <span className="text-caption text-lo font-normal">· {mine.filter(s => s.takes).length} of {mine.length}</span></p>
                <p className="text-caption text-mid mb-1.5">{how}</p>
                <ul className="space-y-1.5">
                  {mine.map(s => (
                    <li key={s.slot} className="rounded-2xl bg-charcoal border border-hair px-3 py-2.5">
                      <button type="button" disabled={s.locked} onClick={() => setOpenSlot(openSlot === s.slot ? null : s.slot)} className="w-full text-left flex items-start gap-2" style={{ minHeight: 44 }} data-testid={`vc-slot-${s.slot}`}>
                        <span className={`mt-0.5 w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center ${s.takes ? 'bg-gold text-charcoal' : 'border border-white/[0.2]'}`}>{s.takes > 0 && <Icon name="check" size={12} />}</span>
                        <span className="min-w-0">
                          <span className="block text-sm text-white font-semibold leading-snug">{s.say}</span>
                          <span className="block text-caption text-mid">{s.locked ? 'Locked: waiting for the wording check. Your coach will tell you when it opens.' : s.kind === 'control' ? `${s.means} · ${s.place === 'q' ? 'in the quiet room' : 'with the everyday noise on'}` : s.means}</span>
                          {s.takes > 1 && <span className="block text-caption text-lo">Recorded {s.takes} times (all kept)</span>}
                          {s.replacement_requested && <span className="block text-caption text-gold font-semibold" data-testid="vc-replace-note">Your coach asked you to record this one again</span>}
                        </span>
                      </button>
                      {openSlot === s.slot && !s.locked && <SlotRecorder slot={s} reasons={data.retake_reasons} onSaved={saved} />}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <button type="button" onClick={withdraw} className="mt-2 text-caption text-lo underline" style={{ minHeight: 40 }} data-testid="vc-withdraw">Stop and delete my recordings</button>
        </div>
      )}
    </Sheet>
  );
}
