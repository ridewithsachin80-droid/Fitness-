/**
 * services/nutrientEnrichment.js — evidence-backed nutrient filling (Fixes-2k).
 *
 * Fills MISSING nutrient values on unchecked AI-created foods from evidence:
 *   reference  a matched record: IFCT 2017 (ICMR–NIN), USDA SR28 (= FoodData
 *              Central "SR Legacy"), or an exact product label.
 *   recipe     a calculation from ingredient quantities, the cooked yield and
 *              nutrient-retention factors. Recomputed here; a proposal whose
 *              number disagrees with its own working is refused.
 *   ai         allowed only as an AI estimate. Two models agreeing does not
 *              make a value a reference.
 * A value with no support is not proposed: it stays unknown.
 *
 * Protection (never written over):
 *   · foods that are verified, checked by a coach (verified_by), or not
 *     AI-created (seeded IFCT/USDA rows, barcode labels, coach/admin entries);
 *   · any value that already has a status (recorded, reference, recipe, ai);
 *   · any value above 0.
 * What CAN be filled: an empty value, or an old 0 with no status (an
 * "uncertain 0": it cannot be told from "not recorded"). Valid zeros, which
 * carry a status, are left alone.
 *
 * Every applied change keeps its before-value, status and provenance, so a
 * batch can be rolled back. Rollback refuses a value someone has changed since.
 * Member logs are never touched: a logged item keeps the snapshot it was
 * logged with (see services/foodPropagate.js, which is opt-in and not used here).
 */
const { MICRO_KEYS } = require('./nutrientStatus');

/** The unit each nutrient is stored in (matches client RDA_TARGETS and the admin form). */
const APP_UNITS = {
  fiber: 'g', sugar: 'g', saturated_fat: 'g', trans_fat: 'g', cholesterol: 'mg',
  omega3_ala: 'mg', omega3_epa: 'mg', omega3_dha: 'mg', omega6: 'mg', omega9_mufa: 'mg',
  vit_a: 'mcg', vit_b1: 'mg', vit_b2: 'mg', vit_b3: 'mg', vit_b5: 'mg', vit_b6: 'mg', vit_b12: 'mcg',
  vit_c: 'mg', vit_d: 'IU', vit_e: 'mg', vit_k: 'mcg', folate: 'mcg', biotin: 'mcg', choline: 'mg',
  calcium: 'mg', iron: 'mg', magnesium: 'mg', phosphorus: 'mg', potassium: 'mg', sodium: 'mg',
  zinc: 'mg', copper: 'mg', manganese: 'mg', selenium: 'mcg',
  lycopene: 'mcg', beta_glucan: 'g', prebiotic_fiber: 'g', probiotic: '', glycemic_index: '', glycemic_load: '',
};
const MASS = { g: 1, mg: 1e-3, mcg: 1e-6, 'µg': 1e-6, ug: 1e-6 };
const REFERENCE_DATASETS = ['IFCT 2017', 'USDA SR28', 'Product label'];
const MAX_FOODS_PER_BATCH = 20;   // the pilot size; raise only after the pilot is reviewed

/** value in `unit` → the app's unit for `key`. Vitamin D: 1 mcg = 40 IU. Vitamin A in IU is refused (it depends on the form). */
function toAppUnit(key, value, unit) {
  const want = APP_UNITS[key];
  if (want === undefined) throw new Error(`unknown nutrient ${key}`);
  const u = String(unit || '').trim().toLowerCase().replace('μ', 'µ');
  if (u === want.toLowerCase()) return value;
  if (key === 'vit_d') {
    if (u === 'iu') return value;
    if (MASS[u]) return value * MASS[u] / 1e-6 * 40;
  }
  if (u === 'iu') throw new Error(`${key} in IU cannot be converted safely; give it in ${want}`);
  if (MASS[u] && MASS[want]) return value * MASS[u] / MASS[want];
  throw new Error(`cannot convert ${key} from "${unit}" to ${want}`);
}

/** Is this food a target at all? */
function eligibility(food) {
  if (!food) return { eligible: false, reason: 'food not found' };
  if (food.verified) return { eligible: false, reason: 'verified food (protected)' };
  if (food.verified_by) return { eligible: false, reason: 'checked by a coach (protected)' };
  if (food.source !== 'ai') return { eligible: false, reason: `source "${food.source}" is not an AI estimate (protected)` };
  return { eligible: true };
}

