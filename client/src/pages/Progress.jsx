/**
 * Progress.jsx — Sprint 6
 * Member-facing progress page: weight trend, compliance streak,
 * 30-day compliance chart, lab value highlights.
 * Accessible via /progress (patient route).
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Legend,
} from 'recharts';
import { useAuthStore }  from '../store/authStore';
import { getLogRange, getMyProfile }   from '../api/logs';
import { Card, SectionTitle, PageLoader } from '../components/UI';
import { today, ACTIVITIES, ACV_ITEMS, SUPPLEMENTS } from '../constants';

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
    <div className="bg-[#1a1a20] border border-white/[0.07] rounded-xl px-3 py-2 shadow-sm text-xs">
      <p className="font-bold text-emerald-600">{payload[0].value} kg</p>
      <p className="text-stone-400">{payload[0].payload.date}</p>
    </div>
  );
}

function ComplianceTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="bg-[#1a1a20] border border-white/[0.07] rounded-xl px-3 py-2 shadow-sm text-xs">
      <p className={`font-bold ${v >= 75 ? 'text-emerald-600' : v >= 50 ? 'text-amber-600' : 'text-red-500'}`}>{v}%</p>
      <p className="text-stone-400">{payload[0].payload.date}</p>
    </div>
  );
}

// ── Past Log Viewer Modal (Sprint 11) ─────────────────────────────────────────

function PastLogModal({ log, onClose }) {
  if (!log) return null;

  const foodItems  = log.food_items  || [];
  const activities = log.activities  || {};
  const acv        = log.acv         || {};
  const supps      = log.supplements || {};
  const sleep      = log.sleep       || {};

  const checkedActs  = ACTIVITIES.filter(a => activities[a.id]);
  const checkedAcv   = ACV_ITEMS.filter(a => acv[a.id]);
  const checkedSupps = SUPPLEMENTS.filter(s => supps[s.id]);

  const kcal = foodItems.reduce((sum, item) => {
    if (item.per_100g) return sum + Math.round((item.per_100g.calories || 0) * item.grams / 100);
    return sum;
  }, 0);

  const dateStr = new Date(log.log_date + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center p-2">
      <div className="bg-[#131317] rounded-3xl border border-white/[0.08] w-full max-w-md max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-stone-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-stone-800 text-base">{dateStr}</h3>
            <div className="flex items-center gap-3 mt-1">
              {log.weight_kg && (
                <span className="text-xs font-semibold text-emerald-600">⚖ {log.weight_kg} kg</span>
              )}
              {log.compliance_pct != null && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  log.compliance_pct >= 75 ? 'bg-emerald-100 text-emerald-700' :
                  log.compliance_pct >= 50 ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-600'}`}>
                  {log.compliance_pct}% compliance
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-2xl leading-none">×</button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Activities */}
          {checkedActs.length > 0 && (
            <div>
              <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">🏃 Activities</p>
              <div className="flex flex-wrap gap-1.5">
                {checkedActs.map(a => (
                  <span key={a.id} className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-2.5 py-1 rounded-full font-medium">
                    {a.icon} {a.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ACV */}
          {checkedAcv.length > 0 && (
            <div>
              <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">🍶 ACV</p>
              <div className="flex flex-wrap gap-1.5">
                {checkedAcv.map(a => (
                  <span key={a.id} className="text-xs bg-amber-50 text-amber-700 border border-amber-100 px-2.5 py-1 rounded-full font-medium">
                    {a.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Food */}
          {foodItems.length > 0 && (
            <div>
              <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">
                🥗 Food {kcal > 0 && <span className="font-normal text-orange-500 normal-case">· {kcal} kcal</span>}
              </p>
              <div className="space-y-1">
                {foodItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-stone-50 last:border-0">
                    <span className="text-stone-700">{item.name || item.food_name}</span>
                    <span className="text-stone-400 text-xs">{item.grams}g
                      {item.meal && <span className="ml-1 text-stone-300">· {item.meal}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Water */}
          {log.water_ml > 0 && (
            <div>
              <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">💧 Water</p>
              <p className="text-sm text-blue-600 font-semibold">{(log.water_ml / 1000).toFixed(1)} L</p>
            </div>
          )}

          {/* Supplements */}
          {checkedSupps.length > 0 && (
            <div>
              <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">💊 Supplements</p>
              <div className="flex flex-wrap gap-1.5">
                {checkedSupps.map(s => (
                  <span key={s.id} className="text-xs bg-purple-50 text-purple-700 border border-purple-100 px-2.5 py-1 rounded-full font-medium">
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Sleep */}
          {(sleep.bedtime || sleep.waketime) && (
            <div>
              <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">🌙 Sleep</p>
              <p className="text-sm text-stone-600">
                {sleep.bedtime && `Bed ${sleep.bedtime?.slice(0,5)}`}
                {sleep.bedtime && sleep.waketime && ' → '}
                {sleep.waketime && `Wake ${sleep.waketime?.slice(0,5)}`}
                {sleep.quality && <span className="ml-2 text-amber-500">{'★'.repeat(sleep.quality)}</span>}
              </p>
            </div>
          )}

          {/* Notes */}
          {log.notes && (
            <div>
              <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">📝 Notes</p>
              <p className="text-sm text-stone-600 whitespace-pre-wrap leading-relaxed">{log.notes}</p>
            </div>
          )}

          {!checkedActs.length && !foodItems.length && !log.weight_kg && (
            <p className="text-sm text-stone-400 italic text-center py-4">No data recorded this day.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatBox({ value, label, sub, color = 'emerald' }) {
  const colors = {
    emerald: 'bg-[rgba(124,92,252,0.08)] text-[#7c5cfc] border border-[rgba(124,92,252,0.14)]',
    blue:    'bg-[rgba(96,165,250,0.08)] text-blue-400 border border-[rgba(96,165,250,0.14)]',
    orange:  'bg-[rgba(251,146,60,0.08)] text-orange-400 border border-[rgba(251,146,60,0.14)]',
    purple:  'bg-[rgba(192,132,252,0.08)] text-purple-400 border border-[rgba(192,132,252,0.14)]',
    amber:   'bg-[rgba(251,191,36,0.08)] text-amber-400 border border-[rgba(251,191,36,0.14)]',
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
  const [selectedLog, setSelectedLog] = useState(null); // Sprint 11: past log viewer

  useEffect(() => {
    const from = nDaysAgo(90);
    const to   = today();

    Promise.all([
      getLogRange(from, to),
      getMyProfile().catch(() => ({ data: null })),
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

  // Sprint 12: 7-day macro trend — compute kcal/pro/carb/fat per day from food_items
  const last7 = sorted.slice(-7);
  const nutritionTrend = last7.map(log => {
    const items = Array.isArray(log.food_items) ? log.food_items : [];
    const macros = items.reduce((acc, item) => {
      if (!item.per_100g) return acc;
      const f = (item.grams || 0) / 100;
      const n = item.per_100g;
      return {
        kcal: acc.kcal + Math.round((n.calories || 0) * f),
        pro:  +(acc.pro  + (n.protein    || 0) * f).toFixed(1),
        carb: +(acc.carb + ((n.net_carbs != null ? n.net_carbs : n.total_carbs) || 0) * f).toFixed(1),
        fat:  +(acc.fat  + (n.fat        || 0) * f).toFixed(1),
      };
    }, { kcal: 0, pro: 0, carb: 0, fat: 0 });
    const d = new Date(log.log_date + 'T00:00:00');
    return {
      date: `${d.getDate()}/${d.getMonth() + 1}`,
      ...macros,
    };
  }).filter(d => d.kcal > 0); // only days with food logged

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
    <div className="min-h-screen bg-[#0b0b0e] font-sans">

      {/* Header */}
      <div className="bg-gradient-to-br from-[#0d0b18] to-[#07060f] text-white px-4 pt-10 pb-6">
        <div className="max-w-md mx-auto">
          <button onClick={() => navigate('/')}
            className="text-[#4e4e5c] text-sm mb-3 hover:text-[#8e8e9a] transition-colors">
            ← Back to today
          </button>
          <h1 className="text-2xl font-bold">My Progress</h1>
          <p className="text-blue-200 text-sm mt-1">Last 90 days · {user?.name}</p>

          {/* Journey progress bar */}
          {journeyPct !== null && (
            <div className="mt-4 bg-white/[0.05] rounded-2xl p-3 border border-white/[0.07]">
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
                <p className="text-center text-xs text-[#7c5cfc] mt-2 font-semibold">
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
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#4e4e5c' }} tickLine={false} axisLine={false}
                  interval={Math.floor(weightData.length / 5)} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: '#4e4e5c' }} tickLine={false} axisLine={false} />
                <Tooltip content={<WeightTip />} />
                {targetW && (
                  <ReferenceLine y={targetW} stroke="#a78bfa" strokeDasharray="4 4"
                    label={{ value: `Goal ${targetW}`, position: 'right', fontSize: 9, fill: '#a78bfa' }} />
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
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#4e4e5c' }} tickLine={false} axisLine={false}
                  interval={Math.floor(complianceData.length / 6)} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#4e4e5c' }} tickLine={false} axisLine={false} />
                <Tooltip content={<ComplianceTip />} />
                <ReferenceLine y={75} stroke="#a78bfa" strokeDasharray="3 3" />
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

        {/* Sprint 12: 7-day nutrition trend */}
        {nutritionTrend.length > 1 && (
          <Card>
            <SectionTitle icon="🥗">7-Day Nutrition Trend</SectionTitle>
            <div className="flex gap-3 text-xs mb-3 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-orange-400 inline-block"/>Calories</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block"/>Protein</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block"/>Carbs</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-purple-400 inline-block"/>Fat</span>
            </div>
            {/* Calories bar */}
            <p className="text-xs text-stone-400 font-medium mb-1">Calories (kcal)</p>
            <ResponsiveContainer width="100%" height={90}>
              <BarChart data={nutritionTrend} margin={{ top: 2, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#4e4e5c' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 8, fill: '#4e4e5c' }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => [`${v} kcal`, 'Calories']}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e7e5e4' }} />
                {profile?.macros?.kcal && (
                  <ReferenceLine y={profile.macros.kcal} stroke="#a78bfa" strokeDasharray="3 3" />
                )}
                <Bar dataKey="kcal" fill="#fb923c" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* Macros line chart */}
            <p className="text-xs text-stone-400 font-medium mt-3 mb-1">Protein · Carbs · Fat (g)</p>
            <ResponsiveContainer width="100%" height={110}>
              <ComposedChart data={nutritionTrend} margin={{ top: 2, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#4e4e5c' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 8, fill: '#4e4e5c' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e7e5e4' }}
                  formatter={(v, name) => [`${v}g`, name.charAt(0).toUpperCase() + name.slice(1)]} />
                <Line type="monotone" dataKey="pro"  stroke="#60a5fa" strokeWidth={2} dot={{ r: 3, fill: '#60a5fa' }} />
                <Line type="monotone" dataKey="carb" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3, fill: '#fbbf24' }} />
                <Line type="monotone" dataKey="fat"  stroke="#c084fc" strokeWidth={2} dot={{ r: 3, fill: '#c084fc' }} />
              </ComposedChart>
            </ResponsiveContainer>

            {nutritionTrend.length > 0 && (() => {
              const avg = nutritionTrend.reduce((a, d) => ({
                kcal: a.kcal + d.kcal, pro: a.pro + d.pro,
                carb: a.carb + d.carb, fat: a.fat + d.fat,
              }), { kcal: 0, pro: 0, carb: 0, fat: 0 });
              const n = nutritionTrend.length;
              return (
                <div className="flex gap-3 text-xs mt-2 px-1 pt-2 border-t border-stone-100 flex-wrap">
                  <span className="text-stone-400">Avg/day:</span>
                  <span className="font-bold text-orange-500">{Math.round(avg.kcal/n)} kcal</span>
                  <span className="text-blue-500">P {(avg.pro/n).toFixed(1)}g</span>
                  <span className="text-amber-500">C {(avg.carb/n).toFixed(1)}g</span>
                  <span className="text-purple-500">F {(avg.fat/n).toFixed(1)}g</span>
                </div>
              );
            })()}
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
            <p className="text-xs text-[#4e4e5c] mt-2 italic">Ask your coach to add new lab results.</p>
          </Card>
        )}

        {/* Sprint 11: Log history — last 30 logs */}
        {sorted.length > 0 && (
          <Card>
            <SectionTitle icon="📅">Log History</SectionTitle>
            <p className="text-xs text-stone-400 mb-3">Tap any day to see the full log</p>
            <div className="space-y-1.5">
              {[...sorted].reverse().slice(0, 30).map(log => {
                const d = new Date(log.log_date + 'T00:00:00');
                const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' });
                const pct = log.compliance_pct;
                return (
                  <button key={log.log_date} onClick={() => setSelectedLog(log)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl
                      bg-stone-50 hover:bg-white/[0.05] transition-colors text-left group">
                    <div className="w-14 flex-shrink-0">
                      <p className="text-xs font-bold text-stone-700">{label.split(', ')[1] || label}</p>
                      <p className="text-xs text-stone-400">{label.split(', ')[0]}</p>
                    </div>
                    <div className="flex-1 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${
                        pct >= 75 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
                      }`} style={{ width: `${pct || 0}%` }} />
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {log.weight_kg && (
                        <span className="text-xs font-semibold text-stone-500">{log.weight_kg}kg</span>
                      )}
                      <span className={`text-xs font-bold w-10 text-right ${
                        pct >= 75 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500'
                      }`}>{pct != null ? `${pct}%` : '—'}</span>
                      <svg className="w-3.5 h-3.5 text-stone-300 group-hover:text-stone-500 transition-colors"
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
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

      {selectedLog && <PastLogModal log={selectedLog} onClose={() => setSelectedLog(null)} />}
    </div>
  );
}
