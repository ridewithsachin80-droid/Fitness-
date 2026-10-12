import { carbsOf } from '../lib/day';

export function withFoodGrams(food, value) {
  // An empty input is allowed while typing, but cannot be applied.
  const raw = Number(value);
  const grams = value === '' ? '' : Number.isFinite(raw) ? Math.min(5000, Math.max(0, raw)) : '';
  const per = food.per_100g || {};
  const k = (Number(grams) || 0) / 100;
  return { ...food, grams, macros: {
    cal: Math.round((Number(per.calories) || 0) * k),
    pro: +((Number(per.protein) || 0) * k).toFixed(1),
    carb: +(carbsOf(per) * k).toFixed(1),
    fat: +((Number(per.fat) || 0) * k).toFixed(1),
  } };
}

export function foodReviewError(foods = []) {
  const invalid = foods.find(f => f.on && (
    !String(f.name || '').trim() || !Number.isFinite(Number(f.grams)) ||
    Number(f.grams) <= 0 || Number(f.grams) > 5000
  ));
  return invalid ? 'Enter a quantity above 0 g for every included food, or untick the item.' : '';
}

export function reviewTotals(foods = []) {
  const totals = { cal: 0, pro: 0, carb: 0, fat: 0 };
  foods.filter(f => f.on).forEach(f => {
    for (const key of Object.keys(totals)) totals[key] += Number(f.macros?.[key]) || 0;
  });
  return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, k === 'cal' ? Math.round(v) : +v.toFixed(1)]));
}
