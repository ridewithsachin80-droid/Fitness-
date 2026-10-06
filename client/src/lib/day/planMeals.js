/**
 * lib/day/planMeals.js — the coach's prescribed meals for one day (Phase 2).
 *
 * Pure. Given today's prescribed meals (each with its time from the diet
 * plan), what is logged, and the time now, it says which meal is "next up".
 *
 * THE RULES
 *   · A meal counts as LOGGED once ANYTHING is in the food log under that
 *     meal slot: one of its planned items, or something else eaten instead
 *     (a plate photo logged "instead of the plan", or the chat). The coach
 *     card (utils/coachCard.js) uses the same rule, so the two never disagree.
 *     (Live test, 5 Oct: a swap logged under Breakfast left Breakfast "Missed"
 *     on the card, so the member logged it twice.)
 *   · Next up is the EARLIEST meal that is not logged. A meal whose time went
 *     by more than MISSED_AFTER_MIN ago is "missed", and still next up: the
 *     member can log it late. The app never skips a meal on their behalf.
 *   · Meals with no time come after timed ones, in the order they were given.
 */

/** A meal is "missed" this long after its time. */
export const MISSED_AFTER_MIN = 90;

const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const key = (meal, name) => `${String(meal || '').toLowerCase()}|${String(name || '').toLowerCase()}`;

export const itemKcal = (it) => Math.round((Number(it?.grams) || 0) * (Number(it?.per_100g?.calories) || 0) / 100);
export const mealKcal = (items = []) => items.reduce((a, it) => a + itemKcal(it), 0);

/** Minutes since midnight in India, whatever the phone's own timezone. */
export function istMinutes(now = new Date()) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
    .format(now).split(':').map(Number);
  return (h % 24) * 60 + m;
}

/** "16:00" -> "4:00 PM". Empty string for no time. */
export function clock(t) {
  const min = toMin(t);
  if (min == null) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** "in 40 min", "in 2 h", "now". Null when the time has passed, is unknown,
 *  or is more than three hours off (a countdown that long is noise). */
export function untilText(t, nowMin) {
  const min = toMin(t);
  if (min == null) return null;
  const d = min - nowMin;
  if (d < -15) return null;
  if (d <= 5) return 'now';
  if (d < 60) return `in ${Math.round(d / 5) * 5} min`;
  if (d > 180) return null;
  const h = Math.round(d / 30) / 2;
  return `in ${h} h`;
}

/**
 * @param {Array}  mealPlans [{ meal, time|null, items:[{name,grams,qty_text,per_100g}] }]
 * @param {Array}  food      today's logged food items [{ name, grams, meal }]
 * @param {number} nowMin    minutes since midnight (IST)
 * @returns {{ meals: Array, next: object|null, then: object|null, loggedCount: number, total: number }}
 */
export function planMeals({ mealPlans = [], food = [], nowMin = 0 }) {
  const logged = new Set((food || []).map(f => key(f.meal, f.name)));
  const slots  = new Set((food || []).map(f => String(f.meal || '').toLowerCase()).filter(Boolean));
  const meals = (mealPlans || [])
    .filter(mp => (mp.items || []).length)
    .map((mp, i) => {
      const done = mp.items.filter(it => logged.has(key(mp.meal, it.name)));
      const min = toMin(mp.time);
      const isLogged = done.length > 0 || slots.has(String(mp.meal || '').toLowerCase());
      return {
        meal: mp.meal, time: mp.time || null, items: mp.items,
        kcal: mealKcal(mp.items),
        // What is still to log: a meal logged in part keeps its other items.
        pending: mp.items.filter(it => !logged.has(key(mp.meal, it.name))),
        logged: isLogged,
        complete: done.length === mp.items.length,
        missed: !isLogged && min != null && nowMin - min > MISSED_AFTER_MIN,
        _min: min, _i: i,
      };
    })
    .sort((a, b) => (a._min != null && b._min != null ? a._min - b._min : a._min != null ? -1 : b._min != null ? 1 : 0) || a._i - b._i);

  const open = meals.filter(m => !m.logged);
  return {
    meals,
    next: open[0] || null,
    then: open[1] || null,
    loggedCount: meals.length - open.length,
    total: meals.length,
  };
}

/**
 * Turn the sheet's choices into food-log rows and a plain list of what
 * differs from the plan.
 *
 * @param {object} meal     a meal from planMeals()
 * @param {object} choices  { [itemName]: { on: boolean, grams: string|number } }
 * @param {Array}  food     today's logged food (to avoid logging an item twice)
 * @returns {{ rows: Array, kcal: number, changes: string[] }}
 */
export function plannedRows(meal, choices = {}, food = []) {
  const already = new Set((food || []).map(f => key(f.meal, f.name)));
  const rows = [], changes = [];
  for (const it of meal?.items || []) {
    if (already.has(key(meal.meal, it.name))) continue;
    const c = choices[it.name] || { on: true, grams: it.grams };
    const g = Math.min(2000, parseFloat(c.grams));
    if (!c.on) { changes.push(`${it.name} skipped`); continue; }
    if (!Number.isFinite(g) || g <= 0) { changes.push(`${it.name} skipped`); continue; }
    if (g !== Number(it.grams)) changes.push(`${it.name} ${g} g (plan ${Number(it.grams)} g)`);
    rows.push({ name: it.name, grams: g, meal: meal.meal, food_id: null, per_100g: it.per_100g || null });
  }
  return { rows, kcal: mealKcal(rows), changes };
}

/**
 * Which meal slot food goes under when the member did not say ("2 chapati,
 * paneer 150 g" at 7 pm). Before, it always went to the FIRST slot, so a
 * dinner logged by chat landed under Breakfast (live test, 5 Oct, 19:14).
 *
 *   1. A prescribed meal timed within 2½ hours of now, and still to log, whose
 *      name is one of the member's slots: that meal. (Logged at 19:14 with
 *      Dinner planned for 19:30 -> Dinner.)
 *   2. Otherwise by the clock and the slot names: breakfast before 11:00,
 *      lunch 11:00–15:59, snack 16:00–18:59 if there is one, dinner after.
 *   3. Slots with other names: spread across 6 am to 10 pm, in order.
 */
export function defaultMealSlot({ mealSlots = [], mealPlans = [], food = [], nowMin = istMinutes() } = {}) {
  const slots = (mealSlots || []).filter(Boolean);
  if (!slots.length) return 'Meal 1';
  const find = (name) => slots.find(s => s.toLowerCase() === String(name || '').toLowerCase());

  const { meals } = planMeals({ mealPlans, food, nowMin });
  const near = meals
    .filter(m => !m.logged && m._min != null && Math.abs(m._min - nowMin) <= 150 && find(m.meal))
    .sort((a, b) => Math.abs(a._min - nowMin) - Math.abs(b._min - nowMin))[0];
  if (near) return find(near.meal);

  const named = (re) => slots.find(s => re.test(s));
  const breakfast = named(/breakfast|morning|tiffin|thindi/i), lunch = named(/lunch|oota/i);
  const snack = named(/snack|evening|tea/i), dinner = named(/dinner|supper|night|raatri/i);
  const h = nowMin / 60;
  const byName = h < 11 ? breakfast : h < 16 ? lunch : h < 19 ? (snack || dinner) : dinner;
  if (byName) return byName;

  const i = Math.floor((Math.min(Math.max(nowMin, 360), 1319) - 360) / (960 / slots.length));
  return slots[Math.min(slots.length - 1, Math.max(0, i))];
}
