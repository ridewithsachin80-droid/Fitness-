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
    const n = getNutrition(item.name, item.grams);
    if (!n) return acc;
    return { kcal: acc.kcal + n.cal, pro: acc.pro + n.pro, carb: acc.carb + n.carb, fat: acc.fat + n.fat };
  }, { kcal: 0, pro: 0, carb: 0, fat: 0 });
}

// Aggregate key micronutrients from food items that have per_100g data
function calcMicros(foodItems = []) {
  return foodItems.reduce((acc, item) => {
    if (!item.per_100g) return acc;
    const f = item.grams / 100;
    const n = item.per_100g;
    return {
      fiber:    acc.fiber    + (n.fiber    || 0) * f,
      omega3:   acc.omega3   + ((n.omega3_epa || 0) + (n.omega3_dha || 0) + (n.omega3_ala || 0)) * f,
      vit_b12:  acc.vit_b12  + (n.vit_b12  || 0) * f,
      vit_d:    acc.vit_d    + (n.vit_d    || 0) * f,
      vit_c:    acc.vit_c    + (n.vit_c    || 0) * f,
      calcium:  acc.calcium  + (n.calcium  || 0) * f,
      iron:     acc.iron     + (n.iron     || 0) * f,
      magnesium:acc.magnesium+ (n.magnesium|| 0) * f,
      zinc:     acc.zinc     + (n.zinc     || 0) * f,
      folate:   acc.folate   + (n.folate   || 0) * f,
      potassium:acc.potassium+ (n.potassium|| 0) * f,
    };
  }, { fiber:0, omega3:0, vit_b12:0, vit_d:0, vit_c:0, calcium:0, iron:0, magnesium:0, zinc:0, folate:0, potassium:0 });
}

