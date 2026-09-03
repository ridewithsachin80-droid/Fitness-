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
const { firstName } = require('../services/personName');
const { cleanScalePayload } = require('../services/scaleParse');
const { cookingFatPlausibility, macroPlausibility, massBalance } = require('../services/macroCheck');
const { FATS, DEFAULT_FAT, saturatedPlausibility, suggestFatSplit,
        detectCookingFat } = require('../services/fatProfile');

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

// Nutrition shape lives in services/nutrients.js — one implementation for
// every path a food can enter by. See that file for why.
const { normaliseNutrients } = require('../services/nutrients');


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
function buildParsePrompt(message, ctx, portions = []) {
  const slots = ctx.mealSlots.length ? ctx.mealSlots.join(' | ') : 'Meal 1 | Meal 2 | Meal 3';
  const listBlock = (items) =>
    items.length
      ? items.map(i => `  - id:"${i.id}" → ${i.label}${i.sub ? ` (${i.sub})` : ''}`).join('\n')
      : '  (none assigned)';

  return `You are the AI logging assistant inside an Indian fitness coaching app.
A member typed what they did today, in casual language (English, Hinglish, or
Kannada-English mix). Parse the message into structured daily-log entries.

Member's message: "${message}"

THIS MEMBER'S OWN PORTION SIZES (measured from their past corrections — use
these exact grams when the phrase matches, in preference to the generic table
below; they reflect the actual size of this member's bowls and glasses):
${portions.length
  ? portions.map(p => `  ${p.phrase} = ${p.grams}g`).join('\n')
  : '  (none recorded yet — use the generic conversions)'}

RECENT CONVERSATION (oldest first — for resolving references like "the dal",
"that", "same as yesterday"; do not re-log items from these turns):
${ctx.recent.length ? ctx.recent.map(r => `  ${r.role === 'user' ? 'Member' : 'AI'}: ${r.text}`).join('\n') : '  (none)'}

FOODS ALREADY IN TODAY'S LOG (the only items a correction can target):
${ctx.lastFoods.length ? ctx.lastFoods.map(f => `  - ${f.name} · ${f.grams}g · ${f.meal || 'no slot'}`).join('\n') : '  (none)'}

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
   Also give "category", one of: dairy, grain, vegetable, fruit, nut, oil,
   supplement, branded, other, pulse, meat, beverage, spice. It is used to file
   the food in the shared database.

   CRITICAL — per_100g means PER 100 GRAMS OF THE FOOD ITSELF, never per
   serving, per scoop, per piece or per packet. Supplement and powder labels
   are printed per scoop, and copying those numbers understates the food by
   3-4x. Reference points to check yourself against:
     whey protein powder  ~400 kcal, 80g protein per 100g  (NOT ~120/24, that
                          is one 30g scoop)
     peanut butter        ~590 kcal per 100g
     any oil / ghee       ~900 kcal per 100g
     sugar                ~400 kcal per 100g
   If a dry powder or fat comes out under 300 kcal per 100g, you have almost
   certainly copied a per-serving label — recalculate for 100g.

   Map stated meals (breakfast/lunch/dinner/snack/morning/night or slot names)
   to the CLOSEST slot from the meal slots list, else null.
8. WORKOUTS — exercise mentions beyond the protocol activities (bench press,
   squats, pushups, cycling, yoga...) go in workouts with estimated kcal burned.
   Never invent workouts.
   IMPORTANT — if the member states SETS with reps and/or weight (e.g. "bench
   press 3 sets, first set 20kg 10 reps, second 20kg 10, third 20kg 12"), you
   MUST break it into a "sets" array with one entry per set:
   sets: [{ "reps": 10, "weight_kg": 20 }, { "reps": 10, "weight_kg": 20 },
          { "reps": 12, "weight_kg": 20 }]
   Use the exact per-set values given. If a weight applies to all sets, repeat it
   on each set. If reps are a range for a set, use the number stated for that set.
   Body-weight moves (pushups, squats without weight) → weight_kg: 0.
   Set "name" to the clean exercise name only ("Bench Press", not "bench press
   3 sets"). Speech-to-text errors are common — "pen drives"/"drips"/"rapes"
   almost always mean "reps"; interpret them as reps.
   For CARDIO (walking, running, cycling, swimming, rowing, elliptical, stairs,
   skipping, yoga) omit "sets" and instead give:
     cardio_type: one of walking|running|cycling|swimming|elliptical|rowing|
                  stairs|skipping|yoga|other
     duration_min: minutes
     speed_kmh:    if stated, or computed from distance ÷ time
     distance_km:  if stated
   Example: "5 km walk in 1 hour" → cardio_type "walking", duration_min 60,
   distance_km 5, speed_kmh 5. Always include cardio_type for cardio so it can
   be logged in the member's workout log with an accurate calorie estimate.
   IMPORTANT: a cardio mention should ALSO tick the matching protocol activity
   in activity_ids (e.g. a morning walk ticks the walking activity) — the
   protocol tick records compliance, the cardio entry records the actual work.
9. reply — ONE short friendly sentence summarising what was understood. Mention
   food calories if food present. No emojis. No medical advice.
10. Anything not mentioned → null / empty array. If nothing parseable at all
   AND it is not a question (see rule 11), return empty everything and a reply
   asking them to describe their day.
11a. CORRECTIONS — if the member is CHANGING something already in today's log
   ("make the dal 250g", "that was dinner not lunch", "paneer was 150 grams"),
   return it in "corrections": [{ "name": "<exact name from TODAY'S LOG list>",
   "grams": <new grams or null>, "meal": "<new slot or null>" }] and do NOT
   also add it to "foods" — corrections update, foods append. Only names from
   the TODAY'S LOG list are valid. "the dal" resolves to the dal item there.
12. MESSAGE FOR THE COACH — if the member is addressing their coach rather
   than logging or asking the app ("ask my coach to assign my workout", "tell
   coach my knee hurts", "coach ko bolo kal nahi aa paunga", "message my
   trainer about the diet"), set "coach_message" to what should be sent, in
   the MEMBER'S OWN VOICE and first person ("Please assign my workout for
   today", "My knee hurts"), and leave every other field empty/null. Do not
   rewrite their meaning, do not add pleasantries they did not say, and do not
   answer on the coach's behalf.
   Only for messages clearly aimed at a person. A question about their own
   data is rule 11, not this.

11. QUESTIONS — if the message is a QUESTION about their own data, progress,
   targets or plan ("how many calories have I eaten today?", "kitna paani
   baaki hai?", "did I hit my protein target?", "what's my weight trend?")
   rather than something to log, set "question" to the member's question and
   leave every other field empty/null. The app will answer it from their real
   data. If the message BOTH logs something AND asks something, treat it as a
   log (parse the loggable items, question stays null).

Return ONLY a raw JSON object, no markdown fences, exactly this structure:
{
  "reply": "Got it — weight 82.5, walk done, lunch logged at 290 kcal, 1L water.",
  "question": null,
  "coach_message": null,
  "corrections": [],
  "weight_kg": 82.5,
  "activity_ids": ["walk"],
  "acv_ids": ["acv2"],
  "supplement_ids": ["b12", "d3"],
  "water_ml_add": 1000,
  "sleep": { "bedtime": "22:30", "waketime": "06:30" },
  "foods": [
    {
      "name": "Chapati", "qty_text": "2 pieces", "grams": 60, "meal": null,
      "category": "grain",
      "per_100g": { "calories": 297, "protein": 8.0, "total_carbs": 61, "fat": 3.7,
        "fiber": 4.9, "sugar": 1.6, "sodium": 298, "calcium": 33, "iron": 2.4,
        "potassium": 196, "vit_c": 0 }
    }
  ],
  "workouts": [
    { "name": "Bench Press", "qty_text": "3 sets of 20 kg", "duration_min": null,
      "calories_burned": 25,
      "sets": [{ "reps": 10, "weight_kg": 20 }, { "reps": 10, "weight_kg": 20 }, { "reps": 12, "weight_kg": 20 }] },
    { "name": "Morning walk", "qty_text": "5 km in 1 hour", "duration_min": 60,
      "calories_burned": 200, "sets": [],
      "cardio_type": "walking", "speed_kmh": 5, "distance_km": 5 }
  ]
}`;
}

// ── Per-member portion memory ────────────────────────────────────────────────
// "1 katori" is not a fixed weight. It depends on whose kitchen the katori
// came from, and portion estimation is the single biggest source of error in
// the whole logging chain — far bigger than the nutrition values themselves.
//
// So when a member corrects the grams the AI proposed, we remember it against
// a normalised phrase ("katori dal", "glass milk") and feed their own figures
// back into the next prompt. The unit is what's being learned, not the food.

const UNIT_WORDS = /\b(katori|bowl|cup|glass|plate|piece|pieces|slice|slices|scoop|scoops|tbsp|tablespoon|tsp|teaspoon|handful|packet|bottle|roti|chapati|idli|dosa|egg|eggs)\b/i;

/** "2 katori" + "Dal" -> "katori dal". Returns null when there's no unit. */
function portionPhrase(qtyText, foodName) {
  const unit = String(qtyText || '').match(UNIT_WORDS)?.[1]?.toLowerCase();
  if (!unit) return null;
  const food = String(foodName || '').toLowerCase().replace(/\s*\(.*$/, '').trim();
  if (!food) return null;
  // Singularise the obvious plurals so "2 pieces" and "1 piece" share memory
  const u = unit.replace(/(pieces|slices|scoops|eggs)$/, m => m.slice(0, -1));
  return `${u} ${food}`.slice(0, 80);
}

/** How many grams the member's own history says this phrase is worth. */
async function loadPortions(patientId) {
  try {
    const { rows } = await pool.query(
      `SELECT phrase, grams, samples FROM member_portions
       WHERE patient_id = $1
       ORDER BY samples DESC, updated_at DESC
       LIMIT 40`,
      [patientId]
    );
    return rows.map(r => ({ phrase: r.phrase, grams: Math.round(r.grams), samples: r.samples }));
  } catch (err) {
    console.error('loadPortions failed:', err.message);
    return [];
  }
}

/**
 * Record a correction. Kept as a running average rather than a straight
 * overwrite, so one mistyped number can't permanently skew a member's
 * portions — but `samples` is capped at 8 so the average stays responsive
 * if they genuinely change bowl size.
 */
async function recordPortions(patientId, corrections) {
  for (const c of corrections) {
    const phrase = String(c?.phrase || '').trim().toLowerCase();
    const grams = parseFloat(c?.grams);
    if (!phrase || !Number.isFinite(grams) || grams <= 0 || grams > 5000) continue;
    try {
      await pool.query(
        `INSERT INTO member_portions (patient_id, phrase, grams, samples)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (patient_id, phrase) DO UPDATE
           SET grams = ROUND(
                 (member_portions.grams * LEAST(member_portions.samples, 8) + EXCLUDED.grams)
                 / (LEAST(member_portions.samples, 8) + 1), 1),
               samples = LEAST(member_portions.samples + 1, 99),
               updated_at = NOW()`,
        [patientId, phrase, grams]
      );
    } catch (err) {
      console.error('recordPortions failed for', phrase, err.message);
    }
  }
}

// ── AI EVAL SET (Sprint L1) ──────────────────────────────────────────────────
// A correction is the only free source of ground truth this app has. Portion
// memory already consumes it and throws the rest away. Everything below keeps
// it, so `scripts/replay-evals.js` can score a prompt change instead of us
// shipping one on a feeling.
//
// Every write here is best-effort and swallowed. A member logging their dinner
// must never see an error because the eval set had a bad day.

const crypto = require('crypto');

const EVAL_SOURCES = new Set(['member_parse', 'coach_parse', 'photo']);
const EVAL_FIELDS  = new Set(['grams', 'meal', 'food_name', 'exercise', 'target', 'ops',
                              // A parse the member did NOT correct — see maybeRecordControl.
                              'control']);

// One member correcting a lot in one evening should not drown out everyone
// else. 40 is far above normal use and far below "this is now noise".
const EVAL_DAILY_CAP = 40;

/** Stable identity for a sample, so the same lesson is not stored twice. */
function evalDedupKey(source, message, aiOutput, corrected) {
  return crypto.createHash('md5').update(JSON.stringify([
    source,
    String(message || '').trim().toLowerCase(),
    aiOutput ?? null,
    corrected ?? null,
  ])).digest('hex');
}

/**
 * Store one corrected parse.
 * Returns 'stored' | 'duplicate' | 'capped' | 'invalid' | 'error' — the reason
 * is returned rather than logged only, so the tests can assert on it.
 */
async function recordEvalSample({ patientId, source, message, aiOutput, corrected, field = null }) {
  const msg = String(message || '').trim();
  if (!EVAL_SOURCES.has(source)) return 'invalid';
  if (!msg || msg.length < 2)    return 'invalid';
  if (aiOutput === undefined || corrected === undefined) return 'invalid';
  const fld = EVAL_FIELDS.has(field) ? field : null;
  const pid = parseInt(patientId);
  if (!Number.isFinite(pid)) return 'invalid';

  try {
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ai_parse_samples
        WHERE patient_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [pid]
    );
    if ((cnt[0]?.n || 0) >= EVAL_DAILY_CAP) return 'capped';

    const { rows } = await pool.query(
      `INSERT INTO ai_parse_samples
         (patient_id, source, message, ai_output, corrected, field, dedup_key)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
       ON CONFLICT (patient_id, dedup_key) DO NOTHING
       RETURNING id`,
      [pid, source, msg.slice(0, 2000), JSON.stringify(aiOutput),
       JSON.stringify(corrected), fld,
       evalDedupKey(source, msg, aiOutput, corrected)]
    );
    return rows.length ? 'stored' : 'duplicate';
  } catch (err) {
    console.error('recordEvalSample failed:', err.message);
    return 'error';
  }
}

/**
 * Store a parse the member did NOT correct — a positive control.
 *
 * WHY THIS EXISTS
 * ---------------
 * Everything else in the eval set is a failure, because a correction is what
 * creates a sample. Replay a set of nothing but failures and you learn whether
 * the hard cases improved — and nothing at all about whether you broke the easy
 * ones. That is how a prompt tweak "fixes roti" and quietly starts mis-slotting
 * breakfast, with the scoreboard going up the whole time.
 *
 * So roughly one parse in CONTROL_SAMPLE_RATE is kept with `corrected` equal to
 * `ai_output`: the model got this right, and it should still get it right after
 * the next prompt change. That is what makes "newly broken" a real number
 * instead of an assumption.
 *
 * ── WHY CONTROLS HAVE THEIR OWN CAP ─────────────────────────────────────────
 * They are far more plentiful than corrections — most parses are fine. Sharing
 * the error budget would let controls crowd out the real mistakes, which are
 * the rarer and more valuable signal. Separate ceiling, checked separately.
 */
const CONTROL_SAMPLE_RATE = 20;    // 1 in 20 uncorrected parses
const CONTROL_DAILY_CAP   = 5;     // per member, well under EVAL_DAILY_CAP

/** Injectable so the tests can force the decision instead of retrying 100 times. */
let controlSampler = () => Math.random() * CONTROL_SAMPLE_RATE < 1;
function setControlSampler(fn) { controlSampler = fn; }

