import { sleepMinutes, formatSleep } from './sleep';

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
