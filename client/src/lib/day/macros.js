/**
 * lib/day/macros.js — the day's nutrition maths, in one place.
 *
 * These functions lived inside pages/DailyLog.jsx (2,100 lines) as private
 * helpers, which meant two things: nothing else could use them without
 * copying them, and nothing could test them without mounting the page.
 * Sprint 0 moved them here unchanged. `scripts/test-day-lib.js` pins their
 * behaviour with golden values taken from the page BEFORE the move.
 *
 * Every function is pure: same input, same output, no React, no store.
 */
import { getNutrition, RDA_TARGETS } from '../../constants';

/** Macros for a list of logged foods. Per-100g data wins; the static
 *  nutrition table is the fallback for foods logged before the food DB. */
export function calcFoodMacros(foodItems = []) {
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

export const MICRO_VITAMINS = ['vit_a','vit_b1','vit_b2','vit_b3','vit_b5','vit_b6','vit_b12','vit_c','vit_d','vit_e','vit_k','folate','biotin','choline'];
export const MICRO_MINERALS = ['calcium','iron','magnesium','phosphorus','potassium','sodium','zinc','copper','manganese','selenium'];
export const MICRO_SPECIALS = ['fiber','omega3_ala','omega3_epa','omega3_dha','omega6','lycopene','beta_glucan'];
export const MICRO_TOTAL = MICRO_VITAMINS.length + MICRO_MINERALS.length + MICRO_SPECIALS.length;

/** Key nutrients for the quick summary badge inside MacroProgress. */
export const QUICK_MICRO_KEYS = ['fiber','omega3_epa','omega3_dha','vit_b12','vit_d','calcium','iron','magnesium','zinc','folate','potassium'];

const ZERO_MICROS = {
  vit_a:0,vit_b1:0,vit_b2:0,vit_b3:0,vit_b5:0,vit_b6:0,vit_b12:0,
  vit_c:0,vit_d:0,vit_e:0,vit_k:0,folate:0,biotin:0,choline:0,
  calcium:0,iron:0,magnesium:0,phosphorus:0,potassium:0,sodium:0,
  zinc:0,copper:0,manganese:0,selenium:0,
  omega3_ala:0,omega3_epa:0,omega3_dha:0,omega6:0,
  fiber:0,lycopene:0,beta_glucan:0,
};

/** Micronutrient totals from foods that carry per-100g data. Foods without
 *  it contribute nothing — the static table only knows macros. */
export function calcMicros(foodItems = []) {
  return foodItems.reduce((acc, item) => {
    if (!item.per_100g) return acc;
    const f = item.grams / 100;
    const n = item.per_100g;
    const out = { ...acc };
    for (const key of Object.keys(ZERO_MICROS)) out[key] = acc[key] + (n[key] || 0) * f;
    return out;
  }, { ...ZERO_MICROS });
}

/** Adds the fixed micronutrient content of the protocol supplements. */
export function addSupplementMicros(base, supplements = {}) {
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

/** Sunlight-type activities carry a vitamin D credit. */
export function addActivityMicros(base, activities = {}, activeActivities = []) {
  const m = { ...base };
  activeActivities.forEach(act => {
    if (activities[act.id] && act.vitD_iu) m.vit_d += act.vitD_iu;
  });
  return m;
}

/** How many micro-nutrient targets are met today (same rules as the panel). */
export function countMicrosMet({ foodItems = [], supplements = {}, activities = {}, activeActivities = [], rdaOverrides = {} }) {
  if (!foodItems.some(f => f.per_100g)) return { met: 0, total: MICRO_TOTAL, hasData: false };
  const raw   = calcMicros(foodItems);
  const withS = addSupplementMicros(raw, supplements);
  const micros = addActivityMicros(withS, activities, activeActivities);

  const met = [...MICRO_VITAMINS, ...MICRO_MINERALS, ...MICRO_SPECIALS].filter(key => {
    const meta = RDA_TARGETS[key];
    if (!meta) return false;
    const rda = rdaOverrides[key] ? parseFloat(rdaOverrides[key]) : meta.rda;
    const val = micros[key] || 0;
    const pct = (val / rda) * 100;
    // Upper-limit nutrients (e.g. sodium) count as met while UNDER the cap
    return meta.upper ? pct <= 100 : pct >= 80;
  }).length;

  return { met, total: MICRO_TOTAL, hasData: true };
}
