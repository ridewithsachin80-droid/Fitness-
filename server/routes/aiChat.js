/**
 * server/routes/aiChat.js  (v2 — full-day logging)
 *
 * AI Chat logging — the member types ONE message describing their whole day:
 *   "weight 82.5, morning walk done, 2 chapati and dal for lunch,
 *    acv before meal 2, drank 1 litre water, took b12 and d3,
 *    slept 10:30 to 6:30"
 * and the AI parses it into every field of daily_logs: weight, activity
 * checkboxes, ACV, supplements, water, sleep, and food items with full
 * nutrition. The client shows a grouped preview and applies it in one tap.
 *
 * The client sends the member's ASSIGNED protocol items (ids + labels) with
 * each message, so the AI maps free text onto the exact per-member protocol —
 * including coach-customised labels — and the server whitelists every id it
 * returns against that list. The AI can never tick an item the member does
 * not have.
 *
 * Provider chain: Groq (primary, free) → Gemini (secondary, free).
 * Self-contained on purpose so a change here can never break the existing
 * single-food AI search in routes/aiFoods.js.
 *
 * Routes:
 *   POST /api/ai-chat/parse   → Parse free text into a full-day log preview
 *
 * Auth: authenticated users only.
 *
 * Mounted in server/index.js:
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
      max_tokens: 3000,
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
      generationConfig: { temperature: 0.1, maxOutputTokens: 3000 },
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
          break;
        }
      }
    }
  }
  throw lastErr;
}

// ── Nutrition normaliser — guarantees all 36 fields exist ────────────────────
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

// ── Context sanitiser ────────────────────────────────────────────────────────
// The client sends the member's assigned protocol items. Cap counts + string
// lengths so a malicious client can't balloon the prompt.
function sanitiseItems(list, max = 30) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, max)
    .filter(i => i && i.id && i.label)
    .map(i => ({
      id:    String(i.id).slice(0, 40),
      label: String(i.label).slice(0, 60),
      sub:   i.sub ? String(i.sub).slice(0, 80) : '',
    }));
}

// ── Prompt builder ───────────────────────────────────────────────────────────
function buildParsePrompt(message, ctx) {
  const slots = ctx.mealSlots.length ? ctx.mealSlots.join(' | ') : 'Meal 1 | Meal 2 | Meal 3';
  const listBlock = (items) =>
    items.length
      ? items.map(i => `  - id:"${i.id}" → ${i.label}${i.sub ? ` (${i.sub})` : ''}`).join('\n')
      : '  (none assigned)';

  return `You are the AI logging assistant inside an Indian fitness coaching app.
A member typed what they did today, in casual language (English, Hinglish, or
Kannada-English mix). Parse the message into structured daily-log entries.

Member's message: "${message}"

MEMBER'S ASSIGNED PROTOCOL (use ONLY these ids — never invent ids):
Meal slots: ${slots}
Activities:
${listBlock(ctx.activities)}
ACV doses:
${listBlock(ctx.acv)}
Supplements:
${listBlock(ctx.supplements)}
Daily water target: ${ctx.waterTargetMl} ml

PARSING RULES:
1. WEIGHT — "weight 82.5" / "82.5kg today" → weight_kg: 82.5. Must be 20–300 kg,
   else null. Only when explicitly stated as body weight.
2. ACTIVITIES — map mentions to activity ids by MEANING, not exact words:
   "did my walk"→the walking activity, "post lunch steps"→the steps item after
   the midday meal, "gym done"/"workout done"→resistance/training item.
   "all activities done" → every activity id. Only include ids from the list.
3. ACV — "acv before lunch"→the ACV dose nearest the midday meal. "all acv done"
   or "acv done" (unqualified) → every ACV id.
4. SUPPLEMENTS — "took b12 and d3"→those ids. "took my supplements" /
   "supplements done" (unqualified) → ALL assigned supplement ids.
5. WATER — "drank 1 litre"→water_ml_add: 1000. "2 glasses"→500 (1 glass≈250ml).
   Amount ADDED, 0–6000. If they say "finished my water target", use ${ctx.waterTargetMl}.
6. SLEEP — "slept 10:30 to 6:30"→bedtime "22:30", waketime "06:30" (24h HH:MM).
   Evening times without am/pm are PM for bedtime; morning times are AM for wake.
7. FOOD — extract EVERY food with quantity. Indian portions:
   1 chapati/roti≈30g, 1 phulka≈25g, 1 paratha≈60g, 1 idli≈40g, 1 dosa≈80g,
   1 katori/bowl dal≈150g, 1 katori sabzi≈100g, 1 katori rice≈100g, 1 plate rice≈150g,
   1 glass milk/buttermilk≈200g, 1 cup tea/coffee≈150g, 1 egg≈55g, 1 banana≈120g,
   1 apple≈150g, 1 tbsp≈15g, 1 tsp≈5g, 1 slice bread≈25g, handful nuts≈28g,
   1 scoop protein powder≈30g, 1 piece sweet≈30g. Explicit grams/ml win.
   Per-100g nutrition from USDA/NIN India (cooked form as eaten in India):
   calories(kcal), protein, total_carbs, fat, fiber, sugar (g) and sodium,
   calcium, iron, potassium, vit_c (mg).
   Map stated meals (breakfast/lunch/dinner/snack/morning/night or slot names)
   to the CLOSEST slot from the meal slots list, else null.
8. WORKOUTS — exercise mentions beyond the protocol activities (pushups, cycling,
   yoga...) go in workouts with estimated kcal burned. Never invent workouts.
9. reply — ONE short friendly sentence summarising what was understood. Mention
   food calories if food present. No emojis. No medical advice.
10. Anything not mentioned → null / empty array. If nothing parseable at all,
   return empty everything and a reply asking them to describe their day.

Return ONLY a raw JSON object, no markdown fences, exactly this structure:
{
  "reply": "Got it — weight 82.5, walk done, lunch logged at 290 kcal, 1L water.",
  "weight_kg": 82.5,
  "activity_ids": ["walk"],
  "acv_ids": ["acv2"],
  "supplement_ids": ["b12", "d3"],
  "water_ml_add": 1000,
  "sleep": { "bedtime": "22:30", "waketime": "06:30" },
  "foods": [
    {
      "name": "Chapati", "qty_text": "2 pieces", "grams": 60, "meal": null,
      "per_100g": { "calories": 297, "protein": 8.0, "total_carbs": 61, "fat": 3.7,
        "fiber": 4.9, "sugar": 1.6, "sodium": 298, "calcium": 33, "iron": 2.4,
        "potassium": 196, "vit_c": 0 }
    }
  ],
  "workouts": [
    { "name": "Push-ups", "qty_text": "30 reps", "duration_min": null, "calories_burned": 15 }
  ]
}`;
}

// ── DB enrichment for foods ──────────────────────────────────────────────────
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
      console.error('ai-chat DB enrich failed for', f.name, e.message);
    }
    out.push({ ...f, food_id, per_100g: per100g, source });
  }
  return out;
}

// ── Validators ───────────────────────────────────────────────────────────────
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function whitelistIds(aiIds, allowedItems) {
  if (!Array.isArray(aiIds)) return [];
  const allowed = new Set(allowedItems.map(i => i.id));
  return [...new Set(aiIds.map(String))].filter(id => allowed.has(id));
}

// ── POST /api/ai-chat/parse ──────────────────────────────────────────────────
// Body: {
//   message: string,
//   context: {
//     mealSlots:    string[],
//     activities:   [{id,label,sub}],   ← member's ACTIVE protocol items
//     acv:          [{id,label,sub}],
//     supplements:  [{id,label,sub}],
//     waterTargetMl: number
//   }
// }
// Returns: { reply, weight_kg, activities:[{id,label}], acv:[...],
//            supplements:[...], water_ml_add, sleep, foods:[...],
//            workouts:[...], totals:{cal,pro,carb,fat} }
router.post('/parse', async (req, res) => {
  const { message, context } = req.body;

  if (!message || String(message).trim().length < 2) {
    return res.status(400).json({ error: 'Message required' });
  }
  const cleanMsg = String(message).trim().slice(0, 1200);

  const ctx = {
    mealSlots:     Array.isArray(context?.mealSlots) ? context.mealSlots.slice(0, 8).map(s => String(s).slice(0, 40)) : [],
    activities:    sanitiseItems(context?.activities),
    acv:           sanitiseItems(context?.acv),
    supplements:   sanitiseItems(context?.supplements),
    waterTargetMl: Math.min(8000, Math.max(500, parseInt(context?.waterTargetMl) || 3000)),
  };

  try {
    const { text: rawText, provider, model } = await callAI(buildParsePrompt(cleanMsg, ctx));

    const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed   = JSON.parse(jsonText);

    // ── Weight ──
    let weight_kg = parseFloat(parsed.weight_kg);
    if (!Number.isFinite(weight_kg) || weight_kg < 20 || weight_kg > 300) weight_kg = null;
    else weight_kg = +weight_kg.toFixed(1);

    // ── Checkbox groups — whitelist against the member's actual protocol ──
    const label = (items) => (id) => {
      const it = items.find(i => i.id === id);
      return { id, label: it?.label || id };
    };
    const activities  = whitelistIds(parsed.activity_ids,   ctx.activities).map(label(ctx.activities));
    const acv         = whitelistIds(parsed.acv_ids,        ctx.acv).map(label(ctx.acv));
    const supplements = whitelistIds(parsed.supplement_ids, ctx.supplements).map(label(ctx.supplements));

    // ── Water ──
    let water_ml_add = Math.round(parseFloat(parsed.water_ml_add));
    if (!Number.isFinite(water_ml_add) || water_ml_add <= 0) water_ml_add = null;
    else water_ml_add = Math.min(6000, water_ml_add);

    // ── Sleep ──
    let sleep = null;
    if (parsed.sleep && (parsed.sleep.bedtime || parsed.sleep.waketime)) {
      const bt = HHMM.test(parsed.sleep.bedtime  || '') ? parsed.sleep.bedtime  : null;
      const wt = HHMM.test(parsed.sleep.waketime || '') ? parsed.sleep.waketime : null;
      if (bt || wt) sleep = { bedtime: bt, waketime: wt };
    }

    // ── Foods ──
    const rawFoods = Array.isArray(parsed.foods) ? parsed.foods : [];
    const validFoods = rawFoods
      .filter(f => f && f.name && (parseFloat(f.grams) || 0) > 0)
      .slice(0, 25)
      .map(f => ({
        name:     String(f.name).trim().slice(0, 100),
        qty_text: String(f.qty_text || '').slice(0, 60),
        grams:    Math.min(5000, Math.round(parseFloat(f.grams))),
        meal:     f.meal ? String(f.meal).slice(0, 40) : null,
        per_100g: f.per_100g || {},
      }));

    const foods = await enrichFromDB(validFoods);

    // Per-item macros + totals computed server-side — never trust AI arithmetic
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

    // ── Workouts (info only) ──
    const workouts = (Array.isArray(parsed.workouts) ? parsed.workouts : [])
      .filter(w => w && w.name)
      .slice(0, 10)
      .map(w => ({
        name:            String(w.name).trim().slice(0, 100),
        qty_text:        String(w.qty_text || '').slice(0, 60),
        duration_min:    parseFloat(w.duration_min) || null,
        calories_burned: Math.round(parseFloat(w.calories_burned)) || null,
      }));

    const nothingParsed = !weight_kg && !activities.length && !acv.length &&
      !supplements.length && !water_ml_add && !sleep && !foods.length && !workouts.length;

    return res.json({
      reply: String(parsed.reply || '').slice(0, 400) ||
        (nothingParsed
          ? 'I couldn\'t find anything to log in that — try e.g. "weight 82.5, walk done, 2 chapati for lunch, 1L water".'
          : 'Here\'s what I understood — review and apply.'),
      weight_kg,
      activities,
      acv,
      supplements,
      water_ml_add,
      sleep,
      foods,
      workouts,
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
