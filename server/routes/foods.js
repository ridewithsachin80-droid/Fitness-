/**
 * server/routes/foods.js
 * Sprint 1 — Food search API
 *
 * Routes:
 *   GET  /api/foods/search?q=&category=&limit=  Full-text search
 *   POST /api/foods/lookup                       Open Food Facts fallback by barcode or name
 *   POST /api/foods                              Admin manually adds a food
 *   PUT  /api/foods/:id                          Admin edits / verifies a food
 *   GET  /api/foods/:id                          Get single food by ID
 *
 * Auth:
 *   Search and single-food GET: any authenticated user (authMW)
 *   POST / PUT: admin only (authMW + role('admin'))
 *
 * Conventions (from handoff):
 *   - Always use api client on frontend; this is the backend counterpart
 *   - DB constraint errors (23505 unique, 23503 FK) → 409 / 400
 *   - Generic errors → 500
 *   - per_100g JSONB must contain all 36 nutrient fields
 */

const router = require('express').Router();
const pool   = require('../db/pool');
const axios  = require('axios');
const authMW = require('../middleware/auth');
const role   = require('../middleware/roleCheck');
const { macroPlausibility, cookingFatPlausibility, massBalance } = require('../services/macroCheck');
const { propagationImpact, propagateFoodNutrition } = require('../services/foodPropagate');
const { saturatedPlausibility } = require('../services/fatProfile');

// ─── All routes require authentication ────────────────────────────────────────
router.use(authMW);

// One implementation, in services/nutrients.js. This file held the widest of
// three copies — 45 fields against 39 — so the module carries the union.
const { normaliseNutrients } = require('../services/nutrients');


