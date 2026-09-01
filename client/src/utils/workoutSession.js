/**
 * utils/workoutSession.js — what a program-day chip tap does to the session.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This lived inside `WorkoutLog.jsx`, tangled up with `haptic()`, two pieces of
 * React state and a toast. None of that is testable from Node, so
 * `server/scripts/test-coach-view.js` reimplemented the rules under a comment
 * saying "mirrors WorkoutLog day-chip switch semantics" — six assertions
 * guarding the stacked-circuits bug, none of which could turn red if the
 * shipped component changed.
 *
 * The rules are pure. They belong here; the haptics, state and toast stay in
 * the component.
 *
 * ── THE RULE THAT MATTERS ───────────────────────────────────────────────────
 * Tapping a chip SWITCHES days: the previous day's untouched exercises leave
 * and the new day's arrive. It does not stack them — that was the original bug,
 * where working through a week's chips left a member staring at twenty-four
 * exercises. But anything with a set already entered is real training data and
 * is never removed by a chip tap. Remove on the exercise is the only way out.
 * Manually searched-in exercises (no `fromProgram` flag) are never swept either.
 */

/**
 * Has this exercise got anything a member actually typed?
 * A blank row from "+ Add Set" is not data — it is an empty row.
 */
export function hasLoggedData(ex) {
  return (ex?.sets || []).some(st =>
    String(st?.reps).trim() !== '' || String(st?.weight_kg).trim() !== '');
}

/** Which exercises survive a switch to `day`. */
export function keptOnSwitch(session = [], day) {
  const dayIds = new Set((day?.exercises || []).map(ex => ex.exercise_id));
  return (session || []).filter(ex =>
    !ex.fromProgram || dayIds.has(ex.exercise_id) || hasLoggedData(ex));
}

/**
 * The session after tapping `day`'s chip.
 *
 * Exercises already present that belong to this day keep their sets and get
 * (re)marked as program exercises — an overlapping lift must not lose the set
 * the member just entered because the chip changed.
 *
 * @param {Array}  session
 * @param {{ day_number:number, exercises:Array }} day
 * @returns {Array} the new session
 */
export function applyProgramDay(session = [], day) {
  const dayIds = new Set((day?.exercises || []).map(ex => ex.exercise_id));
  const kept   = keptOnSwitch(session, day);
  const have   = new Set(kept.map(ex => ex.exercise_id));

  const added = (day?.exercises || [])
    .filter(ex => !have.has(ex.exercise_id))
    .map(ex => ({
      exercise_id: ex.exercise_id,
      exercise_name: ex.exercise_name,
      sets: [],
      fromProgram: true,
    }));

  return [
    ...kept.map(ex => (dayIds.has(ex.exercise_id) ? { ...ex, fromProgram: true } : ex)),
    ...added,
  ];
}

/**
 * What to tell the member about the switch that just happened.
 *
 * Switching used to make five exercises vanish silently, and if some had sets
 * entered the member got a MIXED list — part of the old day still there, part
 * gone — with no explanation for the pattern.
 *
 * @returns {{ removed:number, keptWithData:number }}
 */
export function switchCounts(session = [], day) {
  const dayIds = new Set((day?.exercises || []).map(ex => ex.exercise_id));
  const kept   = keptOnSwitch(session, day);
  return {
    removed: (session || []).length - kept.length,
    keptWithData: kept.filter(ex => ex.fromProgram && !dayIds.has(ex.exercise_id)).length,
  };
}
