/**
 * services/mealSlot.js — which meal a food goes under when the member did not
 * say, for logs that arrive with no screen (voice, hands-free, phone shortcut).
 *
 * Fix, 10 Oct 2026 (VOI-012): voice food always went under the member's FIRST
 * meal slot, so "curd rice" said at 1 pm landed in Breakfast. The app already
 * picks the meal that is due now (client/src/lib/day/planMeals.js
 * defaultMealSlot); this is the same rule, so a member gets the same answer
 * whether they type or speak:
 *
 *   1. a prescribed meal not yet logged, within 2½ hours of now (nearest wins)
 *   2. by the time of day and the slot's name: before 11:00 breakfast, before
 *      16:00 lunch, before 19:00 snack (or dinner), then dinner
 *   3. otherwise the slots spread evenly over 06:00–22:00
 *
 * test-day-lib.js / test-voice-slot run both copies on the same cases.
 */
const NEAR_MIN = 150;

const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Minutes since midnight in India now. */
function istMinutes(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/**
 * @param {string[]} slots   the member's meal slot names, in order
 * @param {Array}    meals   today's prescribed meals [{ meal, time }] (may be empty)
 * @param {Array}    food    today's logged food [{ meal, name }]
 * @param {number}   nowMin  minutes since midnight, IST
 */
function pickSlot({ slots = [], meals = [], food = [], nowMin = istMinutes() } = {}) {
  const list = (slots || []).filter(Boolean);
  if (!list.length) return 'Meal 1';
  const find = (name) => list.find(s => s.toLowerCase() === String(name || '').toLowerCase());
  const loggedSlots = new Set((food || []).map(f => String(f && f.meal || '').toLowerCase()).filter(Boolean));

  const near = (meals || [])
    .map(m => ({ meal: m.meal, min: toMin(m.time) }))
    .filter(m => m.min != null && !loggedSlots.has(String(m.meal).toLowerCase())
      && Math.abs(m.min - nowMin) <= NEAR_MIN && find(m.meal))
    .sort((a, b) => Math.abs(a.min - nowMin) - Math.abs(b.min - nowMin))[0];
  if (near) return find(near.meal);

  const named = (re) => list.find(s => re.test(s));
  const breakfast = named(/breakfast|morning|tiffin|thindi/i), lunch = named(/lunch|oota/i);
  const snack = named(/snack|evening|tea/i), dinner = named(/dinner|supper|night|raatri/i);
  const h = nowMin / 60;
  const byName = h < 11 ? breakfast : h < 16 ? lunch : h < 19 ? (snack || dinner) : dinner;
  if (byName) return byName;

  const i = Math.floor((Math.min(Math.max(nowMin, 360), 1319) - 360) / (960 / list.length));
  return list[Math.min(list.length - 1, Math.max(0, i))];
}

/**
 * Today's prescribed meals with their times, for pickSlot. Never throws: a
 * failure only means the time-of-day rule decides.
 */
async function prescribedMeals(db, memberId, date) {
  try {
    const DP = require('./dietPlan');
    const [plan, { rows }] = await Promise.all([
      DP.planInForce(db, memberId, date),
      db.query(`SELECT meal, items, created_at FROM meal_plans WHERE patient_id = $1 AND plan_date = $2::date ORDER BY created_at`, [memberId, date]),
    ]);
    return DP.timedMeals(rows, plan, date).map(m => ({ meal: m.meal, time: m.time }));
  } catch (err) {
    console.error('mealSlot: prescribed meals unavailable:', err.message);
    return [];
  }
}

module.exports = { pickSlot, prescribedMeals, istMinutes, NEAR_MIN };
