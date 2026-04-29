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

function calcBurned(activities = {}, activeActivities = [], weightKg, overrides = {}) {
  if (!weightKg || weightKg <= 0) return { items: [], total: 0 };
  const items = [];
  let total = 0;
  activeActivities.forEach(act => {
    if (!activities[act.id]) return;
    const met = act.met || 3.0;
    let mins = act.durationMin || 30;
    const ov = overrides[act.id];
    if (ov?.totalTime) {
      const m = String(ov.totalTime).match(/(\d+)/);
      if (m) mins = parseInt(m[1]);
    }
    const kcal = Math.round(met * weightKg * (mins / 60));
    items.push({ id: act.id, label: act.label, kcal, mins });
    total += kcal;
  });
  return { items, total };
}

// Key nutrients for the quick summary badge inside MacroProgress
// Full detail is in the standalone NutritionSummary card below food log
const QUICK_MICRO_KEYS = ['fiber','omega3_epa','omega3_dha','vit_b12','vit_d','calcium','iron','magnesium','zinc','folate','potassium'];

// ─── Compliance Ring ──────────────────────────────────────────────────────────

function ComplianceRing({ pct }) {
  const r = 24, circ = 2 * Math.PI * r;
  return (
    <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="5" />
      <circle cx="28" cy="28" r={r} fill="none" stroke="#6ee7b7" strokeWidth="5"
        strokeDasharray={`${(pct/100)*circ} ${circ}`} strokeLinecap="round"
        className="transition-all duration-700" />
      <text x="28" y="28" dominantBaseline="middle" textAnchor="middle"
        fontSize="11" fontWeight="600" fill="white" transform="rotate(90 28 28)">
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

function MacroProgress({ macros, foodItems, supplements, activeActivities, activities, overrides, weightKg }) {
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

  const burn   = calcBurned(activities, activeActivities, weightKg, overrides);
  const netKcal = Math.round(totals.kcal) - burn.total;

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
      {burn.total > 0 && (
        <div className={`flex items-center justify-between text-xs px-3 py-2.5 rounded-xl mb-3 ${
          netKcal <= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
          <div className="flex gap-3">
            <span>🍽 Eaten <strong>{Math.round(totals.kcal)}</strong></span>
            <span>🔥 Burned <strong>{burn.total}</strong></span>
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

      {/* Activity burn breakdown */}
      {burn.items.length > 0 && (
        <div className="mt-3 pt-3 border-t border-stone-100 space-y-1">
          <p className="text-xs font-bold text-stone-400 uppercase tracking-wider">🔥 Calories Burned</p>
          {burn.items.map(item => (
            <div key={item.id} className="flex justify-between text-xs">
              <span className="text-stone-500">{item.label} ({item.mins} min)</span>
              <span className="font-bold text-orange-500">−{item.kcal} kcal</span>
            </div>
          ))}
          <div className="flex justify-between text-xs font-bold pt-1 border-t border-stone-100">
            <span className="text-stone-600">Total burned</span>
            <span className="text-orange-600">−{burn.total} kcal</span>
          </div>
        </div>
      )}

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
                  <p className="text-xs text-stone-400 mt-0.5">
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
                                         'bg-white border border-stone-100 hover:border-stone-200'}`}>
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

// ─── Main DailyLog Page ───────────────────────────────────────────────────────

export default function DailyLog() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { date, log, protocol, loading, saving, saved, error, setDate, updateLog, saveLog } = useLogStore();

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

  // Fetch coach notes once on mount
  const [coachNotes, setCoachNotes] = useState([]);
  useEffect(() => {
    getMyProfile().then(({ data }) => {
      if (data?.coach_notes?.length) setCoachNotes(data.coach_notes);
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

  const compliance = calcCompliance(log, activeActivities, activeACV, activeSupplements);
  const actDone    = activeActivities.filter(a => log.activities?.[a.id]).length;
  const acvDone    = activeACV.filter(a => log.acv?.[a.id]).length;
  const suppDone   = activeSupplements.filter(s => log.supplements?.[s.id]).length;
  const update     = useCallback(updateLog, [updateLog]);

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
            <div className="flex items-center gap-2">
              <button onClick={() => navigate('/profile')}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                title="My Profile">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </button>
              <button onClick={() => navigate('/progress')}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                title="My Progress">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </button>
              <button onClick={() => navigate('/settings')}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>
          <div className="bg-white/10 rounded-2xl p-3 flex items-center gap-4">
            <ComplianceRing pct={compliance} />
            <div className="flex-1">
              <div className="text-sm font-semibold">Today's Compliance</div>
              <div className="text-xs text-emerald-200 mt-0.5">
                {`${actDone}/${activeActivities.length}`} activities · {`${acvDone}/${activeACV.length}`} ACV · {`${suppDone}/${activeSupplements.length}`} supps
              </div>
              {log.weight && <div className="text-xs text-emerald-300 mt-1 font-medium">⚖ {log.weight} kg logged</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-md mx-auto px-4 space-y-3 pb-32 pt-4">

        {/* Date nav */}
        <Card>
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                const d = new Date(date + 'T00:00:00');
                d.setDate(d.getDate() - 1);
                setDate(d.toISOString().split('T')[0]);
              }}
              className="flex items-center gap-1 text-sm font-semibold text-stone-500 px-3 py-2 rounded-xl hover:bg-stone-100 active:scale-95 transition-all"
            >
              ← Yesterday
            </button>
            <div className="text-center">
              <p className="text-sm font-bold text-stone-700">
                {date === today() ? 'Today' : formatDate(date)}
              </p>
              {date !== today() && (
                <p className="text-xs text-amber-600 font-medium mt-0.5">Editing past entry</p>
              )}
            </div>
            <button
              onClick={() => setDate(today())}
              disabled={date === today()}
              className="flex items-center gap-1 text-sm font-semibold text-emerald-600 px-3 py-2 rounded-xl hover:bg-emerald-50 active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Today →
            </button>
          </div>
        </Card>

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

            {/* Coach notes visible to member — flagged ones show as "Action needed" */}
            {coachNotes.length > 0 && (
              <Card>
                <SectionTitle icon="💬">Message from your coach</SectionTitle>
                <div className="space-y-2 mt-2">
                  {coachNotes.slice(0, 3).map(n => (
                    <div key={n.id} className={`rounded-2xl px-4 py-3 border ${
                      n.flagged ? 'bg-amber-50 border-amber-200' : 'bg-stone-50 border-stone-100'
                    }`}>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {n.flagged && (
                          <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                            ⚠ Action needed
                          </span>
                        )}
                        <span className="text-xs text-stone-400">
                          {n.monitor_name} · {new Date(n.note_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                      <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">{n.note}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {protocol?.fasting && <FastingBar fasting={protocol.fasting} />}

            {protocol?.macros && (
              <MacroProgress
                macros={protocol.macros}
                foodItems={log.food || []}
                supplements={log.supplements || {}}
                activeActivities={activeActivities}
                activities={log.activities || {}}
                overrides={protocol?.item_overrides || {}}
                weightKg={parseFloat(log.weight) || parseFloat(protocol?.start_weight) || 0}
              />
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
              {log.weight && (() => {
                const delta = yesterdayWeight != null ? parseFloat(log.weight) - yesterdayWeight : null;
                return (
                  <div className="mt-3 space-y-2">
                    <div className="text-center text-xs font-semibold py-2 rounded-xl bg-emerald-50 text-emerald-700">
                      ✓ Weight logged — great job tracking!
                    </div>
                    {delta != null && (
                      <div className={`text-center text-xs font-semibold py-2 rounded-xl ${
                        delta < 0 ? 'bg-blue-50 text-blue-700' :
                        delta > 0 ? 'bg-amber-50 text-amber-700' : 'bg-stone-50 text-stone-500'
                      }`}>
                        {delta < 0
                          ? `↓ You're down ${Math.abs(delta).toFixed(1)} kg from yesterday! 🎉`
                          : delta > 0
                          ? `↑ Up ${delta.toFixed(1)} kg from yesterday.`
                          : `= Same as yesterday.`}
                      </div>
                    )}
                  </div>
                );
              })()}
            </Card>

            {/* Activities */}
            <Card>
              {(() => {
                const weightKg = parseFloat(log.weight) || parseFloat(protocol?.start_weight) || 0;
                const totalBurned = activeActivities.reduce((sum, a) => {
                  if (!log.activities?.[a.id] || !a.met || !weightKg) return sum;
                  const ov = (protocol?.item_overrides || {})[a.id];
                  let mins = a.durationMin || 30;
                  if (ov?.totalTime) { const m = String(ov.totalTime).match(/(\d+)/); if (m) mins = parseInt(m[1]); }
                  return sum + Math.round(a.met * weightKg * (mins / 60));
                }, 0);
                return (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <SectionTitle icon="🏃">Physical Activity</SectionTitle>
                      {totalBurned > 0 && (
                        <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full border border-orange-200">
                          🔥 {totalBurned} kcal burned
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {activeActivities.map(a => {
                        const isChecked = !!log.activities?.[a.id];
                        let burnKcal = 0;
                        if (a.met && weightKg > 0) {
                          const ov = (protocol?.item_overrides || {})[a.id];
                          let mins = a.durationMin || 30;
                          if (ov?.totalTime) { const m = String(ov.totalTime).match(/(\d+)/); if (m) mins = parseInt(m[1]); }
                          burnKcal = Math.round(a.met * weightKg * (mins / 60));
                        }
                        return (
                          <CheckRow key={a.id} label={a.label} sub={a.sub} icon={a.icon}
                            checked={isChecked}
                            burnKcal={burnKcal}
                            onChange={v => update('activities', { ...log.activities, [a.id]: v })} />
                        );
                      })}
                    </div>
                  </>
                );
              })()}
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

            {/* Sprint 3: Prescribed meals */}
            {protocol?.meal_plan?.length > 0 && (
              <PrescribedMeals mealPlan={protocol.meal_plan} foodItems={log.food} onLogMeal={logMeal} />
            )}

            {/* Food log */}
            <Card>
              <SectionTitle icon="🥗">Food Log</SectionTitle>
              <p className="text-xs text-stone-400 mb-3">Enter raw weight before cooking</p>
              <FoodLog items={log.food} onChange={v => update('food', v)} />
            </Card>

            {/* Sprint 5: Nutrition summary (3 tabs) — always shows when food has micro data */}
            <NutritionSummary
              foodItems={log.food || []}
              supplements={log.supplements || {}}
              activeActivities={activeActivities}
              activities={log.activities || {}}
              rdaOverrides={protocol?.rda_overrides || {}}
            />

            {/* Water */}
            <Card>
              <SectionTitle icon="💧">Water Intake</SectionTitle>
              {(() => {
                const targetL = ((protocol?.water_target || 3000) / 1000).toFixed(1);
                return (
                  <p className="text-xs text-stone-400 mb-3">Target {targetL}L · Stop 1 hr before sleep · Not during meals</p>
                );
              })()}
              <WaterTracker value={log.water} onChange={v => update('water', v)} target={protocol?.water_target || 3000} />
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

            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}
          </>
        )}
      </div>

      {/* Sticky save */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-stone-100 via-stone-100/90 to-transparent">
        <div className="max-w-md mx-auto">
          <button onClick={saveLog} disabled={saving || loading}
            className={`w-full py-4 rounded-2xl text-white font-bold text-base shadow-float transition-all duration-200 ${
              saved ? 'bg-emerald-400' : saving ? 'bg-emerald-500 opacity-80' : 'bg-emerald-600 hover:bg-emerald-700 active:scale-98'}`}>
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

      {/* Milestone celebration overlay */}
      {milestone && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
          onClick={() => setMilestone(null)}>
          <div className="bg-white rounded-3xl p-8 max-w-xs w-full text-center shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="text-6xl mb-3">{milestone.icon}</div>
            <h2 className="text-xl font-bold text-stone-800 mb-2">{milestone.title}</h2>
            <p className="text-sm text-stone-500 leading-relaxed mb-6">{milestone.body}</p>
            <button onClick={() => setMilestone(null)}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl transition-colors active:scale-95">
              Let's keep going! 💪
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
