/**
 * MetabolicInsight.jsx — what the member's own data says about their metabolism.
 *
 * Shows the gap between the textbook prediction and what actually happened,
 * proposes targets, and lets the coach apply them. It never applies anything
 * itself: the engine proposes, the coach decides. That is the right division
 * for a coached product and it keeps a statistical inference from silently
 * becoming someone's diet.
 *
 * Confidence is shown prominently rather than buried, because a number derived
 * from twelve days of patchy logging deserves less trust than one from a month
 * of consistent data, and hiding that difference would be misleading.
 */

import { useState, useEffect } from 'react';
import api from '../api/client';

const CONF = {
  high:         { label: 'High confidence',   cls: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30' },
  moderate:     { label: 'Moderate',          cls: 'text-[#D4AF37] bg-[rgba(212,175,55,0.10)] border-[rgba(212,175,55,0.30)]' },
  low:          { label: 'Low confidence',    cls: 'text-amber-300 bg-amber-400/10 border-amber-400/30' },
  insufficient: { label: 'Not enough data',   cls: 'text-[#9EA3B0] bg-white/[0.04] border-white/[0.10]' },
};

const NUTRIENT_LABEL = {
  fiber: 'Fibre', calcium: 'Calcium', iron: 'Iron', magnesium: 'Magnesium',
  potassium: 'Potassium', zinc: 'Zinc', vit_a: 'Vitamin A', vit_b12: 'Vitamin B12',
  vit_c: 'Vitamin C', vit_d: 'Vitamin D', vit_e: 'Vitamin E', folate: 'Folate',
  omega3_ala: 'Omega-3 ALA',
};

export default function MetabolicInsight({ memberId = null, onApplied = null, canApply = false }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [model, setModel] = useState(null);
  const [prior, setPrior] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(memberId ? `/members/${memberId}/adaptive` : '/members/me/adaptive')
      .then(({ data }) => { if (!cancelled) setData(data); })
      .catch(() => { if (!cancelled) setError('Could not load the analysis'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    // The continuous model is coach-only, so only fetch it on that side
    if (memberId) {
      api.get(`/members/${memberId}/model`)
        .then(({ data }) => { if (!cancelled) setModel(data); })
        .catch(() => {});
      // What the clinic as a whole has learned — a coach should be able to see
      // the correction their own members are building, not just its effect.
      api.get('/members/population/prior')
        .then(({ data }) => { if (!cancelled) setPrior(data); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [memberId]);

  const applyTargets = async () => {
    if (!data?.targets || !memberId) return;
    setApplying(true);
    try {
      await api.put(`/admin/members/${memberId}`, {
        macro_kcal: data.targets.kcal,
        macro_pro:  data.targets.protein_g,
        macro_carb: data.targets.carbs_g,
        macro_fat:  data.targets.fat_g,
      });
      setApplied(true);
      onApplied?.();
    } catch (err) {
      console.error('apply targets failed:', err);
      setError('Could not apply the targets');
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <p className="text-xs text-[#7E8596] py-4 text-center">Analysing…</p>;
  if (error)   return <p className="text-xs text-red-400 py-4 text-center">{error}</p>;
  if (!data)   return null;

  const conf = CONF[data.confidence] || CONF.insufficient;
  const hasResult = data.observed_tdee != null;

  return (
    <div>
      <div className={`inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider
        rounded-full px-2.5 py-1 border mb-3 ${conf.cls}`}>
        {conf.label}
      </div>

      {!hasResult ? (
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-3.5 py-3">
          <p className="text-xs text-[#9EA3B0] leading-relaxed">
            Not enough data yet — {data.reason}. The estimate needs about two weeks
            of weight readings with food logged on most of those days.
          </p>
          <div className="flex gap-3 mt-2 text-[10px] text-[#7E8596]">
            <span>weight: {data.weight_days}d</span>
            <span>food: {data.food_days}d</span>
            <span>coverage: {data.food_coverage_pct}%</span>
          </div>
        </div>
      ) : (
        <>
          {/* Predicted vs observed — the whole point of the card */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-white/[0.04] border border-white/[0.07] rounded-xl px-3 py-2.5">
              <p className="text-lg font-extrabold text-[#9EA3B0]">{data.predicted_tdee ?? '—'}</p>
              <p className="text-[9px] font-bold tracking-wider text-[#7E8596] mt-0.5">Formula predicts</p>
            </div>
            <div className="bg-[rgba(212,175,55,0.08)] border border-[rgba(212,175,55,0.28)] rounded-xl px-3 py-2.5">
              <p className="text-lg font-extrabold text-[#D4AF37]">{data.observed_tdee}</p>
              <p className="text-[9px] font-bold tracking-wider text-[#7E8596] mt-0.5">Their body says</p>
            </div>
          </div>

          {data.tdee_delta_pct != null && Math.abs(data.tdee_delta_pct) >= 5 && (
            <p className="text-xs text-[#FFFFFF] leading-relaxed mb-3">
              Their actual metabolism runs{' '}
              <span className="font-bold text-[#D4AF37]">
                {Math.abs(data.tdee_delta_pct)}% {data.tdee_delta_pct > 0 ? 'faster' : 'slower'}
              </span>{' '}
              than the standard formula assumes — a difference of{' '}
              {Math.abs(data.observed_tdee - data.predicted_tdee)} kcal a day.
            </p>
          )}

          <div className="space-y-1 mb-3 text-[11px]">
            {[
              ['Average intake',      `${data.mean_intake.toLocaleString()} kcal`],
              ['Weight trend',        data.weekly_change_kg != null
                                        ? `${data.weekly_change_kg > 0 ? '+' : ''}${data.weekly_change_kg} kg/week`
                                        : '—'],
              ['Trend reliability',   `R² ${data.trend_fit_r2}`],
              ['Data window',         `${data.weight_days} weight · ${data.food_days} food days`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-[#7E8596]">{k}</span>
                <span className="text-[#FFFFFF] font-semibold">{v}</span>
              </div>
            ))}
          </div>

          {/* Proposed targets */}
          {data.targets && (
            <div className="bg-[#121316] border border-white/[0.08] rounded-xl px-3.5 py-3 mb-3">
              <p className="text-[10px] font-bold tracking-wider text-[#D4AF37] mb-2">
                Suggested targets
              </p>
              {(() => {
                // Percentages alongside grams, for the same reason as the lab
                // card: grams are what a member cooks to, percentages are how
                // a coach reads a plan at a glance. Derived from the grams so
                // the two can never disagree, with the last share taken as the
                // remainder so they always sum to 100.
                const t = data.targets;
                const total = t.protein_g * 4 + t.carbs_g * 4 + t.fat_g * 9;
                const pP = Math.round((t.protein_g * 4 / total) * 100);
                const pC = Math.round((t.carbs_g * 4 / total) * 100);
                const pF = 100 - pP - pC;
                return (
                  <>
                    <div className="flex h-2 rounded-full overflow-hidden mb-2">
                      <div style={{ width: `${pP}%` }} className="bg-[#D4AF37]" />
                      <div style={{ width: `${pC}%` }} className="bg-[#8C6D37]" />
                      <div style={{ width: `${pF}%` }} className="bg-[#F0E2B6]" />
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div>
                        <p className="text-sm font-extrabold text-[#FFFFFF]">{t.kcal}</p>
                        <p className="text-[9px] text-[#7E8596]">kcal</p>
                      </div>
                      {[
                        ['Protein', t.protein_g, pP, 'text-[#D4AF37]'],
                        ['Carbs',   t.carbs_g,   pC, 'text-[#C5A059]'],
                        ['Fat',     t.fat_g,     pF, 'text-[#F0E2B6]'],
                      ].map(([label, g, pctv, cls]) => (
                        <div key={label}>
                          <p className={`text-sm font-extrabold ${cls}`}>{pctv}%</p>
                          <p className="text-[10px] text-[#FFFFFF]">{g}g</p>
                          <p className="text-[9px] text-[#7E8596]">{label}</p>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
              <p className="text-[10px] text-[#7E8596] mt-2 leading-relaxed">
                Aimed at {Math.abs(data.targets.weekly_change_kg)} kg/week
                {data.targets.weekly_change_kg < 0 ? ' loss' : ' gain'}, from {data.targets.basis}.
                Protein is set high to protect lean mass in a deficit; fat is floored
                for hormonal function.
              </p>

              {canApply && (
                applied ? (
                  <p className="text-[11px] font-bold text-emerald-300 mt-2.5">✓ Applied to their protocol</p>
                ) : (
                  <button onClick={applyTargets} disabled={applying}
                    style={{ minHeight: 40 }}
                    className="w-full mt-2.5 rounded-xl text-xs font-bold text-[#121316]
                      bg-gradient-to-r from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37]
                      active:scale-[0.98] transition-transform disabled:opacity-60">
                    {applying ? 'Applying…' : 'Apply these targets'}
                  </button>
                )
              )}
            </div>
          )}
        </>
      )}

      {/* Micronutrient gaps — plain arithmetic, always worth showing */}
      {data.micro_gaps?.length > 0 && (
        <div className="border-t border-white/[0.06] pt-3">
          <p className="text-[10px] font-bold tracking-wider text-[#7E8596] mb-2">
            Consistently under target
          </p>
          <div className="space-y-1.5">
            {data.micro_gaps.map(g => (
              <div key={g.nutrient} className="flex items-center gap-2">
                <span className="text-[11px] text-[#FFFFFF] flex-1">
                  {NUTRIENT_LABEL[g.nutrient] || g.nutrient}
                </span>
                <div className="w-20 h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                  <div className="h-full rounded-full bg-amber-400"
                    style={{ width: `${Math.min(100, g.pct)}%` }} />
                </div>
                <span className="text-[11px] font-bold text-amber-300 w-10 text-right">{g.pct}%</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#7E8596] mt-2">
            Averages across {data.food_days} logged days, against adult reference intakes.
          </p>
        </div>
      )}

      {/* What all their natural variation implies, holding the other
          variables constant. Coach-only. */}
      {memberId && model && (
        <div className="border-t border-white/[0.06] pt-3 mt-3">
          <p className="text-[10px] font-bold tracking-wider text-[#7E8596] mb-2">
            What their history shows
          </p>

          {!model.ok ? (
            <p className="text-xs text-[#9EA3B0] leading-relaxed">{model.reason}</p>
          ) : (
            <>
              <div className="space-y-1.5 mb-2">
                {model.findings.map(f => (
                  <div key={f.variable} className="bg-[#121316] border border-white/[0.07] rounded-xl px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-[#FFFFFF]">{f.variable}</span>
                      <span className={`text-[9px] font-bold tracking-wider rounded-full px-2 py-0.5 border ${
                        f.confidence === 'established'
                          ? 'text-[#D4AF37] border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.08)]'
                          : f.confidence === 'untested'
                          ? 'text-[#7E8596] border-white/[0.12]'
                          : 'text-[#9EA3B0] border-white/[0.12]'}`}>
                        {f.confidence}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#9EA3B0] mt-0.5">{f.direction}</p>
                    <p className="text-[10px] text-[#7E8596] mt-0.5">{f.per_unit}</p>
                  </div>
                ))}
              </div>

              <div className="flex justify-between text-[10px] text-[#7E8596]">
                <span>{model.weeks_usable} usable weeks · R² {model.model.r2}</span>
                <span>intake ranged {model.ranges.kcal[0]}–{model.ranges.kcal[1]} kcal</span>
              </div>
              <p className="text-[10px] text-[#7E8596] mt-1.5 leading-relaxed">
                Each effect is measured holding the others constant. "Unproven" means the
                effect is too small to separate from this member's own week-to-week
                variation — not that it is zero.
              </p>
            </>
          )}
        </div>
      )}

      {/* Clinic-calibrated fallback before a member has their own history */}
      {data.clinic_adjusted_tdee && (
        <div className="border-t border-white/[0.06] pt-3 mt-3">
          <p className="text-[11px] text-[#FFFFFF] leading-relaxed">
            Until they have enough data, the estimate is{' '}
            <span className="font-bold text-[#D4AF37]">{data.clinic_adjusted_tdee} kcal</span>{' '}
            — the textbook figure adjusted by how the formula has actually fitted your
            other members.
          </p>
          <p className="text-[10px] text-[#7E8596] mt-1">{data.prior?.basis}</p>
        </div>
      )}

      {/* Clinic-wide calibration, visible to the coach */}
      {memberId && prior && (
        <div className="border-t border-white/[0.06] pt-3 mt-3">
          <p className="text-[10px] font-bold tracking-wider text-[#7E8596] mb-1.5">
            Across your members
          </p>
          {prior.n < 3 ? (
            <p className="text-[11px] text-[#9EA3B0] leading-relaxed">
              {prior.basis}. Once three members have a well-measured metabolism, new
              members will start from a figure calibrated to your clinic instead of
              the textbook formula.
            </p>
          ) : (
            <p className="text-[11px] text-[#FFFFFF] leading-relaxed">
              The standard formula runs{' '}
              <span className="font-bold text-[#D4AF37]">
                {Math.abs(Math.round((prior.factor - 1) * 100))}%{' '}
                {prior.factor > 1 ? 'low' : 'high'}
              </span>{' '}
              for your members — {prior.basis}. New members inherit that correction
              from day one.
            </p>
          )}
        </div>
      )}

      <p className="text-[10px] text-[#7E8596] mt-3 leading-relaxed">
        Derived from this member's own logs, not a population formula. It improves
        as they log. Estimates only — clinical judgement stays with the coach.
      </p>
    </div>
  );
}