async function maybeRecordControl(patientId, message, foods) {
  const list = Array.isArray(foods) ? foods : [];
  if (!list.length) return 'skipped';
  if (!controlSampler()) return 'not-sampled';

  // One representative item, so a control scores the same way a grams sample
  // does and the replay tool needs no special case for it.
  const f = list[0];
  const shape = {
    name:  String(f?.name || '').slice(0, 100),
    grams: Number(f?.grams) || 0,
    meal:  f?.meal ? String(f.meal).slice(0, 40) : null,
  };
  if (!shape.name || !shape.grams) return 'skipped';

  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ai_parse_samples
        WHERE patient_id = $1 AND field = 'control'
          AND created_at > NOW() - INTERVAL '24 hours'`,
      [patientId]
    );
    if ((rows[0]?.n || 0) >= CONTROL_DAILY_CAP) return 'capped';
  } catch (err) {
    console.error('control cap check failed:', err.message);
    return 'error';
  }

  return recordEvalSample({
    patientId,
    source:    'member_parse',
    message,
    aiOutput:  shape,
    corrected: shape,          // identical: this one was already right
    field:     'control',
  });
}

/**
 * Remember what this parse returned, keyed to the message that produced it.
 *
 * Written at PARSE time, not apply time, on purpose: this is the model's own
 * output, before the member edits the grams in the preview. If they do edit,
 * the edit is the correction and this is what it corrects.
 */
async function rememberParseTurn(patientId, message, foods) {
  const list = (Array.isArray(foods) ? foods : []).slice(0, 25).map(f => ({
    name:     String(f?.name || '').slice(0, 100),
    grams:    Number(f?.grams) || 0,
    meal:     f?.meal ? String(f.meal).slice(0, 40) : null,
    qty_text: String(f?.qty_text || '').slice(0, 60),
  })).filter(f => f.name);
  if (!list.length) return;
  try {
    await pool.query(
      `INSERT INTO ai_parse_turns (patient_id, message, foods)
       VALUES ($1, $2, $3::jsonb)`,
      [patientId, String(message).slice(0, 2000), JSON.stringify(list)]
    );
    // Bounded cache: keep the 30 most recent turns per member and nothing else.
    await pool.query(
      `DELETE FROM ai_parse_turns
        WHERE patient_id = $1
          AND id NOT IN (
            SELECT id FROM ai_parse_turns WHERE patient_id = $1
             ORDER BY created_at DESC, id DESC LIMIT 30)`,
      [patientId]
    );
  } catch (err) {
    console.error('rememberParseTurn failed:', err.message);
  }
}

/**
 * The message that made this food, and the grams the model gave it.
 * Null when we cannot pair the two — a sample we cannot replay is worse than
 * no sample, so we never guess at the question.
 */
async function findOriginalTurn(patientId, foodName) {
  const name = String(foodName || '').trim().toLowerCase();
  if (!name) return null;
  try {
    const { rows } = await pool.query(
      `SELECT message, foods FROM ai_parse_turns
        WHERE patient_id = $1
          AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC, id DESC
        LIMIT 30`,
      [patientId]
    );
    for (const r of rows) {
      const hit = (r.foods || []).find(f => String(f.name).toLowerCase() === name);
      if (hit) return { message: r.message, food: hit };
    }
    return null;
  } catch (err) {
    console.error('findOriginalTurn failed:', err.message);
    return null;
  }
}

/**
 * Turn an applied corrections op into eval samples.
 * "make the dal 250g" tells us the earlier parse of "2 katori dal" was wrong;
 * this walks back to that message and records the pair.
 */
async function captureCorrectionSamples(patientId, corrections) {
  for (const c of corrections) {
    const orig = await findOriginalTurn(patientId, c.name);
    if (!orig) continue;                       // no question, no sample
    const before = orig.food;
    const after  = {
      name:  before.name,
      grams: c.grams != null ? c.grams : before.grams,
      meal:  c.meal  != null ? c.meal  : (before.meal || null),
    };
    const gramsChanged = Number(after.grams) !== Number(before.grams);
    const mealChanged  = (after.meal || null) !== (before.meal || null);
    if (!gramsChanged && !mealChanged) continue;
    await recordEvalSample({
      patientId,
      source:    'member_parse',
      message:   orig.message,
      aiOutput:  { name: before.name, grams: before.grams, meal: before.meal || null },
      corrected: after,
      field:     gramsChanged ? 'grams' : 'meal',
    });
  }
}

// ── Learning back into the food database ─────────────────────────────────────
// The chat used to read from `foods` but never write to it, so a member could
// log "upma" every morning and the AI would re-estimate it from scratch every
// time — the same guess, never reviewed, never improving. The AI Food Search
// path already saved its results; the chat quietly did not.
//
// Foods the chat estimates are now saved with source 'ai' and verified=false,
// which is the same contract the search path uses: usable immediately, clearly
// marked as unverified, and visible to a coach in the Food Database Manager to
// confirm or correct. Seeded NIN/USDA rows are untouched — the unique index is
// on (lower(name), source), so an AI row can never overwrite a verified one.
//
// Deliberately NOT saved:
//   · anything that already matched the database (nothing to learn)
//   · anything flagged by the per-serving guard (saving a suspect value would
//     bake the error in for every future member)
//   · implausible energy density, as a second line of defence
const CATEGORY_VALUES = ['dairy','grain','vegetable','fruit','nut','oil',
                         'supplement','branded','other','pulse','meat','beverage','spice'];

function guessCategory(name) {
  const n = String(name || '').toLowerCase();
  if (/\b(milk|curd|yoghurt|yogurt|paneer|cheese|butter|ghee|lassi|buttermilk)\b/.test(n)) return 'dairy';
  if (/\b(rice|roti|chapati|paratha|bread|poha|upma|idli|dosa|oats|wheat|millet|quinoa|noodle|pasta)\b/.test(n)) return 'grain';
  if (/\b(dal|daal|lentil|chana|rajma|beans?|sprouts?|moong|toor|urad|chickpea)\b/.test(n)) return 'pulse';
  if (/\b(chicken|mutton|fish|egg|prawn|meat|beef|pork)\b/.test(n)) return 'meat';
  if (/\b(oil|ghee)\b/.test(n)) return 'oil';
  if (/\b(almond|cashew|walnut|peanut|nuts?|seeds?)\b/.test(n)) return 'nut';
  if (/\b(juice|tea|coffee|water|shake|smoothie|soda)\b/.test(n)) return 'beverage';
  if (/\b(whey|protein powder|supplement|capsule|tablet)\b/.test(n)) return 'supplement';
  if (/\b(apple|banana|mango|orange|grape|papaya|melon|berry|fruit)\b/.test(n)) return 'fruit';
  if (/\b(masala|powder|spice|jeera|haldi|turmeric)\b/.test(n)) return 'spice';
  return 'other';
}

/**
 * Save AI-estimated foods so the database compounds instead of re-guessing.
 * Fire-and-forget: a failure here must never break the member's log.
 */
async function learnFoods(foods) {
  for (const f of foods) {
    if (f.food_id) continue;                       // already known
    if (f.warning) continue;                       // suspect per-serving values
    const cal = parseFloat(f.per_100g?.calories) || 0;
    if (cal <= 0 || cal > 920) continue;           // implausible energy density
    const name = String(f.name || '').trim();
    if (name.length < 2 || name.length > 100) continue;

    const category = CATEGORY_VALUES.includes(f.category) ? f.category : guessCategory(name);
    try {
      await pool.query(
        `INSERT INTO foods (name, category, source, verified, per_100g)
         VALUES ($1, $2, 'ai', false, $3)
         ON CONFLICT (lower(name), source) DO UPDATE
           SET per_100g = EXCLUDED.per_100g
         RETURNING id`,
        // Normalised before it is stored. This inserted whatever partial object
        // the model returned, so a food learned from chat could land in the
        // table with six fields — and every member who logged it afterwards
        // inherited those gaps, through every other path.
        [name, category, JSON.stringify(normaliseNutrients(f.per_100g))]
      );
    } catch (err) {
      // A learning failure is not worth failing the member's log over
      console.error('learnFoods: could not save', name, err.message);
    }
  }
}

// ── Per-serving sanity guard ─────────────────────────────────────────────────
// Supplement and powder labels are printed per scoop, and the model sometimes
// copies those numbers straight into per_100g — which understates the food by
// 3-4x and quietly corrupts the day's calorie total.
//
// Atwater arithmetic can't catch it (a per-scoop row is still internally
// consistent), so we check the energy density instead: a dry powder or fat
// that comes back under 300 kcal per 100g is almost certainly a serving label.
// Flagged items are marked low-confidence rather than silently rewritten —
// guessing a correction would be worse than telling the member to check.
const DENSE_FOOD = /\b(whey|casein|protein powder|protein isolate|oil|ghee|butter|peanut butter|almond butter|nut butter|sugar|jaggery|honey|mayonnaise|nuts?|almond|cashew|walnut|seeds?)\b/i;

/**
 * A cooked dish with no cooking fat in it.
 *
 * Real report: "Malasa dosa" logged as 200g / 280 kcal / 6g fat. That is a
 * dosa nobody put on a tawa — two spoons of oil is 16-20g of fat, so the real
 * figure is closer to 400 kcal. The member under-reported by a third of a meal
 * and the app told them the number with complete confidence.
 *
 * The same check runs in the coach's verification queue. Here it runs at the
 * moment of logging, because that is when the member can still say "that's not
 * right" — a warning in a queue they never open is a warning nobody reads.
 *
 * Marked, never rewritten. Guessing how much oil went in would be inventing
 * data, which is how the wrong number got there in the first place.
 */
function flagCookingFat(food) {
  if (food.warning) return food;                    // already flagged, don't stack
  const verdict = cookingFatPlausibility(food?.per_100g, food.name || '');
  if (verdict.status !== 'suspect') return food;
  return {
    ...food,
    confidence: 'low',
    warning: `Looks light for a cooked dish — ${verdict.reason}. Your coach will check it.`,
  };
}

function flagSuspectDensity(food) {
  const cal = parseFloat(food?.per_100g?.calories) || 0;
  if (!DENSE_FOOD.test(food.name || '')) return food;
  if (cal >= 300) return food;
  return {
    ...food,
    confidence: 'low',
    warning: 'These figures look like a per-serving label rather than per 100g — check before applying.',
  };
}

/**
 * Use the food's typical serving when the member did not give a quantity.
 *
 * "masala dosa" with no number got whatever the model guessed — 80g, a third of
 * a real one, and the member's day came out 250 kcal light without anything
 * looking wrong. The model does not know what a dosa looks like on an Indian
 * plate. The coach does, and can now say so once on the food itself.
 *
 * Applied ONLY when the member gave no quantity at all. The moment they say a
 * number or a measure — "2 dosa", "half a plate", "1 katori" — that is an
 * observation about their own meal and nothing overrides it.
 *
 * Personal portion memory is not touched: it reaches the model through the
 * prompt, so what THIS member means by "1 dosa" already shapes the guess before
 * this ever runs.
 */
const QUANTITY_WORD = /\b(katori|plate|piece|pieces|bowl|cup|glass|spoon|spoons|tbsp|tsp|scoop|slice|slices|packet|handful|half|quarter|full|small|medium|large|one|two|three|four|five|dozen)\b/i;

function memberGaveQuantity(message) {
  const m = String(message || '');
  return /\d/.test(m) || QUANTITY_WORD.test(m);
}

function applyDefaultPortions(message, foods) {
  if (memberGaveQuantity(message)) return foods;
  return (foods || []).map(f => {
    const def = parseInt(f.default_grams);
    if (!Number.isFinite(def) || def <= 0) return f;
    if (Number(f.grams) === def) return f;
    return { ...f, grams: def, qty_text: f.qty_text || 'typical serving' };
  });
}

/**
 * Split a cooked dish's fat using the fat THIS member cooks in.
 *
 * The food table stores one total fat for everyone, which is right — a dosa is
 * a dosa. But the saturated share is a property of the kitchen, not the dish:
 * Asha frying in coconut oil and Bujju in sunflower are eating the same dosa
 * with 8.7g and 1.1g of saturated fat respectively.
 *
 * Logged items keep their own nutrition snapshot, so each member's copy can
 * carry their own split without the shared row ever disagreeing with itself.
 *
 * Only applied where it is true: a dish cooked in fat, and only when the food
 * itself has not already recorded a real saturated figure. A packaged food's
 * label beats any inference we could make.
 */
function applyCookingFat(foods, message, profileDefault = null) {
  return (foods || []).map(f => {
    const n = f.per_100g || {};
    const fat = +n.fat || 0;
    if (fat < 3) return f;
    if ((+n.saturated_fat || 0) > 0) return f;      // the food already knows
    if (cookingFatPlausibility(n, f.name || '').status === 'unknown') return f;

    // What they SAID wins. "ghee masala dosa" is the member telling us which
    // fat went in, for this meal, without being asked anything.
    const { fat: key, from } = detectCookingFat(message, f.name, profileDefault);
    const split = suggestFatSplit(fat, key);
    if (!split) return f;
    return { ...f,
      cooking_fat: key,
      cooking_fat_from: from,
      per_100g: { ...n,
        saturated_fat: split.saturated,
        omega9_mufa: (+n.omega9_mufa || 0) || split.mufa,
      },
    };
  });
}

/** Did this parse include a cooked dish we could not split? */
function needsCookingFat(foods) {
  return (foods || []).some(f => {
    const n = f.per_100g || {};
    return (+n.fat || 0) >= 3
      && (+n.saturated_fat || 0) === 0
      && cookingFatPlausibility(n, f.name || '').status !== 'unknown';
  });
}

// ── DB enrichment for foods ──────────────────────────────────────────────────
async function enrichFromDB(foods) {
  const out = [];
  for (const f of foods) {
    let food_id = null;
    let per100g = normaliseNutrients(f.per_100g);
    let source  = 'ai';
    // The coach's typical serving for this food, carried through so the parse
    // can fall back to it when the member named no quantity.
    let defaultGrams = null;
    try {
      // Match on every name column the seeds populate, not just `name`.
      // The seeds put the everyday name in `name_local` ("Whey Protein") and
      // the full product name in `name` ("Whey Protein (Unflavoured)"), so a
      // name-only lookup missed exactly the foods members type — and we fell
      // back to the AI's estimate for them.
      //
      // Ordering matters: exact hits first, then a prefix match, so "Whey
      // Protein" prefers the plain entry over "Whey Protein (Chocolate)".
      const q = String(f.name || '').trim();
      const ql = q.toLowerCase();

      // Match against the BASE name — the part before any bracket — so "Egg"
      // is compared with "Eggs", not with the whole string "Egg Yolk (Raw)".
      //
      // The earlier version ranked prefix matches by LENGTH(name), which
      // looks sensible and is wrong: for "Egg" the shortest prefix match is
      // "Egg Yolk (Raw)" (14 chars), shorter than "Eggs (Whole, Raw)" (17).
      // That logged 165g of egg as 531 kcal instead of 256. A component of a
      // food must never win over the food itself.
      //
      // Rank order:
      //   0  exact full name
      //   1  exact everyday name (name_local / name_hindi)
      //   2  base name equals the query, singular or plural  <- "Eggs" for "Egg"
      //   3  declared alias
      //   4  base name starts with the query AND a word break follows
      //      ("Egg Bhurji" yes, "Eggplant" no)
      //   5  anything else that matched
      const { rows } = await pool.query(
        `WITH c AS (
           SELECT id, name, per_100g, verified, default_grams,
                  LOWER(BTRIM(SPLIT_PART(name, '(', 1))) AS base
           FROM foods
           WHERE LOWER(name)       = $1
              OR LOWER(name_local) = $1
              OR LOWER(name_hindi) = $1
              OR LOWER(name_aliases::text) LIKE $2
              OR LOWER(name)       LIKE $3
         )
         SELECT id, name, per_100g, verified, default_grams,
                CASE
                  WHEN LOWER(name) = $1                              THEN 0
                  WHEN base = $1                                     THEN 1
                  WHEN base IN ($1 || 's', $1 || 'es')               THEN 2
                  WHEN RTRIM($1, 's') = RTRIM(base, 's')             THEN 2
                  WHEN base LIKE $1 || ' %'                          THEN 4
                  ELSE 5
                END AS rank,
                -- Some foods are seeded twice: once per 100g and once per
                -- serving ("Flaxseed Oil (Alsi Tel)" 884 vs "Flaxseed Oil
                -- (1 tsp / 5ml)" 44). Both share a base name, so a plain
                -- query could land on the per-serving row and be wrong by
                -- 20x. Per-100g always wins unless the member asked for the
                -- unit explicitly — which the exact-name rank above handles.
                CASE WHEN name ~ '[(]([ ]*per[ ]|[ ]*[0-9])' THEN 1 ELSE 0 END AS per_unit
         FROM c
         ORDER BY rank ASC, per_unit ASC, verified DESC, LENGTH(base) ASC, id ASC
         LIMIT 1`,
        [ql, `%"${ql}"%`, `${ql}%`]
      );

      if (rows.length && rows[0].per_100g && (parseFloat(rows[0].per_100g.calories) || 0) > 0) {
        food_id = rows[0].id;
        per100g = normaliseNutrients(rows[0].per_100g);
        source  = rows[0].verified ? 'db-verified' : 'db';
        defaultGrams = rows[0].default_grams;
      }
    } catch (e) {
      console.error('ai-chat DB enrich failed for', f.name, e.message);
    }
    // Both checks, in order: a per-serving label is the more specific
    // diagnosis, so it wins if both would fire.
    out.push(flagCookingFat(flagSuspectDensity({
      ...f, food_id, per_100g: per100g, source,
      default_grams: defaultGrams,
    })));
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

/**
 * Pull JSON out of a model response that may not be pure JSON.
 *
 * Stripping ``` fences is not enough on its own: models occasionally prepend a
 * sentence, and a truncated response leaves an unclosed object. Slicing from
 * the first brace to the last recovers the common cases, and the caller gets a
 * typed reason when it genuinely cannot be salvaged.
 */
function extractJSON(text) {
  if (!text || !text.trim()) {
    const e = new Error('empty response'); e.kind = 'empty'; throw e;
  }
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();

  try { return JSON.parse(cleaned); } catch { /* fall through */ }

  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { /* fall through */ }
  }

  // An unclosed object almost always means the answer was cut off mid-write
  const opens = (cleaned.match(/{/g) || []).length;
  const closes = (cleaned.match(/}/g) || []).length;
  const e = new Error('unparseable model response');
  e.kind = opens > closes ? 'truncated' : 'malformed';
  e.sample = cleaned.slice(0, 400);
  throw e;
}

// ── POST /api/ai-chat/lab-report ─────────────────────────────────────────────
// Reads a lab report — PDF or a photo of a printout — and extracts the markers,
// so a member doesn't have to type twenty rows off a page.
//
// Gemini handles PDFs natively as inline data, which matters: rasterising a PDF
// client-side would lose the text layer and turn a clean extraction into OCR
// guesswork on medical numbers.
//
// NOTHING IS SAVED HERE. Extraction returns a preview the member confirms,
// because a misread decimal point on a blood test is a different order of
// mistake from a misread portion size. The client posts confirmed rows to
// /patients/me/labs as if they had been typed.
router.post('/lab-report', async (req, res) => {
  const { file, mimeType } = req.body || {};
  // The member overrode our classification ("It's a lab report"). Their word
  // beats the model's guess — read it as a report and skip the handoff.
  const force = !!(req.body || {}).force;

  if (!file || typeof file !== 'string') {
    return res.status(400).json({ error: 'A report file is required' });
  }
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
  const mt = allowed.includes(mimeType) ? mimeType : 'application/pdf';
  if (file.length > 10_000_000) {
    return res.status(413).json({ error: 'Report too large — try a single-page export or a photo' });
  }
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Reading reports needs GEMINI_API_KEY to be set' });
  }

  const prompt = `${force ? `The member has CONFIRMED this is a lab report. Set doc_type to
"lab_report" and extract the test rows even if the layout is unusual.

` : ''}You are looking at a file a fitness-app member uploaded using
the "lab report" button. They may well have used the wrong button, so FIRST
decide what the image actually is, then act accordingly.

Set "doc_type" to exactly one of:
  "lab_report"  a pathology/laboratory report with printed test rows
  "scale"       a weighing-scale reading — a photo of a scale's LED/LCD screen
                showing a weight, a smart-scale phone-app screenshot, or a body
                composition machine printout (InBody etc.)
  "meal"        a photo of food, a plate, a packet or a restaurant dish
  "unclear"     you genuinely cannot tell, or it is none of the above
If the image is a scale or a meal, set "results" to [] and do NOT invent lab
rows from it — the app will handle it on the correct path. When doc_type is
"unclear", put a SHORT plain-English question to the member in "question"
(e.g. "Is this your lab report, or a photo of your meal?").

Only when doc_type is "lab_report", extract EVERY numeric test result. For each one give:
  test_name  the marker as printed, cleaned up (e.g. "HbA1c", "Vitamin D",
             "Total Cholesterol"). Expand obvious abbreviations. Do not invent
             markers that are not on the page.
  value      the numeric result only, no units, no symbols
  unit       as printed (%, mg/dL, ng/mL, pg/mL, U/L, mIU/L, g/dL ...)
  ref_min    lower bound of the printed reference range, null if absent
  ref_max    upper bound, null if absent
  confidence "high" when the row is clean and unambiguous, "low" when the scan
             is unclear, the number is partly obscured, or you are unsure you
             read it correctly

Also extract:
  test_date  the SAMPLE COLLECTION date in YYYY-MM-DD. Indian reports usually
             print DD/MM/YYYY — read it as day first, never month first. If
             both collection and report dates appear, use collection. null if
             you cannot find it.
  lab_name   the laboratory's name if printed.

RULES
· Ranges printed as "13.0 - 17.0" give ref_min 13 and ref_max 17.
· Ranges printed as "< 200" give ref_min null and ref_max 200.
· Ranges printed as "> 40" give ref_min 40 and ref_max null.
· Skip qualitative results (Positive/Negative/Nil) — numeric only.
· Skip calculated ratios unless a numeric reference range is printed.
· If a value is illegible, still list the row with value null and confidence
  "low" so the member can fill it in, rather than omitting the test silently.
· Never estimate or infer a value that is not printed.

Return ONLY raw JSON, no markdown fences:
{
  "doc_type": "lab_report",
  "question": null,
  "test_date": "2026-08-14",
  "lab_name": "Metropolis",
  "results": [
    { "test_name": "HbA1c", "value": 5.8, "unit": "%", "ref_min": 4.0,
      "ref_max": 5.6, "confidence": "high" }
  ]
}`;

  try {
    // Document extraction is harder than chat, so the full model leads here
    // rather than the lite one the text paths use. A lab panel with thirty
    // markers is a long structured answer, and lite models truncate it.
    const models = [...new Set([
      process.env.GEMINI_DOC_MODEL || 'gemini-2.5-flash',
      ...GEMINI_MODELS,
    ])].filter(Boolean);

    let parsed = null, usedModel = null, lastErr;

    for (const model of models) {
      try {
        const response = await axios.post(
          `${geminiUrlFor(model)}?key=${GEMINI_API_KEY}`,
          {
            contents: [{ parts: [
              { text: prompt },
              { inline_data: { mime_type: mt, data: file } },
            ] }],
            generationConfig: {
              temperature: 0,
              // 4000 was not enough for a full panel — the answer was being cut
              // off mid-object, which arrives as unparseable JSON.
              maxOutputTokens: 16000,
              // Ask the API itself to guarantee JSON rather than trusting the
              // prompt. This is the single biggest reliability win here.
              responseMimeType: 'application/json',
            },
          },
          // 50s per attempt, not 90. The route may try two models in sequence,
          // and the browser gives up at 120s — two 90s attempts would blow past
          // that and the member would see a timeout even though the second
          // model was about to succeed.
          { headers: { 'content-type': 'application/json' }, timeout: 50000 }
        );

        const cand = response.data.candidates?.[0];
        const finish = cand?.finishReason;
        const text = cand?.content?.parts?.map(p => p.text).join('') || '';

        if (finish && !['STOP', 'MAX_TOKENS'].includes(finish)) {
          const e = new Error(`model stopped: ${finish}`); e.kind = 'blocked'; throw e;
        }
        parsed = extractJSON(text);
        usedModel = model;
        if (finish === 'MAX_TOKENS') {
          console.warn(`lab-report: ${model} hit the token ceiling — results may be partial`);
        }
        break;
      } catch (e) {
        lastErr = e;
        // Log enough to diagnose without dumping a patient's blood work
        console.warn(`lab-report: ${model} failed —`, e.kind || e.message,
                     e.sample ? `| starts: ${e.sample.slice(0, 120)}` : '');
      }
    }
    if (!parsed) throw lastErr || new Error('Could not read the report');

    const nOrNull = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
    const results = (Array.isArray(parsed.results) ? parsed.results : [])
      .filter(r => r && r.test_name)
      .slice(0, 80)
      .map(r => ({
        test_name:  String(r.test_name).trim().slice(0, 100),
        value:      nOrNull(r.value),
        unit:       r.unit ? String(r.unit).trim().slice(0, 30) : null,
        ref_min:    nOrNull(r.ref_min),
        ref_max:    nOrNull(r.ref_max),
        confidence: r.confidence === 'low' ? 'low' : 'high',
      }));

    // A future or nonsensical date is more likely a DD/MM misread than a real
    // one, so drop it rather than carry it into the member's history.
    let testDate = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(parsed.test_date || '')) {
      const d = new Date(parsed.test_date);
      const tenYearsAgo = new Date(); tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
      if (d <= new Date() && d >= tenYearsAgo) testDate = parsed.test_date;
    }

    const unreadable = results.filter(r => r.value === null).length;
    const lowConf = results.filter(r => r.confidence === 'low').length;

    // The member pressed the report button but sent something else. Rather
    // than the dead-end "I couldn't find any numeric results", tell the client
    // which pipeline this belongs on — /photo already reads scale displays,
    // scale-app screenshots and meals. The client re-sends the same file there.
    const docType = ['lab_report', 'scale', 'meal', 'unclear'].includes(parsed.doc_type)
      ? parsed.doc_type : 'lab_report';
    if (docType !== 'lab_report' && !results.length && !force) {
      const question = parsed.question ? String(parsed.question).slice(0, 200) : null;
      return res.json({
        doc_type: docType,
        results: [],
        // 'photo' → auto-route. 'ask' → let the member decide; guessing wrong
        // on a genuine report would silently lose their blood work.
        route_to: docType === 'unclear' ? 'ask' : 'photo',
        reply: docType === 'scale'
          ? "That's a scale reading — logging it as your weigh-in."
          : docType === 'meal'
            ? "That's food — reading it as a meal."
            : (question || "I can't tell what this is. Is it a lab report, or a photo of a meal or your scale?"),
        aiModel: usedModel,
      });
    }

    res.json({
      doc_type: docType,
      test_date: testDate,
      lab_name: parsed.lab_name ? String(parsed.lab_name).slice(0, 120) : null,
      results,
      needs_review: unreadable + lowConf,
      // Deliberately explicit: this is a draft, not a saved record.
      reply: results.length
        ? `Found ${results.length} result${results.length > 1 ? 's' : ''}${testDate ? ` from ${testDate}` : ''}. ` +
          `Check them against your report${unreadable + lowConf ? ` — ${unreadable + lowConf} need${unreadable + lowConf > 1 ? '' : 's'} your attention` : ''}, then save.`
        : "I couldn't find any numeric results on that page — try the page with the test table on it.",
      aiModel: usedModel,
    });
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message;
    console.error('lab-report read error | status:', err.response?.status, '| detail:', detail);
    const st = err.response?.status;

    // Distinguish the failures so the member knows whether to retry, crop the
    // file, or give up and type it — "please try again" on a report that will
    // never parse just wastes their time.
    if (err.kind === 'truncated') {
      return res.status(502).json({
        error: 'That report has more results than I can read in one go — try uploading one page at a time.' });
    }
    if (err.kind === 'blocked') {
      return res.status(502).json({
        error: "The reader wouldn't process that file. If it's a scan, a clearer photo of the results table usually works." });
    }
    if (err.kind === 'empty' || err.kind === 'malformed' || err instanceof SyntaxError) {
      return res.status(502).json({
        error: 'I couldn\'t make sense of that report. A photo of just the results table often works better than the full PDF.' });
    }
    if (st === 400) {
      return res.status(502).json({
        error: 'That file type was rejected. Try exporting the report as a PDF, or photograph the results page.' });
    }
    return res.status(st === 429 || st === 503 ? st : 502).json({
      error: st === 429 ? 'Busy right now — try again in a moment'
           : st === 401 ? 'Report reading authentication failed — check GEMINI_API_KEY'
           : 'Could not read that report — a clearer scan or the PDF itself usually works',
    });
  }
});

