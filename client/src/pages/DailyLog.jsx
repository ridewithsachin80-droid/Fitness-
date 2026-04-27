import { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogStore }  from '../store/logStore';
import { useAuthStore } from '../store/authStore';
import {
  today, formatDate,
  ACTIVITIES, ACV_ITEMS, SUPPLEMENTS,
  calcCompliance, getNutrition,
} from '../constants';
import { Card, SectionTitle, CheckRow, OfflineBanner } from '../components/UI';
import WaterTracker  from '../components/WaterTracker';
import FoodLog       from '../components/FoodLog';
import SleepTracker  from '../components/SleepTracker';
import InstallPrompt from '../components/InstallPrompt';
import { usePush }        from '../hooks/usePush';
import { useOfflineSync } from '../hooks/useOfflineQueue';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeToMin(t) {
  if (!t) return 0;
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Sum all macro values from the food log, using per_100g data (Sprint 1+) */
function calcFoodMacros(foodItems = []) {
  return foodItems.reduce((acc, item) => {
    if (item.per_100g) {
      const f = item.grams / 100;
      const n = item.per_100g;
      return {
        kcal: acc.kcal + Math.round((n.calories || 0) * f),
        pro:  acc.pro  + (n.protein    || 0) * f,
        carb: acc.carb + ((n.net_carbs != null ? n.net_carbs : n.total_carbs) || 0) * f,
        fat:  acc.fat  + (n.fat        || 0) * f,
      };
    }
    // Legacy fallback for items logged before Sprint 1
    const n = getNutrition(item.name, item.grams);
    if (!n) return acc;
    return { kcal: acc.kcal + n.cal, pro: acc.pro + n.pro, carb: acc.carb + n.carb, fat: acc.fat + n.fat };
  }, { kcal: 0, pro: 0, carb: 0, fat: 0 });
}

// ─── Compliance Ring ──────────────────────────────────────────────────────────

function ComplianceRing({ pct }) {
  const r = 24, circ = 2 * Math.PI * r;
  return (
    <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="5" />
      <circle cx="28" cy="28" r={r} fill="none" stroke="#6ee7b7" strokeWidth="5"
        strokeDasharray={`${(pct / 100) * circ} ${circ}`} strokeLinecap="round"
        className="transition-all duration-700" />
      <text x="28" y="28" dominantBaseline="middle" textAnchor="middle"
        fontSize="11" fontWeight="600" fill="white" transform="rotate(90 28 28)">
        {pct}%
      </text>
    </svg>
  );
}

// ─── Sprint 2: Fasting Bar ─────────────────────────────────────────────────────
// Shows a 24-hour timeline with fasting (blue) and eating (green) windows.
// Red NOW marker moves in real time. Only renders if protocol.fasting is set.

function FastingBar({ fasting }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const TOTAL      = 1440;
  const nowMin     = now.getHours() * 60 + now.getMinutes();
  const fastStart  = timeToMin(fasting.start);   // e.g. 18:00 → 1080
  const fastEnd    = timeToMin(fasting.end);     // e.g. 10:00 → 600
  const crossesMid = fastStart > fastEnd;        // Padmini's 18:00–10:00 crosses midnight

  // Build visual segments
  let segments = [];
  if (crossesMid) {
    if (fastEnd > 0)       segments.push({ w: (fastEnd / TOTAL) * 100,               type: 'fast' });
    segments.push({          w: ((fastStart - fastEnd) / TOTAL) * 100,               type: 'eat' });
    if (fastStart < TOTAL) segments.push({ w: ((TOTAL - fastStart) / TOTAL) * 100,  type: 'fast' });
  } else {
    if (fastStart > 0)     segments.push({ w: (fastStart / TOTAL) * 100,             type: 'eat' });
    segments.push({          w: ((fastEnd - fastStart) / TOTAL) * 100,               type: 'fast' });
    if (fastEnd < TOTAL)   segments.push({ w: ((TOTAL - fastEnd) / TOTAL) * 100,    type: 'eat' });
  }

  // Is NOW in the eating window?
  const isEating = crossesMid
    ? (nowMin >= fastEnd && nowMin < fastStart)
    : (nowMin < fastStart || nowMin >= fastEnd);

  // Minutes until next phase change
  let minsLeft;
  if (isEating) {
    minsLeft = fastStart > nowMin ? fastStart - nowMin : fastStart + TOTAL - nowMin;
  } else {
    minsLeft = fastEnd > nowMin ? fastEnd - nowMin : fastEnd + TOTAL - nowMin;
  }
  const hLeft = Math.floor(minsLeft / 60);
  const mLeft = minsLeft % 60;

  const eatHrs  = crossesMid ? (fastStart - fastEnd) / 60 : (fastEnd - fastStart) / 60;
  const fastHrs = 24 - eatHrs;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle icon="⏰">{fasting.label || 'Fasting Protocol'}</SectionTitle>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
          isEating ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
          {isEating ? '🟢 Eating' : '🔵 Fasting'}
        </span>
      </div>

      {/* Status line */}
      <p className="text-xs text-stone-500 mb-3">
        {isEating
          ? `Eating window — ${hLeft}h ${mLeft}m until fast begins`
          : `Fasting — ${hLeft}h ${mLeft}m until eating window opens`}
      </p>

      {/* 24-hour bar */}
      <div className="relative h-6 rounded-full overflow-hidden flex">
        {segments.map((seg, i) => (
          <div key={i} style={{ width: `${seg.w}%` }}
            className={seg.type === 'eat' ? 'bg-emerald-400' : 'bg-blue-300'} />
        ))}
        {/* NOW marker */}
        <div className="absolute top-0 bottom-0 flex flex-col items-center"
          style={{ left: `${(nowMin / TOTAL) * 100}%`, transform: 'translateX(-50%)' }}>
          <div className="w-0.5 h-full bg-red-500" />
          <div className="absolute -top-0.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-white shadow" />
        </div>
      </div>

      {/* Hour labels */}
      <div className="flex justify-between mt-1 text-xs text-stone-400 select-none">
        <span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>12AM</span>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
          <span className="text-stone-500">Eating {eatHrs.toFixed(0)}h ({fasting.end?.slice(0,5)}–{fasting.start?.slice(0,5)})</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-300 flex-shrink-0" />
          <span className="text-stone-500">Fasting {fastHrs.toFixed(0)}h</span>
        </span>
      </div>

      {fasting.note && (
        <p className="mt-3 text-xs text-stone-500 bg-stone-50 px-3 py-2 rounded-xl leading-relaxed">
          📌 {fasting.note}
        </p>
      )}
    </Card>
  );
}

