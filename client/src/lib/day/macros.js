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
import { nutrientStatus, isEstimate } from './nutrientStatus';

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

// ── Unknown is not zero (Fixes-2i), and estimates are not confirmed (Fixes-2k)
// Each nutrient value in a food has a status (lib/day/nutrientStatus.js):
// confirmed (reference value, or recorded by a coach/label/database), estimate
// (recipe or AI) or unknown (nothing recorded, or an old 0 that cannot be told
// from "not recorded"). 2i guessed known-ness from the rest of the record (a
// food that listed some minerals made its other mineral zeros "real"); that
// guess is gone. A 0 is real only when its status says so.
//  • A total with an unknown part is a minimum ("at least"): it can still meet
//    a target, but it is never called short, zero or "under the limit".
//  • A target reached only with estimates is "estimated", never "met".

/** Which micronutrient values this food's record actually knows (any status but unknown). key → true/false. */
export function microKnown(per100, item = null) {
  const out = {};
  for (const k of Object.keys(ZERO_MICROS)) out[k] = nutrientStatus(per100, k, item) !== 'unknown';
  return out;
}

/** Totals from foods per nutrient: confirmed and estimated amounts, and grams with nothing known. */
export function microCoverage(foodItems = []) {
  const cov = Object.fromEntries(Object.keys(ZERO_MICROS).map(k => [k, { value: 0, confirmed: 0, estimated: 0, knownGrams: 0, estimateGrams: 0, unknownGrams: 0 }]));
  for (const item of foodItems) {
    const g = Number(item?.grams) || 0;
    if (g <= 0) continue;
    for (const k of Object.keys(ZERO_MICROS)) {
      const st = nutrientStatus(item.per_100g, k, item);
      if (st === 'unknown') { cov[k].unknownGrams += g; continue; }
      const amt = Number(item.per_100g[k]) * g / 100;
      cov[k].value += amt;
      if (isEstimate(st)) { cov[k].estimated += amt; cov[k].estimateGrams += g; }
      else { cov[k].confirmed += amt; cov[k].knownGrams += g; }
    }
  }
  return cov;
}

/**
 * Today's status for every micronutrient — the ONE rule the Today tile, the
 * nutrition panel, the quick count and the coach's day view all read.
 *   status: 'met' | 'estimate' | 'below' | 'zero' | 'over' | 'unknown'
 *     met       reached on confirmed values alone (upper limit: all confirmed and within it)
 *     estimate  depends on recipe or AI estimates (reached only with them, or below with them)
 *   coverage: 'full' (every food eaten knows it) | 'partial' | 'none'
 *   atLeast: some of what was eaten is unknown, so the value is a minimum
 *   approx:  part of the value is an estimate
 * Supplements and sunlight add confirmed amounts on top.
 */
export function microStatus({ foodItems = [], supplements = {}, activities = {}, activeActivities = [], rdaOverrides = {} } = {}) {
  const cov = microCoverage(foodItems);
  const zero = Object.fromEntries(Object.keys(cov).map(k => [k, 0]));
  const extra = addActivityMicros(addSupplementMicros(zero, supplements || {}), activities || {}, activeActivities || []);
  const rows = {};
  const counts = { met: 0, estimate: 0, below: 0, zero: 0, over: 0, unknown: 0 };
  for (const key of [...MICRO_VITAMINS, ...MICRO_MINERALS, ...MICRO_SPECIALS]) {
    const meta = RDA_TARGETS[key];
    if (!meta) continue;
    const rda = rdaOverrides?.[key] ? parseFloat(rdaOverrides[key]) : meta.rda;
    const c = cov[key];
    const confirmed = c.confirmed + (extra[key] || 0);
    const estimated = c.estimated;
    const value = confirmed + estimated;
    const coverage = c.unknownGrams === 0 ? 'full' : (c.knownGrams + c.estimateGrams) > 0 ? 'partial' : 'none';
    const pct = rda > 0 ? (value / rda) * 100 : 0;
    const confPct = rda > 0 ? (confirmed / rda) * 100 : 0;
    let status;
    if (meta.upper) {
      status = confPct > 100 ? 'over' : coverage !== 'full' ? 'unknown' : estimated > 0 ? 'estimate' : 'met';
    } else {
      status = confPct >= 80 ? 'met' : pct >= 80 ? 'estimate' : coverage !== 'full' ? 'unknown'
        : estimated > 0 ? 'estimate' : value === 0 ? 'zero' : 'below';
    }
    counts[status] += 1;
    rows[key] = { key, value, confirmed, estimated, rda, unit: meta.unit, label: meta.label, icon: meta.icon, upper: !!meta.upper,
                  pct, coverage, status, approx: estimated > 0,
                  atLeast: coverage !== 'full' && status !== 'met' && value > 0 };
  }
  const hasData = foodItems.some(f => Number(f?.grams) > 0);
  return { rows, ...counts, known: MICRO_TOTAL - counts.unknown, total: MICRO_TOTAL, hasData };
}

/** How many micro-nutrient targets are met today, and how many are not known (same rules as the panel). */
export function countMicrosMet(args) {
  const s = microStatus(args);
  if (!s.hasData) return { met: 0, estimate: 0, unknown: 0, known: 0, total: MICRO_TOTAL, hasData: false };
  return { met: s.met, estimate: s.estimate, unknown: s.unknown, known: s.known, total: s.total, hasData: true };
}
