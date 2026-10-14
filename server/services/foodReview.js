/** A named food without a usable portion must remain visible for review.
 * This validates provider output; it cannot discover an item the provider
 * omitted from both foods and unresolved_foods. No quantities are invented. */
const label = (value, max) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const identity = row => `${row.name.toLowerCase()}\u0000${(row.meal || '').toLowerCase()}`;

/** A model can read "rice - 50 g" as a label separator and silently drop
 * the sign. Hold the whole entry for clarification before asking the model.
 * This is a narrow mass/volume syntax check, not food-name interpretation.
 * Ordinary line-start "- 50 g rice" bullets and positive numeric ranges keep
 * their usual meaning; no text-only rule can disambiguate every use of '-'. */
function needsPositiveAmountClarification(message) {
  if (typeof message !== 'string') return false;
  const text = message.slice(0, 1200);
  const number = String.raw`(?:\d+(?:[,.]\d+)*|\.\d+)(?:e[+-]?\d+)?`;
  const unit = String.raw`(?:kilograms?|kgs?|grams?|g|millilit(?:er|re)s?|ml|lit(?:er|re)s?|l)`;
  const horizontal = String.raw`[^\S\r\n]`;
  const signed = new RegExp(String.raw`([-\u2212])(${horizontal}*)${number}${horizontal}*${unit}\b`, 'gi');
  const rangeStart = new RegExp(String.raw`${number}(?:${horizontal}*${unit})?${horizontal}*$`, 'i');
  const exponentStart = /(?:^|[^\w.])(?:\d+(?:[,.]\d+)*|\.\d+)e$/i;
  if (new RegExp(String.raw`\b(?:negative|minus)${horizontal}+${number}${horizontal}*${unit}\b`, 'i').test(text)) return true;
  for (const match of text.matchAll(signed)) {
    const left = text.slice(0, match.index);
    // A mathematical minus is a sign, not a bullet or range delimiter.
    if (match[1] === '\u2212') return true;
    // The exponent in a positive quantity such as 1000e-1g is not a sign
    // on the quantity. A negative mantissa is matched from its first sign.
    if (!match[2] && exponentStart.test(left)) continue;
    const lower = left.match(rangeStart);
    if (lower && (lower.index === 0 || /[\s(:,;]$/.test(left.slice(0, lower.index)))
        && !/[-\u2212][^\S\r\n]*$/.test(left.slice(0, lower.index))) continue;
    // Only a spaced ASCII dash at the beginning of a content-bearing list
    // line gets bullet precedence. "-50 g" and a bare "- 50 g" still clarify.
    const linePrefix = left.slice(left.lastIndexOf('\n') + 1);
    const lineSuffix = text.slice(match.index + match[0].length).split(/\r?\n/, 1)[0];
    if (match[2] && /^[^\S\r\n]*$/.test(linePrefix) && /^[^\S\r\n]+\p{L}/u.test(lineSuffix)) continue;
    return true;
  }
  return false;
}

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

module.exports = { normaliseFoodReview, sanitiseFoodClarification, foodPreviewMacros, needsPositiveAmountClarification };
