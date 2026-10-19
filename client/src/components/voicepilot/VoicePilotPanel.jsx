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
// Fixes-2m: what each check kind is called on screen, in a fixed order.
const CHECK_KINDS = [['meal', 'meal'], ['date', 'day'], ['quantity', 'quantities'], ['weight', 'weight'], ['decimal', 'decimal weight'], ['negation', 'no sugar']];
const SCRIPT = { latin: null, kannada: 'Kannada script', tamil: 'Tamil script: wrong language', telugu: 'Telugu script: wrong language', devanagari: 'Hindi script: wrong language', malayalam: 'Malayalam script: wrong language', mixed: 'mixed scripts' };
const LANG = { kn: 'Kannada', en: 'English', auto: 'not set (Whisper guesses)' };
// ✓ passed · ✗ failed · ? unverified (the transcript says conflicting things). Fixes-2n.
const mark = (c) => (c.result === 'pass' || (c.result == null && c.pass) ? '✓' : c.result === 'unverified' ? '?' : '✗');
const checksLine = (list) => (list || []).map(c => `${c.label} ${mark(c)}`).join(' · ');
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
  // Fixes-2m: the Excel file is the main download. A CSV goes through a "which
  // text encoding?" step in the spreadsheet program, and on 19 Oct that step
  // turned Tamil into "à®µà®¿…" although the file was marked UTF-8.
  const download = async (kind = 'xlsx') => {
    haptic(10); setDl('busy');
    try {
      await shareOrDownload(`/voice-pilot/results.${kind}`, kind === 'xlsx'
        ? { filename: 'FitLife-Voice-Pilot.xlsx', title: 'FitLife voice test results', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
        : { filename: 'FitLife-Voice-Pilot.csv', title: 'FitLife voice test results', type: 'text/csv' });
      setDl('');
    } catch (e) { setDl('Could not make the file just now. Try again.'); }
  };
  // Fixes-2m: ask Whisper again about the stored recordings with the language
  // fixed. The first answers stay as they were; these show beside them.
  const [rerun, setRerun] = useState('');
  const askAgain = async (setting) => {
    haptic(10); setRerun('busy');
    try {
      const { data } = await api.post('/voice-pilot/results/rerun', { setting }, { timeout: 180000 });
      setRerun(!data.asked ? `Every recording already has a Whisper answer with the language set to ${LANG[setting]}.`
        : `Whisper (language ${LANG[setting]}) answered ${data.answered} of ${data.asked}.${data.problems?.length ? ` ${data.problems[0]}` : ''}${data.more ? ' More are waiting: tap again.' : ''}`);
      load();
    } catch (e) { setRerun(e.response?.data?.error || 'Could not ask again just now.'); }
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
            Keyword score: {engine('Gemini', res.overall.gemini, res.overall.gemini_answered, res.overall.samples)} · {engine('Whisper', res.overall.whisper, res.overall.whisper_answered, res.overall.samples)} · {res.overall.samples} {res.overall.samples === 1 ? 'recording' : 'recordings'}
          </span>
        )}
      </div>
      {open && (<>
      <p className="text-caption text-mid leading-snug" data-testid="vp-explain">Invite 5 to 10 members. Each reads out {res?.phrases?.length || 22} lines; both speech engines write down what they heard. The <b className="text-white">keyword score</b> is the share of a line's key words each engine wrote down; a recording an engine did not answer counts as a miss. It does not say whether the meaning was right ("sugar" scores the same as "no sugar"). The rule checks below look at a few things in each line (sugar or no sugar, quantities, the weight, the meal, the day); they are limited, rule-based checks, not a guarantee of meaning.</p>
      <p className="text-caption text-lo leading-snug" data-testid="vp-not-learning">This is a test of the two speech services. It does not teach FitLife anyone's voice, and the app's speech engine is not chosen from it{res?.overall?.samples < 100 ? ` — ${res?.overall?.samples || 0} ${res?.overall?.samples === 1 ? 'recording is' : 'recordings are'} far too few to choose one` : ''}.</p>
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
          <button type="button" onClick={() => download('xlsx')} disabled={dl === 'busy'} style={{ minHeight: 44 }} data-testid="vp-download-xlsx"
            className="w-full rounded-xl border border-gold text-gold text-sm font-bold disabled:opacity-50">{dl === 'busy' ? 'Making the file…' : 'Download results (Excel)'}</button>
          <button type="button" onClick={() => download('csv')} disabled={dl === 'busy'} style={{ minHeight: 36 }} data-testid="vp-download"
            className="w-full text-caption text-mid underline disabled:opacity-50">or as CSV</button>
          <p className="text-caption text-lo leading-snug">One file, every recording: what each engine heard, its keyword score and rule checks. Members show as M1, M2…, no names, no audio. Check the "own words" lines for anything private before you send it on.</p>
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
      {res?.overall?.samples > 0 && (
        <div className="space-y-1" data-testid="vp-rerun-box">
          <p className="text-caption text-mid leading-snug">Ask Whisper again about the stored recordings, with the language fixed. Its first answers stay as they were; the new ones show beside them.</p>
          <div className="flex gap-2">
            {['kn', 'en'].map(k => (
              <button key={k} type="button" onClick={() => askAgain(k)} disabled={rerun === 'busy'} style={{ minHeight: 40 }} data-testid={`vp-rerun-${k}`}
                className="flex-1 rounded-xl border border-white/[0.16] text-white text-caption font-semibold disabled:opacity-50">{rerun === 'busy' ? 'Asking…' : `Whisper · ${LANG[k]}`}</button>
            ))}
          </div>
          {rerun && rerun !== 'busy' && <p className="text-caption text-mid" data-testid="vp-rerun-result">{rerun}</p>}
        </div>
      )}
      {res?.checks && ['gemini', 'whisper'].some(k => Object.keys(res.checks[k] || {}).length) && (
        <div className="text-caption leading-snug" data-testid="vp-checks">
          <p className="text-lo font-semibold">Rule checks (✓ passed of checked · ? unverified)</p>
          {[['gemini', 'Gemini'], ['whisper', 'Whisper']].map(([k, label]) => (
            <p key={k} className="text-mid" data-testid={`vp-checks-${k}`}><span className="text-white">{label}:</span>{' '}
              {CHECK_KINDS.filter(([kind]) => res.checks[k]?.[kind]).map(([kind, name]) => `${name} ${res.checks[k][kind].passed}/${res.checks[k][kind].total}${res.checks[k][kind].unverified ? ` (${res.checks[k][kind].unverified} ?)` : ''}`).join(' · ') || 'none yet'}</p>
          ))}
        </div>
      )}
      {res?.phrases?.some(p => p.samples) && (
        <div className="overflow-x-auto" data-testid="vp-results">
          <table className="w-full text-caption">
            <thead>
              <tr className="text-lo text-left"><th className="pt-1 pr-2 font-semibold" rowSpan={2}>Line</th><th className="pt-1 px-1 font-semibold text-right whitespace-nowrap" colSpan={2} data-testid="vp-head-score">Keyword score</th></tr>
              <tr className="text-lo"><th className="pb-1 px-1 font-semibold text-right">Gemini</th><th className="pb-1 px-1 font-semibold text-right">Whisper</th></tr>
            </thead>
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
                        {[['Gemini', 'gemini'], ['Whisper', 'whisper']].map(([label, k]) => {
                          const text = s[k], problem = s[`${k}_problem`], script = SCRIPT[s[`${k}_script`]], latin = s[`${k}_latin`];
                          return (
                            <div key={label} className="break-words" data-testid={`vp-sample-${k}`}>
                              <p className="text-mid">{label}{text != null && !p.free && s[`${k}_score`] != null ? ` · keyword score ${Math.round(Number(s[`${k}_score`]) * 100)}%` : ''}: {text != null
                                ? <span className="text-white" lang={s[`${k}_script`] === 'tamil' ? 'ta' : s[`${k}_script`] === 'kannada' ? 'kn' : undefined}>{text || '(heard nothing)'}</span>
                                : <span className="text-warn">no answer{problem && problem !== 'no answer' ? ` — ${problem}` : ''}</span>}</p>
                              {script && <p className="text-lo" data-testid={`vp-script-${k}`}>{script}{latin ? ` · in English letters: ${latin}` : ''}</p>}
                              {k === 'whisper' && text != null && <p className="text-lo" data-testid="vp-whisper-lang">Language asked: {LANG[s.whisper_setting] || s.whisper_setting} · used: {s.whisper_language || 'not recorded'}</p>}
                              {s[`${k}_checks`]?.length > 0 && <p className="text-lo" data-testid={`vp-checks-line-${k}`}>Rule checks: {checksLine(s[`${k}_checks`])}</p>}
                            </div>
                          );
                        })}
                        {(s.reruns || []).map(x => (
                          <div key={`${x.engine}-${x.setting}`} className="break-words border-t border-hair pt-1" data-testid="vp-rerun">
                            <p className="text-mid">Whisper again, language {LANG[x.setting] || x.setting}{x.text != null && !p.free && x.score != null ? ` · keyword score ${Math.round(Number(x.score) * 100)}%` : ''}: {x.text != null
                              ? <span className="text-white">{x.text || '(heard nothing)'}</span> : <span className="text-warn">no answer{x.problem && x.problem !== 'no answer' ? ` — ${x.problem}` : ''}</span>}</p>
                            {SCRIPT[x.script] && <p className="text-lo">{SCRIPT[x.script]}{x.latin ? ` · in English letters: ${x.latin}` : ''}</p>}
                            {x.language && <p className="text-lo">Language used: {x.language}</p>}
                            {x.checks?.length > 0 && <p className="text-lo">Rule checks: {checksLine(x.checks)}</p>}
                          </div>
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
