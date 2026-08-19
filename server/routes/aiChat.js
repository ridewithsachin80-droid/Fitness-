/**
 * server/routes/aiChat.js
 *
 * AI Chat food logging — Fittr-style natural language logging.
 * Member types "2 chapati, 1 bowl dal, 1 glass milk" and the AI parses
 * every item, estimates grams from Indian portion words (katori, glass,
 * piece, plate), and returns full nutrition so the client can add all
 * items to the daily log in one tap.
 *
 * Provider chain: Groq (primary, free) → Gemini (secondary, free).
 * Same pattern as routes/aiFoods.js — self-contained on purpose so a
 * change here can never break the existing single-food AI search.
 *
 * Routes:
 *   POST /api/ai-chat/parse   → Parse free text into logged food items + workouts
 *
 * Auth: authenticated users only.
 *
 * How it plugs in — add to server/index.js:
 *   const aiChatRoutes = require('./routes/aiChat');
 *   app.use('/api/ai-chat', aiChatRoutes);
 */

const router = require('express').Router();
const pool   = require('../db/pool');
const axios  = require('axios');
const authMW = require('../middleware/auth');

router.use(authMW);

// ── AI PROVIDERS (same chain as aiFoods.js) ─────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODELS = [
  process.env.GROQ_MODEL          || 'openai/gpt-oss-120b',
  process.env.GROQ_FALLBACK_MODEL || 'llama-3.3-70b-versatile',
].filter(Boolean);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODELS = [
  process.env.GEMINI_MODEL          || 'gemini-2.5-flash-lite',
  process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash',
].filter(Boolean);
const geminiUrlFor = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

async function callGroqOnce(model, prompt) {
  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 2500,
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
      generationConfig: { temperature: 0.1, maxOutputTokens: 2500 },
    },
    { headers: { 'content-type': 'application/json' }, timeout: 30000 }
  );
  const candidate = response.data.candidates?.[0];
  return {
    text: candidate?.content?.parts?.map(p => p.text).join('') || '',
    finishReason: candidate?.finishReason,
  };
}

// ── Provider + model fallback orchestrator (429/503 retry with backoff) ──────
async function callAI(prompt) {
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
          return { text, provider: provider.name, model };
        } catch (err) {
          lastErr = err;
          const status = err.response?.status;
          const retryable = status === 429 || status === 503;
          if (retryable && attempt < maxRetries) {
            const wait = (attempt + 1) * 2000;
            console.log(`ai-chat: ${provider.name}/${model} ${status} — retrying in ${wait}ms`);
            await new Promise(r => setTimeout(r, wait));
            continue;
          }
          if (!retryable) break;
          break;
        }
      }
    }
  }
  throw lastErr;
}

// ── Nutrition normaliser — guarantees all 36 fields exist ────────────────────
// Same shape used by aiFoods.js / NutritionSummary, so chat-logged foods
// participate fully in the micro-nutrient summary.
function normaliseNutrients(raw = {}) {
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const fiber     = num(raw.fiber);
  const totalCarb = num(raw.total_carbs);
  const netRaw    = parseFloat(raw.net_carbs);
  return {
    calories:      num(raw.calories),
    protein:       num(raw.protein),
    total_carbs:   totalCarb,
    net_carbs:     Number.isFinite(netRaw) ? netRaw : Math.max(0, +(totalCarb - fiber).toFixed(1)),
    fat:           num(raw.fat),
    fiber,
    sugar:         num(raw.sugar),
    saturated_fat: num(raw.saturated_fat),
    trans_fat:     num(raw.trans_fat),
    cholesterol:   num(raw.cholesterol),
    omega3_ala:    num(raw.omega3_ala),
    omega3_epa:    num(raw.omega3_epa),
    omega3_dha:    num(raw.omega3_dha),
    omega6:        num(raw.omega6),
    omega9_mufa:   num(raw.omega9_mufa),
    vit_a: num(raw.vit_a), vit_b1: num(raw.vit_b1), vit_b2: num(raw.vit_b2),
    vit_b3: num(raw.vit_b3), vit_b5: num(raw.vit_b5), vit_b6: num(raw.vit_b6),
    vit_b12: num(raw.vit_b12), vit_c: num(raw.vit_c), vit_d: num(raw.vit_d),
    vit_e: num(raw.vit_e), vit_k: num(raw.vit_k),
    folate: num(raw.folate), biotin: num(raw.biotin), choline: num(raw.choline),
    calcium: num(raw.calcium), iron: num(raw.iron), magnesium: num(raw.magnesium),
    phosphorus: num(raw.phosphorus), potassium: num(raw.potassium),
    sodium: num(raw.sodium), zinc: num(raw.zinc), copper: num(raw.copper),
    manganese: num(raw.manganese), selenium: num(raw.selenium),
  };
}

