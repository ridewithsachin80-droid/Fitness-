/**
 * DietPlanStudio — the coach's diet plan workspace (Phase 1).
 *
 * One member, one place: write a brief, get a draft, read the flags and
 * checks, change what is wrong, approve. Nothing here reaches the member
 * until Approve — and an approved plan is never edited, only replaced by a
 * new version.
 *
 * The server decides everything that matters (flags, checks, versions, what
 * the member sees). This component only shows it and sends the coach's
 * choices back, so it never shows a state the server has not confirmed.
 */
import SwapsPanel from './SwapsPanel';
import { shareOrDownload } from '../../utils/shareFile';
import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import { Card, SectionTitle } from '../UI';
import { Eyebrow, Pressable, SkeletonText } from '../primitives';
import { haptic } from '../../store/settingsStore';
import { formatDate } from '../../constants';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TARGETS = [['kcal', 'kcal'], ['protein', 'protein g'], ['carbs', 'carbs g'], ['fat', 'fat g']];
const input = 'w-full text-sm rounded-xl px-3 border border-white/[0.12] bg-transparent text-white focus:outline-none focus:ring-2 focus:ring-gold/30';

const dayList = (ws) => (ws.length === 7 ? 'every day' : ws.map(w => DAYS[w]).join(', '));
const kcalOf = (it) => Math.round((Number(it.grams) || 0) * (Number(it.per_100g?.calories) || 0) / 100);

function Notice({ tone = 'warn', children }) {
  const c = tone === 'error' ? 'border-red-400/30 bg-red-400/[0.08] text-red-300' : 'border-amber-400/30 bg-amber-400/[0.08] text-amber-200';
  return <p className={`text-caption leading-relaxed rounded-xl px-3 py-2 border ${c}`}>{children}</p>;
}

function Differences({ diff, version }) {
  if (!diff) return null;
  if (diff.same) return <p className="text-caption text-mid">No differences from version {version} yet.</p>;
  const rows = [
    ...diff.targets.map(t => `${t.key}: ${t.from ?? 'not set'} to ${t.to ?? 'not set'}`),
    ...diff.changed.map(c => `${c.meal}: ${c.name} ${c.from} g to ${c.to} g (${dayList(c.weekdays)})`),
    ...diff.added.map(c => `${c.meal}: added ${c.name} ${c.grams} g (${dayList(c.weekdays)})`),
    ...diff.removed.map(c => `${c.meal}: removed ${c.name} (${dayList(c.weekdays)})`),
    ...diff.avoid.added.map(x => `Avoid list: added ${x}`),
    ...diff.avoid.removed.map(x => `Avoid list: removed ${x}`),
    ...diff.cautions.added.map(x => `Caution added: ${x}`),
    ...diff.cautions.removed.map(x => `Caution removed: ${x}`),
  ];
  return (
    <div data-testid="plan-diff">
      <Eyebrow className="mb-1">Changes from version {version}</Eyebrow>
      <ul className="space-y-1">
        {rows.map((r, i) => <li key={i} className="text-caption text-white leading-snug">{r}</li>)}
      </ul>
    </div>
  );
}

