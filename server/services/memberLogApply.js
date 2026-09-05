/**
 * services/memberLogApply.js — writes a parsed message into the day's log.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `POST /api/ai-chat/parse` returns a PREVIEW. It writes nothing. The React
 * chat component (client/src/components/AIChatLog.jsx, applyAll) is what
 * actually merges the parsed foods, weight, water, protocol ticks, sleep and
 * corrections into today's log and saves it.
 *
 * That works because there is a screen, and the member ticks what they meant
 * before it commits. Voice logging has neither. A sentence arrives over
 * WhatsApp or SMS, and something has to write it with no one watching.
 *
 * So the rules move here. This is a faithful port of applyAll, rule for rule,
 * not a reinterpretation — anywhere the two could differ is a place the same
 * member gets different results depending on whether they typed or spoke.
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * The app does NOT use this yet. AIChatLog keeps its own apply for now,
 * because switching it changes the offline-queue behaviour and the undo
 * snapshot, and that deserves its own sprint. This ships first, gets used by
 * voice, and the app migrates once it has been proven in production.
 *
 * Until then the two implementations coexist, which is exactly the situation
 * that produced the weekday-matching bug. The mitigation is
 * scripts/test-member-apply.js: it asserts the rules here against the same
 * cases, so a change to one without the other is visible.
 */

const pool = require('../db/pool');
const { getISTDate } = require('../utils/istDate');
const { calcCompliance, protocolTotalFor } = require('./compliance');

const WATER_CAP_ML   = 10000;
const WEIGHT_MIN_KG  = 20;
const WEIGHT_MAX_KG  = 300;

const DEFAULT_MEAL_SLOTS = ['Breakfast', 'Lunch', 'Dinner'];

/**
 * The member's meal slot names, in priority order:
 *
 *   1. patient_profiles.meal_slots — once the client syncs them
 *   2. the slots they have ACTUALLY been using, read from recent food_items
 *   3. the app defaults
 *
 * Step 2 is not a nicety. Meal slots have only ever lived in the browser's
 * local storage and were passed to the server inside each request's context,
 * so for every existing member the column is NULL. Falling straight to the
 * defaults would file a member whose slots are "Pre-workout / Post-workout /
 * Dinner" under "Breakfast" on every voice log — visibly wrong to them and to
 * the coach. What they have eaten under is the best evidence available until
 * the client starts syncing.
 */