/** May this one value be filled? */
function fillability(food, key) {
  const p = food.per_100g || {};
  const v = p[key];
  if (p._status && p._status[key]) return { ok: false, reason: `already has a status (${p._status[key]})` };
  if (food.nutrient_meta && food.nutrient_meta[key]) return { ok: false, reason: 'already has provenance' };
  if (v === null || v === undefined || v === '') return { ok: true, replaces: 'empty' };
  const n = Number(v);
  if (Number.isFinite(n) && n === 0) return { ok: true, replaces: 'uncertain 0' };
  return { ok: false, reason: `already has a value (${v})` };
}

/**
 * Recipe calculation, per 100 g of the dish as eaten.
 *   ingredients: [{ name, grams, value_per_100g, retention? }] — value in the app unit
 *   cooked_weight_g: weight of the finished dish (yield)
 * Nutrient = Σ grams/100 × value × retention, spread over the cooked weight.
 */
function recipePer100(recipe) {
  const ings = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const cooked = Number(recipe?.cooked_weight_g);
  if (!ings.length) throw new Error('recipe has no ingredients');
  if (!(cooked > 0)) throw new Error('recipe needs the cooked weight (yield)');
  let total = 0;
  for (const i of ings) {
    const g = Number(i.grams), v = Number(i.value_per_100g), r = i.retention === undefined ? 1 : Number(i.retention);
    if (!(g >= 0) || !(v >= 0) || !(r >= 0 && r <= 1)) throw new Error(`bad ingredient ${i.name || '?'}`);
    total += g / 100 * v * r;
  }
  return total / cooked * 100;
}

/**
 * Checks one proposal against the food it is for. Returns { value, status, meta } in
 * the app's unit and per 100 g, or throws with the reason it is refused.
 *   { food_id, nutrient, value, unit, basis: 'per_100g' | 'per_serving', serving_g,
 *     preparation: 'raw' | 'cooked', status: 'reference' | 'recipe' | 'ai',
 *     source: { dataset, record_id, name, url }, assumptions, recipe }
 */
function checkProposal(food, pr) {
  const key = pr.nutrient;
  if (!MICRO_KEYS.includes(key)) throw new Error(`"${key}" is not a nutrient this app stores`);
  if (!['reference', 'recipe', 'ai'].includes(pr.status)) throw new Error('status must be reference, recipe or ai');
  let value = Number(pr.value);
  if (!Number.isFinite(value) || value < 0) throw new Error('value must be a number, 0 or more');
  value = toAppUnit(key, value, pr.unit);
  if (pr.basis === 'per_serving') {
    const s = Number(pr.serving_g);
    if (!(s > 0)) throw new Error('per-serving value needs serving_g');
    value = value * 100 / s;
  } else if (pr.basis !== 'per_100g') throw new Error('basis must be per_100g or per_serving');

  // Raw or cooked must match what the food's numbers are for (Fixes-2h).
  if (pr.preparation && !['raw', 'cooked'].includes(pr.preparation)) throw new Error('preparation must be raw or cooked');
  if (food.preparation && pr.preparation && food.preparation !== pr.preparation)
    throw new Error(`the food's numbers are for the ${food.preparation} food; this value is for ${pr.preparation}`);

  if (pr.status === 'reference') {
    const ds = pr.source?.dataset;
    if (!REFERENCE_DATASETS.includes(ds)) throw new Error(`a reference value needs a source dataset (${REFERENCE_DATASETS.join(', ')})`);
    if (!pr.source.record_id) throw new Error('a reference value needs the source record id');
    // The open copy of IFCT 2017 writes 0 for both "none" and "not analysed", so an
    // IFCT 0 proves nothing. USDA SR28 leaves "not analysed" blank, so its 0 is a value.
    if (value === 0 && ds === 'IFCT 2017') throw new Error('an IFCT 0 is not used: this copy of the table cannot tell "none" from "not analysed"');
  }
  if (pr.status === 'recipe') {
    const calc = recipePer100(pr.recipe);
    const conv = toAppUnit(key, calc, pr.recipe.unit || pr.unit);
    if (Math.abs(conv - value) > Math.max(0.01, value * 0.02)) throw new Error(`recipe working gives ${+conv.toFixed(3)}, not ${+value.toFixed(3)}`);
  }
  if (pr.status === 'ai' && pr.source?.dataset && REFERENCE_DATASETS.includes(pr.source.dataset))
    throw new Error('an AI estimate cannot claim a reference dataset');

  const meta = {
    status: pr.status,
    source: pr.source ? { dataset: pr.source.dataset || null, record_id: pr.source.record_id || null, name: pr.source.name || null, url: pr.source.url || null } : null,
    basis: pr.preparation || food.preparation || null,
    assumptions: pr.assumptions || null,
    recipe: pr.status === 'recipe' ? pr.recipe : undefined,
    date: new Date().toISOString().slice(0, 10),
    reviewer: null, review_status: 'pending',
  };
  return { value: Math.round(value * 1000) / 1000, status: pr.status, meta };
}

