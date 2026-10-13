/** A named food without a usable portion must remain visible for review.
 * This validates provider output; it cannot discover an item the provider
 * omitted from both foods and unresolved_foods. No quantities are invented. */
const label = (value, max) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const identity = row => `${row.name.toLowerCase()}\u0000${(row.meal || '').toLowerCase()}`;

/** Match the daily log and editable review: net carbs when available, total
 * otherwise. Keep stored calories; editing grams must not recalculate energy
 * from macros or change the food's nutrition snapshot. */
function foodPreviewMacros(food) {
  const per = food.per_100g || {}, factor = food.grams / 100;
  return {
    cal: Math.round((per.calories || 0) * factor),
    pro: +((per.protein || 0) * factor).toFixed(1),
    carb: +(((per.net_carbs != null ? per.net_carbs : per.total_carbs) || 0) * factor).toFixed(1),
    fat: +((per.fat || 0) * factor).toFixed(1),
  };
}

function normaliseFoodReview(rawFoods, rawUnresolved) {
  const foods = [], unresolvedFoods = [], seen = new Set();
  const addUnresolved = row => {
    const name = label(row?.name, 100), meal = label(row?.meal, 40) || null;
    if (!name || unresolvedFoods.length >= 10) return;
    const item = { name, meal, reason: 'quantity_needed' }, key = identity(item);
    if (!seen.has(key)) { seen.add(key); unresolvedFoods.push(item); }
  };
  for (const row of (Array.isArray(rawFoods) ? rawFoods : []).slice(0, 100)) {
    const name = label(row?.name, 100);
    if (!name) continue;
    const quantity = typeof row.grams === 'number' || typeof row.grams === 'string' ? parseFloat(row.grams) : NaN;
    const grams = Math.min(5000, Math.round(quantity));
    if (!Number.isFinite(quantity) || quantity <= 0 || grams < 1) { addUnresolved(row); continue; }
    if (foods.length >= 25) continue;
    foods.push({ name, qty_text: label(row.qty_text, 60), grams,
      meal: label(row.meal, 40) || null,
      category: label(row.category, 40).toLowerCase() || null, per_100g: row.per_100g || {} });
  }
  for (const row of (Array.isArray(rawUnresolved) ? rawUnresolved : []).slice(0, 100)) addUnresolved(row);
  return { foods, unresolvedFoods };
}

/** Client preview context is a bounded hint, never saved state or instructions. */
function sanitiseFoodClarification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const unresolved = [], reviewedFoods = [], seen = new Set();
  for (const row of (Array.isArray(value.unresolved) ? value.unresolved : []).slice(0, 10)) {
    const name = label(row?.name, 100), meal = label(row?.meal, 40) || null;
    if (!name) continue;
    const item = { name, meal }, key = identity(item);
    if (!seen.has(key)) { seen.add(key); unresolved.push(item); }
  }
  if (!unresolved.length) return null;
  for (const row of (Array.isArray(value.reviewedFoods) ? value.reviewedFoods : []).slice(0, 20)) {
    const name = label(row?.name, 100), meal = label(row?.meal, 40) || null;
    const grams = typeof row?.grams === 'number' || typeof row?.grams === 'string' ? Number(row.grams) : NaN;
    if (name && Number.isFinite(grams) && grams > 0 && grams <= 5000) reviewedFoods.push({ name, grams, meal });
  }
  return { unresolved, reviewedFoods };
}

module.exports = { normaliseFoodReview, sanitiseFoodClarification, foodPreviewMacros };
