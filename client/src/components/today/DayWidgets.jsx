/**
 * components/today/DayWidgets.jsx — the four data widgets that used to be
 * private functions inside pages/DailyLog.jsx, moved here verbatim in Sprint 3
 * so the new Today screen and its sheets can use them.
 *
 *   FastingBar       — live fasting window progress
 *   MacroProgress    — kcal / protein / carbs / fat bars + quick micro badge
 *   NutritionSummary — the 31-nutrient panel (vitamins / minerals / specials)
 *   PrescribedMeals  — coach's meal plan with consumed-vs-prescribed + log button
 *   ComplianceRing   — kept for any caller that still wants the ring
 *
 * No behaviour change. The maths they call lives in lib/day.
 */
import { useEffect, useState } from 'react';
import { RDA_TARGETS } from '../../constants';
import { Card, SectionTitle } from '../UI';
import {
  calcFoodMacros, calcMicros, addSupplementMicros, addActivityMicros,
  MICRO_VITAMINS, MICRO_MINERALS, MICRO_SPECIALS, QUICK_MICRO_KEYS, timeToMin,
} from '../../lib/day';

export function ComplianceRing({ pct }) {
  const r = 26, circ = 2 * Math.PI * r;
  const isHigh = pct >= 80;
  return (
    <svg
      className={`w-16 h-16 -rotate-90 transition-[filter] duration-700 ${isHigh ? 'drop-shadow-[0_0_10px_rgba(212,175,106,0.45)]' : ''}`}
      viewBox="0 0 64 64"
    >
      <defs>
        <linearGradient id="complianceGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#D4AF37" />
          <stop offset="60%"  stopColor="#F0E2B6" />
          <stop offset="100%" stopColor={isHigh ? '#d4af6a' : '#F0E2B6'} />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="6" />
      {pct > 0 && (
        <circle cx="32" cy="32" r={r} fill="none" stroke="url(#complianceGradient)" strokeWidth="6"
          strokeDasharray={`${(pct / 100) * circ} ${circ}`} strokeLinecap="round"
          className="transition-all duration-1000 ease-out" />
      )}
      <text x="32" y="32" dominantBaseline="middle" textAnchor="middle"
        fontFamily="Fraunces, serif" fontSize="16" fontWeight="600" fill="white" transform="rotate(90 32 32)">
        {pct}%
      </text>
    </svg>
  );
}

// ─── Fasting Bar ──────────────────────────────────────────────────────────────

