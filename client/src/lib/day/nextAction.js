/**
 * lib/day/nextAction.js — the ONE thing to do next, from the day's state.
 *
 * Today's read says what the day looks like; this says what to tap. It is
 * deliberately a priority list, not a score: the first true condition wins.
 * Keeping it pure (no time-of-day guessing beyond the hour passed in) means
 * the same day always yields the same button, and the golden test can pin it.
 *
 * Returns { sheet, label } or null when there is nothing obvious to do.
 */
export function nextAction({
  isToday = true, hour = 12,
  weight, foodCount = 0, waterMl = 0, waterTarget = 3000,
  protocolDone = 0, protocolTotal = 0, sleepSet = false,
  workoutPlanned = false, workoutLogged = false,
}) {
  if (!isToday) return null;
  if (!weight && hour < 11)                                   return { sheet: 'weight',   label: 'Log this morning\u2019s weight' };
  if (foodCount === 0 && hour >= 9)                           return { sheet: 'food',     label: 'Log what you\u2019ve eaten' };
  if (workoutPlanned && !workoutLogged && hour >= 6)          return { sheet: 'workout',  label: 'Start today\u2019s workout' };
  if (protocolTotal > 0 && protocolDone < protocolTotal)      return { sheet: 'protocol', label: `Tick the protocol · ${protocolTotal - protocolDone} left` };
  if (waterTarget > 0 && waterMl < waterTarget * 0.5 && hour >= 14) return { sheet: 'water', label: 'Add water' };
  if (!sleepSet && hour >= 18)                                return { sheet: 'sleep',    label: 'Set last night\u2019s sleep' };
  if (!weight)                                                return { sheet: 'weight',   label: 'Log your weight' };
  return null;
}