// ── POST /api/ai-chat/photo ──────────────────────────────────────────────────
// Photo food logging: member snaps their plate, AI identifies each item with an
// estimated portion. Vision needs Gemini specifically (Groq's text models can't
// see images), so this endpoint doesn't use the usual provider chain.
//
// Body: { image: "<base64, no data: prefix>", mimeType: "image/jpeg", mealSlots }
// Returns the same shape as /parse's food list, so the client reuses one
// preview component for typed, spoken and photographed logging.
// ── POST /api/ai-chat/voice-transcribe ───────────────────────────────────────
// Body: { audio: base64, mimeType, langHint }
// Returns: { transcript }
//
// Why server-side: on-device Web Speech mangles Indian English, Hinglish and
// food vocabulary (bhindi, katori, rajma), and iOS has no Web Speech at all.
// Gemini transcribes the recorded audio instead — same inline_data pattern and
// same models as /photo. The client falls back to its on-device text if this
// endpoint fails, so errors here degrade, never break.
router.post('/voice-transcribe', async (req, res) => {
  const { audio, mimeType, langHint } = req.body;

  if (!audio || typeof audio !== 'string') {
    return res.status(400).json({ error: 'Audio required' });
  }
  // 30s of opus is ~250 KB of base64; even uncompressed formats fit well
  // under this. Anything bigger is not a voice note.
  if (audio.length > 6_000_000) {
    return res.status(413).json({ error: 'Recording too long — keep it under 30 seconds' });
  }
  if (!GEMINI_API_KEY && !GROQ_API_KEY) {
    return res.status(500).json({ error: 'Voice transcription needs GEMINI_API_KEY or GROQ_API_KEY to be set' });
  }

  const mt = /^audio\/[a-z0-9.+-]+$/i.test(String(mimeType || '')) ? mimeType : 'audio/webm';

  // ── Engine 2: Groq-hosted Whisper large-v3 ─────────────────────────────────
  // A dedicated ASR model, strong on Indian accents, using the GROQ_API_KEY
  // this file already has for chat fallback — no new vendor, no new billing.
  // Runs when Gemini fails or is throttled (429/503 bursts on free tier), so a
  // provider hiccup degrades to a different world-class engine instead of to
  // the inaccurate on-device text.
  async function groqWhisper() {
    if (!GROQ_API_KEY) return null;
    const ext = mt.includes('mp4') ? 'mp4' : mt.includes('ogg') ? 'ogg' : 'webm';
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from(audio, 'base64')], { type: mt }), `voice.${ext}`);
    fd.append('model', 'whisper-large-v3');
    fd.append('temperature', '0');
    fd.append('response_format', 'json');
    // Whisper's prompt parameter biases style — nudge it toward Roman-script
    // Hinglish with food words kept as spoken, matching the Gemini output.
    fd.append('prompt', 'Hinglish health log in Roman script: 2 roti, 1 katori dal, weight 82.5 kg, surya namaskar done.');
    const r = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions', fd,
      { headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, timeout: 25000 }
    );
    return String(r.data?.text || '').trim();
  }

  const prompt = `Transcribe this voice note exactly as spoken.
Rules:
- The speaker is logging food, workouts or health data, usually in Indian English or Hinglish (mixed Hindi and English).
- Keep food and exercise words as spoken: roti, dal, katori, bhindi, paneer, surya namaskar — do not translate them to English equivalents.
- If the speech is mostly Hindi, transliterate it into Roman script rather than Devanagari.
- Write numbers as digits (2 roti, 250 ml, 82.5 kg).
- Return ONLY the transcript text. No quotes, no labels, no commentary.
- If there is no intelligible speech, return an empty string.${langHint === 'hi-IN' ? '\n- The speaker has set Hindi as their preferred language.' : ''}`;

  try {
    const models = [GEMINI_MODELS[0], GEMINI_MODELS[1]].filter(Boolean);
    let transcript = null, engine = null, lastErr;

    if (GEMINI_API_KEY) {
      for (const model of models) {
        try {
          const response = await axios.post(
            `${geminiUrlFor(model)}?key=${GEMINI_API_KEY}`,
            {
              contents: [{
                parts: [
                  { text: prompt },
                  { inline_data: { mime_type: mt, data: audio } },
                ],
              }],
              generationConfig: { temperature: 0, maxOutputTokens: 500 },
            },
            { headers: { 'content-type': 'application/json' }, timeout: 25000 }
          );
          const cand = response.data.candidates?.[0];
          transcript = (cand?.content?.parts?.map(p => p.text).join('') || '').trim();
          engine = `gemini/${model}`;
          break;
        } catch (e) { lastErr = e; }
      }
    }

    if (transcript === null) {
      try {
        transcript = await groqWhisper();
        if (transcript !== null) engine = 'groq/whisper-large-v3';
      } catch (e) { lastErr = e; }
    }

    if (transcript === null) throw lastErr || new Error('No transcription engine available');

    // engine is returned for debugging and for the edit-rate accuracy metric —
    // the client ignores it today.
    return res.json({ transcript: transcript.slice(0, 1000), engine });
  } catch (err) {
    console.error('voice-transcribe failed:', err.response?.data?.error?.message || err.message);
    return res.status(502).json({ error: 'Could not transcribe the recording' });
  }
});

router.post('/photo', async (req, res) => {
  const { image, mimeType, mealSlots } = req.body;

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Image required' });
  }
  // ~8 MB of base64 ≈ 6 MB image. Bigger than that is a phone photo that
  // should have been downscaled client-side.
  if (image.length > 8_000_000) {
    return res.status(413).json({ error: 'Image too large — try a smaller photo' });
  }
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Photo logging needs GEMINI_API_KEY to be set' });
  }

  const slots = Array.isArray(mealSlots) && mealSlots.length
    ? mealSlots.join(' | ') : 'Meal 1 | Meal 2 | Meal 3';

  const prompt = `You are looking at a photo a member sent to their fitness coach.
First decide what kind of image this is:

A) A MEAL — food on a plate, in bowls, packaged food, a drink.
B) A WEIGHT OR BODY-COMPOSITION READING — a smart-scale app screenshot
   (Body Fat %, Muscle Mass, BMR, Visceral Fat tiles...), a body-analysis
   machine printout (InBody or similar), or a photo of a weighing scale's
   display showing a number.
C) A LAB / PATHOLOGY REPORT — a printed or scanned page of test rows with
   values and reference ranges (Haemoglobin, HbA1c, Vitamin D, Lipid Profile...).
   Members sometimes send these to the camera button by mistake.
D) Neither.

For type C: set "kind" to "lab_report", empty foods, null weight, empty
body_metrics. Do not try to read the individual test rows here.

For type B:
- "weight_kg": the main body weight in kg. If the screen shows pounds, convert
  (1 lb = 0.4536 kg). If no overall weight is visible, null.
- "body_metrics": every OTHER metric tile visible, as
  { "name": "...", "value": number, "unit": "..." }. Use the on-screen names
  (Body Fat, Muscle Mass %, BMI, BMR, Bone Mass, Body Hydration, Metabolic Age,
  Protein, Skeletal Muscle, Subcutaneous Fat, Visceral Fat, Lean Body Mass...).
  Numbers only — strip the units into "unit" (%, kg, Cal, years, score...).
  Do NOT repeat the main weight inside body_metrics.
- "foods": [] for type B. Set "reply" to one short line stating the weight and
  how many metrics you read, e.g. "Got it — 84.35 kg, plus 18 body metrics
  from your scale."
For type D: empty foods, null weight, empty body_metrics, and a reply saying
what the image seems to be and that you could not find food or readings in it.

ALWAYS include "kind": one of "meal", "body_scan", "lab_report", "other".

For type A (a meal), "weight_kg" is null, "body_metrics" is [], and:

Identify EVERY distinct food item you can see and estimate its portion in grams
from visual cues (plate size, bowl size, number of pieces).

Portion guides: 1 chapati/roti≈30g, 1 idli≈40g, 1 dosa≈80g, 1 katori/bowl of
dal≈150g, 1 katori sabzi≈100g, 1 katori rice≈100g, 1 plate rice≈150g,
1 glass≈200ml, 1 egg≈55g, 1 piece of chicken≈60g, 1 samosa≈50g.

For each item give accurate per-100g nutrition (USDA / NIN India values, cooked
as eaten in India): calories(kcal), protein, total_carbs, fat, fiber, sugar in
grams, and sodium, calcium, iron, potassium, vit_c in mg.
   CRITICAL — per_100g means PER 100 GRAMS OF THE FOOD ITSELF, never per
   serving, per scoop, per piece or per packet. Supplement and powder labels
   are printed per scoop, and copying those numbers understates the food by
   3-4x. Reference points to check yourself against:
     whey protein powder  ~400 kcal, 80g protein per 100g  (NOT ~120/24, that
                          is one 30g scoop)
     peanut butter        ~590 kcal per 100g
     any oil / ghee       ~900 kcal per 100g
     sugar                ~400 kcal per 100g
   If a dry powder or fat comes out under 300 kcal per 100g, you have almost
   certainly copied a per-serving label — recalculate for 100g.


Meal slots available: ${slots}

Be honest about uncertainty: set confidence to "low" when a item is partly
hidden or hard to identify. If the photo contains no food at all, return an
empty foods array and say so in reply.

Return ONLY raw JSON, no markdown fences:
{
  "reply": "I can see 2 chapatis, dal and a small salad — about 420 kcal.",
  "weight_kg": null,
  "body_metrics": [],
  "foods": [
    { "name": "Chapati", "qty_text": "2 pieces", "grams": 60, "meal": null, "category": "grain",
      "confidence": "high",
      "per_100g": { "calories": 297, "protein": 8, "total_carbs": 61, "fat": 3.7,
        "fiber": 4.9, "sugar": 1.6, "sodium": 298, "calcium": 33, "iron": 2.4,
        "potassium": 196, "vit_c": 0 } }
  ]
}`;

  try {
    const models = [GEMINI_MODELS[0], GEMINI_MODELS[1]].filter(Boolean);
    let lastErr, parsed = null, usedModel = null;

    for (const model of models) {
      try {
        const response = await axios.post(
          `${geminiUrlFor(model)}?key=${GEMINI_API_KEY}`,
          {
            contents: [{
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType || 'image/jpeg', data: image } },
              ],
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2500 },
          },
          { headers: { 'content-type': 'application/json' }, timeout: 45000 }
        );
        const cand = response.data.candidates?.[0];
        const text = cand?.content?.parts?.map(p => p.text).join('') || '';
        if (!text) throw new Error('Empty response from vision model');
        parsed = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
        usedModel = model;
        break;
      } catch (e) { lastErr = e; }
    }
    if (!parsed) throw lastErr || new Error('Vision model failed');

    // ── Scale screenshots: weight + body-composition metrics ──────────────────
    // The 20–300 kg gate and the "main weight does not go into lab history"
    // rule live in services/scaleParse.js, which test-coach-view imports
    // directly instead of keeping a copy that drifts.
    const { weight_kg, body_metrics } = cleanScalePayload(parsed);

    const rawFoods = Array.isArray(parsed.foods) ? parsed.foods : [];
    const validFoods = rawFoods
      .filter(f => f && f.name && (parseFloat(f.grams) || 0) > 0)
      .slice(0, 20)
      .map(f => ({
        name:       String(f.name).trim().slice(0, 100),
        qty_text:   String(f.qty_text || '').slice(0, 60),
        grams:      Math.min(3000, Math.round(parseFloat(f.grams))),
        meal:       f.meal ? String(f.meal).slice(0, 40) : null,
        category:   f.category ? String(f.category).toLowerCase().trim() : null,
        confidence: ['high', 'medium', 'low'].includes(f.confidence) ? f.confidence : 'medium',
        per_100g:   f.per_100g || {},
      }));

    const foods = await enrichFromDB(validFoods);

    // Feed anything new back into the food database. Not awaited — the member
    // gets their preview immediately and the learning happens behind it.
    learnFoods(foods).catch(err => console.error('learnFoods failed:', err.message));


    let totCal = 0, totPro = 0, totCarb = 0, totFat = 0;
    for (const f of foods) {
      // The phrase this food's portion would be remembered under, so the
      // client can report a correction without re-deriving it
      f.portion_phrase = portionPhrase(f.qty_text, f.name);
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

    const fallbackReply = foods.length
      ? `I found ${foods.length} item${foods.length > 1 ? 's' : ''} in that photo.`
      : weight_kg != null
        ? `Got it — ${weight_kg} kg from your scale${body_metrics.length ? `, plus ${body_metrics.length} body metrics` : ''}.`
        : "I couldn't spot any food or readings in that photo — try a clearer shot.";

    // Mirror of the lab-report handoff: a report sent to the camera button gets
    // routed to the reader rather than coming back as "no food found".
    if (parsed.kind === 'lab_report' && !foods.length && weight_kg == null && !body_metrics.length) {
      return res.json({
        kind: 'lab_report',
        route_to: 'lab',
        reply: "That's a lab report — reading the results instead.",
        foods: [], body_metrics: [], workouts: [], activities: [], acv: [], supplements: [],
        weight_kg: null, water_ml_add: null, sleep: null,
        totals: { cal: 0, pro: 0, carb: 0, fat: 0 },
        aiProvider: 'gemini-vision', aiModel: usedModel,
      });
    }

    return res.json({
      kind: ['meal', 'body_scan', 'lab_report', 'other'].includes(parsed.kind) ? parsed.kind : null,
      // For a scale read the reply is built here rather than taken from the
      // model — it produced lines like "plus 0 body metrics from your scale",
      // which reads like a failure when a plain weigh-in is a perfectly good
      // result. Deterministic copy also keeps the number consistent with the
      // value actually being applied.
      reply: weight_kg != null
        ? `Got it — ${weight_kg} kg${body_metrics.length ? `, plus ${body_metrics.length} body metric${body_metrics.length > 1 ? 's' : ''}` : ''} from your scale.`
        : (String(parsed.reply || '').slice(0, 400) || fallbackReply),
      foods,
      body_metrics,
      workouts: [], activities: [], acv: [], supplements: [],
      weight_kg, water_ml_add: null, sleep: null,
      totals: {
        cal: Math.round(totCal), pro: +totPro.toFixed(1),
        carb: +totCarb.toFixed(1), fat: +totFat.toFixed(1),
      },
      aiProvider: 'gemini-vision', aiModel: usedModel,
    });
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message;
    console.error('ai-chat photo error | status:', err.response?.status, '| detail:', detail);
    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: 'Could not read the photo result — please try again' });
    }
    const st = err.response?.status;
    return res.status(st === 429 || st === 503 ? st : 502).json({
      error: st === 429 ? 'AI is busy — try again in a moment'
           : st === 401 ? 'Photo AI authentication failed — check GEMINI_API_KEY'
           : 'Could not analyse that photo — please try again',
    });
  }
});

// ── Member questions ("how many calories today?") ─────────────────────────────
// The parse prompt flags questions instead of parsing them; these helpers build
// a compact snapshot of the member's real data and ask the AI to answer FROM
// THAT SNAPSHOT ONLY. Deterministic numbers, conversational delivery.

const { computeDayTotals } = require('../services/digests');
const { loadProgramDays } = require('./programs');

/**
 * Which program day is scheduled for a given IST date.
 *
 * Weekday scheduling lives in the day_label text — "Push · Mon" — not in a
 * column (see the project brief), so the match is on the label. Programs with
 * unlabelled days ("Day 1", "Day 2") are not weekday-scheduled at all; those
 * return null and the snapshot says so rather than guessing a day and telling
 * a member to train legs on the wrong morning.
 *
 * The abbreviations and their order mirror `WD` in WorkoutLog.jsx.
 */
// Extracted to services/programDay.js. The two copies had drifted: the local
// isWeekdayScheduled was missing its trailing word boundary, so "Monsoon
// Circuit" counted as a Monday and "Sunrise Flow" as a Sunday — the program
// read as weekday-scheduled while programDayForDate, which DID check both
// boundaries, found no day for today. A member on such a program was told it
// was a rest day every single day.
const { programDayForDate, isWeekdayScheduled } = require('../services/programDay');