export function FastingBar({ fasting }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const TOTAL     = 1440;
  const nowMin    = now.getHours() * 60 + now.getMinutes();
  const fastStart = timeToMin(fasting.start);
  const fastEnd   = timeToMin(fasting.end);
  const crossesMid = fastStart > fastEnd;

  let segments = [];
  if (crossesMid) {
    if (fastEnd > 0)       segments.push({ w:(fastEnd/TOTAL)*100,            type:'fast' });
    segments.push({          w:((fastStart-fastEnd)/TOTAL)*100,              type:'eat'  });
    if (fastStart < TOTAL) segments.push({ w:((TOTAL-fastStart)/TOTAL)*100, type:'fast' });
  } else {
    if (fastStart > 0)     segments.push({ w:(fastStart/TOTAL)*100,          type:'eat'  });
    segments.push({          w:((fastEnd-fastStart)/TOTAL)*100,              type:'fast' });
    if (fastEnd < TOTAL)   segments.push({ w:((TOTAL-fastEnd)/TOTAL)*100,   type:'eat'  });
  }

  const isEating = crossesMid
    ? (nowMin >= fastEnd && nowMin < fastStart)
    : (nowMin < fastStart || nowMin >= fastEnd);

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
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${isEating ? 'bg-gold/[0.13] text-gold-light' : 'bg-blue-400/[0.14] text-blue-400'}`}>
          {isEating ? '🟢 Eating' : '🔵 Fasting'}
        </span>
      </div>
      <p className="text-xs text-faint mb-3">
        {isEating
          ? `Eating window — ${hLeft}h ${mLeft}m until fast begins`
          : `Fasting — ${hLeft}h ${mLeft}m until eating window opens`}
      </p>
      <div className="relative h-6 rounded-full overflow-hidden flex">
        {segments.map((seg, i) => (
          <div key={i} style={{ width:`${seg.w}%` }}
            className={seg.type==='eat' ? 'bg-gold-deep' : 'bg-blue-300'} />
        ))}
        <div className="absolute top-0 bottom-0 flex flex-col items-center"
          style={{ left:`${(nowMin/TOTAL)*100}%`, transform:'translateX(-50%)' }}>
          <div className="w-0.5 h-full bg-red-500" />
          <div className="absolute -top-0.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-white shadow" />
        </div>
      </div>
      <div className="flex justify-between mt-1 text-xs text-lo select-none">
        <span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>12AM</span>
      </div>
      <div className="flex gap-4 mt-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-gold-deep flex-shrink-0" />
          <span className="text-faint">Eating {eatHrs.toFixed(0)}h ({fasting.end?.slice(0,5)}–{fasting.start?.slice(0,5)})</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-300 flex-shrink-0" />
          <span className="text-faint">Fasting {fastHrs.toFixed(0)}h</span>
        </span>
      </div>
      {fasting.note && (
        <p className="mt-3 text-xs text-faint bg-surface px-3 py-2 rounded-xl leading-relaxed">
          📌 {fasting.note}
        </p>
      )}
    </Card>
  );
}

// ─── Macro + Micro Progress ───────────────────────────────────────────────────

export function MacroProgress({ macros, foodItems, supplements, activeActivities, activities, overrides, weightKg, workoutKcal = 0 }) {
  const totals     = calcFoodMacros(foodItems);
  const rawMicros  = calcMicros(foodItems);
  const withSupps  = addSupplementMicros(rawMicros, supplements);
  const micros     = addActivityMicros(withSupps, activities, activeActivities);
  const hasMicroData = foodItems.some(f => f.per_100g);

  // Quick count badge for MacroProgress — full detail in standalone NutritionSummary
  const quickMet = hasMicroData ? QUICK_MICRO_KEYS.filter(key => {
    const meta = RDA_TARGETS[key];
    if (!meta) return false;
    const val = key === 'omega3_epa' ? (micros.omega3_epa + micros.omega3_dha)
               : key === 'omega3_dha' ? 0   // counted in epa
               : micros[key] || 0;
    return (val / (meta.rda)) * 100 >= 80;
  }).length : 0;
  const quickTotal = QUICK_MICRO_KEYS.filter(k => k !== 'omega3_dha').length;

  // Exercise burn now comes from the Workout log (passed in), not from
  // protocol checkboxes — those are compliance only.
  const burnTotal = Math.round(workoutKcal) || 0;
  const netKcal = Math.round(totals.kcal) - burnTotal;

  const bars = [
    { key:'kcal', label:'Calories',  icon:null, unit:'kcal', current:Math.round(totals.kcal), target:macros.kcal, bg:'bg-orange-400', light:'bg-orange-400/[0.08]', text:'text-orange-400' },
    { key:'pro',  label:'Protein',   icon:null, unit:'g',    current:+totals.pro.toFixed(1),  target:macros.pro,  bg:'bg-blue-500',   light:'bg-blue-400/[0.08]',   text:'text-blue-400' },
    { key:'carb', label:'Net Carbs', icon:'🌾', unit:'g',    current:+totals.carb.toFixed(1), target:macros.carb, bg:'bg-amber-400',  light:'bg-amber-400/[0.08]',  text:'text-amber-400' },
    { key:'fat',  label:'Fat',       icon:'🥑', unit:'g',    current:+totals.fat.toFixed(1),  target:macros.fat,  bg:'bg-amber-500', light:'bg-amber-400/[0.08]', text:'text-amber-400' },
  ];

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle icon="🎯">Macro Targets</SectionTitle>
        {macros.phase && (
          <span className="text-xs font-semibold text-gold-deep bg-gold/[0.07] px-2.5 py-1 rounded-full">{macros.phase}</span>
        )}
      </div>

      {/* Net calorie banner */}
      {burnTotal > 0 && (
        <div className={`flex items-center justify-between text-xs px-3 py-2.5 rounded-xl mb-3 ${
          netKcal <= 0 ? 'bg-gold/[0.07] text-gold-light' : 'bg-orange-400/[0.08] text-orange-400'}`}>
          <div className="flex gap-3">
            <span>🍽 Eaten <strong>{Math.round(totals.kcal)}</strong></span>
            <span>Burned <strong>{burnTotal}</strong></span>
          </div>
          <span className="font-bold">Net {netKcal > 0 ? `+${netKcal}` : netKcal} kcal</span>
        </div>
      )}

      {/* Macro bars */}
      <div className="space-y-3">
        {bars.map(({ key, label, icon, unit, current, target, bg, light, text }) => {
          const pct = target ? Math.min(100, (current / target) * 100) : 0;
          const over = target && current > target;
          const remaining = target ? Math.max(0, +(target - current).toFixed(1)) : null;
          return (
            <div key={key}>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-semibold text-mid">{icon} {label}</span>
                <div className="flex items-center gap-1.5">
                  {over && <span className="text-red-400 font-bold">⚠️ over</span>}
                  <span className={`font-bold ${over ? 'text-red-400' : text}`}>{current}</span>
                  <span className="text-lo">/ {target} {unit}</span>
                  {remaining !== null && !over && remaining > 0 && <span className="text-ghost">({remaining} left)</span>}
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

      {/* Full burn breakdown lives in the Workout log, which owns the data */}

      {/* Total eaten */}
      {totals.kcal > 0 && (
        <div className="mt-3 pt-3 border-t border-hair flex justify-between text-xs text-lo">
          <span>Total logged today</span>
          <span className="font-semibold text-mid">
            {Math.round(totals.kcal)} kcal · P {totals.pro.toFixed(0)}g · C {totals.carb.toFixed(0)}g · F {totals.fat.toFixed(0)}g
          </span>
        </div>
      )}

      {/* Micro summary badge — full detail in NutritionSummary card below food log */}
      {hasMicroData && (
        <div className="mt-3 pt-3 border-t border-hair flex items-center justify-between text-xs">
          <span className="text-faint font-medium">🔬 Key Nutrients</span>
          <span className={`px-2 py-0.5 rounded-full font-bold ${
            quickMet >= quickTotal * 0.8 ? 'bg-gold/[0.13] text-gold-light' :
            quickMet >= quickTotal * 0.5 ? 'bg-amber-400/[0.14] text-amber-400' : 'bg-red-400/[0.08] text-red-400'
          }`}>{`${quickMet}/${quickTotal}`} met · see below ↓</span>
        </div>
      )}
    </Card>
  );
}

// ─── Sprint 5: Nutrition Summary Panel (3 tabs) ───────────────────────────────

// Micro-nutrient key groups — shared by the hero tile and the summary panel so
// the "20/31" badge and the panel can never disagree.
export function NutritionSummary({ foodItems, supplements, activities, activeActivities, rdaOverrides = {} }) {
  const [tab, setTab] = useState('vitamins');

  const rawMicros  = calcMicros(foodItems);
  const withSupps  = addSupplementMicros(rawMicros, supplements);
  const micros     = addActivityMicros(withSupps, activities, activeActivities);
  const hasMicros  = foodItems.some(f => f.per_100g);
  if (!hasMicros) return null;

  const VITAMINS = MICRO_VITAMINS, MINERALS = MICRO_MINERALS, SPECIALS = MICRO_SPECIALS;

  const getRda = (key) => {
    const meta = RDA_TARGETS[key];
    if (!meta) return null;
    const override = rdaOverrides[key];
    return { ...meta, rda: override ? parseFloat(override) : meta.rda };
  };

  const renderRows = (keys) => keys.map(key => {
    const meta = getRda(key);
    if (!meta) return null;
    const raw  = micros[key] || 0;
    const dec  = ['vit_b12','folate','biotin','vit_b1','vit_b2','vit_b5','vit_b6','copper','manganese','selenium'].includes(key) ? 1 : 0;
    const val  = +raw.toFixed(dec);
    const pct  = Math.min(100, (raw / meta.rda) * 100);
    const isUpper = meta.upper;
    const good = isUpper ? (pct <= 100) : (pct >= 80);
    const warn = isUpper ? (pct > 80 && pct <= 100) : (pct >= 50 && pct < 80);
    const barCls  = good ? 'bg-gold-deep' : warn ? 'bg-amber-400' : isUpper ? 'bg-red-500' : 'bg-red-400';
    const textCls = good ? 'text-gold-deep' : warn ? 'text-amber-400' : 'text-red-400';
    const badgeCls= good ? 'bg-gold/[0.13] text-gold-light' : warn ? 'bg-amber-400/[0.14] text-amber-400' : 'bg-red-400/[0.08] text-red-400';
    return (
      <div key={key}>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-mid font-medium">{meta.icon} {meta.label}
            {rdaOverrides[key] && <span className="ml-1 text-amber-400 text-xs">★</span>}
          </span>
          <div className="flex items-center gap-1.5">
            <span className={`font-bold ${textCls}`}>{val}</span>
            <span className="text-lo">/ {meta.rda} {meta.unit}</span>
            <span className={`font-bold px-1.5 py-0.5 rounded-full text-xs ${badgeCls}`}>
              {isUpper && pct > 100 ? '⚠️ ' : ''}{Math.round(pct)}%
            </span>
          </div>
        </div>
        <div className="h-1.5 bg-charcoal rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${barCls}`} style={{width:`${pct}%`}} />
        </div>
      </div>
    );
  });

  const metCount = (keys) => keys.filter(key => {
    const meta = getRda(key);
    if (!meta) return false;
    const pct = ((micros[key]||0) / meta.rda) * 100;
    return meta.upper ? pct <= 100 : pct >= 80;
  }).length;

  const vMet = metCount(VITAMINS), mMet = metCount(MINERALS), sMet = metCount(SPECIALS);
  const totalMet = vMet + mMet + sMet;
  const totalAll = VITAMINS.length + MINERALS.length + SPECIALS.length;
  const hasOverrides = Object.keys(rdaOverrides).length > 0;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle icon="🔬">Nutrition Summary</SectionTitle>
        <div className="flex items-center gap-2">
          {hasOverrides && <span className="text-xs text-amber-400 font-semibold">★ custom targets</span>}
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            totalMet >= totalAll*0.8 ? 'bg-gold/[0.13] text-gold-light' :
            totalMet >= totalAll*0.5 ? 'bg-amber-400/[0.14] text-amber-400' : 'bg-red-400/[0.08] text-red-400'
          }`}>{`${totalMet}/${totalAll}`}</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-charcoal p-1 rounded-xl mb-4">
        {[
          ['vitamins', `💊 Vitamins`,  vMet, VITAMINS.length],
          ['minerals', `⛏ Minerals`,  mMet, MINERALS.length],
          ['specials', `🌿 Specials`,  sMet, SPECIALS.length],
        ].map(([id, label, met, total]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 py-1.5 rounded-lg transition-colors text-center ${
              tab===id ? 'bg-surface text-gold-light shadow-sm' : 'text-faint hover:text-white'}`}>
            <div className="text-xs font-bold">{label}</div>
            <div className={`text-xs font-semibold ${met===total?'text-gold-deep':met>=total*0.5?'text-amber-400':'text-red-400'}`}>
              {met + "/" + total}
            </div>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {tab==='vitamins' && renderRows(VITAMINS)}
        {tab==='minerals' && renderRows(MINERALS)}
        {tab==='specials' && renderRows(SPECIALS)}
      </div>

      <p className="text-xs text-lo mt-3 italic">
        * Includes food + supplements + sunlight. ★ = clinically adjusted target.
      </p>
    </Card>
  );
}

