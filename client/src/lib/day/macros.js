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

// ── A member's own label (10 Oct 2026) ──────────────────────────────────────
// A member logging protein oats (24 g protein per 100 g on the pack) got plain
// oats (13.2 g) from the shared food table, with no way to say so. They can
// now type the pack's protein, carbs and fat; calories follow from them the
// way a nutrition label works them out: 4 kcal per gram of protein and of
// carbohydrate, 9 per gram of fat. The server applies the same rule
// (services/memberFoods.js), so the number the member sees is the one stored.

export const KCAL_PER_GRAM = Object.freeze({ protein: 4, carbs: 4, fat: 9 });

/** Calories from the three macros, rounded to a whole number. */
export function kcalFromMacros({ protein = 0, carbs = 0, fat = 0 } = {}) {
  const g = (v) => Math.max(0, Number(v) || 0);
  return Math.round(g(protein) * KCAL_PER_GRAM.protein + g(carbs) * KCAL_PER_GRAM.carbs + g(fat) * KCAL_PER_GRAM.fat);
}

/** Carbs as the app counts them everywhere: net when known, else total. */
export const carbsOf = (p) => ((p?.net_carbs != null ? p.net_carbs : p?.total_carbs) || 0);

const one = (v) => Math.round(v * 10) / 10;

/**
 * What the member typed → per-100 g macros and calories, or why not.
 *
 * @param entry  { protein, carbs, fat } as typed; a blank box counts as 0
 * @param mode   'per100' (as printed on the pack) or 'portion' (for the
 *               grams being logged, e.g. home food the member weighed)
 * @param grams  the portion, used only in 'portion' mode
 * @returns { ok: true, per100: { protein, carbs, fat, calories } } or { ok: false, error }
 */
export function labelFromEntry(entry = {}, { mode = 'per100', grams = 100 } = {}) {
  const raw = ['protein', 'carbs', 'fat'].map(k => String(entry[k] ?? '').trim());
  const nums = raw.map(s => (s === '' ? 0 : Number(s)));
  if (nums.some(n => !Number.isFinite(n) || n < 0)) return { ok: false, error: 'Numbers only — 0 or more.' };
  if (nums.every(n => n === 0)) return { ok: false, error: 'Enter at least one of protein, carbs or fat.' };
  const portion = Number(grams) || 0;
  if (mode === 'portion' && portion <= 0) return { ok: false, error: 'Set the grams first.' };
  const scale = mode === 'portion' ? 100 / portion : 1;
  const [protein, carbs, fat] = nums.map(n => one(n * scale));
  if (protein + carbs + fat > 100.5) {
    return { ok: false, error: mode === 'portion'
      ? `That is more than ${portion} g of protein, carbs and fat in a ${portion} g portion. Check the numbers.`
      : 'Protein, carbs and fat can’t add up to more than 100 g in 100 g of food. Check the pack.' };
  }
  return { ok: true, per100: { protein, carbs, fat, calories: kcalFromMacros({ protein, carbs, fat }) } };
}

/** A food's per-100 g data with the member's label applied. Fibre, vitamins
 *  and minerals are kept from the food it replaces — the pack rarely lists
 *  them, and a blank would read as zero. */
export function withLabel(per100g, label) {
  return { ...(per100g || {}), protein: label.protein, total_carbs: label.carbs, net_carbs: label.carbs,
           fat: label.fat, calories: label.calories };
}

/** "P 18 g · C 60 g · F 9 g" — whole grams, for summaries. */
export function macroLine({ pro = 0, carb = 0, fat = 0 } = {}) {
  return `P ${Math.round(pro)} g · C ${Math.round(carb)} g · F ${Math.round(fat)} g`;
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