async function buildDayContext(userId, ctx) {
  const today = getISTDate();
  const [{ rows: logs }, { rows: prof }, { rows: progRows }, { rows: sessions }] = await Promise.all([
    pool.query(
      `SELECT log_date, weight_kg, water_ml, sleep, activities, acv, supplements, food_items
       FROM daily_logs WHERE patient_id=$1 AND log_date > ($2::date - 7)
       ORDER BY log_date DESC`, [userId, today]),
    pool.query(
      `SELECT macro_kcal, macro_pro, macro_carb, macro_fat, water_target, target_weight, start_weight
       FROM patient_profiles WHERE user_id=$1`, [userId]),
    pool.query(
      `SELECT id, name FROM workout_programs WHERE patient_id=$1 AND active = true LIMIT 1`,
      [userId]),
    // Sets are counted in SQL rather than pulled back and reduced in JS — a
    // member with a long history would otherwise drag every set row of the
    // week into memory to produce one number.
    pool.query(
      `SELECT ws.session_date, ws.duration_min,
              COUNT(ss.id)::int AS set_count,
              COALESCE(SUM(ss.reps * ss.weight_kg), 0)::float AS volume_kg
         FROM workout_sessions ws
         LEFT JOIN session_sets ss ON ss.session_id = ws.id
        WHERE ws.patient_id = $1 AND ws.session_date > ($2::date - 7)
        GROUP BY ws.id, ws.session_date, ws.duration_min
        ORDER BY ws.session_date DESC`, [userId, today]),
  ]);

  const t = logs.find(l => String(l.log_date).slice(0, 10) === today) || null;
  const doneCount = (obj) => Object.values(obj || {}).filter(Boolean).length;
  const totals = computeDayTotals(t?.food_items);

  const lines = [];
  lines.push(`Date: ${today} (IST)`);
  if (t) {
    lines.push(`Today so far:`);
    lines.push(`  Calories eaten: ${totals.cal} kcal (P ${totals.pro}g · C ${totals.carb}g · F ${totals.fat}g)` +
      (totals.unknown ? ` — plus ${totals.unknown} logged item(s) with no nutrition data, not counted` : ''));
    lines.push(`  Food items: ${(t.food_items || []).map(f => `${f.name} ${f.grams}g`).join(', ') || 'none logged'}`);
    lines.push(`  Weight: ${t.weight_kg ? t.weight_kg + ' kg' : 'not logged today'}`);
    lines.push(`  Water: ${t.water_ml || 0} ml of ${ctx.waterTargetMl} ml target`);
    lines.push(`  Protocol done: activities ${doneCount(t.activities)}/${ctx.activities.length}, ` +
               `ACV ${doneCount(t.acv)}/${ctx.acv.length}, supplements ${doneCount(t.supplements)}/${ctx.supplements.length}`);
    lines.push(`  Sleep: ${t.sleep?.bedtime && t.sleep?.waketime ? `${t.sleep.bedtime}–${t.sleep.waketime}` : 'not logged'}`);
  } else {
    lines.push(`Today: nothing logged yet.`);
  }

  const p = prof[0];
  if (p) {
    const tg = [];
    if (p.macro_kcal) tg.push(`calorie target ${p.macro_kcal} kcal`);
    if (p.macro_pro)  tg.push(`protein target ${p.macro_pro} g`);
    if (p.macro_carb) tg.push(`carb target ${p.macro_carb} g`);
    if (p.macro_fat)  tg.push(`fat target ${p.macro_fat} g`);
    if (p.target_weight)    tg.push(`goal weight ${p.target_weight} kg (started ${p.start_weight || '?'} kg)`);
    if (tg.length) lines.push(`Targets: ${tg.join(', ')}`);
  }

  // ── Training ────────────────────────────────────────────────────────────────
  // "What's my workout today?" was the most obvious question this snapshot
  // could not answer. It carried food, water, weight, sleep and protocol, and
  // nothing about the programme the coach had assigned — so the member got
  // "I don't have that" from an app that did.
  const prog = progRows[0] || null;
  if (prog) {
    const days     = await loadProgramDays(prog.id);
    const todayDay = programDayForDate(days, today);
    lines.push(`Workout programme: "${prog.name}" (${days.length} day${days.length === 1 ? '' : 's'})`);
    if (todayDay) {
      const ex = todayDay.exercises.map(e => {
        const reps = e.target_reps_min && e.target_reps_max
          ? `${e.target_reps_min}-${e.target_reps_max}` : (e.target_reps_min || '');
        return `${e.exercise_name}${e.target_sets ? ` ${e.target_sets}x${reps || '?'}` : ''}`;
      });
      lines.push(`  Today is: ${todayDay.day_label} - ${ex.join(', ') || 'no exercises listed'}`);
    } else if (isWeekdayScheduled(days)) {
      lines.push(`  Today is a rest day - no programme day is scheduled for today.`);
    } else {
      lines.push(`  Days: ${days.map(d => d.day_label).join(', ')} - not scheduled to weekdays, ` +
                 `so the member chooses which day to train.`);
    }
  } else {
    lines.push(`Workout programme: none assigned.`);
  }

  const todaySession = sessions.find(w => String(w.session_date).slice(0, 10) === today);
  if (todaySession) {
    lines.push(`  Trained today: ${todaySession.set_count} set(s)` +
      (todaySession.volume_kg ? `, ${Math.round(todaySession.volume_kg)} kg total volume` : '') +
      (todaySession.duration_min ? `, ${todaySession.duration_min} min` : ''));
  } else if (sessions.length) {
    lines.push(`  Not trained today. Last session: ${String(sessions[0].session_date).slice(0, 10)} ` +
      `(${sessions[0].set_count} sets).`);
  } else {
    lines.push(`  No workouts logged in the last 7 days.`);
  }

  const week = logs
    .filter(l => String(l.log_date).slice(0, 10) !== today)
    .map(l => {
      const d = computeDayTotals(l.food_items);
      return `  ${String(l.log_date).slice(0, 10)}: ${d.cal} kcal${l.weight_kg ? `, weight ${l.weight_kg} kg` : ''}`;
    });
  if (week.length) lines.push(`Previous days (last 7):\n${week.join('\n')}`);

  return lines.join('\n');
}

