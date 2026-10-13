/** Deterministic parse regressions: the actual router/module runs with an
 * isolated provider and in-memory DB stub. No credentials, network or DB. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { normaliseFoodReview, sanitiseFoodClarification } = require('../services/foodReview');
let pass = 0, fail = 0;
const ck = (name, ok, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ': ' + JSON.stringify(detail)}`); ok ? pass++ : fail++; };
const row = (name, grams, extras = {}) => ({ name, grams, meal: 'Breakfast', per_100g: { calories: 99 }, ...extras });

const valid = normaliseFoodReview([row('Idli', 80), row('Sambar', 150)], []);
ck('two valid food portions survive unchanged', valid.foods.length === 2 && valid.foods[0].grams === 80 && valid.foods[1].grams === 150 && !valid.unresolvedFoods.length);
for (const grams of [null, undefined, 0, -1, '', 'unknown', 'Infinity', Infinity, { toString: null }, 0.1]) {
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
for (const method of ['use', 'get', 'post', 'put', 'patch', 'delete']) router[method] = () => router;
let fixture = {}, prompts = [], queries = [];
const foods = { idli: { id: 1, name: 'Idli', verified: true, per_100g: { calories: 134, protein: 3.9, total_carbs: 26, fat: 0.2 } },
  sambar: { id: 2, name: 'Sambar', verified: true, per_100g: { calories: 46, protein: 2.5, total_carbs: 7.5, fat: 1.2 } } };
const db = { query: async (sql, args = []) => {
  queries.push({ sql, args });
  if (/WITH c AS/.test(sql) && foods[args[0]]) return { rows: [foods[args[0]]] };
  if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
  return { rows: [] };
} };
const pureModules = new Set(['../services/personName', '../services/scaleParse', '../services/macroCheck', '../services/fatProfile',
  '../services/nutrients', '../services/voiceLanguage', '../services/programDay', '../utils/istDate', '../services/safety', '../services/foodReview']);
const moduleFixture = { exports: {} };
const sandbox = { module: moduleFixture, exports: moduleFixture.exports, console, setTimeout, clearTimeout,
  process: { env: { GROQ_API_KEY: 'isolated-fixture', GROQ_MODEL: 'fixture-model', GROQ_FALLBACK_MODEL: 'fixture-model' } },
  require(name) {
    if (name === 'express') return { Router: () => router };
    if (name === '../db/pool') return db;
    if (name === 'axios') return { post: async (url, body) => {
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
  ck('parser never writes daily logs or workouts during review', queries.every(({ sql }) => !/(?:INSERT INTO|UPDATE)\s+(?:daily_logs|workout_sessions)/i.test(sql)));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
