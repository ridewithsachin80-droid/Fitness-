/**
 * server/routes/aiFoods.js
 *
 * AI-powered food identification — fills gaps in our food database
 * automatically when a user searches for something we don't have.
 *
 * Routes:
 *   POST /api/foods/ai-identify   → Ask Claude for full nutrition of any food
 *   POST /api/foods/ai-confirm    → Save AI-identified food to DB permanently
 *
 * Auth: authenticated users only (authMW)
 * The confirmed food is saved with source='ai', verified=false.
 * Admins can later set verified=true via existing PUT /api/foods/:id route.
 *
 * How it plugs in — add to server/index.js:
 *   const aiFoodsRoutes = require('./routes/aiFoods');
 *   app.use('/api/foods', aiFoodsRoutes);          // BEFORE the main foodsRoutes line
 */

const router  = require('express').Router();
const pool    = require('../db/pool');
const axios   = require('axios');
const authMW  = require('../middleware/auth');

router.use(authMW);

// ── Re-use the normaliser from foods.js ──────────────────────────────────────
function normaliseNutrients(raw = {}) {
  const fiber     = parseFloat(raw.fiber)       || 0;
  const totalCarb = parseFloat(raw.total_carbs) || 0;
  return {
    calories:      parseFloat(raw.calories)      || 0,
    protein:       parseFloat(raw.protein)       || 0,
    total_carbs:   totalCarb,
    net_carbs:     parseFloat(raw.net_carbs)     ?? Math.max(0, +(totalCarb - fiber).toFixed(1)),
    fat:           parseFloat(raw.fat)           || 0,
    fiber,
    sugar:         parseFloat(raw.sugar)         || 0,
    saturated_fat: parseFloat(raw.saturated_fat) || 0,
    trans_fat:     parseFloat(raw.trans_fat)     || 0,
    cholesterol:   parseFloat(raw.cholesterol)   || 0,
    omega3_ala:    parseFloat(raw.omega3_ala)    || 0,
    omega3_epa:    parseFloat(raw.omega3_epa)    || 0,
    omega3_dha:    parseFloat(raw.omega3_dha)    || 0,
    omega6:        parseFloat(raw.omega6)        || 0,
    omega9_mufa:   parseFloat(raw.omega9_mufa)   || 0,
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
  };
}

// ── Claude prompt builder ────────────────────────────────────────────────────
function buildPrompt(foodName) {
  return `You are a professional nutritionist and food scientist with access to authoritative
nutrition databases (USDA FoodData Central, NIN India, WHO).

A user searched for: "${foodName}"

Return a single valid JSON object (no markdown, no explanation, just the raw JSON)
with EXACT nutritional values per 100g for this food. If the food is Indian or regional,
use the most common preparation (e.g. cooked, without oil unless the food inherently has it).

Required JSON structure:
{
  "name": "canonical English name",
  "name_hindi": "Hindi name if applicable, else null",
  "name_local": "regional/local name if applicable, else null",
  "name_aliases": ["alias1", "alias2"],
  "category": "one of: Cereals & Grains | Pulses & Legumes | Vegetables | Fruits | Dairy | Meat & Fish | Nuts & Seeds | Oils & Fats | Beverages | Snacks & Sweets | Spices & Condiments | Supplements | Other",
  "description": "2-3 sentence description of the food, its origin, and primary health properties",
  "serving_sizes": [
    {"label": "1 cup", "grams": 240},
    {"label": "1 tbsp", "grams": 15}
  ],
  "dietary_tags": ["vegan", "vegetarian", "gluten-free", "dairy-free", "keto-friendly", "high-protein"],
  "health_note": "One sentence about the most notable health benefit or caution",
  "data_confidence": "high | medium | low",
  "per_100g": {
    "calories": 0,
    "protein": 0,
    "total_carbs": 0,
    "net_carbs": 0,
    "fat": 0,
    "fiber": 0,
    "sugar": 0,
    "saturated_fat": 0,
    "trans_fat": 0,
    "cholesterol": 0,
    "omega3_ala": 0,
    "omega3_epa": 0,
    "omega3_dha": 0,
    "omega6": 0,
    "omega9_mufa": 0,
    "vit_a": 0,
    "vit_b1": 0,
    "vit_b2": 0,
    "vit_b3": 0,
    "vit_b5": 0,
    "vit_b6": 0,
    "vit_b12": 0,
    "vit_c": 0,
    "vit_d": 0,
    "vit_e": 0,
    "vit_k": 0,
    "folate": 0,
    "biotin": 0,
    "choline": 0,
    "calcium": 0,
    "iron": 0,
    "magnesium": 0,
    "phosphorus": 0,
    "potassium": 0,
    "sodium": 0,
    "zinc": 0,
    "copper": 0,
    "manganese": 0,
    "selenium": 0
  }
}

Units: calories in kcal · all others in grams (macros) or milligrams (micros/minerals) per 100g.
Return ONLY the JSON. No text before or after.`;
}