// ─── Open Food Facts nutrient mapper ─────────────────────────────────────────
// Maps OFF API response to our nutrient schema (values already per 100g in OFF)
function mapOffNutrients(nutriments = {}) {
  return normaliseNutrients({
    calories:      nutriments['energy-kcal_100g'] || nutriments['energy-kcal'] || 0,
    protein:       nutriments['proteins_100g']    || 0,
    total_carbs:   nutriments['carbohydrates_100g'] || 0,
    fat:           nutriments['fat_100g']          || 0,
    fiber:         nutriments['fiber_100g']        || 0,
    sugar:         nutriments['sugars_100g']       || 0,
    saturated_fat: nutriments['saturated-fat_100g'] || 0,
    trans_fat:     nutriments['trans-fat_100g']    || 0,
    cholesterol:   (nutriments['cholesterol_100g'] || 0) * 1000, // g → mg
    sodium:        (nutriments['sodium_100g']      || 0) * 1000, // g → mg
    potassium:     (nutriments['potassium_100g']   || 0) * 1000,
    calcium:       (nutriments['calcium_100g']     || 0) * 1000,
    iron:          (nutriments['iron_100g']        || 0) * 1000,
    magnesium:     (nutriments['magnesium_100g']   || 0) * 1000,
    phosphorus:    (nutriments['phosphorus_100g']  || 0) * 1000,
    zinc:          (nutriments['zinc_100g']        || 0) * 1000,
    vit_a:         (nutriments['vitamin-a_100g']   || 0) * 1000000, // g → mcg
    vit_c:         (nutriments['vitamin-c_100g']   || 0) * 1000,    // g → mg
    vit_d:         (nutriments['vitamin-d_100g']   || 0),
    vit_e:         (nutriments['vitamin-e_100g']   || 0) * 1000,
    vit_k:         (nutriments['vitamin-k_100g']   || 0) * 1000000,
    folate:        (nutriments['folate_100g']      || nutriments['folic-acid_100g'] || 0) * 1000000,
    omega3_ala:    (nutriments['alpha-linolenic-acid_100g'] || 0) * 1000,
    omega3_epa:    (nutriments['eicosapentaenoic-acid_100g'] || 0) * 1000,
    omega3_dha:    (nutriments['docosahexaenoic-acid_100g']  || 0) * 1000,
    omega6:        (nutriments['linoleic-acid_100g'] || 0) * 1000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/foods/search?q=&category=&source=&limit=
// Full-text search on name + name_local. Returns up to 10 results with all
// nutrient fields. Used by FoodLog autocomplete and meal plan builder.
// ─────────────────────────────────────────────────────────────────────────────
// ── GET /api/foods/review ────────────────────────────────────────────────────
// Unverified foods, ordered by how many members actually log them.
//
// The AI chat saves what it estimates as source='ai', verified=false. Without
// a way to find those rows the database quietly fills with guesses nobody
// reviews. Ordering by real usage means ten minutes of a coach's time is spent
// on the food forty members eat rather than the one logged once.
//
// Declared before '/:id' so "review" is not read as a food id.
// '/unverified' is the name Sprint L3 specifies; '/review' is what the shipped
// client already calls. One handler on both paths — the same pattern as
// /coaches|/monitors in admin.js — because a PWA whose service worker has not
// updated is still asking for the old one. Two handlers would drift.
router.get(['/review', '/unverified'], authMW, role('monitor', 'admin'), async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const flaggedOnly = req.query.flagged === '1';
    const { rows } = await pool.query(
      `WITH logged AS (
         SELECT LOWER(TRIM(item->>'name')) AS name,
                COUNT(*)                        AS times_logged,
                COUNT(DISTINCT patient_id)      AS members,
                MAX(log_date)                   AS last_logged
         FROM daily_logs, jsonb_array_elements(food_items) AS item
         WHERE food_items IS NOT NULL
           AND jsonb_typeof(food_items) = 'array'
           AND item->>'name' IS NOT NULL
         GROUP BY 1
       )
       SELECT f.id, f.name, f.category, f.source, f.verified, f.per_100g, f.created_at,
              f.verified_by, f.verified_at,
              COALESCE(l.times_logged, 0) AS times_logged,
              COALESCE(l.members, 0)      AS members,
              l.last_logged
       FROM foods f
       LEFT JOIN logged l ON l.name = LOWER(TRIM(f.name))
       WHERE f.verified = false
       ORDER BY COALESCE(l.members, 0) DESC,
                COALESCE(l.times_logged, 0) DESC,
                f.created_at DESC
       LIMIT $1`, [limit]);

    // ── Macro consistency (L3.3) ─────────────────────────────────────────────
    // The highest-value part of this queue and the easiest to skip. A food
    // whose stated calories contradict its own macros is wrong in a way that
    // needs no human to detect — and those are exactly the rows quietly
    // distorting every calorie total for every member who logs them. So they
    // are computed here and sorted to the front, ahead of pure usage.
    // ── Cross-check against the verified table ───────────────────────────────
    // "Masala Dosa" at 140 kcal/100g passes the Atwater check — its numbers
    // agree with each other. What gives it away is that the VERIFIED "Dosa
    // (Plain)" is 168. A dish cannot be lighter than the plain version of
    // itself: the masala one has the oil plus a potato filling.
    //
    // This needs no hardcoded figures. It asks the food table what the plain
    // version costs, and that reference improves as the queue gets worked.
    const { rows: baseline } = await pool.query(
      `SELECT name, (per_100g->>'calories')::float AS kcal
         FROM foods
        WHERE verified = true AND (per_100g->>'calories')::float > 0`);

    const lighterThanBase = (f) => {
      const kcal = parseFloat(f.per_100g?.calories) || 0;
      if (!kcal) return null;
      const words = String(f.name).toLowerCase().replace(/[()]/g, ' ').split(/\s+/).filter(w => w.length > 3);
      if (words.length < 2) return null;   // a one-word name has no base to compare with
      let worst = null;
      for (const b of baseline) {
        const bn = String(b.name).toLowerCase().replace(/\(.*$/, '').trim();
        if (bn.length < 4 || bn === String(f.name).toLowerCase()) continue;
        // The unverified name must CONTAIN the verified one — "Masala Dosa"
        // contains "Dosa". A richer dish, so it cannot cost less.
        if (!words.includes(bn) && !String(f.name).toLowerCase().includes(` ${bn}`)) continue;
        if (kcal < b.kcal * 0.9 && (!worst || b.kcal > worst.kcal)) worst = b;
      }
      return worst
        ? `${Math.round(kcal)} kcal, but plain ${worst.name} is ${Math.round(worst.kcal)} — a richer dish cannot cost less`
        : null;
    };

    const flagged = rows.map(f => {
      const macro   = macroPlausibility(f.per_100g, f.name);
      const cooking = cookingFatPlausibility(f.per_100g, f.name);
      const sat     = saturatedPlausibility(f.per_100g);
      const mass    = massBalance(f.per_100g);
      const lighter = lighterThanBase(f);
      // One verdict for the UI, worst-first, so the queue can sort on it.
      // Impossible outranks merely suspicious. A food describing 125g of
      // substance inside 100g is not a judgement call, and it should not sit
      // behind three softer warnings in the queue.
      const reason = mass.status === 'impossible' ? mass.reason
                   : macro.status === 'suspect' ? macro.reason
                   : lighter ? lighter
                   : cooking.status === 'suspect' ? cooking.reason
                   : sat.status === 'suspect' ? sat.reason
                   : null;
      return { ...f,
        macro_check: reason ? { ...macro, status: 'suspect', reason } : macro,
        checks: { macro: macro.status, cooking: cooking.status, saturated: sat.status,
                  mass: mass.status, lighter_than_base: !!lighter },
        mass_balance: mass,
      };
    });
    // Impossible first, then merely suspect.
    const suspect = f => (f.checks?.mass === 'impossible' ? 2
                        : f.macro_check.status === 'suspect' ? 1 : 0);
    flagged.sort((a, b) => suspect(b) - suspect(a));

    const out = flaggedOnly ? flagged.filter(f => f.macro_check.status === 'suspect') : flagged;

    const { rows: [tot] } = await pool.query(
      `SELECT COUNT(*)::int AS unverified FROM foods WHERE verified = false`);

    res.json({
      foods: out,
      unverified_total: tot.unverified,
      // Counted over the page, not the table — say so rather than let it read
      // as "3 bad foods in the database".
      flagged_in_page: flagged.filter(f => f.macro_check.status === 'suspect').length,
      page_size: rows.length,
    });
  } catch (err) {
    console.error('GET /foods/review error:', err);
    res.status(500).json({ error: 'Could not load the review queue' });
  }
});

// ── PATCH /api/foods/:id/verify ──────────────────────────────────────────────
// One tap to mark a food trusted, which is the whole point of the queue.
router.patch('/:id/verify', authMW, role('monitor', 'admin'), async (req, res) => {
  try {
    const on = req.body?.verified !== false;
    // Provenance (L3.4). Nothing is recomputed — the macros stand as they are;
    // we only record that a human looked. Un-verifying clears the trail rather
    // than leaving a stale name attached to a food nobody stands behind.
    const { rows } = await pool.query(
      `UPDATE foods
          SET verified    = $2,
              verified_by = CASE WHEN $2 THEN $3::int ELSE NULL END,
              verified_at = CASE WHEN $2 THEN NOW()   ELSE NULL END
        WHERE id = $1
    RETURNING id, name, verified, verified_by, verified_at`,
      [req.params.id, on, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Food not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /foods/:id/verify error:', err);
    res.status(500).json({ error: 'Could not update the food' });
  }
});

router.get('/search', async (req, res) => {
  try {
    const q        = (req.query.q        || '').trim();
    const category = (req.query.category || '').trim();
    const source   = (req.query.source   || '').trim();
    const limit    = Math.min(parseInt(req.query.limit) || 10, 50);

    if (!q) return res.json([]);

    // Build query with optional filters
    const params = [`%${q}%`, `%${q}%`, limit];
    let filterClauses = '';
    let paramIdx = 4;

    if (category) {
      filterClauses += ` AND category = $${paramIdx++}`;
      params.push(category);
    }
    if (source) {
      filterClauses += ` AND source = $${paramIdx++}`;
      params.push(source);
    }

    // Priority: exact start-of-name match first, then contains, then alias
    // $4 = prefix pattern for safe ORDER BY parameterisation
    const prefixPattern = `${q}%`;
    params.splice(2, 0, prefixPattern);   // insert at index 2 → becomes $3
    // Re-number: $1=contains, $2=contains, $3=prefix, $4=limit; filters start at $5
    // Rebuild from scratch to keep param numbering clean
    const baseParams = [`%${q}%`, `%${q}%`, prefixPattern, limit];
    let safeFilterClauses = '';
    let safeIdx = 5;
    if (category) { safeFilterClauses += ` AND category = $${safeIdx++}`; baseParams.push(category); }
    if (source)   { safeFilterClauses += ` AND source   = $${safeIdx++}`; baseParams.push(source); }

    const sql = `
      SELECT
        id, name, name_hindi, name_local, name_aliases, category, source, verified, per_100g
      FROM foods
      WHERE (
        name        ILIKE $1
        OR name_local ILIKE $2
        OR name_hindi ILIKE $1
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(name_aliases, '[]'::jsonb)) alias
          WHERE alias ILIKE $1
        )
      )
      ${safeFilterClauses}
      ORDER BY
        CASE
          WHEN name       ILIKE $3 THEN 0
          WHEN name_local ILIKE $3 THEN 1
          WHEN name       ILIKE $1 THEN 2
          ELSE 3
        END,
        verified DESC,
        name ASC
      LIMIT $4
    `;

    const { rows } = await pool.query(sql, baseParams);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/foods/search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/foods/:id
// Get a single food by ID (used by meal plan builder to refresh a saved item)
// ─────────────────────────────────────────────────────────────────────────────
// ── Meal presets & repeat-a-day (Sprint 5) ───────────────────────────────────
// Declared BEFORE '/:id' — otherwise "presets" is parsed as a food id — and
// before the router.use(role('admin')) further down, which would otherwise
// lock members out of their own presets.

/** GET /api/foods/presets — the member's saved meal combinations. */
router.get('/presets', authMW, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, meal, items, created_at
         FROM meal_presets WHERE patient_id = $1
        ORDER BY created_at DESC`, [req.user.id]);
    res.json(rows);
  } catch (err) {
    console.error('GET /foods/presets error:', err.message);
    res.status(500).json({ error: 'Could not load your saved meals' });
  }
});

/** POST /api/foods/presets — save the current meal as a named combination. */
router.post('/presets', authMW, async (req, res) => {
  const { name, meal, items } = req.body || {};
  const label = String(name || '').trim();
  if (!label)                 return res.status(400).json({ error: 'Give this meal a name' });
  if (label.length > 80)      return res.status(400).json({ error: 'That name is too long' });
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Nothing to save — add some food first' });
  }
  if (items.length > 40)      return res.status(400).json({ error: 'That is too many items for one preset' });

  // Store only the fields the logger needs. Anything else the client happens
  // to be holding (ids from a search result, UI flags) is dropped rather than
  // persisted into a JSONB blob nobody will maintain.
  const clean = items.map(i => ({
    food_id:  i.food_id ?? i.id ?? null,
    name:     String(i.name || '').slice(0, 120),
    grams:    Number(i.grams) || 0,
    per_100g: i.per_100g && typeof i.per_100g === 'object' ? i.per_100g : null,
  })).filter(i => i.name && i.grams > 0);

  if (!clean.length) return res.status(400).json({ error: 'Those items had no quantities' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO meal_presets (patient_id, name, meal, items)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (patient_id, name) DO UPDATE
         SET items = EXCLUDED.items, meal = EXCLUDED.meal, created_at = NOW()
       RETURNING id, name, meal, items, created_at`,
      [req.user.id, label, meal || null, JSON.stringify(clean)]);
    res.json(rows[0]);
  } catch (err) {
    console.error('POST /foods/presets error:', err.message);
    res.status(500).json({ error: 'Could not save that meal' });
  }
});

/** DELETE /api/foods/presets/:id — scoped to the owner. */
router.delete('/presets/:id', authMW, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM meal_presets WHERE id = $1 AND patient_id = $2',
      [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Saved meal not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /foods/presets error:', err.message);
    res.status(500).json({ error: 'Could not delete that' });
  }
});

/**
 * GET /api/foods/yesterday?meal=breakfast
 *
 * Yesterday's food, ready to re-log. Backs "same as yesterday" — the single
 * biggest reduction in daily logging effort, because breakfast and one or two
 * other meals repeat heavily week to week.
 *
 * Yesterday is computed in IST to match every other date in the app.
 */
router.get('/yesterday', authMW, async (req, res) => {
  const meal = req.query.meal ? String(req.query.meal).toLowerCase() : null;
  try {
    const { rows } = await pool.query(
      `SELECT food_items FROM daily_logs
        WHERE patient_id = $1
          AND log_date = ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day')::date`,
      [req.user.id]);

    const all = Array.isArray(rows[0]?.food_items) ? rows[0].food_items : [];
    const items = meal
      ? all.filter(i => String(i.meal || '').toLowerCase() === meal)
      : all;
    res.json({ items, meal, count: items.length });
  } catch (err) {
    console.error('GET /foods/yesterday error:', err.message);
    res.status(500).json({ error: "Could not load yesterday's food" });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, name_hindi, name_local, category, source, verified, per_100g FROM foods WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Food not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/foods/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/foods/lookup
// Open Food Facts fallback — called when search returns no results.
// Accepts: { barcode } OR { name } (name search for non-barcoded items)
// Auto-saves the result to the foods table as source='off', verified=false.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/lookup', async (req, res) => {
  const { barcode, name } = req.body;

  if (!barcode && !name) {
    return res.status(400).json({ error: 'Provide barcode or name' });
  }

  try {
    let product = null;

    if (barcode) {
      // Barcode lookup
      const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,brands,categories_tags,nutriments,image_url`;
      const { data } = await axios.get(url, { timeout: 8000 });

      if (data.status !== 1 || !data.product) {
        return res.status(404).json({ error: 'Product not found on Open Food Facts' });
      }
      product = data.product;
    } else {
      // Name search on Open Food Facts
      const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(name)}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,brands,categories_tags,nutriments`;
      const { data } = await axios.get(url, { timeout: 8000 });

      if (!data.products || data.products.length === 0) {
        return res.status(404).json({ error: 'Not found on Open Food Facts' });
      }
      product = data.products[0];
    }

    if (!product.nutriments) {
      return res.status(422).json({ error: 'Product found but has no nutriment data' });
    }

    const foodName   = [product.product_name, product.brands].filter(Boolean).join(' — ').trim()
                       || name || `Barcode ${barcode}`;
    const per_100g   = mapOffNutrients(product.nutriments);
    const categories = (product.categories_tags || []);
    const category   = categories.some(c => c.includes('supplement') || c.includes('vitamin'))
      ? 'supplement'
      : categories.some(c => c.includes('dairy') || c.includes('milk') || c.includes('yogurt'))
        ? 'dairy'
        : categories.some(c => c.includes('nut') || c.includes('seed'))
          ? 'nut'
          : 'branded';

    // Check if already in DB (avoid duplicate OFF saves)
    const existing = await pool.query(
      `SELECT id FROM foods WHERE lower(name) = lower($1) AND source = 'off' LIMIT 1`,
      [foodName]
    );

    let foodId;
    if (existing.rows.length) {
      foodId = existing.rows[0].id;
    } else {
      const ins = await pool.query(
        `INSERT INTO foods (name, category, source, verified, per_100g)
         VALUES ($1, $2, 'off', false, $3)
         ON CONFLICT (lower(name), source) DO UPDATE
           SET per_100g = EXCLUDED.per_100g
         RETURNING id`,
        [foodName, category, JSON.stringify(per_100g)]
      );
      foodId = ins.rows[0].id;
    }

    res.json({ id: foodId, name: foodName, category, source: 'off', verified: false, per_100g });
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return res.status(504).json({ error: 'Open Food Facts timed out. Try again.' });
    }
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'Not found on Open Food Facts' });
    }
    console.error('POST /api/foods/lookup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin-only routes below ──────────────────────────────────────────────────
// GET /api/foods/:id/impact — what a correction would touch, before doing it.
// Declared above PUT so the coach can be shown the number first; nothing is
// written by this call.
router.get('/:id/impact', authMW, role('monitor', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid food id' });
  try {
    res.json(await propagationImpact(id));
  } catch (err) {
    console.error('GET /foods/:id/impact error:', err.message);
    res.status(500).json({ error: 'Could not work out the impact' });
  }
});

router.use(role('admin'));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/foods
// Admin manually adds a new food with full nutrient data.
// Body: { name, name_hindi?, name_local?, category, source?, per_100g }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const {
    name, name_hindi, name_local,
    category, source = 'manual', verified = true,
    per_100g = {},
  } = req.body;

  if (!name || !category) {
    return res.status(400).json({ error: 'name and category are required' });
  }

  // Kept in sync with the DB CHECK constraint in schema.sql (foods_category_check)
  const validCategories = [
    'dairy','grain','vegetable','fruit','nut','oil',
    'supplement','branded','other','pulse','meat','beverage','spice',
  ];
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${validCategories.join(', ')}` });
  }

  const normNutrients = normaliseNutrients(per_100g);

  try {
    const { rows } = await pool.query(
      `INSERT INTO foods (name, name_hindi, name_local, category, source, verified, per_100g)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, name_hindi, name_local, category, source, verified, per_100g`,
      [
        name.trim(),
        name_hindi  || null,
        name_local  || null,
        category,
        source,
        !!verified,
        JSON.stringify(normNutrients),
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A food with this name already exists from this source' });
    }
    console.error('POST /api/foods error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/foods/:id
// Admin edits a food. Can update any field including verified status.
// Partial update — only supplied fields are changed.
// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/foods/:id   body may include { propagate: true }
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid food id' });

  const {
    name, name_hindi, name_local,
    category, source, verified,
    per_100g,
    default_grams,
    propagate = false,
    propagate_portion = false,
  } = req.body;

  try {
    // Fetch existing first
    const existing = await pool.query('SELECT * FROM foods WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Food not found' });

    const prev = existing.rows[0];

    const normNutrients = per_100g
      ? normaliseNutrients({ ...prev.per_100g, ...per_100g })
      : prev.per_100g;

    const validCategories = [
      'dairy','grain','vegetable','fruit','nut','oil',
      'supplement','branded','other','pulse','meat','beverage','spice',
    ];
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${validCategories.join(', ')}` });
    }

    const { rows } = await pool.query(
      `UPDATE foods SET
        default_grams = $9,
        name        = $1,
        name_hindi  = $2,
        name_local  = $3,
        category    = $4,
        source      = $5,
        verified    = $6,
        per_100g    = $7
       WHERE id = $8
       RETURNING id, name, name_hindi, name_local, category, source, verified, per_100g`,
      [
        name       ?? prev.name,
        name_hindi ?? prev.name_hindi,
        name_local ?? prev.name_local,
        category   ?? prev.category,
        source     ?? prev.source,
        verified   != null ? verified : prev.verified,
        JSON.stringify(normNutrients),
        id,
        // Null clears it; undefined leaves whatever was there.
        default_grams === undefined ? prev.default_grams
          : (Number.isFinite(parseInt(default_grams)) && parseInt(default_grams) > 0
             ? parseInt(default_grams) : null),
      ]
    );

    // ── Push the correction back through history, if asked ────────────────
    // Opt-in. A logged food keeps a snapshot of its nutrition on purpose, so a
    // member's history does not silently rewrite itself whenever the table is
    // edited. But a food that was WRONG was wrong for everyone who ever logged
    // it, and their weekly reports and adaptive calorie estimates were computed
    // from it — so the coach gets to say "yes, fix those too".
    let propagated = null;
    if (propagate && per_100g) {
      try {
        propagated = await propagateFoodNutrition(id, normNutrients, {
          // Only when the coach asked for the portion to be reset too.
          grams: propagate_portion ? parseInt(default_grams) : null,
        });
      } catch (err) {
        // The food itself is already corrected. Failing the whole request here
        // would suggest nothing was saved, and the coach would edit it again.
        console.error('propagateFoodNutrition failed:', err.message);
        propagated = { error: 'The food was corrected, but existing logs could not be updated' };
      }
    }

    res.json({ ...rows[0], propagated });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Another food with this name already exists from this source' });
    }
    console.error('PUT /api/foods/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/foods/:id — admin only ───────────────────────────────────────
router.delete('/:id', authMW, role('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query('DELETE FROM foods WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Food not found' });
    res.json({ deleted: true, id: parseInt(id) });
  } catch (err) {
    console.error('DELETE /api/foods/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/foods/admin/list — paginated list for admin food manager ─────────
// Note: authMW already applied globally via router.use(authMW) at top of file.
// role('admin') is applied via router.use(role('admin')) above this route.
// Both are listed explicitly here for clarity but are not double-applied at runtime
// because Express router.use() middleware doesn't stack on individual route handlers.
router.get('/admin/list', async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.max(1, Math.min(50, parseInt(req.query.limit) || 30));
    const q      = (req.query.q || '').toLowerCase().trim();
    const offset = (page - 1) * limit;

    let dataQuery, countQuery, dataParams, countParams;

    if (q) {
      const pattern = `%${q}%`;
      dataParams  = [pattern, limit, offset];
      countParams = [pattern];
      dataQuery   = `
        SELECT id, name, name_hindi, name_local, category, source, verified,
               per_100g->>'calories' AS kcal_per_100g
        FROM foods
        WHERE LOWER(name) LIKE $1 OR LOWER(name_local) LIKE $1
        ORDER BY name ASC
        LIMIT $2 OFFSET $3`;
      countQuery  = `
        SELECT COUNT(*) FROM foods
        WHERE LOWER(name) LIKE $1 OR LOWER(name_local) LIKE $1`;
    } else {
      dataParams  = [limit, offset];
      countParams = [];
      dataQuery   = `
        SELECT id, name, name_hindi, name_local, category, source, verified,
               per_100g->>'calories' AS kcal_per_100g
        FROM foods
        ORDER BY name ASC
        LIMIT $1 OFFSET $2`;
      countQuery  = `SELECT COUNT(*) FROM foods`;
    }

    const [dataRes, countRes] = await Promise.all([
      pool.query(dataQuery,  dataParams),
      pool.query(countQuery, countParams),
    ]);

    const total = parseInt(countRes.rows[0].count);
    res.json({
      foods: dataRes.rows,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('GET /api/foods/admin/list error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
