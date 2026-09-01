/**
 * MacroLab.jsx — coach-only. Adherence patterns and controlled macro trials.
 *
 * There is deliberately no member-facing version. A member told mid-trial how
 * they're doing changes their behaviour, which destroys the measurement being
 * taken; and "you log less on high-fat days" reads as surveillance to the
 * person and as useful signal to their coach.
 *
 * The verdicts here are written to be honest rather than impressive. Most
 * trials will end in "no detectable difference", and the card says so plainly
 * with the reason, because a coach acting on a manufactured winner is worse
 * than a coach told the truth.
 */

import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { plural } from '../constants';

const STATUS_STYLE = {
  difference:    'bg-[rgba(212,175,55,0.10)] border-[rgba(212,175,55,0.35)] text-[#FFFFFF]',
  no_difference: 'bg-white/[0.04] border-white/[0.12] text-[#9EA3B0]',
  confounded:    'bg-amber-400/[0.08] border-amber-400/30 text-amber-200',
  incomplete:    'bg-white/[0.03] border-white/[0.10] text-[#9EA3B0]',
};

export default function MacroLab({ memberId, onChanged }) {
  const [adh, setAdh]         = useState(null);
  const [trial, setTrial]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [setup, setSetup]     = useState(null);   // draft arms while composing

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, t] = await Promise.all([
        api.get(`/members/${memberId}/adherence`),
        api.get(`/members/${memberId}/trial`),
      ]);
      setAdh(a.data);
      setTrial(t.data);
    } catch {
      setError('Could not load the analysis');
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => { load(); }, [load]);

  /** Two arms at the same calories and protein, splitting carbs and fat. */
  const draftArms = () => {
    const kcal = 1850, protein = 165;
    const remaining = kcal - protein * 4;
    // Arm A puts most of the remainder in carbs, Arm B in fat
    const aCarb = Math.round((remaining * 0.70) / 4);
    const aFat  = Math.round((remaining * 0.30) / 9);
    const bCarb = Math.round((remaining * 0.35) / 4);
    const bFat  = Math.round((remaining * 0.65) / 9);
    setSetup({
      kcal, protein,
      a: { label: 'Higher carb', kcal, protein_g: protein, carbs_g: aCarb, fat_g: aFat },
      b: { label: 'Higher fat',  kcal, protein_g: protein, carbs_g: bCarb, fat_g: bFat },
      arm_days: 28, washout_days: 10,
    });
  };

  const start = async () => {
    setBusy(true);
    try {
      await api.post(`/members/${memberId}/trial`, {
        arm_a: setup.a, arm_b: setup.b,
        arm_days: setup.arm_days, washout_days: setup.washout_days,
      });
      setSetup(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not start the trial');
    } finally { setBusy(false); }
  };

  const advance = async () => {
    setBusy(true);
    try {
      await api.post(`/members/${memberId}/trial/advance`);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not advance the trial');
    } finally { setBusy(false); }
  };

  if (loading) return <p className="text-xs text-[#7E8596] py-4 text-center">Analysing…</p>;

  const t = trial?.trial;
  const running = t && t.status === 'running';
  const comparison = trial?.comparison || (t?.status === 'completed' ? t.result : null);
  const daysIn = trial?.days_in_arm ?? 0;
  const readyToSwitch = running && daysIn >= (t.arm_days || 28);

  return (
    <div>
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

      {/* ── Adherence — needs no trial, works on existing logs ── */}
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#7E8596] mb-2">
        What they actually sustain
      </p>

      {!adh?.enough ? (
        <p className="text-xs text-[#9EA3B0] leading-relaxed mb-4">
          {adh?.reason || 'Not enough logged days yet.'}
        </p>
      ) : (
        <div className="mb-4">
          <div className="grid grid-cols-2 gap-2 mb-2">
            {adh.groups.map(g => (
              <div key={g.label} className="bg-white/[0.04] border border-white/[0.07] rounded-xl px-3 py-2.5">
                <p className="text-[11px] font-bold text-[#FFFFFF]">{g.label}</p>
                <p className="text-[10px] text-[#7E8596] mt-0.5">{g.mean_carb_pct}% of calories from carbs</p>
                <div className="mt-2 space-y-0.5 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-[#7E8596]">Days logged</span>
                    <span className="text-[#FFFFFF] font-semibold">{g.days}</span>
                  </div>
                  {g.on_target_pct != null && (
                    <div className="flex justify-between">
                      <span className="text-[#7E8596]">On target</span>
                      <span className="text-[#D4AF37] font-semibold">{g.on_target_pct}%</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[#7E8596]">Avg intake</span>
                    <span className="text-[#FFFFFF] font-semibold">{g.mean_kcal}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className={`rounded-xl px-3 py-2.5 border text-[11px] leading-relaxed ${
            adh.verdict ? STATUS_STYLE.difference : STATUS_STYLE.no_difference}`}>
            {adh.verdict || 'No meaningful difference in how well they sustain either split.'}
            <p className="text-[10px] text-[#7E8596] mt-1.5">{adh.note}</p>
          </div>
        </div>
      )}

      {/* ── Trial ── */}
      <div className="border-t border-white/[0.06] pt-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#7E8596] mb-2">
          Controlled trial
        </p>

        {/* composing */}
        {setup && (
          <div className="bg-[#121316] border border-white/[0.08] rounded-xl p-3 mb-3">
            <p className="text-[11px] text-[#9EA3B0] mb-2 leading-relaxed">
              Both arms hold <b className="text-[#FFFFFF]">{setup.kcal} kcal</b> and{' '}
              <b className="text-[#FFFFFF]">{setup.protein}g protein</b> constant. Only the
              carb/fat split changes — that is what makes any difference attributable.
            </p>
            {[setup.a, setup.b].map((arm, i) => (
              <div key={i} className="flex items-center justify-between bg-[#1A1C20] border border-white/[0.07] rounded-lg px-3 py-2 mb-1.5">
                <span className="text-[11px] font-bold text-[#FFFFFF]">Arm {i === 0 ? 'A' : 'B'} · {arm.label}</span>
                <span className="text-[10px] text-[#9EA3B0]">C {arm.carbs_g}g · F {arm.fat_g}g</span>
              </div>
            ))}
            <p className="text-[10px] text-[#7E8596] mb-2.5">
              {setup.arm_days} days each, first {setup.washout_days} discarded as glycogen washout.
              About {setup.arm_days * 2} days in total.
            </p>
            <div className="flex gap-2">
              <button onClick={start} disabled={busy} style={{ minHeight: 38 }}
                className="flex-1 rounded-xl text-xs font-bold text-[#121316]
                  bg-gradient-to-r from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37] active:scale-[0.98] disabled:opacity-60">
                {busy ? 'Starting…' : 'Start trial'}
              </button>
              <button onClick={() => setSetup(null)} style={{ minHeight: 38 }}
                className="px-4 rounded-xl text-xs font-bold text-[#9EA3B0] border border-white/[0.10]">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* running */}
        {running && !setup && (
          <div className="bg-[#121316] border border-white/[0.08] rounded-xl p-3 mb-3">
            {['A', 'B'].map(k => {
              const arm = k === 'A' ? t.arm_a : t.arm_b;
              const active = t.current_arm === k;
              const done = k === 'A' && t.current_arm === 'B';
              return (
                <div key={k} className={`flex items-center justify-between rounded-lg px-3 py-2 mb-1.5 border ${
                  active ? 'bg-[rgba(212,175,55,0.08)] border-[rgba(212,175,55,0.35)]'
                         : 'bg-[#1A1C20] border-white/[0.07]'}`}>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-[#FFFFFF]">Arm {k} · {arm.label}</p>
                    <p className="text-[10px] text-[#7E8596]">C {arm.carbs_g}g · F {arm.fat_g}g</p>
                  </div>
                  <span className={`text-[9px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border ${
                    active ? 'text-[#D4AF37] border-[rgba(212,175,55,0.4)]'
                    : done ? 'text-emerald-300 border-emerald-400/40'
                           : 'text-[#7E8596] border-white/[0.12]'}`}>
                    {active ? `Day ${daysIn}` : done ? 'Done' : 'Queued'}
                  </span>
                </div>
              );
            })}
            <p className="text-[10px] text-[#7E8596] mt-2">
              {readyToSwitch
                ? `Arm ${t.current_arm} has run its ${t.arm_days} ${plural(t.arm_days, 'day')}.`
                : `${Math.max(0, (t.arm_days || 28) - daysIn)} ${plural(Math.max(0, (t.arm_days || 28) - daysIn), 'day')} left in arm ${t.current_arm}.`}
            </p>
            <button onClick={advance} disabled={busy} style={{ minHeight: 38 }}
              className={`w-full mt-2 rounded-xl text-xs font-bold active:scale-[0.98] disabled:opacity-60 ${
                readyToSwitch
                  ? 'text-[#121316] bg-gradient-to-r from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37]'
                  : 'text-[#9EA3B0] border border-white/[0.12]'}`}>
              {busy ? 'Working…' : t.current_arm === 'A' ? 'Switch to arm B' : 'Finish and compare'}
            </button>
          </div>
        )}

        {/* result */}
        {comparison && (
          <div className={`rounded-xl px-3.5 py-3 border text-[11px] leading-relaxed mb-3 ${
            STATUS_STYLE[comparison.status] || STATUS_STYLE.incomplete}`}>
            <p className="font-bold text-[#FFFFFF] text-[12px] mb-1">{comparison.headline}</p>
            <p>{comparison.detail}</p>
            {comparison.recommendation && (
              <p className="mt-1.5 text-[#D4AF37]">{comparison.recommendation}</p>
            )}
            {comparison.caveat && (
              <p className="mt-1.5 text-[10px] text-[#7E8596]">{comparison.caveat}</p>
            )}
            {comparison.noise_floor_kg != null && (
              <p className="mt-1.5 text-[10px] text-[#7E8596]">
                Their week-to-week weight variation: ±{comparison.noise_floor_kg} kg.
              </p>
            )}
          </div>
        )}

        {!running && !setup && (
          <button onClick={draftArms} style={{ minHeight: 40 }}
            className="w-full rounded-xl text-xs font-bold text-[#D4AF37]
              bg-[rgba(212,175,55,0.08)] border border-[rgba(212,175,55,0.28)] active:scale-[0.98]">
            {t ? 'Run another trial' : 'Set up a macro trial'}
          </button>
        )}

        <p className="text-[10px] text-[#7E8596] mt-2.5 leading-relaxed">
          Members never see this. They see only their targets changing — telling
          someone mid-trial how they're doing would change their behaviour and
          destroy the measurement.
        </p>
      </div>
    </div>
  );
}
