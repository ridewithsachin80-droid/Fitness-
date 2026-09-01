/**
 * Profile.jsx — Sprint 10
 * Member-facing profile page: personal details, conditions, targets,
 * fasting protocol, macro plan, stats, and diet notes.
 * Accessible via /profile (member route).
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { getMyProfile, updateMyProfile }  from '../api/logs';
import { Card, SectionTitle, PageLoader, BackButton, MemberBottomNav } from '../components/UI';
import { sessionEnergy } from '../utils/exerciseCalories';
import MetabolicInsight from '../components/MetabolicInsight';
import LabResults from '../components/LabResults';
import api from '../api/client';
import { plural } from '../constants';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt12(t) {
  if (!t) return '—';
  const [hStr, mStr] = String(t).slice(0, 5).split(':');
  const h = parseInt(hStr), m = parseInt(mStr || '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function age(dob) {
  if (!dob) return null;
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

function bmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const h = heightCm / 100;
  return (weightKg / (h * h)).toFixed(1);
}

function bmiLabel(b) {
  if (!b) return null;
  const v = parseFloat(b);
  if (v < 18.5) return { label: 'Underweight', cls: 'text-blue-300 bg-[rgba(96,165,250,0.10)] border-[rgba(96,165,250,0.20)]' };
  if (v < 25)   return { label: 'Healthy',     cls: 'text-[#F0E2B6] bg-[rgba(212,175,55,0.10)] border-[rgba(212,175,55,0.20)]' };
  if (v < 30)   return { label: 'Overweight',  cls: 'text-amber-300 bg-[rgba(251,191,36,0.10)] border-[rgba(251,191,36,0.20)]' };
  return             { label: 'Obese',          cls: 'text-red-300 bg-[rgba(248,113,113,0.10)] border-[rgba(248,113,113,0.20)]' };
}

/**
 * What the app has learned about this member's own portion sizes.
 *
 * The learning was already happening — corrections in the AI chat were being
 * stored and fed back into the next prompt — but the member had no way to see
 * any of it. Invisible personalisation is indistinguishable from the app
 * guessing, so it earns no trust. This shows the ledger.
 */