function buildAnswerPrompt(question, dayContext) {
  return `You are FitLife AI, the in-app assistant for a fitness coaching member in India.
The member asked: "${question}"

Answer USING ONLY the data below. Never invent numbers or estimate data that is
not present. If the data needed is missing, say so plainly and tell them how to
log it (they can just type or speak it to you).

MEMBER'S DATA:
${dayContext}

RULES:
- 1–3 short sentences, warm and direct, lead with the number they asked for.
- Numbers exactly as given in the data. No emojis. No markdown.
- If they ask how much is LEFT, subtract from the target when a target exists;
  if there is no target, give the eaten total and say no target is set.
- No medical advice, no diagnosis, no supplement or medication suggestions.
  Progress questions get facts, not clinical interpretation.
- Training questions: name the exercises exactly as listed, with their sets and
  reps. If today is a rest day, say so. Never invent an exercise, and never
  suggest one the coach has not programmed.

Return ONLY the answer text, nothing else.`;
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
    // Chat memory: last few turns + today's logged foods, so "make the dal
    // 250g" and "that was dinner" resolve to real items instead of failing.
    recent: (Array.isArray(context?.recent) ? context.recent : []).slice(-6)
      .filter(r => r && (r.role === 'user' || r.role === 'ai') && r.text)
      .map(r => ({ role: r.role, text: String(r.text).slice(0, 200) })),
    lastFoods: (Array.isArray(context?.lastFoods) ? context.lastFoods : []).slice(0, 20)
      .filter(f => f && f.name)
      .map(f => ({ name: String(f.name).slice(0, 100),
                   grams: Math.min(3000, Math.max(0, parseInt(f.grams) || 0)),
                   meal: f.meal ? String(f.meal).slice(0, 40) : null })),
  };

  try {
    const portions = await loadPortions(req.user.id);

    // The member's usual kitchen fat, used when this message names none.
    // Cheap, and it means "masala dosa" from someone who cooks in coconut is
    // not silently recorded as sunflower.
    let kitchenFat = null;
    try {
      const { rows } = await pool.query(
        `SELECT cooking_fat FROM patient_profiles WHERE user_id = $1`, [req.user.id]);
      kitchenFat = rows[0]?.cooking_fat || null;
    } catch (e) { console.error('cooking_fat lookup failed:', e.message); }

    const { text: rawText, provider, model } = await callAI(buildParsePrompt(cleanMsg, ctx, portions));

    const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed   = JSON.parse(jsonText);

    // ── Anything aimed at the coach becomes a message to the coach ────────────
    // "ask my coach to assign my workout" was landing in the parser as a log
    // attempt, so the member got "Nothing new to log there" — twice, because
    // they rephrased and got the same wall. The member had a reasonable request
    // and the app had a working member->coach message path since Sprint 1; the
    // two were simply never connected.
    //
    // Same helper the reply button uses, so this threads, marks read and pushes
    // to the coach identically. A second implementation here would drift.
    const coachMsg = typeof parsed.coach_message === 'string' ? parsed.coach_message.trim() : '';
    if (coachMsg) {
      const EMPTY = { question: false, weight_kg: null, activities: [], acv: [], supplements: [],
                      water_ml_add: null, sleep: null, foods: [], workouts: [],
                      totals: { cal: 0, pro: 0, carb: 0, fat: 0 } };
      try {
        const { sendMemberNote } = require('./patients');
        await sendMemberNote(req.user.id, coachMsg);
        return res.json({ ...EMPTY, sent_to_coach: true,
          reply: `Sent to your coach: "${coachMsg.slice(0, 120)}"` });
      } catch (err) {
        // Never claim it was sent when it was not — the offline queue shipped
        // exactly that bug and it is the one thing that makes a member stop
        // trusting the chat.
        if (err.code === 'NO_COACH') {
          return res.json({ ...EMPTY, sent_to_coach: false,
            reply: "You don't have a coach assigned yet, so I couldn't send that. " +
                   'Ask the FitLife team to assign one and try again.' });
        }
        console.error('coach_message send failed:', err);
        return res.json({ ...EMPTY, sent_to_coach: false,
          reply: "I couldn't send that to your coach just now. Please try again in a moment." });
      }
    }

    // ── Questions get answered, not parsed ────────────────────────────────────
    // "how many calories have I consumed today?" used to fall through as an
    // unparseable log and get "I couldn't find any details about your meals."
    // Now the parser flags it, we snapshot the member's real data, and a second
    // AI call answers from that snapshot only. Empty item arrays keep the
    // client's preview card hidden — the member just sees the answer.
    if (parsed.question && typeof parsed.question === 'string') {
      try {
        // A whole-day summary gets the SAME structured card the coach sees.
        // It is the same data either way, and the member was getting it as a
        // paragraph purely because this path predates the card. Detected here
        // rather than in the prompt so the member parse contract is untouched.
        if (/\b(summar(y|ise|ize)|rundown|full update|overview|how('s| is| am) (my|i) doing|whole day|entire day|my day (today|so far))\b/i
              .test(parsed.question)) {
          const { rows: me } = await pool.query(
            'SELECT id, name FROM users WHERE id = $1', [req.user.id]);
          if (me[0]) {
            return res.json({
              reply: null,
              summary: await buildCoachSummary(me[0]),
              question: true,
              weight_kg: null, activities: [], acv: [], supplements: [],
              water_ml_add: null, sleep: null, foods: [], workouts: [],
              totals: { cal: 0, pro: 0, carb: 0, fat: 0 },
            });
          }
        }

        const dayContext = await buildDayContext(req.user.id, ctx);
        const { text: answerText, provider: ap, model: am } =
          await callAI(buildAnswerPrompt(parsed.question.slice(0, 300), dayContext));
        return res.json({
          reply: String(answerText || '').trim().slice(0, 700)
            || "I couldn't work that out from your data — try asking in a different way.",
          question: true,
          weight_kg: null, activities: [], acv: [], supplements: [],
          water_ml_add: null, sleep: null, foods: [], workouts: [],
          totals: { cal: 0, pro: 0, carb: 0, fat: 0 },
          aiProvider: ap, aiModel: am,
        });
      } catch (qErr) {
        // A failure ANSWERING must not read like a failure LOGGING — return a
        // normal reply, not a 500, so the member knows the app itself is fine.
        console.error('question answering failed:', qErr.message);
        return res.json({
          reply: "I couldn't pull up your numbers just now — give it another try in a moment.",
          question: true,
          weight_kg: null, activities: [], acv: [], supplements: [],
          water_ml_add: null, sleep: null, foods: [], workouts: [],
          totals: { cal: 0, pro: 0, carb: 0, fat: 0 },
        });
      }
    }

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

    // ── Corrections — whitelist against foods actually in today's log ────────
    const loggedNames = new Map(ctx.lastFoods.map(f => [f.name.toLowerCase(), f.name]));
    const corrections = (Array.isArray(parsed.corrections) ? parsed.corrections : [])
      .filter(c => c && c.name && loggedNames.has(String(c.name).toLowerCase()))
      .slice(0, 10)
      .map(c => {
        const grams = parseInt(c.grams);
        return {
          name:  loggedNames.get(String(c.name).toLowerCase()),
          grams: Number.isFinite(grams) && grams >= 1 && grams <= 3000 ? grams : null,
          meal:  c.meal ? String(c.meal).slice(0, 40) : null,
        };
      })
      .filter(c => c.grams !== null || c.meal !== null);

    // Eval set: a correction is the member telling us the earlier parse was
    // wrong. Fire-and-forget — this is bookkeeping, not part of their log.
    if (corrections.length) {
      captureCorrectionSamples(req.user.id, corrections)
        .catch(err => console.error('captureCorrectionSamples failed:', err.message));
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
        category: f.category ? String(f.category).toLowerCase().trim() : null,
        per_100g: f.per_100g || {},
      }));

    let foods = await enrichFromDB(validFoods);

    // Feed anything new back into the food database. Not awaited — the member
    // gets their preview immediately and the learning happens behind it.
    learnFoods(foods).catch(err => console.error('learnFoods failed:', err.message));

    // The coach's typical serving, when the member named no quantity at all.
    // "masala dosa" with no number was landing at whatever the model guessed.
    foods = applyDefaultPortions(cleanMsg, foods);

    // The fat a cooked dish was made with, taken from the member's own words.
    // "ghee masala dosa" is 6.5g saturated per 100g; plain "masala dosa" is
    // 1.1g. The food table holds one total fat for everyone; the split belongs
    // to the meal.
    foods = applyCookingFat(foods, cleanMsg, kitchenFat);

    // Eval set: hold on to what the model returned for THIS message, so a
    // correction arriving three messages later can be paired back to it.
    // Only here, in /parse — a photo has no replayable text to pair against.
    rememberParseTurn(req.user.id, cleanMsg, foods)
      .catch(err => console.error('rememberParseTurn failed:', err.message));

    // Eval set: occasionally keep a parse nobody corrected, so a prompt change
    // can be scored on the easy cases too and not just the hard ones.
    maybeRecordControl(req.user.id, cleanMsg, foods)
      .catch(err => console.error('maybeRecordControl failed:', err.message));

    // Per-item macros + totals computed server-side — never trust AI arithmetic
    let totCal = 0, totPro = 0, totCarb = 0, totFat = 0;
    for (const f of foods) {
      // The phrase this food's portion would be remembered under, so the
      // client can report a correction without re-deriving it
      f.portion_phrase = portionPhrase(f.qty_text, f.name);
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
        // Structured sets → the client writes these as real set rows in
        // workout_sessions rather than a free-text note.
        // Cardio descriptors — the client turns these into real cardio rows on
        // the workout session (MET × time calories), not just a text note.
        cardio_type: ['walking','running','cycling','swimming','elliptical',
                      'rowing','stairs','skipping','yoga','other']
                      .includes(String(w.cardio_type)) ? String(w.cardio_type) : null,
        speed_kmh:   Number.isFinite(parseFloat(w.speed_kmh))
                      ? Math.min(60, Math.max(0, parseFloat(w.speed_kmh))) : null,
        distance_km: Number.isFinite(parseFloat(w.distance_km))
                      ? Math.min(500, Math.max(0, parseFloat(w.distance_km))) : null,
        sets: (Array.isArray(w.sets) ? w.sets : [])
          .slice(0, 30)
          .map(st => ({
            reps:      Math.min(500, Math.max(1, parseInt(st?.reps) || 0)),
            weight_kg: Math.min(500, Math.max(0, parseFloat(st?.weight_kg) || 0)),
          }))
          .filter(st => st.reps > 0),
      }));

    const nothingParsed = !weight_kg && !activities.length && !acv.length &&
      !supplements.length && !water_ml_add && !sleep && !foods.length && !workouts.length && corrections.length === 0;

    return res.json({
      // When nothing was parsed the model's own sentence is NOT trustworthy: a
      // repeated "walking 40 minutes" produced "Got it — logged a 40-minute
      // walk" with empty arrays, so the app claimed a save that never
      // happened. If there is nothing to apply, say so in our own words.
      reply: nothingParsed
        ? "Nothing new to log there — it may already be in today's log. Tell me what to change (\"make the walk 30 minutes\"), or add something new."
        : (String(parsed.reply || '').slice(0, 400) || 'Here\'s what I understood — review and apply.'),
      weight_kg,
      activities,
      acv,
      supplements,
      water_ml_add,
      sleep,
      foods,
      corrections,
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



/* ═══════════════════════════════════════════════════════════════════════════
   COACH AI — natural-language protocol management for monitors/admins
   "Set Bujju's water target to 4L, add evening walk, message him to log daily"
   ═══════════════════════════════════════════════════════════════════════════ */

const roleCheck = require('../middleware/roleCheck');

// Default protocol catalog — ids/labels mirror client/src/constants.js.
// The AI may ONLY use these ids (plus a member's existing custom item ids,
// resolved at apply time by label).
const CATALOG = {
  activities: [
    { id: 'walk',       label: 'Morning Walk' },
    { id: 'sun',        label: 'Sunlight Exposure' },
    { id: 'steps1',     label: 'Post Meal 1 Steps' },
    { id: 'resistance', label: 'Resistance Training' },
    { id: 'steps2',     label: 'Post Meal 2 Steps' },
    { id: 'steps3',     label: 'Post Meal 3 Steps' },
  ],
  acv: [
    { id: 'acv1', label: 'ACV before Meal 1' },
    { id: 'acv2', label: 'ACV before Meal 2' },
    { id: 'acv3', label: 'ACV before Meal 3' },
  ],
  supplements: [
    { id: 'b12',         label: 'Vitamin B12' },
    { id: 'd3',          label: 'Vitamin D3' },
    { id: 'fishoil',     label: 'Fish Oil' },
    { id: 'multi',       label: 'Multivitamin' },
    { id: 'flax',        label: 'Flaxseed Oil' },
    { id: 'yeast',       label: 'Nutritional Yeast' },
    { id: 'electrolyte', label: 'Electrolyte' },
  ],
};

function getISTDate() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
}

// Members visible to this coach: admin → all active patients, monitor → assigned
// ── Coach questions ──────────────────────────────────────────────────────────
// The coach AI could only ever CHANGE things. Asked "how many calories has
// Padmini eaten today", it had no matching operation, so it fell back to "what
// would you like to update?" — and kept doing that however the coach rephrased
// it. Every read had to be done by leaving the chat and opening the member.
//
// These build the same kind of real-data snapshot the member chat already uses
// for its own questions, and hand it to the model to phrase. Numbers are
// computed here; the model only writes the sentence.

/** One member's day + week, for questions naming a specific member. */
async function buildCoachMemberContext(member) {
  const today = getISTDate();
  const [{ rows: logs }, { rows: prof }] = await Promise.all([
    pool.query(
      `SELECT log_date, weight_kg, water_ml, sleep, activities, acv, supplements, food_items
         FROM daily_logs WHERE patient_id = $1 AND log_date > ($2::date - 7)
        ORDER BY log_date DESC`, [member.id, today]),
    pool.query(
      `SELECT macro_kcal, macro_pro, macro_carb, macro_fat, water_target,
              target_weight, start_weight,
              protocol_activities, protocol_acv, protocol_supplements,
              custom_activities, custom_acv, custom_supplements, item_overrides
         FROM patient_profiles WHERE user_id = $1`, [member.id]),
  ]);

  const t = logs.find(l => String(l.log_date).slice(0, 10) === today) || null;
  const p = prof[0] || {};
  const totals = computeDayTotals(t?.food_items);
  const lines = [`Member: ${member.name}`, `Date: ${today} (IST)`];

  if (t) {
    // Same resolver the summary card uses, so a prose answer and the card can
    // never name the same item differently.
    const act = resolveProtocolGroup('activities',  p, t.activities);
    const acv = resolveProtocolGroup('acv',         p, t.acv);
    const sup = resolveProtocolGroup('supplements', p, t.supplements);

    const waterLeft = p.water_target
      ? Math.max(0, p.water_target - (t.water_ml || 0)) : null;
    const kcalLeft = p.macro_kcal ? p.macro_kcal - totals.cal : null;

    lines.push(`Today so far:`);
    lines.push(`  Calories eaten: ${totals.cal} kcal (P ${totals.pro}g · C ${totals.carb}g · F ${totals.fat}g)` +
      (totals.unknown ? ` — plus ${totals.unknown} item(s) with no nutrition data, not counted` : ''));
    if (kcalLeft !== null) {
      lines.push(`  Calories remaining: ${kcalLeft >= 0 ? `${kcalLeft} kcal left of ${p.macro_kcal}` : `${Math.abs(kcalLeft)} kcal OVER the ${p.macro_kcal} target`}`);
    }
    lines.push(`  Food logged: ${(t.food_items || []).map(f => `${f.name} ${f.grams}g`).join(', ') || 'nothing'}`);
    lines.push(`  Weight: ${t.weight_kg ? t.weight_kg + ' kg' : 'not logged today'}`);
    lines.push(`  Water drunk: ${t.water_ml || 0} ml${p.water_target ? ` of ${p.water_target} ml target` : ' (no target set)'}`);
    if (waterLeft !== null) lines.push(`  Water remaining: ${waterLeft} ml`);
    lines.push(`  Activities done (${act.done.length}/${act.total}): ${act.done.join(', ') || 'none'}`);
    lines.push(`  Activities still to do: ${act.left.join(', ') || 'none'}`);
    lines.push(`  ACV done (${acv.done.length}/${acv.total}): ${acv.done.join(', ') || 'none'}`);
    lines.push(`  ACV still to do: ${acv.left.join(', ') || 'none'}`);
    lines.push(`  Supplements taken (${sup.done.length}/${sup.total}): ${sup.done.join(', ') || 'none'}`);
    lines.push(`  Supplements still to take: ${sup.left.join(', ') || 'none'}`);
    lines.push(`  Sleep: ${t.sleep?.bedtime && t.sleep?.waketime ? `${t.sleep.bedtime}-${t.sleep.waketime}` : 'not logged'}`);

    // Every subtraction the coach might ask for is done HERE. Asking a model to
    // work out what is left from two lists, or to subtract a total from a
    // target, is exactly where wrong numbers come from.
    lines.push(`  STILL PENDING today: activities ${act.left.join(', ') || 'none'}; ` +
               `ACV ${acv.left.join(', ') || 'none'}; ` +
               `supplements ${sup.left.join(', ') || 'none'}` +
               (waterLeft !== null ? `; water ${waterLeft} ml` : ''));
  } else {
    lines.push(`Today: nothing logged yet.`);
    // Even with nothing logged, "what's left" is the whole assigned protocol —
    // otherwise the answer would be "nothing pending", which is the opposite
    // of the truth.
    const all = (g) => resolveProtocolGroup(g, p, null).left.join(', ') || 'none assigned';
    lines.push(`  Everything is still outstanding: activities ${all('activities')}; ` +
               `ACV ${all('acv')}; supplements ${all('supplements')}` +
               (p.water_target ? `; water ${p.water_target} ml` : ''));
  }

  const tg = [];
  if (p.macro_kcal)    tg.push(`calorie target ${p.macro_kcal} kcal`);
  if (p.macro_pro)     tg.push(`protein target ${p.macro_pro} g`);
  if (p.macro_carb)    tg.push(`carb target ${p.macro_carb} g`);
  if (p.macro_fat)     tg.push(`fat target ${p.macro_fat} g`);
  if (p.target_weight) tg.push(`goal weight ${p.target_weight} kg (started ${p.start_weight || '?'} kg)`);
  if (tg.length) lines.push(`Targets: ${tg.join(', ')}`);

  const week = logs
    .filter(l => String(l.log_date).slice(0, 10) !== today)
    .map(l => {
      const d = computeDayTotals(l.food_items);
      return `  ${String(l.log_date).slice(0, 10)}: ${d.cal} kcal${l.weight_kg ? `, weight ${l.weight_kg} kg` : ''}`;
    });
  lines.push(week.length ? `Previous days (last 7):\n${week.join('\n')}` : `No logs in the previous 7 days.`);

  // What this member has written to their coach. Asking "what did Padmini say?"
  // on her own page should not need the coach to go and read the card.
  const { rows: msgs } = await pool.query(
    `SELECT note, created_at, coach_read_at FROM monitor_notes
      WHERE patient_id = $1 AND from_member = true
      ORDER BY id DESC LIMIT 10`, [member.id]);
  lines.push(msgs.length
    ? `Messages from this member:\n` + msgs.map(m =>
        `  ${String(m.created_at).slice(0, 10)}${m.coach_read_at ? '' : ' [UNREAD]'}: ` +
        `"${String(m.note).slice(0, 200)}"`).join('\n')
    : `Messages from this member: none.`);

  return lines.join('\n');
}

/** Roster-wide snapshot, for "who hasn't logged today" style questions. */
async function buildCoachRosterContext(members) {
  const today = getISTDate();
  const ids = members.map(m => m.id);
  const { rows } = await pool.query(
    `SELECT patient_id, weight_kg, water_ml, food_items, compliance_pct
       FROM daily_logs WHERE patient_id = ANY($1::int[]) AND log_date = $2::date`,
    [ids, today]);
  const byId = new Map(rows.map(r => [r.patient_id, r]));

  const lines = [`Date: ${today} (IST)`, `Coach's members (${members.length}):`];
  for (const m of members) {
    const r = byId.get(m.id);
    if (!r) { lines.push(`  ${m.name}: nothing logged today`); continue; }
    const d = computeDayTotals(r.food_items);
    const bits = [];
    bits.push(`${d.cal} kcal`);
    if (r.weight_kg) bits.push(`weight ${r.weight_kg} kg`);
    if (r.water_ml)  bits.push(`${r.water_ml} ml water`);
    if (r.compliance_pct != null) bits.push(`${r.compliance_pct}% compliance`);
    lines.push(`  ${m.name}: ${bits.join(', ')}`);
  }
  // ── Messages members have sent ─────────────────────────────────────────────
  // The roster context was today's logs and nothing else, so "show the msg
  // from members" came back as a list of who had logged what — a plausible
  // answer to a question nobody asked. The messages existed; this snapshot
  // simply had no idea they did.
  const { rows: msgs } = await pool.query(
    `SELECT mn.patient_id, mn.note, mn.created_at, mn.coach_read_at
       FROM monitor_notes mn
      WHERE mn.patient_id = ANY($1::int[]) AND mn.from_member = true
      ORDER BY mn.id DESC
      LIMIT 25`, [ids]);
  const nameOf = new Map(members.map(m => [m.id, m.name]));
  const unread = msgs.filter(m => !m.coach_read_at);
  if (msgs.length) {
    lines.push('', `Messages from members (${unread.length} unread of ${msgs.length} recent):`);
    for (const m of msgs) {
      lines.push(`  ${nameOf.get(m.patient_id) || 'Member'}` +
        `${m.coach_read_at ? '' : ' [UNREAD]'}: "${String(m.note).slice(0, 200)}"`);
    }
  } else {
    lines.push('', 'Messages from members: none.');
  }

  return lines.join('\n');
}

/**
 * The whole day as STRUCTURED data, not prose.
 *
 * The first version asked the model to format a summary from the snapshot. It
 * came back as one run-on paragraph — "…1350 kcal left of 1350 Ate — nothing
 * logged Water — 750 ml…" — because a language model's line breaks are a
 * suggestion, not a contract, and the client rendered them in a <p> where
 * whitespace collapses anyway.
 *
 * Every number here was already computed in SQL. Handing them to a model to
 * retype was pure formatting risk for no gain, so the summary now skips the
 * model entirely and the client renders real fields. Specific questions still
 * go through the model, because phrasing genuinely helps there.
 */
/**
 * Resolve one protocol group into human labels: what is done, what is left.
 *
 * Shared by the summary card and the prose-question snapshot. It lived inside
 * the summary first, and the snapshot kept its own copy that read `.label` off
 * a string — so the card was fixed while "what's left for Padmini" still
 * answered "steps1, steps3". One implementation, both callers.
 *
 * Two things it has to get right:
 *
 * 1. LABELS. protocol_* stores bare catalog IDS ('walk', 'acv1', 'b12').
 *    Labels live in CATALOG for standard items and in custom_* for coach-added
 *    ones ({ id: 'cx_1787…', label: 'Creatine' }), with item_overrides able to
 *    rename either. Without this the screen showed "cx_17878202035850".
 *
 * 2. NULL MEANS ALL. protocol_* = null is "everything assigned", not "nothing"
 *    — see mergeGroup, which materialises the full list before removing.
 *    Treating null as empty made a member on the default protocol look like
 *    they had nothing to do.
 *
 * Mirrors the client's own resolution in DailyLog, so the coach's view and the
 * member's screen name the same item the same way.
 */
function resolveProtocolGroup(group, profile, ticksObj) {
  const overrides  = profile.item_overrides || {};
  const customList = Array.isArray(profile[`custom_${group}`]) ? profile[`custom_${group}`] : [];
  const protoList  = profile[`protocol_${group}`];

  const all = [...CATALOG[group], ...customList].map((item) => {
    const ov = overrides[item.id];
    return { id: item.id, label: (ov && ov.label) || item.label || item.id };
  });

  const active = Array.isArray(protoList)
    ? all.filter(i => protoList.includes(i.id))
    : all;                       // null / undefined => all assigned

  const on = Object.entries(ticksObj || {}).filter(([, v]) => v).map(([k]) => k);
  const byId = new Map(all.map(i => [i.id, i.label]));

  return {
    // Ticks only count for items still assigned — one the coach removed after
    // the member ticked it should not inflate "3/2 done".
    done:  on.filter(k => active.some(i => i.id === k)).map(k => byId.get(k) || k),
    left:  active.filter(i => !on.includes(i.id)).map(i => i.label),
    total: active.length,
    assigned: active.length > 0,
  };
}

async function buildCoachSummary(member) {
  const today = getISTDate();
  const [{ rows: logs }, { rows: prof }] = await Promise.all([
    pool.query(
      `SELECT weight_kg, water_ml, sleep, activities, acv, supplements, food_items
         FROM daily_logs WHERE patient_id = $1 AND log_date = $2::date`, [member.id, today]),
    pool.query(
      `SELECT macro_kcal, macro_pro, macro_carb, macro_fat, water_target,
              protocol_activities, protocol_acv, protocol_supplements,
              custom_activities, custom_acv, custom_supplements, item_overrides
         FROM patient_profiles WHERE user_id = $1`, [member.id]),
  ]);

  const t = logs[0] || null;
  const p = prof[0] || {};
  const totals = computeDayTotals(t?.food_items);

  const kcalLeft  = p.macro_kcal ? p.macro_kcal - totals.cal : null;
  const waterLeft = p.water_target ? Math.max(0, p.water_target - (t?.water_ml || 0)) : null;

  return {
    member: member.name,
    date: today,
    logged_anything: !!t,
    food: {
      kcal: totals.cal, protein: totals.pro, carbs: totals.carb, fat: totals.fat,
      target: p.macro_kcal || null,
      remaining: kcalLeft,
      over: kcalLeft !== null && kcalLeft < 0,
      items: (t?.food_items || []).map(f => ({ name: f.name, grams: f.grams })),
    },
    water: { drunk: t?.water_ml || 0, target: p.water_target || null, remaining: waterLeft },
    activities:  resolveProtocolGroup('activities',  p, t?.activities),
    acv:         resolveProtocolGroup('acv',         p, t?.acv),
    supplements: resolveProtocolGroup('supplements', p, t?.supplements),
    weight: t?.weight_kg ? parseFloat(t.weight_kg) : null,
    sleep: (t?.sleep?.bedtime && t?.sleep?.waketime)
      ? `${t.sleep.bedtime}–${t.sleep.waketime}` : null,
  };
}

function buildCoachAnswerPrompt(question, context, memberName) {
  return `You are the assistant for a fitness COACH in India. The coach asked:
"${question}"

Answer USING ONLY the data below. It is real, computed from logs. Never invent
or estimate a number that is not there. If the data needed is missing, say so
plainly and say what the member would need to log.

DATA${memberName ? ` (${memberName})` : ''}:
${context}

RULES:
- Numbers exactly as given above. Never calculate anything yourself — every
  remaining/pending figure the coach could want is already computed for you.
- No markdown, no emojis, no ** bold **.
- You are talking to the coach about their member, so be direct and clinical
  about the numbers. No medical diagnosis.

LENGTH — match the question:
- A SPECIFIC question ("how many calories", "how much water left", "what
  activities are pending") gets 1-3 short sentences leading with that figure.
- A SUMMARY / RUNDOWN / "everything" / "how is she doing today" / "full update"
  question gets the whole day, as short labelled lines in this order, skipping
  any line with no data:

    Food — <kcal> kcal eaten (P/C/F), <X> left of <target>
    Ate — <items>
    Water — <drunk> of <target>, <remaining> to go
    Activities — done: <list> · left: <list>
    ACV — done: <list> · left: <list>
    Supplements — taken: <list> · left: <list>
    Weight — <kg>
    Sleep — <times>

  One line each, no preamble, no closing summary sentence. If something is
  fully done say "all done"; if nothing is logged for it say "nothing logged".

Return ONLY the answer text, nothing else.`;
}

async function coachMembers(user) {
  if (user.role === 'admin') {
    const { rows } = await pool.query(
      `SELECT id, name FROM users WHERE role='patient' AND active=true ORDER BY name`
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT u.id, u.name FROM users u
     JOIN monitor_patients mp ON mp.patient_id = u.id AND mp.active = true
     WHERE mp.monitor_id = $1 AND u.role='patient' AND u.active=true
     ORDER BY u.name`,
    [user.id]
  );
  return rows;
}

async function coachCanAccess(user, memberId) {
  if (user.role === 'admin') return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM monitor_patients WHERE monitor_id=$1 AND patient_id=$2 AND active=true`,
    [user.id, memberId]
  );
  return rows.length > 0;
}

function coachAudit(actor, action, targetId, targetName, detail) {
  return pool.query(
    `INSERT INTO audit_log (actor_id, actor_name, actor_role, action, target_id, target_name, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [actor?.id || null, actor?.name || 'System', actor?.role || 'monitor',
     action, targetId || null, targetName || null, detail || null]
  ).catch(e => console.error('coach audit write failed:', e.message));
}

// ── Coach prompt ─────────────────────────────────────────────────────────────
function buildCoachPrompt(message, members, memberStats = [], contextMember = null, recent = []) {
  const { statsLine } = require('../services/milestones');
  const statsById = new Map(memberStats.map(s => [s.id, statsLine(s)]));
  const cat = (list) => list.map(i => `"${i.id}" (${i.label})`).join(', ');
  return `You are the AI assistant for a fitness COACH managing members in an Indian
fitness coaching app. The coach typed an instruction in casual language (English,
Hinglish, or Kannada-English mix). Parse it into structured commands.

Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' })} (IST).
If the coach schedules a workout day for "today"/"aaj", use today's weekday.

Coach's message: "${message}"
${recent.length ? `
THE CONVERSATION SO FAR (oldest first). The coach is often mid-thought: they say
"set water target 4L for" and you ask who, and their next message is just a name.
Read the WHOLE exchange and carry forward anything they already said — the value,
the field, the member — instead of treating the latest line on its own. If your
own previous turn asked a question, the coach's next message is the answer to it.
${recent.map(r => `${r.role === 'coach' ? 'Coach' : 'You'}: ${r.text}`).join('\n')}
` : ''}
${contextMember ? `
THE COACH IS CURRENTLY LOOKING AT "${contextMember.name}"'s page.
If the message names no member at all ("raise water to 4 litres", "add whey to
lunch"), it is about ${contextMember.name}. If it DOES name someone — including
"everyone"/"all" — honour that name and ignore this context line.
` : ''}
MEMBERS (match names loosely — partial/first names are fine).
Progress facts are REAL, computed from their logs — quote them, never invent:
${members.map(m => `  - "${m.name}"${statsById.has(m.id) ? ` — ${statsById.get(m.id)}` : ''}`).join('\n')}

PROTOCOL ITEM CATALOG (the ONLY valid ids):
Activities: ${cat(CATALOG.activities)}
ACV: ${cat(CATALOG.acv)}
Supplements: ${cat(CATALOG.supplements)}

SUPPORTED OPERATIONS per command:
- water_target: ml (e.g. "4 litres water"→4000). Range 500–8000.
- macros: any of { kcal, pro, carb, fat } as daily targets in kcal / grams.
- target_weight: goal weight in kg (30–250). Only if explicitly a GOAL/target.
- activities / acv / supplements: {
    "add": [catalog ids to assign],
    "remove": [catalog ids to unassign],
    "add_custom": [{ "label": "Evening Walk", "sub": "20 min after dinner" }]
      ← use add_custom when the coach wants something NOT in the catalog.
    "remove_custom": ["label of custom item to remove"]
  }
- note: { "text": "...", "flagged": true|false } — a message shown on the
  member's Today page. flagged=true when urgent/action-needed tone.
  Write the note text as the coach speaking to the member, polished but
  keeping the coach's intent. If coach gives exact words, use them.
- push: { "title": "...", "body": "..." } — instant phone notification.
  Only when the coach says notify/push/alert immediately.
- morning_nudge: true — sends TODAY'S morning message: yesterday's real
  numbers plus today's program day. Use for "send morning msg to Asha",
  "send the morning nudge", "remind her to weigh in". Do NOT write the text
  yourself — the server composes it from the member's actual log, exactly as
  the 06:30 job does. Set morning_nudge, leave push null.
  If the coach dictates their own wording instead, that is a push, not this.
- CELEBRATION / ENCOURAGEMENT: when the coach asks to congratulate, celebrate,
  encourage, motivate or "write a message" to a member, put the message in
  note.text (and set push so it reaches their phone). Write it yourself:
  · Use ONLY numbers from that member's line above. If a number is not there,
    do not state it — no invented starting weights, durations or percentages.
  · 2–4 short sentences. Warm, specific, in the coach's voice. Name the real
    figures and the habits behind them (consistent logging, walks, fasting).
  · If a MILESTONE is listed for them, lead with it.
  · No medical claims, no diagnosis, at most one or two emojis.
  · Address them by first name.
- meal_plan: prescribes SPECIFIC FOODS for a member's meal(s) TODAY. Shape:
  { "meals": [
      { "meal": "Dinner",
        "items": [
          { "name": "Avocado", "qty_text": "100 g", "grams": 100,
            "per_100g": { "calories": 160, "protein": 2, "total_carbs": 9, "fat": 15 } }
        ] }
  ] }
  · Use it when the coach dictates what to EAT: "Sachin dinner: avocado 100g,
    1 spoon ghee, 150g paneer, 4 eggs, 100g chicken".
  · Convert household measures to grams (1 spoon ghee/oil ≈ 13 g, 1 katori
    ≈ 150 g, 1 medium egg ≈ 50 g → "4 medium egg" = grams 200).
  · per_100g: your best nutrition estimate for EVERY item — calories, protein,
    total_carbs, fat (numbers, per 100 g). The member logs against these.
  · meal: use the coach's word (Breakfast/Lunch/Dinner/Snack …), capitalised.
  · "mode": "replace" (default — a full meal prescription) or "append" — use
    append when the coach is ADDING to an existing plan: "add whey protein to
    the lunch", "lunch mein X bhi daal do", "also give him a banana at dinner".
    Whey protein, peanut butter etc. named as part of a MEAL are meal_plan
    items (with grams: 1 scoop whey ≈ 30 g), NOT protocol supplements —
    supplements are standing daily pills/powders, not food for a specific meal.
  · Replace mode overwrites that meal's plan — say so in reply.
- program: assigns a WORKOUT PROGRAM / training split. Shape:
  { "name": "Push Pull Legs",
    "days": [
      { "label": "Push", "weekday": "monday",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": 4, "reps_min": 8, "reps_max": 12, "muscle_group": "chest" }
        ] }
    ] }
  · Use it when the coach assigns circuits/splits: "push circuit Monday, pull
    Wednesday, legs Friday", "upper/lower 4 days", "chest+tri and back+bi days".
  · If the coach lists exercises with sets×reps ("bench 4x8-12"), use exactly
    those. If they only name the split, BUILD each day with 5–6 standard,
    widely-known gym exercises appropriate to that day (compound first),
    sets 3–4, reps 8–12 (legs/compounds may be 6–10).
  · weekday: lowercase english day if the coach gave one, else null.
  · muscle_group: one of chest, back, legs, shoulders, arms, core, full_body.
  · Assigning a program REPLACES the member's current one — mention that in reply.

RULES:
1. member_name must be copied EXACTLY from the members list. If the coach says
   "all members" / "everyone", use member_name "ALL" — allowed ONLY for note
   and push operations.
2. One command object per member mentioned. Multiple changes for the same
   member go in ONE command.
3. If a mentioned name matches nobody in the list, still emit the command with
   member_name exactly as the coach wrote it — the server will flag it.
4. Only include operations the coach actually asked for. Never invent.
5. reply: ONE short sentence summarising the commands. No emojis.

6. QUESTIONS. If the coach is ASKING about a member rather than instructing a
   change — "how many calories has Padmini eaten today", "what has she logged",
   "who hasn't logged today", "is Bujju hitting his protein", "how much weight
   has Asha lost" — do NOT try to turn it into a command and do NOT ask what
   they want to update. Set "question" and return EMPTY commands:

     "question": { "member_name": "Padmini", "text": "how many calories today",
                   "scope": "specific" }

   · scope: "summary" when the coach wants the WHOLE day — "today's summary",
     "full update", "how is she doing today", "everything for Padmini",
     "rundown". Otherwise "specific".
     A summary is rendered by the app from the member's real figures; you are
     not asked to write it, so do not try.

   · member_name: the member being asked about, or null for a roster-wide
     question ("who hasn't logged today", "who is behind this week").
   · text: the coach's question, lightly cleaned up. Keep their intent.
   · The server answers it from that member's REAL logged data. You are not
     answering it here, so never guess a number in "reply".
   · A message can be a question OR commands, not both. If it clearly does both
     ("how much has she lost, and set her water to 4L"), take the COMMANDS and
     mention the question in reply — the coach can ask it again.

7. If nothing actionable and it is not a question, return empty commands and a
   reply asking what they'd like to change.

Return ONLY a raw JSON object, no markdown fences:
{
  "reply": "Setting Bujju's water target to 4L and adding an evening walk.",
  "question": null,
  "commands": [
    {
      "member_name": "Bujju",
      "water_target": 4000,
      "macros": { "kcal": 1600, "pro": 100 },
      "target_weight": null,
      "activities": { "add": [], "remove": [], "add_custom": [{ "label": "Evening Walk", "sub": "20 min after dinner" }], "remove_custom": [] },
      "acv": null,
      "supplements": null,
      "note": { "text": "Please log your meals daily — I review them every morning.", "flagged": false },
      "push": null,
      "morning_nudge": null,
      "program": null,
      "meal_plan": null
    }
  ]
}`;
}

// ── Program normaliser — clamps everything the model can get wrong ───────────
const WEEKDAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const MUSCLE_GROUPS = ['chest','back','legs','shoulders','arms','core','full_body'];

function normaliseProgram(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.days) || !raw.days.length) return null;
  const clampInt = (v, lo, hi, dflt) => {
    const n = parseInt(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
  };
  const days = raw.days.slice(0, 7).map(d => {
    if (!d || typeof d !== 'object') return null;
    const exercises = (Array.isArray(d.exercises) ? d.exercises : []).slice(0, 10).map(e => {
      const name = e && e.name ? String(e.name).trim().slice(0, 100) : '';
      if (!name) return null;
      const reps_min = clampInt(e.reps_min, 1, 50, 8);
      let reps_max = clampInt(e.reps_max, 1, 50, null);
      if (reps_max != null && reps_max < reps_min) reps_max = null;
      const mgRaw = String(e.muscle_group || '').toLowerCase();
      return {
        name,
        sets: clampInt(e.sets, 1, 10, 3),
        reps_min, reps_max,
        muscle_group: MUSCLE_GROUPS.includes(mgRaw) ? mgRaw : null,
      };
    }).filter(Boolean);
    if (!exercises.length) return null;
    let label = d.label ? String(d.label).trim().slice(0, 30) : 'Day';
    const wdRaw = String(d.weekday || '').toLowerCase();
    if (WEEKDAYS.includes(wdRaw)) {
      // Weekday lives in the label ("Push · Mon") — the schema has no schedule
      // column and the schema is the stability boundary. The member's workout
      // screen highlights the day whose label carries today's weekday.
      label = `${label} · ${wdRaw[0].toUpperCase()}${wdRaw.slice(1, 3)}`;
    }
    return { label: label.slice(0, 50), exercises };
  }).filter(Boolean);
  if (!days.length) return null;
  return { name: raw.name ? String(raw.name).trim().slice(0, 100) : 'Training Program', days };
}

// ── Meal plan normaliser ──────────────────────────────────────────────────────
function normaliseMealPlan(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.meals) || !raw.meals.length) return null;
  const num = (v, lo, hi) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
  };
  // How many days forward this plan holds. Coach chat prescribes for today
  // (1); an uploaded diet plan is a standing structure the member follows every
  // day, so it lands on a stretch of dates. Defaults to 1, so every existing
  // caller behaves exactly as before.
  const repeat_days = Math.min(30, Math.max(1, parseInt(raw.repeat_days) || 1));

  const meals = raw.meals.slice(0, 6).map(m => {
    if (!m || typeof m !== 'object') return null;
    const meal = m.meal ? String(m.meal).trim().slice(0, 40) : '';
    const items = (Array.isArray(m.items) ? m.items : []).slice(0, 15).map(it => {
      const name = it && it.name ? String(it.name).trim().slice(0, 100) : '';
      const grams = num(it?.grams, 1, 2000);
      if (!name || grams === null) return null;
      // ── Full nutrition, not just the four macros ──────────────────────────
      // This used to keep calories, protein, carbs and fat and DROP the other
      // 37 fields. The food table has them and enrichFromDB returns them, so a
      // member who logged palak by typing it got iron and vitamin K, and a
      // member who logged the SAME palak from their coach's plan got zeroes.
      //
      // That is the wrong way round: the prescribed path is the one a member
      // following a plan uses every day, so their micronutrient page was
      // under-reporting precisely for the people doing what they were told.
      //
      // The clamps stay on the four macros — they guard against a model
      // returning nonsense per-100g values — and everything else passes
      // through the shared normaliser.
      const n = it.per_100g || {};
      const per_100g = {
        ...normaliseNutrients(n),
        calories:    num(n.calories, 0, 900)  ?? 0,
        protein:     num(n.protein, 0, 100)   ?? 0,
        total_carbs: num(n.total_carbs, 0, 100) ?? 0,
        fat:         num(n.fat, 0, 100)       ?? 0,
      };
      // Recomputed after clamping, or a clamped carb figure leaves net_carbs
      // describing the unclamped one.
      per_100g.net_carbs = Math.max(0, +(per_100g.total_carbs - per_100g.fiber).toFixed(1));
      return { name, grams,
               qty_text: it.qty_text ? String(it.qty_text).slice(0, 40) : `${grams} g`,
               per_100g };
    }).filter(Boolean);
    const mode = String(m.mode || '').toLowerCase() === 'append' ? 'append' : 'replace';
    return meal && items.length ? { meal, items, mode } : null;
  }).filter(Boolean);
  return meals.length ? { meals, repeat_days } : null;
}

// ── Command validator/normaliser ─────────────────────────────────────────────
function normaliseGroupOp(raw, catalogList) {
  if (!raw || typeof raw !== 'object') return null;
  const valid = new Set(catalogList.map(i => i.id));
  const ids = (arr) => (Array.isArray(arr) ? [...new Set(arr.map(String))].filter(id => valid.has(id)) : []);
  const op = {
    add:           ids(raw.add),
    remove:        ids(raw.remove),
    add_custom:    (Array.isArray(raw.add_custom) ? raw.add_custom : [])
      .filter(c => c && c.label)
      .slice(0, 10)
      .map(c => ({ label: String(c.label).slice(0, 60), sub: c.sub ? String(c.sub).slice(0, 100) : '' })),
    remove_custom: (Array.isArray(raw.remove_custom) ? raw.remove_custom : [])
      .map(l => String(l).slice(0, 60)).slice(0, 10),
  };
  if (!op.add.length && !op.remove.length && !op.add_custom.length && !op.remove_custom.length) return null;
  return op;
}

function labelFor(group, id) {
  const it = CATALOG[group].find(i => i.id === id);
  return it ? it.label : id;
}

// Human-readable change list for the preview UI
function describeOps(cmd) {
  const out = [];
  if (cmd.water_target != null) out.push({ icon: '💧', text: `Water target → ${(cmd.water_target / 1000).toFixed(cmd.water_target % 1000 ? 1 : 0)}L / day` });
  if (cmd.macros) {
    const parts = [];
    if (cmd.macros.kcal != null) parts.push(`${cmd.macros.kcal} kcal`);
    if (cmd.macros.pro  != null) parts.push(`P ${cmd.macros.pro}g`);
    if (cmd.macros.carb != null) parts.push(`C ${cmd.macros.carb}g`);
    if (cmd.macros.fat  != null) parts.push(`F ${cmd.macros.fat}g`);
    out.push({ icon: '🎯', text: `Macro targets → ${parts.join(' · ')}` });
  }
  if (cmd.target_weight != null) out.push({ icon: '⚖️', text: `Goal weight → ${cmd.target_weight} kg` });
  for (const [group, icon, word] of [['activities', '🏃', 'activity'], ['acv', '🧃', 'ACV'], ['supplements', '💊', 'supplement']]) {
    const op = cmd[group];
    if (!op) continue;
    op.add.forEach(id => out.push({ icon, text: `Assign ${word}: ${labelFor(group, id)}` }));
    op.remove.forEach(id => out.push({ icon, text: `Remove ${word}: ${labelFor(group, id)}` }));
    op.add_custom.forEach(c => out.push({ icon, text: `New custom ${word}: ${c.label}${c.sub ? ` (${c.sub})` : ''}` }));
    op.remove_custom.forEach(l => out.push({ icon, text: `Remove custom ${word}: ${l}` }));
  }
  if (cmd.meal_plan) {
    for (const m of cmd.meal_plan.meals) {
      const kcal = Math.round(m.items.reduce((a, it) => a + (it.per_100g.calories * it.grams / 100), 0));
      const names = m.items.slice(0, 4).map(it => `${it.name} ${it.grams}g`).join(', ');
      // Say how long it holds. "Lunch plan" that silently covers a fortnight is
      // a different commitment from one that covers today, and the coach is
      // about to approve it.
      const span = (cmd.meal_plan.repeat_days || 1) > 1
        ? ` · next ${cmd.meal_plan.repeat_days} days` : '';
      out.push({ icon: '🍽️', text: `${m.mode === 'append' ? `Add to ${m.meal} plan` : `${m.meal} plan`}${span} (~${kcal} kcal): ${names}${m.items.length > 4 ? ` +${m.items.length - 4} more` : ''}` });
    }
  }
  if (cmd.program) {
    const daysTxt = cmd.program.days.map(d => `${d.label} (${d.exercises.length})`).join(', ');
    out.push({ icon: '🏋️', text: `Assign program "${cmd.program.name}" — replaces current: ${daysTxt}` });
  }
  if (cmd.note) out.push({ icon: '💬', text: `${cmd.note.flagged ? 'Flagged message' : 'Message'}: "${cmd.note.text}"` });
  if (cmd.push) out.push({ icon: '🔔', text: `Push notification: ${cmd.push.title} — ${cmd.push.body}` });
  // The text is deliberately NOT shown here: it is composed at send time from
  // the member's log, so anything previewed now could be stale by the time the
  // coach taps apply.
  if (cmd.morning_nudge) out.push({ icon: '🔔', text: `Send today's morning message (yesterday's numbers + today's program day)` });
  return out;
}

// ── POST /api/ai-chat/portions ───────────────────────────────────────────────
// Records what a member's own "1 katori" or "1 glass" actually weighs, from
// the corrections they make in the chat preview.
// Body: { corrections: [{ phrase: "katori dal", grams: 200 }] }
router.post('/portions', async (req, res) => {
  const { corrections } = req.body || {};
  if (!Array.isArray(corrections) || !corrections.length) {
    return res.status(400).json({ error: 'corrections array required' });
  }
  await recordPortions(req.user.id, corrections.slice(0, 25));
  const portions = await loadPortions(req.user.id);
  res.json({ learned: portions.length, portions });
});

// ── POST /api/ai-chat/eval-sample ────────────────────────────────────────────
// Client-side corrections that the server cannot see for itself:
//   · the member edited the grams in the preview before applying
//   · the member unticked an item the AI invented
//   · the coach turned off a proposed action before applying
// Body: { source, message, ai_output, corrected, field }
// Always 200 — a rejected sample is a no-op, never an error the member sees.
router.post('/eval-sample', async (req, res) => {
  const { source, message, ai_output, corrected, field } = req.body || {};
  const result = await recordEvalSample({
    patientId: req.user.id,
    source,
    message,
    aiOutput:  ai_output,
    corrected,
    field,
  });
  res.json({ result });
});

// ── GET /api/ai-chat/portions ────────────────────────────────────────────────
// What the app has learned about this member's portions, so it can be shown
// back to them — learning they cannot see feels like the app guessing.
router.get('/portions', async (req, res) => {
  res.json({ portions: await loadPortions(req.user.id) });
});

// ── POST /api/ai-chat/coach-parse ────────────────────────────────────────────
// Body: { message }
// Returns: { reply, actions: [{ member_id|null, member_name, resolved, is_all,
//            ops (validated command), changes: [{icon,text}] }] }
/**
 * Ask Gemini about a FILE — a PDF or a photo — and get JSON back.
 *
 * `callAI(prompt)` takes a STRING. Handing it a parts array builds a malformed
 * request that fails at the API, surfaces as a 502, and tells you nothing about
 * why: it is the mistake this function exists to stop anyone making twice.
 *
 * responseMimeType asks the API itself to guarantee JSON, which is far more
 * reliable than asking the prompt nicely and stripping code fences afterwards.
 *
 * @returns {Promise<{ parsed: object, model: string }>}
 */
async function callGeminiOnFile({ prompt, mimeType, data, maxOutputTokens = 16000, timeout = 50000 }) {
  if (!GEMINI_API_KEY) {
    const err = new Error('Reading documents needs GEMINI_API_KEY to be set');
    err.response = { status: 500 };
    throw err;
  }
  const models = [...new Set([
    process.env.GEMINI_DOC_MODEL || 'gemini-2.5-flash',
    ...GEMINI_MODELS,
  ])].filter(Boolean);

  let lastErr;
  for (const model of models) {
    try {
      const response = await axios.post(
        `${geminiUrlFor(model)}?key=${GEMINI_API_KEY}`,
        {
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data } },
          ] }],
          generationConfig: { temperature: 0, maxOutputTokens, responseMimeType: 'application/json' },
        },
        { timeout },
      );
      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty response from the model');
      return {
        parsed: JSON.parse(String(text).replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()),
        model,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('No model could read the file');
}

