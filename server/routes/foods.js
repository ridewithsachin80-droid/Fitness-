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

// ─── All routes require authentication ────────────────────────────────────────
router.use(authMW);

// ─── NUTRIENT FIELD DEFAULTS ──────────────────────────────────────────────────
// Ensures every food stored has all 36 fields even if source omits some
function normaliseNutrients(raw = {}) {
  const fiber     = parseFloat(raw.fiber)    || 0;
  const totalCarb = parseFloat(raw.total_carbs) || 0;
  return {
    // Macros (10)
    calories:      parseFloat(raw.calories)      || 0,
    protein:       parseFloat(raw.protein)       || 0,
    total_carbs:   totalCarb,
    net_carbs:     parseFloat(raw.net_carbs)     ?? Math.max(0, +(totalCarb - fiber).toFixed(1)),
    fat:           parseFloat(raw.fat)           || 0,
    fiber:         fiber,
    sugar:         parseFloat(raw.sugar)         || 0,
    saturated_fat: parseFloat(raw.saturated_fat) || 0,
    trans_fat:     parseFloat(raw.trans_fat)     || 0,
    cholesterol:   parseFloat(raw.cholesterol)   || 0,
    // Fat types (5)
    omega3_ala:    parseFloat(raw.omega3_ala)    || 0,
    omega3_epa:    parseFloat(raw.omega3_epa)    || 0,
    omega3_dha:    parseFloat(raw.omega3_dha)    || 0,
    omega6:        parseFloat(raw.omega6)        || 0,
    omega9_mufa:   parseFloat(raw.omega9_mufa)   || 0,
    // Vitamins (14)
    vit_a:   parseFloat(raw.vit_a)   || 0,
    vit_b1:  parseFloat(raw.vit_b1)  || 0,
    vit_b2:  parseFloat(raw.vit_b2)  || 0,
    vit_b3:  parseFloat(raw.vit_b3)  || 0,
    vit_b5:  parseFloat(raw.vit_b5)  || 0,
    vit_b6:  parseFloat(raw.vit_b6)  || 0,
    vit_b12: parseFloat(raw.vit_b12) || 0,
    vit_c:   parseFloat(raw.vit_c)   || 0,
    vit_d:   parseFloat(raw.vit_d)   || 0,
    vit_e:   parseFloat(raw.vit_e)   || 0,
    vit_k:   parseFloat(raw.vit_k)   || 0,
    folate:  parseFloat(raw.folate)  || 0,
    biotin:  parseFloat(raw.biotin)  || 0,
    choline: parseFloat(raw.choline) || 0,
    // Minerals (10)
    calcium:    parseFloat(raw.calcium)    || 0,
    iron:       parseFloat(raw.iron)       || 0,
    magnesium:  parseFloat(raw.magnesium)  || 0,
    phosphorus: parseFloat(raw.phosphorus) || 0,
    potassium:  parseFloat(raw.potassium)  || 0,
    sodium:     parseFloat(raw.sodium)     || 0,
    zinc:       parseFloat(raw.zinc)       || 0,
    copper:     parseFloat(raw.copper)     || 0,
    manganese:  parseFloat(raw.manganese)  || 0,
    selenium:   parseFloat(raw.selenium)   || 0,
    // Bioactives (6)
    glycemic_index:  raw.glycemic_index  != null ? parseFloat(raw.glycemic_index)  : null,
    glycemic_load:   raw.glycemic_load   != null ? parseFloat(raw.glycemic_load)   : null,
    probiotic:       raw.probiotic === true || raw.probiotic === 'true' || false,
    prebiotic_fiber: parseFloat(raw.prebiotic_fiber) || 0,
    lycopene:        parseFloat(raw.lycopene)        || 0,
    beta_glucan:     parseFloat(raw.beta_glucan)     || 0,
  };
}

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

    // Priority: exact start-of-name match first, then full-text, then partial
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
      ${filterClauses}
      ORDER BY
        CASE
          WHEN name ILIKE '${q}%'        THEN 0
          WHEN name_local ILIKE '${q}%'  THEN 1
          WHEN name ILIKE $1             THEN 2
          ELSE 3
        END,
        verified DESC,
        name ASC
      LIMIT $3
    `;

    const { rows } = await pool.query(sql, params);
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
router.use(role('admin'));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/foods
// Admin manually adds a new food with full nutrient data.
// Body: { name, name_hindi?, name_local?, category, source?, per_100g }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const {
    name, name_hindi, name_local,
    category, source = 'manual',
    per_100g = {},
  } = req.body;

  if (!name || !category) {
    return res.status(400).json({ error: 'name and category are required' });
  }

  const validCategories = ['dairy','grain','vegetable','fruit','nut','oil','supplement','branded','other'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${validCategories.join(', ')}` });
  }

  const normNutrients = normaliseNutrients(per_100g);

  try {
    const { rows } = await pool.query(
      `INSERT INTO foods (name, name_hindi, name_local, category, source, verified, per_100g)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       RETURNING id, name, name_hindi, name_local, category, source, verified, per_100g`,
      [
        name.trim(),
        name_hindi  || null,
        name_local  || null,
        category,
        source,
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
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid food id' });

  const {
    name, name_hindi, name_local,
    category, source, verified,
    per_100g,
  } = req.body;

  try {
    // Fetch existing first
    const existing = await pool.query('SELECT * FROM foods WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Food not found' });

    const prev = existing.rows[0];

    const normNutrients = per_100g
      ? normaliseNutrients({ ...prev.per_100g, ...per_100g })
      : prev.per_100g;

    const validCategories = ['dairy','grain','vegetable','fruit','nut','oil','supplement','branded','other'];
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${validCategories.join(', ')}` });
    }

    const { rows } = await pool.query(
      `UPDATE foods SET
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
      ]
    );

    res.json(rows[0]);
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
router.get('/admin/list', authMW, role('admin'), async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 30);
    const q     = req.query.q || '';
    const offset = (page - 1) * limit;

    const where = q
      ? `WHERE (LOWER(name) LIKE $3 OR LOWER(name_local) LIKE $3)`
      : '';
    const params = q
      ? [`%${q.toLowerCase()}%`, limit, offset]
      : [limit, offset];
    const countParams = q ? [`%${q.toLowerCase()}%`] : [];

    const [rows, countRes] = await Promise.all([
      pool.query(
        `SELECT id, name, name_hindi, name_local, category, source, verified,
           per_100g->>'calories' AS kcal_per_100g
         FROM foods ${where.replace(/\$3/g,'$1')} ORDER BY name ASC LIMIT $${q?2:1} OFFSET $${q?3:2}`,
        q ? [`%${q.toLowerCase()}%`, limit, offset] : [limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM foods ${q ? 'WHERE (LOWER(name) LIKE $1 OR LOWER(name_local) LIKE $1)' : ''}`,
        countParams
      ),
    ]);

    res.json({
      foods: rows.rows,
      total: parseInt(countRes.rows[0].count),
      page,
      pages: Math.ceil(parseInt(countRes.rows[0].count) / limit),
    });
  } catch (err) {
    console.error('GET /api/foods/admin/list error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
