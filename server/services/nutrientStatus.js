/**
 * services/nutrientStatus.js — where one nutrient value came from (Fixes-2k).
 *
 * Statuses (per nutrient, per food):
 *   reference  matched to an authoritative record: ICMR–NIN IFCT 2017, USDA
 *              (SR28 / FoodData Central SR Legacy) or an exact product label.
 *   recipe     calculated from ingredient quantities, cooked yield and
 *              nutrient-retention factors.
 *   ai         an AI estimate. Two models agreeing does not make it more.
 *   recorded   entered by a coach or admin, a member's own label, a barcode
 *              label, or a seeded database row from before provenance was kept.
 *   unknown    nothing recorded (null), or an old 0 that cannot be told apart
 *              from "not recorded".
 *
 * Confirmed = reference or recorded. Estimates = recipe or ai. Totals and
 * target badges never count an estimate as a confirmed target met.
 *
 * Legacy rule, for values written before statuses existed (no `_status`):
 *   null / missing → unknown
 *   0              → unknown (uncertain: kept as stored, never rewritten)
 *   > 0            → ai if the food was AI-created and unchecked, else recorded
 * The client mirrors this in client/src/lib/day/nutrientStatus.js;
 * test-nutrient-provenance checks the two agree.
 */
const { NUTRIENT_KEYS, CORE_KEYS } = require('./nutrients');

const CONFIRMED = new Set(['reference', 'recorded']);
const ESTIMATE = new Set(['recipe', 'ai']);
const MICRO_KEYS = NUTRIENT_KEYS.filter(k => !CORE_KEYS.includes(k) && k !== 'net_carbs');

/** Was this food row AI-created and never checked? */
const aiSourcedFood = (food) => !!food && food.source === 'ai' && !food.verified && !food.verified_by;

/** The status of one value. ctx.aiSourced: the record is an unchecked AI estimate. */
function nutrientStatus(per100, key, ctx = {}) {
  const v = per100 ? per100[key] : undefined;
  if (v === null || v === undefined || v === '') return 'unknown';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'unknown';
  const st = per100._status && per100._status[key];
  if (st) return st;
  if (n === 0) return 'unknown';
  return ctx.aiSourced ? 'ai' : 'recorded';
}

/**
 * A food row's per_100g with `_status` filled in for every legacy value, so the
 * copy a member logs carries exactly what the row knew. Zeros and nulls with no
 * status are left without one (they stay unknown).
 */
function withStatus(food) {
  if (!food || !food.per_100g || typeof food.per_100g !== 'object') return food;
  const p = food.per_100g;
  const ctx = { aiSourced: aiSourcedFood(food) };
  const st = { ...(p._status || {}) };
  for (const k of MICRO_KEYS) {
    if (st[k]) continue;
    const s = nutrientStatus(p, k, ctx);
    if (s !== 'unknown') st[k] = s;
  }
  return { ...food, per_100g: { ...p, ...(Object.keys(st).length ? { _status: st } : {}) } };
}

/**
 * Marks every nutrient given a value as `status` (used when an AI, a coach or a
 * label writes a food). AI zeros become null: an AI "0" is not a measurement.
 */
function stamp(per100, status, { dropZeros = false } = {}) {
  const out = { ...per100 };
  const st = { ...(per100._status || {}) };
  for (const k of MICRO_KEYS) {
    if (out[k] === null || out[k] === undefined) { delete st[k]; continue; }
    if (dropZeros && Number(out[k]) === 0) { out[k] = null; delete st[k]; continue; }
    st[k] = status;
  }
  if (Object.keys(st).length) out._status = st; else delete out._status;
  return out;
}

/**
 * Marks the nutrients a person or source actually supplied (keys present in
 * `supplied`) with `status`; a supplied blank clears the status. Keys not
 * supplied keep whatever they had. Used for coach/admin edits and labels,
 * where an explicit 0 is a real 0 (a label that says "Trans fat 0 g").
 */
function stampSupplied(per100, supplied, status) {
  const out = { ...per100 };
  const st = { ...(per100._status || {}) };
  const given = supplied && typeof supplied === 'object' ? supplied : {};
  for (const k of MICRO_KEYS) {
    if (!(k in given)) continue;
    if (out[k] === null || out[k] === undefined) delete st[k]; else st[k] = status;
  }
  if (Object.keys(st).length) out._status = st; else delete out._status;
  return out;
}

/** Per-nutrient provenance entries for the keys stamped above (foods.nutrient_meta). */
function metaFor(per100, supplied, entry) {
  const out = {};
  for (const k of MICRO_KEYS) if (supplied && k in supplied && per100[k] !== null && per100[k] !== undefined) out[k] = { ...entry };
  return out;
}

/** For text: "2.9 mg (IFCT 2017)", "~4 mg (AI estimate)", "not known". */
function describe(per100, key, unit, ctx = {}, meta = null) {
  const s = nutrientStatus(per100, key, ctx);
  if (s === 'unknown') return 'not known';
  const v = Math.round(Number(per100[key]) * 10) / 10;
  const src = meta && meta[key] && meta[key].source && meta[key].source.dataset;
  if (s === 'reference') return `${v}${unit}${src ? ` (${src})` : ''}`;
  if (s === 'recipe') return `~${v}${unit} (recipe estimate)`;
  if (s === 'ai') return `~${v}${unit} (AI estimate)`;
  return `${v}${unit}`;
}

module.exports = { nutrientStatus, withStatus, stamp, stampSupplied, metaFor, describe, aiSourcedFood, MICRO_KEYS, CONFIRMED, ESTIMATE };
