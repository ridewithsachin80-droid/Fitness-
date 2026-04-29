/**
 * Profile.jsx — Sprint 10
 * Member-facing profile page: personal details, conditions, targets,
 * fasting protocol, macro plan, stats, and diet notes.
 * Accessible via /profile (patient route).
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { getMyProfile }  from '../api/logs';
import { Card, SectionTitle, PageLoader, BackButton } from '../components/UI';

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
  if (v < 18.5) return { label: 'Underweight', cls: 'text-blue-600 bg-blue-50 border-blue-200' };
  if (v < 25)   return { label: 'Healthy',     cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' };
  if (v < 30)   return { label: 'Overweight',  cls: 'text-amber-600 bg-amber-50 border-amber-200' };
  return             { label: 'Obese',          cls: 'text-red-600 bg-red-50 border-red-200' };
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
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    blue:    'bg-blue-50 border-blue-100 text-blue-700',
    amber:   'bg-amber-50 border-amber-100 text-amber-700',
    stone:   'bg-stone-50 border-stone-100 text-stone-700',
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 text-center ${colors[color]}`}>
      <p className="text-2xl font-bold">
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
  const [error,   setError]   = useState('');

  useEffect(() => {
    getMyProfile()
      .then(({ data }) => setProfile(data))
      .catch(() => setError('Could not load profile. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader />;

  if (error) return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-red-500 font-semibold">{error}</p>
        <button onClick={() => navigate('/')} className="mt-4 text-emerald-600 font-medium text-sm">
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
    <div className="min-h-screen bg-stone-50">

      {/* ── Header ── */}
      <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 text-white px-4 pt-10 pb-8">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between mb-6">
            <BackButton onClick={() => navigate('/')} label="Back to log" />
            <button onClick={() => navigate('/settings')}
              className="text-xs font-semibold text-emerald-200 hover:text-white">
              Settings
            </button>
          </div>

          {/* Avatar + name */}
          <div className="flex items-center gap-4 mb-5">
            <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-3xl font-bold select-none">
              {p.name?.[0]?.toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold">{p.name}</h1>
              <p className="text-emerald-300 text-sm mt-0.5">
                {p.phone && `+91 ${p.phone}`}
                {memberAge && ` · ${memberAge} yrs`}
                {p.height_cm && ` · ${p.height_cm} cm`}
              </p>
              {p.monitor_name && (
                <p className="text-xs text-emerald-200 mt-1">🏋️ Coach: {p.monitor_name}</p>
              )}
            </div>
          </div>

          {/* Journey progress bar */}
          {journeyPct !== null && journeyPct >= 0 && (
            <div className="bg-white/10 rounded-2xl p-3">
              <div className="flex justify-between text-xs text-emerald-200 mb-1.5">
                <span>Journey progress</span>
                <span className="font-bold text-white">{journeyPct}%</span>
              </div>
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-2 bg-emerald-400 rounded-full transition-all"
                  style={{ width: `${Math.max(2, journeyPct)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-emerald-300 mt-1.5">
                <span>Start: {p.start_weight} kg</span>
                <span>Goal: {p.target_weight} kg</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-md mx-auto px-4 py-5 space-y-4 pb-10">

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
              <span className="text-3xl font-bold text-stone-800">{currentBmi}</span>
              <span className={`text-sm font-bold px-3 py-1 rounded-full border ${bmiInfo.cls}`}>
                {bmiInfo.label}
              </span>
            </div>
            <div className="mt-3 h-2 bg-stone-100 rounded-full overflow-hidden">
              <div className="h-2 rounded-full bg-gradient-to-r from-blue-400 via-emerald-400 via-amber-400 to-red-500" />
            </div>
            <div className="flex justify-between text-xs text-stone-400 mt-1">
              <span>18.5</span><span>25</span><span>30</span><span>35+</span>
            </div>
          </Card>
        )}

        {/* Conditions */}
        {p.conditions?.length > 0 && (
          <Card>
            <SectionTitle icon="🏥">Health Conditions</SectionTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              {p.conditions.map(c => (
                <span key={c}
                  className="text-sm bg-stone-100 text-stone-700 px-3 py-1.5 rounded-full border border-stone-200 font-medium">
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
                <p className="font-semibold text-stone-700">{p.fasting.label}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-center">
                  <p className="text-xs text-blue-500 font-medium mb-0.5">Fasting ends</p>
                  <p className="text-lg font-bold text-blue-700">{fmt12(p.fasting.end)}</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 text-center">
                  <p className="text-xs text-emerald-500 font-medium mb-0.5">Fasting starts</p>
                  <p className="text-lg font-bold text-emerald-700">{fmt12(p.fasting.start)}</p>
                </div>
              </div>
              {p.fasting.note && (
                <p className="text-xs text-stone-500 bg-stone-50 px-3 py-2 rounded-xl border border-stone-100">
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
              <p className="text-xs text-stone-400 mb-3 mt-1 font-medium">Phase: {p.macros.phase}</p>
            )}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[
                { label: 'Calories', value: p.macros.kcal, unit: 'kcal', color: 'bg-orange-50 border-orange-100 text-orange-700' },
                { label: 'Protein',  value: p.macros.pro,  unit: 'g',    color: 'bg-blue-50 border-blue-100 text-blue-700' },
                { label: 'Carbs',    value: p.macros.carb, unit: 'g',    color: 'bg-amber-50 border-amber-100 text-amber-700' },
                { label: 'Fat',      value: p.macros.fat,  unit: 'g',    color: 'bg-purple-50 border-purple-100 text-purple-700' },
              ].filter(m => m.value).map(m => (
                <div key={m.label} className={`rounded-xl border px-3 py-2.5 text-center ${m.color}`}>
                  <p className="text-xl font-bold">{m.value}<span className="text-xs font-normal ml-1">{m.unit}</span></p>
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
            <span className="text-3xl font-bold text-blue-600">{(p.water_target / 1000).toFixed(1)}</span>
            <span className="text-stone-500 font-medium">litres per day</span>
          </div>
          <p className="text-xs text-stone-400 mt-2">Stop 1 hour before sleep. Not during meals.</p>
        </Card>

        {/* Diet notes */}
        {p.diet_notes && (
          <Card>
            <SectionTitle icon="📋">Diet Instructions</SectionTitle>
            <p className="text-sm text-stone-600 leading-relaxed mt-2 whitespace-pre-wrap">
              {p.diet_notes}
            </p>
          </Card>
        )}

        {/* Member since */}
        <p className="text-center text-xs text-stone-300 pt-2 pb-6">
          Member since {new Date(p.member_since).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </p>
      </div>
    </div>
  );
}
