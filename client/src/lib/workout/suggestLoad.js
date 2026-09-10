/**
 * lib/workout/suggestLoad.js — what to lift today, from what you lifted last time.
 *
 * Sprint 11b. Double progression, the rule every coach teaches first:
 *   · hit the top of the rep range last time → add a little weight, drop to
 *     the bottom of the range
 *   · didn't → same weight, chase the reps
 *   · bodyweight movement → one more rep
 *
 * The increment scales with the load so a 12 kg dumbbell curl is not asked to
 * jump the same 5 kg as a 100 kg squat:
 *   under 20 kg → +1 kg · 20–60 kg → +2.5 kg · over 60 kg → +5 kg
 *
 * Pure. `last` is the best set from the most recent session of this exercise
 * ({ weight_kg, reps }); `target` is the program's prescription
 * ({ target_reps_min, target_reps_max }) when the coach set one.
 * Returns { weight_kg, reps, reason } or null when there is nothing to go on.
 */
export function increment(weightKg) {
  if (weightKg < 20) return 1;
  if (weightKg <= 60) return 2.5;
  return 5;
}

export function suggestLoad({ last, target = null }) {
  if (!last || !(last.reps > 0)) return null;
  const w = Number(last.weight_kg) || 0;
  const reps = Number(last.reps) || 0;

  const lo = target?.target_reps_min ? Number(target.target_reps_min) : null;
  const hi = target?.target_reps_max ? Number(target.target_reps_max) : (lo || null);

  // Bodyweight: progress by reps.
  if (w <= 0) {
    return { weight_kg: 0, reps: reps + 1, reason: `You did ${reps} last time — go for ${reps + 1}.` };
  }

  // With a rep range: top of the range reached → load up, reps back to the bottom.
  if (lo && hi) {
    if (reps >= hi) {
      const next = +(w + increment(w)).toFixed(1);
      return { weight_kg: next, reps: lo, reason: `You hit ${reps} at ${w} kg — move to ${next} kg for ${lo}.` };
    }
    return { weight_kg: w, reps: Math.min(hi, reps + 1), reason: `${w} kg again — aim for ${Math.min(hi, reps + 1)} reps (range ${lo}–${hi}).` };
  }

  // No prescription: treat 12 as the ceiling most members use.
  if (reps >= 12) {
    const next = +(w + increment(w)).toFixed(1);
    return { weight_kg: next, reps: 8, reason: `12+ at ${w} kg — time to go up to ${next} kg.` };
  }
  return { weight_kg: w, reps: reps + 1, reason: `${w} kg again — one more rep than last time.` };
}