// ── Prompt builder ───────────────────────────────────────────────────────────
function buildParsePrompt(message, mealSlots) {
  const slots = Array.isArray(mealSlots) && mealSlots.length
    ? mealSlots.join(' | ')
    : 'Meal 1 | Meal 2 | Meal 3';

  return `You are a professional Indian nutritionist AI inside a fitness tracking app.
A member typed what they ate and/or exercised, in casual language (English, Hinglish,
or Kannada-English mix). Parse it into structured log entries.

Member's message: "${message}"

The app's meal slots are: ${slots}

RULES:
1. Extract EVERY food item mentioned with its quantity.
2. Convert Indian portion words to grams using realistic values:
   1 chapati/roti≈30g, 1 phulka≈25g, 1 paratha≈60g, 1 idli≈40g, 1 dosa≈80g,
   1 katori/bowl dal≈150g, 1 katori sabzi≈100g, 1 katori rice≈100g, 1 plate rice≈150g,
   1 glass milk≈200g, 1 glass buttermilk≈200g, 1 cup tea/coffee≈150g, 1 cup≈240ml,
   1 egg≈55g, 1 banana≈120g, 1 apple≈150g, 1 tbsp≈15g, 1 tsp≈5g, 1 slice bread≈25g,
   handful nuts≈28g, 1 scoop protein powder≈30g, 1 piece sweet≈30g.
   If the user gives explicit grams/ml, use those.
3. For each food give accurate per-100g nutrition (USDA / NIN India values, cooked
   form as commonly eaten in India). Include calories(kcal), protein, total_carbs,
   fat, fiber, sugar (grams) and sodium, calcium, iron, potassium, vit_c (mg).
4. If the member indicates a meal (breakfast/lunch/dinner/snack/morning/night or a
   slot name), map it to the CLOSEST slot from the list above, else null.
5. If the member mentions exercise (walk, pushups, gym, yoga, cycling...), list it
   under workouts with estimated calories burned for an average adult. Do NOT invent
   workouts that were not mentioned.
6. reply: ONE short friendly sentence summarising what you understood (mention total
   calories). No emojis. No medical advice.
7. If the message contains NO food and NO exercise, return empty arrays and a reply
   asking them to describe what they ate.

Return ONLY a raw JSON object, no markdown fences, exactly this structure:
{
  "reply": "Got it — 2 chapatis and a bowl of dal, about 290 kcal.",
  "foods": [
    {
      "name": "Chapati",
      "qty_text": "2 pieces",
      "grams": 60,
      "meal": null,
      "confidence": "high",
      "per_100g": {
        "calories": 297, "protein": 8.0, "total_carbs": 61, "fat": 3.7,
        "fiber": 4.9, "sugar": 1.6, "sodium": 298, "calcium": 33,
        "iron": 2.4, "potassium": 196, "vit_c": 0
      }
    }
  ],
  "workouts": [
    { "name": "Push-ups", "qty_text": "30 reps", "duration_min": null, "calories_burned": 15 }
  ]
}`;
}

// ── DB enrichment ────────────────────────────────────────────────────────────
// For each AI-parsed food, try to find it in our foods table. A DB hit gives
// us the food_id + our own (often verified) full 36-field nutrition, which is
// preferred over the AI's estimate.
async function enrichFromDB(foods) {
  const out = [];
  for (const f of foods) {
    let food_id = null;
    let per100g = normaliseNutrients(f.per_100g);
    let source  = 'ai';
    try {
      const { rows } = await pool.query(
        `SELECT id, name, per_100g, verified FROM foods
         WHERE LOWER(name) = LOWER($1)
            OR LOWER(name_aliases::text) LIKE LOWER($2)
         ORDER BY verified DESC, id ASC
         LIMIT 1`,
        [String(f.name || '').trim(), `%"${String(f.name || '').trim().toLowerCase()}"%`]
      );
      if (rows.length && rows[0].per_100g && (parseFloat(rows[0].per_100g.calories) || 0) > 0) {
        food_id = rows[0].id;
        per100g = normaliseNutrients(rows[0].per_100g);
        source  = rows[0].verified ? 'db-verified' : 'db';
      }
    } catch (e) {
      // DB lookup is best-effort — AI values are fine on their own
      console.error('ai-chat DB enrich failed for', f.name, e.message);
    }
    out.push({ ...f, food_id, per_100g: per100g, source });
  }
  return out;
}

