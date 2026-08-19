import { useEffect, useCallback, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogStore }  from '../store/logStore';
import { useAuthStore } from '../store/authStore';
import api from '../api/client';
import { getMyProfile } from '../api/logs';
import {
  today, formatDate,
  ACTIVITIES, ACV_ITEMS, SUPPLEMENTS,
  calcCompliance, getNutrition, RDA_TARGETS,
} from '../constants';
import { Card, SectionTitle, OfflineBanner, PatientBottomNav } from '../components/UI';
import FoodLog       from '../components/FoodLog';
import WorkoutLog    from '../components/WorkoutLog';
import InstallPrompt from '../components/InstallPrompt';
import NotificationBell from '../components/NotificationBell';
import AIChatLog, { useAIChat } from '../components/AIChatLog';
import { sessionEnergy } from '../utils/exerciseCalories';
import { useSettingsStore, useTerms, haptic } from '../store/settingsStore';
import { usePush }        from '../hooks/usePush';
import { useOfflineSync } from '../hooks/useOfflineQueue';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeToMin(t) {
  if (!t) return 0;
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  return h * 60 + (m || 0);
}

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

function calcMicros(foodItems = []) {
  return foodItems.reduce((acc, item) => {
    if (!item.per_100g) return acc;
    const f = item.grams / 100;
    const n = item.per_100g;
    return {
      // Vitamins
      vit_a:    acc.vit_a    + (n.vit_a    || 0) * f,
      vit_b1:   acc.vit_b1   + (n.vit_b1   || 0) * f,
      vit_b2:   acc.vit_b2   + (n.vit_b2   || 0) * f,
      vit_b3:   acc.vit_b3   + (n.vit_b3   || 0) * f,
      vit_b5:   acc.vit_b5   + (n.vit_b5   || 0) * f,
      vit_b6:   acc.vit_b6   + (n.vit_b6   || 0) * f,
      vit_b12:  acc.vit_b12  + (n.vit_b12  || 0) * f,
      vit_c:    acc.vit_c    + (n.vit_c    || 0) * f,
      vit_d:    acc.vit_d    + (n.vit_d    || 0) * f,
      vit_e:    acc.vit_e    + (n.vit_e    || 0) * f,
      vit_k:    acc.vit_k    + (n.vit_k    || 0) * f,
      folate:   acc.folate   + (n.folate   || 0) * f,
      biotin:   acc.biotin   + (n.biotin   || 0) * f,
      choline:  acc.choline  + (n.choline  || 0) * f,
      // Minerals
      calcium:    acc.calcium    + (n.calcium    || 0) * f,
      iron:       acc.iron       + (n.iron       || 0) * f,
      magnesium:  acc.magnesium  + (n.magnesium  || 0) * f,
      phosphorus: acc.phosphorus + (n.phosphorus || 0) * f,
      potassium:  acc.potassium  + (n.potassium  || 0) * f,
      sodium:     acc.sodium     + (n.sodium     || 0) * f,
      zinc:       acc.zinc       + (n.zinc       || 0) * f,
      copper:     acc.copper     + (n.copper     || 0) * f,
      manganese:  acc.manganese  + (n.manganese  || 0) * f,
      selenium:   acc.selenium   + (n.selenium   || 0) * f,
      // Specials
      omega3_ala:  acc.omega3_ala  + (n.omega3_ala  || 0) * f,
      omega3_epa:  acc.omega3_epa  + (n.omega3_epa  || 0) * f,
      omega3_dha:  acc.omega3_dha  + (n.omega3_dha  || 0) * f,
      omega6:      acc.omega6      + (n.omega6      || 0) * f,
      fiber:       acc.fiber       + (n.fiber       || 0) * f,
      lycopene:    acc.lycopene    + (n.lycopene    || 0) * f,
      beta_glucan: acc.beta_glucan + (n.beta_glucan || 0) * f,
    };
  }, {
    vit_a:0,vit_b1:0,vit_b2:0,vit_b3:0,vit_b5:0,vit_b6:0,vit_b12:0,
    vit_c:0,vit_d:0,vit_e:0,vit_k:0,folate:0,biotin:0,choline:0,
    calcium:0,iron:0,magnesium:0,phosphorus:0,potassium:0,sodium:0,
    zinc:0,copper:0,manganese:0,selenium:0,
    omega3_ala:0,omega3_epa:0,omega3_dha:0,omega6:0,
    fiber:0,lycopene:0,beta_glucan:0,
  });
}

function addSupplementMicros(base, supplements = {}) {
  const m = { ...base };
  if (supplements.b12)     { m.vit_b12  += 1000; }
  if (supplements.d3)      { m.vit_d    += 8571; }  // 60000 IU / 7 days
  if (supplements.fishoil) { m.omega3_epa += 180; m.omega3_dha += 120; }
  if (supplements.flax)    { m.omega3_ala  += 533; }
  if (supplements.multi)   {
    m.vit_a += 900; m.vit_b1 += 1.2; m.vit_b2 += 1.3; m.vit_b3 += 16;
    m.vit_b5 += 5;  m.vit_b6 += 1.7; m.vit_b12 += 2.4; m.vit_c += 90;
    m.vit_d += 600; m.vit_e += 15;   m.vit_k += 120;   m.folate += 400;
    m.biotin += 30; m.calcium += 200; m.iron += 8;      m.magnesium += 100;
    m.zinc += 8;    m.selenium += 55; m.copper += 0.9;  m.manganese += 2.3;
  }
  if (supplements.yeast)   { m.vit_b12 += 1.0; m.vit_b1 += 0.5; m.vit_b2 += 0.5; m.vit_b3 += 2.75; m.folate += 125; }
  return m;
}

function addActivityMicros(base, activities = {}, activeActivities = []) {
  const m = { ...base };
  activeActivities.forEach(act => {
    if (activities[act.id] && act.vitD_iu) m.vit_d += act.vitD_iu;
  });
  return m;
}

// ── Energy balance (TDEE) ─────────────────────────────────────────────────────
// Mirrors the fuller breakdown on the Profile page — same equations, so the two
// screens can never disagree. BMR: Mifflin-St Jeor; burn from ticked protocol
// activities (MET × kg × hours) plus logged workout minutes at 6 MET.
function calcBMR({ weightKg, heightCm, age, gender }) {
  if (!weightKg || !heightCm || age == null) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const g = String(gender || '').toLowerCase();
  if (g === 'male')   return Math.round(base + 5);
  if (g === 'female') return Math.round(base - 161);
  return Math.round(base - 78); // sex unknown — midpoint of the two constants
}

