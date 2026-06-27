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
import { Card, SectionTitle, PageLoader, BackButton, PatientBottomNav } from '../components/UI';

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
  if (v < 25)   return { label: 'Healthy',     cls: 'text-[#a78bfa] bg-[rgba(124,92,252,0.10)] border-[rgba(124,92,252,0.20)]' };
  if (v < 30)   return { label: 'Overweight',  cls: 'text-amber-300 bg-[rgba(251,191,36,0.10)] border-[rgba(251,191,36,0.20)]' };
  return             { label: 'Obese',          cls: 'text-red-300 bg-[rgba(248,113,113,0.10)] border-[rgba(248,113,113,0.20)]' };
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
    emerald: 'bg-[rgba(124,92,252,0.08)] border-[rgba(124,92,252,0.16)] text-[#a78bfa]',
    blue:    'bg-[rgba(96,165,250,0.08)] border-[rgba(96,165,250,0.16)] text-blue-300',
    amber:   'bg-[rgba(251,191,36,0.08)] border-[rgba(251,191,36,0.16)] text-amber-300',
    stone:   'bg-white/[0.04] border-white/[0.08] text-[#9a9aa6]',
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
  const [error,   setError]   = useState('');

  useEffect(() => {
    getMyProfile()
      .then(({ data }) => setProfile(data))
      .catch(() => setError('Could not load profile. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader />;

  if (error) return (
    <div className="min-h-screen bg-[#0b0b0e] flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-red-400 font-semibold">{error}</p>
        <button onClick={() => navigate('/')} className="mt-4 text-[#7c5cfc] font-medium text-sm">
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
    <div className="min-h-screen bg-[#0b0b0e] font-sans">

      {/* ── Header ── */}
      <div className="bg-gradient-to-br from-[#0d0b18] to-[#07060f] text-white px-4 pt-10 pb-8">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between mb-6">
            <BackButton onClick={() => navigate('/')} label="Back to log" />
            <button onClick={() => navigate('/settings')}
              className="text-xs font-semibold text-[#a78bfa] hover:text-white transition-colors">
              Settings
            </button>
          </div>

          {/* Avatar + name */}
          <div className="flex items-center gap-4 mb-5">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.08] border border-white/[0.10] flex items-center justify-center text-3xl font-display font-semibold select-none">
              {p.name?.[0]?.toUpperCase()}
            </div>
            <div>
              <h1 className="font-display text-2xl font-medium">{p.name}</h1>
              <p className="text-[#c4b5fd] text-sm mt-0.5">
                {p.phone && `+91 ${p.phone}`}
                {memberAge && ` · ${memberAge} yrs`}
                {p.height_cm && ` · ${p.height_cm} cm`}
              </p>
              {p.monitor_name && (
                <p className="text-xs text-[#a78bfa] mt-1">🏋️ Coach: {p.monitor_name}</p>
              )}
            </div>
          </div>

          {/* Journey progress bar */}
          {journeyPct !== null && journeyPct >= 0 && (
            <div className="bg-white/[0.05] rounded-2xl p-3 border border-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="flex justify-between text-xs text-[#c4b5fd] mb-1.5">
                <span>Journey progress</span>
                <span className="font-bold text-white">{journeyPct}%</span>
              </div>
              <div className="h-2 bg-white/[0.10] rounded-full overflow-hidden">
                <div
                  className="h-2 rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.max(2, journeyPct)}%`,
                    background: journeyPct >= 100
                      ? 'linear-gradient(90deg, #7c5cfc, #d4af6a)'
                      : 'linear-gradient(90deg, #7c5cfc, #a78bfa)',
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-[#a78bfa] mt-1.5">
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
              <span className="font-display text-3xl font-semibold text-[#ededf0]">{currentBmi}</span>
              <span className={`text-sm font-bold px-3 py-1 rounded-full border ${bmiInfo.cls}`}>
                {bmiInfo.label}
              </span>
            </div>
            <div className="mt-3 h-2 bg-white/[0.08] rounded-full overflow-hidden">
              <div className="h-2 rounded-full bg-gradient-to-r from-blue-400 via-[#7c5cfc] via-amber-400 to-red-500" />
            </div>
            <div className="flex justify-between text-xs text-[#5a5a68] mt-1">
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
                  className="text-sm bg-white/[0.05] text-[#d8d8de] px-3 py-1.5 rounded-full border border-white/[0.08] font-medium">
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
                <p className="font-semibold text-[#d8d8de]">{p.fasting.label}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[rgba(96,165,250,0.08)] border border-[rgba(96,165,250,0.16)] rounded-xl px-3 py-2 text-center">
                  <p className="text-xs text-blue-300 font-medium mb-0.5">Fasting ends</p>
                  <p className="font-display text-lg font-semibold text-blue-200">{fmt12(p.fasting.end)}</p>
                </div>
                <div className="bg-[rgba(124,92,252,0.08)] border border-[rgba(124,92,252,0.16)] rounded-xl px-3 py-2 text-center">
                  <p className="text-xs text-[#a78bfa] font-medium mb-0.5">Fasting starts</p>
                  <p className="font-display text-lg font-semibold text-[#c4b5fd]">{fmt12(p.fasting.start)}</p>
                </div>
              </div>
              {p.fasting.note && (
                <p className="text-xs text-[#9a9aa6] bg-white/[0.04] px-3 py-2 rounded-xl border border-white/[0.07]">
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
              <p className="text-xs text-[#5a5a68] mb-3 mt-1 font-medium">Phase: {p.macros.phase}</p>
            )}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[
                { label: 'Calories', value: p.macros.kcal, unit: 'kcal', color: 'bg-[rgba(251,146,60,0.08)] border-[rgba(251,146,60,0.16)] text-orange-300' },
                { label: 'Protein',  value: p.macros.pro,  unit: 'g',    color: 'bg-[rgba(96,165,250,0.08)] border-[rgba(96,165,250,0.16)] text-blue-300' },
                { label: 'Carbs',    value: p.macros.carb, unit: 'g',    color: 'bg-[rgba(251,191,36,0.08)] border-[rgba(251,191,36,0.16)] text-amber-300' },
                { label: 'Fat',      value: p.macros.fat,  unit: 'g',    color: 'bg-[rgba(192,132,252,0.08)] border-[rgba(192,132,252,0.16)] text-purple-300' },
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
            <span className="text-[#9a9aa6] font-medium">litres per day</span>
          </div>
          <p className="text-xs text-[#5a5a68] mt-2">Stop 1 hour before sleep. Not during meals.</p>
        </Card>

        {/* Diet notes */}
        {p.diet_notes && (
          <Card>
            <SectionTitle icon="📋">Diet Instructions</SectionTitle>
            <p className="text-sm text-[#d8d8de] leading-relaxed mt-2 whitespace-pre-wrap">
              {p.diet_notes}
            </p>
          </Card>
        )}

        {/* Member since */}
        <p className="text-center text-xs text-[#4e4e5c] pt-2 pb-6">
          Member since {new Date(p.member_since).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </p>
      </div>
      <PatientBottomNav />
    </div>
  );
}
