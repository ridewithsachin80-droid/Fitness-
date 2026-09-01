/**
 * utils/coachCard.js — which rows the "From your coach today" card still shows.
 *
 * The card shows only what is still PENDING. Once the member acts on a row it
 * leaves, and when nothing is pending the whole card leaves — the hero tiles
 * carry the progress from then on. A card that keeps showing "log your workout"
 * after they logged it is worse than no card: it teaches them the app is not
 * paying attention.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * This was an inline IIFE inside the DailyLog JSX, so test-coach-view.js had a
 * copy of it. That copy covered three of the four rows: it knew nothing about
 * prescribed meal plans, so "when nothing is pending the whole card leaves"
 * was being asserted against a version of the rule that could not see one of
 * the things keeping the card open.
 */

/**
 * @param {object}  a
 * @param {object}  a.coachPlan   { programName, todayDay|null } or null
 * @param {number}  a.macrosKcal  the member's calorie target, if set
 * @param {Array}   a.sets        strength sets logged today
 * @param {Array}   a.cardio      cardio entries logged today
 * @param {Array}   a.food        food items logged today
 * @param {Array}   a.mealPlans   prescribed meals for today
 * @returns {{ workout:boolean, rest:boolean, targets:boolean, pendingMeals:Array }}
 */
export function coachCardRows({ coachPlan, macrosKcal, sets, cardio, food, mealPlans = [] }) {
  const workoutDone = (sets || []).length > 0 || (cardio || []).length > 0;
  const foodLogged  = (food || []).length > 0;

  // A prescribed meal is pending until at least one of its items is logged
  // under that slot — after that the food panel's plan card tracks the rest,
  // and repeating it here would be two places nagging about one meal.
  const loggedByMeal = new Set(
    (food || []).map(f => `${f.meal}|${String(f.name).toLowerCase()}`));
  const pendingMeals = (mealPlans || []).filter(mp =>
    !(mp.items || []).some(it => loggedByMeal.has(`${mp.meal}|${String(it.name).toLowerCase()}`)));

  return {
    workout: !!coachPlan?.todayDay && !workoutDone,
    // Rest day only for a program that is actually weekday-scheduled — an
    // unscheduled "Core Workout" has no todayDay by accident, not by design.
    rest:    !!coachPlan && !coachPlan.todayDay,
    targets: !!macrosKcal && !foodLogged,
    pendingMeals,
  };
}

/** Is anything still pending? When not, the card should not render at all. */
export function anyRow(rows) {
  return !!(rows.workout || rows.rest || rows.targets || (rows.pendingMeals || []).length);
}
