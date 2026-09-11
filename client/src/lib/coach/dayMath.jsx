/**
 * lib/coach/dayMath.js — the coach view's per-day maths (Sprint 12b).
 *
 * These four lived at the top of pages/Monitor.jsx. They are moved here
 * verbatim so DayDetail and MemberCharts (split out of Monitor) and Monitor
 * itself share ONE definition. calcN / calcMicrosFromItems overlap with
 * lib/day's calcFoodMacros / calcMicros; unifying them is a separate, tested
 * step — moving is not the moment to change arithmetic.
 */
import { getNutrition } from '../../constants';

export function calcN(item) {
  if (!item) return null;
  if (item.per_100g) {
    const f = (item.grams || 0) / 100;
    const n = item.per_100g;
    return {
      cal:  Math.round((n.calories || 0) * f),
      pro:  +((n.protein    || 0) * f).toFixed(1),
      carb: +((n.net_carbs != null ? n.net_carbs : n.total_carbs || 0) * f).toFixed(1),
      fat:  +((n.fat        || 0) * f).toFixed(1),
    };
  }
  return getNutrition(item.name, item.grams);
}

// ── Compliance from a raw server log row ──────────────────────────────────────
export function calcMicrosFromItems(foodItems = [], supplements = {}) {
  const m = foodItems.reduce((acc, item) => {
    if (!item.per_100g) return acc;
    const f = item.grams / 100;
    const n = item.per_100g;
    const add = (k) => acc[k] + (n[k] || 0) * f;
    return {
      vit_a:add('vit_a'),vit_b1:add('vit_b1'),vit_b2:add('vit_b2'),vit_b3:add('vit_b3'),
      vit_b5:add('vit_b5'),vit_b6:add('vit_b6'),vit_b12:add('vit_b12'),vit_c:add('vit_c'),
      vit_d:add('vit_d'),vit_e:add('vit_e'),vit_k:add('vit_k'),folate:add('folate'),
      biotin:add('biotin'),choline:add('choline'),
      calcium:add('calcium'),iron:add('iron'),magnesium:add('magnesium'),
      phosphorus:add('phosphorus'),potassium:add('potassium'),sodium:add('sodium'),
      zinc:add('zinc'),copper:add('copper'),manganese:add('manganese'),selenium:add('selenium'),
      omega3_ala:add('omega3_ala'),omega3_epa:add('omega3_epa'),omega3_dha:add('omega3_dha'),
      omega6:add('omega6'),fiber:add('fiber'),lycopene:add('lycopene'),beta_glucan:add('beta_glucan'),
    };
  }, {
    vit_a:0,vit_b1:0,vit_b2:0,vit_b3:0,vit_b5:0,vit_b6:0,vit_b12:0,vit_c:0,vit_d:0,
    vit_e:0,vit_k:0,folate:0,biotin:0,choline:0,calcium:0,iron:0,magnesium:0,
    phosphorus:0,potassium:0,sodium:0,zinc:0,copper:0,manganese:0,selenium:0,
    omega3_ala:0,omega3_epa:0,omega3_dha:0,omega6:0,fiber:0,lycopene:0,beta_glucan:0,
  });

  // Add supplement contributions
  if (supplements?.b12)     m.vit_b12  += 1000;
  if (supplements?.d3)      m.vit_d    += 8571;
  if (supplements?.fishoil) { m.omega3_epa += 180; m.omega3_dha += 120; }
  if (supplements?.flax)    m.omega3_ala += 533;
  if (supplements?.multi)   {
    m.vit_b12+=2.4; m.vit_d+=600; m.vit_c+=90; m.calcium+=200;
    m.iron+=8; m.magnesium+=100; m.zinc+=8; m.folate+=400;
  }
  if (supplements?.yeast)   { m.vit_b12+=1.0; m.folate+=125; }
  return m;
}
export function rowCompliance(log) {
  if (!log) return 0;
  const a = Object.values(log.activities  || {}).filter(Boolean).length;
  const c = Object.values(log.acv         || {}).filter(Boolean).length;
  const s = Object.values(log.supplements || {}).filter(Boolean).length;
  return Math.round(((a + c + s) / 16) * 100);
}

// ── Custom chart tooltip ──────────────────────────────────────────────────────
export function WeightTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-white/[0.1] rounded-xl px-3 py-2 shadow-float text-xs">
      <p className="text-lo mb-0.5">{label}</p>
      <p className="font-bold text-gold-light">{payload[0].value} kg</p>
    </div>
  );
}

