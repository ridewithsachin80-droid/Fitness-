/** Exercise real bundled client draft edits; no provider, DB or member writes. */
const { importClient } = require('./lib/client-bundle');
const { ensureDraftFoodIds, buildDraftFoodContext, applyDraftFoodEdit } = importClient('utils/aiDraftFoodEdits.js');
const { withFoodGrams, reviewTotals } = importClient('utils/aiFoodReview.js');
let passed = 0, failed = 0;
const check = (name, okay) => { console.log(`  ${okay ? '✓' : '✗'} ${name}`); okay ? passed++ : failed++; };
const day = '2026-10-13', mealSlots = ['Breakfast', 'Lunch', 'Dinner'];
const food = (name = 'Sambar', grams = 200, extra = {}) => withFoodGrams({ name, on: true, meal: 'Breakfast',
  qty_text: 'Estimated: 1 bowl', ai_grams: grams, food_id: 77, source: 'member', label: true,
  per_100g: { calories: 46, protein: 2.5, total_carbs: 7.5, net_carbs: 5.5, fiber: 2, fat: 1.2 }, ...extra }, grams);
const review = (foods = [food()], extra = {}) => ({ role: 'ai', logDate: day, applied: false, evalSource: 'photo',
  evalMessage: null, parsed: { foods, totals: reviewTotals(foods), notes: 'Keep this note', notesOn: true,
    activities: [{ id: 'walk', on: true }], water_ml_add: 500, waterOn: true, unresolved_foods: [{ name: 'Chutney', reason: 'quantity_needed' }] }, ...extra });
const prepare = (cards = [review()], target = null) => {
  const messages = ensureDraftFoodIds(cards);
  const { context, snapshot } = buildDraftFoodContext(messages, day, target, mealSlots, 'Breakfast');
  return { messages, context, snapshot };
};
const edit = (p, patch = {}) => ({ status: 'edit', reviewId: p.context.foods[0].reviewId, foodId: p.context.foods[0].foodId, grams: 300, ...patch });
const apply = (p, reply = edit(p), messages = p.messages, opts = {}) => applyDraftFoodEdit(messages, reply, p.snapshot, { day, mealSlots, ...opts });
const identity = row => ({ reviewId: row.draftReviewId, foodId: row.parsed.foods[0].draftFoodId });

