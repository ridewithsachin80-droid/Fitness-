import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Eyebrow } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { shareOrDownload } from '../../utils/shareFile';

/**
 * VoiceCalibrationPanel — admin dashboard, TEST SERVER ONLY (hidden elsewhere: the API is 404).
 * Voice calibration round 1 (B18/B19): six volunteers, 144 planned recording slots, a fluent
 * speaker's wording check before any line can be recorded, the 32 planned Part C tries on the
 * everyday path, and the workbook (codes only, no names, no audio). Fixes-2x.
 *
 * Fixes-2y (the 2x kit review): reviewers are registered once and appear by code (R1…); each take's
 * reference is recorded by the fluent listener BEFORE its transcripts are shown, then frozen as a
 * version (a later change is a new version and makes earlier rule 3 judgments stale); lines and
 * previews that need a person are settled here; a Part C try stays open until its day is restored
 * and the Voice backup switch is off.
 */
const GROUP = { kn: 'Kannada speaker', hi: 'Hindi speaker', en: 'English speaker' };
const LANG = { kn: 'Kannada', hi: 'Hindi', en: 'English' };
const when = (t) => { try { return new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const btn = 'rounded-xl border text-caption font-semibold px-3 disabled:opacity-40';
const field = 'rounded-xl bg-charcoal border border-white/[0.12] text-caption text-white px-2';
const on = 'border-gold text-gold', off = 'border-white/[0.16] text-mid';
const REVIEWER_ROLE = { 'fluent speaker': 'fluent speaker', listener: 'listener', both: 'speaker + listener' };   // shown through this map, never raw
const PREVIEW_VERDICTS = ['correct reviewable', 'explicit refusal', 'missing/unresolved (visible)', 'disqualifying'];

function Section({ title, count, open, onToggle, children, testid }) {
  return (
    <div className="border-t border-hair pt-2" data-testid={testid}>
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between text-left" style={{ minHeight: 40 }} aria-expanded={open}>
        <span className="text-sm font-semibold text-white">{title}</span>
        <span className="text-caption text-lo">{count} {open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="space-y-2 pb-1">{children}</div>}
    </div>
  );
}

function Choice({ label, options, value, onPick, busy, testid }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={testid}>
      <span className="text-lo">{label}</span>
      {options.map(([v, l]) => (
        <button key={l} type="button" onClick={() => onPick(v)} disabled={busy} aria-pressed={value === v} className={`${btn} ${value === v ? on : off}`} style={{ minHeight: 34 }}>{l}</button>
      ))}
    </div>
  );
}

/** The listener's reference for one take: what was heard and said, recorded before any transcript is shown. */
function ReferenceForm({ take, listeners, vocab, busy, onSave, onCancel }) {
  const fromScript = () => (take.items || []).map(i => ({ kind: i.kind, n: i.n ?? '', unit: i.unit || '', food: i.food || '' }));
  const [f, setF] = useState(() => ({
    listener: take.listener_code || '',   // chosen each time: never credited to someone by default heard: take.heard ?? null, as: take.spoken_as_script ?? null,
    mode: take.reference_mode === 'unscorable' ? 'unscorable' : 'corrected', text: take.reference_text || '',
    items: Array.isArray(take.reference_items) && take.reference_items.some(r => r.kind) ? take.reference_items.map(r => ({ kind: r.kind, n: r.n ?? '', unit: r.unit || '', food: r.food || '' })) : fromScript(),
  }));
  const speechSlot = take.intended === 'speech';
  const setItem = (k, patch) => setF(x => ({ ...x, items: x.items.map((it, i) => (i === k ? { ...it, ...patch } : it)) }));
  const ready = f.listener && f.heard && (!speechSlot || f.heard !== 'speech' || f.as !== null);
  const save = () => onSave({
    take_id: take.id, listener_code: f.listener, heard: f.heard, spoken_as_script: speechSlot && f.heard === 'speech' ? f.as : undefined,
    mode: f.as === false ? f.mode : undefined, text: f.text || undefined,
    items: f.as === false && f.mode === 'corrected' ? f.items.map(it => ({ kind: it.kind, n: it.kind === 'presence' ? undefined : it.n === '' ? undefined : Number(it.n), unit: it.unit || undefined, food: it.food || undefined })) : undefined,
  });
  return (
    <div className="space-y-1.5 mt-1" data-testid="vc-reference-form">
      <p className="text-lo">Listen first. The engines' words and the detector's verdict appear after you save this.</p>
      <label className="flex items-center gap-2"><span className="text-lo">Listener</span>
        <select value={f.listener} onChange={e => setF({ ...f, listener: e.target.value })} aria-label="Listener" className={`flex-1 min-w-0 ${field}`} style={{ minHeight: 36 }}>
          <option value="">Choose…</option>{listeners.map(r => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}
        </select>
      </label>
      <Choice label="Heard:" testid="vc-heard" busy={busy} value={f.heard} onPick={v => setF({ ...f, heard: v })} options={[['speech', 'Speech'], ['no_speech', 'No speech'], ['uncertain', 'Unsure']]} />
      {speechSlot && f.heard === 'speech' && <Choice label="Said as written?" testid="vc-as-written" busy={busy} value={f.as} onPick={v => setF({ ...f, as: v })} options={[[true, 'Yes'], [false, 'No']]} />}
      {f.as === false && f.heard === 'speech' && (
        <div className="space-y-1.5" data-testid="vc-reference">
          <Choice label="What was said:" busy={busy} value={f.mode} onPick={v => setF({ ...f, mode: v })} options={[['corrected', 'List the items'], ['unscorable', "Can't be scored"]]} />
          {f.mode === 'corrected' && (
            <div className="space-y-1">
              {f.items.map((it, k) => (
                <div key={k} className="flex flex-wrap gap-1" data-testid="vc-ref-item">
                  <select value={it.kind} onChange={e => setItem(k, { kind: e.target.value })} aria-label="Kind" className={`w-24 ${field}`} style={{ minHeight: 34 }}>
                    <option value="count">count</option><option value="weight">weight (kg)</option><option value="presence">no amount</option>
                  </select>
                  {it.kind !== 'presence' && <input inputMode="decimal" value={it.n} onChange={e => setItem(k, { n: e.target.value })} aria-label="Number actually said" placeholder="number" className={`w-16 ${field}`} style={{ minHeight: 34 }} />}
                  {it.kind === 'count' && <select value={it.unit} onChange={e => setItem(k, { unit: e.target.value })} aria-label="Unit" className={`w-20 ${field}`} style={{ minHeight: 34 }}><option value="">no unit</option>{vocab.units.map(u => <option key={u} value={u}>{u}</option>)}</select>}
                  {it.kind !== 'weight' && <select value={it.food} onChange={e => setItem(k, { food: e.target.value })} aria-label="Food" className={`flex-1 min-w-0 ${field}`} style={{ minHeight: 34 }}><option value="">no food</option>{vocab.foods.map(x => <option key={x} value={x}>{x}</option>)}</select>}
                  <button type="button" onClick={() => setF(x => ({ ...x, items: x.items.filter((_, i) => i !== k) }))} className={`${btn} ${off}`} style={{ minHeight: 34 }} aria-label="Remove item">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => setF(x => ({ ...x, items: [...x.items, { kind: 'count', n: '', unit: '', food: '' }] }))} className={`${btn} ${off}`} style={{ minHeight: 34 }}>Add an item</button>
              <p className="text-lo">A food or unit that is not in these lists cannot be scored: choose "Can't be scored" instead.</p>
            </div>
          )}
        </div>
      )}
      <input value={f.text} onChange={e => setF({ ...f, text: e.target.value })} maxLength={500} placeholder="What was actually said (optional)" aria-label="What was actually said" className={`w-full ${field}`} style={{ minHeight: 36 }} />
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy || !ready} className={`flex-1 ${btn} ${on}`} style={{ minHeight: 36 }} data-testid="vc-freeze">{take.reference_version ? 'Save as a new version' : 'Save reference and show the transcripts'}</button>
        {onCancel && <button type="button" onClick={onCancel} className={`${btn} ${off}`} style={{ minHeight: 36 }}>Cancel</button>}
      </div>
    </div>
  );
}

export default function VoiceCalibrationPanel() {
  const [st, setSt] = useState(null);
  const [all, setAll] = useState([]);
  const [takes, setTakes] = useState([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState({ people: true });
  const [inv, setInv] = useState({ member: '', group: 'kn', note: '' });
  const [rev, setRev] = useState({ name: '', kind: 'both', langs: '' });
  const [check, setCheck] = useState({});
  const [filter, setFilter] = useState('');
  const [arm, setArm] = useState({ trial: '1', account: '' });
  const [mark, setMark] = useState(null);
  const [amend, setAmend] = useState(null);   // take id whose reference is being re-recorded
  const load = () => api.get('/voice-calibration/admin').then(({ data }) => setSt(data)).catch(() => setSt(null));
  const loadTakes = () => api.get('/voice-calibration/admin/takes').then(({ data }) => setTakes(data.takes || [])).catch(() => setTakes([]));
  useEffect(() => {
    load();
    api.get('/admin/members').then(({ data }) => setAll(Array.isArray(data) ? data : data?.members || [])).catch(() => setAll([]));
  }, []);
  if (!st?.available) return null;
  const toggle = (k) => { setOpen(o => ({ ...o, [k]: !o[k] })); if (k === 'takes' && !open.takes) loadTakes(); };
  const act = async (fn, after) => {
    haptic(10); setBusy(true); setMsg('');
    try { const r = await fn(); await load(); if (after) after(r); }
    catch (e) { setMsg(e.response?.data?.error || 'Could not do that just now. Try again.'); }
    setBusy(false);
  };
  const people = st.participants || [];
  const reviewers = st.reviewers || [];
  const vocab = st.vocab || { foods: [], units: [] };
  const recorded = people.reduce((n, p) => n + p.slots_recorded, 0);
  const invite = () => act(() => api.post('/voice-calibration/admin/invite', { member_id: Number(inv.member), group: inv.group, profile_note: inv.note || undefined }), () => setInv({ member: '', group: inv.group, note: '' }));
  const remove = (p) => { if (window.confirm(`Remove ${p.code} and delete all their recordings?`)) act(() => api.delete(`/voice-calibration/admin/participant/${p.id}`)); };
  const register = () => act(() => api.post('/voice-calibration/admin/reviewers', { name: rev.name, role: rev.kind, langs: rev.langs || undefined }), (r) => { setRev({ name: '', kind: rev.kind, langs: '' }); setMsg(`Registered as ${r.data.code}. Only the code appears in the workbook.`); });
  const confirmWording = (w) => act(() => api.post('/voice-calibration/admin/wording', { lang: w.lang, reviewer_code: check[w.lang]?.by || '', note: check[w.lang]?.note || undefined, script_sha256: w.sha }), () => setCheck(c => ({ ...c, [w.lang]: {} })));
  const revoke = (lang) => { if (window.confirm(`Lock the ${LANG[lang]} lines again?`)) act(() => api.post('/voice-calibration/admin/wording/revoke', { lang })); };
  const saveReference = (body) => act(() => api.post('/voice-calibration/admin/reference', body), (r) => { setAmend(null); loadTakes(); if (r.data.stale_judgments) setMsg(`New reference version ${r.data.version}: ${r.data.stale_judgments} earlier preview judgment(s) are now stale (kept). Re-evaluate them when ready.`); });
  const handCheck = (t, engine, verdict) => act(() => api.post('/voice-calibration/admin/hand-check', { take_id: t.id, engine, verdict }), loadTakes);
  const handVerdict = (id, verdict) => act(() => api.post(`/voice-calibration/admin/judgments/${id}/hand`, { verdict }), loadTakes);
  const previewEval = (reevaluate) => act(() => api.post('/voice-calibration/admin/preview-eval', reevaluate ? { reevaluate: true } : {}, { timeout: 300000 }), (r) => { loadTakes(); setMsg(`Rule 3 previews: ${r.data.judged} leg(s) judged, ${r.data.parser_calls} parser call(s)${r.data.reevaluation_calls ? `, ${r.data.reevaluation_calls} re-evaluation call(s)` : ''}${r.data.stale_waiting ? `; ${r.data.stale_waiting} stale leg(s) wait for "Re-evaluate"` : ''}${r.data.awaiting_reference ? `; ${r.data.awaiting_reference} take(s) still need the listener's reference` : ''}${r.data.more ? '. More waiting: tap again.' : '.'}`); });
  const sessionMsg = (r) => (r.data.completed ? `Try ${r.data.trial} finished: the day equals its baseline and the Voice backup switch is off.` : `Try ${r.data.trial} is NOT finished: ${(r.data.outstanding || []).join(' ')} Recording has stopped; the try stays open until then.`);
  const sAct = (s, what) => act(() => api.post(`/voice-calibration/admin/partc/sessions/${s.id}/${what}`), (r) => setMsg(what === 'finish' ? sessionMsg(r)
    : what === 'restore' ? (r.data.ok ? 'Restored: the whole day equals the baseline. Now Finish.' : 'NOT restored: the day still differs from the baseline. Check before going on.')
      : r.data.diff.same ? 'Read back: the day is unchanged since arming.' : `Read back: ${r.data.diff.added_foods.length} food(s) added, ${r.data.diff.removed_foods.length} removed; changed: ${r.data.diff.changed_fields.map(f => f.field).join(', ') || 'no other field'}; workouts ${r.data.diff.workouts_changed ? 'changed' : 'same'}.`));
  const remeasure = () => act(() => api.post('/voice-calibration/admin/remeasure', {}, { timeout: 180000 }), (r) => setMsg(`Measured again: ${r.data.checked} take(s), ${r.data.same} the same, ${r.data.different} different${r.data.more ? '. More waiting: tap again.' : '.'}`));
  const armTry = () => act(() => api.post('/voice-calibration/admin/partc/arm', { trial: Number(arm.trial), account_id: Number(arm.account) }), (r) => setMsg(r.data.warning || `Try ${r.data.trial} is armed for ${st.partc.arm_minutes} minutes. Record it on the test account now.`));
  const saveMark = () => act(() => api.put(`/voice-calibration/admin/partc/${mark.trial}`, mark.body), () => setMark(null));
  const download = async () => {
    haptic(10); setMsg('');
    try { await shareOrDownload('/voice-calibration/admin/export.xlsx', { filename: 'FitLife-Voice-Calibration.xlsx', title: 'FitLife voice calibration', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }
    catch (e) { setMsg('Could not make the file just now. Try again.'); }
  };
  const rows = st.partc.rows || [];
  const unresolved = st.partc.unresolved || [];
  const shownTakes = takes.filter(t => !filter || t.code === filter);
  const listeners = reviewers.filter(r => r.role !== 'fluent speaker');
  const speakers = reviewers.filter(r => r.role !== 'listener');

  return (
    <div className="rounded-2xl border border-hair bg-surface px-4 py-3 mt-3 space-y-2" data-testid="vc-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <Eyebrow>Voice calibration · round 1</Eyebrow>
        <span className="text-caption text-lo">test server only</span>
      </div>
      <p className="text-caption text-mid leading-snug">{people.length} of {st.max} volunteers · {recorded} of {st.planned_total} planned recordings · live speech check stays at {st.live.min_voiced_ms} ms</p>
      {msg && <p className="text-caption text-gold leading-snug" data-testid="vc-msg">{msg}</p>}

      <Section title="Volunteers" count={`${people.length}/${st.max}`} open={!!open.people} onToggle={() => toggle('people')} testid="vc-people">
        {people.map(p => (
          <div key={p.id} className="flex items-center gap-2 text-caption">
            <span className="w-8 font-bold text-white">{p.code}</span>
            <span className="flex-1 min-w-0 truncate text-mid">{p.name} · {GROUP[p.group]}{p.profile_note ? ` · ${p.profile_note}` : ''} · {p.consented ? `${p.slots_recorded}/${p.slots_planned}${p.device ? ` · ${p.device.make} ${p.device.model}` : ''}` : 'not agreed yet'}</span>
            <button type="button" onClick={() => remove(p)} disabled={busy} className={`${btn} ${off}`} style={{ minHeight: 36 }}>Remove</button>
          </div>
        ))}
        {people.length < st.max && (
          <div className="space-y-1.5" data-testid="vc-invite">
            <select value={inv.member} onChange={e => setInv({ ...inv, member: e.target.value })} aria-label="Member to invite" style={{ minHeight: 40 }} className={`w-full ${field}`}>
              <option value="">Invite a volunteer…</option>
              {all.filter(m => m.active !== false && !people.some(p => p.name === m.name)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <div className="flex gap-2">
              <select value={inv.group} onChange={e => setInv({ ...inv, group: e.target.value })} aria-label="Group" style={{ minHeight: 40 }} className={`flex-1 min-w-0 ${field}`}>
                {Object.keys(GROUP).map(g => <option key={g} value={g} disabled={(st.used[g] || 0) >= st.groups[g].quota}>{GROUP[g]} ({st.used[g] || 0}/{st.groups[g].quota})</option>)}
              </select>
              <input value={inv.note} onChange={e => setInv({ ...inv, note: e.target.value })} maxLength={40} placeholder="e.g. 40s, woman" aria-label="Age group and gender, no name" style={{ minHeight: 40 }} className={`w-32 ${field}`} />
            </div>
            <button type="button" onClick={invite} disabled={!inv.member || busy} className={`w-full ${btn} ${on}`} style={{ minHeight: 40 }} data-testid="vc-invite-send">Invite</button>
          </div>
        )}
      </Section>

      <Section title="Reviewers (fluent speakers and listeners)" count={`${reviewers.length}`} open={!!open.reviewers} onToggle={() => toggle('reviewers')} testid="vc-reviewers">
        <p className="text-caption text-mid leading-snug">Register each person once. Their name stays here; the workbook shows only their code.</p>
        {reviewers.map(r => <p key={r.code} className="text-caption text-mid"><b className="text-white">{r.code}</b> · {r.name} · {REVIEWER_ROLE[r.role] || 'reviewer'}{r.langs ? ` · ${r.langs}` : ''}</p>)}
        <div className="flex gap-2">
          <input value={rev.name} onChange={e => setRev({ ...rev, name: e.target.value })} maxLength={80} placeholder="Name (private)" aria-label="Reviewer name" style={{ minHeight: 40 }} className={`flex-1 min-w-0 ${field}`} />
          <select value={rev.kind} onChange={e => setRev({ ...rev, kind: e.target.value })} aria-label="Role" style={{ minHeight: 40 }} className={`w-32 ${field}`}>
            <option value="both">speaker + listener</option><option value="fluent speaker">fluent speaker</option><option value="listener">listener</option>
          </select>
        </div>
        <button type="button" onClick={register} disabled={busy || rev.name.trim().length < 2} className={`w-full ${btn} ${on}`} style={{ minHeight: 40 }} data-testid="vc-register">Register</button>
      </Section>

      <Section title="Wording check (before any recording)" count={`${st.wording.filter(w => w.confirmed).length}/3 confirmed`} open={!!open.words} onToggle={() => toggle('words')} testid="vc-words">
        <p className="text-caption text-mid leading-snug">A fluent speaker reads each language's lines aloud and confirms the words are natural and correct. Until then those lines cannot be recorded. Editing a line later locks it again.</p>
        {st.wording.map(w => (
          <div key={w.lang} className="rounded-xl border border-hair px-3 py-2 space-y-1.5" data-testid={`vc-words-${w.lang}`}>
            <p className="text-caption font-semibold text-white">{w.name}: {w.confirmed ? `confirmed by ${w.confirmed.by} · ${when(w.confirmed.at)}` : w.void ? 'check void (lines changed), locked' : 'not confirmed, locked'}</p>
            <ul className="text-caption text-mid space-y-0.5">{w.lines.map(l => <li key={l.id}><b className="text-white">{l.id}</b> {l.say} <span className="text-lo">({l.items.join(' · ')})</span></li>)}</ul>
            <p className="text-caption text-lo">Script hash {String(w.sha).slice(0, 12)}</p>
            {w.confirmed ? (
              <button type="button" onClick={() => revoke(w.lang)} disabled={busy} className={`${btn} ${off}`} style={{ minHeight: 36 }}>Lock again</button>
            ) : (
              <div className="flex gap-2">
                <select value={check[w.lang]?.by || ''} onChange={e => setCheck({ ...check, [w.lang]: { ...check[w.lang], by: e.target.value } })} aria-label={`Who checked the ${w.name} lines`} style={{ minHeight: 40 }} className={`flex-1 min-w-0 ${field}`}>
                  <option value="">{speakers.length ? `Fluent ${w.name} speaker…` : 'Register a fluent speaker first'}</option>
                  {speakers.map(r => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}
                </select>
                <button type="button" onClick={() => confirmWording(w)} disabled={busy || !check[w.lang]?.by} className={`${btn} ${on}`} style={{ minHeight: 40 }} data-testid={`vc-confirm-${w.lang}`}>Confirm</button>
              </div>
            )}
          </div>
        ))}
      </Section>

      <Section title="Takes (listen, then label)" count={takes.length ? `${takes.length} kept` : ''} open={!!open.takes} onToggle={() => toggle('takes')} testid="vc-takes">
        <div className="flex gap-2">
          <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Volunteer" style={{ minHeight: 40 }} className={`flex-1 min-w-0 ${field}`}>
            <option value="">Every volunteer</option>{people.map(p => <option key={p.code} value={p.code}>{p.code}</option>)}
          </select>
          <button type="button" onClick={remeasure} disabled={busy} className={`${btn} ${off}`} style={{ minHeight: 40 }}>Measure again</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => previewEval(false)} disabled={busy} className={`${btn} ${off}`} style={{ minHeight: 40 }} data-testid="vc-preview-eval">Check previews (rule 3)</button>
          <button type="button" onClick={() => previewEval(true)} disabled={busy} className={`${btn} ${off}`} style={{ minHeight: 40 }} data-testid="vc-reevaluate">Re-evaluate stale ones</button>
        </div>
        {st.preview_hand_checks > 0 && <p className="text-caption text-gold">{st.preview_hand_checks} preview(s) need a person: open the takes below.</p>}
        {!listeners.length && <p className="text-caption text-lo">Register a listener under Reviewers before labelling.</p>}
        {!shownTakes.length && <p className="text-caption text-lo">No takes yet.</p>}
        {shownTakes.map(t => (
          <div key={t.id} className="text-caption leading-snug border-t border-hair pt-2" data-testid="vc-take">
            <p className="text-white"><b>{t.code}</b> · {t.slot} · take {t.take_no}{t.current ? '' : ' (kept, superseded)'}{t.retake_reason ? ` · again: ${t.retake_reason}` : ''}</p>
            <p className="text-mid">{t.say}</p>
            {t.audio_url && <audio controls preload="none" src={t.audio_url} className="w-full my-1" />}
            {!t.revealed || amend === t.id ? (
              <ReferenceForm take={t} listeners={listeners} vocab={vocab} busy={busy} onSave={saveReference} onCancel={amend === t.id ? () => setAmend(null) : null} />
            ) : (
              <div className="space-y-1" data-testid="vc-revealed">
                <p className="text-lo">Reference v{t.reference_version} by {t.listener_code} · heard {t.heard}{t.intended === 'speech' && t.heard === 'speech' ? ` · ${t.spoken_as_script ? 'said as written' : t.reference_mode === 'unscorable' ? "can't be scored" : `said: ${(t.reference_items || []).map(r => r.label).join(', ')}`}` : ''}</p>
                <p className="text-lo">Expected {t.intended} · live check: {t.live_decision}{t.voiced_ms != null ? ` (${t.voiced_ms} ms voiced)` : ''}</p>
                {['gemini', 'whisper'].map(e => { const sc = t.scores?.[e]; return (
                  <div key={e} data-testid={`vc-score-${e}`}>
                    <p className="text-mid">{e === 'gemini' ? 'Gemini' : 'Whisper'}: {t[e] == null ? 'no answer' : `“${t[e]}”`}{e === 'whisper' && t.whisper_review && !t.whisper_review.accepted ? ` (fallback would refuse: ${t.whisper_review.reason})` : ''}{sc ? ` → ${sc.line}` : ''}{sc?.unexplained?.length ? ` (unexplained: ${sc.unexplained.join(', ')})` : ''}</p>
                    {sc && sc.auto_line === 'needs a hand check' && !sc.hand && (
                      <select defaultValue="" onChange={ev => ev.target.value && handCheck(t, e, ev.target.value)} aria-label={`${e} line outcome by hand`} className={`w-full ${field}`} style={{ minHeight: 34 }} data-testid="vc-hand-check">
                        <option value="">Needs a hand check: choose the outcome…</option>{(st.line_outcomes || []).filter(o => o !== 'provider error' && o !== 'empty answer').map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    )}
                  </div>
                ); })}
                {(t.rule3 || []).map(l => (
                  <div key={l.engine} className="text-lo" data-testid="vc-rule3">
                    <p>Rule 3 · {l.engine}: {l.hand_verdict ? `${l.hand_verdict.verdict} (by hand)` : l.result}{l.problems.length ? ` · ${l.problems.join('; ')}` : ''}{l.hand_reasons.length && !l.hand_verdict ? ` · look at: ${l.hand_reasons.join('; ')}` : ''}</p>
                    {l.result === 'needs a hand check' && !l.hand_verdict && l.judgment_id && (
                      <select defaultValue="" onChange={ev => ev.target.value && handVerdict(l.judgment_id, ev.target.value)} aria-label={`${l.engine} preview verdict by hand`} className={`w-full ${field}`} style={{ minHeight: 34 }}>
                        <option value="">Decide this preview by hand…</option>{PREVIEW_VERDICTS.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setAmend(t.id)} className="text-gold underline" style={{ minHeight: 32 }}>Change the reference (a new version)</button>
              </div>
            )}
          </div>
        ))}
      </Section>

      <Section title="Part C: everyday path tries" count={`${rows.filter(r => (r.captures || []).length).length}/${st.partc.plan.length}`} open={!!open.partc} onToggle={() => toggle('partc')} testid="vc-partc">
        <p className="text-caption text-mid leading-snug">One try at a time, one operator. Arm it for the test account (the day is saved as the baseline), record the line in the AI log box, then Read back, Restore and Finish. A try is finished only when the day equals its baseline and the Voice backup switch is off; until then it stays here. Controlled tries 1–32 send the recording to the server; Gemini tries need the switch off, Whisper tries on. Never Apply a wrong, extra or unclear preview.</p>
        {unresolved.map(s => (
          <div key={s.id} className="space-y-1.5 rounded-xl border border-hair px-3 py-2" data-testid="vc-open-try">
            <p className="text-caption text-white">Try {s.trial_no} ({s.route}) · session {s.id} · {s.capture_stopped_at ? 'recording stopped' : st.partc.armed?.session_id === s.id && st.partc.armed?.recording ? `recording until ${when(st.partc.armed.ends_at)}` : 'recording window ended'}</p>
            {s.resolution?.outstanding?.length > 0 && <p className="text-caption text-gold">Still to do: {s.resolution.outstanding.join(' ')}</p>}
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => sAct(s, 'readback')} disabled={busy} className={`${btn} border-white/[0.16] text-white`} style={{ minHeight: 36 }} data-testid="vc-readback">Read back</button>
              <button type="button" onClick={() => sAct(s, 'restore')} disabled={busy} className={`${btn} border-white/[0.16] text-white`} style={{ minHeight: 36 }} data-testid="vc-restore">Restore day</button>
              <button type="button" onClick={() => sAct(s, 'finish')} disabled={busy} className={`${btn} ${on}`} style={{ minHeight: 36 }} data-testid="vc-finish">Finish</button>
            </div>
          </div>
        ))}
        {!unresolved.length && (
          <div className="flex gap-2">
            <select value={arm.trial} onChange={e => setArm({ ...arm, trial: e.target.value })} aria-label="Try" style={{ minHeight: 40 }} className={`w-24 ${field}`}>
              {st.partc.plan.map(t => <option key={t.trial} value={t.trial}>Try {t.trial}</option>)}
              {(st.partc.natural || []).map(t => <option key={t.trial} value={t.trial}>Natural {t.trial}</option>)}
            </select>
            <select value={arm.account} onChange={e => setArm({ ...arm, account: e.target.value })} aria-label="Test account" style={{ minHeight: 40 }} className={`flex-1 min-w-0 ${field}`}>
              <option value="">Test account…</option>{all.filter(m => m.active !== false).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button type="button" onClick={armTry} disabled={!arm.account || busy} className={`${btn} ${on}`} style={{ minHeight: 40 }} data-testid="vc-arm">Arm</button>
          </div>
        )}
        {st.partc.plan.map(t => {
          const r = rows.find(x => x.trial_no === t.trial) || {}; const c = (r.captures || []).filter(x => x.kind === 'server recording' || x.kind === 'on-device dictation').slice(-1)[0];
          return (
            <div key={t.trial} className="text-caption leading-snug border-t border-hair pt-1.5">
              <p className="text-white"><b>{t.trial}</b> · {t.speaker} · {LANG[t.lang]} · {t.path === 'gemini' ? 'Gemini (switch off)' : 'Whisper (switch on)'} · <span className="text-mid">{t.say}</span></p>
              {c ? <p className="text-mid">Actual path: {c.actual_path || c.answered_by}{(r.captures || []).length > 1 ? ` · ${(r.captures || []).length} events` : ''} · {c.rejected ? `refused: ${c.rejected}` : `“${c.transcript || ''}”`}{c.session_match && c.session_match !== 'yes' ? ' · session not confirmed by the app' : ''}{r.finished_at ? ' · finished' : ''}</p>
                : <p className="text-lo">Expected: {t.expect}</p>}
              {c && (mark?.trial === t.trial ? (
                <div className="space-y-1 mt-1">
                  {t.items.map(it => (
                    <label key={it} className="flex items-center gap-2"><span className="flex-1 text-mid">{it}</span>
                      {[[true, 'right'], [false, 'wrong']].map(([v, l]) => <button key={l} type="button" aria-pressed={mark.body.items.find(i => i.label === it)?.ok === v}
                        onClick={() => setMark(m => ({ ...m, body: { ...m.body, items: [...m.body.items.filter(i => i.label !== it), { label: it, ok: v }] } }))}
                        className={`${btn} ${mark.body.items.find(i => i.label === it)?.ok === v ? on : off}`} style={{ minHeight: 32 }}>{l}</button>)}
                    </label>
                  ))}
                  {[['applied', 'Applied?'], ['day_correct', 'Day correct?']].map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2"><span className="flex-1 text-mid">{l}</span>
                      {[[true, 'yes'], [false, 'no']].map(([v, vl]) => <button key={vl} type="button" aria-pressed={mark.body[k] === v} onClick={() => setMark(m => ({ ...m, body: { ...m.body, [k]: v } }))}
                        className={`${btn} ${mark.body[k] === v ? on : off}`} style={{ minHeight: 32 }}>{vl}</button>)}
                    </label>
                  ))}
                  <input value={mark.body.notes || ''} onChange={e => setMark(m => ({ ...m, body: { ...m.body, notes: e.target.value } }))} maxLength={500} placeholder="Notes (no names)" aria-label="Notes" className={`w-full ${field}`} style={{ minHeight: 36 }} />
                  <div className="flex gap-2"><button type="button" onClick={saveMark} disabled={busy} className={`flex-1 ${btn} ${on}`} style={{ minHeight: 36 }}>Save</button>
                    <button type="button" onClick={() => setMark(null)} className={`${btn} ${off}`} style={{ minHeight: 36 }}>Cancel</button></div>
                </div>
              ) : (
                <button type="button" onClick={() => setMark({ trial: t.trial, body: { items: r.items || [], applied: r.applied ?? null, day_correct: r.day_correct ?? null, notes: r.notes || '' } })}
                  className="text-gold underline" style={{ minHeight: 32 }}>{r.items ? 'Edit marks' : 'Mark the outcome'}</button>
              ))}
            </div>
          );
        })}
      </Section>

      {rows.filter(r => r.trial_no > 32).length > 0 && (
        <div className="text-caption leading-snug" data-testid="vc-natural">
          {rows.filter(r => r.trial_no > 32).map(r => (
            <p key={r.trial_no} className="text-mid border-t border-hair pt-1.5"><b className="text-white">Natural {r.trial_no}</b> · {(r.captures || []).filter(c => c.kind === 'server recording' || c.kind === 'on-device dictation').map(c => c.actual_path).join(' · ') || 'nothing recorded'}</p>
          ))}
        </div>
      )}
      <button type="button" onClick={download} style={{ minHeight: 44 }} data-testid="vc-download" className="w-full rounded-xl border border-gold text-gold text-sm font-bold">Download the workbook (Excel)</button>
    </div>
  );
}
