import { Fragment, useEffect, useState } from 'react';
import api from '../../api/client';
import { Eyebrow } from '../primitives';
import { haptic } from '../../store/settingsStore';

/**
 * VoicePilotPanel — Phase 8, on the admin dashboard. Invite members to the
 * Kannada voice test; see, per phrase, how often each speech engine heard the
 * key words; play any recording with both transcripts side by side.
 */
const pct = (v) => (v == null ? '—' : `${v}%`);
export default function VoicePilotPanel() {
  const [members, setMembers] = useState([]);
  const [all, setAll] = useState([]);
  const [res, setRes] = useState(null);
  const [pick, setPick] = useState('');
  const [openPhrase, setOpenPhrase] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => {
    api.get('/voice-pilot/members').then(({ data }) => setMembers(data.members || [])).catch(() => {});
    api.get('/voice-pilot/results').then(({ data }) => setRes(data)).catch(() => setRes(null));
  };
  useEffect(() => {
    load();
    api.get('/admin/members').then(({ data }) => setAll(Array.isArray(data) ? data : data?.members || [])).catch(() => setAll([]));
  }, []);
  const invite = async () => {
    if (!pick) return;
    haptic(10); setMsg('');
    try { await api.post('/voice-pilot/invite', { member_id: Number(pick) }); setPick(''); load(); }
    catch (e) { setMsg(e.response?.data?.error || 'Could not invite.'); }
  };
  const remove = async (m) => {
    if (!window.confirm(`Remove ${m.name} from the voice test and delete their recordings?`)) return;
    try { await api.delete(`/voice-pilot/invite/${m.patient_id}`); load(); } catch (e) { setMsg(e.response?.data?.error || 'Could not remove.'); }
  };
  const invitedIds = new Set(members.map(m => m.patient_id));
  const samples = (id) => (res?.samples || []).filter(s => s.phrase_id === id);

  return (
    <div className="rounded-2xl border border-hair bg-surface px-4 py-3 mt-3 space-y-3" data-testid="vp-panel">
      <div className="flex items-baseline justify-between gap-2">
        <Eyebrow>Kannada voice test</Eyebrow>
        {res?.overall && <span className="text-caption text-mid" data-testid="vp-overall">Gemini {pct(res.overall.gemini)} · Whisper {pct(res.overall.whisper)} · {res.overall.samples} recordings</span>}
      </div>
      <p className="text-caption text-mid leading-snug">Invite 5 to 10 members. Each reads out {res?.phrases?.length || 22} lines; both speech engines write down what they heard, and the score is how many key words each caught.</p>
      <div className="flex gap-2">
        <select value={pick} onChange={e => setPick(e.target.value)} aria-label="Member to invite" style={{ minHeight: 40 }}
          className="flex-1 min-w-0 rounded-xl bg-charcoal border border-white/[0.12] text-caption text-white px-2">
          <option value="">Choose a member…</option>
          {all.filter(m => !invitedIds.has(m.id)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button type="button" onClick={invite} disabled={!pick} style={{ minHeight: 40 }} data-testid="vp-invite"
          className="rounded-xl border border-gold text-gold text-caption font-bold px-3 disabled:opacity-40">Invite</button>
      </div>
      {msg && <p className="text-caption text-red-300">{msg}</p>}
      {members.length > 0 && (
        <ul className="space-y-1" data-testid="vp-members">
          {members.map(m => (
            <li key={m.patient_id} className="flex items-center justify-between gap-2 text-caption">
              <span className="text-white min-w-0 truncate">{m.name}</span>
              <span className="text-mid whitespace-nowrap">{m.withdrawn_at ? 'stopped' : !m.consented_at ? 'invited' : `${m.recorded} recorded`}</span>
              <button type="button" onClick={() => remove(m)} className="text-lo hover:text-white" style={{ minWidth: 32, minHeight: 32 }} aria-label={`Remove ${m.name}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      {res?.phrases?.some(p => p.samples) && (
        <div className="overflow-x-auto" data-testid="vp-results">
          <table className="w-full text-caption">
            <thead><tr className="text-lo text-left"><th className="py-1 pr-2 font-semibold">Line</th><th className="py-1 px-1 font-semibold text-right">Gemini</th><th className="py-1 px-1 font-semibold text-right">Whisper</th></tr></thead>
            <tbody>
              {res.phrases.filter(p => p.samples).map(p => (
                <Fragment key={p.id}>
                  <tr className="border-t border-hair cursor-pointer" onClick={() => setOpenPhrase(openPhrase === p.id ? null : p.id)} data-testid="vp-row">
                    <td className="py-1.5 pr-2 text-white">{p.say}<span className="block text-lo">{p.samples} {p.samples === 1 ? 'recording' : 'recordings'}</span></td>
                    <td className={`py-1.5 px-1 text-right tabular-nums ${p.gemini != null && p.gemini >= (p.whisper ?? -1) ? 'text-gold font-bold' : 'text-white'}`}>{p.free ? 'read' : pct(p.gemini)}</td>
                    <td className={`py-1.5 px-1 text-right tabular-nums ${p.whisper != null && p.whisper > (p.gemini ?? -1) ? 'text-gold font-bold' : 'text-white'}`}>{p.free ? 'read' : pct(p.whisper)}</td>
                  </tr>
                  {openPhrase === p.id && samples(p.id).map(s => (
                    <tr key={`s${s.id}`}><td colSpan={3} className="pb-2">
                      <div className="rounded-xl bg-charcoal px-2 py-2 space-y-1" data-testid="vp-sample">
                        <p className="text-white font-semibold">{s.name}</p>
                        {s.audio_url && <audio controls preload="none" src={s.audio_url} className="w-full" />}
                        <p className="text-mid">Gemini: <span className="text-white">{s.gemini ?? '(no answer)'}</span></p>
                        <p className="text-mid">Whisper: <span className="text-white">{s.whisper ?? '(no answer)'}</span></p>
                      </div>
                    </td></tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