/**
 * Targets read out of a diet plan, in the op shape /coach-apply expects.
 *
 * The op keys are kcal/pro/carb/fat — the same names that reach macro_pro and
 * macro_carb in patient_profiles. A document naturally says "protein" and
 * "carbohydrates", so the model returns those words; mapping them wrong parses
 * the plan perfectly and then drops two of the four targets on the floor, with
 * no error raised anywhere. Both spellings are accepted, and this is a plain
 * function so the mapping can be asserted without a model call.
 */
function dietPlanMacros(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mk = (v, max) => { const n = parseInt(v); return Number.isFinite(n) && n > 0 && n <= max ? n : null; };
  const macros = {
    kcal: mk(raw.kcal ?? raw.calories, 6000),
    pro:  mk(raw.pro ?? raw.protein, 500),
    carb: mk(raw.carb ?? raw.carbs ?? raw.carbohydrates, 800),
    fat:  mk(raw.fat, 400),
  };
  return (macros.kcal == null && macros.pro == null
       && macros.carb == null && macros.fat == null) ? null : macros;
}

// ── POST /api/ai-chat/coach-doc ──────────────────────────────────────────────
// A coach uploads a diet plan — a PDF from a dietitian, a photo of a printed
// sheet — and it becomes a prescribed plan for one member.
//
// Deliberately returns the SAME { reply, actions } shape as /coach-parse, so
// the existing preview, the per-action toggles and /coach-apply all work
// untouched. A second apply path for documents would be a second place for the
// "did this actually save" bug to live.
//
// The coach still approves every line. Nothing a model reads out of a PDF is
// written to a member's plan without a human looking at it first — the sample
// plan we built this against carries diabetic-range HbA1c and a note to consult
// a doctor, which is exactly the kind of document that must not auto-apply.
router.post('/coach-doc', roleCheck('monitor', 'admin'), async (req, res) => {
  const { file, mimeType, fileName, member_name } = req.body || {};

  if (!file || typeof file !== 'string') {
    return res.status(400).json({ error: 'Attach a diet plan file' });
  }
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
  const mt = allowed.includes(mimeType) ? mimeType : 'application/pdf';
  if (file.length > 10_000_000) {
    return res.status(413).json({ error: 'File too large — try a single-page export or a photo' });
  }
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Reading documents needs GEMINI_API_KEY to be set' });
  }

  try {
    const members = await coachMembers(req.user);
    if (!members.length) return res.json({ reply: 'No members assigned to you yet.', actions: [] });

    const prompt = `You are reading a DIET PLAN document a fitness coach uploaded
for one of their members. Extract it into JSON. Reply with JSON only.

The member this plan is for:${member_name ? ` the coach says it is for "${member_name}".` : ''}
Names on your roster: ${members.map(m => m.name).join(', ')}.
If the document names a person, match it to the closest roster name. If you
cannot tell who it is for, set member_name to null.

{
  "member_name": "<roster name, or null>",
  "plan_title": "<short title, e.g. 'Low-carb plan'>",
  "macros": { "kcal": <int|null>, "protein": <int|null>,
              "carbs": <int|null>, "fat": <int|null> },
  "meals": [
    { "meal": "Breakfast|Lunch|Snack|Dinner|<as printed>",
      "items": [ { "name": "<food>", "grams": <int>,
                   "qty_text": "<as printed, e.g. '1 scoop'>" } ] }
  ],
  "repeat_days": <int 1-30>,
  "summary": "<one sentence for the coach>"
}

RULES
· A RANGE of calories or protein ("1,400-1,500 kcal", "120-140 g") takes the
  LOWER bound. A target the member overshoots is a target they met; one they
  undershoot is a conversation. Never average the two.
· grams must be a number. Convert household measures using ordinary Indian
  portions: 1 scoop whey ~30g, 1 small roti ~40g, 2 tbsp cooked rice ~40g,
  1 egg ~50g, half an avocado ~75g. If a quantity is genuinely absent, omit
  that item rather than inventing a weight.
· Put the printed wording in qty_text so the coach can check your conversion.
· A plan that says it is the same every day sets repeat_days to 14. A plan for
  a single day sets 1. Never exceed 30.
· Include ONLY foods with a stated quantity in a named meal. Foods-to-avoid
  lists, weekly rotations, and general advice are NOT items.
· If the document is not a diet plan at all, return meals: [] and say so in
  summary.`;

    const { parsed, model } = await callGeminiOnFile({ prompt, mimeType: mt, data: file });
    const provider = `gemini/${model}`;

    const nameRaw = String(parsed.member_name || member_name || '').trim();
    const lc = nameRaw.toLowerCase();
    const member = lc
      ? (members.find(m => m.name.toLowerCase() === lc) ||
         members.find(m => m.name.toLowerCase().includes(lc) || lc.includes(m.name.toLowerCase())) || null)
      : null;

    const meal_plan = normaliseMealPlan({
      meals: (Array.isArray(parsed.meals) ? parsed.meals : [])
        .map(m => ({ ...m, mode: 'replace' })),
      repeat_days: parsed.repeat_days,
    });

    // Real nutrition from the food database, the same enrichment the member
    // chat runs. Without it the plan card shows a calorie figure the model
    // invented for a food we already have measured values for.
    if (meal_plan) {
      for (const m of meal_plan.meals) {
        const enriched = await enrichFromDB(m.items).catch(() => null);
        if (enriched) {
          m.items = m.items.map((it, i) => (
            enriched[i]?.per_100g ? { ...it, per_100g: enriched[i].per_100g } : it
          ));
        }
      }
    }

    const macros = dietPlanMacros(parsed.macros);

    const ops = {
      water_target: null, macros, target_weight: null, program: null,
      meal_plan, activities: null, acv: null, supplements: null,
      note: parsed.plan_title
        ? { text: `Diet plan attached: ${String(parsed.plan_title).slice(0, 120)}${fileName ? ` (${String(fileName).slice(0, 80)})` : ''}`, flagged: false }
        : null,
      push: null,
    };

    const changes = describeOps(ops);
    if (!changes.length) {
      return res.json({
        reply: String(parsed.summary || '').slice(0, 400) ||
          "I couldn't find a meal plan with quantities in that file.",
        actions: [], aiProvider: provider,
      });
    }

    return res.json({
      reply: String(parsed.summary || '').slice(0, 400) ||
        `Read the plan${member ? ` for ${member.name}` : ''}. Review each line before applying.`,
      actions: [{
        member_id:   member ? member.id : null,
        member_name: member ? member.name : (nameRaw || 'Unknown member'),
        resolved:    !!member,
        is_all:      false,
        ops, changes,
      }],
      aiProvider: provider,
    });
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message;
    console.error('coach-doc error | status:', err.response?.status, '| detail:', detail);
    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: "I couldn't read that file as a diet plan — try a clearer export." });
    }
    return res.status(502).json({ error: 'Could not read that document just now' });
  }
});

/**
 * A coach asking about a FOOD, not about a member.
 *
 * "chk masala dosa calories with macros" was answered as though it were a
 * question about the member whose page the coach happened to be on: "the member
 * would need to log the Masala Dosa". The coach was not asking what Vishwas
 * ate. They were asking what the app thinks a masala dosa IS — and the coach is
 * exactly the person who fixes that when it is wrong.
 *
 * The food table was simply not in scope for questions. This puts it there,
 * answered from the database rather than by the model, with the same
 * plausibility verdicts the review queue uses — so the answer to "check this
 * food" includes whether it looks wrong.
 *
 * @returns {Promise<string|null>} an answer, or null if this is not a food question
 */
