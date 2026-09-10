/**
 * Profile.jsx — Sprint 10
 * Member-facing profile page: personal details, conditions, targets,
 * fasting protocol, macro plan, stats, and diet notes.
 * Accessible via /profile (member route).
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { calcBMR, foodKcal } from '../lib/day';
import { useAuthStore } from '../store/authStore';
import { getMyProfile, updateMyProfile }  from '../api/logs';
import { Card, SectionTitle, PageLoader, MemberBottomNav } from '../components/UI';
import { Eyebrow, Icon, Collapsible, Pressable } from '../components/primitives';
import { useSettingsStore, haptic } from '../store/settingsStore';
import { GOAL_OPTIONS } from '../components/Onboarding';
import { sessionEnergy } from '../utils/exerciseCalories';
import MetabolicInsight from '../components/MetabolicInsight';
import LabResults from '../components/LabResults';
import api from '../api/client';
import { plural } from '../constants';

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVATARS = ['🐶','🐱','🦊','🐻','🦁','🐼','🐸','🦋','🌟','🎈','🌈','🦄'];

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
  if (v < 18.5) return { label: 'Underweight', cls: 'text-blue-300 bg-blue-400/10 border-blue-400/20' };
  if (v < 25)   return { label: 'Healthy',     cls: 'text-gold-light bg-gold/10 border-gold/20' };
  if (v < 30)   return { label: 'Overweight',  cls: 'text-amber-300 bg-amber-400/10 border-amber-400/20' };
  return             { label: 'Obese',          cls: 'text-red-300 bg-red-400/10 border-red-400/20' };
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
        <p className="text-sm text-mid mt-2 leading-relaxed">
          Nothing learned yet. When you correct a weight in the AI chat — changing
          "1 katori dal" from 150g to the amount your bowl actually holds — it's
          remembered and used next time.
        </p>
      ) : (
        <>
          <p className="text-xs text-lo mt-1 mb-3">
            Measured from your own corrections, and used instead of the generic table.
          </p>
          <div className="space-y-1.5">
            {portions.map(p => (
              <div key={p.phrase} className="flex items-center justify-between bg-charcoal
                border border-white/[0.06] rounded-xl px-3 py-2">
                <span className="text-note text-white capitalize">{p.phrase}</span>
                <span className="text-note font-bold text-gold">
                  {p.grams}g
                  <span className="text-eyebrow font-medium text-lo ml-1.5">
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
// BMR is Mifflin-St Jeor (1990); TDEE = BMR × 1.2 plus the day's ACTUAL logged
// burn. The equations live in lib/day/energy.js — the same functions the Today
// page uses, so the two screens cannot drift apart. (They used to be two
// copies of the same code with a comment promising they matched.)
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

/**
 * A single figure about the member.
 *
 * Five of these sat in two rows in four different colours — gold, blue, amber,
 * grey — with a tinted background and a tinted border each. Colour was decoration:
 * nothing about "total logs" is blue, and with five tinted boxes competing there
 * was no way to tell which number mattered. The member opens this page to see
 * their weight, so that one is gold and the rest are ink.
 */