const FOOD_COLS = 'id, name, source, verified, verified_by, preparation, per_100g, nutrient_meta';

/** Propose a batch: checks every proposal and stores it; changes nothing on the foods. */
async function createBatch(db, { label, proposals, userId, notes = null }) {
  if (!label) throw new Error('a batch needs a label');
  const list = Array.isArray(proposals) ? proposals : [];
  const foodIds = [...new Set(list.map(p => parseInt(p.food_id)).filter(Boolean))];
  if (foodIds.length > MAX_FOODS_PER_BATCH) throw new Error(`a batch may cover at most ${MAX_FOODS_PER_BATCH} foods during the pilot`);
  const { rows: foods } = await db.query(`SELECT ${FOOD_COLS} FROM foods WHERE id = ANY($1)`, [foodIds]);
  const byId = new Map(foods.map(f => [f.id, f]));
  const { rows: [b] } = await db.query(
    `INSERT INTO nutrient_enrichment_batches (label, created_by, notes) VALUES ($1, $2, $3) RETURNING *`, [label, userId || null, notes]);
  const review = [];
  for (const pr of list) {
    const food = byId.get(parseInt(pr.food_id));
    let outcome = 'proposed', reason = null, checked = null, before = null;
    const el = eligibility(food);
    if (!el.eligible) { outcome = 'skipped'; reason = el.reason; }
    else {
      const fl = fillability(food, pr.nutrient);
      if (!fl.ok) { outcome = 'skipped'; reason = fl.reason; }
      else {
        try { checked = checkProposal(food, pr); reason = `fills ${fl.replaces}`; }
        catch (e) { outcome = 'skipped'; reason = `refused: ${e.message}`; }
      }
    }
    if (food) before = food.per_100g?.[pr.nutrient] ?? null;
    if (food && MICRO_KEYS.includes(pr.nutrient)) {
      await db.query(
        `INSERT INTO nutrient_enrichment_changes
           (batch_id, food_id, nutrient, before_value, before_status, before_meta, after_value, after_status, after_meta, outcome, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (batch_id, food_id, nutrient) DO NOTHING`,
        [b.id, food.id, pr.nutrient, before, food.per_100g?._status?.[pr.nutrient] || null, food.nutrient_meta?.[pr.nutrient] || null,
         checked ? checked.value : null, checked ? checked.status : (['reference', 'recipe', 'ai'].includes(pr.status) ? pr.status : 'ai'),
         JSON.stringify(checked ? checked.meta : { refused: true }), outcome, reason]);
    }
    review.push({ food_id: food?.id ?? pr.food_id, food: food?.name ?? null, nutrient: pr.nutrient, before, after: checked?.value ?? null,
                  status: checked?.status ?? null, outcome, reason });
  }
  return { batch: b, review };
}

/**
 * Apply a proposed batch. Re-checks every value inside one transaction (a food
 * may have changed since it was proposed); nothing is written over.
 */
