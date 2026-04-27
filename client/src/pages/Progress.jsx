/**
 * Progress.jsx — Sprint 6
 * Member-facing progress page: weight trend, compliance streak,
 * 30-day compliance chart, lab value highlights.
 * Accessible via /progress (patient route).
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts';
import { useAuthStore }  from '../store/authStore';
import { getLogRange }   from '../api/logs';
import api               from '../api/client';
import { Card, SectionTitle, PageLoader } from '../components/UI';
import { today } from '../constants';

// ── Helpers ───────────────────────────────────────────────────────────────────

function nDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function shortDate(str) {
  const d = new Date(str + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// ── Custom Tooltips ───────────────────────────────────────────────────────────

function WeightTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-stone-100 rounded-xl px-3 py-2 shadow-sm text-xs">
      <p className="font-bold text-emerald-600">{payload[0].value} kg</p>
      <p className="text-stone-400">{payload[0].payload.date}</p>
    </div>
  );
}

function ComplianceTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="bg-white border border-stone-100 rounded-xl px-3 py-2 shadow-sm text-xs">
      <p className={`font-bold ${v >= 75 ? 'text-emerald-600' : v >= 50 ? 'text-amber-600' : 'text-red-500'}`}>{v}%</p>
      <p className="text-stone-400">{payload[0].payload.date}</p>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatBox({ value, label, sub, color = 'emerald' }) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-700',
    blue:    'bg-blue-50 text-blue-700',
    orange:  'bg-orange-50 text-orange-700',
    purple:  'bg-purple-50 text-purple-700',
    amber:   'bg-amber-50 text-amber-700',
  };
  return (
    <div className={`rounded-2xl px-4 py-3 ${colors[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs font-semibold mt-0.5">{label}</div>
      {sub && <div className="text-xs opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function Progress() {
  const navigate       = useNavigate();
  const { user }       = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [logs,    setLogs]    = useState([]);
  const [profile, setProfile] = useState(null);
  const [labs,    setLabs]    = useState([]);

  useEffect(() => {
    const from = nDaysAgo(90);
    const to   = today();

    Promise.all([
      getLogRange(from, to),
      api.get('/patients/me').catch(() => ({ data: null })),
    ])
      .then(([logsRes, profileRes]) => {
        setLogs(logsRes.data || []);
        setProfile(profileRes.data);
        setLabs(profileRes.data?.labs || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader />;

  // ── Derived data ────────────────────────────────────────────────────────────

  const sorted   = [...logs].sort((a, b) => a.log_date.localeCompare(b.log_date));
  const last30   = sorted.slice(-30);

  const weightData = sorted
    .filter(l => l.weight_kg)
    .map(l => ({ date: shortDate(l.log_date), weight: parseFloat(l.weight_kg) }));

  const complianceData = last30.map(l => ({
    date:  shortDate(l.log_date),
    score: l.compliance_pct || 0,
  }));

  // Stats
  const latest  = sorted[sorted.length - 1];
  const latestW = latest?.weight_kg ? parseFloat(latest.weight_kg) : null;
  const startW  = profile?.start_weight ? parseFloat(profile.start_weight) : null;
  const targetW = profile?.target_weight ? parseFloat(profile.target_weight) : null;
  const lostKg  = startW && latestW ? +(startW - latestW).toFixed(1) : null;
  const toGoKg  = targetW && latestW ? +(latestW - targetW).toFixed(1) : null;
  const bmi     = latestW && profile?.height_cm
    ? (latestW / Math.pow(profile.height_cm / 100, 2)).toFixed(1)
    : null;

  // Streak — consecutive days logged ending today
  const dateSet  = new Set(logs.map(l => l.log_date));
  let streak = 0;
  let d = new Date();
  while (true) {
    const ds = d.toISOString().split('T')[0];
    if (!dateSet.has(ds)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }

  // 30-day compliance average
  const avg30 = last30.length
    ? Math.round(last30.reduce((s, l) => s + (l.compliance_pct || 0), 0) / last30.length)
    : 0;

  // Total days logged in 90 days
  const daysLogged = logs.length;

  // Lab highlights — latest per test name
  const labMap = {};
  labs.forEach(l => {
    if (!labMap[l.test_name] || l.test_date > labMap[l.test_name].test_date) {
      labMap[l.test_name] = l;
    }
  });
  const labHighlights = Object.values(labMap).slice(0, 6);

  // Progress toward target (% of journey done)
  const journeyPct = startW && targetW && latestW
    ? Math.min(100, Math.max(0, Math.round(((startW - latestW) / (startW - targetW)) * 100)))
    : null;

  const complianceColor = avg30 >= 75 ? 'emerald' : avg30 >= 50 ? 'amber' : 'orange';

  return (
    <div className="min-h-screen bg-stone-100 font-sans">

      {/* Header */}
      <div className="bg-gradient-to-br from-blue-700 to-blue-900 text-white px-4 pt-10 pb-6">
        <div className="max-w-md mx-auto">
          <button onClick={() => navigate('/')}
            className="text-blue-200 text-sm mb-3 hover:text-white transition-colors">
            ← Back to today
          </button>
          <h1 className="text-2xl font-bold">My Progress</h1>
          <p className="text-blue-200 text-sm mt-1">Last 90 days · {user?.name}</p>

          {/* Journey progress bar */}
          {journeyPct !== null && (
            <div className="mt-4 bg-white/10 rounded-2xl p-3">
              <div className="flex justify-between text-xs text-blue-200 mb-2">
                <span>Start: {startW} kg</span>
                <span className="font-bold text-white">{journeyPct}% to goal</span>
                <span>Goal: {targetW} kg</span>
              </div>
              <div className="h-3 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-emerald-300 rounded-full transition-all duration-700"
                  style={{ width: `${journeyPct}%` }}
                />
              </div>
              {lostKg !== null && lostKg > 0 && (
                <p className="text-center text-xs text-emerald-300 mt-2 font-semibold">
                  🎉 {lostKg} kg lost · {toGoKg} kg to go
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pt-4 pb-20 space-y-3">

        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-2">
          <StatBox
            value={latestW ? `${latestW} kg` : '—'}
            label="Current Weight"
            sub={bmi ? `BMI ${bmi}` : ''}
            color="emerald"
          />
          <StatBox
            value={`${streak} days`}
            label="Logging Streak"
            sub={streak >= 7 ? '🔥 On fire!' : streak >= 3 ? '👍 Keep going' : 'Start today'}
            color="orange"
          />
          <StatBox
            value={`${avg30}%`}
            label="30-day Compliance"
            sub={avg30 >= 75 ? 'Excellent!' : avg30 >= 50 ? 'Good' : 'Room to improve'}
            color={complianceColor}
          />
          <StatBox
            value={daysLogged}
            label="Days Logged"
            sub="last 90 days"
            color="blue"
          />
        </div>

        {/* Weight trend */}
        {weightData.length > 1 && (
          <Card>
            <SectionTitle icon="⚖️">Weight Trend</SectionTitle>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={weightData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0efed" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#a8a29e' }} tickLine={false} axisLine={false}
                  interval={Math.floor(weightData.length / 5)} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: '#a8a29e' }} tickLine={false} axisLine={false} />
                <Tooltip content={<WeightTip />} />
                {targetW && (
                  <ReferenceLine y={targetW} stroke="#34d399" strokeDasharray="4 4"
                    label={{ value: `Goal ${targetW}`, position: 'right', fontSize: 9, fill: '#34d399' }} />
                )}
                <Line type="monotone" dataKey="weight" stroke="#3b82f6" strokeWidth={2.5}
                  dot={{ fill: '#3b82f6', r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
            {lostKg !== null && (
              <div className="mt-2 flex justify-between text-xs px-1">
                <span className="text-stone-400">Started {startW} kg</span>
                <span className={`font-bold ${lostKg > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {lostKg > 0 ? `↓ ${lostKg} kg lost` : `↑ ${Math.abs(lostKg)} kg gained`}
                </span>
              </div>
            )}
          </Card>
        )}

        {/* 30-day compliance chart */}
        {complianceData.length > 1 && (
          <Card>
            <SectionTitle icon="📊">30-Day Compliance</SectionTitle>
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={complianceData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0efed" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#a8a29e' }} tickLine={false} axisLine={false}
                  interval={Math.floor(complianceData.length / 6)} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#a8a29e' }} tickLine={false} axisLine={false} />
                <Tooltip content={<ComplianceTip />} />
                <ReferenceLine y={75} stroke="#34d399" strokeDasharray="3 3" />
                <Bar dataKey="score" radius={[3, 3, 0, 0]}
                  fill="#10b981"
                  label={false}
                />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex justify-between text-xs text-stone-400 mt-1 px-1">
              <span>Each bar = 1 day</span>
              <span>Green line = 75% target</span>
            </div>
          </Card>
        )}

        {/* Lab highlights */}
        {labHighlights.length > 0 && (
          <Card>
            <SectionTitle icon="🧪">Latest Lab Values</SectionTitle>
            <div className="space-y-2 mt-1">
              {labHighlights.map((l, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                  <div>
                    <span className="text-sm font-medium text-stone-700">{l.test_name}</span>
                    {l.unit && <span className="text-xs text-stone-400 ml-1">{l.unit}</span>}
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-blue-600">{l.value}</span>
                    <div className="text-xs text-stone-400">{new Date(l.test_date).toLocaleDateString('en-IN')}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-stone-400 mt-2 italic">Ask your coach to add new lab results.</p>
          </Card>
        )}

        {/* Motivational summary */}
        <Card>
          <SectionTitle icon="🌟">Your Journey</SectionTitle>
          <div className="space-y-2 text-sm text-stone-600">
            {streak >= 7 && (
              <div className="flex items-center gap-2 bg-orange-50 px-3 py-2 rounded-xl">
                <span className="text-lg">🔥</span>
                <span><strong>{streak}-day streak!</strong> You're building an unstoppable habit.</span>
              </div>
            )}
            {lostKg !== null && lostKg >= 1 && (
              <div className="flex items-center gap-2 bg-emerald-50 px-3 py-2 rounded-xl">
                <span className="text-lg">🏆</span>
                <span><strong>{lostKg} kg lost</strong> since you started. Keep going!</span>
              </div>
            )}
            {avg30 >= 80 && (
              <div className="flex items-center gap-2 bg-blue-50 px-3 py-2 rounded-xl">
                <span className="text-lg">⭐</span>
                <span><strong>{avg30}% compliance</strong> over 30 days — outstanding consistency.</span>
              </div>
            )}
            {journeyPct !== null && journeyPct >= 25 && (
              <div className="flex items-center gap-2 bg-purple-50 px-3 py-2 rounded-xl">
                <span className="text-lg">🎯</span>
                <span><strong>{journeyPct}%</strong> of the way to your {targetW} kg goal!</span>
              </div>
            )}
            {streak < 3 && avg30 < 50 && (
              <div className="flex items-center gap-2 bg-amber-50 px-3 py-2 rounded-xl">
                <span className="text-lg">💪</span>
                <span>Every day counts. Log today and start your streak!</span>
              </div>
            )}
          </div>
        </Card>

      </div>
    </div>
  );
}
