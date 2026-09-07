/**
 * lib/day/energy.js — calories in, calories out, and the balance between.
 *
 * `calcBMR` used to exist twice — once in pages/DailyLog.jsx and once in
 * pages/Profile.jsx — with a comment on each promising they were the same.
 * They were, until someone edits one. Now there is one.
 *
 * `foodKcal` also existed in two shapes: DailyLog's version fell back to the
 * static nutrition table for foods logged before the food database existed;
 * Profile's did not, so the two screens could show different calorie totals
 * for the same day. The fuller version is the one kept.
 */
import { getNutrition } from '../../constants';

/** Mifflin-St Jeor (1990). Returns null when any input is missing rather
 *  than guessing. Sex unknown → midpoint of the male/female constants. */
export function calcBMR({ weightKg, heightCm, age, gender }) {
  if (!weightKg || !heightCm || age == null) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const g = String(gender || '').toLowerCase();
  if (g === 'male')   return Math.round(base + 5);
  if (g === 'female') return Math.round(base - 161);
  return Math.round(base - 78); // sex unknown — midpoint of the two constants
}

/** Calories eaten today. Per-100g data wins; static table is the fallback. */
export function foodKcal(items = []) {
  return items.reduce((sum, it) => {
    if (it?.per_100g?.calories) return sum + Math.round(it.per_100g.calories * (it.grams || 0) / 100);
    const n = getNutrition(it?.name, it?.grams);
    return sum + (n?.cal || 0);
  }, 0);
}

/** Sedentary baseline multiplier on BMR. Real activity is ADDED on top from
 *  what the member actually logged, not guessed from a lifestyle label. */
export const ACTIVITY_FACTOR = 1.2;

/**
 * Energy balance for the day.
 * Returns null when there is no BMR (missing body stats) or nothing eaten —
 * the UI shows a hint instead of a misleading "−1,800 kcal deficit".
 */
export function dayBalance({ bmr, kcalIn, workoutKcal = 0 }) {
  if (!bmr || !(kcalIn > 0)) return null;
  const out = Math.round(bmr * ACTIVITY_FACTOR) + workoutKcal;
  const balance = kcalIn - out;
  return { out, balance, surplus: balance > 0 };
}