function StatPill({ label, value, unit, accent = false }) {
  return (
    <div className={`rounded-2xl px-3 py-3 text-center ${
      accent ? 'bg-gold/[0.07]' : 'bg-surface'}`}
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.045)' }}>
      <p className={`font-display text-[23px] leading-none font-medium tabular-nums ${
        accent ? 'text-gold-light' : 'text-white'}`}>
        {value ?? '—'}
        {unit && <span className="text-body-sm font-normal ml-1 text-lo">{unit}</span>}
      </p>
      <p className="text-micro mt-1.5 text-mute">{label}</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Profile() {
  const navigate       = useNavigate();
  const { user, logout } = useAuthStore();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const avatarIdx = useSettingsStore(st => st.avatarIdx);
  const avatar = AVATARS[avatarIdx] || AVATARS[0];
  const [error,   setError]   = useState('');

  useEffect(() => {
    getMyProfile()
      .then(({ data }) => setProfile(data))
      .catch(() => setError('Could not load profile. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader />;

  if (error) return (
    <div className="min-h-screen bg-charcoal flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-red-400 font-semibold">{error}</p>
        <button onClick={() => navigate('/')} className="mt-4 text-gold font-medium text-sm">
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
  // Sprint 7b: goals (ordered), weeks since joining, the chosen avatar
  const tdeeSummary = (() => {
    const bmrV = (p.height_cm && p.gender && p.dob && p.current_weight)
      ? calcBMR({ weightKg: parseFloat(p.current_weight), heightCm: parseFloat(p.height_cm), age: age(p.dob), gender: p.gender }) : null;
    return bmrV ? `${Math.round(bmrV * 1.2).toLocaleString('en-IN')} kcal a day at rest + activity` : 'Add height, birth date and sex';
  })();
  const goalIds  = Array.isArray(p.goals) && p.goals.length ? p.goals : (p.goal ? [p.goal] : []);
  const goalList = goalIds.map(id => GOAL_OPTIONS.find(g => g.id === id)).filter(Boolean);
  const primaryGoal = goalList[0] || null;
  const weeks = p.member_since ? Math.max(1, Math.floor((Date.now() - new Date(p.member_since).getTime()) / (7 * 86400000)) + 1) : null;
  const goalHeadline = (() => {
    if (!primaryGoal) return null;
    if (primaryGoal.id === 'lose' && p.start_weight && p.target_weight) {
      const total = +(p.start_weight - p.target_weight).toFixed(1);
      return toGoKg != null && toGoKg > 0 ? `Lose ${total} kg · ${toGoKg} kg to go` : `Lose ${total} kg · goal reached`;
    }
    if (primaryGoal.id === 'gain' && p.start_weight && p.target_weight) {
      const total = +(p.target_weight - p.start_weight).toFixed(1);
      const left = toGoKg != null ? +(-toGoKg).toFixed(1) : null;
      return left != null && left > 0 ? `Gain ${total} kg · ${left} kg to go` : `Gain ${total} kg`;
    }
    return primaryGoal.label;
  })();

  return (
    <div className="min-h-screen bg-charcoal font-sans">

      {/* ── Header: identity ── */}
      <div className="bg-gradient-to-b from-surface to-charcoal text-white px-4 pt-8 pb-5">
        <div className="max-w-md mx-auto">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.06] border border-hair flex items-center justify-center text-3xl flex-shrink-0" aria-hidden="true">
                {avatar}
              </div>
              <div className="min-w-0">
                <Eyebrow tone="gold">My Health</Eyebrow>
                <h1 className="font-display text-num font-medium leading-tight truncate">{p.name}</h1>
                <p className="text-caption text-mid mt-0.5" data-testid="profile-meta">
                  {weeks ? `Week ${weeks}` : 'New member'}
                  {p.monitor_name ? ` · Coach ${p.monitor_name}` : ''}
                  {memberAge ? ` · ${memberAge} yrs` : ''}
                </p>
              </div>
            </div>
            <button type="button" onClick={() => { haptic(8); navigate('/settings'); }} aria-label="Settings" data-testid="profile-settings"
              style={{ minWidth: 44, minHeight: 44 }}
              className="flex items-center justify-center rounded-full bg-white/[0.05] border border-hair text-mid hover:text-white active:scale-95 transition flex-shrink-0">
              <Icon name="gear" size={18} />
            </button>
          </div>

          {/* ── Goal ── */}
          <div className="mt-5" data-testid="profile-goal">
            <Eyebrow>Goal</Eyebrow>
            {goalHeadline ? (
              <p className="font-display text-xl font-medium text-white leading-tight mt-1">{goalHeadline}</p>
            ) : (
              <p className="text-sm text-mid mt-1">No goal set yet — your coach can set one, or update it in onboarding.</p>
            )}
            {goalList.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mt-2" data-testid="profile-goals">
                {goalList.slice(1).map(g => (
                  <span key={g.id} className="inline-flex items-center gap-1 text-caption font-semibold text-mid bg-white/[0.05] border border-hair rounded-full px-2.5 py-1">
                    <Icon name={g.icon} size={12} />{g.label}
                  </span>
                ))}
              </div>
            )}
            {journeyPct !== null && journeyPct >= 0 && (
              <div className="mt-3">
                <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold-light transition-all duration-700" style={{ width: `${Math.max(2, journeyPct)}%` }} />
                </div>
                <div className="flex justify-between text-caption mt-1.5">
                  <span className="text-lo">Start <span className="text-mid font-semibold tabular-nums">{p.start_weight} kg</span></span>
                  <span className="text-gold-light font-bold tabular-nums">{journeyPct}% there</span>
                  <span className="text-lo">Goal <span className="text-mid font-semibold tabular-nums">{p.target_weight} kg</span></span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Pressable variant="secondary" onPress={() => setEditing(v => !v)} className="text-sm" data-testid="profile-edit">
              <Icon name="user" size={15} />{editing ? 'Cancel' : 'Edit details'}
            </Pressable>
            <Pressable variant="ghost" onPress={() => navigate('/')} className="text-sm text-mid">
              <Icon name="chevron-left" size={15} />Today
            </Pressable>
          </div>
          {editing && (
            <div className="mt-3">
              <EditDetails
                profile={p}
                onCancel={() => setEditing(false)}
                onSaved={(patch) => {
                  setProfile(prev => ({ ...prev, ...patch }));
                  setEditing(false);
                }}
              />
            </div>
          )}
        </div>
      </div>
      {/* ── Body (Sprint 7b: My Health) ──
          At a glance → My plan → Health insights (one line each, open for detail)
          → Devices & data → Account. Every card that existed still exists; the
          detail-heavy ones sit behind a Collapsible so the page reads top-down. */}
      <div className="max-w-md mx-auto px-4 py-5 space-y-5 pb-10">

        {/* Weight stats */}
        <div className="grid grid-cols-3 gap-2">
          <StatPill label="Current weight" value={p.current_weight} unit="kg" accent />
          <StatPill label="Lost so far"
            value={lostKg !== null ? (lostKg >= 0 ? lostKg : `+${Math.abs(lostKg)}`) : null}
            unit="kg" />
          <StatPill label="To reach goal"
            value={toGoKg !== null ? (toGoKg > 0 ? toGoKg : '✓') : null}
            unit={toGoKg > 0 ? 'kg' : ''} />
        </div>

        {/* Activity stats */}
        <div className="grid grid-cols-2 gap-2">
          <StatPill label="Total logs" value={p.total_logs} />
          <StatPill label="30-day compliance"
            value={p.avg_compliance !== null ? `${p.avg_compliance}%` : null}
            />
        </div>


        <section data-testid="section-plan">
          <Eyebrow className="mb-2">My plan</Eyebrow>
          <div className="space-y-3">
        {/* Macro targets */}
        {p.macros && (
          <Card>
            <SectionTitle icon="🎯">Daily Macro Targets</SectionTitle>
            {p.macros.phase && (
              <p className="text-xs text-lo mb-3 mt-1 font-medium">Phase: {p.macros.phase}</p>
            )}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[
                { label: 'Calories', value: p.macros.kcal, unit: 'kcal', color: 'bg-orange-400/[0.08] border-orange-400/[0.16] text-orange-300' },
                { label: 'Protein',  value: p.macros.pro,  unit: 'g',    color: 'bg-blue-400/[0.08] border-blue-400/[0.16] text-blue-300' },
                { label: 'Carbs',    value: p.macros.carb, unit: 'g',    color: 'bg-amber-400/[0.08] border-amber-400/[0.16] text-amber-300' },
                { label: 'Fat',      value: p.macros.fat,  unit: 'g',    color: 'bg-gold/[0.08] border-gold/[0.16] text-gold' },
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
            <span className="text-mid font-medium">litres per day</span>
          </div>
          <p className="text-xs text-lo mt-2">Stop 1 hour before sleep. Not during meals.</p>
        </Card>

        {/* Fasting protocol */}
        {p.fasting && (
          <Card>
            <SectionTitle icon="⏰">Fasting Protocol</SectionTitle>
            <div className="mt-2 space-y-2">
              {p.fasting.label && (
                <p className="font-semibold text-white">{p.fasting.label}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-blue-400/[0.08] border border-blue-400/[0.16] rounded-xl px-3 py-2 text-center">
                  <p className="text-xs text-blue-300 font-medium mb-0.5">Fasting ends</p>
                  <p className="font-display text-lg font-semibold text-blue-200">{fmt12(p.fasting.end)}</p>
                </div>
                <div className="bg-gold/[0.08] border border-gold/[0.16] rounded-xl px-3 py-2 text-center">
                  <p className="text-xs text-gold-light font-medium mb-0.5">Fasting starts</p>
                  <p className="font-display text-lg font-semibold text-gold-light">{fmt12(p.fasting.start)}</p>
                </div>
              </div>
              {p.fasting.note && (
                <p className="text-xs text-mid bg-white/[0.04] px-3 py-2 rounded-xl border border-hair">
                  📌 {p.fasting.note}
                </p>
              )}
            </div>
          </Card>
        )}

        {/* Diet notes */}
        {p.diet_notes && (
          <Card>
            <SectionTitle icon="📋">Diet Instructions</SectionTitle>
            <p className="text-sm text-white leading-relaxed mt-2 whitespace-pre-wrap">
              {p.diet_notes}
            </p>
          </Card>
        )}

          </div>
        </section>

        <section data-testid="section-insights">
          <Eyebrow className="mb-1">Health insights</Eyebrow>
          <Card>
          <Collapsible title="Daily energy (TDEE)" summary={tdeeSummary} icon="flame" testId="ins-tdee">
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
                <p className="text-sm text-mid mt-2 leading-relaxed">
                  Still needed: <span className="text-white font-semibold">{missing.join(', ')}</span>.
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
          const totalIn      = foodKcal(e.food_items);
          const balance      = totalIn - totalOut;
          const logged       = totalIn > 0;

          return (
            <Card>
              <SectionTitle icon="🔥">Daily Energy (TDEE)</SectionTitle>
              <p className="text-xs text-lo mb-3">
                Mifflin-St Jeor BMR × 1.2, plus today's logged activity
                {!p.gender && ' · sex not set — add it under Edit details for an exact figure'}
              </p>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="bg-white/[0.04] border border-hair rounded-xl px-3 py-2.5">
                  <p className="text-lg font-extrabold text-white">{bmr}</p>
                  <p className="text-eyebrow font-bold tracking-wider text-lo mt-0.5">BMR at rest</p>
                </div>
                <div className="bg-white/[0.04] border border-hair rounded-xl px-3 py-2.5">
                  <p className="text-lg font-extrabold text-gold-light">{totalOut}</p>
                  <p className="text-eyebrow font-bold tracking-wider text-lo mt-0.5">Burned today</p>
                </div>
              </div>

              <div className="space-y-1.5 mb-3">
                {[
                  ['Resting (BMR × 1.2)', restingTdee, 'text-mid'],
                  [work.cardioMin > 0 && work.sets > 0
                    ? `Workout (${work.sets} ${plural(work.sets, 'set')} + ${work.cardioMin} min cardio)`
                    : work.sets > 0
                    ? `Strength (${work.volumeKg.toLocaleString()} kg lifted)`
                    : work.cardioMin > 0
                    ? `Cardio (${work.cardioMin} min)`
                    : 'Workout session',
                   workoutBurn,  'text-gold-light'],
                ].map(([label, val, cls]) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-mid">{label}</span>
                    <span className={`font-bold ${cls}`}>{val > 0 ? `+${val}` : val} kcal</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs pt-1.5 border-t border-white/[0.06]">
                  <span className="text-mid">Food eaten today</span>
                  <span className="font-bold text-orange-400">{totalIn} kcal</span>
                </div>
              </div>

              {logged ? (
                <div className={`rounded-xl px-3.5 py-3 border ${
                  balance > 0
                    ? 'bg-amber-400/[0.08] border-amber-400/25'
                    : 'bg-ok/[0.08] border-ok/25'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-bold ${balance > 0 ? 'text-amber-300' : 'text-gold-light'}`}>
                      {balance > 0 ? 'Surplus' : 'Deficit'}
                    </span>
                    <span className={`font-display text-xl font-bold ${balance > 0 ? 'text-amber-300' : 'text-gold-light'}`}>
                      {balance > 0 ? '+' : ''}{balance} kcal
                    </span>
                  </div>
                  <p className="text-caption text-mid mt-1 leading-relaxed">
                    {balance > 0
                      ? `You've eaten ${balance} kcal more than you burned today. A sustained surplus adds weight (~7,700 kcal ≈ 1 kg).`
                      : `You've burned ${Math.abs(balance)} kcal more than you ate. A sustained deficit of this size is roughly ${(Math.abs(balance) * 7 / 7700).toFixed(2)} kg per week.`}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl px-3.5 py-3 bg-white/[0.03] border border-hair">
                  <p className="text-xs text-mid leading-relaxed">
                    Log today's food to see whether you're in a surplus or deficit.
                  </p>
                </div>
              )}

              <p className="text-eyebrow text-lo mt-2.5 leading-relaxed">
                Estimates only — actual needs vary with body composition, medication and
                health conditions. Follow your coach's plan over these numbers.
              </p>
            </Card>
          );
        })()}

          </Collapsible>
          <Collapsible title="Body Mass Index" summary={currentBmi ? `${currentBmi} · ${bmiInfo?.label || ''}` : 'Add your height'} icon="scale" testId="ins-bmi">
        {/* BMI */}
        {currentBmi && bmiInfo && (
          <Card>
            <SectionTitle icon="⚖️">Body Mass Index</SectionTitle>
            <div className="flex items-center justify-between mt-1">
              <span className="font-display text-3xl font-semibold text-white">{currentBmi}</span>
              <span className={`text-sm font-bold px-3 py-1 rounded-full border ${bmiInfo.cls}`}>
                {bmiInfo.label}
              </span>
            </div>
            <div className="mt-3 h-2 bg-white/[0.08] rounded-full overflow-hidden">
              <div className="h-2 rounded-full bg-gradient-to-r from-blue-400 via-gold via-amber-400 to-red-500" />
            </div>
            <div className="flex justify-between text-xs text-lo mt-1">
              <span>18.5</span><span>25</span><span>30</span><span>35+</span>
            </div>
          </Card>
        )}

          </Collapsible>
          <Collapsible title="Health conditions" summary={p.conditions?.length ? `${p.conditions.length} noted` : 'None noted'} icon="pill" testId="ins-conditions">
        {/* Conditions */}
        {p.conditions?.length > 0 && (
          <Card>
            <SectionTitle icon="🏥">Health Conditions</SectionTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              {p.conditions.map(c => (
                <span key={c}
                  className="text-sm bg-white/[0.05] text-white px-3 py-1.5 rounded-full border border-white/[0.08] font-medium">
                  {CONDITION_LABELS[c] || c.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </Card>
        )}

          </Collapsible>
          <Collapsible title="Lab results" summary={'Latest values, what changed'} icon="note" testId="ins-labs">
        {/* Blood work — members enter their own and see what changed alongside */}
        <Card>
          <SectionTitle icon="🩸">Lab Results</SectionTitle>
          <div className="mt-2">
            <LabResults memberName={profile?.name || ''} />
          </div>
        </Card>

          </Collapsible>
          <Collapsible title="Your metabolism" summary={'As measured from your logs'} icon="trend" testId="ins-metabolism">
        {/* Their metabolism as measured, not predicted */}
        <Card>
          <SectionTitle icon="🧬">Your Metabolism</SectionTitle>
          <div className="mt-2">
            <MetabolicInsight />
          </div>
        </Card>

          </Collapsible>
          <Collapsible title="Your portion sizes" summary={'What the app has learned'} icon="food" testId="ins-portions">
        {/* What the app has learned about their kitchen */}
        <PortionMemory />

          </Collapsible>
          </Card>
        </section>

        <section data-testid="section-devices">
          <Eyebrow className="mb-2">Devices & data sources</Eyebrow>
        {/* Connected devices. DeviceConnect is ~900 lines of scale and tracker
            integration reachable from exactly one row buried in Settings, so
            most members never discovered it existed. Profile is where someone
            already thinking about their body data is looking. */}
        <button
          onClick={() => navigate('/devices')}
          style={{ minHeight: 56 }}
          className="w-full rounded-2xl p-4 border border-hair bg-surface
            flex items-center gap-3 text-left active:scale-[0.99] transition-transform">
          <span className="text-xl">⌚</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white">Connected devices</p>
            <p className="text-xs text-lo mt-0.5">
              Smart scale, fitness tracker and health apps
            </p>
          </div>
          <span className="text-lo">›</span>
        </button>

        </section>

        <section data-testid="section-account">
          <Eyebrow className="mb-2">Account</Eyebrow>
          <Card>
            <button type="button" onClick={() => { haptic(8); navigate('/settings'); }} data-testid="account-settings"
              style={{ minHeight: 48 }} className="w-full flex items-center gap-3 text-left py-2 border-b border-hair">
              <span className="w-8 h-8 rounded-full bg-white/[0.05] text-mid flex items-center justify-center"><Icon name="gear" size={15} /></span>
              <span className="flex-1 text-sm font-semibold text-white">Settings<span className="block text-caption text-mid font-normal">Reminders, text size, voice, meal slots</span></span>
              <Icon name="chevron-right" size={14} className="text-ghost" />
            </button>
            <button type="button" onClick={() => { haptic(8); navigate('/devices'); }}
              style={{ minHeight: 48 }} className="w-full flex items-center gap-3 text-left py-2 border-b border-hair">
              <span className="w-8 h-8 rounded-full bg-white/[0.05] text-mid flex items-center justify-center"><Icon name="phone" size={15} /></span>
              <span className="flex-1 text-sm font-semibold text-white">Connected devices</span>
              <Icon name="chevron-right" size={14} className="text-ghost" />
            </button>
            <button type="button" onClick={() => { haptic(8); logout(); }} data-testid="account-signout"
              style={{ minHeight: 48 }} className="w-full flex items-center gap-3 text-left py-2">
              <span className="w-8 h-8 rounded-full bg-red-400/[0.08] text-red-400 flex items-center justify-center"><Icon name="logout" size={15} /></span>
              <span className="flex-1 text-sm font-semibold text-red-400">Sign out</span>
            </button>
          </Card>
        </section>

        {/* Member since */}
        <p className="text-center text-xs text-lo pt-2 pb-6">
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

  const label = "block text-eyebrow font-semibold text-lo mb-1.5";
  const input = `w-full bg-charcoal border border-white/[0.10] rounded-xl px-3 py-2.5
    text-sm text-white outline-none focus:border-gold/40
    focus:ring-2 focus:ring-gold/[0.12]`;

  return (
    <div className="bg-white/[0.05] rounded-2xl p-4 border border-hair mb-4 space-y-3">
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
              className={`flex-1 text-caption font-semibold rounded-xl border transition-colors ${
                gender === v
                  ? 'bg-gold/[0.12] border-gold/35 text-gold-light'
                  : 'bg-charcoal border-white/[0.10] text-mid'
              }`}>
              {l}
            </button>
          ))}
        </div>
        <p className="text-caption text-ghost mt-1.5 leading-relaxed">
          Used only for the calorie-burn calculation — the equation needs it.
        </p>
      </div>

      {error && <p className="text-xs text-red-400 leading-relaxed">{error}</p>}

      <div className="flex gap-2">
        <button onClick={save} disabled={busy} style={{ minHeight: 40 }}
          className="flex-1 text-xs font-bold text-charcoal rounded-xl
            bg-gradient-to-r from-gold-light via-gold to-gold-dark
            active:scale-[0.98] disabled:opacity-40">
          {busy ? 'Saving…' : 'Save details'}
        </button>
        <button onClick={onCancel} style={{ minHeight: 40 }}
          className="px-4 text-xs font-bold text-mid border border-white/[0.10] rounded-xl">
          Cancel
        </button>
      </div>

      <p className="text-caption text-ghost leading-relaxed">
        Your goal and starting weight are set by your coach — message them to change those.
      </p>
    </div>
  );
}