function PortionMemory() {
  const [portions, setPortions] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get('/ai-chat/portions')
      .then(({ data }) => { if (!cancelled) setPortions(data.portions || []); })
      .catch(() => { if (!cancelled) setPortions([]); });
    return () => { cancelled = true; };
  }, []);

  if (portions === null) return null;

  return (
    <Card>
      <SectionTitle icon="🥣">Your Portion Sizes</SectionTitle>
      {portions.length === 0 ? (
        <p className="text-sm text-[#9EA3B0] mt-2 leading-relaxed">
          Nothing learned yet. When you correct a weight in the AI chat — changing
          "1 katori dal" from 150g to the amount your bowl actually holds — it's
          remembered and used next time.
        </p>
      ) : (
        <>
          <p className="text-xs text-[#7E8596] mt-1 mb-3">
            Measured from your own corrections, and used instead of the generic table.
          </p>
          <div className="space-y-1.5">
            {portions.map(p => (
              <div key={p.phrase} className="flex items-center justify-between bg-[#121316]
                border border-white/[0.06] rounded-xl px-3 py-2">
                <span className="text-[12px] text-[#FFFFFF] capitalize">{p.phrase}</span>
                <span className="text-[12px] font-bold text-[#D4AF37]">
                  {p.grams}g
                  <span className="text-[10px] font-medium text-[#7E8596] ml-1.5">
                    {p.samples} {plural(p.samples, 'correction')}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ── TDEE (Total Daily Energy Expenditure) ─────────────────────────────────────
//
// BMR uses Mifflin-St Jeor (1990), the equation most widely recommended for
// healthy adults — more accurate than Harris-Benedict for modern populations:
//   Male:   BMR = 10×weight(kg) + 6.25×height(cm) − 5×age + 5
//   Female: BMR = 10×weight(kg) + 6.25×height(cm) − 5×age − 161
// When sex isn't recorded we average the two constants (−78) and flag it,
// since guessing either way skews the result by ~166 kcal.
//
// TDEE = BMR × activity factor. We use 1.2 (sedentary baseline) and add the
// day's ACTUAL measured burn from protocol activities and logged workouts on
// top, rather than guessing a lifestyle multiplier — the member is already
// logging what they did, so we use it.
function calcBMR({ weightKg, heightCm, age, gender }) {
  if (!weightKg || !heightCm || age == null) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const g = String(gender || '').toLowerCase();
  if (g === 'male')   return Math.round(base + 5);
  if (g === 'female') return Math.round(base - 161);
  return Math.round(base - 78); // sex unknown — midpoint
}

function calcFoodKcal(items = []) {
  return items.reduce((sum, it) => {
    const cal = it?.per_100g?.calories;
    if (!cal) return sum;
    return sum + Math.round(cal * ((it.grams || 0) / 100));
  }, 0);
}

const CONDITION_LABELS = {
  fatty_liver:    '🫀 Fatty Liver',
  pre_diabetic:   '🩸 Pre-Diabetic',
  b12_deficient:  '💉 B12 Deficient',
  insulin_resist: '⚡ Insulin Resistance',
  hypothyroid:    '🦋 Hypothyroid',
  pcos:           '🌸 PCOS',
  hypertension:   '🫀 Hypertension',
};

// ── Stat pill ─────────────────────────────────────────────────────────────────

function StatPill({ label, value, unit, color = 'emerald' }) {
  const colors = {
    emerald: 'bg-[rgba(212,175,55,0.08)] border-[rgba(212,175,55,0.16)] text-[#F0E2B6]',
    blue:    'bg-[rgba(96,165,250,0.08)] border-[rgba(96,165,250,0.16)] text-blue-300',
    amber:   'bg-[rgba(251,191,36,0.08)] border-[rgba(251,191,36,0.16)] text-amber-300',
    stone:   'bg-white/[0.04] border-white/[0.08] text-[#9EA3B0]',
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 text-center ${colors[color]}`}>
      <p className="font-display text-2xl font-semibold">
        {value ?? '—'}
        {unit && <span className="text-sm font-normal ml-1 opacity-70">{unit}</span>}
      </p>
      <p className="text-xs font-medium mt-0.5 opacity-70">{label}</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Profile() {
  const navigate       = useNavigate();
  const { user }       = useAuthStore();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => {
    getMyProfile()
      .then(({ data }) => setProfile(data))
      .catch(() => setError('Could not load profile. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader />;

  if (error) return (
    <div className="min-h-screen bg-[#121316] flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-red-400 font-semibold">{error}</p>
        <button onClick={() => navigate('/')} className="mt-4 text-[#D4AF37] font-medium text-sm">
          ← Back to log
        </button>
      </div>
    </div>
  );

  const p          = profile;
  const currentBmi = bmi(p.current_weight, p.height_cm);
  const bmiInfo    = bmiLabel(currentBmi);
  const memberAge  = age(p.dob);
  const lostKg     = p.start_weight && p.current_weight
    ? +(p.start_weight - p.current_weight).toFixed(1)
    : null;
  const toGoKg     = p.current_weight && p.target_weight
    ? +(p.current_weight - p.target_weight).toFixed(1)
    : null;
  const journeyPct = lostKg !== null && p.start_weight && p.target_weight
    ? Math.min(100, Math.round((lostKg / (p.start_weight - p.target_weight)) * 100))
    : null;

  return (
    <div className="min-h-screen bg-[#121316] font-sans">

      {/* ── Header ── */}
      <div className="bg-gradient-to-br from-[#1A1C20] to-[#121316] text-white px-4 pt-10 pb-8">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between mb-6">
            <BackButton onClick={() => navigate('/')} label="Back to log" />
            <div className="flex items-center gap-3">
              {/* This page had no inputs and no write calls at all, so a member
                  whose height was typed wrong at signup had to message the
                  coach to get a number changed they could see on their screen. */}
              <button onClick={() => setEditing(v => !v)}
                className="text-xs font-semibold text-[#D4AF37] hover:text-[#F0E2B6] transition-colors">
                {editing ? 'Cancel' : 'Edit details'}
              </button>
              <button onClick={() => navigate('/settings')}
                className="text-xs font-semibold text-[#F0E2B6] hover:text-white transition-colors">
                Settings
              </button>
            </div>
          </div>

          {/* Avatar + name */}
          <div className="flex items-center gap-4 mb-5">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center text-3xl font-display font-semibold select-none">
              {p.name?.[0]?.toUpperCase()}
            </div>
            <div>
              <h1 className="font-display text-2xl font-medium">{p.name}</h1>
              <p className="text-[#F0E2B6] text-sm mt-0.5">
                {p.phone && `+91 ${p.phone}`}
                {memberAge && ` · ${memberAge} yrs`}
                {p.height_cm && ` · ${p.height_cm} cm`}
              </p>
              {p.monitor_name && (
                <p className="text-xs text-[#F0E2B6] mt-1">🏋️ Coach: {p.monitor_name}</p>
              )}
            </div>
          </div>

          {editing && (
            <EditDetails
              profile={p}
              onCancel={() => setEditing(false)}
              onSaved={(patch) => {
                setProfile(prev => ({ ...prev, ...patch }));
                setEditing(false);
              }}
            />
          )}

          {/* Journey progress bar */}
          {journeyPct !== null && journeyPct >= 0 && (
            <div className="bg-white/[0.05] rounded-2xl p-3 border border-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="flex justify-between text-xs text-[#F0E2B6] mb-1.5">
                <span>Journey progress</span>
                <span className="font-bold text-white">{journeyPct}%</span>
              </div>
              <div className="h-2 bg-white/[0.1] rounded-full overflow-hidden">
                <div
                  className="h-2 rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.max(2, journeyPct)}%`,
                    background: journeyPct >= 100
                      ? 'linear-gradient(90deg, #D4AF37, #d4af6a)'
                      : 'linear-gradient(90deg, #D4AF37, #F0E2B6)',
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-[#F0E2B6] mt-1.5">
                <span>Start: {p.start_weight} kg</span>
                <span>Goal: {p.target_weight} kg</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-md mx-auto px-4 py-5 space-y-3 pb-10">

        {/* Weight stats */}
        <div className="grid grid-cols-3 gap-2">
          <StatPill label="Current weight" value={p.current_weight} unit="kg" color="emerald" />
          <StatPill label="Lost so far"
            value={lostKg !== null ? (lostKg >= 0 ? lostKg : `+${Math.abs(lostKg)}`) : null}
            unit="kg" color={lostKg > 0 ? 'emerald' : 'amber'} />
          <StatPill label="To reach goal"
            value={toGoKg !== null ? (toGoKg > 0 ? toGoKg : '✓') : null}
            unit={toGoKg > 0 ? 'kg' : ''} color={toGoKg <= 0 ? 'emerald' : 'stone'} />
        </div>

        {/* Activity stats */}
        <div className="grid grid-cols-2 gap-2">
          <StatPill label="Total logs" value={p.total_logs} color="blue" />
          <StatPill label="30-day compliance"
            value={p.avg_compliance !== null ? `${p.avg_compliance}%` : null}
            color={p.avg_compliance >= 75 ? 'emerald' : p.avg_compliance >= 50 ? 'amber' : 'stone'} />
        </div>

        {/* BMI */}
        {currentBmi && bmiInfo && (
          <Card>
            <SectionTitle icon="⚖️">Body Mass Index</SectionTitle>
            <div className="flex items-center justify-between mt-1">
              <span className="font-display text-3xl font-semibold text-[#FFFFFF]">{currentBmi}</span>
              <span className={`text-sm font-bold px-3 py-1 rounded-full border ${bmiInfo.cls}`}>
                {bmiInfo.label}
              </span>
            </div>
            <div className="mt-3 h-2 bg-white/[0.08] rounded-full overflow-hidden">
              <div className="h-2 rounded-full bg-gradient-to-r from-blue-400 via-[#D4AF37] via-amber-400 to-red-500" />
            </div>
            <div className="flex justify-between text-xs text-[#7E8596] mt-1">
              <span>18.5</span><span>25</span><span>30</span><span>35+</span>
            </div>
          </Card>
        )}

        {/* ── TDEE & today's energy balance ── */}
        {(() => {
          const ageYrs   = p.dob ? age(p.dob) : null;
          const weightKg = p.current_weight ? parseFloat(p.current_weight) : null;
          const heightCm = p.height_cm ? parseFloat(p.height_cm) : null;
          const bmr = calcBMR({ weightKg, heightCm, age: ageYrs, gender: p.gender });
          if (!bmr) {
            // Name exactly what's missing — "we need height, DOB and weight" is
            // confusing when two of the three are already filled in.
            const missing = [
              !heightCm && 'height',
              ageYrs == null && 'date of birth',
              !weightKg && 'a logged weight',
            ].filter(Boolean);
            return (
              <Card>
                <SectionTitle icon="🔥">Daily Energy (TDEE)</SectionTitle>
                <p className="text-sm text-[#9EA3B0] mt-2 leading-relaxed">
                  Still needed: <span className="text-[#FFFFFF] font-semibold">{missing.join(', ')}</span>.
                  {missing.includes('a logged weight')
                    ? ' Log your morning weight on the Today page.'
                    : ' Ask your coach to add this to your profile.'}
                </p>
              </Card>
            );
          }

          const e = p.today_energy || {};
          const restingTdee  = Math.round(bmr * 1.2);              // sedentary baseline
          // All exercise calories come from the Workout log: strength by volume
          // lifted, cardio by MET × time. Protocol checkboxes are a compliance
          // record only — counting them too would bill the same walk twice.
          const work = sessionEnergy({
            exercises: [{ sets: e.workout_sets || [] }],
            cardio:    e.cardio || [],
            bodyWeightKg: weightKg,
          });
          const workoutBurn = work.totalKcal;
          const totalOut     = restingTdee + workoutBurn;
          const totalIn      = calcFoodKcal(e.food_items);
          const balance      = totalIn - totalOut;
          const logged       = totalIn > 0;

          return (
            <Card>
              <SectionTitle icon="🔥">Daily Energy (TDEE)</SectionTitle>
              <p className="text-xs text-[#7E8596] mb-3">
                Mifflin-St Jeor BMR × 1.2, plus today's logged activity
                {!p.gender && ' · sex not set — add it under Edit details for an exact figure'}
              </p>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="bg-white/[0.04] border border-white/[0.07] rounded-xl px-3 py-2.5">
                  <p className="text-lg font-extrabold text-[#FFFFFF]">{bmr}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#7E8596] mt-0.5">BMR at rest</p>
                </div>
                <div className="bg-white/[0.04] border border-white/[0.07] rounded-xl px-3 py-2.5">
                  <p className="text-lg font-extrabold text-[#F0E2B6]">{totalOut}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#7E8596] mt-0.5">Burned today</p>
                </div>
              </div>

              <div className="space-y-1.5 mb-3">
                {[
                  ['Resting (BMR × 1.2)', restingTdee, 'text-[#9EA3B0]'],
                  [work.cardioMin > 0 && work.sets > 0
                    ? `Workout (${work.sets} ${plural(work.sets, 'set')} + ${work.cardioMin} min cardio)`
                    : work.sets > 0
                    ? `Strength (${work.volumeKg.toLocaleString()} kg lifted)`
                    : work.cardioMin > 0
                    ? `Cardio (${work.cardioMin} min)`
                    : 'Workout session',
                   workoutBurn,  'text-emerald-300'],
                ].map(([label, val, cls]) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-[#9EA3B0]">{label}</span>
                    <span className={`font-bold ${cls}`}>{val > 0 ? `+${val}` : val} kcal</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs pt-1.5 border-t border-white/[0.06]">
                  <span className="text-[#9EA3B0]">Food eaten today</span>
                  <span className="font-bold text-orange-400">{totalIn} kcal</span>
                </div>
              </div>

              {logged ? (
                <div className={`rounded-xl px-3.5 py-3 border ${
                  balance > 0
                    ? 'bg-amber-400/[0.08] border-amber-400/25'
                    : 'bg-emerald-400/[0.08] border-emerald-400/25'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-bold ${balance > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                      {balance > 0 ? 'Surplus' : 'Deficit'}
                    </span>
                    <span className={`font-display text-xl font-bold ${balance > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                      {balance > 0 ? '+' : ''}{balance} kcal
                    </span>
                  </div>
                  <p className="text-[11px] text-[#9EA3B0] mt-1 leading-relaxed">
                    {balance > 0
                      ? `You've eaten ${balance} kcal more than you burned today. A sustained surplus adds weight (~7,700 kcal ≈ 1 kg).`
                      : `You've burned ${Math.abs(balance)} kcal more than you ate. A sustained deficit of this size is roughly ${(Math.abs(balance) * 7 / 7700).toFixed(2)} kg per week.`}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl px-3.5 py-3 bg-white/[0.03] border border-white/[0.07]">
                  <p className="text-xs text-[#9EA3B0] leading-relaxed">
                    Log today's food to see whether you're in a surplus or deficit.
                  </p>
                </div>
              )}

              <p className="text-[10px] text-[#7E8596] mt-2.5 leading-relaxed">
                Estimates only — actual needs vary with body composition, medication and
                health conditions. Follow your coach's plan over these numbers.
              </p>
            </Card>
          );
        })()}

        {/* Connected devices. DeviceConnect is ~900 lines of scale and tracker
            integration reachable from exactly one row buried in Settings, so
            most members never discovered it existed. Profile is where someone
            already thinking about their body data is looking. */}
        <button
          onClick={() => navigate('/devices')}
          style={{ minHeight: 56 }}
          className="w-full rounded-2xl p-4 border border-white/[0.07] bg-[#1A1C20]
            flex items-center gap-3 text-left active:scale-[0.99] transition-transform">
          <span className="text-xl">⌚</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white">Connected devices</p>
            <p className="text-xs text-[#7E8596] mt-0.5">
              Smart scale, fitness tracker and health apps
            </p>
          </div>
          <span className="text-[#7E8596]">›</span>
        </button>

        {/* Blood work — members enter their own and see what changed alongside */}
        <Card>
          <SectionTitle icon="🩸">Lab Results</SectionTitle>
          <div className="mt-2">
            <LabResults memberName={profile?.name || ''} />
          </div>
        </Card>

        {/* What the app has learned about their kitchen */}
        <PortionMemory />

        {/* Their metabolism as measured, not predicted */}
        <Card>
          <SectionTitle icon="🧬">Your Metabolism</SectionTitle>
          <div className="mt-2">
            <MetabolicInsight />
          </div>
        </Card>

        {/* Conditions */}
        {p.conditions?.length > 0 && (
          <Card>
            <SectionTitle icon="🏥">Health Conditions</SectionTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              {p.conditions.map(c => (
                <span key={c}
                  className="text-sm bg-white/[0.05] text-[#FFFFFF] px-3 py-1.5 rounded-full border border-white/[0.08] font-medium">
                  {CONDITION_LABELS[c] || c.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </Card>
        )}

        {/* Fasting protocol */}
        {p.fasting && (
          <Card>
            <SectionTitle icon="⏰">Fasting Protocol</SectionTitle>
            <div className="mt-2 space-y-2">
              {p.fasting.label && (
                <p className="font-semibold text-[#FFFFFF]">{p.fasting.label}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[rgba(96,165,250,0.08)] border border-[rgba(96,165,250,0.16)] rounded-xl px-3 py-2 text-center">
                  <p className="text-xs text-blue-300 font-medium mb-0.5">Fasting ends</p>
                  <p className="font-display text-lg font-semibold text-blue-200">{fmt12(p.fasting.end)}</p>
                </div>
                <div className="bg-[rgba(212,175,55,0.08)] border border-[rgba(212,175,55,0.16)] rounded-xl px-3 py-2 text-center">
                  <p className="text-xs text-[#F0E2B6] font-medium mb-0.5">Fasting starts</p>
                  <p className="font-display text-lg font-semibold text-[#F0E2B6]">{fmt12(p.fasting.start)}</p>
                </div>
              </div>
              {p.fasting.note && (
                <p className="text-xs text-[#9EA3B0] bg-white/[0.04] px-3 py-2 rounded-xl border border-white/[0.07]">
                  📌 {p.fasting.note}
                </p>
              )}
            </div>
          </Card>
        )}

        {/* Macro targets */}
        {p.macros && (
          <Card>
            <SectionTitle icon="🎯">Daily Macro Targets</SectionTitle>
            {p.macros.phase && (
              <p className="text-xs text-[#7E8596] mb-3 mt-1 font-medium">Phase: {p.macros.phase}</p>
            )}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[
                { label: 'Calories', value: p.macros.kcal, unit: 'kcal', color: 'bg-[rgba(251,146,60,0.08)] border-[rgba(251,146,60,0.16)] text-orange-300' },
                { label: 'Protein',  value: p.macros.pro,  unit: 'g',    color: 'bg-[rgba(96,165,250,0.08)] border-[rgba(96,165,250,0.16)] text-blue-300' },
                { label: 'Carbs',    value: p.macros.carb, unit: 'g',    color: 'bg-[rgba(251,191,36,0.08)] border-[rgba(251,191,36,0.16)] text-amber-300' },
                { label: 'Fat',      value: p.macros.fat,  unit: 'g',    color: 'bg-[rgba(212,175,55,0.08)] border-[rgba(212,175,55,0.16)] text-[#D4AF37]' },
              ].filter(m => m.value).map(m => (
                <div key={m.label} className={`rounded-xl border px-3 py-2.5 text-center ${m.color}`}>
                  <p className="font-display text-xl font-semibold">{m.value}<span className="text-xs font-normal ml-1">{m.unit}</span></p>
                  <p className="text-xs font-medium mt-0.5 opacity-70">{m.label}</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Water target */}
        <Card>
          <SectionTitle icon="💧">Daily Water Target</SectionTitle>
          <div className="flex items-center gap-3 mt-2">
            <span className="font-display text-3xl font-semibold text-blue-300">{(p.water_target / 1000).toFixed(1)}</span>
            <span className="text-[#9EA3B0] font-medium">litres per day</span>
          </div>
          <p className="text-xs text-[#7E8596] mt-2">Stop 1 hour before sleep. Not during meals.</p>
        </Card>

        {/* Diet notes */}
        {p.diet_notes && (
          <Card>
            <SectionTitle icon="📋">Diet Instructions</SectionTitle>
            <p className="text-sm text-[#FFFFFF] leading-relaxed mt-2 whitespace-pre-wrap">
              {p.diet_notes}
            </p>
          </Card>
        )}

        {/* Member since */}
        <p className="text-center text-xs text-[#7E8596] pt-2 pb-6">
          Member since {new Date(p.member_since).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </p>
      </div>
      <MemberBottomNav />
    </div>
  );
}


// ── Edit details ──────────────────────────────────────────────────────────────
// Height, date of birth and sex only.
//
// Target and start weight are deliberately absent: start weight is the anchor
// every "kg lost" figure is measured against, and the target is a coaching
// decision. Both stay with the coach. These three are facts about the member
// that only they can be sure of, and all three feed the BMR/TDEE maths — a
// wrong height quietly skews every energy figure on the page.
function EditDetails({ profile, onCancel, onSaved }) {
  const [height, setHeight] = useState(profile.height_cm ? String(profile.height_cm) : '');
  const [dob, setDob]       = useState(profile.dob ? String(profile.dob).slice(0, 10) : '');
  const [gender, setGender] = useState(profile.gender || '');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  const save = async () => {
    setError('');
    // Mirror the server's gate so the member is corrected here rather than
    // bounced by a 400 after tapping Save.
    if (height) {
      const h = parseFloat(height);
      if (!Number.isFinite(h) || h < 80 || h > 250) {
        setError('Height should be between 80 and 250 cm'); return;
      }
    }
    setBusy(true);
    try {
      const { data } = await updateMyProfile({
        height_cm: height || null,
        dob:       dob    || null,
        gender:    gender || null,
      });
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't save — check your connection and try again.");
      setBusy(false);
    }
  };

  const label = "block text-[10px] font-semibold text-[#7E8596] uppercase tracking-[0.10em] mb-1.5";
  const input = `w-full bg-[#121316] border border-white/[0.10] rounded-xl px-3 py-2.5
    text-sm text-white outline-none focus:border-[rgba(212,175,55,0.40)]
    focus:ring-2 focus:ring-[rgba(212,175,55,0.12)]`;

  return (
    <div className="bg-white/[0.05] rounded-2xl p-4 border border-white/[0.07] mb-4 space-y-3">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={label}>Height (cm)</label>
          <input value={height} inputMode="decimal"
            onChange={(e) => setHeight(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="e.g. 172" className={input} />
        </div>
        <div className="flex-1">
          <label className={label}>Date of birth</label>
          <input type="date" value={dob} onChange={(e) => setDob(e.target.value)}
            className={input} />
        </div>
      </div>

      <div>
        <label className={label}>Sex</label>
        <div className="flex gap-2">
          {[['male', 'Male'], ['female', 'Female'], ['other', 'Prefer not to say']].map(([v, l]) => (
            <button key={v} onClick={() => setGender(v)} style={{ minHeight: 38 }}
              className={`flex-1 text-[11px] font-semibold rounded-xl border transition-colors ${
                gender === v
                  ? 'bg-[rgba(212,175,55,0.12)] border-[rgba(212,175,55,0.35)] text-[#F0E2B6]'
                  : 'bg-[#121316] border-white/[0.10] text-[#9EA3B0]'
              }`}>
              {l}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[#4A4E5A] mt-1.5 leading-relaxed">
          Used only for the calorie-burn calculation — the equation needs it.
        </p>
      </div>

      {error && <p className="text-xs text-red-400 leading-relaxed">{error}</p>}

      <div className="flex gap-2">
        <button onClick={save} disabled={busy} style={{ minHeight: 40 }}
          className="flex-1 text-xs font-bold text-[#121316] rounded-xl
            bg-gradient-to-r from-[#F0E2B6] via-[#D4AF37] to-[#8C6D37]
            active:scale-[0.98] disabled:opacity-40">
          {busy ? 'Saving…' : 'Save details'}
        </button>
        <button onClick={onCancel} style={{ minHeight: 40 }}
          className="px-4 text-xs font-bold text-[#9EA3B0] border border-white/[0.10] rounded-xl">
          Cancel
        </button>
      </div>

      <p className="text-[11px] text-[#4A4E5A] leading-relaxed">
        Your goal and starting weight are set by your coach — message them to change those.
      </p>
    </div>
  );
}