export function PrescribedMeals({ mealPlan, foodItems, onLogMeal }) {
  const [expanded, setExpanded] = useState(null);
  const [checked,  setChecked]  = useState({});

  if (!mealPlan || mealPlan.length === 0) return null;

  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const toMin  = (t) => { if (!t) return null; const [h,m]=t.split(':').map(Number); return h*60+(m||0); };

  // Check within the SAME meal slot to avoid false positives
  const isItemLogged = (item, mealName) => {
    const loggedInMeal = (foodItems || [])
      .filter(f => f.meal === mealName)
      .map(f => f.name?.toLowerCase());
    return loggedInMeal.includes(item.food_name?.toLowerCase());
  };

  const isMealFullyLogged = (meal) => {
    if (!meal.items?.length) return false;
    const matched = (meal.items||[]).filter(i => isItemLogged(i, meal.name)).length;
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
    const allIdxs = (meal.items||[]).map((_,i)=>i);
    const current = checked[meal.id] || new Set();
    const allChecked = allIdxs.every(i => current.has(i));
    setChecked(prev => ({ ...prev, [meal.id]: allChecked ? new Set() : new Set(allIdxs) }));
  };

  const handleOpen = (meal) => {
    const isOpen = expanded === meal.id;
    setExpanded(isOpen ? null : meal.id);
    if (!isOpen && !checked[meal.id]) {
      const unlogged = new Set(
        (meal.items||[]).map((item,i) => (!isItemLogged(item, meal.name) ? i : null)).filter(i => i!==null)
      );
      setChecked(prev => ({ ...prev, [meal.id]: unlogged }));
    }
  };

  const handleLog = (meal) => {
    const checkedIdxs = checked[meal.id] || new Set();
    const selectedItems = (meal.items||[]).filter((_,i) => checkedIdxs.has(i));
    if (selectedItems.length === 0) return;
    onLogMeal({ ...meal, items: selectedItems });
    setExpanded(null);
  };

  return (
    <Card>
      <SectionTitle icon="🍽">Prescribed Meal Plan</SectionTitle>
      <p className="text-xs text-lo mb-3">Tick what you consumed, then tap Log.</p>
      <div className="space-y-2">
        {mealPlan.map((meal) => {
          const mealMin     = toMin(meal.time);
          const fullyLogged = isMealFullyLogged(meal);
          const isCurrent   = mealMin!==null && nowMin>=mealMin-30 && nowMin<=mealMin+120;
          const isOpen      = expanded === meal.id;
          const mealKcal    = (meal.items||[]).reduce((s,i)=>s+(i.kcal||0),0);
          const checkedSet  = checked[meal.id] || new Set();
          const checkedCount = checkedSet.size;
          const checkedKcal = (meal.items||[]).reduce((s,item,i)=>checkedSet.has(i)?s+(item.kcal||0):s,0);

          const badge = fullyLogged
            ? { label:'✓ Logged', cls:'bg-gold/[0.13] text-gold-light' }
            : isCurrent ? { label:'⏰ Now', cls:'bg-amber-400/[0.14] text-amber-400' }
            : { label:meal.time?meal.time.slice(0,5):'', cls:'bg-charcoal text-faint' };

          return (
            <div key={meal.id} className={`rounded-2xl border overflow-hidden transition-all ${
              fullyLogged ? 'border-gold/[0.22] bg-gold/[0.035]' :
              isCurrent   ? 'border-amber-400/25 bg-amber-400/[0.04]' : 'border-hair bg-surface'}`}>

              <button className="w-full text-left px-4 py-3 flex items-center gap-3" onClick={() => handleOpen(meal)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-white">{meal.name}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <p className="text-xs text-lo mt-0.5">
                    {(meal.items||[]).length} items · <span className="font-bold text-orange-300">{mealKcal} kcal</span>
                    {isOpen && checkedCount>0 && <span className="text-gold-deep font-semibold ml-2">· {checkedCount} selected · {checkedKcal} kcal</span>}
                  </p>
                </div>
                <span className="text-lo text-sm">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 border-t border-hair">
                  <button onClick={() => toggleAll(meal)}
                    className="flex items-center gap-2 py-2 text-xs text-faint font-semibold hover:text-gold-light transition-colors">
                    <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      (meal.items||[]).every((_,i)=>checkedSet.has(i)) ? 'bg-gold border-gold text-charcoal' : 'border-hair-med bg-surface'}`}>
                      {(meal.items||[]).every((_,i)=>checkedSet.has(i)) && '✓'}
                    </span>
                    Select all / None
                  </button>

                  <div className="space-y-1">
                    {(meal.items||[]).map((item, i) => {
                      const isChecked = checkedSet.has(i);
                      const alreadyIn = isItemLogged(item, meal.name);
                      return (
                        <button key={i} onClick={() => toggleItem(meal.id, i)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
                            isChecked  ? 'bg-gold/[0.07] border border-gold/[0.22]' :
                            alreadyIn  ? 'bg-charcoal border border-hair-med opacity-60' :
                                         'bg-surface border border-hair hover:border-hair-med'}`}>
                          <span className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                            isChecked ? 'bg-gold border-gold text-charcoal' : 'border-hair-med bg-surface'}`}>
                            {isChecked && <span className="text-xs font-bold">✓</span>}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className={`text-sm font-medium ${isChecked?'text-white':'text-faint'}`}>{item.food_name}</span>
                            <span className="text-xs text-lo ml-1.5">{item.qty_g}g</span>
                            {alreadyIn && <span className="text-xs text-gold-deep font-semibold ml-1.5">already logged</span>}
                          </div>
                          <div className="flex gap-1.5 text-xs flex-shrink-0">
                            <span className={`font-bold ${isChecked?'text-orange-300':'text-lo'}`}>{item.kcal} kcal</span>
                            <span className={isChecked?'text-blue-300':'text-ghost'}>P {item.pro}g</span>
                            <span className={isChecked?'text-amber-400':'text-ghost'}>C {item.carb}g</span>
                            <span className={isChecked?'text-amber-400':'text-ghost'}>F {item.fat}g</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {!fullyLogged && (
                    <button onClick={() => handleLog(meal)} disabled={checkedCount===0}
                      className={`w-full mt-3 py-3 text-sm font-bold rounded-xl transition-all active:scale-95 ${
                        checkedCount>0 ? 'bg-gold hover:bg-gold text-charcoal shadow-sm' : 'bg-charcoal text-lo cursor-not-allowed'}`}>
                      {checkedCount===0 ? 'Select items to log' : `📋 Log ${checkedCount} item${checkedCount>1?'s':''} · ${checkedKcal} kcal`}
                    </button>
                  )}
                  {fullyLogged && <p className="text-center text-xs text-gold-deep font-semibold pt-3">✓ Already logged</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Main DailyLog Page ───────────────────────────────────────────────────────