// ─── Sprint 2: Macro Progress ──────────────────────────────────────────────────
// 4 progress bars (kcal, protein, carbs, fat) that fill as food is logged.
// Only renders if protocol.macros is set by admin.

function MacroProgress({ macros, foodItems }) {
  const totals = calcFoodMacros(foodItems);

  const bars = [
    { key: 'kcal', label: 'Calories', icon: '🔥', unit: 'kcal',
      current: Math.round(totals.kcal), target: macros.kcal,
      bg: 'bg-orange-400', light: 'bg-orange-50', text: 'text-orange-600' },
    { key: 'pro',  label: 'Protein',  icon: '💪', unit: 'g',
      current: +totals.pro.toFixed(1),  target: macros.pro,
      bg: 'bg-blue-500',   light: 'bg-blue-50',   text: 'text-blue-600' },
    { key: 'carb', label: 'Net Carbs', icon: '🌾', unit: 'g',
      current: +totals.carb.toFixed(1), target: macros.carb,
      bg: 'bg-amber-400',  light: 'bg-amber-50',  text: 'text-amber-600' },
    { key: 'fat',  label: 'Fat',      icon: '🥑', unit: 'g',
      current: +totals.fat.toFixed(1),  target: macros.fat,
      bg: 'bg-purple-500', light: 'bg-purple-50', text: 'text-purple-600' },
  ];

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle icon="🎯">Macro Targets</SectionTitle>
        {macros.phase && (
          <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
            {macros.phase}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {bars.map(({ key, label, icon, unit, current, target, bg, light, text }) => {
          const pct  = target ? Math.min(100, (current / target) * 100) : 0;
          const over = target && current > target;
          const remaining = target ? Math.max(0, target - current) : null;

          return (
            <div key={key}>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-semibold text-stone-600">{icon} {label}</span>
                <div className="flex items-center gap-1.5">
                  {over && <span className="text-red-500 font-bold">⚠️ over</span>}
                  <span className={`font-bold ${over ? 'text-red-500' : text}`}>
                    {current}
                  </span>
                  <span className="text-stone-400">/ {target} {unit}</span>
                  {remaining !== null && !over && remaining > 0 && (
                    <span className="text-stone-300 text-xs">({remaining} left)</span>
                  )}
                </div>
              </div>
              <div className={`h-2.5 rounded-full overflow-hidden ${light}`}>
                <div
                  className={`h-full rounded-full transition-all duration-500 ${bg} ${over ? 'opacity-50' : ''}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Total eaten */}
      {totals.kcal > 0 && (
        <div className="mt-3 pt-3 border-t border-stone-100 flex justify-between text-xs text-stone-400">
          <span>Total logged today</span>
          <span className="font-semibold text-stone-600">
            {Math.round(totals.kcal)} kcal · P {totals.pro.toFixed(0)}g · C {totals.carb.toFixed(0)}g · F {totals.fat.toFixed(0)}g
          </span>
        </div>
      )}
    </Card>
  );
}

// ─── Sprint 3: Prescribed Meal Plan Cards ────────────────────────────────────
// Collapsible cards above the food log. Each card shows the prescribed meal,
// its items, and a "Log this meal" button that pre-fills the food log.

function PrescribedMeals({ mealPlan, foodItems, onLogMeal }) {
  const [expanded, setExpanded] = useState(null);
  if (!mealPlan || mealPlan.length === 0) return null;

  const now      = new Date();
  const nowMin   = now.getHours() * 60 + now.getMinutes();
  const toMin    = (t) => { if (!t) return null; const [h,m] = t.split(':').map(Number); return h*60+(m||0); };

  // Check if a meal's food items are already logged (>= 80% by name match)
  const isMealLogged = (meal) => {
    if (!meal.items?.length) return false;
    const logged = (foodItems || []).map(f => f.name?.toLowerCase());
    const matched = (meal.items || []).filter(i => logged.includes(i.food_name?.toLowerCase())).length;
    return matched / meal.items.length >= 0.8;
  };

  return (
    <Card>
      <SectionTitle icon="🍽">Prescribed Meal Plan</SectionTitle>
      <p className="text-xs text-stone-400 mb-3">Your personalised plan for today. Tap a meal to log it quickly.</p>
      <div className="space-y-2">
        {mealPlan.map((meal) => {
          const mealMin  = toMin(meal.time);
          const logged   = isMealLogged(meal);
          const isCurrent = mealMin !== null && nowMin >= mealMin - 30 && nowMin <= mealMin + 120;
          const isOpen   = expanded === meal.id;

          const mealKcal = (meal.items || []).reduce((s, i) => s + (i.kcal || 0), 0);

          // Status badge
          const badge = logged
            ? { label: '✓ Logged', cls: 'bg-emerald-100 text-emerald-700' }
            : isCurrent
              ? { label: '⏰ Now', cls: 'bg-amber-100 text-amber-700' }
              : { label: meal.time || '', cls: 'bg-stone-100 text-stone-500' };

          return (
            <div key={meal.id} className={`rounded-2xl border overflow-hidden transition-all ${
              logged ? 'border-emerald-200 bg-emerald-50/50' :
              isCurrent ? 'border-amber-200 bg-amber-50/50' : 'border-stone-100 bg-stone-50'
            }`}>
              {/* Card header — always visible */}
              <button className="w-full text-left px-4 py-3 flex items-center gap-3"
                onClick={() => setExpanded(isOpen ? null : meal.id)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-stone-700">{meal.name}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <p className="text-xs text-stone-400 mt-0.5">
                    {(meal.items || []).length} items · <span className="font-bold text-orange-500">{mealKcal} kcal</span>
                  </p>
                </div>
                <span className="text-stone-400 text-sm">{isOpen ? '▲' : '▼'}</span>
              </button>

              {/* Expanded content */}
              {isOpen && (
                <div className="px-4 pb-4 space-y-2 border-t border-stone-100">
                  {(meal.items || []).map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5">
                      <div>
                        <span className="text-sm text-stone-700 font-medium">{item.food_name}</span>
                        <span className="text-xs text-stone-400 ml-2">{item.qty_g}g</span>
                      </div>
                      <div className="flex gap-2 text-xs flex-shrink-0">
                        <span className="font-bold text-orange-500">{item.kcal} kcal</span>
                        <span className="text-blue-500">P {item.pro}g</span>
                        <span className="text-amber-500">C {item.carb}g</span>
                        <span className="text-purple-500">F {item.fat}g</span>
                      </div>
                    </div>
                  ))}

                  {!logged && (
                    <button
                      onClick={() => { onLogMeal(meal); setExpanded(null); }}
                      className="w-full mt-2 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white
                        text-sm font-bold rounded-xl transition-all active:scale-95">
                      📋 Log this meal
                    </button>
                  )}
                  {logged && (
                    <p className="text-center text-xs text-emerald-600 font-semibold pt-1">✓ Already logged</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Main DailyLog Page ────────────────────────────────────────────────────────

export default function DailyLog() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { date, log, protocol, loading, saving, saved, error, setDate, updateLog, saveLog } = useLogStore();

  // Merge default + custom items, then filter by protocol
  const overrides    = protocol?.item_overrides || {};
  const applyOverride = (item) => {
    const ov = overrides[item.id];
    if (!ov) return item;
    const timing = [ov.fromTime, ov.toTime].filter(Boolean).join('–');
    const sub    = [ov.totalTime, timing].filter(Boolean).join(' · ') || ov.sub || item.sub || '';
    return { ...item, label: ov.label || item.label, sub };
  };

  const allActivities  = [...ACTIVITIES,  ...(protocol?.custom_activities  || [])].map(applyOverride);
  const allACV         = [...ACV_ITEMS,   ...(protocol?.custom_acv         || [])].map(applyOverride);
  const allSupplements = [...SUPPLEMENTS, ...(protocol?.custom_supplements || [])].map(applyOverride);

  const activeActivities  = allActivities.filter(a =>
    !protocol?.activities  || protocol.activities.includes(a.id));
  const activeACV         = allACV.filter(a =>
    !protocol?.acv         || protocol.acv.includes(a.id));
  const activeSupplements = allSupplements.filter(s =>
    !protocol?.supplements || protocol.supplements.includes(s.id));

  usePush();
  useOfflineSync();

  useEffect(() => { setDate(today()); }, []);

  const compliance = calcCompliance(log, activeActivities, activeACV, activeSupplements);
  const actDone    = activeActivities.filter(a => log.activities?.[a.id]).length;
  const acvDone    = activeACV.filter(a => log.acv?.[a.id]).length;
  const suppDone   = activeSupplements.filter(s => log.supplements?.[s.id]).length;
  const update     = useCallback(updateLog, [updateLog]);

  // ── Sprint 3: pre-fill food log from prescribed meal ─────────────────────
  // MUST be after `update` — dep array [log.food, update] is evaluated
  // immediately by useCallback, so `update` must already be declared (const TDZ).
  const logMeal = useCallback((meal) => {
    const newItems = (meal.items || []).map(item => ({
      id:       Date.now() + Math.random(),
      name:     item.food_name,
      grams:    item.qty_g,
      meal:     meal.name,
      food_id:  item.food_id  || null,
      per_100g: item.per_100g || null,
    }));
    const existing     = log.food || [];
    const existingNames = existing.map(f => f.name?.toLowerCase());
    const toAdd        = newItems.filter(i => !existingNames.includes(i.name?.toLowerCase()));
    update('food', [...existing, ...toAdd]);
  }, [log.food, update]);

  return (
    <div className="min-h-screen bg-stone-100 font-sans">
      <OfflineBanner />

      {/* Header */}
      <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 text-white px-4 pt-10 pb-6">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-emerald-300 mb-0.5">FitLife</p>
              <h1 className="text-xl font-bold">{user?.name}</h1>
              <p className="text-emerald-300 text-xs mt-0.5">Building healthy habits daily 🌱</p>
            </div>
            <button onClick={() => navigate('/settings')}
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
          <div className="bg-white/10 rounded-2xl p-3 flex items-center gap-4">
            <ComplianceRing pct={compliance} />
            <div className="flex-1">
              <div className="text-sm font-semibold">Today's Compliance</div>
              <div className="text-xs text-emerald-200 mt-0.5">
                {actDone}/{activeActivities.length} activities · {acvDone}/{activeACV.length} ACV · {suppDone}/{activeSupplements.length} supps
              </div>
              {log.weight && <div className="text-xs text-emerald-300 mt-1 font-medium">⚖ {log.weight} kg logged</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-md mx-auto px-4 space-y-3 pb-32 pt-4">

        {/* Date picker */}
        <Card>
          <div className="flex items-center gap-3">
            <span>📅</span>
            <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)}
              className="flex-1 text-sm font-semibold text-stone-700 border border-stone-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
            <button onClick={() => setDate(today())}
              className="text-xs text-emerald-600 font-bold px-3 py-2 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition-colors whitespace-nowrap">
              Today
            </button>
          </div>
          {date !== today() && (
            <p className="text-xs text-amber-600 mt-2 ml-7 font-medium">Editing: {formatDate(date)}</p>
          )}
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* ── Sprint 2: Fasting bar (only if admin set a fasting window) ── */}
            {protocol?.fasting && <FastingBar fasting={protocol.fasting} />}

            {/* ── Sprint 2: Macro progress (only if admin set macro targets) ── */}
            {protocol?.macros && (
              <MacroProgress macros={protocol.macros} foodItems={log.food || []} />
            )}

            {/* Morning Weight */}
            <Card>
              <SectionTitle icon="⚖️">Morning Weight</SectionTitle>
              <p className="text-xs text-stone-400 mb-3">After washroom, before food — first thing in the morning</p>
              <div className="flex items-center gap-3">
                <input type="number" step="0.1" inputMode="decimal" value={log.weight} placeholder="e.g. 92.5"
                  onChange={e => update('weight', e.target.value)}
                  className="flex-1 text-2xl font-bold text-center border-2 border-stone-200 rounded-2xl py-3 focus:outline-none focus:ring-2 focus:ring-emerald-300 text-stone-800" />
                <span className="text-stone-400 font-bold">kg</span>
              </div>
              {log.weight && (
                <div className="mt-3 text-center text-xs font-semibold py-2 rounded-xl bg-emerald-50 text-emerald-700">
                  ✓ Weight logged — great job tracking!
                </div>
              )}
            </Card>

            {/* Activities */}
            <Card>
              <SectionTitle icon="🏃">Physical Activity</SectionTitle>
              <div className="space-y-2">
                {activeActivities.map(a => (
                  <CheckRow key={a.id} label={a.label} sub={a.sub} icon={a.icon}
                    checked={!!log.activities?.[a.id]}
                    onChange={v => update('activities', { ...log.activities, [a.id]: v })} />
                ))}
              </div>
            </Card>

            {/* ACV */}
            <Card>
              <SectionTitle icon="🍶">Apple Cider Vinegar</SectionTitle>
              <p className="text-xs text-stone-400 mb-3">1 tbsp in 200ml warm water · through a straw · 15 min before meal</p>
              <div className="space-y-2">
                {activeACV.map(a => (
                  <CheckRow key={a.id} label={a.label} sub={a.sub}
                    checked={!!log.acv?.[a.id]}
                    onChange={v => update('acv', { ...log.acv, [a.id]: v })} />
                ))}
              </div>
            </Card>

            {/* ── Sprint 3: Prescribed meal plan cards ── */}
            {protocol?.meal_plan?.length > 0 && (
              <PrescribedMeals
                mealPlan={protocol.meal_plan}
                foodItems={log.food}
                onLogMeal={logMeal}
              />
            )}

            {/* Food */}
            <Card>
              <SectionTitle icon="🥗">Food Log</SectionTitle>
              <p className="text-xs text-stone-400 mb-3">Enter raw weight before cooking</p>
              <FoodLog items={log.food} onChange={v => update('food', v)} />
            </Card>

            {/* Water */}
            <Card>
              <SectionTitle icon="💧">Water Intake</SectionTitle>
              <p className="text-xs text-stone-400 mb-3">Target 3L · Stop 1 hr before sleep · Not during meals</p>
              <WaterTracker value={log.water} onChange={v => update('water', v)} />
            </Card>

            {/* Supplements */}
            <Card>
              <SectionTitle icon="💊">Supplements</SectionTitle>
              <div className="space-y-2">
                {activeSupplements.map(s => (
                  <CheckRow key={s.id} label={s.label} sub={s.sub}
                    checked={!!log.supplements?.[s.id]}
                    onChange={v => update('supplements', { ...log.supplements, [s.id]: v })} />
                ))}
              </div>
            </Card>

            {/* Sleep */}
            <Card>
              <SectionTitle icon="🌙">Sleep</SectionTitle>
              <p className="text-xs text-stone-400 mb-3">Target 10:00 PM → 6:30 AM (8 hrs)</p>
              <SleepTracker value={log.sleep} onChange={v => update('sleep', v)} />
            </Card>

            {/* Notes */}
            <Card>
              <SectionTitle icon="📝">Notes</SectionTitle>
              <textarea value={log.notes} onChange={e => update('notes', e.target.value)}
                placeholder="Symptoms, how you felt, energy levels, challenges…" rows={3}
                className="w-full text-sm text-stone-700 border border-stone-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none placeholder-stone-300" />
            </Card>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
            )}
          </>
        )}
      </div>

      {/* Sticky save */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-stone-100 via-stone-100/90 to-transparent">
        <div className="max-w-md mx-auto">
          <button onClick={saveLog} disabled={saving || loading}
            className={`w-full py-4 rounded-2xl text-white font-bold text-base shadow-float transition-all duration-200 ${
              saved ? 'bg-emerald-400' : saving ? 'bg-emerald-500 opacity-80' : 'bg-emerald-600 hover:bg-emerald-700 active:scale-98'
            }`}>
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving…
              </span>
            ) : saved ? '✓ Saved!' : "Save Today's Log"}
          </button>
        </div>
      </div>

      <InstallPrompt />
    </div>
  );
}
