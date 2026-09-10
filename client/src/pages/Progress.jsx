/**
 * Progress.jsx — Sprint 6
 * Member-facing progress page: weight trend, compliance streak,
 * 30-day compliance chart, lab value highlights.
 * Accessible via /progress (member route).
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Legend,
} from 'recharts';
import { HeroNumber, Segmented, Eyebrow, Icon, EmptyState } from '../components/primitives';
import { calcFoodMacros } from '../lib/day';
import { haptic } from '../store/settingsStore';
import { useAuthStore }  from '../store/authStore';
import { getLogRange, getMyProfile }   from '../api/logs';
import { Card, SectionTitle, PageLoader, MemberBottomNav } from '../components/UI';
import StrengthProgress from '../components/StrengthProgress';
import WeeklyReportCard from '../components/WeeklyReportCard';
import MuscleCoverage from '../components/MuscleCoverage';
import TrainingSummary from '../components/TrainingSummary';
import { today, istDate, ACTIVITIES, ACV_ITEMS, SUPPLEMENTS, plural } from '../constants';

// ── Helpers ───────────────────────────────────────────────────────────────────

function nDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function shortDate(str) {
  const d = new Date(String(str).slice(0, 10) + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// ── Custom Tooltips ───────────────────────────────────────────────────────────

function WeightTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-hair rounded-xl px-3 py-2 shadow-sm text-xs">
      <p className="font-bold text-gold-deep">{payload[0].value} kg</p>
      <p className="text-lo">{payload[0].payload.date}</p>
    </div>
  );
}

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

  const dateStr = new Date(String(log.log_date).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center p-2">
      <div className="bg-charcoal rounded-3xl border border-white/[0.08] w-full max-w-md max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-hair flex-shrink-0">
          <div>
            <h3 className="font-bold text-white text-base">{dateStr}</h3>
            <div className="flex items-center gap-3 mt-1">
              {log.weight_kg && (
                <span className="text-xs font-semibold text-gold-deep">⚖ {log.weight_kg} kg</span>
              )}
              {log.compliance_pct != null && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  log.compliance_pct >= 75 ? 'bg-gold/[0.13] text-gold-light' :
                  log.compliance_pct >= 50 ? 'bg-amber-400/[0.14] text-amber-400' :
                  'bg-red-400/[0.14] text-red-400'}`}>
                  {log.compliance_pct}% compliance
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-lo hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Activities */}
          {checkedActs.length > 0 && (
            <div>
              <p className="text-xs font-bold text-lo tracking-wider mb-2">🏃 Activities</p>
              <div className="flex flex-wrap gap-1.5">
                {checkedActs.map(a => (
                  <span key={a.id} className="text-xs bg-gold/[0.07] text-gold-light border border-gold/[0.14] px-2.5 py-1 rounded-full font-medium">
                    {a.icon} {a.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ACV */}
          {checkedAcv.length > 0 && (
            <div>
              <p className="text-xs font-bold text-lo tracking-wider mb-2">🍶 ACV</p>
              <div className="flex flex-wrap gap-1.5">
                {checkedAcv.map(a => (
                  <span key={a.id} className="text-xs bg-amber-400/[0.08] text-amber-400 border border-amber-400/15 px-2.5 py-1 rounded-full font-medium">
                    {a.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Food */}
          {foodItems.length > 0 && (
            <div>
              <p className="text-xs font-bold text-lo tracking-wider mb-2">
                🥗 Food {kcal > 0 && <span className="font-normal text-orange-300 normal-case">· {kcal} kcal</span>}
              </p>
              <div className="space-y-1">
                {foodItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-hair last:border-0">
                    <span className="text-white">{item.name || item.food_name}</span>
                    <span className="text-lo text-xs">{item.grams}g
                      {item.meal && <span className="ml-1 text-ghost">· {item.meal}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Water */}
          {log.water_ml > 0 && (
            <div>
              <p className="text-xs font-bold text-lo tracking-wider mb-1">💧 Water</p>
              <p className="text-sm text-blue-400 font-semibold">{(log.water_ml / 1000).toFixed(1)} L</p>
            </div>
          )}

          {/* Supplements */}
          {checkedSupps.length > 0 && (
            <div>
              <p className="text-xs font-bold text-lo tracking-wider mb-2">💊 Supplements</p>
              <div className="flex flex-wrap gap-1.5">
                {checkedSupps.map(s => (
                  <span key={s.id} className="text-xs bg-amber-400/[0.08] text-amber-400 border border-amber-400/15 px-2.5 py-1 rounded-full font-medium">
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Sleep */}
          {(sleep.bedtime || sleep.waketime) && (
            <div>
              <p className="text-xs font-bold text-lo tracking-wider mb-1">🌙 Sleep</p>
              <p className="text-sm text-mid">
                {sleep.bedtime && `Bed ${sleep.bedtime?.slice(0,5)}`}
                {sleep.bedtime && sleep.waketime && ' → '}
                {sleep.waketime && `Wake ${sleep.waketime?.slice(0,5)}`}
                {sleep.quality && <span className="ml-2 text-amber-400">{'★'.repeat(sleep.quality)}</span>}
              </p>
            </div>
          )}

          {/* Notes */}
          {log.notes && (
            <div>
              <p className="text-xs font-bold text-lo tracking-wider mb-1">📝 Notes</p>
              <p className="text-sm text-mid whitespace-pre-wrap leading-relaxed">{log.notes}</p>
            </div>
          )}

          {!checkedActs.length && !foodItems.length && !log.weight_kg && (
            <p className="text-sm text-lo italic text-center py-4">No data recorded this day.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

/**
 * A single figure from the member's own data.
 *
 * Four tiles used to arrive in four different accent colours — gold, orange,
 * blue, amber — each with a tinted background and a tinted border. Colour was
 * carrying no information: nothing about "days logged" is blue, and with every
 * tile shouting, none of them was the one to look at.
 *
 * Now the numbers are set in the display face on the same quiet surface, and
 * gold is spent on exactly one tile per screen: the one the member is here to
 * see. `accent` marks it. Everything else is ink, which is what makes the gold
 * mean something when it appears.
 *
 * `tone` still separates good from concerning, but through a small mark beside
 * the caption rather than by repainting the whole tile.
 */
function StatBox({ value, label, sub, accent = false, tone = null }) {
  const dot = tone === 'good' ? 'bg-ok'
            : tone === 'warn' ? 'bg-gold-deep'
            : null;
  return (
    <div className={`rounded-2xl px-4 py-3 border ${
      accent
        ? 'bg-gold/[0.07] border-gold/[0.22]'
        : 'bg-surface border-hair'
    }`}>
      <div className={`font-display text-num leading-none font-semibold ${
        accent ? 'text-gold-light' : 'text-white'}`}>
        {value}
      </div>
      <div className="text-note font-medium mt-1.5 text-mid">{label}</div>
      {sub && (
        <div className="flex items-center gap-1.5 mt-1">
          {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />}
          <span className="text-micro text-lo">{sub}</span>
        </div>
      )}
    </div>
  );
}


// ── Chart placeholders ────────────────────────────────────────────────────────
// Every chart on this page was gated on `length > 1`, so a member in their
// first week saw section headings with nothing under them and no explanation.
// The second-most-important tab in the app looked broken exactly when a new
// member was deciding whether to trust it. Say what's coming instead.
function ChartEmpty({ icon, title, need }) {
  return (
    <Card>
      <SectionTitle icon={icon}>{title}</SectionTitle>
      <div className="text-center py-6">
        <p className="text-sm text-lo">{need}</p>
        <p className="text-xs text-ghost mt-1">Your chart appears here automatically.</p>
      </div>
    </Card>
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
  const [range, setRange] = useState('30');             // Sprint 5: 7 / 30 / 90 day chart window

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

  const sorted   = [...logs]
    .map(l => ({ ...l, log_date: String(l.log_date).slice(0, 10) }))
    .sort((a, b) => a.log_date.localeCompare(b.log_date));
  const last30   = sorted.slice(-30);

  const rangeFrom  = nDaysAgo(parseInt(range, 10));
  const weightAll  = sorted.filter(l => l.weight_kg);
  const weightData = weightAll
    .filter(l => l.log_date >= rangeFrom)
    .map(l => ({ date: shortDate(l.log_date), weight: parseFloat(l.weight_kg) }));
  // Change over the selected window: first weigh-in in range → latest
  const rangeDelta = weightData.length > 1
    ? +(weightData[weightData.length - 1].weight - weightData[0].weight).toFixed(1)
    : null;

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

  // Streak — consecutive days logged ending today.
  // NOTE: `ds` must be derived from `d` (which walks backwards); computing
  // today's date inside the loop made the condition permanently true and
  // hung the page for anyone who had logged today.
  const dateSet  = new Set(logs.map(l => String(l.log_date).slice(0, 10)));
  const istDateStr = (dt) =>
    new Date(dt.getTime() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];

  let streak = 0;
  let d = new Date();
  // A streak can end yesterday if today isn't logged yet
  if (!dateSet.has(istDateStr(d))) d.setDate(d.getDate() - 1);
  // Bounded by the data we actually fetched (90 days) — never unbounded
  for (let i = 0; i < 400; i++) {
    if (!dateSet.has(istDateStr(d))) break;
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
    // One definition of macros (lib/day) — this used to be a hand copy of
    // calcFoodMacros that had already drifted (it rounded per item).
    const mm = calcFoodMacros(items);
    const macros = { kcal: mm.kcal, pro: +mm.pro.toFixed(1), carb: +mm.carb.toFixed(1), fat: +mm.fat.toFixed(1) };
    const d = new Date(String(log.log_date).slice(0, 10) + 'T00:00:00');
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


  return (
    <div className="min-h-screen bg-charcoal font-sans">

      {/* ── Hero: the weight, the window, the trend ─────────────────────── */}
      <header className="px-4 pt-8 pb-2 bg-gradient-to-b from-surface to-charcoal">
        <div className="max-w-md mx-auto">
          <button type="button" onClick={() => { haptic(8); navigate('/'); }} style={{ minHeight: 36 }}
            className="inline-flex items-center gap-1 text-sm text-lo hover:text-white transition-colors -ml-1">
            <Icon name="chevron-left" size={16} /> Today
          </button>
          <div className="flex items-end justify-between gap-3 mt-2">
            <div className="min-w-0">
              <Eyebrow tone="gold">Progress</Eyebrow>
              <h1 className="font-display text-num font-medium text-white leading-tight mt-1 truncate">{user?.name ? `${user.name.split(' ')[0]}\u2019s` : 'Your'} journey</h1>
            </div>
            <Segmented size="sm" name="range" value={range} onChange={setRange} className="w-[168px] flex-shrink-0"
              options={[{ id: '7', label: '7d' }, { id: '30', label: '30d' }, { id: '90', label: '90d' }]} />
          </div>

          <div className="mt-5" data-testid="progress-hero">
            {latestW ? (
              <HeroNumber value={latestW} unit="kg" delta={rangeDelta} deltaUnit=" kg"
                label={rangeDelta == null ? 'latest weigh-in' : `over ${range} ${plural(parseInt(range, 10), 'day')}`} />
            ) : (
              <HeroNumber value="—" unit="kg" placeholder label="No weight logged yet" />
            )}
          </div>

          {/* Start → now → goal. Renders a hint when the coach has not set a goal —
              a new member should know a goal exists and who sets it. */}
          <div className="mt-4" data-testid="journey">
            {journeyPct === null ? (
              <p className="text-caption text-mid leading-relaxed">
                {!latestW
                  ? 'Log your weight and ask your coach to set your target — your journey line appears here.'
                  : 'Ask your coach to set your target weight and you\'ll see how far along you are.'}
              </p>
            ) : (
              <>
                <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold-light transition-all duration-700" style={{ width: `${journeyPct}%` }} />
                </div>
                <div className="flex justify-between text-caption mt-1.5">
                  <span className="text-lo">Start <span className="text-mid font-semibold tabular-nums">{startW} kg</span></span>
                  <span className="text-gold-light font-bold tabular-nums">{journeyPct}% there{lostKg > 0 ? ` · ${lostKg} kg lost` : ''}</span>
                  <span className="text-lo">Goal <span className="text-mid font-semibold tabular-nums">{targetW} kg</span></span>
                </div>
              </>
            )}
          </div>

          {/* The trend, full-bleed, gold. Needs two weigh-ins in the window. */}
          <div className="-mx-4 mt-3" data-testid="weight-chart">
            {weightData.length > 1 ? (
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={weightData} margin={{ top: 8, right: 16, left: 16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#D4AF37" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#D4AF37" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#7E8596' }} tickLine={false} axisLine={false}
                    interval={Math.max(0, Math.floor(weightData.length / 4))} />
                  <YAxis domain={['auto', 'auto']} hide />
                  <Tooltip content={<WeightTip />} cursor={{ stroke: 'rgba(212,175,55,0.35)' }} />
                  {targetW && (
                    <ReferenceLine y={targetW} stroke="#C5A059" strokeDasharray="4 4"
                      label={{ value: `Goal ${targetW}`, position: 'insideTopRight', fontSize: 9, fill: '#C5A059' }} />
                  )}
                  <Area type="monotone" dataKey="weight" stroke="#D4AF37" strokeWidth={2.5} fill="url(#goldFill)"
                    dot={weightData.length <= 14 ? { fill: '#D4AF37', r: 3, strokeWidth: 0 } : false} activeDot={{ r: 5, fill: '#F0E2B6' }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="px-4 py-4">
                <p className="text-caption text-lo">
                  {weightAll.length > 1 ? `No two weigh-ins in the last ${range} ${plural(parseInt(range, 10), 'day')} — try a wider window.`
                    : weightAll.length === 1 ? 'One more weigh-in and your trend line starts here.'
                    : 'Log your weight on two days to see your trend.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 pt-4 pb-20 space-y-3">

        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-2">
          <StatBox
            value={bmi || '—'}
            label="BMI"
            sub={bmi ? (bmi < 18.5 ? 'Under' : bmi < 25 ? 'Healthy range' : bmi < 30 ? 'Over' : 'Obese') : 'Add height in Profile'}
            tone={bmi && bmi >= 18.5 && bmi < 25 ? 'good' : null}
          />
          <StatBox
            value={`${streak} ${plural(streak, 'day')}`}
            label="Logging Streak"
            sub={streak >= 7 ? 'Best run this month' : streak >= 3 ? 'Keep going' : 'Start today'}
            tone={streak >= 3 ? 'good' : null}
          />
          <StatBox
            value={`${avg30}%`}
            label="30-day Compliance"
            sub={avg30 >= 75 ? 'Strong' : avg30 >= 50 ? 'Steady' : 'Room to improve'}
            tone={avg30 >= 75 ? 'good' : avg30 >= 50 ? null : 'warn'}
          />
          <StatBox
            value={daysLogged}
            label="Days Logged"
            sub="last 90 days"
          />
        </div>

        {/* Weekly report — the AI's Sunday narrative. Renders nothing until one exists. */}
        <WeeklyReportCard />

        {/* 30 days as a calendar. Each cell is a day, tinted by compliance;
            tap one to open that day's full log (the same PastLogModal the
            history list uses). Replaces the bar chart: a grid says which
            weekdays slip, a bar chart only says that something did. */}
        <Card>
          <div className="flex items-baseline justify-between mb-3">
            <Eyebrow>Last 30 days</Eyebrow>
            <span className="text-caption text-mid"><span className="font-bold text-white tabular-nums">{avg30}%</span> average</span>
          </div>
          {(() => {
            const byDate = new Map(sorted.map(l => [l.log_date, l]));
            const cells = [];
            const start = new Date(today() + 'T12:00:00'); start.setDate(start.getDate() - 29);
            // pad to the week start so columns are weekdays (Mon first)
            const pad = (start.getDay() + 6) % 7;
            for (let i = 0; i < pad; i++) cells.push(null);
            for (let i = 0; i < 30; i++) {
              const d = new Date(start); d.setDate(start.getDate() + i);
              const key = istDate(d);
              cells.push({ key, log: byDate.get(key) || null, day: d.getDate() });
            }
            const tone = (pct) => pct == null ? 'bg-white/[0.04] text-ghost'
              : pct >= 75 ? 'bg-gold/[0.55] text-charcoal' : pct >= 50 ? 'bg-gold/[0.28] text-white' : pct > 0 ? 'bg-gold/[0.12] text-mid' : 'bg-white/[0.06] text-lo';
            return (
              <div data-testid="heat-grid">
                <div className="grid grid-cols-7 gap-1.5 text-center text-tiny text-lo mb-1.5">
                  {['M','T','W','T','F','S','S'].map((w, i) => <span key={i}>{w}</span>)}
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {cells.map((c, i) => c === null
                    ? <span key={'p' + i} />
                    : (
                      <button key={c.key} type="button" data-testid="heat-cell" data-date={c.key}
                        onClick={() => { if (c.log) { haptic(8); setSelectedLog(c.log); } }}
                        aria-label={`${c.key}: ${c.log ? (c.log.compliance_pct ?? 0) + '%' : 'not logged'}`}
                        className={`aspect-square rounded-lg text-caption font-semibold tabular-nums flex items-center justify-center transition-transform active:scale-95 ${tone(c.log ? (c.log.compliance_pct ?? 0) : null)}`}>
                        {c.day}
                      </button>
                    ))}
                </div>
                <div className="flex items-center justify-between text-tiny text-lo mt-2">
                  <span>Not logged</span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-white/[0.06]" /><span className="w-3 h-3 rounded bg-gold/[0.12]" /><span className="w-3 h-3 rounded bg-gold/[0.28]" /><span className="w-3 h-3 rounded bg-gold/[0.55]" />
                  </span>
                  <span>75%+</span>
                </div>
              </div>
            );
          })()}
        </Card>

        {/* Sprint 12: 7-day nutrition trend */}
        {nutritionTrend.length <= 1 && (
          <ChartEmpty icon="🥗" title="7-Day Nutrition Trend"
            need="Log food on two days to see how your macros move." />
        )}
        {nutritionTrend.length > 1 && (
          <Card>
            <SectionTitle icon="🥗">7-Day Nutrition Trend</SectionTitle>
            <div className="flex gap-3 text-xs mb-3 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-orange-400 inline-block"/>Calories</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block"/>Protein</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block"/>Carbs</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block"/>Fat</span>
            </div>
            {/* Calories bar */}
            <p className="text-xs text-lo font-medium mb-1">Calories (kcal)</p>
            <ResponsiveContainer width="100%" height={90}>
              <BarChart data={nutritionTrend} margin={{ top: 2, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#7E8596' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 8, fill: '#7E8596' }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => [`${v} kcal`, 'Calories']}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e7e5e4' }} />
                {profile?.macros?.kcal && (
                  <ReferenceLine y={profile.macros.kcal} stroke="#e0c98a" strokeDasharray="3 3" />
                )}
                <Bar dataKey="kcal" fill="#B08A4A" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* Macros line chart */}
            <p className="text-xs text-lo font-medium mt-3 mb-1">Protein · Carbs · Fat (g)</p>
            <ResponsiveContainer width="100%" height={110}>
              <ComposedChart data={nutritionTrend} margin={{ top: 2, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#7E8596' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 8, fill: '#7E8596' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e7e5e4' }}
                  formatter={(v, name) => [`${v}g`, name.charAt(0).toUpperCase() + name.slice(1)]} />
                <Line type="monotone" dataKey="pro"  stroke="#8FA8C8" strokeWidth={2} dot={{ r: 3, fill: '#8FA8C8' }} />
                <Line type="monotone" dataKey="carb" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3, fill: '#fbbf24' }} />
                <Line type="monotone" dataKey="fat"  stroke="#d9b451" strokeWidth={2} dot={{ r: 3, fill: '#d9b451' }} />
              </ComposedChart>
            </ResponsiveContainer>

            {nutritionTrend.length > 0 && (() => {
              const avg = nutritionTrend.reduce((a, d) => ({
                kcal: a.kcal + d.kcal, pro: a.pro + d.pro,
                carb: a.carb + d.carb, fat: a.fat + d.fat,
              }), { kcal: 0, pro: 0, carb: 0, fat: 0 });
              const n = nutritionTrend.length;
              return (
                <div className="flex gap-3 text-xs mt-2 px-1 pt-2 border-t border-hair flex-wrap">
                  <span className="text-lo">Avg/day:</span>
                  <span className="font-bold text-orange-300">{Math.round(avg.kcal/n)} kcal</span>
                  <span className="text-blue-300">P {(avg.pro/n).toFixed(1)}g</span>
                  <span className="text-amber-400">C {(avg.carb/n).toFixed(1)}g</span>
                  <span className="text-amber-400">F {(avg.fat/n).toFixed(1)}g</span>
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
                <div key={i} className="flex items-center justify-between py-2 border-b border-hair last:border-0">
                  <div>
                    <span className="text-sm font-medium text-white">{l.test_name}</span>
                    {l.unit && <span className="text-xs text-lo ml-1">{l.unit}</span>}
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-blue-400">{l.value}</span>
                    <div className="text-xs text-lo">{new Date(String(l.test_date).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN')}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-lo mt-2 italic">Ask your coach to add new lab results.</p>
          </Card>
        )}

        {/* Sprint 11: Log history — last 30 logs */}
        {sorted.length > 0 && (
          <Card>
            <SectionTitle icon="📅">Log History</SectionTitle>
            <p className="text-xs text-lo mb-3">Tap any day to see the full log</p>
            <div className="space-y-1.5">
              {[...sorted].reverse().slice(0, 30).map(log => {
                const d = new Date(String(log.log_date).slice(0, 10) + 'T00:00:00');
                const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' });
                const pct = log.compliance_pct;
                return (
                  <button key={log.log_date} onClick={() => setSelectedLog(log)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl
                      bg-surface hover:bg-white/[0.05] transition-colors text-left group">
                    <div className="w-14 flex-shrink-0">
                      <p className="text-xs font-bold text-white">{label.split(', ')[1] || label}</p>
                      <p className="text-xs text-lo">{label.split(', ')[0]}</p>
                    </div>
                    <div className="flex-1 h-1.5 bg-white/[0.08] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${
                        pct >= 75 ? 'bg-gold-deep' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
                      }`} style={{ width: `${pct || 0}%` }} />
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {log.weight_kg && (
                        <span className="text-xs font-semibold text-faint">{log.weight_kg}kg</span>
                      )}
                      <span className={`text-xs font-bold w-10 text-right ${
                        pct >= 75 ? 'text-gold-deep' : pct >= 50 ? 'text-amber-400' : 'text-red-400'
                      }`}>{pct != null ? `${pct}%` : '—'}</span>
                      <svg className="w-3.5 h-3.5 text-ghost group-hover:text-mid transition-colors"
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
          <div className="space-y-2 text-sm text-mid">
            {streak >= 7 && (
              <div className="flex items-center gap-2 bg-orange-400/[0.08] px-3 py-2 rounded-xl">
                <span className="text-lg">🔥</span>
                <span><strong>{streak}-day streak!</strong> You're building an unstoppable habit.</span>
              </div>
            )}
            {lostKg !== null && lostKg >= 1 && (
              <div className="flex items-center gap-2 bg-gold/[0.07] px-3 py-2 rounded-xl">
                <span className="text-lg">🏆</span>
                <span><strong>{lostKg} kg lost</strong> since you started. Keep going!</span>
              </div>
            )}
            {avg30 >= 80 && (
              <div className="flex items-center gap-2 bg-blue-400/[0.08] px-3 py-2 rounded-xl">
                <span className="text-lg">⭐</span>
                <span><strong>{avg30}% compliance</strong> over 30 days — outstanding consistency.</span>
              </div>
            )}
            {journeyPct !== null && journeyPct >= 25 && (
              <div className="flex items-center gap-2 bg-amber-400/[0.08] px-3 py-2 rounded-xl">
                <span className="text-lg">🎯</span>
                <span><strong>{journeyPct}%</strong> of the way to your {targetW} kg goal!</span>
              </div>
            )}
            {streak < 3 && avg30 < 50 && (
              <div className="flex items-center gap-2 bg-amber-400/[0.08] px-3 py-2 rounded-xl">
                <span className="text-lg">💪</span>
                <span>Every day counts. Log today and start your streak!</span>
              </div>
            )}
          </div>
        </Card>

        {/* Training trends — volume lifted, cardio and calories over time.
            Progress previously showed only weight and compliance. */}
        <Card>
          <SectionTitle icon="🔥">Training Trends</SectionTitle>
          <div className="mt-2">
            <TrainingSummary
              bodyWeightKg={latestW || parseFloat(profile?.start_weight) || 0}
            />
          </div>
        </Card>

        <StrengthProgress />

        <MuscleCoverage />

      </div>

      {selectedLog && <PastLogModal log={selectedLog} onClose={() => setSelectedLog(null)} />}
      <MemberBottomNav />
    </div>
  );
}
