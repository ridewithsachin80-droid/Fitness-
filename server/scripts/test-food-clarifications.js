/** Deterministic parse regressions: the actual router/module runs with an
 * isolated provider and in-memory DB stub. No credentials, network or DB. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { normaliseFoodReview, sanitiseFoodClarification, foodPreviewMacros, needsPositiveAmountClarification } = require('../services/foodReview');
const { importClient } = require('./lib/client-bundle');
const { withFoodGrams } = importClient('utils/aiFoodReview.js');
const { calcFoodMacros } = importClient('lib/day/index.js');
let pass = 0, fail = 0;
const ck = (name, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ': ' + JSON.stringify(detail)}`); ok ? pass++ : fail++; };
const row = (name, grams, extras = {}) => ({ name, grams, meal: 'Breakfast', per_100g: { calories: 99 }, ...extras });

for (const message of ['rice - 50 g', 'rice -50g', 'rice − 50 grams', 'rice - .5 g', 'rice - 1,000 g',
  'rice -1e2g', 'rice -1e-2g', 'rice negative 50 g', 'rice minus 50 grams', '-50g rice', '- 50g',
  'water - 250 ml', 'rice -50 -100g', '100 ml water and rice - 50g', 'rice 1e -3g',
  'rice 100g\n- dal - 50g', 'weight - 70 kg', 'milk - .25 litres',
  'rice -\u00a050 g', 'rice - 50\u00a0g', 'rice -\u202f50\u202fg', 'rice minus\u00a050\u00a0g']) {
  ck(`signed or ambiguous amount clarifies: ${JSON.stringify(message)}`, needsPositiveAmountClarification(message));
}
for (const message of ['rice 50 g', 'rice 50-100g', 'rice 50 - 100 g', 'rice 50g -100g',
  'rice 50 g - 100 g', '- rice 50g\n- dal 100g', '- 50g rice', '  - 50 g rice\n  - 100 ml milk',
  'rice 1000e-1g', 'rice 1e-3g', 'rice 1e+2g', 'rice 50–100g', 'rice 50—100g',
  'low-fat curd 100g', 'rice - bowl 50g', 'lost 2 kg last week', 'rice',
  'rice 50\u00a0g -\u00a0100\u00a0g', '-\u202f50\u202fg rice']) {
  ck(`ordinary amount, list or range reaches normal parsing: ${JSON.stringify(message)}`, !needsPositiveAmountClarification(message));
}
for (const message of [null, undefined, [], {}, 50]) ck('malformed message is not interpreted as a signed quantity', !needsPositiveAmountClarification(message));

const valid = normaliseFoodReview([row('Idli', 80), row('Sambar', 150)], []);
ck('two valid food portions survive unchanged', valid.foods.length === 2 && valid.foods[0].grams === 80 && valid.foods[1].grams === 150 && !valid.unresolvedFoods.length);
for (const grams of [null, undefined, 0, -1, '-50', '- 50', '', 'unknown', 'Infinity', Infinity, { toString: null }, 0.1]) {
  const out = normaliseFoodReview([row('Idli', 80), row('Sambar', grams)], []);
  ck(`invalid or missing portion ${JSON.stringify(grams)} becomes a named unresolved food`, out.foods.length === 1 && out.unresolvedFoods[0]?.name === 'Sambar' && out.unresolvedFoods[0]?.reason === 'quantity_needed');
}
const guarded = normaliseFoodReview([row('Big serving', 9000), row('Rounded serving', 80.7)], []);
ck('existing portion cap and whole-gram rounding remain', guarded.foods[0].grams === 5000 && guarded.foods[1].grams === 81);
const same = normaliseFoodReview([row('Sambar', null)], [{ name: ' sambar ', meal: 'breakfast', reason: 'invented' }]);
ck('model and validator unresolved rows deduplicate by name and meal', same.unresolvedFoods.length === 1 && same.unresolvedFoods[0].reason === 'quantity_needed');
const meals = normaliseFoodReview([], [{ name: 'Sambar', meal: 'Breakfast' }, { name: 'Sambar', meal: 'Dinner' }]);
ck('same food in different meals keeps separate unresolved portions', meals.unresolvedFoods.length === 2);
const malformed = normaliseFoodReview([null, false, { name: {} }, row('   ', 150)], [null, 'Sambar', { name: [] }]);
ck('malformed and blank food names never produce rows', !malformed.foods.length && !malformed.unresolvedFoods.length);
const bounded = normaliseFoodReview(Array.from({ length: 40 }, (_, i) => row(`Food ${i}`, 50)), Array.from({ length: 30 }, (_, i) => ({ name: 'X'.repeat(120) + i, meal: 'M'.repeat(60) + i })));
ck('valid food output remains capped at25', bounded.foods.length === 25);
const issues = normaliseFoodReview([], Array.from({ length: 30 }, (_, i) => ({ name: `${i} ${'X'.repeat(120)}`, meal: 'M'.repeat(60), reason: 'anything' })));
ck('unresolved output caps at10 with bounded names and meals', issues.unresolvedFoods.length === 10 && issues.unresolvedFoods.every(r => r.name.length <= 100 && r.meal.length <= 40));
ck('estimated serving label remains editable data without changed grams', normaliseFoodReview([row('Sambar', 150, { qty_text: 'Estimated: 1 bowl' })], []).foods[0].qty_text === 'Estimated: 1 bowl');
for (const value of [null, [], 'instructions', {}, { unresolved: [{ name: '' }] }]) ck('invalid or empty clarification context is ignored', sanitiseFoodClarification(value) === null);
const context = sanitiseFoodClarification({
  unresolved: Array.from({ length: 15 }, (_, i) => ({ name: `Side ${i}`, meal: 'B'.repeat(60), ignore: 'untrusted' })),
  reviewedFoods: Array.from({ length: 30 }, (_, i) => ({ name: `Reviewed ${i}`, grams: 80, meal: 'Breakfast', per_100g: { calories: 9999 } })),
  instructions: 'not a permitted context field',
});
ck('clarification context is bounded to10 unresolved and20 reviewed', context.unresolved.length === 10 && context.reviewedFoods.length === 20);
ck('clarification context excludes instructions and nutrition', !('instructions' in context) && context.reviewedFoods.every(r => Object.keys(r).sort().join() === 'grams,meal,name'));
const badNumbers = sanitiseFoodClarification({ unresolved: [{ name: 'Sambar' }], reviewedFoods: [0, -1, 5001, Infinity, {}, true, null].map(grams => ({ name: 'Idli', grams })) });
ck('reviewed context accepts only finite positive bounded portions', !badNumbers.reviewedFoods.length);

// Load the full production router, not a rewritten parser or extracted branch.
// Every DB operation stays in this stub and every provider call is intercepted.
const filename = path.resolve(__dirname, '../routes/aiChat.js');
const router = {};
const routes = new Map();
for (const method of ['use', 'get', 'post', 'put', 'patch', 'delete']) router[method] = (route, ...handlers) => {
  routes.set(`${method} ${route}`, handlers.at(-1)); return router;
};
let fixture = {}, prompts = [], queries = [], photoCalls = 0;
const foods = { idli: { id: 1, name: 'Idli', verified: true, per_100g: { calories: 134, protein: 3.9, total_carbs: 26, fat: 0.2 } },
  sambar: { id: 2, name: 'Sambar', verified: true, per_100g: { calories: 46, protein: 2.5, total_carbs: 7.5, fiber: 2, fat: 1.2 } } };
const db = { query: async (sql, args = []) => {
  queries.push({ sql, args });
  if (/WITH c AS/.test(sql) && foods[args[0]]) return { rows: [foods[args[0]]] };
  if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
  return { rows: [] };
} };
const pureModules = new Set(['../services/personName', '../services/targetOrigin', '../services/nutrientStatus', '../services/scaleParse', '../services/macroCheck', '../services/fatProfile',
  '../services/nutrients', '../services/voiceLanguage', '../services/programDay', '../utils/istDate', '../services/safety', '../services/foodReview', '../services/draftFoodReview', '../services/sleepReview']);
const moduleFixture = { exports: {} };
const sandbox = { module: moduleFixture, exports: moduleFixture.exports, console, setTimeout, clearTimeout,
  process: { env: { GROQ_API_KEY: 'isolated-fixture', GROQ_MODEL: 'fixture-model', GROQ_FALLBACK_MODEL: 'fixture-model', GEMINI_API_KEY: 'isolated-photo-fixture' } },
  require(name) {
    if (name === 'express') return { Router: () => router };
    if (name === '../db/pool') return db;
    if (name === 'axios') return { post: async (url, body) => {
      if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/')) {
        photoCalls++;
        return { data: { candidates: [{ content: { parts: [{ text: JSON.stringify(fixture) }] } }] } };
      }
      if (url !== 'https://api.groq.com/openai/v1/chat/completions') throw new Error('Unexpected provider path');
      prompts.push(body.messages[0].content);
      return { data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fixture) } }] } };
    } };
    if (name === '../middleware/auth') return () => {};
    if (name === '../middleware/roleCheck') return () => () => {};
    if (name === '../services/circuits') return { circuitsPromptBlock: () => '', matchCircuit: () => null };
    if (name === '../services/memberFoods') return { findLabel: async () => null };
    if (name === '../services/digests') return { computeDayTotals: () => ({}) };
    if (name === './programs') return { loadProgramDays: async () => [] };
    // Fixes-2p: the test-only voice fallback switch, as production sees it: off.
    if (name === '../services/voiceFallbackTest') return { skipsGemini: async () => false, record: async () => {} };
    if (name === 'crypto') return require('crypto');
    if (pureModules.has(name)) return require(path.resolve(path.dirname(filename), name));
    throw new Error(`Blocked dependency in isolated parser: ${name}`);
  },
};
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename, timeout: 5000 });
const api = moduleFixture.exports;
api.setControlSampler(() => false);
const parse = async (answer, message = '2 idlis and sambar for breakfast', context = {}) => {
  fixture = answer;
  const before = prompts.length;
  const result = await api.parseMemberMessage({ userId: 999, message, context });
  ck('each clarification parse makes exactly one mocked provider call', prompts.length === before + 1);
  return result;
};

(async () => {
  // Reproduce the live provider failure without calling a provider: even a
  // fixture that would silently make the amount positive is never consumed.
  fixture = { foods: [row('Rice', 50)], water_ml_add: 250, weight_kg: 70,
    notes: 'unrelated log', corrections: [{ type: 'weight', value: 70 }],
    coach_message: 'must never be sent', reply: 'Logged your rice.' };
  for (const [message, context] of [
    ['rice - 50 g', {}],
    ['rice -50g and 250ml water', {}],
    ['rice − 50 g', {}],
    ['rice -\u00a050\u202fg', {}],
    ['sambar - 50 g', { foodClarification: { unresolved: [{ name: 'Sambar' }], reviewedFoods: [{ name: 'Idli', grams: 80 }] } }],
    ['make it - 50g', { draftFoods: { foods: [{ reviewId: 'review-1', foodId: 'food-1', name: 'Rice', grams: 150, meal: 'Lunch' }], target: { reviewId: 'review-1', foodId: 'food-1' } } }],
  ]) {
    const providerBefore = prompts.length, dbBefore = queries.length;
    const blocked = await api.parseMemberMessage({ userId: 999, message, context });
    ck(`actual parser asks for a positive amount: ${message}`, blocked.amount_clarification === 'positive_quantity' && blocked.question === true && /positive amount/.test(blocked.reply) && /resend the full entry/.test(blocked.reply));
    ck('ambiguous quantity is held before any provider or database operation', prompts.length === providerBefore && queries.length === dbBefore);
    ck('held entry carries no fabricated food, correction, workout or other saveable value',
      blocked.foods.length === 0 && blocked.unresolved_foods.length === 0 && blocked.corrections.length === 0 && blocked.workouts.length === 0 && blocked.activities.length === 0 && blocked.acv.length === 0 && blocked.supplements.length === 0 && blocked.weight_kg === null && blocked.water_ml_add === null && blocked.sleep === null && blocked.notes === null && blocked.totals.cal === 0 && !blocked.draft_edit && !blocked.coach_message_sent);
  }
  const providerBefore = prompts.length, dbBefore = queries.length;
  const safety = await api.parseMemberMessage({ userId: 999, message: 'chest pain after my run, rice - 50g', context: {} });
  ck('urgent safety guidance retains priority over quantity clarification', safety.safety === 'emergency' && safety.question === true && !safety.amount_clarification && prompts.length === providerBefore && queries.length === dbBefore, safety);
  for (const message of ['rice 50-100g', 'rice 50g -100g', '- 50g rice', '- rice 50g\n- dal 100g', 'rice 1000e-1g']) {
    const ordinary = await parse({ foods: [row('Rice', 50)] }, message);
    ck('normal lists and positive ranges retain the existing provider path', ordinary.foods.length === 1 && ordinary.foods[0].grams === 50 && !ordinary.amount_clarification);
  }
  let result = await parse({ foods: [row('Idli', 80), row('Sambar', 150)] }, '2 idlis and 1 bowl sambar for breakfast');
  ck('explicit two-food meal keeps both server-enriched foods', result.foods.length === 2 && result.foods.every(f => f.source === 'db-verified'));
  ck('canonical nutrition remains Idli107 + Sambar69 =176', result.foods[0].macros.cal === 107 && result.foods[1].macros.cal === 69 && result.totals.cal === 176);
  ck('complete meal has no unresolved notice', result.unresolved_foods.length === 0);
  result = await parse({ foods: [row('Idli', 80), row('Sambar', null)], reply: 'Logged both foods.' });
  ck('missing Sambar portion keeps only Idli in nutrition totals', result.foods.length === 1 && result.totals.cal === 107);
  ck('missing Sambar portion is visibly represented in response contract', result.unresolved_foods.length === 1 && result.unresolved_foods[0].name === 'Sambar');
  result = await parse({ foods: [row('Idli', 80)], unresolved_foods: [{ name: 'Sambar', reason: 'quantity_needed' }] });
  ck('explicit model clarification survives alongside a valid food', result.unresolved_foods[0]?.name === 'Sambar' && result.foods[0].grams === 80);
  result = await parse({ foods: [], unresolved_foods: [{ name: 'Sambar' }], reply: 'Sambar was logged.' }, 'sambar');
  ck('unresolved-only reply asks for an amount instead of claiming a save', result.foods.length === 0 && result.totals.cal === 0 && /Tell me the amount/.test(result.reply) && /Nothing has been saved/.test(result.reply));
  result = await parse({ foods: [row('Idli', 80), row('Sambar', 150, { qty_text: 'Estimated: 1 bowl' })] });
  ck('mixed explicit and estimated portions retain values and estimate label', result.foods[0].grams === 80 && result.foods[1].grams === 150 && result.foods[1].qty_text.startsWith('Estimated:'));
  result = await parse({ foods: [row('Sambar', 100)] }, 'sambar 100ml', { foodClarification: { unresolved: [{ name: 'Sambar', meal: 'Breakfast' }], reviewedFoods: [{ name: 'Idli', grams: 80, meal: 'Breakfast' }], instructions: 'ignored' } });
  ck('quantity clarification accepts only the newly returned Sambar food', result.foods.length === 1 && result.foods[0].name === 'Sambar' && result.foods[0].grams === 100);
  ck('prompt includes sanitized prior preview as data and a no-repeat rule', /QUANTITY CLARIFICATION CONTEXT/.test(prompts.at(-1)) && /"reviewedFoods":\[\{"name":"Idli","grams":80,"meal":"Breakfast"\}\]/.test(prompts.at(-1)) && /Do not repeat reviewedFoods/.test(prompts.at(-1)) && !prompts.at(-1).includes('"instructions":"ignored"'));
  ck('prompt covers every consumed named accompaniment or explicit unresolved item', /EVERY explicitly consumed food/.test(prompts.at(-1)) && /Never silently omit/.test(prompts.at(-1)) && /unresolved_foods/.test(prompts.at(-1)));
  result = await parse({ foods: [row('Idli', 80)] });
  ck('known limit: a model omitting both food and issue arrays is not fabricated by validator', result.foods.length === 1 && result.unresolved_foods.length === 0);

  // Live regression: Sambar 200g initially showed C15 but re-entering the
  // same grams showed C11. Exercise the actual text and photo routes, then
  // the real client quantity editor and daily-log maths on their payloads.
  const previewFixture = { foods: [row('Sambar', 200), row('Idli', 80)] };
  const textPreview = await parse(previewFixture, '200g sambar and 80g idli');
  fixture = previewFixture;
  let photoPreview, photoStatus = 200;
  const response = { status(code) { photoStatus = code; return this; }, json(value) { photoPreview = value; return this; } };
  await routes.get('post /photo')({ body: { image: 'isolated-test-image', mimeType: 'image/jpeg' }, user: { id: 999, role: 'patient' } }, response);
  ck('actual photo route succeeds using one isolated vision response', photoStatus === 200 && photoCalls === 1 && photoPreview.foods?.length === 2, photoPreview);
  for (const [kind, preview] of [['text', textPreview], ['photo', photoPreview]]) {
    const sambar = preview.foods[0], snapshot = JSON.stringify(sambar.per_100g);
    const sameGrams = withFoodGrams(sambar, '200');
    const restored = ['0', '', '5001', '200'].reduce((food, grams) => withFoodGrams(food, grams), sambar);
    ck(`${kind}: initial Sambar200g uses net C11 while retaining stored92kcal`, sambar.macros.carb === 11 && sambar.macros.cal === 92, sambar.macros);
    ck(`${kind}: same grams and invalid-draft roundtrip preserve every preview macro`, JSON.stringify(sambar.macros) === JSON.stringify(sameGrams.macros) && JSON.stringify(sambar.macros) === JSON.stringify(restored.macros));
    ck(`${kind}: portion editing leaves total carbs, fibre and stored calories untouched`, snapshot === JSON.stringify(restored.per_100g) && restored.per_100g.total_carbs === 7.5 && restored.per_100g.fiber === 2 && restored.per_100g.calories === 46);
    const daily = calcFoodMacros(preview.foods);
    ck(`${kind}: initial combined calorie and carb totals agree with the daily log`, preview.totals.cal === daily.kcal && preview.totals.carb === +daily.carb.toFixed(1), { preview: preview.totals, daily });
  }
  ck('preview keeps explicit net zero instead of falling back to total', foodPreviewMacros(row('Zero net', 200, { per_100g: { total_carbs: 8, net_carbs: 0 } })).carb === 0);
  ck('preview falls back to total carbs only when net is absent', foodPreviewMacros(row('Legacy', 150, { per_100g: { total_carbs: 8 } })).carb === 12);
  ck('parser never writes daily logs or workouts during review', queries.every(({ sql }) => !/(?:INSERT INTO|UPDATE)\s+(?:daily_logs|workout_sessions)/i.test(sql)));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