async function applyBatch(pool, batchId, userId) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: [b] } = await db.query(`SELECT * FROM nutrient_enrichment_batches WHERE id = $1 FOR UPDATE`, [batchId]);
    if (!b) throw Object.assign(new Error('batch not found'), { status: 404 });
    if (b.status !== 'proposed') throw Object.assign(new Error(`batch is ${b.status}, not proposed`), { status: 409 });
    const { rows: changes } = await db.query(`SELECT * FROM nutrient_enrichment_changes WHERE batch_id = $1 AND outcome = 'proposed' ORDER BY id`, [batchId]);
    let applied = 0, skipped = 0;
    for (const c of changes) {
      const { rows: [food] } = await db.query(`SELECT ${FOOD_COLS} FROM foods WHERE id = $1 FOR UPDATE`, [c.food_id]);
      const el = eligibility(food), fl = food ? fillability(food, c.nutrient) : { ok: false, reason: 'food gone' };
      const nowVal = food?.per_100g?.[c.nutrient] ?? null;
      const same = (nowVal === null && c.before_value === null) || (nowVal !== null && c.before_value !== null && Number(nowVal) === Number(c.before_value));
      if (!el.eligible || !fl.ok || !same) {
        await db.query(`UPDATE nutrient_enrichment_changes SET outcome='skipped', reason=$2 WHERE id=$1`,
          [c.id, !el.eligible ? el.reason : !fl.ok ? fl.reason : 'the value changed after the batch was proposed']);
        skipped++; continue;
      }
      const meta = { ...c.after_meta, batch_id: batchId };
      await db.query(
        `UPDATE foods
            SET per_100g = jsonb_set(jsonb_set(per_100g, ARRAY[$2::text], to_jsonb($3::numeric)),
                                     '{_status}', COALESCE(per_100g->'_status', '{}'::jsonb) || jsonb_build_object($2::text, $4::text)),
                nutrient_meta = COALESCE(nutrient_meta, '{}'::jsonb) || jsonb_build_object($2::text, $5::jsonb)
          WHERE id = $1`,
        [c.food_id, c.nutrient, c.after_value, c.after_status, JSON.stringify(meta)]);
      await db.query(`UPDATE nutrient_enrichment_changes SET outcome='applied' WHERE id=$1`, [c.id]);
      applied++;
    }
    await db.query(`UPDATE nutrient_enrichment_batches SET status='applied', applied_by=$2, applied_at=NOW() WHERE id=$1`, [batchId, userId || null]);
    await db.query('COMMIT');
    return { applied, skipped };
  } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; }
  finally { db.release(); }
}

/** Undo an applied batch: each value goes back to what it was, unless someone changed it since. */
async function rollbackBatch(pool, batchId, userId) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: [b] } = await db.query(`SELECT * FROM nutrient_enrichment_batches WHERE id = $1 FOR UPDATE`, [batchId]);
    if (!b) throw Object.assign(new Error('batch not found'), { status: 404 });
    if (b.status !== 'applied') throw Object.assign(new Error(`batch is ${b.status}, not applied`), { status: 409 });
    const { rows: changes } = await db.query(`SELECT * FROM nutrient_enrichment_changes WHERE batch_id = $1 AND outcome = 'applied' ORDER BY id`, [batchId]);
    let restored = 0, conflicts = 0;
    for (const c of changes) {
      const { rows: [food] } = await db.query(`SELECT ${FOOD_COLS} FROM foods WHERE id = $1 FOR UPDATE`, [c.food_id]);
      const p = food?.per_100g || {};
      const untouched = food && Number(p[c.nutrient]) === Number(c.after_value) && p._status?.[c.nutrient] === c.after_status
        && Number(food.nutrient_meta?.[c.nutrient]?.batch_id) === Number(batchId);
      if (!untouched) {
        await db.query(`UPDATE nutrient_enrichment_changes SET outcome='rollback_conflict', reason='changed after the batch was applied; left as it is' WHERE id=$1`, [c.id]);
        conflicts++; continue;
      }
      await db.query(
        `UPDATE foods
            SET per_100g = CASE WHEN $3::text IS NULL
                                THEN jsonb_set(per_100g, ARRAY[$2::text], 'null'::jsonb)
                                ELSE jsonb_set(per_100g, ARRAY[$2::text], to_jsonb($3::numeric)) END
                           #- ARRAY['_status', $2::text],
                nutrient_meta = COALESCE(nutrient_meta, '{}'::jsonb) - $2::text
          WHERE id = $1`,
        [c.food_id, c.nutrient, c.before_value === null ? null : String(c.before_value)]);
      if (c.before_status) {
        await db.query(`UPDATE foods SET per_100g = jsonb_set(per_100g, '{_status}', COALESCE(per_100g->'_status','{}'::jsonb) || jsonb_build_object($2::text, $3::text)) WHERE id=$1`,
          [c.food_id, c.nutrient, c.before_status]);
      }
      if (c.before_meta) {
        await db.query(`UPDATE foods SET nutrient_meta = COALESCE(nutrient_meta,'{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb) WHERE id=$1`,
          [c.food_id, c.nutrient, JSON.stringify(c.before_meta)]);
      }
      await db.query(`UPDATE nutrient_enrichment_changes SET outcome='rolled_back' WHERE id=$1`, [c.id]);
      restored++;
    }
    await db.query(`UPDATE nutrient_enrichment_batches SET status='rolled_back', rolled_back_by=$2, rolled_back_at=NOW() WHERE id=$1`, [batchId, userId || null]);
    await db.query('COMMIT');
    return { restored, conflicts };
  } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; }
  finally { db.release(); }
}

