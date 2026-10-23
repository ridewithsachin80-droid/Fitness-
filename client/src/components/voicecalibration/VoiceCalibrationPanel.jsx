import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Eyebrow } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { shareOrDownload } from '../../utils/shareFile';

/**
 * VoiceCalibrationPanel — Fixes-2x, admin dashboard, TEST SERVER ONLY (hidden elsewhere: the API is 404).
 * Voice calibration round 1 (B18/B19): six volunteers, 144 planned recording slots, a fluent
 * speaker's wording check before any line can be recorded, a "heard speech" label for every take,
 * the 32 planned Part C tries on the everyday path, and the workbook (codes only, no names, no audio).
 */
const GROUP = { kn: 'Kannada speaker', hi: 'Hindi speaker', en: 'English speaker' };
const LANG = { kn: 'Kannada', hi: 'Hindi', en: 'English' };
const PLACE = { q: 'quiet', n: 'noise' };
const when = (t) => { try { return new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const btn = 'rounded-xl border text-caption font-semibold px-3 disabled:opacity-40';
const field = 'rounded-xl bg-charcoal border border-white/[0.12] text-caption text-white px-2';

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

export default function VoiceCalibrationPanel() {
  const [st, setSt] = useState(null);
  const [all, setAll] = useState([]);
  const [takes, setTakes] = useState([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState({ people: true });
  const [inv, setInv] = useState({ member: '', group: 'kn', note: '' });
  const [check, setCheck] = useState({});
  const [filter, setFilter] = useState('');
  const [arm, setArm] = useState({ trial: '1', account: '' });
  const [mark, setMark] = useState(null);
  const [ref, setRef] = useState({});   // the listener's "what was actually said", per take
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
  const recorded = people.reduce((n, p) => n + p.slots_recorded, 0);
  const invite = () => act(() => api.post('/voice-calibration/admin/invite', { member_id: Number(inv.member), group: inv.group, profile_note: inv.note || undefined }), () => setInv({ member: '', group: inv.group, note: '' }));
  const remove = (p) => { if (window.confirm(`Remove ${p.code} and delete all their recordings?`)) act(() => api.delete(`/voice-calibration/admin/participant/${p.id}`)); };
  const confirmWording = (lang) => act(() => api.post('/voice-calibration/admin/wording', { lang, confirmed_by: check[lang]?.by || '', note: check[lang]?.note || undefined }), () => setCheck(c => ({ ...c, [lang]: {} })));
  const revoke = (lang) => { if (window.confirm(`Lock the ${LANG[lang]} lines again?`)) act(() => api.post('/voice-calibration/admin/wording/revoke', { lang })); };
  const label = (t, body) => act(() => api.post('/voice-calibration/admin/label', { take_id: t.id, ...body }), loadTakes);
  const saveRef = (t) => label(t, { reference_text: ref[t.id]?.text || null, reference_items: (t.items || []).filter(i => ref[t.id]?.[i.label] !== undefined && ref[t.id][i.label] !== '').map(i => ({ label: i.label, n: Number(ref[t.id][i.label]) })) });
  const previewEval = () => act(() => api.post('/voice-calibration/admin/preview-eval', {}, { timeout: 300000 }), (r) => setMsg(`Rule 3 previews: ${r.data.judged} leg(s) judged, ${r.data.parser_calls} parser call(s)${r.data.more ? '. More waiting: tap again.' : '.'}`));
  const readback = () => act(() => api.post('/voice-calibration/admin/partc/readback'), (r) => setMsg(r.data.diff.same ? 'Read back: the day is unchanged since arming.' : `Read back: ${r.data.diff.added_foods.length} food(s) added, ${r.data.diff.removed_foods.length} removed; changed: ${r.data.diff.changed_fields.map(f => f.field).join(', ') || 'no other field'}; workouts ${r.data.diff.workouts_changed ? 'changed' : 'same'}.`));
  const restore = () => act(() => api.post('/voice-calibration/admin/partc/restore'), (r) => setMsg(r.data.ok ? 'Restored: the whole day equals the baseline.' : 'NOT restored: the day still differs from the baseline. Check before going on.'));
  const finish = () => act(() => api.post('/voice-calibration/admin/partc/finish'), (r) => setMsg(r.data.warning || `Try ${r.data.trial} finished: day restored, Voice backup switch verified off.`));
  const remeasure = () => act(() => api.post('/voice-calibration/admin/remeasure', {}, { timeout: 180000 }), (r) => setMsg(`Measured again: ${r.data.checked} take(s), ${r.data.same} the same, ${r.data.different} different${r.data.more ? '. More waiting: tap again.' : '.'}`));
  const armTry = () => act(() => api.post('/voice-calibration/admin/partc/arm', { trial: Number(arm.trial), account_id: Number(arm.account) }), (r) => setMsg(r.data.warning || `Try ${r.data.trial} is armed for ${st.partc.arm_minutes} minutes. Record it on the test account now.`));
  const saveMark = () => act(() => api.put(`/voice-calibration/admin/partc/${mark.trial}`, mark.body), () => setMark(null));
  const download = async () => {
    haptic(10); setMsg('');
    try { await shareOrDownload('/voice-calibration/admin/export.xlsx', { filename: 'FitLife-Voice-Calibration.xlsx', title: 'FitLife voice calibration', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }
    catch (e) { setMsg('Could not make the file just now. Try again.'); }
  };
  const rows = st.partc.rows || [];
  const shownTakes = takes.filter(t => !filter || t.code === filter);

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
            <span className="flex-1 min-w-0 truncate text-mid">{p.name} · {GROUP[p.group]}{p.profile_note ? ` · ${p.profile_note}` : ''} · {p.consented ? `${p.slots_recorded}/${p.slots_planned}` : 'not agreed yet'}</span>
            <button type="button" onClick={() => remove(p)} disabled={busy} className={`${btn} border-white/[0.16] text-mid`} style={{ minHeight: 36 }}>Remove</button>
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
            <button type="button" onClick={invite} disabled={!inv.member || busy} className={`w-full ${btn} border-gold text-gold`} style={{ minHeight: 40 }} data-testid="vc-invite-send">Invite</button>
          </div>
        )}
      </Section>

      <Section title="Wording check (before any recording)" count={`${st.wording.filter(w => w.confirmed).length}/3 confirmed`} open={!!open.words} onToggle={() => toggle('words')} testid="vc-words">
        <p className="text-caption text-mid leading-snug">A fluent speaker reads each language's lines aloud and confirms the words are natural and correct. Until then those lines cannot be recorded. Editing a line later locks it again.</p>
        {st.wording.map(w => (
          <div key={w.lang} className="rounded-xl border border-hair px-3 py-2 space-y-1.5" data-testid={`vc-words-${w.lang}`}>
            <p className="text-caption font-semibold text-white">{w.name}: {w.confirmed ? `confirmed by ${w.confirmed.by} · ${when(w.confirmed.at)}` : w.void ? 'check void (lines changed), locked' : 'not confirmed, locked'}</p>
            <ul className="text-caption text-mid space-y-0.5">{w.lines.map(l => <li key={l.id}><b className="text-white">{l.id}</b> {l.say} <span className="text-lo">({l.items.join(' · ')})</span></li>)}</ul>
            {w.confirmed ? (
              <button type="button" onClick={() => revoke(w.lang)} disabled={busy} className={`${btn} border-white/[0.16] text-mid`} style={{ minHeight: 36 }}>Lock again</button>
            ) : (
              <div className="flex gap-2">
                <input value={check[w.lang]?.by || ''} onChange={e => setCheck({ ...check, [w.lang]: { ...check[w.lang], by: e.target.value } })} maxLength={80} placeholder={`Who checked (fluent in ${w.name})`} aria-label={`Who checked the ${w.name} lines`} style={{ minHeight: 40 }} className={`flex-1 min-w-0 ${field}`} />
                <button type="button" onClick={() => confirmWording(w.lang)} disabled={busy || !(check[w.lang]?.by || '').trim()} className={`${btn} border-gold text-gold`} style={{ minHeight: 40 }} data-testid={`vc-confirm-${w.lang}`}>Confirm</button>
              </div>
            )}
          </div>
        ))}
      </Section>

      <Section title="Takes (listen and label)" count={takes.length ? `${takes.length} kept` : ''} open={!!open.takes} onToggle={() => toggle('takes')} testid="vc-takes">
        <div className="flex gap-2">
          <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Volunteer" style={{ minHeight: 40 }} className={`flex-1 min-w-0 ${field}`}>
            <option value="">Every volunteer</option>{people.map(p => <option key={p.code} value={p.code}>{p.code}</option>)}
          </select>
          <button type="button" onClick={remeasure} disabled={busy} className={`${btn} border-white/[0.16] text-mid`} style={{ minHeight: 40 }}>Measure again</button>
        </div>
        <button type="button" onClick={previewEval} disabled={busy} className={`w-full ${btn} border-white/[0.16] text-mid`} style={{ minHeight: 40 }} data-testid="vc-preview-eval">Check previews of newly admitted takes (rule 3)</button>
        {!shownTakes.length && <p className="text-caption text-lo">No takes yet.</p>}
        {shownTakes.map(t => (
          <div key={t.id} className="text-caption leading-snug border-t border-hair pt-2" data-testid="vc-take">
            <p className="text-white"><b>{t.code}</b> · {t.slot} · take {t.take_no}{t.current ? '' : ' (kept, superseded)'}{t.retake_reason ? ` · again: ${t.retake_reason}` : ''}</p>
            <p className="text-mid">{t.say}</p>
            {t.audio_url && <audio controls preload="none" src={t.audio_url} className="w-full my-1" />}
            <p className="text-lo">Expected {t.intended} · live check: {t.live_decision}{t.voiced_ms != null ? ` (${t.voiced_ms} ms voiced)` : ''}</p>
            <p className="text-mid">Gemini: {t.gemini == null ? 'no answer' : `“${t.gemini}”`} · Whisper: {t.whisper == null ? 'no answer' : `“${t.whisper}”`}{t.whisper_review && !t.whisper_review.accepted ? ` (fallback would refuse: ${t.whisper_review.reason})` : ''}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1" data-testid="vc-heard">
              <span className="text-lo">Heard:</span>
              {[['speech', 'Speech'], ['no_speech', 'No speech'], ['uncertain', 'Unsure'], [null, 'Clear']].map(([v, l]) => (
                <button key={l} type="button" onClick={() => label(t, { heard: v })} disabled={busy} aria-pressed={t.heard === v}
                  className={`${btn} ${t.heard === v && v !== null ? 'border-gold text-gold' : 'border-white/[0.16] text-mid'}`} style={{ minHeight: 34 }}>{l}</button>
              ))}
            </div>
            {t.intended === 'speech' && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1" data-testid="vc-as-written">
                <span className="text-lo">Said as written?</span>
                {[[true, 'Yes'], [false, 'No'], [null, 'Clear']].map(([v, l]) => (
                  <button key={l} type="button" onClick={() => label(t, { spoken_as_script: v })} disabled={busy} aria-pressed={t.spoken_as_script === v}
                    className={`${btn} ${t.spoken_as_script === v && v !== null ? 'border-gold text-gold' : 'border-white/[0.16] text-mid'}`} style={{ minHeight: 34 }}>{l}</button>
                ))}
              </div>
            )}
            {t.spoken_as_script === false && (
              <div className="space-y-1 mt-1" data-testid="vc-reference">
                <input value={ref[t.id]?.text ?? (t.reference_text || '')} onChange={e => setRef(r => ({ ...r, [t.id]: { ...r[t.id], text: e.target.value } }))} maxLength={500} placeholder="What was actually said" aria-label="What was actually said" className={`w-full ${field}`} style={{ minHeight: 36 }} />
                {(t.items || []).filter(i => i.n != null).map(i => (
                  <label key={i.label} className="flex items-center gap-2"><span className="flex-1 text-mid">{i.label}: number actually said</span>
                    <input inputMode="decimal" value={ref[t.id]?.[i.label] ?? (t.reference_items || []).find(r => r.label === i.label)?.n ?? ''} onChange={e => setRef(r => ({ ...r, [t.id]: { ...r[t.id], [i.label]: e.target.value } }))} aria-label={`${i.label}: number actually said`} className={`w-20 ${field}`} style={{ minHeight: 34 }} /></label>
                ))}
                <button type="button" onClick={() => saveRef(t)} disabled={busy} className={`${btn} border-gold text-gold`} style={{ minHeight: 34 }}>Save what was said</button>
              </div>
            )}
          </div>
        ))}
      </Section>

      <Section title="Part C: everyday path tries" count={`${rows.filter(r => (r.captures || []).length).length}/${st.partc.plan.length}`} open={!!open.partc} onToggle={() => toggle('partc')} testid="vc-partc">
        <p className="text-caption text-mid leading-snug">One try at a time, one operator. Arm it for the test account (the day is saved as the baseline), record the line in the AI log box, then Read back, Restore and Finish. Controlled tries 1–32 send the recording to the server; Gemini tries need the Voice backup switch off, Whisper tries on. Natural observations record whatever the phone does. Never Apply a wrong, extra or unclear preview.</p>
        {st.partc.armed ? (
          <div className="space-y-1.5" data-testid="vc-open-try">
            <p className="text-caption text-white">Try {st.partc.armed.trial_no} ({st.partc.armed.route}) open for {st.partc.armed.name}{st.partc.armed.recording ? ` · recording until ${when(st.partc.armed.ends_at)}` : ' · recording window ended'}</p>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={readback} disabled={busy} className={`${btn} border-white/[0.16] text-white`} style={{ minHeight: 36 }} data-testid="vc-readback">Read back</button>
              <button type="button" onClick={restore} disabled={busy} className={`${btn} border-white/[0.16] text-white`} style={{ minHeight: 36 }} data-testid="vc-restore">Restore day</button>
              <button type="button" onClick={finish} disabled={busy} className={`${btn} border-gold text-gold`} style={{ minHeight: 36 }} data-testid="vc-finish">Finish</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <select value={arm.trial} onChange={e => setArm({ ...arm, trial: e.target.value })} aria-label="Try" style={{ minHeight: 40 }} className={`w-24 ${field}`}>
              {st.partc.plan.map(t => <option key={t.trial} value={t.trial}>Try {t.trial}</option>)}
              {(st.partc.natural || []).map(t => <option key={t.trial} value={t.trial}>Natural {t.trial}</option>)}
            </select>
            <select value={arm.account} onChange={e => setArm({ ...arm, account: e.target.value })} aria-label="Test account" style={{ minHeight: 40 }} className={`flex-1 min-w-0 ${field}`}>
              <option value="">Test account…</option>{all.filter(m => m.active !== false).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button type="button" onClick={armTry} disabled={!arm.account || busy} className={`${btn} border-gold text-gold`} style={{ minHeight: 40 }} data-testid="vc-arm">Arm</button>
          </div>
        )}
        {st.partc.plan.map(t => {
          const r = rows.find(x => x.trial_no === t.trial) || {}; const c = (r.captures || []).find(x => x.kind !== 'preview');
          return (
            <div key={t.trial} className="text-caption leading-snug border-t border-hair pt-1.5">
              <p className="text-white"><b>{t.trial}</b> · {t.speaker} · {LANG[t.lang]} · {t.path === 'gemini' ? 'Gemini (switch off)' : 'Whisper (switch on)'} · <span className="text-mid">{t.say}</span></p>
              {c ? <p className="text-mid">Actual path: {c.actual_path || c.answered_by}{(r.captures || []).length > 1 ? ` · ${(r.captures || []).length} events` : ''} · {c.rejected ? `refused: ${c.rejected}` : `“${c.transcript || ''}”`}{r.cleanup ? (r.cleanup.ok ? ' · day restored' : ' · DAY NOT RESTORED') : ''}</p>
                : <p className="text-lo">Expected: {t.expect}</p>}
              {c && (mark?.trial === t.trial ? (
                <div className="space-y-1 mt-1">
                  {t.items.map(it => (
                    <label key={it} className="flex items-center gap-2"><span className="flex-1 text-mid">{it}</span>
                      {[[true, 'right'], [false, 'wrong']].map(([v, l]) => <button key={l} type="button" aria-pressed={mark.body.items.find(i => i.label === it)?.ok === v}
                        onClick={() => setMark(m => ({ ...m, body: { ...m.body, items: [...m.body.items.filter(i => i.label !== it), { label: it, ok: v }] } }))}
                        className={`${btn} ${mark.body.items.find(i => i.label === it)?.ok === v ? 'border-gold text-gold' : 'border-white/[0.16] text-mid'}`} style={{ minHeight: 32 }}>{l}</button>)}
                    </label>
                  ))}
                  {[['applied', 'Applied?'], ['day_correct', 'Day correct?']].map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2"><span className="flex-1 text-mid">{l}</span>
                      {[[true, 'yes'], [false, 'no']].map(([v, vl]) => <button key={vl} type="button" aria-pressed={mark.body[k] === v} onClick={() => setMark(m => ({ ...m, body: { ...m.body, [k]: v } }))}
                        className={`${btn} ${mark.body[k] === v ? 'border-gold text-gold' : 'border-white/[0.16] text-mid'}`} style={{ minHeight: 32 }}>{vl}</button>)}
                    </label>
                  ))}
                  <input value={mark.body.notes || ''} onChange={e => setMark(m => ({ ...m, body: { ...m.body, notes: e.target.value } }))} maxLength={500} placeholder="Notes" aria-label="Notes" className={`w-full ${field}`} style={{ minHeight: 36 }} />
                  <div className="flex gap-2"><button type="button" onClick={saveMark} disabled={busy} className={`flex-1 ${btn} border-gold text-gold`} style={{ minHeight: 36 }}>Save</button>
                    <button type="button" onClick={() => setMark(null)} className={`${btn} border-white/[0.16] text-mid`} style={{ minHeight: 36 }}>Cancel</button></div>
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
            <p key={r.trial_no} className="text-mid border-t border-hair pt-1.5"><b className="text-white">Natural {r.trial_no}</b> · {(r.captures || []).filter(c => c.kind !== 'preview').map(c => c.actual_path).join(' · ') || 'nothing recorded'}</p>
          ))}
        </div>
      )}
      <button type="button" onClick={download} style={{ minHeight: 44 }} data-testid="vc-download" className="w-full rounded-xl border border-gold text-gold text-sm font-bold">Download the workbook (Excel)</button>
    </div>
  );
}