const p = prepare(), original = JSON.stringify(p.messages);
check('stable IDs are assigned to photo review and each food', !!p.messages[0].draftReviewId && !!p.messages[0].parsed.foods[0].draftFoodId);
check('repeated identity assignment preserves entire messages reference', ensureDraftFoodIds(p.messages, p.messages) === p.messages);
const appended = [...p.messages, { role: 'user', text: 'hello' }];
check('unrelated append preserves review identity and revision', ensureDraftFoodIds(appended, p.messages)[0] === p.messages[0]);
const changed = apply(p);
check('single eligible photo food is changed in its original review', changed.applied && changed.messages.length === 1 && changed.messages[0].parsed.foods[0].grams === 300);
check('source message remains immutable', JSON.stringify(p.messages) === original);
check('IDs survive draft edit and revision increases once', changed.messages[0].draftReviewId === p.messages[0].draftReviewId && changed.messages[0].parsed.foods[0].draftFoodId === p.messages[0].parsed.foods[0].draftFoodId && changed.messages[0].draftRevision === 1);
check('store identity pass does not double increment an already applied edit', ensureDraftFoodIds(changed.messages, p.messages)[0].draftRevision === 1);
const updated = changed.messages[0].parsed.foods[0];
check('custom nutrition and provenance survive quantity edit', JSON.stringify(updated.per_100g) === JSON.stringify(p.messages[0].parsed.foods[0].per_100g) && updated.source === 'member' && updated.label && updated.food_id === 77 && updated.ai_grams === 200 && updated.on);
check('quantity label and net-carb macros match the edited grams', updated.qty_text === '300 g' && updated.macros.cal === 138 && updated.macros.carb === 16.5);
check('food totals are recomputed without changing other log proposals', changed.messages[0].parsed.totals.cal === 138 && changed.messages[0].parsed.notes === 'Keep this note' && changed.messages[0].parsed.water_ml_add === 500 && changed.messages[0].parsed.activities === p.messages[0].parsed.activities && changed.messages[0].parsed.unresolved_foods === p.messages[0].parsed.unresolved_foods);
check('draft edit creates no save receipt or applied status', !changed.messages[0].saveReceipt && changed.messages[0].applied === false);
const mealReply = edit(p, { meal: 'Dinner' }); delete mealReply.grams;
const mealOnly = apply(p, mealReply);
check('meal-only edit preserves quantity, nutrition, label and macros', mealOnly.applied && mealOnly.messages[0].parsed.foods[0].meal === 'Dinner' && mealOnly.messages[0].parsed.foods[0].grams === 200 && mealOnly.messages[0].parsed.foods[0].qty_text === 'Estimated: 1 bowl' && mealOnly.messages[0].parsed.foods[0].macros === p.messages[0].parsed.foods[0].macros);
for (const grams of [0, -50, 5001, NaN, Infinity, '300', '', null, true]) check(`invalid grams ${String(grams)} do not change review`, !apply(p, edit(p, { grams })).applied);
for (const meal of ['', null, 'Supper', 'dinner']) check(`unconfigured meal ${String(meal)} is rejected`, !apply(p, edit(p, { meal })).applied);
check('unknown reply fields cannot replace nutrition', apply(p, edit(p, { per_100g: { calories: 1 } })).reason === 'invalid_edit');
check('unknown food ID cannot target by name or position', apply(p, edit(p, { foodId: 'invented' })).reason === 'invalid_edit');
check('wrong review ID is rejected', apply(p, edit(p, { reviewId: 'invented' })).reason === 'invalid_edit');
check('empty edit is rejected', apply(p, { status: 'edit', ...identity(p.messages[0]) }).reason === 'invalid_edit');
check('no-op quantity edit does not silently rewrite quantity label', apply(p, edit(p, { grams: 200 })).reason === 'no_change');
check('provider clarification leaves original reference unchanged', apply(p, { status: 'clarify', reason: 'choose_food' }).messages === p.messages);
check('wrong day expires edit', apply(p, edit(p), p.messages, { day: '2026-10-14' }).reason === 'expired');
check('running save prevents edits', apply(p, edit(p), p.messages, { applying: true }).reason === 'busy');
check('changed configured meals invalidate captured context', apply(p, edit(p), p.messages, { mealSlots: ['Breakfast', 'Dinner'] }).reason === 'review_changed');
for (const patch of [{ applied: true }, { undone: true }, { saveReceipt: { running: true } }, { saveReceipt: { daily: { state: 'queued' } } }, { saveReceipt: { rolledBack: true }, editing: true }, { error: true }, { queued: true }, { pending: true }]) {
  const blocked = [{ ...p.messages[0], ...patch }];
  check(`lifecycle change ${Object.keys(patch).join(',')} prevents response mutation`, !apply(p, edit(p), blocked).applied);
  check(`lifecycle ${Object.keys(patch).join(',')} excluded from future context`, buildDraftFoodContext(blocked, day, null, mealSlots).context === null);
}
const manual = ensureDraftFoodIds([{ ...p.messages[0], parsed: { ...p.messages[0].parsed, foods: [food('Sambar', 250, { draftFoodId: p.messages[0].parsed.foods[0].draftFoodId })] } }], p.messages);
check('manual quantity edit invalidates pending AI edit', apply(p, edit(p), manual).reason === 'review_changed');
const restored = ensureDraftFoodIds([{ ...p.messages[0] }], manual);
check('edit-then-restore still invalidates pending AI edit via revision', restored[0].draftRevision === 2 && apply(p, edit(p), restored).reason === 'review_changed');
const changedNotes = [{ ...p.messages[0], parsed: { ...p.messages[0].parsed, notes: 'new note' } }];
check('any target-review manual change is protected even before revision assignment', apply(p, edit(p), changedNotes).reason === 'review_changed');
const multiple = prepare([review([food('Rice'), food('Rice', 100, { meal: 'Dinner' })])]);
check('duplicate names without explicit selection must clarify', apply(multiple).reason === 'choose_food');
const chosen = { reviewId: multiple.messages[0].draftReviewId, foodId: multiple.messages[0].parsed.foods[1].draftFoodId };
const selected = { ...multiple, ...buildDraftFoodContext(multiple.messages, day, chosen, mealSlots, 'Breakfast') };
const selectedResult = apply(selected);
check('explicit stable target edits only the chosen duplicate-name row', selectedResult.applied && selectedResult.messages[0].parsed.foods[0].grams === 200 && selectedResult.messages[0].parsed.foods[1].grams === 300);
check('selection cannot be redirected to another valid row', apply(selected, edit(selected, { foodId: multiple.messages[0].parsed.foods[0].draftFoodId })).reason === 'invalid_edit');
const moreCards = ensureDraftFoodIds([...p.messages, review([food('Idli')])], p.messages);
check('new ambiguity while request pending blocks implicit target', apply(p, edit(p), moreCards).reason === 'review_changed');
const unavailable = buildDraftFoodContext(p.messages, day, { reviewId: 'missing', foodId: 'missing' }, mealSlots);
check('stale explicit target never falls back to implicit selection', unavailable.context === null && unavailable.reason === 'target_unavailable');
for (const item of [food('Rice', 0), food('Rice', 5001), food('Rice', 100, { on: false }), food(' ', 100)]) {
  check('invalid or excluded food is omitted from target context', prepare([review([item])]).context === null);
}
const crowded = prepare(Array.from({ length: 30 }, (_, i) => review([food(`Food ${i}`)])));
const last = identity(crowded.messages[29]);
const crowdedSelected = buildDraftFoodContext(crowded.messages, day, last, mealSlots);
check('context is bounded to25 while keeping explicitly selected distant review', crowdedSelected.context.foods.length === 25 && crowdedSelected.context.foods[0].reviewId === last.reviewId && crowdedSelected.snapshot.eligibleCount === 30);
check('wire context excludes nutrition, notes, receipts and full local snapshots', crowdedSelected.context.foods.every(row => Object.keys(row).sort().join() === 'foodId,grams,meal,name,reviewId') && !('reviews' in crowdedSelected.context));
const cloned = ensureDraftFoodIds([...p.messages, { ...p.messages[0] }], p.messages);
check('duplicate card and row identities are repaired once', cloned[0].draftReviewId !== cloned[1].draftReviewId && cloned[0].parsed.foods[0].draftFoodId !== cloned[1].parsed.foods[0].draftFoodId && ensureDraftFoodIds(cloned, cloned) === cloned);
const portioned = prepare([review([food('Spice', 20, { portion: { unit: 'pinch', quantity: 20, grams_per_unit: 1 } })])]);
check('quantity edit cannot bypass existing household-portion maximum', !apply(portioned, edit(portioned, { grams: 101 })).applied);
const fallback = prepare();
const fallbackContext = buildDraftFoodContext(fallback.messages, day, null, [], 'Meal 1');
check('empty configured meals use the same Meal1 fallback as the review', fallbackContext.context.foods[0].meal === 'Meal 1' && applyDraftFoodEdit(fallback.messages, { ...edit(fallback), meal: 'Meal 1' }, fallbackContext.snapshot, { day, mealSlots: [] }).applied);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
