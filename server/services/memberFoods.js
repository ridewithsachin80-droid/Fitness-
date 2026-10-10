/**
 * services/memberFoods.js — a member's own label for a food.
 *
 * Sachin, 10 Oct 2026: a member logging protein oats (24 g protein per 100 g
 * on the pack) was given plain oats (13.2 g) and could not change it. Now the
 * member types the pack's protein, carbs and fat and the calories follow from
 * them, the way a nutrition label works them out:
 *
 *     calories = 4 × protein + 4 × carbs + 9 × fat      (per 100 g)
 *
 * The label is the MEMBER's, never the shared foods row — plain oats really is
 * ~13 g protein, and one member's brand must not change it for everyone. It
 * is used the next time that member logs a food of the same name (AI chat,
 * plate photo, the food search), and the coach can see every label a member
 * has saved.
 *
 * The client applies the same 4/4/9 rule (client/src/lib/day/macros.js) so
 * the number the member sees while typing is the number stored. This file is
 * the authority: whatever calories the client sends are ignored.
 */
const pool = require('../db/pool');
const { normaliseNutrients } = require('./nutrients');

const KCAL_PER_GRAM = Object.freeze({ protein: 4, carbs: 4, fat: 9 });

/** The lookup key: lower case, trimmed, single spaces. "  Protein  Oats" → "protein oats". */
const nameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 100);

const kcalFromMacros = ({ protein = 0, carbs = 0, fat = 0 }) =>
  Math.round(protein * KCAL_PER_GRAM.protein + carbs * KCAL_PER_GRAM.carbs + fat * KCAL_PER_GRAM.fat);

const err = (status, message) => Object.assign(new Error(message), { status });

/**
 * Validate a label the member sent and build the stored per-100 g data.
 *
 * @param body  { name, per_100g: { protein, carbs | net_carbs | total_carbs, fat, ...rest }, food_id? }
 *              The rest of per_100g (fibre, vitamins…) is kept as sent — it is
 *              the food the label replaces, which the pack rarely lists.
 * @returns { name, key, per_100g, base_food_id }
 * @throws  status-400 errors with a sentence the member can act on
 */
function buildLabel(body = {}) {
  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  if (name.length < 2) throw err(400, 'Which food is this label for?');
  const p = body.per_100g && typeof body.per_100g === 'object' && !Array.isArray(body.per_100g) ? body.per_100g : null;
  if (!p) throw err(400, 'Send the protein, carbs and fat per 100 g.');

  const read = (v) => (v === '' || v == null ? 0 : Number(v));
  const carbsRaw = p.carbs ?? p.net_carbs ?? p.total_carbs;
  const [protein, carbs, fat] = [p.protein, carbsRaw, p.fat].map(read);
  if (![protein, carbs, fat].every(n => Number.isFinite(n) && n >= 0)) throw err(400, 'Protein, carbs and fat must be numbers, 0 or more.');
  if (protein + carbs + fat <= 0) throw err(400, 'Enter at least one of protein, carbs or fat.');
  if (protein + carbs + fat > 100.5) throw err(400, 'Protein, carbs and fat can’t add up to more than 100 g in 100 g of food.');

  const one = (v) => Math.round(v * 10) / 10;
  const macros = { protein: one(protein), carbs: one(carbs), fat: one(fat) };
  const { carbs: _c, ...rest } = p;
  const per_100g = normaliseNutrients({
    ...rest,
    protein: macros.protein, total_carbs: macros.carbs, net_carbs: macros.carbs, fat: macros.fat,
    calories: kcalFromMacros(macros),
  });
  const fid = parseInt(body.food_id);
  return { name, key: nameKey(name), per_100g, base_food_id: Number.isInteger(fid) && fid > 0 ? fid : null };
}

/** Save (or replace) a member's label. Returns the stored row. */
async function saveLabel(patientId, body) {
  const l = buildLabel(body);
  // A food_id that is not in the foods table must not fail the save.
  let baseId = l.base_food_id;
  if (baseId) {
    const { rows } = await pool.query(`SELECT 1 FROM foods WHERE id = $1`, [baseId]);
    if (!rows.length) baseId = null;
  }
  const { rows } = await pool.query(
    `INSERT INTO member_foods (patient_id, name, name_key, per_100g, base_food_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (patient_id, name_key) DO UPDATE
       SET name = EXCLUDED.name, per_100g = EXCLUDED.per_100g,
           base_food_id = COALESCE(EXCLUDED.base_food_id, member_foods.base_food_id),
           updated_at = NOW()
     RETURNING id, name, per_100g, base_food_id, updated_at`,
    [patientId, l.name, l.key, JSON.stringify(l.per_100g), baseId]);
  return rows[0];
}

/** Every label a member has saved, newest first. */
async function labelsFor(patientId) {
  const { rows } = await pool.query(
    `SELECT id, name, per_100g, base_food_id, updated_at
       FROM member_foods WHERE patient_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 200`, [patientId]);
  return rows;
}

/**
 * The member's label for a name, if they saved one. Tries the name as given,
 * then the part before any bracket ("Oats (rolled)" → "oats"), so the AI's
 * longer name still finds the member's label.
 */
async function findLabel(patientId, name) {
  if (!patientId) return null;
  const full = nameKey(name);
  if (!full) return null;
  const base = nameKey(full.split('(')[0]);
  const { rows } = await pool.query(
    `SELECT id, name, per_100g, base_food_id FROM member_foods
      WHERE patient_id = $1 AND name_key = ANY($2::text[])
      ORDER BY (name_key = $3) DESC LIMIT 1`,
    [patientId, [...new Set([full, base].filter(Boolean))], full]);
  return rows[0] || null;
}

/** Forget a label by name. Returns true when one was removed. */
async function forgetLabel(patientId, name) {
  const { rowCount } = await pool.query(
    `DELETE FROM member_foods WHERE patient_id = $1 AND name_key = $2`, [patientId, nameKey(name)]);
  return rowCount > 0;
}

module.exports = { KCAL_PER_GRAM, nameKey, kcalFromMacros, buildLabel, saveLabel, labelsFor, findLabel, forgetLabel };
