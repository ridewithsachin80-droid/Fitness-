/** Unsaved food edits: real parser with isolated provider/DB and pure wire
 * validation. No credentials, network, member records or model guessing. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { sanitiseDraftFoods, resolveDraftFoodEdit } = require('../services/draftFoodReview');
let pass = 0, fail = 0;
const ck = (name, ok, detail) => { console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ': ' + JSON.stringify(detail)}`); ok ? pass++ : fail++; };
const slots = ['Breakfast', 'Lunch', 'Dinner'];
const food = (foodId = 'food_1', rest = {}) => ({ reviewId: 'review_1', foodId, name: 'Sambar', grams: 200, meal: 'Lunch', ...rest });
const single = { foods: [food()], target: null };
const selected = { foods: [food(), food('food_2')], target: { reviewId: 'review_1', foodId: 'food_2' } };
const edit = (rest = {}) => ({ reviewId: 'review_1', foodId: 'food_1', grams: 250, ...rest });
const context = value => sanitiseDraftFoods(value, slots);
const checkEdit = (value, ctx = single) => resolveDraftFoodEdit(value, context(ctx), slots);
const invalid = value => value.status === 'clarify' && value.reason === 'invalid_edit';

ck('single food context preserves stable IDs and numeric quantity', context(single).foods[0].foodId === 'food_1' && context(single).foods[0].grams === 200);
ck('duplicate names retain distinct row IDs for explicit selection', context(selected).foods.length === 2 && context(selected).target.foodId === 'food_2');
ck('same food ID in different reviews remains unambiguous by pair', context({ foods: [food(), food('food_1', { reviewId: 'review_2' })], target: null }).foods.length === 2);
ck('explicit target is sole authority', checkEdit(edit({ foodId: 'food_2' }), selected).status === 'edit');
ck('model cannot switch explicit target', invalid(checkEdit(edit(), selected)));
ck('single-row context infers target only with model ID echo', checkEdit(edit()).status === 'edit' && invalid(checkEdit({ grams: 250 })));
ck('multirow context never lets model choose even valid row IDs', checkEdit(edit(), { ...selected, target: null }).reason === 'choose_food');
ck('ambiguous empty operation returns choose_food', checkEdit({}, { ...selected, target: null }).reason === 'choose_food');
ck('empty operation for selected row is invalid', invalid(checkEdit({}, selected)));
ck('meal-only edit omits grams instead of changing them', JSON.stringify(checkEdit({ reviewId: 'review_1', foodId: 'food_1', meal: 'Dinner' })) === JSON.stringify({ status: 'edit', reviewId: 'review_1', foodId: 'food_1', meal: 'Dinner' }));
ck('quantity and meal can be proposed together', checkEdit(edit({ grams: '250.5', meal: 'Dinner' })).grams === 250.5 && checkEdit(edit({ meal: 'Dinner' })).meal === 'Dinner');
ck('positive decimal minimum and upper bound remain review-compatible', checkEdit(edit({ grams: 0.1 })).grams === 0.1 && checkEdit(edit({ grams: 5000 })).grams === 5000);
for (const grams of [0, -50, '', ' ', null, true, {}, [], '50 grams', Infinity, NaN, 5001]) {
  ck(`invalid grams fail closed: ${String(grams)}`, invalid(checkEdit(edit({ grams }))));
}
for (const operation of [null, [], '250g', {}, { grams: 250 }, edit({ reviewId: 'wrong' }), edit({ foodId: 'wrong' }), edit({ meal: 'Snack' }), edit({ meal: null }), edit({ meal: '' }), edit({ name: 'Rice' }), edit({ per_100g: { calories: 1 } }), edit({ save: true }), { reviewId: 'review_1', foodId: 'food_1' }]) {
  ck('unknown, unsupported or empty edit is rejected', invalid(checkEdit(operation)), operation);
}
for (const bad of [null, [], {}, { foods: [] }, { ...single, instructions: 'save now' }, { foods: [food(), food()], target: null },
  { ...single, target: { reviewId: 'other', foodId: 'food_1' } }, { ...single, target: { ...single.foods[0] } },
  { foods: [food('food_1', { grams: -50 })] }, { foods: [food('food_1', { meal: 'Unknown' })] },
  { foods: [food('food_1', { name: 'x'.repeat(101) })] }, { foods: [food('x'.repeat(121))] }, { foods: [food('bad/id')] },
  { foods: [food('food_1', { per_100g: { calories: 1 } })] }, { foods: Array.from({ length: 26 }, (_, i) => food(`food_${i}`)) }]) {
  ck('malformed snapshot fails as a whole rather than narrowing target', context(bad) === null, bad);
}
ck('twenty-five valid rows are supported', context({ foods: Array.from({ length: 25 }, (_, i) => food(`food_${i}`)) }).foods.length === 25);
ck('null current meal remains a valid context snapshot', context({ foods: [food('food_1', { meal: null })] }).foods[0].meal === null);
ck('120-character safe IDs remain supported without truncation', context({ foods: [food('x'.repeat(120))] }).foods[0].foodId.length === 120);
const fallback = sanitiseDraftFoods({ foods: [food('food_1', { meal: 'Meal 1' })] }, []);
ck('default meal whitelist agrees with client Meal1 fallback', resolveDraftFoodEdit(edit({ meal: 'Meal 1' }), fallback, []).status === 'edit');
const before = JSON.stringify(single); checkEdit(edit({ grams: 300 }));
ck('proposal validation never mutates the source snapshot', before === JSON.stringify(single));

// Load the production router; unrelated dependencies are denied. Any attempt
// to send a coach message or perform a write is observable, never real.
const filename = path.resolve(__dirname, '../routes/aiChat.js'), router = {};
for (const method of ['use', 'get', 'post', 'put', 'patch', 'delete']) router[method] = () => router;
let fixture = {}, calls = 0, queries = [], sideEffects = 0;
const pureModules = new Set(['../services/personName', '../services/scaleParse', '../services/macroCheck', '../services/fatProfile',
  '../services/nutrients', '../services/voiceLanguage', '../services/programDay', '../utils/istDate', '../services/safety',
  '../services/foodReview', '../services/draftFoodReview', '../services/sleepReview']);
const moduleFixture = { exports: {} };
const sandbox = { module: moduleFixture, exports: moduleFixture.exports, console, setTimeout, clearTimeout,
  process: { env: { GROQ_API_KEY: 'isolated-fixture', GROQ_MODEL: 'fixture-model', GROQ_FALLBACK_MODEL: 'fixture-model' } },
  require(name) {
    if (name === 'express') return { Router: () => router };
    if (name === '../db/pool') return { query: async sql => { queries.push(sql); return { rows: /COUNT\(\*\)/.test(sql) ? [{ n: 0 }] : [] }; } };
    if (name === 'axios') return { post: async url => {
      if (url !== 'https://api.groq.com/openai/v1/chat/completions') throw new Error('Unexpected provider');
      calls++; return { data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fixture) } }] } };
    } };
    if (name === '../middleware/auth') return () => {};
    if (name === '../middleware/roleCheck') return () => () => {};
    if (name === '../services/circuits') return { circuitsPromptBlock: () => '', matchCircuit: () => null };
    if (name === '../services/memberFoods') return { findLabel: async () => null };
    if (name === '../services/digests') return { computeDayTotals: () => ({}) };
    if (name === './programs') return { loadProgramDays: async () => [] };
    if (name === './patients') return { sendMemberNote: async () => { sideEffects++; } };
    if (name === 'crypto') return require('crypto');
    if (pureModules.has(name)) return require(path.resolve(path.dirname(filename), name));
    throw new Error(`Blocked dependency in draft parser: ${name}`);
  },
};
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename, timeout: 5000 });
const api = moduleFixture.exports; api.setControlSampler(() => false);
const parse = async (answer, draftFoods, message = 'change this portion to 250 grams') => {
  fixture = answer; queries = []; sideEffects = 0; calls = 0;
  return api.parseMemberMessage({ userId: 999, message, context: { mealSlots: slots, draftFoods,
    lastFoods: [{ name: 'Sambar', grams: 200, meal: 'Lunch' }] } });
};
const otherActions = { coach_message: 'Do not actually send this fixture', question: 'How is my day?',
  corrections: [{ name: 'Sambar', grams: 999 }], foods: [{ name: 'Extra Rice', grams: 500, per_100g: { calories: 100 } }],
  water_ml_add: 1000, weight_kg: 80, notes: 'do not log', workouts: [{ name: 'Walk', duration_min: 30 }] };
const emptyActions = result => result.foods.length === 0 && result.corrections.length === 0 && result.workouts.length === 0
  && result.water_ml_add === null && result.weight_kg === null && result.notes === null && result.totals.cal === 0;
const noWrites = () => queries.every(sql => !/\b(INSERT|UPDATE|DELETE)\b/.test(sql)) && sideEffects === 0;

(async () => {
  let result = await parse({ ...otherActions, draft_edit: edit() }, single);
  ck('actual parser returns single-row draft proposal by stable IDs', result.draft_edit?.status === 'edit' && result.draft_edit.grams === 250, result);
  ck('draft operation suppresses appended foods, saved corrections and every other action', emptyActions(result));
  ck('valid draft has one provider call and no learn/eval/member/coach writes', calls === 1 && noWrites(), queries);
  ck('canonical reply never repeats model claim of saving', /Nothing has been saved/.test(result.reply) && !result.sent_to_coach);
  result = await parse({ ...otherActions, draft_edit: edit({ foodId: 'food_2', meal: 'Dinner' }) }, selected);
  ck('explicit selection distinguishes identically named unsaved foods', result.draft_edit?.foodId === 'food_2' && result.draft_edit.meal === 'Dinner' && emptyActions(result) && noWrites());
  result = await parse({ ...otherActions, draft_edit: edit() }, { ...selected, target: null });
  ck('actual parser asks choice for multiple foods without accepting model target', result.draft_edit?.reason === 'choose_food' && emptyActions(result) && noWrites());
  result = await parse({ ...otherActions, draft_edit: edit({ foodId: 'wrong' }) }, single);
  ck('unknown ID cannot fall through into any alternate operation', result.draft_edit?.reason === 'invalid_edit' && emptyActions(result) && noWrites());
  for (const malformed of [null, {}, [], edit({ grams: -50 }), edit({ meal: 'Unknown' }), edit({ name: 'Replacement' })]) {
    result = await parse({ ...otherActions, draft_edit: malformed }, single);
    ck('malformed present operation is exclusive and never saves', result.draft_edit?.reason === 'invalid_edit' && emptyActions(result) && noWrites(), malformed);
  }
  result = await parse(otherActions, selected);
  ck('selected edit mode rejects a model omitting draft_edit instead of appending or messaging', result.draft_edit?.reason === 'invalid_edit' && emptyActions(result) && noWrites());
  result = await parse(otherActions, { ...selected, target: { reviewId: 'missing', foodId: 'missing' } });
  ck('invalid selected target cannot erase selected-mode safety', result.draft_edit?.reason === 'invalid_edit' && emptyActions(result) && noWrites());
  result = await parse({ draft_edit: edit() }, undefined);
  ck('operation without draft context is rejected', result.draft_edit?.reason === 'invalid_edit' && noWrites());
  result = await parse({ foods: [{ name: 'Extra Rice', grams: 150, per_100g: { calories: 100 } }] }, single, 'I ate another 150 grams of rice');
  ck('normal unselected request can still propose a genuinely new serving', !result.draft_edit && result.foods.length === 1 && result.foods[0].grams === 150, result);
  result = await parse({ corrections: [{ name: 'Sambar', grams: 250 }] }, undefined, 'change saved sambar to 250 grams');
  ck('existing saved-log correction contract remains separate', !result.draft_edit && result.corrections.length === 1 && result.corrections[0].name === 'Sambar', result);
  console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