// ── POST /api/foods/ai-identify ──────────────────────────────────────────────
// Step 1: identify & return nutrition without saving to DB yet
// Body: { name: string }
// Returns: { food: FoodObject, alreadyExists: bool, existingId?: number }
router.post('/ai-identify', async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Food name required (min 2 chars)' });
  }

  const cleanName = name.trim();

  // 1. Check if we already have it in the DB (exact or close match)
  try {
    const existing = await pool.query(
      `SELECT id, name, per_100g FROM foods
       WHERE LOWER(name) = LOWER($1)
          OR LOWER(name_aliases::text) LIKE LOWER($2)
       LIMIT 1`,
      [cleanName, `%${cleanName}%`]
    );
    if (existing.rows.length) {
      return res.json({
        alreadyExists: true,
        existingId: existing.rows[0].id,
        food: existing.rows[0],
      });
    }
  } catch (dbErr) {
    console.error('DB pre-check failed:', dbErr.message);
    // Non-fatal — continue to AI
  }

  // 2. Call Claude API
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AI service not configured (missing ANTHROPIC_API_KEY)' });

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: buildPrompt(cleanName) }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 25000,
      }
    );

    const rawText = response.data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Strip markdown fences if model adds them
    const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const food = JSON.parse(jsonText);

    // Normalise the per_100g block to guarantee all 36 fields
    food.per_100g = normaliseNutrients(food.per_100g);

    return res.json({ alreadyExists: false, food });
  } catch (err) {
    console.error('AI identify error:', err.response?.data || err.message);
    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: 'AI returned malformed data — please try again' });
    }
    return res.status(502).json({ error: 'AI service error — please try again' });
  }
});

// ── POST /api/foods/ai-confirm ───────────────────────────────────────────────
// Step 2: user confirms they want to save this food to the shared DB
// Body: { food: FoodObject }  (the object returned by ai-identify)
// Returns: { id: number, name: string, message: string }
router.post('/ai-confirm', async (req, res) => {
  const { food } = req.body;
  if (!food || !food.name || !food.per_100g) {
    return res.status(400).json({ error: 'Invalid food object' });
  }

  try {
    const per100g = normaliseNutrients(food.per_100g);
    const aliases = Array.isArray(food.name_aliases) ? food.name_aliases : [];

    const { rows } = await pool.query(
      `INSERT INTO foods
         (name, name_hindi, name_local, name_aliases, category, source, verified, per_100g)
       VALUES ($1,$2,$3,$4,$5,'ai',false,$6)
       ON CONFLICT (name) DO UPDATE
         SET per_100g = EXCLUDED.per_100g,
             name_aliases = EXCLUDED.name_aliases,
             source = 'ai'
       RETURNING id, name`,
      [
        food.name.trim(),
        food.name_hindi   || null,
        food.name_local   || null,
        JSON.stringify(aliases),
        food.category     || 'Other',
        JSON.stringify(per100g),
      ]
    );

    // Also save aliases as separate searchable entries (ON CONFLICT DO NOTHING)
    for (const alias of aliases) {
      if (alias && alias !== food.name) {
        await pool.query(
          `INSERT INTO foods (name, category, source, verified, per_100g)
           VALUES ($1,$2,'ai',false,$3)
           ON CONFLICT (name) DO NOTHING`,
          [alias.trim(), food.category || 'Other', JSON.stringify(per100g)]
        ).catch(() => {}); // silently skip if alias conflicts
      }
    }

    return res.json({
      id: rows[0].id,
      name: rows[0].name,
      message: `"${rows[0].name}" saved to the food database. Everyone can now search for it.`,
    });
  } catch (err) {
    console.error('ai-confirm DB error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This food already exists in the database' });
    }
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
