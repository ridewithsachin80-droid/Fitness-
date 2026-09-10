import { sleepMinutes, formatSleep } from './sleep';

/**
 * The previous weigh-in to compare against, skipping a mistyped one.
 * `rows` are the member's logs, newest first; `fromIndex` is the day being
 * shown. A reading more than 3 kg from BOTH of its neighbours is a typo, not
 * a change — showing "↓ 5.1 vs yesterday" off one bad row is worse than
 * showing nothing. Mirrors the rule in server/services/triage.js.
 */
export function previousWeight(rows = [], fromIndex = 0) {
  const w = [];
  for (let i = fromIndex + 1; i < rows.length && w.length < 3; i++) {
    if (rows[i]?.weight_kg != null) w.push(parseFloat(rows[i].weight_kg));
  }
  if (!w.length) return null;
  // The immediate previous reading is a typo when it disagrees with BOTH of
  // the two before it; then compare against the last believable one instead.
  if (w.length >= 3 && Math.abs(w[0] - w[1]) > 3 && Math.abs(w[0] - w[2]) > 3) return w[1];
  return w[0];
}

/**
 * Build the slice of the Today model that Timeline reads, from a RAW server
 * daily_logs row (weight_kg, food_items, water_ml, sleep …). The coach's
 * member page uses this so a coach sees exactly the timeline the member
 * sees, from the same component. Workout data is optional.
 */
export function timelineModelFromServerLog(row, { workout = null, isToday = false, terms = { kcal: 'kcal', sleep: 'Sleep' }, yesterdayWeight = null } = {}) {
  const log = {
    weight: row?.weight_kg != null ? String(row.weight_kg) : '',
    food:   Array.isArray(row?.food_items) ? row.food_items : [],
    water:  Number(row?.water_ml) || 0,
    sleep:  row?.sleep || {},
    notes:  row?.notes || '',
  };
  const mins = sleepMinutes(log.sleep.bedtime, log.sleep.waketime);
  const sets = workout?.exercises?.reduce((n, e) => n + ((e.sets || []).filter(st => (parseInt(st?.reps) || 0) > 0).length), 0) || 0;
  const workoutSummary = { count: workout?.exercises?.filter(e => (e.sets || []).some(st => (parseInt(st?.reps) || 0) > 0)).length || 0, cardio: workout?.cardio || [], duration: workout?.session?.duration_min || null, sets };
  const weightDelta = log.weight && yesterdayWeight != null ? +(parseFloat(log.weight) - yesterdayWeight).toFixed(1) : null;
  return { log, workoutSummary, workoutKcal: workout?.kcal || 0, sleepText: formatSleep(mins), sleepMins: mins, terms, isToday, weightDelta };
}