async function answerFoodQuestion(qText) {
  const t = String(qText || '').toLowerCase();
  // Only when the question is about the food itself. "How many calories has
  // Padmini eaten" is a member question that also mentions calories.
  // Leading boundary only. A trailing \b requires a non-word character after
  // the stem, so "calories", "macros" and "carbs" — the words a coach actually
  // types — all failed to match, and every food question fell through to being
  // answered as a question about a member.
  if (!/\b(calorie|kcal|macro|micro|nutrition|nutrient|protein|carb|fat|per\s*100)/.test(t)) return null;
  if (/\b(eaten|ate|logged|log|today|yesterday|week|consumed|left|remaining)\b/.test(t)) return null;

  // The food name is what remains once the question words are stripped.
  const name = t
    .replace(/\b(chk|check|what|whats|what's|is|are|the|of|for|with|and|show|me|tell|per\s*100g?|calorie[s]?|kcal|macro[s]?|micro[s]?|nutrition|nutrient[s]?|protein|carb[s]?|fat|in|a|an|please)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (name.length < 3) return null;

  const { rows } = await pool.query(
    `SELECT name, source, verified, per_100g
       FROM foods
      WHERE lower(name) = $1 OR lower(name) LIKE $2
      ORDER BY verified DESC, (lower(name) = $1) DESC, length(name)
      LIMIT 3`,
    [name, `%${name}%`]
  );
  if (!rows.length) return `I have no food called "${name}" in the database yet.`;

  const f = rows[0];
  const n = f.per_100g || {};
  const r = (v) => Math.round((+v || 0) * 10) / 10;
  const lines = [
    `${f.name} — per 100g: ${r(n.calories)} kcal, ${r(n.protein)}g protein, ` +
    `${r(n.total_carbs)}g carbs, ${r(n.fat)}g fat, ${r(n.fiber)}g fibre.`,
    `Iron ${r(n.iron)}mg · calcium ${r(n.calcium)}mg · vitamin C ${r(n.vit_c)}mg.`,
    f.verified ? 'Verified.' : `From ${f.source === 'ai' ? 'an AI estimate' : f.source}, not yet verified.`,
  ];

  const macro = macroPlausibility(n, f.name);
  const cook  = cookingFatPlausibility(n, f.name);
  if (macro.status === 'suspect')      lines.push(`⚠ ${macro.reason}.`);
  else if (cook.status === 'suspect')  lines.push(`⚠ ${cook.reason}.`);

  // The plain version of the same dish, when there is one — the comparison that
  // makes a wrong number obvious.
  const base = String(f.name).toLowerCase().split(/\s+/).filter(w => w.length > 3).pop();
  if (base) {
    const { rows: b } = await pool.query(
      `SELECT name, per_100g FROM foods
        WHERE verified = true AND lower(name) LIKE $1 AND lower(name) <> $2
        ORDER BY length(name) LIMIT 1`,
      [`${base}%`, String(f.name).toLowerCase()]);
    if (b.length && +b[0].per_100g?.calories > 0) {
      lines.push(`For comparison, ${b[0].name} is ${Math.round(+b[0].per_100g.calories)} kcal per 100g.`);
    }
  }
  if (rows.length > 1) lines.push(`Also matched: ${rows.slice(1).map(x => x.name).join(', ')}.`);
  if (!f.verified) lines.push('Fix it in Admin → Foods; you can push the correction to logs already saved.');

  return lines.join(' ');
}

/**
 * A coach asking to EDIT a food, not to note something about a member.
 *
 * "need to edit calorie, macros of masala dosa" was classified by the model as
 * a note and filed against the member whose page the coach was on. Nothing was
 * edited and a meaningless note was attached to Vishwas Gundurao.
 *
 * Intent this explicit should not be a model's judgement call. It is matched
 * before the model is asked anything, so "edit X" always means edit X.
 *
 * @returns {Promise<object|null>} a food_edit payload, or null
 */
async function detectFoodEdit(msg, user) {
  const t = String(msg || '').toLowerCase().trim();
  if (!/\b(edit|change|correct|fix|update|amend)\b/.test(t)) return null;
  // Editing a MEMBER's targets is a different thing entirely and already works.
  if (/\b(water|target weight|macro target|protocol|programme|program|reminder|push|message)\b/.test(t)) return null;

  // Strip the instruction words; whatever remains is the dish.
  const STOP = /\b(need|needs|want|wanna|to|i|we|please|pls|the|a|an|of|for|in|its|and|with|edit|change|correct|fix|update|amend|calorie|calories|kcal|macro|macros|micro|micros|nutrition|nutrient|nutrients|protein|carb|carbs|fat|fibre|fiber|value|values|detail|details|data|entry|food|database|db|gram|grams|g|weight|portion|serving|servings|size|qty|quantity|default|standard|typical|normal|per|100|100g)\b/g;
  // Strip bare numbers too. "edit masala dosa portion to 200" would otherwise
  // search for a food literally called "masala dosa 200" and report it missing.
  // The number is captured separately so the editor can open pre-filled.
  const wanted = (t.match(/\b(\d{2,4})\s*(?:g|gram|grams)?\b/) || [])[1];
  const name = t.replace(STOP, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (name.length < 3) return null;

  const { rows } = await pool.query(
    `SELECT id, name, source, verified, per_100g, default_grams FROM foods
      WHERE lower(name) = $1 OR lower(name) LIKE $2
      ORDER BY (lower(name) = $1) DESC, verified DESC, length(name)
      LIMIT 6`,
    [name, `%${name}%`]);
  if (!rows.length) return { not_found: name };

  // Ambiguity is asked about, never guessed at.
  //
  // "edit dosa" matched four foods and silently opened the shortest one. The
  // coach would have edited what they believed was their dish, pressed "Save
  // for all members", and changed a different food for everybody — with
  // nothing on screen suggesting a choice had been made for them.
  //
  // An exact name match is not ambiguous: "Masala Dosa" means that one even
  // though "Masala Dosa Special" also contains it.
  const exact = rows.filter(r => r.name.toLowerCase() === name);
  if (!exact.length && rows.length > 1) {
    return { ambiguous: name, choices: rows.map(r => ({ id: r.id, name: r.name })) };
  }

  const f = exact[0] || rows[0];
  // How many logged entries a correction would move — shown before deciding,
  // because "this applies to everyone" is the whole point and should not be a
  // surprise discovered afterwards.
  let impact = { entries: 0, members: 0, earliest: null };
  try { impact = await require('../services/foodPropagate').propagationImpact(f.id); }
  catch (e) { console.error('impact lookup failed:', e.message); }

  const macro = macroPlausibility(f.per_100g, f.name);
  const cook  = cookingFatPlausibility(f.per_100g, f.name);
  const sat   = saturatedPlausibility(f.per_100g);
  const mass  = massBalance(f.per_100g);

  return {
    id: f.id,
    name: f.name,
    source: f.source,
    verified: f.verified,
    per_100g: normaliseNutrients(f.per_100g),
    default_grams: f.default_grams,
    // "edit masala dosa portion to 200" opens with 200 already in the box.
    // Suggested, never saved — the coach still presses the button.
    suggested_grams: /\b(portion|serving|gram|grams|weight|size|qty|quantity)\b/.test(t)
      && wanted ? parseInt(wanted) : null,
    impact,
    // The cooking fats a coach can pick from, so saturated fat can be suggested
    // from a real composition rather than a made-up ratio.
    fat_sources: Object.entries(FATS).map(([k, v]) => ({ key: k, label: v.label, sat: v.sat })),
    default_fat_source: DEFAULT_FAT,
    mass_balance: mass,
    warning: mass.status === 'impossible' ? mass.reason
           : macro.status === 'suspect' ? macro.reason
           : cook.status === 'suspect'  ? cook.reason
           : sat.status === 'suspect'   ? sat.reason : null,
    // Editing a shared food changes it for every member, so it stays with the
    // admin. A coach gets the numbers and a clear next step instead of a
    // silent no-op.
    editable: user.role === 'admin',
  };
}

router.post('/coach-parse', roleCheck('monitor', 'admin'), async (req, res) => {
  const { message, context_member_id } = req.body;
  // Last few turns, so a two-part instruction survives. Capped and truncated
  // for the same reason the member chat caps its own history: this is untrusted
  // text going into a prompt, and an unbounded transcript is both a cost and an
  // injection surface.
  const recent = (Array.isArray(req.body?.recent) ? req.body.recent : [])
    .slice(-6)
    .filter(r => r && (r.role === 'coach' || r.role === 'ai') && typeof r.text === 'string' && r.text.trim())
    .map(r => ({ role: r.role, text: r.text.trim().slice(0, 300) }));
  if (!message || String(message).trim().length < 2) {
    return res.status(400).json({ error: 'Message required' });
  }
  const cleanMsg = String(message).trim().slice(0, 1200);

  try {
    // ── "edit <food>" is handled before the model sees it ────────────────────
    // The model classified this as a note about a member and filed it against
    // whoever's page the coach was on. Explicit intent should not be a
    // judgement call.
    try {
      const edit = await detectFoodEdit(cleanMsg, req.user);
      if (edit?.not_found) {
        return res.json({ reply: `I have no food called "${edit.not_found}" in the database.`, actions: [] });
      }
      if (edit?.ambiguous) {
        return res.json({
          reply: `${edit.choices.length} foods match "${edit.ambiguous}" — which one? ` +
                 edit.choices.map(c => c.name).join(' · '),
          actions: [],
        });
      }
      if (edit) {
        return res.json({
          reply: edit.editable
            ? `Editing ${edit.name}. These values apply to every member.`
            : `${edit.name} is a shared food — ask an admin to correct it.`,
          actions: [], food_edit: edit,
        });
      }
    } catch (e) { console.error('detectFoodEdit failed:', e.message); }

    const members = await coachMembers(req.user);
    if (!members.length) {
      return res.json({ reply: 'You have no active members assigned yet.', actions: [] });
    }
    // Progress facts so a congratulations message can quote real numbers
    // instead of inventing them. Never fatal — the coach's other commands must
    // keep working if this query has a bad day.
    let memberStats = [];
    try {
      memberStats = await require('../services/milestones').loadCoachMemberStats(req.user);
    } catch (e) { console.error('member stats unavailable:', e.message); }

    // Optional: the coach is on a member's detail page. Only ever used to
    // resolve a message that names nobody — and only if that member is
    // genuinely assigned to this coach, so the hint can't be used to reach
    // someone else's member.
    const contextMember = context_member_id
      ? members.find(m => String(m.id) === String(context_member_id)) || null
      : null;

    const { text: rawText, provider } =
      await callAI(buildCoachPrompt(cleanMsg, members, memberStats, contextMember, recent));
    const jsonText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);

    // ── Questions are answered, not parsed ───────────────────────────────────
    // Returned as { answer } with no actions, so the client renders a plain
    // reply instead of a preview card with an Apply button — there is nothing
    // to apply.
    if (parsed.question && String(parsed.question.text || '').trim()) {
      const qText = String(parsed.question.text).trim().slice(0, 300);
      const qName = parsed.question.member_name
        ? String(parsed.question.member_name).trim()
        : null;

      // Same loose resolution the commands use, so "padmini" finds
      // "Mrs. Padmini". Scoped to this coach's own members throughout, so a
      // question can never reach someone else's member.
      let qMember = null;
      if (qName && qName.toUpperCase() !== 'ALL') {
        const lc = qName.toLowerCase();
        qMember =
          members.find(m => m.name.toLowerCase() === lc) ||
          members.find(m => m.name.toLowerCase().includes(lc) || lc.includes(m.name.toLowerCase())) ||
          null;
      }
      // A question with no name, asked from a member's page, is about them.
      if (!qMember && !qName && contextMember) qMember = contextMember;

      if (qName && qName.toUpperCase() !== 'ALL' && !qMember) {
        return res.json({
          reply: `I couldn't find a member called "${qName}" in your list.`,
          actions: [], answer: null,
        });
      }

      // A whole-day summary is rendered by the client from real fields — no
      // model call, so no formatting to go wrong and no round trip to wait on.
      // Only for a named member: "summarise everyone" is a different feature.
      if (qMember && String(parsed.question.scope || '').toLowerCase() === 'summary') {
        return res.json({
          reply: null,
          actions: [],
          answer: null,
          summary: await buildCoachSummary(qMember),
          answered_for: qMember.name,
        });
      }

      // A question about a food is answered from the food table, before any
      // member context is built — it is not about a member at all.
      try {
        const foodAnswer = await answerFoodQuestion(qText);
        if (foodAnswer) {
          return res.json({ reply: null, actions: [], answer: foodAnswer, answered_for: null });
        }
      } catch (e) { console.error('answerFoodQuestion failed:', e.message); }

      const context = qMember
        ? await buildCoachMemberContext(qMember)
        : await buildCoachRosterContext(members);

      const { text: answerText } = await callAI(
        buildCoachAnswerPrompt(qText, context, qMember?.name || null));

      return res.json({
        reply: null,
        actions: [],
        answer: String(answerText || '').trim().slice(0, 1200),
        answered_for: qMember?.name || null,
      });
    }

    const commands = (Array.isArray(parsed.commands) ? parsed.commands : []).slice(0, 15);
    const actions = [];

    for (const raw of commands) {
      if (!raw || !raw.member_name) continue;
      const nameRaw = String(raw.member_name).trim();
      const isAll = nameRaw.toUpperCase() === 'ALL';

      // Resolve member (exact → contains, case-insensitive)
      let member = null;
      if (!isAll) {
        const lc = nameRaw.toLowerCase();
        member =
          members.find(m => m.name.toLowerCase() === lc) ||
          members.find(m => m.name.toLowerCase().includes(lc) || lc.includes(m.name.toLowerCase())) ||
          null;
      }

      // Validate operations
      let water_target = parseInt(raw.water_target);
      if (!Number.isFinite(water_target) || water_target < 500 || water_target > 8000) water_target = null;

      let macros = null;
      if (raw.macros && typeof raw.macros === 'object') {
        const mk = (v, max) => { const n = parseInt(v); return Number.isFinite(n) && n > 0 && n <= max ? n : null; };
        macros = {
          kcal: mk(raw.macros.kcal, 6000),
          pro:  mk(raw.macros.pro, 500),
          carb: mk(raw.macros.carb, 800),
          fat:  mk(raw.macros.fat, 400),
        };
        if (macros.kcal == null && macros.pro == null && macros.carb == null && macros.fat == null) macros = null;
      }

      let target_weight = parseFloat(raw.target_weight);
      if (!Number.isFinite(target_weight) || target_weight < 30 || target_weight > 250) target_weight = null;
      else target_weight = +target_weight.toFixed(1);

      let note = null;
      if (raw.note && raw.note.text) {
        note = { text: String(raw.note.text).slice(0, 500), flagged: !!raw.note.flagged };
      }
      let push = null;
      if (raw.push && raw.push.title && raw.push.body) {
        push = { title: String(raw.push.title).slice(0, 90), body: String(raw.push.body).slice(0, 250) };
      }
      // A flag, not text. The model must not author this message — the server
      // builds it from the member's real log at send time, so the coach's
      // version and the 06:30 version can never disagree.
      const morning_nudge = raw.morning_nudge === true ? true : null;

      const ops = {
        morning_nudge,
        water_target,
        macros,
        target_weight,
        program: normaliseProgram(raw.program),
        meal_plan: normaliseMealPlan(raw.meal_plan),
        activities:  normaliseGroupOp(raw.activities,  CATALOG.activities),
        acv:         normaliseGroupOp(raw.acv,         CATALOG.acv),
        supplements: normaliseGroupOp(raw.supplements, CATALOG.supplements),
        note,
        push,
      };

      // "ALL" may only message/notify — drop protocol ops for safety
      if (isAll) {
        ops.water_target = null; ops.macros = null; ops.target_weight = null;
        ops.activities = null; ops.acv = null; ops.supplements = null;
        ops.program = null;   // a split for "everyone" is almost always a mistake
        ops.meal_plan = null; // and so is one dinner for every member
      }

      const changes = describeOps(ops);
      if (!changes.length) continue;

      actions.push({
        member_id:   member ? member.id : null,
        member_name: isAll ? 'All members' : (member ? member.name : nameRaw),
        resolved:    isAll || !!member,
        is_all:      isAll,
        ops,
        changes,
      });
    }

    return res.json({
      reply: String(parsed.reply || '').slice(0, 400) ||
        (actions.length ? 'Here\'s what I\'ll change — review and apply.' : 'I couldn\'t find an actionable instruction — try e.g. "Set Bujju water target 4L".'),
      actions,
      aiProvider: provider,
    });
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message;
    console.error('coach-parse error | status:', err.response?.status, '| detail:', detail);
    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: 'AI returned malformed data — please try again' });
    }
    const s = err.response?.status;
    return res.status(s === 429 || s === 503 ? s : 502).json({
      error: s === 429 ? 'AI is busy — try again in a moment'
           : s === 503 ? 'AI service overloaded — try again shortly'
           : s === 500 ? 'AI service not configured — no API key set'
           : 'AI service error — please try again',
    });
  }
});