function ComplianceRing({ pct }) {
  const r = 26, circ = 2 * Math.PI * r;
  const isHigh = pct >= 80;
  return (
    <svg
      className={`w-16 h-16 -rotate-90 transition-[filter] duration-700 ${isHigh ? 'drop-shadow-[0_0_10px_rgba(212,175,106,0.45)]' : ''}`}
      viewBox="0 0 64 64"
    >
      <defs>
        <linearGradient id="complianceGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#7c5cfc" />
          <stop offset="60%"  stopColor="#a78bfa" />
          <stop offset="100%" stopColor={isHigh ? '#d4af6a' : '#c4b5fd'} />
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

function FastingBar({ fasting }) {
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
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${isEating ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
          {isEating ? '🟢 Eating' : '🔵 Fasting'}
        </span>
      </div>
      <p className="text-xs text-stone-500 mb-3">
        {isEating
          ? `Eating window — ${hLeft}h ${mLeft}m until fast begins`
          : `Fasting — ${hLeft}h ${mLeft}m until eating window opens`}
      </p>
      <div className="relative h-6 rounded-full overflow-hidden flex">
        {segments.map((seg, i) => (
          <div key={i} style={{ width:`${seg.w}%` }}
            className={seg.type==='eat' ? 'bg-emerald-400' : 'bg-blue-300'} />
        ))}
        <div className="absolute top-0 bottom-0 flex flex-col items-center"
          style={{ left:`${(nowMin/TOTAL)*100}%`, transform:'translateX(-50%)' }}>
          <div className="w-0.5 h-full bg-red-500" />
          <div className="absolute -top-0.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-white shadow" />
        </div>
      </div>
      <div className="flex justify-between mt-1 text-xs text-stone-400 select-none">
        <span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>12AM</span>
      </div>
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

// ─── Macro + Micro Progress ───────────────────────────────────────────────────

function MacroProgress({ macros, foodItems, supplements, activeActivities, activities, overrides, weightKg, workoutKcal = 0 }) {
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
    { key:'kcal', label:'Calories',  icon:'🔥', unit:'kcal', current:Math.round(totals.kcal), target:macros.kcal, bg:'bg-orange-400', light:'bg-orange-50', text:'text-orange-600' },
    { key:'pro',  label:'Protein',   icon:'💪', unit:'g',    current:+totals.pro.toFixed(1),  target:macros.pro,  bg:'bg-blue-500',   light:'bg-blue-50',   text:'text-blue-600' },
    { key:'carb', label:'Net Carbs', icon:'🌾', unit:'g',    current:+totals.carb.toFixed(1), target:macros.carb, bg:'bg-amber-400',  light:'bg-amber-50',  text:'text-amber-600' },
    { key:'fat',  label:'Fat',       icon:'🥑', unit:'g',    current:+totals.fat.toFixed(1),  target:macros.fat,  bg:'bg-purple-500', light:'bg-purple-50', text:'text-purple-600' },
  ];

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle icon="🎯">Macro Targets</SectionTitle>
        {macros.phase && (
          <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">{macros.phase}</span>
        )}
      </div>

      {/* Net calorie banner */}
      {burnTotal > 0 && (
        <div className={`flex items-center justify-between text-xs px-3 py-2.5 rounded-xl mb-3 ${
          netKcal <= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
          <div className="flex gap-3">
            <span>🍽 Eaten <strong>{Math.round(totals.kcal)}</strong></span>
            <span>🔥 Burned <strong>{burnTotal}</strong></span>
          </div>
          <span className="font-bold">Net {netKcal > 0 ? `+${netKcal}` : netKcal} kcal{netKcal <= 0 && ' 🎯'}</span>
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
                <span className="font-semibold text-stone-600">{icon} {label}</span>
                <div className="flex items-center gap-1.5">
                  {over && <span className="text-red-500 font-bold">⚠️ over</span>}
                  <span className={`font-bold ${over ? 'text-red-500' : text}`}>{current}</span>
                  <span className="text-stone-400">/ {target} {unit}</span>
                  {remaining !== null && !over && remaining > 0 && <span className="text-stone-300">({remaining} left)</span>}
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
        <div className="mt-3 pt-3 border-t border-stone-100 flex justify-between text-xs text-stone-400">
          <span>Total logged today</span>
          <span className="font-semibold text-stone-600">
            {Math.round(totals.kcal)} kcal · P {totals.pro.toFixed(0)}g · C {totals.carb.toFixed(0)}g · F {totals.fat.toFixed(0)}g
          </span>
        </div>
      )}

      {/* Micro summary badge — full detail in NutritionSummary card below food log */}
      {hasMicroData && (
        <div className="mt-3 pt-3 border-t border-stone-100 flex items-center justify-between text-xs">
          <span className="text-stone-500 font-medium">🔬 Key Nutrients</span>
          <span className={`px-2 py-0.5 rounded-full font-bold ${
            quickMet >= quickTotal * 0.8 ? 'bg-emerald-100 text-emerald-700' :
            quickMet >= quickTotal * 0.5 ? 'bg-amber-100 text-amber-700' : 'bg-red-50 text-red-600'
          }`}>{`${quickMet}/${quickTotal}`} met · see below ↓</span>
        </div>
      )}
    </Card>
  );
}

// ─── Sprint 5: Nutrition Summary Panel (3 tabs) ───────────────────────────────

function NutritionSummary({ foodItems, supplements, activities, activeActivities, rdaOverrides = {} }) {
  const [tab, setTab] = useState('vitamins');

  const rawMicros  = calcMicros(foodItems);
  const withSupps  = addSupplementMicros(rawMicros, supplements);
  const micros     = addActivityMicros(withSupps, activities, activeActivities);
  const hasMicros  = foodItems.some(f => f.per_100g);
  if (!hasMicros) return null;

  const VITAMINS = ['vit_a','vit_b1','vit_b2','vit_b3','vit_b5','vit_b6','vit_b12','vit_c','vit_d','vit_e','vit_k','folate','biotin','choline'];
  const MINERALS = ['calcium','iron','magnesium','phosphorus','potassium','sodium','zinc','copper','manganese','selenium'];
  const SPECIALS = ['fiber','omega3_ala','omega3_epa','omega3_dha','omega6','lycopene','beta_glucan'];

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
    const barCls  = good ? 'bg-emerald-400' : warn ? 'bg-amber-400' : isUpper ? 'bg-red-500' : 'bg-red-400';
    const textCls = good ? 'text-emerald-600' : warn ? 'text-amber-600' : 'text-red-500';
    const badgeCls= good ? 'bg-emerald-100 text-emerald-700' : warn ? 'bg-amber-100 text-amber-700' : 'bg-red-50 text-red-500';
    return (
      <div key={key}>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-stone-600 font-medium">{meta.icon} {meta.label}
            {rdaOverrides[key] && <span className="ml-1 text-purple-500 text-xs">★</span>}
          </span>
          <div className="flex items-center gap-1.5">
            <span className={`font-bold ${textCls}`}>{val}</span>
            <span className="text-stone-400">/ {meta.rda} {meta.unit}</span>
            <span className={`font-bold px-1.5 py-0.5 rounded-full text-xs ${badgeCls}`}>
              {isUpper && pct > 100 ? '⚠️ ' : ''}{Math.round(pct)}%
            </span>
          </div>
        </div>
        <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
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
          {hasOverrides && <span className="text-xs text-purple-600 font-semibold">★ custom targets</span>}
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            totalMet >= totalAll*0.8 ? 'bg-emerald-100 text-emerald-700' :
            totalMet >= totalAll*0.5 ? 'bg-amber-100 text-amber-700' : 'bg-red-50 text-red-500'
          }`}>{`${totalMet}/${totalAll}`}</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-stone-100 p-1 rounded-xl mb-4">
        {[
          ['vitamins', `💊 Vitamins`,  vMet, VITAMINS.length],
          ['minerals', `⛏ Minerals`,  mMet, MINERALS.length],
          ['specials', `🌿 Specials`,  sMet, SPECIALS.length],
        ].map(([id, label, met, total]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 py-1.5 rounded-lg transition-colors text-center ${
              tab===id ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
            <div className="text-xs font-bold">{label}</div>
            <div className={`text-xs font-semibold ${met===total?'text-emerald-600':met>=total*0.5?'text-amber-600':'text-red-500'}`}>
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

      <p className="text-xs text-stone-400 mt-3 italic">
        * Includes food + supplements + sunlight. ★ = clinically adjusted target.
      </p>
    </Card>
  );
}

function PrescribedMeals({ mealPlan, foodItems, onLogMeal }) {
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
      <p className="text-xs text-stone-400 mb-3">Tick what you consumed, then tap Log.</p>
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
            ? { label:'✓ Logged', cls:'bg-emerald-100 text-emerald-700' }
            : isCurrent ? { label:'⏰ Now', cls:'bg-amber-100 text-amber-700' }
            : { label:meal.time?meal.time.slice(0,5):'', cls:'bg-stone-100 text-stone-500' };

          return (
            <div key={meal.id} className={`rounded-2xl border overflow-hidden transition-all ${
              fullyLogged ? 'border-emerald-200 bg-emerald-50/50' :
              isCurrent   ? 'border-amber-200 bg-amber-50/50' : 'border-stone-100 bg-stone-50'}`}>

              <button className="w-full text-left px-4 py-3 flex items-center gap-3" onClick={() => handleOpen(meal)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-stone-700">{meal.name}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <p className="text-xs text-[#4e4e5c] mt-0.5">
                    {(meal.items||[]).length} items · <span className="font-bold text-orange-500">{mealKcal} kcal</span>
                    {isOpen && checkedCount>0 && <span className="text-emerald-600 font-semibold ml-2">· {checkedCount} selected · {checkedKcal} kcal</span>}
                  </p>
                </div>
                <span className="text-stone-400 text-sm">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 border-t border-stone-100">
                  <button onClick={() => toggleAll(meal)}
                    className="flex items-center gap-2 py-2 text-xs text-stone-500 font-semibold hover:text-emerald-700 transition-colors">
                    <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      (meal.items||[]).every((_,i)=>checkedSet.has(i)) ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-stone-300 bg-white'}`}>
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
                            isChecked  ? 'bg-emerald-50 border border-emerald-200' :
                            alreadyIn  ? 'bg-stone-100 border border-stone-200 opacity-60' :
                                         'bg-[#1a1a20] border border-white/[0.07] hover:border-stone-200'}`}>
                          <span className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                            isChecked ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-stone-300 bg-white'}`}>
                            {isChecked && <span className="text-xs font-bold">✓</span>}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className={`text-sm font-medium ${isChecked?'text-stone-800':'text-stone-500'}`}>{item.food_name}</span>
                            <span className="text-xs text-stone-400 ml-1.5">{item.qty_g}g</span>
                            {alreadyIn && <span className="text-xs text-emerald-600 font-semibold ml-1.5">already logged</span>}
                          </div>
                          <div className="flex gap-1.5 text-xs flex-shrink-0">
                            <span className={`font-bold ${isChecked?'text-orange-500':'text-stone-400'}`}>{item.kcal} kcal</span>
                            <span className={isChecked?'text-blue-500':'text-stone-300'}>P {item.pro}g</span>
                            <span className={isChecked?'text-amber-500':'text-stone-300'}>C {item.carb}g</span>
                            <span className={isChecked?'text-purple-500':'text-stone-300'}>F {item.fat}g</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {!fullyLogged && (
                    <button onClick={() => handleLog(meal)} disabled={checkedCount===0}
                      className={`w-full mt-3 py-3 text-sm font-bold rounded-xl transition-all active:scale-95 ${
                        checkedCount>0 ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm' : 'bg-stone-100 text-stone-400 cursor-not-allowed'}`}>
                      {checkedCount===0 ? 'Select items to log' : `📋 Log ${checkedCount} item${checkedCount>1?'s':''} · ${checkedKcal} kcal`}
                    </button>
                  )}
                  {fullyLogged && <p className="text-center text-xs text-emerald-600 font-semibold pt-3">✓ Already logged</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Floating AI Chat button ──────────────────────────────────────────────────
// Sits above the bottom nav so a member can log their whole day by chat from
// anywhere on the page without scrolling to a specific section.
function AIChatFab() {
  const openChat = useAIChat(s => s.openChat);
  const open     = useAIChat(s => s.open);
  if (open) return null; // hide while the chat itself is on screen
  return (
    <button
      onClick={openChat}
      aria-label="Log with AI Chat"
      className="fixed z-40 flex items-center justify-center bg-gradient-to-br from-[#7c5cfc] to-[#4c2fd8] shadow-[0_4px_20px_rgba(124,92,252,0.45)] border border-r-0 border-white/[0.15] active:scale-95 transition-transform"
      style={{
        right: 0,
        bottom: 'calc(120px + env(safe-area-inset-bottom))',
        width: 46, height: 52,
        borderTopLeftRadius: 16, borderBottomLeftRadius: 16,
        paddingRight: 2, fontSize: 20,
      }}>
      ✨
    </button>
  );
}

// ─── Main DailyLog Page ───────────────────────────────────────────────────────

export default function DailyLog() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { date, log, protocol, loading, saving, saved, error, setDate, updateLog, saveLog } = useLogStore();
  const openChat = useAIChat(s => s.openChat);

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

  const activeActivities  = allActivities.filter(a  => !protocol?.activities  || protocol.activities.includes(a.id));
  const activeACV         = allACV.filter(a         => !protocol?.acv         || protocol.acv.includes(a.id));
  const activeSupplements = allSupplements.filter(s => !protocol?.supplements || protocol.supplements.includes(s.id));

  usePush();
  useOfflineSync();

  useEffect(() => { setDate(today()); }, []);

  // Fetch yesterday's weight for trend delta shown after weight entry
  const [yesterdayWeight, setYesterdayWeight] = useState(null);
  useEffect(() => {
    const yDate = new Date();
    yDate.setDate(yDate.getDate() - 1);
    const yStr = yDate.toISOString().split('T')[0];
    api.get(`/logs/${yStr}`).then(({ data }) => {
      if (data?.weight_kg) setYesterdayWeight(parseFloat(data.weight_kg));
    }).catch(() => {});
  }, []);

  // Fetch coach notes + profile age once on mount
  const [coachNotes, setCoachNotes] = useState([]);
  const [profileAge, setProfileAge] = useState(null);

  // Only unread messages appear on Today; read ones live in the bell.
  const unreadNotes = coachNotes.filter(n => !n.read_at);

  const markNotesRead = useCallback(async (ids) => {
    if (!ids?.length) return;
    haptic(12);
    // Optimistic — the card disappears immediately, no waiting on the network
    setCoachNotes(prev => prev.map(n =>
      ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n
    ));
    try {
      await api.post('/patients/me/notes/read', { ids });
    } catch (err) {
      console.error('Failed to mark messages read:', err);
      // Roll back so the member doesn't silently lose a message
      setCoachNotes(prev => prev.map(n =>
        ids.includes(n.id) ? { ...n, read_at: null } : n
      ));
    }
  }, []);

  // Height + sex power the hero's energy-balance chip (see calcBMR below)
  const [bodyStats, setBodyStats] = useState({ height_cm: null, gender: null });

  useEffect(() => {
    getMyProfile().then(({ data }) => {
      if (data?.coach_notes?.length) setCoachNotes(data.coach_notes);
      if (data?.dob) {
        const diff = Date.now() - new Date(data.dob).getTime();
        setProfileAge(Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25)));
      }
      setBodyStats({
        height_cm: data?.height_cm ? parseFloat(data.height_cm) : null,
        gender:    data?.gender || null,
      });
    }).catch(() => {});
  }, []);

  // Milestone celebration — shown after save completes
  const [milestone, setMilestone] = useState(null); // { icon, title, body }
  const prevSaved = useRef(false);
  useEffect(() => {
    if (!prevSaved.current && saved && date === today()) {
      // ── Streak milestone ──────────────────────────────────────────────────
      const STREAK_KEY = 'fitlife_streak';
      const stored = (() => { try { return JSON.parse(localStorage.getItem(STREAK_KEY) || '{}'); } catch { return {}; } })();
      const yStr = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; })();
      const streak = stored.lastDate === yStr ? (stored.count || 0) + 1 : 1;
      localStorage.setItem(STREAK_KEY, JSON.stringify({ lastDate: today(), count: streak }));

      // ── Weight milestone ──────────────────────────────────────────────────
      const startW   = parseFloat(protocol?.start_weight);
      const currentW = parseFloat(log.weight);
      const lostKg   = startW && currentW ? +(startW - currentW).toFixed(1) : null;
      // Find the nearest completed whole-kg milestone (1, 2, 3…)
      const kgMilestone = lostKg != null && lostKg > 0 ? Math.floor(lostKg) : 0;
      const prevStored  = stored.lastKgMilestone || 0;

      if (kgMilestone > prevStored && kgMilestone >= 1) {
        localStorage.setItem(STREAK_KEY, JSON.stringify({ lastDate: today(), count: streak, lastKgMilestone: kgMilestone }));
        setMilestone({ icon: '🏆', title: `${kgMilestone} kg lost!`, body: `You've shed ${kgMilestone} kg since you started. That's real progress — keep going!` });
      } else if (streak === 7 || streak === 14 || streak === 21 || streak === 30) {
        setMilestone({ icon: '🔥', title: `${streak}-day streak!`, body: `${streak} days logged in a row. You're building an unstoppable habit!` });
      }
    }
    prevSaved.current = saved;
  }, [saved]);

  const terms = useTerms();
  const { nutritionView, ageMode, avatarIdx } = useSettingsStore();
  const AVATARS_LIST = ['🐶','🐱','🦊','🐻','🦁','🐼','🐸','🦋','🌟','🎈','🌈','🦄'];

  // ── Weight sanity check ───────────────────────────────────────────────────
  const [weightWarning, setWeightWarning] = useState('');
  const validateWeight = (val) => {
    const w = parseFloat(val);
    const minW = ageMode === 'child' ? 15 : 30;
    const maxW = ageMode === 'child' ? 100 : 250;
    if (val && !isNaN(w) && (w < minW || w > maxW)) {
      setWeightWarning(`${w} kg looks unusual — are you sure? (Expected ${minW}–${maxW} kg)`);
    } else { setWeightWarning(''); }
  };

  // ── Auto-save (4-second debounce) ─────────────────────────────────────────
  // Every field writes through here — this is now the ONLY save path (no more
  // manual "Save Today's Log" button). 4s feels instant in practice while
  // still coalescing rapid edits (e.g. dragging the water slider) into one
  // request instead of firing on every pixel of movement.
  const autoSaveRef = useRef(null);
  const swipeRef = useRef(null);
  const [autoSaved, setAutoSaved] = useState(false);

  // ── Premium hero state ─────────────────────────────────────────────────────
  const [heroPanel, setHeroPanel] = useState(null);   // 'weight'|'food'|'protocol'|'water'|'workout'|'sleep'
  const [workoutSummary, setWorkoutSummary] = useState({ count: 0, duration: null, sets: [], cardio: [] });
  // Bumped whenever the AI chat closes, so WorkoutLog remounts and picks up
  // anything the AI just wrote (otherwise an open panel shows stale data).
  const [workoutRefreshKey, setWorkoutRefreshKey] = useState(0);
  const chatOpen = useAIChat(s => s.open);
  const prevChatOpen = useRef(chatOpen);
  useEffect(() => {
    if (prevChatOpen.current && !chatOpen) setWorkoutRefreshKey(k => k + 1);
    prevChatOpen.current = chatOpen;
  }, [chatOpen]);

  // Workout tile summary — refreshed when the date changes or the panel closes
  useEffect(() => {
    let cancelled = false;
    api.get('/workouts', { params: { date } })
      .then(({ data }) => {
        if (cancelled) return;
        setWorkoutSummary({
          count: (data?.exercises || []).length,
          duration: data?.session?.duration_min || null,
          // Raw sets + cardio feed the shared calorie model (volume-based for
          // strength, MET × time for cardio)
          sets: (data?.exercises || []).flatMap(ex => ex.sets || []),
          cardio: Array.isArray(data?.cardio) ? data.cardio : [],
        });
      })
      .catch(() => { if (!cancelled) setWorkoutSummary({ count: 0, duration: null, sets: [], cardio: [] }); });
    return () => { cancelled = true; };
  }, [date, heroPanel, workoutRefreshKey]);
  const [streak, setStreak] = useState(0);
  const [chipInfo, setChipInfo] = useState(null);   // { label, sub } — long-press popover
  const chipPressRef = useRef(null);

  // Logging streak: consecutive saved days ending today or yesterday
  useEffect(() => {
    const from = new Date(); from.setDate(from.getDate() - 14);
    const fStr = `${from.getFullYear()}-${String(from.getMonth()+1).padStart(2,'0')}-${String(from.getDate()).padStart(2,'0')}`;
    api.get(`/logs/range/${fStr}/${today()}`).then(({ data }) => {
      const logged = new Set((data || []).map(l => (l.log_date || '').slice(0, 10)));
      let s = 0;
      const d = new Date();
      // A streak may end yesterday if today isn't logged yet
      if (!logged.has(today())) d.setDate(d.getDate() - 1);
      for (let i = 0; i < 14; i++) {
        const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (!logged.has(ds)) break;
        s++; d.setDate(d.getDate() - 1);
      }
      setStreak(s);
    }).catch(() => {});
  }, []);

  // Long-press on a protocol chip shows its timing/instructions
  const chipPressStart = useCallback((item) => {
    clearTimeout(chipPressRef.current);
    chipPressRef.current = setTimeout(() => {
      if (item.sub) { setChipInfo({ label: item.label, sub: item.sub }); haptic(20); }
    }, 420);
  }, []);
  const chipPressEnd = useCallback(() => clearTimeout(chipPressRef.current), []);
  useEffect(() => {
    if (!chipInfo) return;
    const t = setTimeout(() => setChipInfo(null), 3000);
    return () => clearTimeout(t);
  }, [chipInfo]);

  const triggerAutoSave = useCallback(() => {
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(async () => {
      if (date === today()) {
        try { await saveLog(); setAutoSaved(true); setTimeout(() => setAutoSaved(false), 2500); } catch {}
      }
    }, 4000);
  }, [saveLog, date]);

  // Safety net: if the debounce hasn't fired yet and the user navigates away,
  // switches tabs, or closes the app, flush an immediate save so the last few
  // seconds of edits aren't silently lost.
  useEffect(() => {
    const flush = () => {
      if (autoSaveRef.current && date === today()) {
        clearTimeout(autoSaveRef.current);
        saveLog().catch(() => {});
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [saveLog, date]);

  const compliance = calcCompliance(log, activeActivities, activeACV, activeSupplements);
  const actDone    = activeActivities.filter(a => log.activities?.[a.id]).length;
  const acvDone    = activeACV.filter(a => log.acv?.[a.id]).length;
  const suppDone   = activeSupplements.filter(s => log.supplements?.[s.id]).length;
  const update     = useCallback((field, val) => { updateLog(field, val); triggerAutoSave(); }, [updateLog, triggerAutoSave]);

  // ── ACV expand state ───────────────────────────────────────────────────────
  const [acvExpanded, setAcvExpanded] = useState(false);
  const [complianceTip, setComplianceTip] = useState(false);

  // Sprint 3: pre-fill food log from prescribed meal — MUST be after `update`
  const logMeal = useCallback((meal) => {
    const newItems = (meal.items||[]).map(item => ({
      id:       Date.now() + Math.random(),
      name:     item.food_name,
      grams:    item.qty_g,
      meal:     meal.name,
      food_id:  item.food_id  || null,
      per_100g: item.per_100g || null,
    }));
    const existing = log.food || [];
    // Only skip items already in THIS meal slot — same food can appear in multiple meals
    const existingInMeal = existing
      .filter(f => f.meal === meal.name)
      .map(f => f.name?.toLowerCase());
    const toAdd = newItems.filter(i => !existingInMeal.includes(i.name?.toLowerCase()));
    update('food', [...existing, ...toAdd]);
  }, [log.food, update]);

  return (
    <div className="min-h-screen bg-[#0b0b0e] font-sans">
      <OfflineBanner />

      {/* ── Hero — greeting, date, compliance, glance stats, weight editor ── */}
      <div className="bg-gradient-to-br from-[#0d0b18] to-[#07060f] text-white px-4 pt-10 pb-5">
        <div className="max-w-md mx-auto" id="section-hero">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-bold tracking-widest uppercase text-[#a78bfa] mb-1.5">FitLife</p>
              <h1 className="font-display text-2xl font-medium flex items-center gap-2 leading-tight">
                <span>{AVATARS_LIST[avatarIdx]}</span>
                {(() => {
                  const h = new Date().getHours();
                  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
                  return `${greet}, ${user?.name?.split(' ')[0] || ''}`;
                })()}
              </h1>
              {autoSaved && (
                <p className="text-xs text-[#a78bfa] mt-1 font-medium"><span className="autosave-dot" />auto-saved ✓</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {streak >= 2 && (
                <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/25 rounded-full px-2.5 py-1">
                  🔥 {streak}-day streak
                </span>
              )}
              <NotificationBell />
            </div>
          </div>

          {/* Compact date nav */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => {
                const d = new Date(date + 'T12:00:00');
                d.setDate(d.getDate() - 1);
                setDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
              }}
              style={{ minWidth: 44, minHeight: 36 }}
              className="text-sm font-bold text-[#4e4e5c] rounded-xl hover:bg-white/[0.05] active:scale-95 transition-all">‹</button>
            <div className="text-center">
              <p className="text-sm font-bold text-[#d8d8de]">{date === today() ? 'Today' : formatDate(date)}</p>
              {date !== today() && <p className="text-[10px] text-amber-400 font-medium">Editing past entry</p>}
            </div>
            <button
              onClick={() => setDate(today())}
              disabled={date === today()}
              style={{ minWidth: 44, minHeight: 36 }}
              className="text-sm font-bold text-[#8b5cf6] rounded-xl hover:bg-[rgba(124,92,252,0.05)] active:scale-95 transition-all disabled:opacity-30">›</button>
          </div>

          <div className="bg-white/[0.05] rounded-2xl p-3.5 border border-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            {/* Compliance strip — ring + summary on one line, so tiles get full width */}
            <div className="flex items-center gap-3 mb-3">
              <div className="relative flex-shrink-0">
                <ComplianceRing pct={compliance} />
                <button onClick={() => setComplianceTip(v => !v)}
                  style={{ position: 'absolute', top: -4, right: -4, width: 17, height: 17, borderRadius: 9, background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', fontSize: 9, cursor: 'pointer', fontWeight: 700 }}>?</button>
                {complianceTip && (
                  <div style={{ position: 'absolute', left: 0, top: 64, zIndex: 50, background: '#1a1a20', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, padding: '10px 14px', fontSize: 12, color: '#d8d8de', lineHeight: 1.5, width: 210, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
                    This shows what % of today's {terms.activities}, ACV doses, and {terms.supplements} you've completed.
                    <button onClick={() => setComplianceTip(false)} style={{ display: 'block', marginTop: 8, fontSize: 11, color: '#7c5cfc', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Got it ✓</button>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#ededf0] leading-tight">
                  {actDone + acvDone + suppDone} of {activeActivities.length + activeACV.length + activeSupplements.length} done today
                </p>
                {(() => {
                  const weightKg = parseFloat(log.weight) || parseFloat(protocol?.start_weight) || 0;
                  const bmr = calcBMR({
                    weightKg,
                    heightCm: bodyStats.height_cm,
                    age: profileAge,
                    gender: bodyStats.gender,
                  });
                  const kcalIn = (log.food || []).reduce((sum, it) => {
                    if (it.per_100g?.calories) return sum + Math.round(it.per_100g.calories * (it.grams || 0) / 100);
                    const n = getNutrition(it.name, it.grams); return sum + (n?.cal || 0);
                  }, 0);

                  // Needs BMR inputs and at least some food logged, else the
                  // "deficit" would just be the whole day's TDEE and mislead.
                  if (!bmr || kcalIn === 0) {
                    return <p className="text-[11px] text-[#8e8e9a] mt-0.5">Tap any tile below to open it</p>;
                  }

                  // Exercise calories come exclusively from the Workout log —
                  // strength by volume lifted, cardio by MET × time. Protocol
                  // ticks are compliance only; counting both double-billed the
                  // same walk or gym session.
                  const work = sessionEnergy({
                    exercises: [{ sets: workoutSummary.sets || [] }],
                    cardio:    workoutSummary.cardio || [],
                    bodyWeightKg: weightKg,
                  });
                  const workoutBurn = work.totalKcal;
                  const burned = 0;
                  const out = Math.round(bmr * 1.2) + burned + workoutBurn;
                  const balance = kcalIn - out;
                  const surplus = balance > 0;

                  return (
                    <button onClick={() => { setHeroPanel(p => (p === 'food' ? null : 'food')); haptic(10); }}
                      className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border transition-all active:scale-95 ${
                        surplus
                          ? 'bg-amber-400/10 border-amber-400/30'
                          : 'bg-emerald-400/10 border-emerald-400/30'
                      }`}>
                      <span className={`text-[11px] font-extrabold ${surplus ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {surplus ? '↑' : '↓'} {surplus ? '+' : '−'}{Math.abs(balance).toLocaleString()} kcal
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#8e8e9a]">
                        {surplus ? 'surplus' : 'deficit'}
                      </span>
                    </button>
                  );
                })()}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                {(() => {
                  const tileBase = 'text-left border rounded-2xl px-3 py-2.5 transition-all active:scale-[0.98] flex items-center justify-between gap-2';
                  const on  = 'bg-[rgba(124,92,252,0.14)] border-[rgba(124,92,252,0.45)]';
                  const off = 'bg-white/[0.04] border-white/[0.07]';
                  const toggle = (key) => { setHeroPanel(p => (p === key ? null : key)); haptic(10); };

                  const kcal = (log.food || []).reduce((s, it) => {
                    if (it.per_100g?.calories) return s + Math.round(it.per_100g.calories * (it.grams || 0) / 100);
                    const n = getNutrition(it.name, it.grams); return s + (n?.cal || 0);
                  }, 0);

                  // Calories burned today — strength volume + cardio, from the
                  // Workout log (protocol ticks are compliance only).
                  const workoutKcal = sessionEnergy({
                    exercises: [{ sets: workoutSummary.sets || [] }],
                    cardio:    workoutSummary.cardio || [],
                    bodyWeightKg: parseFloat(log.weight) || parseFloat(protocol?.start_weight) || 0,
                  }).totalKcal;

                  const bt = log.sleep?.bedtime, wt = log.sleep?.waketime;
                  let sleepDur = '';
                  if (bt && wt) {
                    const [bh, bm] = bt.split(':').map(Number);
                    const [wh, wm] = wt.split(':').map(Number);
                    let mins = (wh * 60 + wm) - (bh * 60 + bm);
                    if (mins <= 0) mins += 24 * 60;
                    sleepDur = `${Math.floor(mins / 60)}h ${mins % 60}m`;
                  }

                  return (
                    <>
                      {/* Weight → inline editor */}
                      <button onClick={() => toggle('weight')}
                        className={`${tileBase} ${heroPanel === 'weight' ? on : off}`}>
                        <div className="min-w-0">
                          <span className="block text-[17px] font-extrabold leading-tight">{log.weight ? `${log.weight} kg` : '— kg'}</span>
                        <span className="block text-[10px] font-bold tracking-wider text-[#8e8e9a] uppercase mt-0.5">
                          ⚖ {(() => {
                            if (!log.weight) return 'Tap to log';
                            if (yesterdayWeight == null) return 'Logged';
                            const d = parseFloat(log.weight) - yesterdayWeight;
                            return d < 0 ? `↓ ${Math.abs(d).toFixed(1)} vs yest` : d > 0 ? `↑ ${d.toFixed(1)} vs yest` : '= yesterday';
                          })()}
                        </span>
                        </div>
                        <span className="text-[#4e4e5c] text-sm flex-shrink-0">›</span>
                      </button>

                      {/* Food → opens the food log panel */}
                      <button onClick={() => toggle('food')}
                        className={`${tileBase} ${heroPanel === 'food' ? on : off}`}>
                        <div className="min-w-0">
                          <span className="block text-[17px] font-extrabold leading-tight">
                          {protocol?.macros?.kcal
                            ? <>{kcal}<span className="text-[11px] text-[#4e4e5c]"> /{protocol.macros.kcal}</span></>
                            : kcal}
                        </span>
                        <span className="block text-[10px] font-bold tracking-wider text-[#8e8e9a] uppercase mt-0.5">🔥 kcal eaten</span>
                        </div>
                        <span className="text-[#4e4e5c] text-sm flex-shrink-0">›</span>
                      </button>

                      {/* Protocol → opens the protocol panel */}
                      <button onClick={() => toggle('protocol')}
                        className={`${tileBase} ${heroPanel === 'protocol' ? on : off}`}>
                        <div className="min-w-0">
                          <span className="block text-[17px] font-extrabold leading-tight">{actDone + acvDone + suppDone} / {activeActivities.length + activeACV.length + activeSupplements.length}</span>
                        <span className="block text-[10px] font-bold tracking-wider text-[#8e8e9a] uppercase mt-0.5">✓ protocol</span>
                        </div>
                        <span className="text-[#4e4e5c] text-sm flex-shrink-0">›</span>
                      </button>

                      {/* Water → inline quick-add */}
                      <button onClick={() => toggle('water')}
                        className={`${tileBase} ${heroPanel === 'water' ? on : off}`}>
                        <div className="min-w-0">
                          <span className="block text-[17px] font-extrabold leading-tight">{((log.water || 0) / 1000).toFixed(1)} L</span>
                        <span className="block text-[10px] font-bold tracking-wider text-[#8e8e9a] uppercase mt-0.5">💧 of {((protocol?.water_target || 3000) / 1000).toFixed(1)}L</span>
                        </div>
                        <span className="text-[#4e4e5c] text-sm flex-shrink-0">›</span>
                      </button>

                      {/* Workout → opens the workout panel */}
                      <button onClick={() => toggle('workout')}
                        className={`${tileBase} ${heroPanel === 'workout' ? on : off}`}>
                        <div className="min-w-0">
                          <span className="block text-[17px] font-extrabold leading-tight">
                          {workoutKcal > 0
                            ? <>{workoutKcal}<span className="text-[11px] text-[#4e4e5c]"> kcal</span></>
                            : <span className="text-[#4e4e5c]">— none</span>}
                        </span>
                        <span className="block text-[10px] font-bold tracking-wider text-[#8e8e9a] uppercase mt-0.5">
                          🏋️ {workoutKcal > 0 ? 'burned' : 'workout'}
                        </span>
                        </div>
                        <span className="text-[#4e4e5c] text-sm flex-shrink-0">›</span>
                      </button>

                      {/* Sleep → inline time pickers (full width) */}
                      <button onClick={() => toggle('sleep')}
                        className={`${tileBase} ${heroPanel === 'sleep' ? on : off}`}>
                        <div className="min-w-0">
                          <span className="block text-[17px] font-extrabold leading-tight">
                          {sleepDur || <span className="text-[#4e4e5c]">— set times</span>}
                          {sleepDur && <span className="text-[11px] text-[#4e4e5c] font-semibold"> · {bt} → {wt}</span>}
                        </span>
                        <span className="block text-[10px] font-bold tracking-wider text-[#8e8e9a] uppercase mt-0.5">🌙 {terms.sleep}</span>
                        </div>
                        <span className="text-[#4e4e5c] text-sm flex-shrink-0">›</span>
                      </button>
                    </>
                  );
                })()}
              </div>

            {/* ── Inline panels — open from the stat tiles above ── */}
            {heroPanel === 'weight' && (
              <div className="mt-3 pt-3 border-t border-white/[0.07]">
                <p className="text-[10px] text-[#4e4e5c] mb-2 font-medium">⚖ Morning weight — after washroom, before food</p>
                <div className="flex items-center gap-3">
                  <input type="number" step="0.1" inputMode="decimal" value={log.weight} placeholder="e.g. 92.5" autoFocus
                    onChange={e => { update('weight', e.target.value); validateWeight(e.target.value); }}
                    style={{ minHeight: 48, fontSize: 20 }}
                    className="flex-1 font-bold text-center border-2 border-white/[0.15] rounded-2xl py-2 focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.3)] text-[#ededf0] bg-[#1a1a20]" />
                  <span className="text-[#4e4e5c] font-bold">kg</span>
                  <button onClick={() => setHeroPanel(null)}
                    style={{ minHeight: 48 }}
                    className="px-4 rounded-2xl bg-[#7c5cfc] text-white text-sm font-bold active:scale-95 transition-transform">Done</button>
                </div>
                {weightWarning && (
                  <div className="mt-2 flex items-start gap-2 bg-amber-400/10 border border-amber-400/20 rounded-xl px-3 py-2">
                    <span className="text-amber-400 text-sm">⚠️</span>
                    <p className="text-xs text-amber-400 leading-relaxed">{weightWarning}</p>
                  </div>
                )}
              </div>
            )}

            {heroPanel === 'water' && (
              <div className="mt-3 pt-3 border-t border-white/[0.07]" id="section-water">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-[#4e4e5c] font-medium">
                    💧 Target {((protocol?.water_target || 3000) / 1000).toFixed(1)}L · stop 1 hr before sleep · not during meals
                  </p>
                  <button onClick={() => setHeroPanel(null)} className="text-[10px] font-bold text-[#7c5cfc]">Done</button>
                </div>
                <p className="text-2xl font-extrabold text-[#ededf0] mb-1">
                  {((log.water || 0) / 1000).toFixed(2)}
                  <span className="text-xs text-[#4e4e5c] font-bold"> / {((protocol?.water_target || 3000) / 1000).toFixed(1)}L</span>
                  <span className="text-[10px] text-[#4e4e5c] font-semibold float-right mt-2">
                    {Math.round((log.water || 0) / 250)} glasses
                  </span>
                </p>
                <div className="h-2 rounded-full bg-white/[0.07] overflow-hidden mb-2.5">
                  <div className="h-full rounded-full bg-blue-400 transition-all"
                    style={{ width: `${Math.min(100, ((log.water || 0) / (protocol?.water_target || 3000)) * 100)}%` }} />
                </div>
                <div className="flex gap-1.5">
                  {[250, 500, 750, 1000].map(ml => (
                    <button key={ml}
                      onClick={() => { update('water', Math.min(10000, (log.water || 0) + ml)); haptic(12); }}
                      style={{ minHeight: 44 }}
                      className="flex-1 text-[11px] font-bold text-blue-300 bg-blue-400/[0.08] border border-blue-400/25 rounded-xl active:scale-95 transition-transform">
                      +{ml >= 1000 ? '1L' : ml}
                    </button>
                  ))}
                </div>
                {(log.water || 0) > 0 && (
                  <button onClick={() => { update('water', Math.max(0, (log.water || 0) - 250)); haptic(10); }}
                    style={{ minHeight: 38 }}
                    className="w-full mt-1.5 text-[10px] font-bold text-[#4e4e5c] hover:text-red-400 rounded-xl border border-white/[0.06] transition-colors">
                    − Remove 250ml
                  </button>
                )}
              </div>
            )}

            {heroPanel === 'sleep' && (
              <div className="mt-3 pt-3 border-t border-white/[0.07]" id="section-sleep">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-[#4e4e5c] font-medium">🌙 Target 10:00 PM → 6:30 AM (8 hrs)</p>
                  <button onClick={() => setHeroPanel(null)} className="text-[10px] font-bold text-[#7c5cfc]">Done</button>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <label className="block text-[9px] font-bold text-[#4e4e5c] uppercase tracking-wider mb-1">Bedtime</label>
                    <input type="time" value={log.sleep?.bedtime || ''}
                      onChange={e => update('sleep', { ...log.sleep, bedtime: e.target.value })}
                      style={{ minHeight: 46 }}
                      className="w-full text-sm font-bold bg-[#1a1a20] border border-white/[0.12] rounded-xl px-2 text-[#ededf0] focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.3)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-[9px] font-bold text-[#4e4e5c] uppercase tracking-wider mb-1">Wake time</label>
                    <input type="time" value={log.sleep?.waketime || ''}
                      onChange={e => update('sleep', { ...log.sleep, waketime: e.target.value })}
                      style={{ minHeight: 46 }}
                      className="w-full text-sm font-bold bg-[#1a1a20] border border-white/[0.12] rounded-xl px-2 text-[#ededf0] focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.3)]" />
                  </div>
                </div>
                {log.sleep?.bedtime && log.sleep?.waketime && (() => {
                  const [bh, bm] = log.sleep.bedtime.split(':').map(Number);
                  const [wh, wm] = log.sleep.waketime.split(':').map(Number);
                  let mins = (wh * 60 + wm) - (bh * 60 + bm);
                  if (mins <= 0) mins += 24 * 60;
                  const hrs = mins / 60;
                  return (
                    <div className={`mt-2 text-center text-[11px] font-bold py-2 rounded-xl ${
                      hrs >= 7 && hrs <= 9 ? 'bg-emerald-400/10 text-emerald-300'
                      : hrs < 6 ? 'bg-amber-400/10 text-amber-300'
                      : 'bg-white/[0.04] text-[#8e8e9a]'}`}>
                      {Math.floor(mins / 60)}h {mins % 60}m
                      {hrs >= 7 && hrs <= 9 ? ' — great sleep 🌙' : hrs < 6 ? ' — try for 7+ hours' : ''}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div ref={swipeRef} className="max-w-md mx-auto px-4 space-y-3 pb-24 pt-3 swipe-hint">


        {['protocol', 'food', 'workout'].includes(heroPanel) && !loading && (
          <button onClick={() => { setHeroPanel(null); haptic(10); }}
            style={{ minHeight: 40 }}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] font-bold text-[#8e8e9a] hover:text-white bg-white/[0.03] border border-white/[0.07] rounded-xl transition-colors">
            ▲ Close {heroPanel === 'protocol' ? 'protocol' : heroPanel === 'food' ? 'food log' : 'workout'}
          </button>
        )}

        {/* ── Section panels — open from the hero tiles above ── */}
        {heroPanel === 'protocol' && !loading && (
          <div>
            {/* ── Today's Protocol — activities, ACV, supplements as tap-chips ── */}
            <Card>
              <div id="section-protocol">
                {(() => {
                  // Protocol is a compliance checklist — calories live in the
                  // Workout log, so no kcal badges here.
                  const totalDone  = actDone + acvDone + suppDone;
                  const totalItems = activeActivities.length + activeACV.length + activeSupplements.length;

                  const Chip = ({ item, checked, onToggle }) => (
                    <button
                      onClick={() => { onToggle(!checked); haptic(12); }}
                      onTouchStart={() => chipPressStart(item)}
                      onTouchEnd={chipPressEnd}
                      onTouchMove={chipPressEnd}
                      onContextMenu={e => { e.preventDefault(); if (item.sub) setChipInfo({ label: item.label, sub: item.sub }); }}
                      title={item.sub || ''}
                      style={{ minHeight: 38 }}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition-all active:scale-95 ${
                        checked
                          ? 'bg-[rgba(124,92,252,0.16)] border-[rgba(124,92,252,0.5)] text-white'
                          : 'bg-white/[0.03] border-white/[0.12] text-[#8e8e9a]'
                      }`}>
                      <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-extrabold flex-shrink-0 ${
                        checked ? 'bg-[#7c5cfc] text-white' : 'bg-white/[0.08] text-transparent'
                      }`}>✓</span>
                      {item.icon ? `${item.icon} ` : ''}{item.label}

                    </button>
                  );

                  return (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <SectionTitle icon="🏃">Today's Protocol</SectionTitle>
                        <span className="text-xs font-bold text-[#a78bfa]">{totalDone} of {totalItems} done</span>
                      </div>
                      <p className="text-[10px] text-[#4e4e5c] mb-3">Tap to mark done · long-press for timing details</p>

                      {activeActivities.length > 0 && (
                        <div className="mb-3.5">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-extrabold tracking-[0.12em] text-[#4e4e5c] uppercase">🏃 {terms.activities} · {actDone}/{activeActivities.length}</span>

                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {activeActivities.map(a => (
                              <Chip key={a.id} item={a}
                                checked={!!log.activities?.[a.id]}
                                onToggle={v => update('activities', { ...log.activities, [a.id]: v })} />
                            ))}
                          </div>
                        </div>
                      )}

                      {activeACV.length > 0 && (
                        <div className="mb-3.5">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-extrabold tracking-[0.12em] text-[#4e4e5c] uppercase">🍶 ACV · {acvDone}/{activeACV.length}</span>
                            <button onClick={() => setAcvExpanded(v => !v)}
                              className="text-[10px] text-[#7c5cfc] font-bold">{acvExpanded ? 'Hide' : '?'}</button>
                          </div>
                          {acvExpanded && (
                            <div className="mb-2 bg-[rgba(124,92,252,0.08)] border border-[rgba(124,92,252,0.15)] rounded-xl px-3 py-2.5 text-xs text-[#8e8e9a] leading-relaxed">
                              <strong className="text-[#c4b5fd]">Why ACV?</strong> 1 tbsp in 200ml warm water, through a straw, 15 min before meals — helps stabilise blood sugar, supports digestion, and may reduce appetite.
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1.5">
                            {activeACV.map(a => (
                              <Chip key={a.id} item={a}
                                checked={!!log.acv?.[a.id]}
                                onToggle={v => update('acv', { ...log.acv, [a.id]: v })} />
                            ))}
                          </div>
                        </div>
                      )}

                      {activeSupplements.length > 0 && (
                        <div>
                          <div className="mb-2">
                            <SectionTitle icon="💊"
                              tooltip="These supplements are prescribed by your coach. They are not medical advice — always check with your doctor if you take other medications.">
                              <span className="text-[9px] font-extrabold tracking-[0.12em] text-[#4e4e5c] uppercase">{terms.supplements} · {suppDone}/{activeSupplements.length}</span>
                            </SectionTitle>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {activeSupplements.map(s => (
                              <Chip key={s.id} item={s}
                                checked={!!log.supplements?.[s.id]}
                                onToggle={v => update('supplements', { ...log.supplements, [s.id]: v })} />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </Card>
          </div>
        )}

        {heroPanel === 'food' && !loading && (
          <div className="space-y-3">
            {/* Sprint 3: Prescribed meals */}
            {protocol?.meal_plan?.length > 0 && (
              <PrescribedMeals mealPlan={protocol.meal_plan} foodItems={log.food} onLogMeal={logMeal} />
            )}

            {/* Food log */}
            <Card>
              <div id="section-food">
                <SectionTitle icon="🥗">Food log</SectionTitle>
                <p className="text-xs text-[#4e4e5c] mb-3">Enter weight before cooking · tap mic for voice input</p>
                <FoodLog items={log.food} onChange={v => update('food', v)} calorieTarget={protocol?.macros?.kcal} />
              </div>
            </Card>

            {/* Sprint 5: Nutrition summary (3 tabs) — always shows when food has micro data */}
            <NutritionSummary
              foodItems={log.food || []}
              supplements={log.supplements || {}}
              activeActivities={activeActivities}
              activities={log.activities || {}}
              rdaOverrides={protocol?.rda_overrides || {}}
            />
          </div>
        )}

        {heroPanel === 'workout' && !loading && (
          <div>
            {/* Resistance training */}
            <div id="section-workout">
              <WorkoutLog key={`${date}-${workoutRefreshKey}`} date={date} />
            </div>
          </div>
        )}

        {/* AI logging bar — the primary way to fill the day */}
        <button onClick={() => { haptic(15); openChat(); }}
          style={{ minHeight: 52 }}
          className="w-full flex items-center gap-3 bg-gradient-to-r from-[#7c5cfc]/[0.16] to-[#4c2fd8]/[0.08] border border-[#7c5cfc]/40 hover:border-[#7c5cfc]/60 rounded-2xl px-4 py-3 transition-all active:scale-[0.99] shadow-[0_0_24px_rgba(124,92,252,0.10)]">
          <span className="w-8 h-8 rounded-full bg-gradient-to-br from-[#7c5cfc] to-[#4c2fd8] flex items-center justify-center text-sm flex-shrink-0 shadow-[0_0_14px_rgba(124,92,252,0.5)]">✨</span>
          <span className="text-sm text-[#8e8e9a] font-medium flex-1 text-left">Tell me about your day…</span>
          <span className="text-[#a78bfa]">🎤</span>
        </button>

        {/* Hint when nothing is open — keeps the page from feeling empty */}
        {!heroPanel && !loading && (
          <p className="text-center text-[11px] text-[#4e4e5c] py-1">
            Tap a tile above to open it · or tell the AI your whole day
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* New member welcome card — shown when coach hasn't set a protocol yet */}
            {!protocol && (
              <Card>
                <div className="text-center py-4">
                  <div className="text-4xl mb-3">👋</div>
                  <h2 className="font-bold text-stone-800 text-base mb-1">Welcome to FitLife!</h2>
                  <p className="text-sm text-stone-500 leading-relaxed">
                    Your coach will set up your personalised protocol shortly — activities, supplements, macros, and water target will all appear here.
                  </p>
                  <p className="text-xs text-stone-400 mt-3">
                    You can already start logging your weight, food, and water below.
                  </p>
                </div>
              </Card>
            )}

            {/* Coach messages — only UNREAD show here; once read they move to
                the notification bell's message history so Today stays clean. */}
            {unreadNotes.length > 0 && (
              <Card>
                <div className="flex items-center justify-between mb-2">
                  <SectionTitle icon="💬">
                    {unreadNotes.length > 1 ? `${unreadNotes.length} new messages` : 'Message from your coach'}
                  </SectionTitle>
                  {unreadNotes.length > 1 && (
                    <button onClick={() => markNotesRead(unreadNotes.map(n => n.id))}
                      className="text-[11px] font-bold text-[#7c5cfc] hover:underline">
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {unreadNotes.slice(0, 3).map(n => (
                    <div key={n.id} className={`rounded-2xl px-4 py-3 border ${
                      n.flagged ? 'bg-amber-500/[0.06] border-amber-500/20' : 'bg-[#1a1a20] border-white/[0.07]'
                    }`}>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {n.flagged && (
                          <span className="text-[10px] font-bold text-amber-300 bg-amber-400/10 border border-amber-400/25 px-2 py-0.5 rounded-full">
                            ⚠ Action needed
                          </span>
                        )}
                        <span className="text-[11px] text-[#8e8e9a]">
                          {n.monitor_name} · {new Date(n.note_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                      <p className="text-sm text-[#d8d8de] leading-relaxed whitespace-pre-wrap">{n.note}</p>
                      <button onClick={() => markNotesRead([n.id])}
                        style={{ minHeight: 36 }}
                        className="mt-2 w-full text-[11px] font-bold text-[#a78bfa] bg-[rgba(124,92,252,0.10)] border border-[rgba(124,92,252,0.25)] rounded-xl active:scale-[0.98] transition-transform">
                        Got it ✓
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-[#4e4e5c] mt-2 text-center">
                  Read messages stay in the 🔔 bell at the top
                </p>
              </Card>
            )}
            {protocol?.fasting && (() => {
              // Age guard: warn if user is under 18 or has diabetes-related conditions
              const isMinor = profileAge !== null && profileAge < 18;
              const hasRisk = ['pre_diabetic','insulin_resist','hypothyroid'].some(c => (protocol?.conditions || []).includes(c));
              if (isMinor || hasRisk) {
                return (
                  <div className="bg-amber-400/10 border border-amber-400/20 rounded-2xl px-4 py-3">
                    <p className="text-xs font-bold text-amber-400 mb-1">⚠️ Fasting protocol — check with doctor</p>
                    <p className="text-xs text-[#8e8e9a] leading-relaxed">
                      {isMinor ? 'Fasting is not recommended for people under 18.' : 'Your health conditions may require a modified fasting approach.'} Please confirm this protocol is approved by your doctor before following it.
                    </p>
                  </div>
                );
              }
              return <FastingBar fasting={protocol.fasting} />;
            })()}

            {protocol?.macros && (
              <MacroProgress
                workoutKcal={sessionEnergy({
                  exercises: [{ sets: workoutSummary.sets || [] }],
                  cardio:    workoutSummary.cardio || [],
                  bodyWeightKg: parseFloat(log.weight) || parseFloat(protocol?.start_weight) || 0,
                }).totalKcal}
                macros={protocol.macros}
                foodItems={log.food || []}
                supplements={log.supplements || {}}
                activeActivities={activeActivities}
                activities={log.activities || {}}
                overrides={protocol?.item_overrides || {}}
                weightKg={parseFloat(log.weight) || parseFloat(protocol?.start_weight) || 0}
              />
            )}


            {/* Long-press chip detail popover */}
            {chipInfo && (
              <div onClick={() => setChipInfo(null)}
                className="fixed left-4 right-4 z-[60] bg-[#1a1a20] border border-[rgba(124,92,252,0.4)] rounded-2xl px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.7)]"
                style={{ bottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
                <p className="text-sm font-bold text-white">{chipInfo.label}</p>
                <p className="text-xs text-[#8e8e9a] mt-0.5 leading-relaxed">{chipInfo.sub}</p>
              </div>
            )}



            {/* Notes */}
            <Card>
              <div id="section-notes" />
              <SectionTitle icon="📝">{terms.notes}</SectionTitle>
              <textarea value={log.notes} onChange={e => update('notes', e.target.value)}
                placeholder={ageMode === 'child' ? 'How did you feel today? What was fun?' : 'Symptoms, how you felt, energy levels, challenges…'} rows={3}
                className="w-full text-sm border border-white/[0.12] rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[rgba(124,92,252,0.3)] resize-none" />
            </Card>

            {error && <div className="bg-red-400/10 border border-red-400/20 text-red-400 text-sm rounded-xl px-4 py-3">{error}</div>}
          </>
        )}
      </div>

      <PatientBottomNav />

      {/* AI Chat — mounted once; opened from the FAB below or FoodLog banner */}
      <AIChatLog />

      {/* Floating AI logging button — reachable from anywhere on the page */}
      <AIChatFab />

      <InstallPrompt />

      {/* Milestone celebration overlay */}
      {milestone && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
          onClick={() => setMilestone(null)}>
          <div className="bg-[#131317] rounded-3xl border border-white/[0.08] p-8 max-w-xs w-full text-center shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="text-6xl mb-3">{milestone.icon}</div>
            <h2 className="text-xl font-bold text-[#ededf0] mb-2">{milestone.title}</h2>
            <p className="text-sm text-[#6a6a78] leading-relaxed mb-6">{milestone.body}</p>
            <button onClick={() => setMilestone(null)}
              className="w-full py-3 bg-[#7c5cfc] hover:bg-[#a78bfa] text-[#08052a] font-bold rounded-2xl transition-colors active:scale-95">
              Let's keep going! 💪
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
