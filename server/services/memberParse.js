/**
 * services/memberParse.js — building the parse context without a client.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `POST /ai-chat/parse` expects the CLIENT to send a `context` object: the
 * member's meal slots, their protocol items, their water target, the last few
 * chat turns and today's logged foods. The app assembles all of that from its
 * own stores before every request.
 *
 * Voice logging has no app. A sentence arrives from a phone shortcut, a
 * WhatsApp webhook or an SMS gateway, and the server has to assemble the same
 * context itself — or the parser loses the hints that make it accurate.
 *
 * That is not a nicety. Without `activities` the model cannot map "did my
 * walk" to the tick id `walk`. Without `lastFoods` a correction like "make the
 * dal 250g" has nothing to correct. Without `mealSlots` every food lands in
 * the first slot. The context is most of what makes the parse good.
 */

const pool = require('../db/pool');
const { getISTDate } = require('../utils/istDate');
const { mealSlotsFor } = require('./memberLogApply');

/** Protocol item ids and labels, in the shape the parse prompt expects. */
function itemsFrom(assigned, custom, fallbackIds) {
  // `protocol_*` is the assigned list; `custom_*` carries member-specific
  // extras with their own labels. Null assigned means "stock protocol".
  const out = [];
  const seen = new Set();

  const push = (id, label) => {
    const key = String(id);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ id: key, label: String(label || key).slice(0, 60) });
  };

  if (Array.isArray(assigned) && assigned.length) {
    for (const a of assigned) {
      if (typeof a === 'string') push(a, a);
      else if (a && a.id) push(a.id, a.label);
    }
  } else {
    for (const id of fallbackIds) push(id, id);
  }

  if (Array.isArray(custom)) {
    for (const c of custom) if (c && c.id) push(c.id, c.label);
  }
  return out;
}

// The stock protocol ids, matching the client's defaults. Used when a member
// has no assigned list — the same fallback the app makes.
const STOCK_ACTIVITIES  = ['walk', 'sun', 'steps1', 'steps2', 'breath', 'stretch'];
const STOCK_ACV         = ['acv1', 'acv2', 'acv3'];
const STOCK_SUPPLEMENTS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];

/**
 * Assembles the same `context` object the app sends, from the database.
 *
 * @param {number} userId
 * @param {object} [opts] { istDate, recent }
 * @returns {Promise<object>} the ctx shape POST /parse expects
 */
async function buildParseContext(userId, opts = {}) {
  const istDate = opts.istDate || getISTDate();

  const { rows: profRows } = await pool.query(
    `SELECT * FROM patient_profiles WHERE user_id = $1`, [userId]);
  const profile = profRows[0] || null;

  const { rows: logRows } = await pool.query(
    `SELECT food_items FROM daily_logs WHERE patient_id = $1 AND log_date = $2`,
    [userId, istDate]);
  const todaysFood = Array.isArray(logRows[0]?.food_items) ? logRows[0].food_items : [];

  // Conversation memory. Without it "make the dal 250g" and "that was dinner"
  // have nothing to refer back to, which is most of what makes repeat logging
  // feel like a conversation rather than a form.
  let recent = Array.isArray(opts.recent) ? opts.recent : null;
  if (!recent) {
    try {
      const { rows } = await pool.query(
        `SELECT text, reply FROM quick_log_turns
         WHERE patient_id = $1
           AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date
         ORDER BY created_at DESC LIMIT 3`, [userId, istDate]);
      recent = [];
      // Oldest first, matching the order the app sends.
      for (const r of rows.reverse()) {
        if (r.text)  recent.push({ role: 'user', text: String(r.text).slice(0, 200) });
        if (r.reply) recent.push({ role: 'ai',   text: String(r.reply).slice(0, 200) });
      }
    } catch (err) {
      // A missing table or a failed read must not stop someone logging.
      console.error('buildParseContext: recent turns unavailable:', err.message);
      recent = [];
    }
  }

  return {
    mealSlots:   await mealSlotsFor(profile, userId),
    activities:  itemsFrom(profile?.protocol_activities,  profile?.custom_activities,  STOCK_ACTIVITIES),
    acv:         itemsFrom(profile?.protocol_acv,         profile?.custom_acv,         STOCK_ACV),
    supplements: itemsFrom(profile?.protocol_supplements, profile?.custom_supplements, STOCK_SUPPLEMENTS),
    waterTargetMl: Math.min(8000, Math.max(500, parseInt(profile?.water_target, 10) || 3000)),
    recent,
    lastFoods: todaysFood.slice(0, 20)
      .filter(f => f && f.name)
      .map(f => ({
        name:  String(f.name).slice(0, 100),
        grams: Math.min(3000, Math.max(0, parseInt(f.grams, 10) || 0)),
        meal:  f.meal ? String(f.meal).slice(0, 40) : null,
      })),
  };
}

/**
 * The member's daily calorie target, for the spoken reply.
 *
 * The column is macro_kcal — the same one the evening recap reads. Using a
 * different source would mean the voice reply and the 20:30 recap quoting two
 * different targets to the same member on the same day.
 */
async function calorieTargetFor(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT macro_kcal FROM patient_profiles WHERE user_id = $1`, [userId]);
    const t = Number(rows[0]?.macro_kcal);
    return Number.isFinite(t) && t > 0 ? t : null;
  } catch (_) {
    return null;
  }
}

module.exports = { buildParseContext, calorieTargetFor, itemsFrom,
                   STOCK_ACTIVITIES, STOCK_ACV, STOCK_SUPPLEMENTS };
