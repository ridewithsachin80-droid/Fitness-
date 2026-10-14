import { nextRequestId } from './aiRequestRecovery';
import { withFoodGrams, foodReviewError, reviewTotals } from './aiFoodReview';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const rows = value => Array.isArray(value) ? value : [];
const serial = value => JSON.stringify(value);
const revision = card => Number.isSafeInteger(card?.draftRevision) && card.draftRevision >= 0 ? card.draftRevision : 0;
const body = card => { const { draftRevision, ...rest } = card; return serial(rest); };
const slots = values => {
  const allowed = [...new Set(rows(values).filter(value => typeof value === 'string' && value.trim() && value.length <= 40))];
  return allowed.length ? allowed : ['Meal 1'];
};
const sameTarget = (a, b) => !!a && !!b && a.reviewId === b.reviewId && a.foodId === b.foodId;
const eligibleCard = (card, day) => card?.role === 'ai' && card.logDate === day && object(card.parsed)
  && !card.applied && !card.undone && !card.saveReceipt && !card.error && !card.failedRequest && !card.pending
  && !card.editing && !card.queued && !card.logSaveFailed && !card.workoutSaveFailed && !card.labSaveUnconfirmed;
const eligibleFood = food => object(food) && food.on === true && typeof food.name === 'string' && !!food.name.trim()
  && (typeof food.grams === 'number' || typeof food.grams === 'string') && Number.isFinite(Number(food.grams))
  && Number(food.grams) > 0 && Number(food.grams) <= 5000 && !foodReviewError([food]);

// UI eligibility is independent of the provider's bounded context. A later
// row must remain selectable; selection brings it into the next wire snapshot.
export const isDraftFoodEditable = (card, food, day) => eligibleCard(card, day)
  && validId(card.draftReviewId) && eligibleFood(food) && validId(food.draftFoodId);

/** Local identities are independent of saved-food IDs and save receipts.
 * The store passes its previous messages so even edit-then-restore invalidates
 * a pending response. Unrelated appended messages do not change a review. */
export function ensureDraftFoodIds(messages, previousMessages = []) {
  if (!Array.isArray(messages)) return messages;
  const previous = new Map(rows(previousMessages).filter(card => validId(card?.draftReviewId))
    .map(card => [card.draftReviewId, card]));
  const reviewIds = new Set(), foodIds = new Set();
  let changed = false;
  const result = messages.map(card => {
    if (card?.role !== 'ai' || !rows(card.parsed?.foods).some(object)) return card;
    const oldId = card.draftReviewId;
    const draftReviewId = validId(oldId) && !reviewIds.has(oldId) ? oldId : `review-${nextRequestId()}`;
    reviewIds.add(draftReviewId);
    let foodChanged = false;
    const foods = card.parsed.foods.map(food => {
      if (!object(food)) return food;
      const oldFoodId = food.draftFoodId;
      const draftFoodId = validId(oldFoodId) && !foodIds.has(oldFoodId) ? oldFoodId : `food-${nextRequestId()}`;
      foodIds.add(draftFoodId);
      if (draftFoodId === oldFoodId) return food;
      foodChanged = true;
      return { ...food, draftFoodId };
    });
    let next = foodChanged || draftReviewId !== oldId
      ? { ...card, draftReviewId, parsed: foodChanged ? { ...card.parsed, foods } : card.parsed } : card;
    const before = previous.get(draftReviewId);
    const draftRevision = before ? revision(before) + Number(body(before) !== body(next))
      : validId(oldId) ? revision(card) : 0;
    if (next.draftRevision !== draftRevision) next = { ...next, draftRevision };
    if (next !== card) changed = true;
    return next;
  });
  return changed ? result : messages;
}

function eligibleRows(messages, day) {
  const result = [];
  for (const card of rows(messages)) {
    for (const food of rows(card?.parsed?.foods)) if (isDraftFoodEditable(card, food, day)) {
      result.push({ card, food, reviewId: card.draftReviewId, foodId: food.draftFoodId });
    }
  }
  return result;
}

/** Only bounded names/quantities/meals go to the provider. The complete local
 * snapshot stays on the request, never in API context or persistent storage. */
