import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Eyebrow } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { shareOrDownload } from '../../utils/shareFile';

/**
 * VoiceFallbackTestPanel — Fixes-2p (B18), admin dashboard, TEST SERVER ONLY.
 *
 * Whisper writes down a member's voice note only when Gemini fails, and a real
 * Gemini failure can't be produced on demand without changing the shared
 * provider settings. Here an administrator names ONE test account: for 24 hours
 * its voice notes skip Gemini and go to the real Whisper backup. The rest is the
 * normal app (language check, Retry, preview, Apply). Each try is recorded with
 * what Whisper actually returned. On the live server the switch does not work
 * and this card says so in one line.
 */
const REASON = {
  unsure: "Whisper wasn't sure of part of it",
  no_speech: 'it sounded like no speech',
  repetitive: 'Whisper repeated itself',
  wrong_script: 'it came back in a different script',
  wrong_language: 'it came back in a different language',
  empty: 'nothing was heard',
};
const LANG = { 'en-IN': 'English', 'hi-IN': 'Hindi', 'kn-IN': 'Kannada' };
const when = (t) => { try { return new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

export default function VoiceFallbackTestPanel() {
  const [st, setSt] = useState(null);
  const [all, setAll] = useState([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.get('/voice-fallback-test').then(({ data }) => setSt(data)).catch(() => setSt(null));
  useEffect(() => {
    load();
    api.get('/admin/members').then(({ data }) => setAll(Array.isArray(data) ? data : data?.members || [])).catch(() => setAll([]));
  }, []);
  if (!st) return null;
  if (!st.available) {
    return (
      <div className="rounded-2xl border border-hair bg-surface px-4 py-3 mt-3" data-testid="vft-panel">
        <Eyebrow>Voice backup test</Eyebrow>
        <p className="text-caption text-lo leading-snug mt-1" data-testid="vft-off">Off on this server. {st.message}</p>
      </div>
    );
  }
  const act = async (fn, after) => {
    haptic(10); setBusy(true); setMsg('');
    try { await fn(); await load(); if (after) after(); }
    catch (e) { setMsg(e.response?.data?.error || 'Could not do that just now. Try again.'); }
    setBusy(false);
  };
  const turnOn = () => act(() => api.put('/voice-fallback-test', { user_id: Number(pick) }), () => setPick(''));
  const turnOff = () => act(() => api.delete('/voice-fallback-test'));
  const clear = () => { if (window.confirm('Delete every recorded try?')) act(() => api.delete('/voice-fallback-test/runs')); };
  const download = async () => {
    haptic(10); setMsg('');
    try { await shareOrDownload('/voice-fallback-test/runs.xlsx', { filename: 'FitLife-Voice-Fallback-Test.xlsx', title: 'FitLife voice backup test', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }
    catch (e) { setMsg('Could not make the file just now. Try again.'); }
  };
  const runs = st.runs || [];
  return (
    <div className="rounded-2xl border border-hair bg-surface px-4 py-3 mt-3 space-y-3" data-testid="vft-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <Eyebrow>Voice backup test</Eyebrow>
        <span className="text-caption text-lo">test server only</span>
      </div>
      <p className="text-caption text-mid leading-snug" data-testid="vft-explain">Pick one <b className="text-white">test account</b>. For {st.hours || 24} hours its voice notes skip Gemini and go straight to Whisper, the backup speech engine, so you can try the backup for real. Everything after that is the normal app: the language check, Retry, the preview and Apply. No one else is affected. Don't pick a real member.</p>
      {st.account ? (
        <div className="flex items-center gap-2" data-testid="vft-on">
          <p className="flex-1 min-w-0 text-caption text-white leading-snug">On for <b>{st.account.name}</b> until {when(st.account.ends_at)}</p>
          <button type="button" onClick={turnOff} disabled={busy} style={{ minHeight: 40 }} data-testid="vft-turn-off"
            className="rounded-xl border border-white/[0.16] text-white text-caption font-semibold px-3 disabled:opacity-50">Turn off</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <select value={pick} onChange={e => setPick(e.target.value)} aria-label="Test account" style={{ minHeight: 40 }} data-testid="vft-pick"
            className="flex-1 min-w-0 rounded-xl bg-charcoal border border-white/[0.12] text-caption text-white px-2">
            <option value="">Choose the test account…</option>
            {all.filter(m => m.active !== false).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button type="button" onClick={turnOn} disabled={!pick || busy} style={{ minHeight: 40 }} data-testid="vft-turn-on"
            className="rounded-xl border border-gold text-gold text-caption font-bold px-3 disabled:opacity-40">Turn on</button>
        </div>
      )}
      {msg && <p className="text-caption text-red-300">{msg}</p>}
      <div className="space-y-2" data-testid="vft-runs">
        <p className="text-caption text-lo font-semibold">{runs.length ? `Tries recorded (${runs.length}${runs.length >= 50 ? ', newest 50 shown' : ''})` : 'No tries recorded yet. Turn it on, then record a voice note on the test account.'}</p>
        {runs.map(r => (
          <div key={r.id} className="text-caption leading-snug border-t border-hair pt-2" data-testid="vft-run">
            <p className="text-mid">{when(r.created_at)} · {r.name} · voice language {LANG[r.lang_hint] || r.lang_hint || '—'} · Whisper told: {r.language_sent || 'not set'}</p>
            <p className="text-white">{r.accepted === true ? <>Accepted: “{r.transcript}”</>
              : r.accepted === false ? <>Refused: {REASON[r.reason] || r.reason}. The member saw Retry / type.</>
              : <>No answer: {r.error || 'Whisper did not reply'}.</>}</p>
            {r.accepted !== true && r.whisper_text && <p className="text-mid">Whisper heard: “{r.whisper_text}”</p>}
            <p className="text-lo">Language Whisper reported: {r.whisper_language || '—'} · {(r.segments || []).length} {(r.segments || []).length === 1 ? 'section' : 'sections'} (numbers in the Excel file)</p>
          </div>
        ))}
      </div>
      {runs.length > 0 && (
        <div className="flex gap-2">
          <button type="button" onClick={download} style={{ minHeight: 44 }} data-testid="vft-download"
            className="flex-1 rounded-xl border border-gold text-gold text-sm font-bold">Download tries (Excel)</button>
          <button type="button" onClick={clear} disabled={busy} style={{ minHeight: 44 }} data-testid="vft-clear"
            className="rounded-xl border border-white/[0.16] text-mid text-caption font-semibold px-3 disabled:opacity-50">Clear</button>
        </div>
      )}
    </div>
  );
}