// ── POST /api/ai-chat/coach-apply ────────────────────────────────────────────
// Body: { actions: [{ member_id|null, is_all, ops }] }
// Applies each validated action inside a transaction per member.
router.post('/coach-apply', roleCheck('monitor', 'admin'), async (req, res) => {
  const { actions } = req.body;
  if (!Array.isArray(actions) || !actions.length) {
    return res.status(400).json({ error: 'actions array required' });
  }

  const results = [];

  for (const action of actions.slice(0, 15)) {
    const ops = action?.ops || {};

    // ── Broadcast (note/push to all members this coach can see) ──
    if (action.is_all) {
      try {
        const members = await coachMembers(req.user);
        let count = 0;
        for (const m of members) {
          if (ops.note?.text) {
            await pool.query(
              `INSERT INTO monitor_notes (monitor_id, patient_id, note_date, note, flagged)
               VALUES ($1,$2,$3,$4,$5)`,
              [req.user.id, m.id, getISTDate(), ops.note.text, !!ops.note.flagged]
            );
          }
          if (ops.push) {
            try {
              const pushService = require('../services/pushService');
              await pushService.sendToUser(m.id, ops.push.title, ops.push.body, 'coach-ai');
            } catch { /* member may have no subscription */ }
          }
          count++;
        }
        coachAudit(req.user, 'coach_ai_broadcast', null, 'All members',
          `AI broadcast to ${count} members${ops.note ? ` | note: ${ops.note.text.slice(0, 80)}` : ''}${ops.push ? ' | +push' : ''}`);
        results.push({ member_name: 'All members', ok: true, detail: `Sent to ${count} member${count !== 1 ? 's' : ''}` });
      } catch (err) {
        console.error('coach-apply broadcast error:', err.message);
        results.push({ member_name: 'All members', ok: false, detail: 'Broadcast failed' });
      }
      continue;
    }

    // ── Single member ──
    const memberId = parseInt(action.member_id);
    if (!Number.isFinite(memberId)) {
      results.push({ member_name: action.member_name || '?', ok: false, detail: 'Member not resolved' });
      continue;
    }
    if (!(await coachCanAccess(req.user, memberId))) {
      results.push({ member_name: action.member_name || '?', ok: false, detail: 'Not assigned to you' });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: urows } = await client.query(
        `SELECT id, name FROM users WHERE id=$1 AND role='patient'`, [memberId]);
      if (!urows.length) throw new Error('Member not found');
      const memberName = urows[0].name;

      // Ensure profile row exists, then load current protocol state
      await client.query(
        `INSERT INTO patient_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
        [memberId]);
      const { rows: prows } = await client.query(
        `SELECT protocol_activities, protocol_acv, protocol_supplements,
                custom_activities, custom_acv, custom_supplements
         FROM patient_profiles WHERE user_id=$1 FOR UPDATE`, [memberId]);
      const prof = prows[0];

      const appliedBits = [];

      // Merge helper for one group (activities/acv/supplements)
      const mergeGroup = (group, protoCol, customCol) => {
        const op = ops[group];
        if (!op) return null;
        const defaults  = CATALOG[group].map(i => i.id);
        let customList  = Array.isArray(prof[customCol]) ? [...prof[customCol]] : [];
        let protoList   = prof[protoCol]; // null = everything assigned

        // remove_custom by label (or id)
        if (op.remove_custom?.length) {
          const lcs = op.remove_custom.map(l => l.toLowerCase());
          const removedIds = customList
            .filter(c => lcs.includes(String(c.label || '').toLowerCase()) || lcs.includes(String(c.id || '').toLowerCase()))
            .map(c => c.id);
          customList = customList.filter(c => !removedIds.includes(c.id));
          if (protoList) protoList = protoList.filter(id => !removedIds.includes(id));
        }

        // add_custom → generate id; if protocol list is explicit, include new id
        if (op.add_custom?.length) {
          op.add_custom.forEach((c, i) => {
            const exists = customList.find(x => String(x.label).toLowerCase() === c.label.toLowerCase());
            if (exists) { if (protoList && !protoList.includes(exists.id)) protoList.push(exists.id); return; }
            const id = `cx_${Date.now()}${i}`;
            customList.push({ id, label: c.label, sub: c.sub || '' });
            if (protoList) protoList.push(id);
          });
        }

        // add/remove catalog ids
        if (op.remove?.length) {
          const allIds = [...defaults, ...customList.map(c => c.id)];
          if (protoList == null) protoList = allIds; // materialise "all" before removing
          protoList = protoList.filter(id => !op.remove.includes(id));
        }
        if (op.add?.length && protoList != null) {
          op.add.forEach(id => { if (!protoList.includes(id)) protoList.push(id); });
        }
        // (add with protoList null = already all assigned → no-op)

        return { protoList, customList };
      };

      const groups = [
        ['activities',  'protocol_activities',  'custom_activities'],
        ['acv',         'protocol_acv',         'custom_acv'],
        ['supplements', 'protocol_supplements', 'custom_supplements'],
      ];
      for (const [group, protoCol, customCol] of groups) {
        const merged = mergeGroup(group, protoCol, customCol);
        if (!merged) continue;
        await client.query(
          `UPDATE patient_profiles SET ${protoCol}=$1, ${customCol}=$2, updated_at=NOW() WHERE user_id=$3`,
          [merged.protoList ? JSON.stringify(merged.protoList) : null,
           JSON.stringify(merged.customList), memberId]);
        appliedBits.push(group);
      }

      if (ops.water_target != null) {
        await client.query(
          `UPDATE patient_profiles SET water_target=$1, updated_at=NOW() WHERE user_id=$2`,
          [ops.water_target, memberId]);
        appliedBits.push(`water ${ops.water_target}ml`);
      }
      if (ops.target_weight != null) {
        await client.query(
          `UPDATE patient_profiles SET target_weight=$1, updated_at=NOW() WHERE user_id=$2`,
          [ops.target_weight, memberId]);
        appliedBits.push(`goal ${ops.target_weight}kg`);
      }
      if (ops.macros) {
        const sets = [];
        const vals = [];
        let n = 1;
        if (ops.macros.kcal != null) { sets.push(`macro_kcal=$${n++}`); vals.push(ops.macros.kcal); }
        if (ops.macros.pro  != null) { sets.push(`macro_pro=$${n++}`);  vals.push(ops.macros.pro); }
        if (ops.macros.carb != null) { sets.push(`macro_carb=$${n++}`); vals.push(ops.macros.carb); }
        if (ops.macros.fat  != null) { sets.push(`macro_fat=$${n++}`);  vals.push(ops.macros.fat); }
        if (sets.length) {
          vals.push(memberId);
          await client.query(
            `UPDATE patient_profiles SET ${sets.join(', ')}, updated_at=NOW() WHERE user_id=$${n}`,
            vals);
          appliedBits.push('macros');
        }
      }
      if (ops.program) {
        // Replace-not-stack: the partial unique index allows one active program
        // per member, so the current one is retired first. History (and every
        // session logged against it) is preserved — only `active` flips.
        await client.query(
          `UPDATE workout_programs SET active=false WHERE patient_id=$1 AND active=true`,
          [memberId]);
        const { rows: [prog] } = await client.query(
          `INSERT INTO workout_programs (name, patient_id, created_by, active)
           VALUES ($1,$2,$3,true) RETURNING id`,
          [ops.program.name, memberId, req.user.id]);

        for (const [di, day] of ops.program.days.entries()) {
          for (const [ei, ex] of day.exercises.entries()) {
            // Find-or-create by name. The upsert's no-op UPDATE guarantees
            // RETURNING id on both paths, and UNIQUE(name) makes it race-safe.
            const { rows: [exRow] } = await client.query(
              `INSERT INTO exercises (name, muscle_group, created_by)
               VALUES ($1,$2,$3)
               ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
               RETURNING id`,
              [ex.name, ex.muscle_group, req.user.id]);
            await client.query(
              `INSERT INTO program_exercises
                 (program_id, exercise_id, day_number, day_label, order_index,
                  target_sets, target_reps_min, target_reps_max)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [prog.id, exRow.id, di + 1, day.label, ei,
               ex.sets, ex.reps_min, ex.reps_max]);
          }
        }
        appliedBits.push(`program "${ops.program.name}" (${ops.program.days.length} days)`);

        // Tell the member — best effort, never blocks the transaction result.
        require('../services/pushService').sendToUser(memberId, 'New workout program',
          `${ops.program.name} — ${ops.program.days.length} day${ops.program.days.length > 1 ? 's' : ''}. Open Workout to see today's session.`,
          'coach-ai').catch(() => {});
      }
      if (ops.meal_plan) {
        // A standing plan covers a stretch of days, one row per meal per date.
        // repeat_days is 1 for everything the coach types, so the ordinary
        // "add whey to lunch" path still touches today and nothing else.
        const planDates = [];
        {
          const base = new Date(`${getISTDate()}T00:00:00Z`);
          for (let d = 0; d < (ops.meal_plan.repeat_days || 1); d++) {
            const dt = new Date(base);
            dt.setUTCDate(dt.getUTCDate() + d);
            planDates.push(dt.toISOString().slice(0, 10));
          }
        }
        for (const m of ops.meal_plan.meals) {
          // Same-day re-prescription replaces — the UNIQUE constraint makes the
          // upsert atomic, and the member always sees exactly one plan per meal.
          let itemsToStore = m.items;
          if (m.mode === 'append') {
            // "Add whey to the lunch" must not wipe the six items already
            // prescribed. Merge with the stored plan; a re-mention of the same
            // food updates it (new grams win) rather than duplicating.
            const { rows: [existing] } = await client.query(
              `SELECT items FROM meal_plans
               WHERE patient_id=$1 AND plan_date=$2 AND meal=$3`,
              [memberId, planDates[0], m.meal]);
            if (existing?.items?.length) {
              const newNames = new Set(m.items.map(it => it.name.toLowerCase()));
              itemsToStore = [
                ...existing.items.filter(it => !newNames.has(String(it.name).toLowerCase())),
                ...m.items,
              ].slice(0, 20);
            }
          }
          for (const pd of planDates) {
            await client.query(
              `INSERT INTO meal_plans (patient_id, monitor_id, plan_date, meal, items)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (patient_id, plan_date, meal)
               DO UPDATE SET items = EXCLUDED.items, monitor_id = EXCLUDED.monitor_id,
                             created_at = NOW()`,
              [memberId, req.user.id, pd, m.meal, JSON.stringify(itemsToStore)]);
          }
        }
        appliedBits.push(`meal plan (${ops.meal_plan.meals.map(m => m.meal).join(', ')})`);
        require('../services/pushService').sendToUser(memberId, 'Meal plan from your coach',
          ops.meal_plan.meals.map(m => `${m.meal}: ${m.items.length} items`).join(' · ') + ' — open FitLife to log against it.',
          'coach-ai').catch(() => {});
      }
      if (ops.note?.text) {
        await client.query(
          `INSERT INTO monitor_notes (monitor_id, patient_id, note_date, note, flagged)
           VALUES ($1,$2,$3,$4,$5)`,
          [req.user.id, memberId, getISTDate(), ops.note.text, !!ops.note.flagged]);
        appliedBits.push('note');
      }

      await client.query('COMMIT');

      // Today's morning message, on demand.
      //
      // Post-commit alongside push, for the same reason: a delivery failure
      // must not roll back protocol changes the coach also made in the same
      // turn.
      //
      // The text is composed HERE, by the same service the 06:30 cron uses —
      // never by the model. Letting the AI write it would mean the coach's
      // version and the automatic version saying different things to the same
      // member, and would lose the real numbers that make it worth reading.
      if (ops.morning_nudge) {
        try {
          const {
            composeMorningMessages, buildMorningParams, buildMorningBody,
            alreadyAttemptedToday, logSent,
          } = require('../services/digests');
          const { sendWhatsApp } = require('../services/messaging');
          const pushService = require('../services/pushService');
          const istDate = getISTDate();

          if (await alreadyAttemptedToday(memberId, 'morning_nudge', istDate)) {
            appliedBits.push('morning message already sent today');
          } else {
            const [composed] = await composeMorningMessages(istDate, [memberId]);
            if (!composed || !composed.message) {
              appliedBits.push('nothing to say this morning');
            } else if (composed.opted_out) {
              appliedBits.push('member has opted out of messages');
            } else {
              // WhatsApp first, push as the fallback — the same order the cron
              // uses, so the channel does not change depending on who sent it.
              let ok = false;
              const wa = await sendWhatsApp(composed.phone, 'morning',
                buildMorningParams({
                  name: composed.name,
                  yesterday: composed.yesterday,
                  todayDay: composed.todayDay,
                  scheduled: composed.scheduled,
                }));
              if (wa.ok) ok = true;

              if (!ok) {
                try {
                  await pushService.sendToUser(
                    memberId, `Good morning, ${composed.first_name}`, composed.body, 'morning_nudge');
                  ok = true;
                } catch (e) {
                  console.error('coach-apply morning nudge push failed:', e.message);
                }
              }

              // Recorded either way. A failed row is still today's attempt —
              // otherwise the 06:30 cron sends a second copy to a member who
              // may well have received the first.
              await logSent(memberId, 'morning_nudge',
                `Good morning (sent by coach)`, composed.message, ok);
              appliedBits.push(ok ? 'morning message sent' : 'morning message failed to send');
            }
          }
        } catch (e) {
          console.error('coach-apply morning nudge failed:', e.message);
          appliedBits.push('morning message failed to send');
        }
      }

      // Push is post-commit — a push failure must not roll back protocol changes
      if (ops.push) {
        try {
          const pushService = require('../services/pushService');
          await pushService.sendToUser(memberId, ops.push.title, ops.push.body, 'coach-ai');
          appliedBits.push('push');
        } catch (e) {
          console.error('coach-apply push failed:', e.message);
        }
      }

      coachAudit(req.user, 'coach_ai_update', memberId, memberName,
        `AI chat applied: ${appliedBits.join(', ')}`);
      results.push({ member_name: memberName, ok: true, detail: appliedBits.join(', ') || 'no changes' });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('coach-apply error for member', memberId, ':', err.message);
      results.push({ member_name: action.member_name || `#${memberId}`, ok: false, detail: 'Failed to apply' });
    } finally {
      client.release();
    }
  }

  res.json({ results });
});

// ── POST /api/ai-chat/remind ─────────────────────────────────────────────────
// One-tap "Remind" from the coach dashboard's Needs Attention list.
// Body: { members: [{ id, name?, days_since? }] }   (max 30)
// Sends each member a friendly push + a flagged coach message. Template-based
// (no AI call) so it's instant, free, and deterministic.
const REMIND_TEMPLATES = [
  (n) => `Hi ${n}, your coach noticed you haven't logged recently. Even a quick weight + water entry keeps us on track — takes under a minute with AI chat!`,
  (n) => `${n}, we miss your logs! Open FitLife and just tell the AI what you ate today — it fills everything for you.`,
  (n) => `Hi ${n}, small steps count. Log today's weight and meals so your coach can guide you better. You've got this!`,
];

router.post('/remind', roleCheck('monitor', 'admin'), async (req, res) => {
  const { members } = req.body;
  if (!Array.isArray(members) || !members.length) {
    return res.status(400).json({ error: 'members array required' });
  }

  const results = [];
  for (const m of members.slice(0, 30)) {
    const memberId = parseInt(m?.id);
    if (!Number.isFinite(memberId)) continue;
    if (!(await coachCanAccess(req.user, memberId))) {
      results.push({ id: memberId, ok: false, detail: 'Not assigned to you' });
      continue;
    }
    try {
      const { rows } = await pool.query(
        `SELECT name FROM users WHERE id=$1 AND role='patient' AND active=true`, [memberId]);
      if (!rows.length) { results.push({ id: memberId, ok: false, detail: 'Not found' }); continue; }
      const greetName = firstName(rows[0].name);
      const noteText  = REMIND_TEMPLATES[memberId % REMIND_TEMPLATES.length](greetName);

      // Dedupe: the dashboard's Needs Attention list can be tapped repeatedly and
      // each tap used to append an identical flagged note, burying real clinical
      // notes under stacks of the same nudge. One reminder per member per day —
      // and if it was already sent, skip the push too rather than spamming them.
      const ins = await pool.query(
        `INSERT INTO monitor_notes (monitor_id, patient_id, note_date, note, flagged)
         SELECT $1,$2,$3,$4,true
         WHERE NOT EXISTS (
           SELECT 1 FROM monitor_notes
           WHERE patient_id=$2 AND note_date=$3 AND note=$4
         )
         RETURNING id`,
        [req.user.id, memberId, getISTDate(), noteText]);

      if (!ins.rowCount) {
        results.push({ id: memberId, name: rows[0].name, ok: true, skipped: true,
                       detail: 'Already reminded today' });
        continue;
      }

      try {
        const pushService = require('../services/pushService');
        // Reach them wherever they actually are. A member who has stopped
        // logging is exactly the member who is not opening the app, so a
        // push-only nudge is delivered to everyone except its audience.
        const messaging = require('../services/messaging');
        await messaging.notify(memberId, 'nudge',
          [greetName, 'your daily log'],
          { title: 'Your coach checked in 👋',
            body: `${req.user.name} sent you a message. Open FitLife to see it.` });
      } catch { /* no push subscription — note still lands */ }

      coachAudit(req.user, 'coach_remind', memberId, rows[0].name, 'One-tap reminder (note + push)');
      results.push({ id: memberId, name: rows[0].name, ok: true });
    } catch (err) {
      console.error('remind error for', memberId, ':', err.message);
      results.push({ id: memberId, ok: false, detail: 'Failed' });
    }
  }

  res.json({
    results,
    sent:    results.filter(r => r.ok && !r.skipped).length,
    skipped: results.filter(r => r.skipped).length,
  });
});

// ── POST /api/ai-chat/weekly-summary ─────────────────────────────────────────
// One-tap weekly recap: builds the message from the member's real week and
// sends it as a coach note + push. Template-based (no AI call) so it's
// instant, free and always says the same thing for the same numbers.
// Body: { member_id, preview?: true }  — preview returns the text without sending.
router.post('/weekly-summary', roleCheck('monitor', 'admin'), async (req, res) => {
  const memberId = parseInt(req.body?.member_id);
  const preview  = !!req.body?.preview;
  if (!Number.isFinite(memberId)) {
    return res.status(400).json({ error: 'member_id required' });
  }
  if (!(await coachCanAccess(req.user, memberId))) {
    return res.status(403).json({ error: 'Not assigned to you' });
  }

  try {
    const [logsRes, workoutRes, userRes] = await Promise.all([
      pool.query(
        `SELECT log_date, weight_kg, compliance_pct, food_items
         FROM daily_logs WHERE patient_id = $1 AND log_date >= CURRENT_DATE - 6
         ORDER BY log_date ASC`, [memberId]),
      pool.query(
        `SELECT ws.session_date, ws.cardio,
                COALESCE(SUM(ss.reps * ss.weight_kg), 0) AS volume_kg
         FROM workout_sessions ws
         LEFT JOIN session_sets ss ON ss.session_id = ws.id
         WHERE ws.patient_id = $1 AND ws.session_date >= CURRENT_DATE - 6
         GROUP BY ws.id, ws.session_date, ws.cardio`, [memberId]),
      pool.query(`SELECT name FROM users WHERE id = $1 AND role='patient'`, [memberId]),
    ]);

    if (!userRes.rows.length) return res.status(404).json({ error: 'Member not found' });
    const greetName = firstName(userRes.rows[0].name);

    const logs = logsRes.rows;
    const weights = logs.filter(l => l.weight_kg != null).map(l => parseFloat(l.weight_kg));
    const comps = logs.filter(l => l.compliance_pct != null).map(l => parseFloat(l.compliance_pct));
    const avgComp = comps.length ? Math.round(comps.reduce((a, b) => a + b, 0) / comps.length) : null;
    const change = weights.length >= 2 ? +(weights[weights.length - 1] - weights[0]).toFixed(1) : null;
    const volume = Math.round(workoutRes.rows.reduce((s, w) => s + (parseFloat(w.volume_kg) || 0), 0));
    const cardioMin = Math.round(workoutRes.rows.reduce((s, w) => {
      const c = Array.isArray(w.cardio) ? w.cardio : [];
      return s + c.reduce((t, x) => t + (parseFloat(x?.duration_min) || 0), 0);
    }, 0));

    const lines = [`Hi ${greetName}, here's your week:`];
    lines.push(`• Logged ${logs.length} of 7 days`);
    if (avgComp != null) lines.push(`• Average compliance ${avgComp}%`);
    if (change != null) {
      lines.push(change < 0
        ? `• Weight down ${Math.abs(change)} kg`
        : change > 0 ? `• Weight up ${change} kg` : `• Weight held steady`);
    }
    if (workoutRes.rows.length) lines.push(`• ${workoutRes.rows.length} training session${workoutRes.rows.length > 1 ? 's' : ''}${volume ? `, ${volume.toLocaleString()} kg lifted` : ''}`);
    if (cardioMin) lines.push(`• ${cardioMin} min of cardio`);

    // Closing line reflects how the week actually went
    const strong = (avgComp ?? 0) >= 75 || logs.length >= 6;
    lines.push(strong
      ? 'Excellent consistency — keep this rhythm going next week.'
      : 'Let\'s aim for more consistent logging next week — small daily entries add up.');

    const message = lines.join('\n');

    if (preview) return res.json({ message, stats: { days: logs.length, avgComp, change, volume, cardioMin } });

    await pool.query(
      `INSERT INTO monitor_notes (monitor_id, patient_id, note_date, note, flagged)
       VALUES ($1,$2,$3,$4,false)`,
      [req.user.id, memberId, getISTDate(), message]);

    try {
      const pushService = require('../services/pushService');
      const messaging = require('../services/messaging');
      await messaging.notify(memberId, 'summary',
        [greetName, `${logs.length} of 7 days`],
        { title: 'Your weekly summary 📊',
          body: `${logs.length}/7 days logged${change != null && change < 0 ? ` · ${Math.abs(change)} kg down` : ''}` });
    } catch { /* no push subscription — the note still lands */ }

    coachAudit(req.user, 'coach_weekly_summary', memberId, userRes.rows[0].name,
      `Weekly summary sent (${logs.length}/7 days, ${avgComp ?? '—'}% compliance)`);

    res.json({ sent: true, message });
  } catch (err) {
    console.error('weekly-summary error:', err);
    res.status(500).json({ error: 'Could not build the weekly summary' });
  }
});

module.exports = router;
module.exports.callAI = callAI;   // reused by weeklyReport.js — same providers, same fallback
// Exported for tests: the coach-question snapshot is the thing that decides
// whether an answer can be complete, so it needs to be inspectable directly.
module.exports.buildCoachMemberContext = buildCoachMemberContext;
module.exports.buildCoachAnswerPrompt  = buildCoachAnswerPrompt;
module.exports.buildCoachSummary       = buildCoachSummary;
module.exports.programDayForDate = programDayForDate;
module.exports.buildCoachRosterContext = buildCoachRosterContext;
module.exports.buildCoachPrompt = buildCoachPrompt;
// Sprint L1 — the replay tool and test-evals reach these directly.
module.exports.buildParsePrompt   = buildParsePrompt;
// Exported for test-diet-plan: the multi-day plan rules are pure and are
// asserted directly rather than inferred from an HTTP round trip.
module.exports.normaliseMealPlan  = normaliseMealPlan;
module.exports.describeOps        = describeOps;
module.exports.dietPlanMacros     = dietPlanMacros;
module.exports.learnFoods         = learnFoods;
module.exports.enrichFromDB       = enrichFromDB;
module.exports.answerFoodQuestion = answerFoodQuestion;
module.exports.detectFoodEdit     = detectFoodEdit;
module.exports.applyDefaultPortions = applyDefaultPortions;
module.exports.memberGaveQuantity = memberGaveQuantity;
module.exports.applyCookingFat    = applyCookingFat;
module.exports.needsCookingFat    = needsCookingFat;
module.exports.recordEvalSample   = recordEvalSample;
module.exports.rememberParseTurn  = rememberParseTurn;
module.exports.findOriginalTurn   = findOriginalTurn;
module.exports.captureCorrectionSamples = captureCorrectionSamples;
module.exports.evalDedupKey       = evalDedupKey;
module.exports.maybeRecordControl = maybeRecordControl;
module.exports.setControlSampler  = setControlSampler;
module.exports.CONTROL_DAILY_CAP  = CONTROL_DAILY_CAP;
module.exports.CONTROL_SAMPLE_RATE = CONTROL_SAMPLE_RATE;
module.exports.EVAL_DAILY_CAP     = EVAL_DAILY_CAP;
