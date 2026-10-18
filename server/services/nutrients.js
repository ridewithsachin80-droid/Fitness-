/**
 * services/nutrients.js — the shape of a food's nutrition, in one place.
 *
 * Every food in this app carries the same 39 fields whatever door it came in
 * through: typed into the AI chat, photographed, scanned from a barcode,
 * prescribed by a coach, or entered by hand in Admin. A member's iron total is
 * only meaningful if it is summed over foods that all agree on what "iron"
 * means.
 *
 * This existed TWICE — once in routes/aiChat.js and once in routes/aiFoods.js —
 * and the two had already drifted. Given identical input, one returned
 * net_carbs 1.4 and the other returned NaN, which reaches Postgres as null and
 * turns every downstream sum into NaN. Nothing failed loudly; the number was
 * just wrong for foods that happened to come in through the second door.
 *
 * One implementation. Any new nutrient is added here and every path gets it.
 */

// ── Nutrition normaliser — guarantees every field exists ────────────────────
//
// Fixes-2k (18 Oct 2026, backlog B12): a nutrient nobody recorded is NULL,
// never 0. It used to be 0, so "this food has no iron" and "nobody wrote down
// its iron" were the same number, and every screen had to guess which.
//   · The four core figures (calories, protein, total_carbs, fat) stay numbers:
//     every calorie and macro total in the app is built on them, and a food
//     without them is caught elsewhere (macroCheck, the review queue).
//   · net_carbs stays derived (total_carbs minus a known fibre).
//   · Every other nutrient is a finite number or null. Never NaN, never undefined.
//   · `_status` (optional) says, per nutrient, where its value came from:
//     'reference' | 'recipe' | 'ai' | 'recorded'. See services/nutrientStatus.js.
//     It travels inside per_100g so every copy of the food (logged items,
//     saved meals, plans) keeps it without each path having to carry it.
const CORE = ['calories', 'protein', 'total_carbs', 'fat'];
const MINOR = ['fiber', 'sugar', 'saturated_fat', 'trans_fat', 'cholesterol',
  'omega3_ala', 'omega3_epa', 'omega3_dha', 'omega6', 'omega9_mufa',
  'vit_a', 'vit_b1', 'vit_b2', 'vit_b3', 'vit_b5', 'vit_b6', 'vit_b12', 'vit_c', 'vit_d', 'vit_e', 'vit_k',
  'folate', 'biotin', 'choline',
  'calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'sodium', 'zinc', 'copper', 'manganese', 'selenium',
  // Fields routes/foods.js carried and the other two copies did not. Three
  // implementations existed; the union is the contract (the intersection would
  // have quietly deleted six nutrients from every admin-edited food).
  'glycemic_index', 'glycemic_load', 'probiotic', 'prebiotic_fiber', 'lycopene', 'beta_glucan'];
const STATUSES = new Set(['reference', 'recipe', 'ai', 'recorded']);

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** Keeps only known nutrients with a known status, and only where there is a value. */
function cleanStatus(raw, values) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of [...CORE, ...MINOR]) {
    if (STATUSES.has(raw[k]) && values[k] !== null && values[k] !== undefined) out[k] = raw[k];
  }
  return Object.keys(out).length ? out : null;
}

function normaliseNutrients(raw = {}) {
  raw = raw || {};
  const out = {};
  for (const k of CORE) out[k] = num(raw[k]);
  const fiber = numOrNull(raw.fiber);
  const netRaw = parseFloat(raw.net_carbs);
  out.net_carbs = Number.isFinite(netRaw) ? netRaw : Math.max(0, +(out.total_carbs - (fiber ?? 0)).toFixed(1));
  for (const k of MINOR) out[k] = numOrNull(raw[k]);
  const st = cleanStatus(raw._status, out);
  if (st) out._status = st;
  return out;
}

/** The nutrient keys, in a fixed order (net_carbs included, _status not). */
const NUTRIENT_KEYS = [...CORE, 'net_carbs', ...MINOR];

module.exports = { normaliseNutrients, NUTRIENT_KEYS, CORE_KEYS: CORE, MINOR_KEYS: MINOR, NUTRIENT_STATUSES: [...STATUSES] };