// Standard RDA targets (female, ~60yr) — Sprint 5 will add per-member overrides
const RDA = {
  fiber:    { target: 25,    unit: 'g',   label: 'Fiber',      icon: '🌿' },
  omega3:   { target: 1000,  unit: 'mg',  label: 'Omega-3',    icon: '🐟' },
  vit_b12:  { target: 2.4,   unit: 'mcg', label: 'Vitamin B12',icon: '💉' },
  vit_d:    { target: 600,   unit: 'IU',  label: 'Vitamin D',  icon: '☀️' },
  vit_c:    { target: 65,    unit: 'mg',  label: 'Vitamin C',  icon: '🍊' },
  calcium:  { target: 1200,  unit: 'mg',  label: 'Calcium',    icon: '🦴' },
  iron:     { target: 8,     unit: 'mg',  label: 'Iron',       icon: '⚙️' },
  magnesium:{ target: 320,   unit: 'mg',  label: 'Magnesium',  icon: '⚡' },
  zinc:     { target: 8,     unit: 'mg',  label: 'Zinc',       icon: '🔩' },
  folate:   { target: 400,   unit: 'mcg', label: 'Folate',     icon: '🧬' },
  potassium:{ target: 2600,  unit: 'mg',  label: 'Potassium',  icon: '🍌' },
};

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
  const totals  = calcFoodMacros(foodItems);
  const micros  = calcMicros(foodItems);
  const [showMicros, setShowMicros] = useState(false);

  const hasMicroData = foodItems.some(f => f.per_100g);

  const bars = [
    { key: 'kcal', label: 'Calories',  icon: '🔥', unit: 'kcal',
      current: Math.round(totals.kcal), target: macros.kcal,
      bg: 'bg-orange-400', light: 'bg-orange-50', text: 'text-orange-600' },
    { key: 'pro',  label: 'Protein',   icon: '💪', unit: 'g',
      current: +totals.pro.toFixed(1),  target: macros.pro,
      bg: 'bg-blue-500',   light: 'bg-blue-50',   text: 'text-blue-600' },
    { key: 'carb', label: 'Net Carbs', icon: '🌾', unit: 'g',
      current: +totals.carb.toFixed(1), target: macros.carb,
      bg: 'bg-amber-400',  light: 'bg-amber-50',  text: 'text-amber-600' },
    { key: 'fat',  label: 'Fat',       icon: '🥑', unit: 'g',
      current: +totals.fat.toFixed(1),  target: macros.fat,
      bg: 'bg-purple-500', light: 'bg-purple-50', text: 'text-purple-600' },
  ];

  const microRows = Object.entries(RDA).map(([key, rda]) => {
    const raw  = micros[key] || 0;
    const val  = key === 'vit_b12' || key === 'folate' ? +raw.toFixed(1) : Math.round(raw);
    const pct  = Math.min(100, (raw / rda.target) * 100);
    const color = pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
    const textColor = pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500';
    return { key, ...rda, val, pct, color, textColor };
  });

  // Count how many micros are meeting targets (>=80%)
  const microsMet = microRows.filter(m => m.pct >= 80).length;

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

      {/* Macro bars */}
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
                  <span className={`font-bold ${over ? 'text-red-500' : text}`}>{current}</span>
                  <span className="text-stone-400">/ {target} {unit}</span>
                  {remaining !== null && !over && remaining > 0 && (
                    <span className="text-stone-300">({remaining} left)</span>
                  )}
                </div>
              </div>
              <div className={`h-2.5 rounded-full overflow-hidden ${light}`}>
                <div className={`h-full rounded-full transition-all duration-500 ${bg} ${over ? 'opacity-50' : ''}`}
                  style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Total row */}
      {totals.kcal > 0 && (
        <div className="mt-3 pt-3 border-t border-stone-100 flex justify-between text-xs text-stone-400">
          <span>Total logged today</span>
          <span className="font-semibold text-stone-600">
            {Math.round(totals.kcal)} kcal · P {totals.pro.toFixed(0)}g · C {totals.carb.toFixed(0)}g · F {totals.fat.toFixed(0)}g
          </span>
        </div>
      )}

      {/* ── Micronutrient toggle ── */}
      {hasMicroData && (
        <div className="mt-3 pt-3 border-t border-stone-100">
          <button onClick={() => setShowMicros(v => !v)}
            className="w-full flex items-center justify-between text-xs font-semibold text-stone-500 hover:text-emerald-700 transition-colors">
            <span>
              🔬 Key Nutrients
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold ${
                microsMet >= 8 ? 'bg-emerald-100 text-emerald-700' :
                microsMet >= 5 ? 'bg-amber-100 text-amber-700' : 'bg-red-50 text-red-600'
              }`}>
                {microsMet}/{microRows.length} met
              </span>
            </span>
            <span>{showMicros ? '▲' : '▼'}</span>
          </button>

          {showMicros && (
            <div className="mt-3 space-y-2">
              {microRows.map(({ key, label, icon, unit, val, pct, color, textColor, target }) => (
                <div key={key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-stone-600 font-medium">{icon} {label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-bold ${textColor}`}>{val}</span>
                      <span className="text-stone-400">/ {target} {unit}</span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                        pct >= 80 ? 'bg-emerald-100 text-emerald-700' :
                        pct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-50 text-red-500'
                      }`}>{Math.round(pct)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${color}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
              <p className="text-xs text-stone-400 pt-1 italic">
                * Only foods logged via search have micronutrient data.
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Sprint 3: Prescribed Meal Plan Cards ────────────────────────────────────
// Collapsible cards above the food log. Each card shows the prescribed meal,
// its items with checkboxes. Member ticks what they consumed then presses Log.

function PrescribedMeals({ mealPlan, foodItems, onLogMeal }) {
  const [expanded,  setExpanded]  = useState(null);
  // Per-meal checked items: { [mealId]: Set of item indices }
  const [checked,   setChecked]   = useState({});

  if (!mealPlan || mealPlan.length === 0) return null;

  const now     = new Date();
  const nowMin  = now.getHours() * 60 + now.getMinutes();
  const toMin   = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h*60+(m||0); };

  const loggedNames = (foodItems || []).map(f => f.name?.toLowerCase());

  const isItemLogged = (item) => loggedNames.includes(item.food_name?.toLowerCase());

  const isMealFullyLogged = (meal) => {
    if (!meal.items?.length) return false;
    const matched = (meal.items || []).filter(i => isItemLogged(i)).length;
    return matched / meal.items.length >= 0.8;
  };

  const toggleItem = (mealId, idx) => {
    setChecked(prev => {
      const set = new Set(prev[mealId] || []);
      set.has(idx) ? set.delete(idx) : set.add(idx);
      return { ...prev, [mealId]: set };
    });
  };

  const toggleAll = (meal) => {
    const allIdxs = (meal.items || []).map((_, i) => i);
    const current = checked[meal.id] || new Set();
    // If all checked → uncheck all; otherwise → check all
    const allChecked = allIdxs.every(i => current.has(i));
    setChecked(prev => ({
      ...prev,
      [meal.id]: allChecked ? new Set() : new Set(allIdxs),
    }));
  };

  const handleOpen = (meal) => {
    const isOpen = expanded === meal.id;
    setExpanded(isOpen ? null : meal.id);
    // Pre-check all items that aren't logged yet when opening
    if (!isOpen && !checked[meal.id]) {
      const unlogged = new Set(
        (meal.items || []).map((item, i) => (!isItemLogged(item) ? i : null)).filter(i => i !== null)
      );
      setChecked(prev => ({ ...prev, [meal.id]: unlogged }));
    }
  };

  const handleLog = (meal) => {
    const checkedIdxs = checked[meal.id] || new Set();
    const selectedItems = (meal.items || []).filter((_, i) => checkedIdxs.has(i));
    if (selectedItems.length === 0) return;
    onLogMeal({ ...meal, items: selectedItems });
    setExpanded(null);
  };

  return (
    <Card>
      <SectionTitle icon="🍽">Prescribed Meal Plan</SectionTitle>
      <p className="text-xs text-stone-400 mb-3">Tick what you consumed, then tap Log.</p>
      <div className="space-y-2">
        {mealPlan.map((meal) => {
          const mealMin   = toMin(meal.time);
          const fullyLogged = isMealFullyLogged(meal);
          const isCurrent = mealMin !== null && nowMin >= mealMin - 30 && nowMin <= mealMin + 120;
          const isOpen    = expanded === meal.id;
          const mealKcal  = (meal.items || []).reduce((s, i) => s + (i.kcal || 0), 0);

          const checkedSet   = checked[meal.id] || new Set();
          const checkedCount = checkedSet.size;
          // Kcal of only checked items
          const checkedKcal  = (meal.items || []).reduce((s, item, i) =>
            checkedSet.has(i) ? s + (item.kcal || 0) : s, 0);

          const badge = fullyLogged
            ? { label: '✓ Logged', cls: 'bg-emerald-100 text-emerald-700' }
            : isCurrent
              ? { label: '⏰ Now',   cls: 'bg-amber-100 text-amber-700' }
              : { label: meal.time ? meal.time.slice(0,5) : '', cls: 'bg-stone-100 text-stone-500' };

          return (
            <div key={meal.id} className={`rounded-2xl border overflow-hidden transition-all ${
              fullyLogged ? 'border-emerald-200 bg-emerald-50/50' :
              isCurrent   ? 'border-amber-200 bg-amber-50/50'    : 'border-stone-100 bg-stone-50'
            }`}>
              {/* Header */}
              <button className="w-full text-left px-4 py-3 flex items-center gap-3"
                onClick={() => handleOpen(meal)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-stone-700">{meal.name}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <p className="text-xs text-stone-400 mt-0.5">
                    {(meal.items || []).length} items ·{' '}
                    <span className="font-bold text-orange-500">{mealKcal} kcal</span>
                    {isOpen && checkedCount > 0 && (
                      <span className="text-emerald-600 font-semibold ml-2">
                        · {checkedCount} selected · {checkedKcal} kcal
                      </span>
                    )}
                  </p>
                </div>
                <span className="text-stone-400 text-sm">{isOpen ? '▲' : '▼'}</span>
              </button>

              {/* Expanded — checkbox list */}
              {isOpen && (
                <div className="px-4 pb-4 border-t border-stone-100">

                  {/* Select all row */}
                  <button onClick={() => toggleAll(meal)}
                    className="flex items-center gap-2 py-2 text-xs text-stone-500 font-semibold hover:text-emerald-700 transition-colors">
                    <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      (meal.items||[]).every((_, i) => checkedSet.has(i))
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'border-stone-300 bg-white'
                    }`}>
                      {(meal.items||[]).every((_, i) => checkedSet.has(i)) && '✓'}
                    </span>
                    Select all / None
                  </button>

                  {/* Food item rows with checkboxes */}
                  <div className="space-y-1">
                    {(meal.items || []).map((item, i) => {
                      const isChecked  = checkedSet.has(i);
                      const alreadyIn  = isItemLogged(item);

                      return (
                        <button key={i} onClick={() => toggleItem(meal.id, i)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
                            isChecked  ? 'bg-emerald-50 border border-emerald-200' :
                            alreadyIn  ? 'bg-stone-100 border border-stone-200 opacity-60' :
                                         'bg-white border border-stone-100 hover:border-stone-200'
                          }`}>
                          {/* Checkbox */}
                          <span className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                            isChecked ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-stone-300 bg-white'
                          }`}>
                            {isChecked && <span className="text-xs font-bold">✓</span>}
                          </span>

                          {/* Food name + weight */}
                          <div className="flex-1 min-w-0">
                            <span className={`text-sm font-medium ${isChecked ? 'text-stone-800' : 'text-stone-500'}`}>
                              {item.food_name}
                            </span>
                            <span className="text-xs text-stone-400 ml-1.5">{item.qty_g}g</span>
                            {alreadyIn && (
                              <span className="text-xs text-emerald-600 font-semibold ml-1.5">already logged</span>
                            )}
                          </div>

                          {/* Macros */}
                          <div className="flex gap-1.5 text-xs flex-shrink-0">
                            <span className={`font-bold ${isChecked ? 'text-orange-500' : 'text-stone-400'}`}>
                              {item.kcal} kcal
                            </span>
                            <span className={isChecked ? 'text-blue-500' : 'text-stone-300'}>P {item.pro}g</span>
                            <span className={isChecked ? 'text-amber-500' : 'text-stone-300'}>C {item.carb}g</span>
                            <span className={isChecked ? 'text-purple-500' : 'text-stone-300'}>F {item.fat}g</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Log button */}
                  {!fullyLogged && (
                    <button
                      onClick={() => handleLog(meal)}
                      disabled={checkedCount === 0}
                      className={`w-full mt-3 py-3 text-sm font-bold rounded-xl transition-all active:scale-95 ${
                        checkedCount > 0
                          ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm'
                          : 'bg-stone-100 text-stone-400 cursor-not-allowed'
                      }`}>
                      {checkedCount === 0
                        ? 'Select items to log'
                        : `📋 Log ${checkedCount} item${checkedCount > 1 ? 's' : ''} · ${checkedKcal} kcal`}
                    </button>
                  )}

                  {fullyLogged && (
                    <p className="text-center text-xs text-emerald-600 font-semibold pt-3">✓ Already logged</p>
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
