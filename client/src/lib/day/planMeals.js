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