/**
 * Read-only inventory: which foods are eligible, which nutrients are missing,
 * which zeros are ambiguous, and the most-logged eligible foods in detail.
 */
async function inventory(db, { top = 30, days = 120 } = {}) {
  const { rows: bySource } = await db.query(
    `SELECT COALESCE(source,'(none)') AS source, verified, (verified_by IS NOT NULL) AS checked, count(*)::int AS n
       FROM foods GROUP BY 1,2,3 ORDER BY 1,2,3`);
  const { rows: foods } = await db.query(`SELECT ${FOOD_COLS} FROM foods`);
  const eligibleFoods = foods.filter(f => eligibility(f).eligible);
  const perNutrient = {};
  for (const k of MICRO_KEYS) perNutrient[k] = { empty: 0, uncertain_zero: 0, with_status: 0, legacy_value: 0 };
  for (const f of eligibleFoods) {
    const p = f.per_100g || {};
    for (const k of MICRO_KEYS) {
      const v = p[k];
      if (p._status?.[k]) perNutrient[k].with_status++;
      else if (v === null || v === undefined || v === '') perNutrient[k].empty++;
      else if (Number(v) === 0) perNutrient[k].uncertain_zero++;
      else perNutrient[k].legacy_value++;
    }
  }
  const { rows: usage } = await db.query(
    `SELECT (it->>'food_id')::int AS food_id, count(*)::int AS logs, count(DISTINCT d.patient_id)::int AS members
       FROM daily_logs d, jsonb_array_elements(COALESCE(d.food_items, '[]'::jsonb)) it
      WHERE d.log_date >= CURRENT_DATE - $1::int AND (it->>'food_id') ~ '^[0-9]+$'
      GROUP BY 1`, [days]);
  const use = new Map(usage.map(u => [u.food_id, u]));
  const ranked = eligibleFoods
    .map(f => ({ f, logs: use.get(f.id)?.logs || 0, members: use.get(f.id)?.members || 0 }))
    .sort((a, b) => b.logs - a.logs || a.f.id - b.f.id)
    .slice(0, top)
    .map(({ f, logs, members }) => {
      const p = f.per_100g || {};
      return {
        id: f.id, name: f.name, preparation: f.preparation || null, logs, members,
        calories: p.calories ?? null, protein: p.protein ?? null, total_carbs: p.total_carbs ?? null, fat: p.fat ?? null,
        missing: MICRO_KEYS.filter(k => !p._status?.[k] && (p[k] === null || p[k] === undefined || p[k] === '')),
        uncertain_zero: MICRO_KEYS.filter(k => !p._status?.[k] && p[k] !== null && p[k] !== undefined && p[k] !== '' && Number(p[k]) === 0),
        values: Object.fromEntries(MICRO_KEYS.filter(k => Number(p[k]) > 0).map(k => [k, p[k]])),
        statuses: p._status || {},
      };
    });
  return {
    generated_at: new Date().toISOString(),
    foods_total: foods.length, by_source: bySource,
    eligible_total: eligibleFoods.length,
    rule: 'eligible = source "ai", not verified, not checked by a coach',
    per_nutrient: perNutrient,
    top_eligible: ranked, usage_window_days: days,
  };
}

module.exports = { APP_UNITS, REFERENCE_DATASETS, MAX_FOODS_PER_BATCH, toAppUnit, eligibility, fillability, recipePer100, checkProposal,
                   createBatch, applyBatch, rollbackBatch, inventory };