export default function DietPlanStudio({ memberId, memberName, onApplied }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState('');
  const [error, setError]     = useState('');
  const [brief, setBrief]     = useState('');
  const [change, setChange]   = useState('');
  const [day, setDay]         = useState(0);
  const [ack, setAck]         = useState(false);
  const [start, setStart]     = useState('');
  const [targets, setTargets] = useState({});
  // Fit to target: the server's preview of what it would change. Shown before
  // anything is saved, and thrown away by any other action.
  const [fit, setFit]         = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get(`/diet-plans/member/${memberId}`);
      setData(d);
      setTargets(d.draft?.targets || {});
      setStart('');
      setAck(false);
      setFit(null);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load the diet plan.');
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Every action goes through here: one busy label, one error line, and the
  // screen is re-read from the server afterwards instead of guessed.
  const run = async (label, fn) => {
    haptic(10);
    setBusy(label);
    setError('');
    try { await fn(); await load(); }
    catch (err) { setError(err.response?.data?.error || 'That did not work. Nothing was changed.'); }
    finally { setBusy(''); }
  };

  if (loading) return <Card><SectionTitle>Diet plan</SectionTitle><SkeletonText lines={3} /></Card>;

  const draft   = data?.draft;
  const inForce = data?.in_force;
  const today   = data?.today;
  // First name for short labels, skipping a title: "Mrs. Padmini" -> "Padmini".
  const parts   = String(memberName || '').trim().split(/\s+/).filter(Boolean);
  const first   = (parts.length > 1 && /^(mr|mrs|ms|miss|dr|smt|shri|sri)\.?$/i.test(parts[0]) ? parts[1] : parts[0]) || 'the member';

  if (!data) {
    return (
      <Card>
        <SectionTitle>Diet plan</SectionTitle>
        <p className="text-caption text-red-400" role="alert">{error || 'Could not load the diet plan.'}</p>
        <Pressable variant="secondary" className="w-full mt-2" onPress={() => { setLoading(true); load(); }}>Try again</Pressable>
      </Card>
    );
  }

  // ── A draft is open ─────────────────────────────────────────────────────────
  if (draft) {
    const errors   = draft.checks.filter(c => c.level === 'error');
    const warnings = draft.checks.filter(c => c.level === 'warn');
    const meals    = draft.days[day] || [];
    const patch    = (body) => api.patch(`/diet-plans/${draft.id}`, body);
    const canFit   = draft.checks.some(c => ['day_over', 'day_under', 'carbs_over'].includes(c.code));
    const dirtyTargets = TARGETS.some(([k]) => (targets[k] ?? '') !== (draft.targets[k] ?? ''));

    return (
      <Card>
        <SectionTitle>Diet plan — draft</SectionTitle>
        <div className="space-y-4" data-testid="diet-draft">
          <div>
            <p className="text-sm font-semibold text-white">{draft.title}</p>
            <p className="text-caption text-mid">
              Version {draft.version}. Not sent. {first} {inForce ? `is still on version ${inForce.version}` : 'has no plan yet'}.
            </p>
          </div>

          {draft.flags.length > 0 && (
            <div data-testid="plan-flags">
              <Eyebrow className="mb-1">On file for {first}</Eyebrow>
              <ul className="space-y-1.5">
                {draft.flags.map((f, i) => (
                  <li key={i} className="text-caption leading-snug">
                    <span className="text-white">{f.text}</span>
                    <span className="text-mid"> — {f.source}{f.date ? `, ${formatDate(f.date)}` : ''}{f.stale ? ' (over 6 months old)' : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {draft.content.adjustments?.length > 0 && (
            <div>
              <Eyebrow className="mb-1">What the AI says it did about them</Eyebrow>
              <ul className="space-y-1">
                {draft.content.adjustments.map((a, i) => (
                  <li key={i} className="text-caption text-mid leading-snug">{a.for ? `${a.for}: ` : ''}{a.note}</li>
                ))}
              </ul>
            </div>
          )}

          {(errors.length > 0 || warnings.length > 0) && (
            <div className="space-y-1.5" data-testid="plan-checks">
              <Eyebrow>Checks</Eyebrow>
              {errors.map((c, i) => <Notice key={`e${i}`} tone="error">Must fix: {c.text}</Notice>)}
              {warnings.map((c, i) => <Notice key={`w${i}`}>{c.text}</Notice>)}
            </div>
          )}

          {draft.checks.some(c => c.code === 'no_nutrition') && (
            <Pressable variant="secondary" className="w-full" disabled={!!busy} data-testid="plan-fill"
              onPress={() => run('fill', () => patch({ fill_nutrition: true }))}>
              {busy === 'fill' ? 'Looking up…' : 'Look up missing calories'}
            </Pressable>
          )}

          {/* Fit to target (Phase 1.3). Arithmetic on the server, not the AI:
              scales the portions that are not fixed so each day lands inside
              the allowed range. Two steps, so the coach sees every change
              before it is saved. */}
          {canFit && !fit && (
            <Pressable variant="secondary" className="w-full" disabled={!!busy} data-testid="plan-fit"
              onPress={async () => {
                haptic(10); setBusy('fit'); setError('');
                try { const { data: d } = await api.post(`/diet-plans/${draft.id}/fit`, {}); setFit(d.fit); }
                catch (err) { setError(err.response?.data?.error || 'That did not work. Nothing was changed.'); }
                finally { setBusy(''); }
              }}>
              {busy === 'fit' ? 'Working it out…' : 'Fit to target'}
            </Pressable>
          )}
          {fit && (
            <div className="rounded-xl border border-gold/30 bg-gold/[0.05] px-3 py-2.5 space-y-2" data-testid="plan-fit-preview">
              <Eyebrow>Fit to target — nothing saved yet</Eyebrow>
              <p className="text-caption text-mid leading-snug">
                Allowed {fit.range.lo} to {fit.range.hi} kcal a day{fit.range.carb_cap ? `, carbs up to ${fit.range.carb_cap} g` : ''}. Fixed items keep their grams.
              </p>
              {fit.changes.length === 0
                ? <p className="text-caption text-white">No portion can be changed.</p>
                : (
                  <ul className="space-y-1">
                    {fit.changes.map((c, i) => (
                      <li key={i} className="text-caption text-white leading-snug">
                        {c.meal}: {c.name} {c.from} g to {c.to} g <span className="text-mid">({dayList(c.weekdays)})</span>
                      </li>
                    ))}
                  </ul>
                )}
              <ul className="space-y-0.5">
                {fit.totals.map(t => (
                  <li key={t.weekday} className={`text-caption leading-snug ${t.fits ? 'text-mid' : 'text-red-300'}`}>
                    {DAYS[t.weekday]}: {t.before.kcal} to {t.after.kcal} kcal{fit.range.carb_cap ? `, carbs ${t.before.carbs} to ${t.after.carbs}\u00a0g` : ''}{t.fits ? '' : ' — still outside'}
                  </li>
                ))}
              </ul>
              {fit.unfit.map((u, i) => <Notice key={i} tone="error">{DAYS[u.weekday]}: {u.reason}</Notice>)}
              {fit.changes.length > 0 && (
                <Pressable variant="primary" className="w-full" disabled={!!busy} data-testid="plan-fit-apply"
                  onPress={() => run('fit-apply', () => api.post(`/diet-plans/${draft.id}/fit`, { apply: true }))}>
                  {busy === 'fit-apply' ? 'Saving…' : 'Save these portions'}
                </Pressable>
              )}
              <Pressable variant="secondary" className="w-full" disabled={!!busy} onPress={() => setFit(null)}>
                Leave the plan as it is
              </Pressable>
            </div>
          )}

          <Differences diff={draft.diff} version={draft.compared_to_version} />

          <div>
            <Eyebrow className="mb-1">Daily targets</Eyebrow>
            <div className="grid grid-cols-4 gap-2">
              {TARGETS.map(([k, label]) => (
                <label key={k} className="block">
                  <input type="number" inputMode="numeric" aria-label={label} value={targets[k] ?? ''} style={{ minHeight: 44 }}
                    onChange={e => setTargets(t => ({ ...t, [k]: e.target.value === '' ? null : parseInt(e.target.value) }))}
                    className={`${input} text-center font-display`} />
                  <span className="block text-center text-caption text-mid mt-0.5">{label}</span>
                </label>
              ))}
            </div>
            {dirtyTargets && (
              <Pressable variant="secondary" className="w-full mt-2" disabled={!!busy}
                onPress={() => run('targets', () => patch({ targets }))}>
                {busy === 'targets' ? 'Saving…' : 'Save targets and re-check'}
              </Pressable>
            )}
          </div>

          <div>
            <Eyebrow className="mb-1">Meals</Eyebrow>
            <div className="flex gap-1.5 flex-wrap mb-2" role="tablist" aria-label="Weekday">
              {DAYS.map((d, i) => (
                <button key={d} type="button" role="tab" aria-selected={day === i} onClick={() => setDay(i)} style={{ minHeight: 40 }}
                  className={`text-caption font-semibold rounded-full px-3 border ${day === i ? 'border-gold text-gold' : 'border-white/[0.12] text-mid'}`}>
                  {d}
                </button>
              ))}
            </div>
            {meals.length === 0 && <p className="text-caption text-mid">No meals on this day.</p>}
            {meals.map(m => (
              <div key={m.meal} className="rounded-xl bg-white/[0.03] border border-hair px-3 py-2.5 mb-2">
                <div className="flex justify-between text-sm font-semibold text-white">
                  <span>{m.time ? `${m.time} ` : ''}{m.meal}</span>
                  <span className="text-mid font-normal">{m.items.reduce((a, it) => a + kcalOf(it), 0)} kcal</span>
                </div>
                {m.items.map(it => (
                  <div key={it.id} className="flex items-center gap-2 mt-1.5">
                    <span className="flex-1 text-caption text-white leading-snug">
                      {it.name}
                      {/* Per-food calories, so "120 g brown rice = 434 kcal" is seen before approving. */}
                      <span className={`block ${kcalOf(it) > 0 ? 'text-mid' : 'text-amber-300'}`}>
                        {kcalOf(it) > 0 ? `${kcalOf(it)} kcal` : 'no calorie figure'}
                      </span>
                      {/* Fixed = compulsory: Fit to target leaves these grams alone. */}
                      <button type="button" disabled={!!busy} aria-pressed={!!it.compulsory} style={{ minHeight: 32 }}
                        aria-label={it.compulsory ? `${it.name}: portion is fixed. Tap to let it change.` : `${it.name}: fix this portion`}
                        className={`block text-left text-caption font-semibold ${it.compulsory ? 'text-gold' : 'text-lo underline'}`}
                        onClick={() => run('edit', () => patch({ edits: [{ meal: m.meal, name: it.name, compulsory: !it.compulsory }] }))}>
                        {it.compulsory ? 'Fixed ✓' : 'Fix portion'}
                      </button>
                    </span>
                    <input type="number" inputMode="decimal" defaultValue={it.grams} aria-label={`${it.name} grams`} disabled={!!busy}
                      style={{ minHeight: 40, width: 72 }} className={`${input} text-right`}
                      onBlur={e => {
                        const g = parseFloat(e.target.value);
                        if (Number.isFinite(g) && g !== Number(it.grams)) run('edit', () => patch({ edits: [{ meal: m.meal, name: it.name, grams: g }] }));
                      }} />
                    <span className="text-caption text-mid">g</span>
                    <button type="button" disabled={!!busy} style={{ minHeight: 40 }} aria-label={`Remove ${it.name}`}
                      className="text-caption font-bold text-red-400 px-1.5"
                      onClick={() => run('edit', () => patch({ edits: [{ meal: m.meal, name: it.name, remove: true }] }))}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ))}
            <p className="text-caption text-lo">A change to grams, fixing a portion, or removing an item applies to every day that has it. Calorie figures are for the food as eaten, and are estimates unless the food is in your food table.</p>
          </div>

          {draft.content.lab_cautions?.length > 0 && (
            <div data-testid="plan-lab-cautions">
              <Eyebrow className="mb-1">Cautions from lab results and conditions</Eyebrow>
              <ul className="space-y-1">{draft.content.lab_cautions.map((c, i) => <li key={i} className="text-caption text-white leading-snug">{c}</li>)}</ul>
              <p className="text-caption text-lo mt-1">Added by the app from what is on file. A redraft cannot remove them.</p>
            </div>
          )}

          {(draft.content.avoid?.length > 0 || draft.content.cautions?.length > 0) && (
            <div className="space-y-2">
              {draft.content.avoid?.length > 0 && (
                <div><Eyebrow className="mb-1">Avoid</Eyebrow><p className="text-caption text-mid leading-relaxed">{draft.content.avoid.join(', ')}</p></div>
              )}
              {draft.content.cautions?.length > 0 && (
                <div><Eyebrow className="mb-1">Cautions</Eyebrow>
                  <ul className="space-y-1">{draft.content.cautions.map((c, i) => <li key={i} className="text-caption text-mid leading-snug">{c}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          <label className="block">
            <Eyebrow className="mb-1">Tell the AI what to change</Eyebrow>
            <textarea rows={2} value={change} onChange={e => setChange(e.target.value)} disabled={!!busy}
              placeholder="e.g. swap tofu for sprouts in Meal 2, bring calories down to 1,800"
              className={`${input} py-2.5 resize-none`} />
          </label>
          {change.trim().length > 3 && (
            <Pressable variant="secondary" className="w-full" disabled={!!busy}
              onPress={() => run('redraft', async () => { await api.post('/diet-plans/draft', { member_id: memberId, instruction: change.trim() }); setChange(''); })}>
              {busy === 'redraft' ? 'Redrafting…' : 'Redraft with this change'}
            </Pressable>
          )}

          <label className="block">
            <Eyebrow className="mb-1">Starts on</Eyebrow>
            <input type="date" min={today} value={start || today} onChange={e => setStart(e.target.value)} disabled={!!busy}
              style={{ minHeight: 44 }} className={input} />
            {inForce && start && start > today && (
              <span className="block text-caption text-mid mt-1">Version {inForce.version} stays in force until then.</span>
            )}
          </label>

          {warnings.length > 0 && errors.length === 0 && (
            <label className="flex items-start gap-2.5" style={{ minHeight: 44 }}>
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="mt-1 w-5 h-5 accent-gold" />
              <span className="text-caption text-white leading-snug">I have read the {warnings.length === 1 ? 'warning' : `${warnings.length} warnings`} above and want to approve anyway.</span>
            </label>
          )}

          {error && <p className="text-caption text-red-400" role="alert">{error}</p>}

          <Pressable variant="primary" className="w-full" data-testid="plan-approve"
            disabled={!!busy || errors.length > 0 || (warnings.length > 0 && !ack)}
            onPress={() => run('approve', async () => {
              await api.post(`/diet-plans/${draft.id}/approve`, { acknowledge_warnings: ack, effective_from: start || today });
              onApplied?.();
            })}>
            {busy === 'approve' ? 'Approving…' : `Approve and send to ${first}`}
          </Pressable>
          <Pressable variant="danger" className="w-full" disabled={!!busy}
            onPress={() => run('discard', () => api.post(`/diet-plans/${draft.id}/discard`))}>
            {busy === 'discard' ? 'Discarding…' : 'Discard this draft'}
          </Pressable>
        </div>
      </Card>
    );
  }

  // ── No draft: the plan in force, and a way to start one ─────────────────────
  return (
    <Card>
      <SectionTitle>Diet plan</SectionTitle>
      <div className="space-y-4" data-testid="diet-studio">
        {inForce ? (
          <div className="rounded-xl bg-white/[0.03] border border-hair px-3 py-2.5">
            <p className="text-sm font-semibold text-white">{inForce.title}</p>
            <p className="text-caption text-mid">
              Version {inForce.version}, in force since {formatDate(inForce.effective_from)}.
              {inForce.targets?.kcal ? ` ${inForce.targets.kcal} kcal a day.` : ''}
            </p>
            {data.upcoming && (
              <p className="text-caption text-gold mt-1">Version {data.upcoming.version} takes over on {formatDate(data.upcoming.effective_from)}.</p>
            )}
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Pressable variant="secondary" className="w-full" disabled={!!busy}
                onPress={() => run('revise', () => api.post(`/diet-plans/member/${memberId}/revise`))}>
                {busy === 'revise' ? 'Opening…' : 'Revise this plan'}
              </Pressable>
              {/* Phase 5: the PDF to send on WhatsApp (share sheet on a phone). */}
              <Pressable variant="secondary" className="w-full" disabled={!!busy} data-testid="studio-pdf"
                onPress={async () => { setBusy('pdf'); try { await shareOrDownload(`/diet-plans/${inForce.id}/pdf`, { title: inForce.title }); } catch (e) { setError('Could not make the PDF just now.'); } finally { setBusy(''); } }}>
                {busy === 'pdf' ? 'Making PDF…' : 'PDF to send'}
              </Pressable>
            </div>
            {/* Phase 6: the member's approved swaps, AI suggestions and requests. */}
            <div className="mt-3"><SwapsPanel memberId={memberId} memberName={memberName} /></div>
          </div>
        ) : (
          <p className="text-caption text-mid">{first} has no diet plan yet.</p>
        )}

        <label className="block">
          <Eyebrow className="mb-1">{inForce ? 'Or draft a new plan from a brief' : 'Draft a plan from a brief'}</Eyebrow>
          <textarea rows={5} value={brief} onChange={e => setBrief(e.target.value)} disabled={!!busy}
            placeholder="e.g. Low carb, 3 meals, 16:8 fasting. Paneer and curd in every meal. Pure veg, no egg. Gym 3 days."
            className={`${input} py-2.5 resize-none`} />
          <span className="block text-caption text-lo mt-1">
            Height, weight, age and out-of-range lab results on file are added for you.
          </span>
        </label>
        {error && <p className="text-caption text-red-400" role="alert">{error}</p>}
        <Pressable variant="primary" className="w-full" disabled={!!busy || brief.trim().length < 10} data-testid="plan-draft"
          onPress={() => run('draft', async () => { await api.post('/diet-plans/draft', { member_id: memberId, brief: brief.trim() }); setBrief(''); })}>
          {busy === 'draft' ? 'Drafting… this takes a few seconds' : 'Draft the plan'}
        </Pressable>
        <p className="text-caption text-lo leading-relaxed">
          Already have a plan as a PDF or photo? Attach it in the Coach assistant on the members page. Once you apply it, it appears here as a version.
        </p>

        {data.history?.length > 0 && (
          <div data-testid="plan-history">
            <Eyebrow className="mb-1">Versions</Eyebrow>
            <ul className="space-y-1">
              {data.history.map(h => (
                <li key={h.id} className="flex justify-between gap-2 text-caption">
                  <span className="text-white">Version {h.version}: {h.title}{h.source === 'import' ? ' (from coach chat)' : ''}</span>
                  <span className={h.in_force ? 'text-gold' : 'text-mid'}>{h.in_force ? 'In force' : `From ${formatDate(h.effective_from)}`}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