// ── POST /api/ai-chat/parse ──────────────────────────────────────────────────
// Body:    { message: string, mealSlots?: string[] }
// Returns: { reply, foods: [{name, qty_text, grams, meal, food_id, source,
//                            per_100g, macros:{cal,pro,carb,fat}}],
//            workouts: [...], totals: {cal,pro,carb,fat} }
router.post('/parse', async (req, res) => {
  const { message, mealSlots } = req.body;

  if (!message || String(message).trim().length < 2) {
    return res.status(400).json({ error: 'Message required' });
  }
  const cleanMsg = String(message).trim().slice(0, 1000); // hard cap — keeps prompt small

  try {
    const { text: rawText, provider, model } = await callAI(buildParsePrompt(cleanMsg, mealSlots));

    const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed   = JSON.parse(jsonText);

    const rawFoods = Array.isArray(parsed.foods) ? parsed.foods : [];
    const workouts = Array.isArray(parsed.workouts) ? parsed.workouts : [];

    // Drop garbage rows (no name or no grams)
    const validFoods = rawFoods.filter(
      f => f && f.name && (parseFloat(f.grams) || 0) > 0
    ).map(f => ({
      name:     String(f.name).trim().slice(0, 100),
      qty_text: String(f.qty_text || '').slice(0, 60),
      grams:    Math.min(5000, Math.round(parseFloat(f.grams))), // sanity cap
      meal:     f.meal ? String(f.meal).slice(0, 40) : null,
      confidence: f.confidence || 'medium',
      per_100g: f.per_100g || {},
    }));

    const foods = await enrichFromDB(validFoods);

    // Compute per-item macros + day totals server-side so the client never
    // has to trust AI arithmetic.
    let totCal = 0, totPro = 0, totCarb = 0, totFat = 0;
    for (const f of foods) {
      const factor = f.grams / 100;
      f.macros = {
        cal:  Math.round((f.per_100g.calories || 0) * factor),
        pro:  +((f.per_100g.protein     || 0) * factor).toFixed(1),
        carb: +((f.per_100g.total_carbs || 0) * factor).toFixed(1),
        fat:  +((f.per_100g.fat         || 0) * factor).toFixed(1),
      };
      totCal += f.macros.cal; totPro += f.macros.pro;
      totCarb += f.macros.carb; totFat += f.macros.fat;
    }

    const cleanWorkouts = workouts.filter(w => w && w.name).map(w => ({
      name:            String(w.name).trim().slice(0, 100),
      qty_text:        String(w.qty_text || '').slice(0, 60),
      duration_min:    parseFloat(w.duration_min) || null,
      calories_burned: Math.round(parseFloat(w.calories_burned)) || null,
    }));

    return res.json({
      reply: String(parsed.reply || '').slice(0, 400) ||
             (foods.length ? `Logged ${foods.length} item${foods.length > 1 ? 's' : ''}.` : "I couldn't find any food in that — try e.g. \"2 chapati and 1 bowl dal\"."),
      foods,
      workouts: cleanWorkouts,
      totals: {
        cal:  Math.round(totCal),
        pro:  +totPro.toFixed(1),
        carb: +totCarb.toFixed(1),
        fat:  +totFat.toFixed(1),
      },
      aiProvider: provider,
      aiModel: model,
    });
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message;
    console.error('ai-chat parse error | status:', err.response?.status, '| detail:', detail);

    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: 'AI returned malformed data — please try again' });
    }
    const upstreamStatus = err.response?.status;
    const userMsg = upstreamStatus === 401
      ? 'AI service authentication failed — check GROQ_API_KEY / GEMINI_API_KEY'
      : upstreamStatus === 429
      ? 'AI is busy — please try again in a moment'
      : upstreamStatus === 503
      ? 'AI service is overloaded — try again in a few seconds'
      : upstreamStatus === 500
      ? 'AI service not configured — no API key set'
      : 'AI service error — please try again';
    const statusToSend = (upstreamStatus === 429 || upstreamStatus === 503) ? upstreamStatus : 502;
    return res.status(statusToSend).json({ error: userMsg });
  }
});

module.exports = router;