export function buildDraftFoodContext(messages, day, selectedTarget = null, mealSlots = [], autoSlot = null) {
  const candidates = eligibleRows(messages, day), allowedMeals = slots(mealSlots);
  const selected = selectedTarget == null ? null : candidates.filter(row => sameTarget(row, selectedTarget));
  if (selected && selected.length !== 1) return { context: null, snapshot: null, reason: 'target_unavailable' };
  if (!candidates.length) return { context: null, snapshot: null, reason: null };
  const target = selected ? { reviewId: selected[0].reviewId, foodId: selected[0].foodId } : null;
  const visible = (selected ? [selected[0], ...candidates.filter(row => !sameTarget(row, target))] : candidates).slice(0, 25);
  const foods = visible.map(({ card, food, reviewId, foodId }) => ({ reviewId, foodId,
    name: food.name.trim().slice(0, 100), grams: Number(food.grams),
    meal: allowedMeals.includes(food.meal) ? food.meal : allowedMeals.includes(autoSlot) ? autoSlot : null }));
  const reviews = Object.fromEntries(visible.map(row => [row.reviewId, serial(row.card)]));
  const snapshot = { day, target, eligibleCount: candidates.length, foods: foods.map(row => ({ ...row })),
    meals: [...allowedMeals], reviews };
  return { context: { foods, target: target ? { ...target } : null }, snapshot, reason: null };
}

/** Apply one provider-proposed edit to one unchanged unsaved review. No log,
 * API, receipt, inclusion or nutrition mutation occurs in this function. */
export function applyDraftFoodEdit(messages, reply, snapshot, { day, mealSlots = [], applying = false } = {}) {
  const reject = reason => ({ messages, applied: false, reason });
  if (applying) return reject('busy');
  if (!snapshot || !day || snapshot.day !== day) return reject('expired');
  if (!object(reply)) return reject('invalid_edit');
  if (reply.status === 'clarify') return reject(reply.reason === 'choose_food' ? 'choose_food' : 'invalid_edit');
  if (reply.status !== 'edit' || Object.keys(reply).some(key => !['status', 'reviewId', 'foodId', 'grams', 'meal'].includes(key))
    || !validId(reply.reviewId) || !validId(reply.foodId)) return reject('invalid_edit');
  if (!snapshot.target && snapshot.eligibleCount !== 1) return reject('choose_food');
  const target = snapshot.target || snapshot.foods?.[0];
  if (!sameTarget(reply, target)) return reject('invalid_edit');
  const proposed = rows(snapshot.foods).filter(row => sameTarget(row, target));
  if (proposed.length !== 1) return reject('invalid_edit');
  const candidates = eligibleRows(messages, day);
  if (!snapshot.target && candidates.length !== 1) return reject('review_changed');
  const matching = candidates.filter(row => sameTarget(row, target));
  if (matching.length !== 1) return reject('target_unavailable');
  const { card, food } = matching[0];
  if (serial(card) !== snapshot.reviews?.[target.reviewId]) return reject('review_changed');
  const allowedMeals = slots(mealSlots);
  if (serial(allowedMeals) !== serial(snapshot.meals)) return reject('review_changed');
  const hasGrams = owns(reply, 'grams'), hasMeal = owns(reply, 'meal');
  if (!hasGrams && !hasMeal) return reject('invalid_edit');
  if (hasGrams && (typeof reply.grams !== 'number' || !Number.isFinite(reply.grams) || reply.grams <= 0 || reply.grams > 5000)) return reject('invalid_edit');
  if (hasMeal && (typeof reply.meal !== 'string' || !allowedMeals.includes(reply.meal))) return reject('invalid_edit');
  let updated = hasGrams ? { ...withFoodGrams(food, reply.grams), qty_text: `${reply.grams} g` } : food;
  if (hasMeal) updated = { ...updated, meal: reply.meal };
  if (foodReviewError([updated])) return reject('invalid_edit');
  if ((!hasGrams || Number(food.grams) === reply.grams) && (!hasMeal || food.meal === reply.meal)) return reject('no_change');
  const foods = card.parsed.foods.map(row => row === food ? updated : row);
  const next = messages.map(row => row === card ? { ...row,
    parsed: { ...row.parsed, foods, totals: reviewTotals(foods) } } : row);
  return { messages: ensureDraftFoodIds(next, messages), applied: true, reason: 'updated',
    target: { reviewId: target.reviewId, foodId: target.foodId } };
}
