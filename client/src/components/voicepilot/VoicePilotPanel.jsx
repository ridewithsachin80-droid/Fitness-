import { Fragment, useEffect, useState } from 'react';
import api from '../../api/client';
import { Eyebrow } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { shareOrDownload } from '../../utils/shareFile';

/**
 * VoicePilotPanel — Phase 8, on the admin dashboard. Invite members to the
 * Kannada voice test; see, per phrase, how often each speech engine heard the
 * key words; play any recording with both transcripts side by side.
 */
const pct = (v) => (v == null ? '—' : `${v}%`);
// One engine's headline: its score over every scored recording (no answer is a
// miss), and how many recordings it answered when that is not all of them.
const engine = (name, score, answered, total) => {
  const a = answered ?? total;
  if (!total) return `${name} —`;
  if (!a || score == null) return `${name}: no answers`;
  return `${name} ${pct(score)}${a < total ? ` (answered ${a} of ${total})` : ''}`;
};
export default function VoicePilotPanel({ collapsible = false }) {
  const role = useAuthStore(s => s.user?.role);
  // On the coach's home it starts folded, so it never pushes the day's work down.
  const [open, setOpen] = useState(!collapsible);
  const [dl, setDl] = useState('');
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
    // Admin can invite any member; a coach, their own members.
    api.get(role === 'admin' ? '/admin/members' : '/members').then(({ data }) => setAll(Array.isArray(data) ? data : data?.members || [])).catch(() => setAll([]));
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps
  const download = async () => {
    haptic(10); setDl('busy');
    try { await shareOrDownload('/voice-pilot/results.csv', { filename: 'FitLife-Voice-Pilot.csv', title: 'FitLife voice test results', type: 'text/csv' }); setDl(''); }
    catch (e) { setDl('Could not make the file just now. Try again.'); }
  };
  // Ask the engines again for stored recordings they did not answer.
  const [retry, setRetry] = useState('');
  const tryAgain = async () => {
    haptic(10); setRetry('busy');
    try {
      const { data } = await api.post('/voice-pilot/results/retry', {}, { timeout: 180000 });
      setRetry(!data.asked ? 'Nothing was waiting for an answer.'
        : `${data.fixed} of ${data.asked} answered this time.${data.still ? ` ${data.problems?.[0] || 'The rest still gave no answer.'}` : ''}${data.more ? ' More are waiting: tap again.' : ''}`);
      load();
    } catch (e) { setRetry(e.response?.data?.error || 'Could not try again just now.'); }
  };
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
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        {collapsible ? (
          <button type="button" onClick={() => { haptic(8); setOpen(o => !o); }} style={{ minHeight: 36 }} aria-expanded={open} data-testid="vp-toggle"
            className="flex items-center gap-1 text-left"><Eyebrow>Kannada voice test</Eyebrow><span className="text-caption text-lo">{open ? '▾' : '▸'}</span></button>
        ) : <Eyebrow>Kannada voice test</Eyebrow>}
        {res?.overall && (
          <span className="text-caption text-mid text-right min-w-0" data-testid="vp-overall">
            {engine('Gemini', res.overall.gemini, res.overall.gemini_answered, res.overall.samples)} · {engine('Whisper', res.overall.whisper, res.overall.whisper_answered, res.overall.samples)} · {res.overall.samples} {res.overall.samples === 1 ? 'recording' : 'recordings'}
          </span>
        )}
      </div>
      {open && (<>
      <p className="text-caption text-mid leading-snug">Invite 5 to 10 members. Each reads out {res?.phrases?.length || 22} lines; both speech engines write down what they heard, and the score is how many key words each caught. A recording an engine did not answer counts as a miss.</p>
      <div className="flex gap-2">
        <select value={pick} onChange={e => setPick(e.target.value)} aria-label="Member to invite" style={{ minHeight: 40 }}
          className="flex-1 min-w-0 rounded-xl bg-charcoal border border-white/[0.12] text-caption text-white px-2">
          <option value="">Choose a member…</option>
          {all.filter(m => m.active !== false && !invitedIds.has(m.id)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button type="button" onClick={invite} disabled={!pick} style={{ minHeight: 40 }} data-testid="vp-invite"
          className="rounded-xl border border-gold text-gold text-caption font-bold px-3 disabled:opacity-40">Invite</button>
      </div>
      {msg && <p className="text-caption text-red-300">{msg}</p>}
      {members.length > 0 && (
        <ul className="space-y-1" data-testid="vp-members">
          {members.map(m => (
            <li key={m.patient_id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-caption">
              <span className={`min-w-0 truncate ${m.active === false ? 'text-lo' : 'text-white'}`}>{m.name}</span>
              <span className="text-mid whitespace-nowrap text-right">{m.active === false ? 'account off' : m.withdrawn_at ? 'stopped' : !m.consented_at ? 'invited' : `${m.recorded} recorded`}</span>
              <button type="button" onClick={() => remove(m)} className="text-lo hover:text-white" style={{ minWidth: 32, minHeight: 32 }} aria-label={`Remove ${m.name}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      {res?.overall?.samples > 0 && (
        <>
          <button type="button" onClick={download} disabled={dl === 'busy'} style={{ minHeight: 44 }} data-testid="vp-download"
            className="w-full rounded-xl border border-gold text-gold text-sm font-bold disabled:opacity-50">{dl === 'busy' ? 'Making the file…' : 'Download results'}</button>
          <p className="text-caption text-lo leading-snug">One file, every recording: what each engine heard and its score. Members show as M1, M2…, no names, no audio. Check the "own words" lines for anything private before you send it on.</p>
          {dl && dl !== 'busy' && <p className="text-caption text-red-300">{dl}</p>}
        </>
      )}
      {res?.overall?.samples > 0 && (res.overall.gemini_answered < res.overall.samples || res.overall.whisper_answered < res.overall.samples) && (
        <div data-testid="vp-retry-box">
          <button type="button" onClick={tryAgain} disabled={retry === 'busy'} style={{ minHeight: 44 }} data-testid="vp-retry"
            className="w-full rounded-xl border border-white/[0.16] text-white text-sm font-semibold disabled:opacity-50">
            {retry === 'busy' ? 'Asking again… this can take a minute' : 'Try the unanswered recordings again'}
          </button>
          <p className="text-caption text-lo leading-snug mt-1">Uses the stored recordings: members do not need to record again.</p>
        </div>
      )}
      {retry && retry !== 'busy' && <p className="text-caption text-mid" data-testid="vp-retry-result">{retry}</p>}
      {res?.phrases?.some(p => p.samples) && (
        <div className="overflow-x-auto" data-testid="vp-results">
          <table className="w-full text-caption">
            <thead><tr className="text-lo text-left"><th className="py-1 pr-2 font-semibold">Line</th><th className="py-1 px-1 font-semibold text-right">Gemini</th><th className="py-1 px-1 font-semibold text-right">Whisper</th></tr></thead>
            <tbody>
              {res.phrases.filter(p => p.samples).map(p => (
                <Fragment key={p.id}>
                  <tr className="border-t border-hair cursor-pointer" onClick={() => setOpenPhrase(openPhrase === p.id ? null : p.id)} data-testid="vp-row">
                    <td className="py-1.5 pr-2 text-white">{p.say}<span className="block text-lo">{p.samples} {p.samples === 1 ? 'recording' : 'recordings'}</span></td>
                    {['gemini', 'whisper'].map(k => {
                      const other = k === 'gemini' ? p.whisper : p.gemini, mine = p[k], answered = p[`${k}_answered`] ?? p.samples;
                      const best = mine != null && mine > (other ?? -1);   // a tie highlights neither
                      return (
                        <td key={k} className={`py-1.5 px-1 text-right tabular-nums align-top ${best ? 'text-gold font-bold' : 'text-white'}`}>
                          {p.free ? (answered ? 'read' : <span className="text-lo font-normal whitespace-nowrap">no answer</span>) : mine == null ? <span className="text-lo font-normal whitespace-nowrap">no answer</span> : pct(mine)}
                          {!p.free && mine != null && answered < p.samples && <span className="block text-lo font-normal">{answered} of {p.samples}</span>}
                        </td>
                      );
                    })}
                  </tr>
                  {openPhrase === p.id && samples(p.id).map(s => (
                    <tr key={`s${s.id}`}><td colSpan={3} className="pb-2">
                      <div className="rounded-xl bg-charcoal px-2 py-2 space-y-1" data-testid="vp-sample">
                        <p className="text-white font-semibold">{s.name}</p>
                        {s.audio_url && <audio controls preload="none" src={s.audio_url} className="w-full" />}
                        {[['Gemini', s.gemini, s.gemini_problem], ['Whisper', s.whisper, s.whisper_problem]].map(([label, text, problem]) => (
                          <p key={label} className="text-mid break-words">{label}: {text != null
                            ? <span className="text-white">{text || '(heard nothing)'}</span>
                            : <span className="text-amber-300">no answer{problem && problem !== 'no answer' ? ` — ${problem}` : ''}</span>}</p>
                        ))}
                      </div>
                    </td></tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>)}
    </div>
  );
}
