/**
 * EvalSamples.jsx — the AI eval set, browsable (Sprint L1).
 *
 * Every time a member fixes what the AI logged, or a coach switches off an
 * action it proposed, that correction is stored as a test case: a real message
 * with a known-correct answer. This screen is where those get looked at.
 *
 * The one action here is Dismiss, and it matters more than it looks. A member
 * who changes 200g to 250g because they genuinely ate more has not caught a
 * parsing error — and if that row stays in the set, `scripts/replay-evals.js`
 * will mark the model wrong every time it gets that message right. Dismissing
 * is reversible, because it is a judgement call and one-way buttons on
 * judgement calls do not get pressed.
 */

import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { plural } from '../constants';

const SOURCE_LABEL = {
  member_parse: '💬 Member chat',
  coach_parse:  '🏋️ Coach chat',
  photo:        '📷 Photo',
};

const FIELD_LABEL = {
  grams:     'Portion',
  meal:      'Meal slot',
  food_name: 'Invented item',
  exercise:  'Exercise',
  target:    'Target',
  ops:       'Action',
  control:   'Control',
};

/** "300g" / "Dal 300g · Lunch" / "3 actions" — whatever the shape happens to be. */
function describe(v) {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return `${v.length} ${plural(v.length, 'action')}`;
  if (typeof v !== 'object') return String(v);
  const bits = [];
  if (v.name) bits.push(v.name);
  if (v.grams != null) bits.push(`${v.grams}g`);
  if (v.meal) bits.push(v.meal);
  return bits.length ? bits.join(' · ') : JSON.stringify(v).slice(0, 80);
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `${days}d ago`;
  if (hrs  > 0) return `${hrs}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'just now';
}

export default function EvalSamples() {
  const [samples, setSamples]   = useState([]);
  const [counts,  setCounts]    = useState(null);
  const [loading, setLoading]   = useState(true);
  const [failed,  setFailed]    = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [busyId,  setBusyId]    = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const { data } = await api.get('/admin/eval-samples', {
        params: { limit: 100, include_dismissed: showDismissed ? '1' : undefined },
      });
      setSamples(data.samples || []);
      setCounts(data.counts || null);
    } catch (e) {
      // An empty list and a failed fetch look identical unless we say so. The
      // difference matters: one means "nothing collected yet", the other means
      // "you are looking at nothing and it isn't true".
      console.error('eval samples load failed:', e);
      setFailed(true);
      setSamples([]);
    } finally {
      setLoading(false);
    }
  }, [showDismissed]);

  useEffect(() => { load(); }, [load]);

  const setDismissed = async (id, dismissed) => {
    setBusyId(id);
    try {
      await api.patch(`/admin/eval-samples/${id}/dismiss`, { dismissed });
      setSamples(prev => showDismissed
        ? prev.map(s => s.id === id ? { ...s, dismissed } : s)
        : prev.filter(s => s.id !== id));
      setCounts(c => c ? { ...c, active: Math.max(0, c.active + (dismissed ? -1 : 1)) } : c);
    } catch (e) {
      console.error('dismiss failed:', e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-xs text-mid">
          {counts
            ? `${counts.active} live · ${counts.replayable} replayable · ${counts.controls ?? 0} ${plural(counts.controls ?? 0, 'control')}`
            : `${samples.length} ${plural(samples.length, 'sample')}`}
        </p>
        <div className="flex gap-2">
          <button onClick={() => setShowDismissed(v => !v)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors ${
              showDismissed
                ? 'bg-gold/[0.14] border-gold/25 text-gold-light'
                : 'bg-surface border-white/[0.08] text-mid hover:text-white'
            }`}>
            {showDismissed ? 'Showing dismissed' : 'Show dismissed'}
          </button>
          <button onClick={load}
            className="text-xs font-semibold text-mid hover:text-white px-3 py-1.5
              bg-surface rounded-xl border border-white/[0.08] transition-colors">
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-gold/5 border border-gold/[0.18] rounded-2xl px-4 py-3 mb-3">
        <p className="text-caption text-[#C9B37E] leading-relaxed">
          Every correction a member or coach makes lands here as a test case.
          Run <span className="font-mono text-eyebrow text-gold-light">node scripts/replay-evals.js</span> after
          a prompt change to score it against these. Dismiss anything that was
          not actually a parsing mistake — those rows make every future run look
          worse than it is.
        </p>
      </div>

      {loading && (
        <p className="text-sm text-lo text-center py-8">Loading…</p>
      )}

      {!loading && failed && (
        <div className="bg-red-500/[0.08] border border-red-500/25 rounded-2xl px-4 py-5 text-center">
          <p className="text-sm text-red-300 font-semibold">Couldn't load the eval set</p>
          <button onClick={load}
            className="mt-2 text-xs font-semibold text-red-200 underline">Try again</button>
        </div>
      )}

      {!loading && !failed && samples.length === 0 && (
        <div className="bg-surface border border-hair rounded-2xl px-4 py-8 text-center">
          <p className="text-sm text-mid font-semibold">Nothing collected yet</p>
          <p className="text-xs text-lo mt-1.5 leading-relaxed">
            Samples appear when a member fixes a portion the AI guessed, unticks
            something it invented, or a coach switches off an action before
            applying it.
          </p>
        </div>
      )}

      {!loading && !failed && samples.length > 0 && (
        <div className="space-y-2">
          {samples.map(s => (
            <div key={s.id}
              className={`rounded-2xl border px-4 py-3 ${
                s.dismissed
                  ? 'bg-white/[0.02] border-white/[0.06] opacity-60'
                  : 'bg-surface border-hair'
              }`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="text-eyebrow font-bold tracking-wider text-lo">
                    {SOURCE_LABEL[s.source] || s.source}
                  </span>
                  {s.field && (
                    <span className="text-eyebrow font-bold px-1.5 py-0.5 rounded-md
                      bg-gold/[0.12] text-gold">
                      {FIELD_LABEL[s.field] || s.field}
                    </span>
                  )}
                  {s.member_name && (
                    <span className="text-eyebrow text-lo truncate">{s.member_name}</span>
                  )}
                </div>
                <span className="text-eyebrow text-lo flex-shrink-0">{timeAgo(s.created_at)}</span>
              </div>

              <p className="text-body-sm text-white leading-snug mb-2 break-words">
                "{s.message}"
              </p>

              {/* A control is a parse nobody corrected — the model already had it
                  right. Rendering it as a struck-through red value next to a
                  green one would read as an error that was fixed, which is the
                  opposite of what it records. */}
              {s.field === 'control' ? (
                <div className="flex items-center gap-2 text-caption flex-wrap">
                  <span className="px-2 py-1 rounded-lg bg-ok-deep/[0.10] border border-ok-deep/20 text-gold-light">
                    ✓ {describe(s.corrected)}
                  </span>
                  <span className="text-lo">already correct — kept so a prompt change can be scored on it</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-caption flex-wrap">
                  <span className="px-2 py-1 rounded-lg bg-red-500/[0.10] border border-red-500/20 text-red-300 line-through">
                    {describe(s.ai_output)}
                  </span>
                  <span className="text-lo">→</span>
                  <span className="px-2 py-1 rounded-lg bg-ok-deep/[0.10] border border-ok-deep/20 text-gold-light">
                    {describe(s.corrected)}
                  </span>
                </div>
              )}

              <button
                onClick={() => setDismissed(s.id, !s.dismissed)}
                disabled={busyId === s.id}
                style={{ minHeight: 32 }}
                className="mt-2.5 text-caption font-semibold px-3 rounded-lg border transition-colors
                  bg-white/[0.03] border-white/[0.08] text-mid
                  hover:text-white hover:border-white/[0.16] disabled:opacity-50">
                {busyId === s.id
                  ? 'Saving…'
                  : s.dismissed ? 'Put back in the set' : 'Not a real error'}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
