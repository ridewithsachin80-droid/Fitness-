/** Unsaved food edits are local review proposals, never saved-log operations.
 * Client IDs identify the selected snapshot; they are not database IDs. */
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const text = value => typeof value === 'string' && value.trim() && value.length <= 100
  && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : null;
const pair = value => JSON.stringify([value.reviewId, value.foodId]);
const amount = value => (typeof value === 'number' || typeof value === 'string')
  && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 5000;
const allowedMeals = mealSlots => {
  const meals = (Array.isArray(mealSlots) ? mealSlots : []).filter(slot => text(slot));
  return meals.length ? meals : ['Meal 1'];
};

/** Reject malformed snapshots as a whole. Dropping a bad row could turn an
 * ambiguous multi-food request into an apparently safe single-food target. */
function sanitiseDraftFoods(value, mealSlots = []) {
  if (!object(value) || !only(value, ['foods', 'target']) || !Array.isArray(value.foods)
      || !value.foods.length || value.foods.length > 25) return null;
  const meals = new Set(allowedMeals(mealSlots)), seen = new Set(), foods = [];
  for (const row of value.foods) {
    if (!object(row) || !only(row, ['reviewId', 'foodId', 'name', 'grams', 'meal'])) return null;
    const reviewId = id(row.reviewId), foodId = id(row.foodId), name = text(row.name);
    if (!reviewId || !foodId || !name || !amount(row.grams)) return null;
    const meal = row.meal == null ? null : text(row.meal);
    if (row.meal != null && (!meal || !meals.has(meal))) return null;
    const food = { reviewId, foodId, name, grams: Number(row.grams), meal }, key = pair(food);
    if (seen.has(key)) return null;
    seen.add(key); foods.push(food);
  }
  let target = null;
  if (value.target != null) {
    if (!object(value.target) || !only(value.target, ['reviewId', 'foodId'])) return null;
    const reviewId = id(value.target.reviewId), foodId = id(value.target.foodId);
    if (!reviewId || !foodId || !seen.has(pair({ reviewId, foodId }))) return null;
    target = { reviewId, foodId };
  }
  return { foods, target };
}

function resolveDraftFoodEdit(raw, snapshot, mealSlots = []) {
  const invalid = () => ({ status: 'clarify', reason: 'invalid_edit' });
  if (!snapshot?.foods?.length) return invalid();
  if (!snapshot.target && snapshot.foods.length > 1) return { status: 'clarify', reason: 'choose_food' };
  const target = snapshot.target || snapshot.foods[0];
  if (!object(raw) || !only(raw, ['reviewId', 'foodId', 'grams', 'meal'])
      || id(raw.reviewId) !== target.reviewId || id(raw.foodId) !== target.foodId) return invalid();
  const hasGrams = Object.hasOwn(raw, 'grams'), hasMeal = Object.hasOwn(raw, 'meal');
  if (!hasGrams && !hasMeal) return invalid();
  if (hasGrams && !amount(raw.grams)) return invalid();
  const meal = hasMeal ? text(raw.meal) : null;
  if (hasMeal && (!meal || !allowedMeals(mealSlots).includes(meal))) return invalid();
  return { status: 'edit', reviewId: target.reviewId, foodId: target.foodId,
    ...(hasGrams ? { grams: Number(raw.grams) } : {}), ...(hasMeal ? { meal } : {}) };
}

function draftEditReply(edit) {
  if (edit.status === 'edit') return 'Review this change before saving. Nothing has been saved.';
  return edit.reason === 'choose_food'
    ? 'Choose the food to change using Edit with AI on its review. Nothing has been saved.'
    : 'I could not match a valid quantity or meal change to that review. Choose the food with Edit with AI and try again. Nothing has been saved.';
}

module.exports = { sanitiseDraftFoods, resolveDraftFoodEdit, draftEditReply };