async function mealSlotsFor(profile, userId) {
  const slots = profile && profile.meal_slots;
  if (Array.isArray(slots) && slots.length) {
    return slots.map(s => String(s).slice(0, 40));
  }

  if (userId) {
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT jsonb_array_elements(food_items)->>'meal' AS meal
         FROM daily_logs
         WHERE patient_id = $1
           AND log_date > CURRENT_DATE - INTERVAL '30 days'
           AND jsonb_typeof(food_items) = 'array'`, [userId]);
      const used = rows.map(r => r.meal).filter(Boolean);
      if (used.length) return used;
    } catch (err) {
      console.error('mealSlotsFor: could not read used slots:', err.message);
    }
  }

  return [...DEFAULT_MEAL_SLOTS];
}

/** Items the parser marked as on. Voice has no tick-box, so everything counts. */
function onlyOn(list) {
  return (Array.isArray(list) ? list : []).filter(i => i && i.on !== false);
}

/**
 * Applies a parsed message to a member's day.
 *
 * @param {number} userId
 * @param {object} parsed   the object POST /parse returns
 * @param {object} opts
 * @param {string} [opts.istDate]  defaults to today in IST
 * @param {string} [opts.source]   'voice' | 'whatsapp' | 'sms' — stamped on
 *                                 food rows so the coach can see where a log
 *                                 came from
 * @returns {Promise<{applied: object, dayTotals: object}>}
 */
async function applyParsed(userId, parsed, opts = {}) {
  const istDate = opts.istDate || getISTDate();
  const source  = opts.source || null;
  const p       = parsed || {};

  const { rows: profRows } = await pool.query(
    `SELECT * FROM patient_profiles WHERE user_id = $1`, [userId]);
  const profile = profRows[0] || null;
  const slots   = await mealSlotsFor(profile, userId);

  const { rows: logRows } = await pool.query(
    `SELECT * FROM daily_logs WHERE patient_id = $1 AND log_date = $2`, [userId, istDate]);
  const cur = logRows[0] || {};

  // The pg driver returns JSONB as parsed JS, but a NULL column comes back as
  // null rather than {} — every read below has to tolerate that.
  const activities  = { ...(cur.activities  || {}) };
  const acv         = { ...(cur.acv         || {}) };
  const supplements = { ...(cur.supplements || {}) };
  const sleep       = { ...(cur.sleep       || {}) };
  let   food        = Array.isArray(cur.food_items) ? [...cur.food_items] : [];
  let   waterMl     = Number(cur.water_ml) || 0;
  let   weightKg    = cur.weight_kg != null ? Number(cur.weight_kg) : null;

  const applied = {
    weight: null, activities: 0, acv: 0, supplements: 0,
    water_ml: 0, sleep: false, corrections: 0, foods: 0,
    body_metrics: 0, coach_message: false,
  };

  // ── Weight ────────────────────────────────────────────────────────────────
  // The plausibility gate is not defensive padding. A misheard "one eighty
  // five" for 85 would rewrite the member's whole trend line, and over voice
  // there is no preview in which to catch it.
  if (p.weightOn && p.weight_kg != null) {
    const w = Number(p.weight_kg);
    if (Number.isFinite(w) && w >= WEIGHT_MIN_KG && w <= WEIGHT_MAX_KG) {
      weightKg = w;
      applied.weight = w;
    }
  }

  // ── Protocol ticks ────────────────────────────────────────────────────────
  // Merged, never replaced: a member who ticked ACV in the app this morning
  // and mentions their walk by voice this evening must keep both.
  const tickInto = (map, list, key) => {
    for (const item of onlyOn(list)) {
      if (item && item.id) { map[item.id] = true; applied[key]++; }
    }
  };
  tickInto(activities,  p.activities,  'activities');
  tickInto(acv,         p.acv,         'acv');
  tickInto(supplements, p.supplements, 'supplements');

  // ── Water ─────────────────────────────────────────────────────────────────
  if (p.waterOn && p.water_ml_add) {
    const add = Number(p.water_ml_add);
    if (Number.isFinite(add) && add > 0) {
      const before = waterMl;
      waterMl = Math.min(WATER_CAP_ML, waterMl + add);
      applied.water_ml = waterMl - before;
    }
  }

  // ── Sleep ─────────────────────────────────────────────────────────────────
  if (p.sleepOn && p.sleep) {
    if (p.sleep.bedtime)  { sleep.bedtime  = p.sleep.bedtime;  applied.sleep = true; }
    if (p.sleep.waketime) { sleep.waketime = p.sleep.waketime; applied.sleep = true; }
  }

  // ── Corrections ───────────────────────────────────────────────────────────
  // The LAST matching item by name — the most recently logged dal is "the dal"
  // the member means. Grams and slot only; per_100g stays, so calories
  // recompute from the new grams rather than being carried over stale.
  //
  // Corrections run BEFORE new foods are appended, exactly as the client does.
  // Reversing that order would let "make the dal 250g" retarget a dal added in
  // the same sentence rather than the one already logged.
  for (const c of onlyOn(p.corrections)) {
    if (!c.name) continue;
    const want = String(c.name).toLowerCase();
    for (let i = food.length - 1; i >= 0; i--) {
      if (String(food[i].name || '').toLowerCase() === want) {
        food[i] = {
          ...food[i],
          ...(c.grams ? { grams: Number(c.grams) } : {}),
          ...(c.meal  ? { meal:  String(c.meal)  } : {}),
        };
        applied.corrections++;
        break;
      }
    }
  }

  // ── New foods ─────────────────────────────────────────────────────────────
  const foodsOn = onlyOn(p.foods);
  if (foodsOn.length) {
    const baseId = Date.now();
    food = food.concat(foodsOn.map((f, i) => ({
      id:       baseId + i,
      name:     String(f.name || '').slice(0, 120),
      grams:    Number(f.grams) || 0,
      // An unrecognised slot falls back to the member's FIRST slot rather than
      // inventing one. A member with "Breakfast/Lunch/Dinner" who says
      // "brunch" should not end up with a fourth slot only they have.
      meal:     (f.meal && slots.includes(f.meal)) ? f.meal : slots[0],
      food_id:  f.food_id || null,
      per_100g: f.per_100g && Number(f.per_100g.calories) > 0 ? f.per_100g : null,
      // Where this came from, so the coach view can distinguish a voice log
      // from one typed in the app. Unknown keys are ignored by every reader.
      ...(source ? { source } : {}),
    })));
    applied.foods = foodsOn.length;
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  const compliance = calcCompliance(activities, acv, supplements, protocolTotalFor(profile));

  await pool.query(
    `INSERT INTO daily_logs
       (patient_id, log_date, weight_kg, activities, acv,
        food_items, water_ml, supplements, sleep, compliance_pct, saved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (patient_id, log_date) DO UPDATE SET
       weight_kg      = EXCLUDED.weight_kg,
       activities     = EXCLUDED.activities,
       acv            = EXCLUDED.acv,
       food_items     = EXCLUDED.food_items,
       water_ml       = EXCLUDED.water_ml,
       supplements    = EXCLUDED.supplements,
       sleep          = EXCLUDED.sleep,
       compliance_pct = EXCLUDED.compliance_pct,
       saved_at       = NOW()`,
    [userId, istDate, weightKg,
     JSON.stringify(activities), JSON.stringify(acv),
     JSON.stringify(food), waterMl,
     JSON.stringify(supplements), JSON.stringify(sleep), compliance]);

  // ── Body metrics ──────────────────────────────────────────────────────────
  // Scale-screenshot metrics go to lab history, which is where the coach's
  // Body Composition section reads from. Deliberately AFTER the log write and
  // deliberately non-fatal: the day's log has already committed and must not
  // be rolled back because a secondary write failed.
  if (p.bodyMetricsOn && Array.isArray(p.bodyMetrics) && p.bodyMetrics.length) {
    try {
      for (const bm of p.bodyMetrics) {
        if (!bm || !bm.name) continue;
        await pool.query(
          `INSERT INTO lab_values (patient_id, test_date, test_name, value, unit, lab_name, notes)
           VALUES ($1, $2, $3, $4, $5, 'Smart Scale', 'Captured via voice logging')`,
          [userId, istDate, String(bm.name).slice(0, 100), bm.value, bm.unit || null]);
        applied.body_metrics++;
      }
    } catch (err) {
      console.error('applyParsed: body metrics failed:', err.message);
    }
  }

  const dayTotals = computeTotals(food);
  return { applied, dayTotals };
}

/**
 * Calories and macros for a food list.
 *
 * Items with per_100g null contribute nothing — that is correct, not a gap:
 * an unrecognised food has no nutrition data, and guessing would put a made-up
 * number in front of a member who is trying to hit a target.
 */
function computeTotals(food) {
  let cal = 0, protein = 0, carbs = 0, fat = 0;
  for (const f of (food || [])) {
    const per = f && f.per_100g;
    if (!per) continue;
    const g = (Number(f.grams) || 0) / 100;
    cal     += (Number(per.calories) || 0) * g;
    protein += (Number(per.protein)  || 0) * g;
    carbs   += (Number(per.carbs)    || 0) * g;
    fat      += (Number(per.fat)     || 0) * g;
  }
  return {
    cal:     Math.round(cal),
    protein: Math.round(protein),
    carbs:   Math.round(carbs),
    fat:     Math.round(fat),
  };
}

/**
 * The sentence a phone reads back after a voice log.
 *
 * THIS IS SPOKEN ALOUD by Siri or Google Assistant, which constrains it in
 * ways ordinary UI copy is not:
 *
 *   - ONE reply, always. There is no round trip, so a follow-up question is a
 *     dead end — "anything else?" with nowhere to answer.
 *   - NO emoji and no symbols. TTS reads "✓" as "check mark", or skips it.
 *   - Numbers grouped with commas, so 1160 reads as "one thousand one hundred
 *     and sixty" rather than "one one six zero".
 *   - Under about 25 words. Past that people stop listening and the useful
 *     part is at the end.
 *
 * @param {object} applied    what applyParsed changed
 * @param {object} dayTotals  totals AFTER applying
 * @param {object} [opts]     { calorieTarget }
 */
function composeVoiceReply(applied, dayTotals, opts = {}) {
  const a = applied || {};
  const parts = [];

  if (a.foods)       parts.push(`${a.foods} ${a.foods === 1 ? 'item' : 'items'}`);
  if (a.corrections) parts.push(`${a.corrections} corrected`);
  if (a.weight != null) parts.push(`${a.weight} kg`);
  if (a.water_ml)    parts.push(`${a.water_ml} ml water`);

  const ticks = (a.activities || 0) + (a.acv || 0) + (a.supplements || 0);
  if (ticks) parts.push(`${ticks} ${ticks === 1 ? 'tick' : 'ticks'}`);
  if (a.sleep) parts.push('sleep');

  if (!parts.length) {
    // Nothing understood. Give an EXAMPLE rather than an apology — a member
    // who hears "I did not understand" twice stops using it, whereas one who
    // hears the shape of a working sentence tries again correctly.
    return 'Samjha nahi. Try something like two roti and dal, or walked thirty minutes.';
  }

  const n = (v) => Number(v).toLocaleString('en-IN');
  let reply = `Logged ${parts.join(', ')}.`;

  if (dayTotals && dayTotals.cal > 0) {
    const target = Number(opts.calorieTarget) || 0;
    reply += target > 0
      ? ` ${n(dayTotals.cal)} calories so far, ${n(Math.max(0, target - dayTotals.cal))} left.`
      : ` ${n(dayTotals.cal)} calories so far.`;
  }
  return reply;
}

module.exports = { applyParsed, composeVoiceReply, computeTotals, mealSlotsFor,
                   DEFAULT_MEAL_SLOTS };
