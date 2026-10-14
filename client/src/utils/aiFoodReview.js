import { carbsOf } from '../lib/day';

// Keep a household description separate from the changing gram total while a
// draft is edited. It is not sent as nutrition or persisted by the save mapper.
function quantityDescription(food) {
  const text = String(food.qty_description ?? food.qty_text ?? '').trim().slice(0, 160);
  const description = text.replace(/\s*·\s*[-+]?\d+(?:\.\d+)?\s*g\s*$/i, '').trim();
  // Free-form text containing another gram/kg amount can contradict the new
  // quantity. Retain only descriptions without a competing weight claim.
  return /[-+]?\d+(?:\.\d+)?\s*(?:kg|kilograms?|g|grams?)\b/i.test(description) ? '' : description;
}

export function withFoodGrams(food, value) {
  // An empty input is allowed while typing, but cannot be applied.
  const raw = Number(value);
  const grams = value === '' ? '' : Number.isFinite(raw) ? Math.max(0, raw) : '';
  const per = food.per_100g || {};
  const k = (Number(grams) || 0) / 100;
  const portion = food.portion ? { ...food.portion,
    quantity: grams === '' ? '' : +(Number(grams) / Number(food.portion.grams_per_unit)).toFixed(3) } : null;
  const changed = grams === '' || (food.grams != null && Number(food.grams) !== grams);
  const description = portion ? '' : quantityDescription(food);
  const caption = grams === '' ? '' : portion && Number.isFinite(portion.quantity) && portion.unit
    ? `${portion.quantity} ${portion.unit} · ${grams} g`
    : [description, `${grams} g`].filter(Boolean).join(' · ');
  return { ...food, grams,
    ...(portion ? { portion } : {}),
    ...(changed ? { qty_text: caption, qty_description: description } : {}),
    macros: {
    cal: Math.round((Number(per.calories) || 0) * k),
    pro: +((Number(per.protein) || 0) * k).toFixed(1),
    carb: +(carbsOf(per) * k).toFixed(1),
    fat: +((Number(per.fat) || 0) * k).toFixed(1),
  } };
}

export function foodReviewError(foods = []) {
  const invalid = foods.find(f => f.on && (
    !String(f.name || '').trim() || !Number.isFinite(Number(f.grams)) ||
    Number(f.grams) <= 0 || Number(f.grams) > 5000 ||
    (f.portion && (!Number.isFinite(Number(f.portion.quantity)) || Number(f.portion.quantity) <= 0 ||
      Number(f.portion.quantity) > 100 || !Number.isFinite(Number(f.portion.grams_per_unit)) ||
      Number(f.portion.grams_per_unit) <= 0 || Number(f.portion.grams_per_unit) > 5000))
  ));
  return invalid ? 'Enter a quantity above 0 g and no more than 5000 g, with up to 100 portions, or untick the item.' : '';
}

export function reviewTotals(foods = []) {
  const totals = { cal: 0, pro: 0, carb: 0, fat: 0 };
  foods.filter(f => f.on).forEach(f => {
    for (const key of Object.keys(totals)) totals[key] += Number(f.macros?.[key]) || 0;
  });
  return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, k === 'cal' ? Math.round(v) : +v.toFixed(1)]));
}
