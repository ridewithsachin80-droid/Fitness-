/**
 * server/routes/aiFoods.js
 *
 * AI-powered food identification — fills gaps in our food database
 * automatically when a user searches for something we don't have.
 *
 * Provider chain: Groq (primary, free) → Gemini (secondary, free).
 * See the AI PROVIDERS block below for details and env var overrides.
 *
 * Routes:
 *   GET  /api/foods/ai-test       → Diagnostic: tests each configured provider (public)
 *   POST /api/foods/ai-identify   → Ask AI for full nutrition of any food
 *   POST /api/foods/ai-confirm    → Save AI-identified food to DB permanently
 *
 * Auth: authenticated users only (authMW) — ai-test is the one public exception.
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

// ── AI PROVIDERS (June 2026) ─────────────────────────────────────────────────
// PRIMARY: Groq — genuinely free ongoing tier (no expiring trial credits), fast
// LPU inference, OpenAI-compatible chat completions API. Good fit for a quick
// structured-JSON lookup like this.
// SECONDARY: Gemini — also a real ongoing free tier, and a separate capacity
// pool from Groq, so it's a useful fallback when Groq is rate-limited rather
// than a redundant copy of the same risk.
// NOT included: OpenAI's "free tier" is trial credits that expire, not an
// ongoing free option — not a fit for production use without billing enabled.
// Each provider also has its own internal model fallback chain (in case one
// specific model is overloaded). All overridable via env vars without a redeploy.
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODELS = [
  process.env.GROQ_MODEL          || 'openai/gpt-oss-120b',
  process.env.GROQ_FALLBACK_MODEL || 'llama-3.3-70b-versatile',
].filter(Boolean);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL          = process.env.GEMINI_MODEL          || 'gemini-2.5-flash-lite';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash';
const geminiUrlFor = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const GEMINI_MODELS = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL].filter(Boolean);

// ── In-memory cache — avoids repeat AI calls for same food ──────────────────
// Survives for 24h, max 500 entries, then auto-clears oldest
const aiCache = new Map();
const AI_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const AI_CACHE_MAX = 500;

function cacheGet(key) {
  const entry = aiCache.get(key.toLowerCase());
  if (!entry) return null;
  if (Date.now() - entry.ts > AI_CACHE_TTL) { aiCache.delete(key.toLowerCase()); return null; }
  return entry.food;
}

function cacheSet(key, food) {
  if (aiCache.size >= AI_CACHE_MAX) {
    // Delete oldest entry
    const oldest = aiCache.keys().next().value;
    aiCache.delete(oldest);
  }
  aiCache.set(key.toLowerCase(), { food, ts: Date.now() });
}

// ── Single-call helpers, one per provider ────────────────────────────────────
// Each returns { text, finishReason } so the orchestrator below can treat both
// providers identically regardless of their very different response shapes.
async function callGroqOnce(model, prompt) {
  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    },
    {
      headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      timeout: 30000,
    }
  );
  return {
    text: response.data.choices?.[0]?.message?.content || '',
    finishReason: response.data.choices?.[0]?.finish_reason,
  };
}

async function callGeminiOnce(model, prompt) {
  const response = await axios.post(
    `${geminiUrlFor(model)}?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
    },
    { headers: { 'content-type': 'application/json' }, timeout: 30000 }
  );
  const candidate = response.data.candidates?.[0];
  return {
    text: candidate?.content?.parts?.map(p => p.text).join('') || '',
    finishReason: candidate?.finishReason,
  };
}

// ── GET /api/foods/ai-test — PUBLIC diagnostic, no auth needed ───────────────
// Reports the live status of every configured provider, so a key/quota problem
// on one shows up immediately without having to go through the full app flow.
router.get('/ai-test', async (req, res) => {
  const results = {};

  if (GROQ_API_KEY) {
    try {
      const { text } = await callGroqOnce(GROQ_MODELS[0], 'Say hello in one word');
      results.groq = { ok: true, response: text, model: GROQ_MODELS[0], keyPrefix: GROQ_API_KEY.slice(0, 8) + '...' };
    } catch (err) {
      results.groq = { ok: false, status: err.response?.status, detail: err.response?.data || err.message, model: GROQ_MODELS[0] };
    }
  } else {
    results.groq = { ok: false, error: 'GROQ_API_KEY not set' };
  }

  if (GEMINI_API_KEY) {
    try {
      const { text } = await callGeminiOnce(GEMINI_MODEL, 'Say hello in one word');
      results.gemini = { ok: true, response: text, model: GEMINI_MODEL, keyPrefix: GEMINI_API_KEY.slice(0, 8) + '...' };
    } catch (err) {
      results.gemini = { ok: false, status: err.response?.status, detail: err.response?.data || err.message, model: GEMINI_MODEL };
    }
  } else {
    results.gemini = { ok: false, error: 'GEMINI_API_KEY not set' };
  }

  res.json(results);
});

router.use(authMW);

// ── Provider + model fallback orchestrator ───────────────────────────────────
// Tries Groq's model chain first, then Gemini's, retrying transient errors
// (429 rate-limit, 503 overloaded) with backoff before moving to the next
// model, and moving to the next provider once a provider's whole chain is
// exhausted. Returns { text, provider, model } on the first success.
async function identifyFoodViaAI(prompt) {
  const providers = [
    GROQ_API_KEY   && { name: 'groq',   models: GROQ_MODELS,   call: callGroqOnce },
    GEMINI_API_KEY && { name: 'gemini', models: GEMINI_MODELS, call: callGeminiOnce },
  ].filter(Boolean);

  if (!providers.length) {
    const err = new Error('No AI provider configured — set GROQ_API_KEY and/or GEMINI_API_KEY');
    err.response = { status: 500 };
    throw err;
  }

  let lastErr;
  for (const provider of providers) {
    for (const model of provider.models) {
      const maxRetries = 2;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const { text, finishReason } = await provider.call(model, prompt);
          if (finishReason === 'SAFETY' || finishReason === 'RECITATION' || finishReason === 'content_filter') {
            const blocked = new Error(`AI blocked the response (${finishReason})`);
            blocked.response = { status: 502 };
            throw blocked;
          }
          if (!text) {
            const empty = new Error('AI returned an empty response');
            empty.response = { status: 502 };
            throw empty;
          }
          if (provider !== providers[0] || model !== provider.models[0]) {
            console.log(`AI identify succeeded via fallback: ${provider.name}/${model}`);
          }
          return { text, provider: provider.name, model };
        } catch (err) {
          lastErr = err;
          const status = err.response?.status;
          const retryable = status === 429 || status === 503;
          if (retryable && attempt < maxRetries) {
            const wait = (attempt + 1) * 2000;
            console.log(`${provider.name}/${model} ${status} — retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(r => setTimeout(r, wait));
            continue;
          }
          if (!retryable) break; // hard failure (auth, blocked content, etc.) — skip straight to next model/provider
          console.log(`${provider.name}/${model} still ${status} after ${maxRetries} retries — trying next option`);
          break;
        }
      }
    }
  }
  throw lastErr; // every provider/model in the chain failed
}

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

// ── Category mapper — Gemini → schema ───────────────────────────────────────
// Gemini returns human-readable categories like "Cereals & Grains" or "Meat & Fish".
// The DB CHECK constraint requires lowercase single-word values.
// This maps every possible Gemini output to a valid schema category.
const GEMINI_CATEGORY_MAP = {
  'cereals & grains':         'grain',
  'cereals and grains':       'grain',
  'pulses & legumes':         'pulse',
  'pulses and legumes':       'pulse',
  'legumes':                  'pulse',
  'vegetables':               'vegetable',
  'fruits':                   'fruit',
  'dairy':                    'dairy',
  'meat & fish':              'meat',
  'meat and fish':            'meat',
  'meat':                     'meat',
  'fish':                     'meat',
  'seafood':                  'meat',
  'nuts & seeds':             'nut',
  'nuts and seeds':           'nut',
  'nuts':                     'nut',
  'seeds':                    'nut',
  'oils & fats':              'oil',
  'oils and fats':            'oil',
  'oils':                     'oil',
  'fats':                     'oil',
  'beverages':                'beverage',
  'snacks & sweets':          'branded',
  'snacks and sweets':        'branded',
  'snacks':                   'branded',
  'sweets':                   'branded',
  'spices & condiments':      'spice',
  'spices and condiments':    'spice',
  'spices':                   'spice',
  'condiments':               'spice',
  'supplements':              'supplement',
  'other':                    'other',
};

function normaliseCategory(raw) {
  if (!raw) return 'other';
  const key = String(raw).toLowerCase().trim();
  return GEMINI_CATEGORY_MAP[key] || 'other';
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

  // 0. Check in-memory AI cache first (fastest path)
  const cached = cacheGet(cleanName);
  if (cached) {
    console.log(`Cache hit for "${cleanName}"`);
    return res.json({ alreadyExists: false, food: cached, fromCache: true });
  }

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

  // 2. Call AI provider chain (Groq primary, Gemini fallback — see identifyFoodViaAI)
  try {
    const { text: rawText, provider, model } = await identifyFoodViaAI(buildPrompt(cleanName));

    // Strip markdown fences if model adds them
    const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    console.log(`AI (${provider}/${model}) raw response preview:`, jsonText.substring(0, 100));
    const food = JSON.parse(jsonText);

    // Normalise the per_100g block to guarantee all 36 fields
    food.per_100g = normaliseNutrients(food.per_100g);

    cacheSet(cleanName, food);
    return res.json({ alreadyExists: false, food, aiProvider: provider });
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('AI identify error | status:', err.response?.status, '| detail:', detail);
    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: 'AI returned malformed data — please try again' });
    }
    const upstreamStatus = err.response?.status;
    const userMsg = upstreamStatus === 401
      ? 'AI service authentication failed — check GROQ_API_KEY / GEMINI_API_KEY'
      : upstreamStatus === 429
      ? 'AI rate limit reached — please try in a moment'
      : upstreamStatus === 503
      ? 'AI service is busy right now — please try again in a few seconds'
      : upstreamStatus === 500
      ? 'AI service not configured — no API key set'
      : 'AI service error — please try again';
    // Forward the real status so the client can tell a transient issue
    // (429/503 — worth a "try again in a bit") apart from a hard failure (502).
    const statusToSend = (upstreamStatus === 429 || upstreamStatus === 503) ? upstreamStatus : 502;
    return res.status(statusToSend).json({ error: userMsg });
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

    const normCategory = normaliseCategory(food.category);

    const { rows } = await pool.query(
      `INSERT INTO foods
         (name, name_hindi, name_local, name_aliases, category, source, verified, per_100g)
       VALUES ($1,$2,$3,$4,$5,'ai',false,$6)
       ON CONFLICT (lower(name), source) DO UPDATE
         SET per_100g     = EXCLUDED.per_100g,
             name_aliases = EXCLUDED.name_aliases,
             category     = EXCLUDED.category
       RETURNING id, name`,
      [
        food.name.trim(),
        food.name_hindi   || null,
        food.name_local   || null,
        JSON.stringify(aliases),
        normCategory,
        JSON.stringify(per100g),
      ]
    );

    // Also save aliases as separate searchable entries (ON CONFLICT DO NOTHING)
    for (const alias of aliases) {
      if (alias && alias !== food.name) {
        await pool.query(
          `INSERT INTO foods (name, category, source, verified, per_100g)
           VALUES ($1,$2,'ai',false,$3)
           ON CONFLICT (lower(name), source) DO NOTHING`,
          [alias.trim(), normCategory, JSON.stringify(per100g)]
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
