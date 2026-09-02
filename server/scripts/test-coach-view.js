#!/usr/bin/env node
/**
 * test-coach-view.js — regression guard for the coach Monitor page fixes.
 *
 * Covers the two silent-data-loss bugs found on 2026-08-23:
 *   1. Food items were grouped by a hardcoded ['Meal 1','Meal 2','Meal 3'] list,
 *      so any item with a custom slot or meal=null vanished from the coach view
 *      while the day total still counted it.
 *   2. Body-comp "trends" were rendered for any marker with 2+ ROWS, so a single
 *      DEXA panel stored as duplicate rows on one date drew a flat fake trend.
 *
 * Pure logic — no DB, no network.
 *
 * This file used to reimplement thirteen client helpers under comments saying
 * "mirrors X". A copy is correct on the day it is written and silent on the day
 * the original changes, and four real defects were found while removing them:
 * a "Monsoon Circuit" label scheduling itself every Monday, a weight-name regex
 * narrower in the test than in the code, an untrimmed seam between two voice
 * takes, and a coach card rule blind to prescribed meals. Everything below now
 * imports what actually ships — via scripts/lib/client-bundle.js for client
 * modules — so editing the app turns these assertions red.
 *
 * PRODUCTION GUARD: refuses to run against a live database URL, matching the
 * convention in the other server/scripts/test-*.js files.
 */
'use strict';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run tests with NODE_ENV=production.');
  process.exit(1);
}
if (/railway|rlwy\.net|amazonaws|prod/i.test(process.env.DATABASE_URL || '')) {
  console.error('Refusing to run: DATABASE_URL points at a live database.');
  process.exit(1);
}

const assert = require('assert');
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  \u2713', name); }
  catch (err) { console.error('  \u2717', name, '\n   ', err.message); process.exitCode = 1; }
}

// ── The REAL Monitor.jsx derivations, imported ───────────────────────────────
// These were copies, pasted under comments saying "mirrors the grouping in
// Monitor.jsx". A copy is right on the day it is written and silent on the day
// the original changes — the same trap that let three computeDayTotals
// assertions run against a pasted function for months.
//
// The logic now lives in client/src/utils/coachView.js, imported by Monitor.jsx
// and by this file, so editing the coach screen turns these assertions red.
const { importClient } = require('./lib/client-bundle');
const { UNSORTED_MEAL, groupByMeal, deriveBodyComp } = importClient('utils/coachView.js');

const rendered = (groups) => groups.reduce((n, g) => n + g.items.length, 0);

console.log('\nMeal grouping');

test('every item renders regardless of slot name', () => {
  const items = [
    { name: 'Chapati',   meal: 'Meal 1' },
    { name: 'Paneer',    meal: 'Breakfast' },
    { name: 'Whey',      meal: null },
    { name: 'Almonds',   meal: '' },
    { name: 'Rice',      meal: '  Meal 2  ' },
  ];
  assert.strictEqual(rendered(groupByMeal(items, ['Meal 1', 'Meal 2'])), items.length,
    'items were dropped by the grouping');
});

test('the original bug: custom slots no longer vanish', () => {
  const items = [{ name: 'Poha', meal: 'Breakfast' }, { name: 'Dal', meal: 'Lunch' }];
  const legacy = ['Meal 1', 'Meal 2', 'Meal 3']
    .flatMap(m => items.filter(f => f.meal === m));
  assert.strictEqual(legacy.length, 0, 'legacy filter should drop these (bug reproduced)');
  assert.strictEqual(rendered(groupByMeal(items, [])), 2, 'fixed grouping must keep both');
});

test('null and blank slots land in Unsorted, never dropped', () => {
  const groups = groupByMeal([{ name: 'X', meal: null }, { name: 'Y', meal: '   ' }], ['Meal 1']);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].meal, UNSORTED_MEAL);
  assert.strictEqual(groups[0].items.length, 2);
});

test('protocol slot order is respected, Unsorted sorts last', () => {
  const items = [
    { name: 'A', meal: null },
    { name: 'B', meal: 'Dinner' },
    { name: 'C', meal: 'Breakfast' },
    { name: 'D', meal: 'Midnight snack' },
  ];
  const order = groupByMeal(items, ['Breakfast', 'Dinner']).map(g => g.meal);
  assert.deepStrictEqual(order, ['Breakfast', 'Dinner', 'Midnight snack', UNSORTED_MEAL]);
});

test('day total equals the sum of rendered rows', () => {
  const items = [
    { name: 'A', meal: 'Meal 1', cal: 100 },
    { name: 'B', meal: null,     cal: 250 },
    { name: 'C', meal: 'Snack',  cal: 50 },
  ];
  const dayTotal = items.reduce((s, f) => s + f.cal, 0);
  const shown = groupByMeal(items, ['Meal 1'])
    .reduce((s, g) => s + g.items.reduce((a, f) => a + f.cal, 0), 0);
  assert.strictEqual(shown, dayTotal, 'header total must match what the coach can see');
});

test('empty food list produces no groups', () => {
  assert.deepStrictEqual(groupByMeal([], ['Meal 1']), []);
});


console.log('\nBody composition');

test('duplicate rows on one date are not a trend', () => {
  const bc = deriveBodyComp([
    { test_name: 'Arms Bone', test_date: '2026-08-02', value: '0.2' },
    { test_name: 'Arms Bone', test_date: '2026-08-02', value: '0.2' },
    { test_name: 'Arms Bone', test_date: '2026-08-02', value: '0.2' },
  ]);
  assert.strictEqual(bc.markers.length, 1, 'marker should still be listed');
  assert.strictEqual(bc.trendable.length, 0, 'no chart from a single scan date');
  assert.strictEqual(bc.markers[0].latest, 0.2);
  assert.strictEqual(bc.markers[0].change, null);
});

test('two distinct dates produce a real trend and a delta', () => {
  const bc = deriveBodyComp([
    { test_name: 'Visceral Fat', test_date: '2026-08-02', value: '1870' },
    { test_name: 'Visceral Fat', test_date: '2026-09-06', value: '1795' },
  ]);
  assert.strictEqual(bc.trendable.length, 1);
  assert.strictEqual(bc.markers[0].change, -75);
});

test('a 60-marker single panel yields 60 readings and zero charts', () => {
  const labs = Array.from({ length: 60 }, (_, i) =>
    ({ test_name: `Marker ${i}`, test_date: '2026-08-02', value: String(i + 1) }));
  const bc = deriveBodyComp(labs);
  assert.strictEqual(bc.markers.length, 60);
  assert.strictEqual(bc.trendable.length, 0, 'this is the 13-flat-charts bug');
});

test('non-numeric and dateless rows are ignored, not crashed on', () => {
  const bc = deriveBodyComp([
    { test_name: 'A', test_date: '2026-08-02', value: 'pending' },
    { test_name: 'B', test_date: null,          value: '5' },
    { test_name: 'C', test_date: '2026-08-02', value: '5' },
  ]);
  assert.strictEqual(bc.markers.length, 1);
  assert.strictEqual(bc.markers[0].name, 'C');
});


// ── The REAL scale-screenshot validation, imported ───────────────────────────
// The copy that sat here excluded a metric named exactly "Weight". The shipped
// code also excludes "Weight (kg)", "Body Weight kgs" and the other spellings a
// scale app prints — so this suite was asserting NARROWER behaviour than the
// code it claimed to cover, and narrowing the real regex back would not have
// turned anything red.
const { cleanScalePayload, isWeightName } = require('../services/scaleParse');

console.log('\nScale screenshot parsing');

test('a smart-scale screen yields weight plus metrics', () => {
  const r = cleanScalePayload({
    weight_kg: '84.35',
    body_metrics: [
      { name: 'Body Fat', value: 26.1, unit: '%' },
      { name: 'Muscle Mass', value: 59.2, unit: 'kg' },
      { name: 'BMR', value: 1716, unit: 'Cal' },
    ],
  });
  assert.strictEqual(r.weight_kg, 84.35);
  assert.strictEqual(r.body_metrics.length, 3);
});

test('implausible weights are rejected, metrics survive', () => {
  assert.strictEqual(cleanScalePayload({ weight_kg: 843.5 }).weight_kg, null);
  assert.strictEqual(cleanScalePayload({ weight_kg: 5 }).weight_kg, null);
  assert.strictEqual(cleanScalePayload({ weight_kg: 'NaN' }).weight_kg, null);
});

test('the main weight is never duplicated into lab history', () => {
  const r = cleanScalePayload({
    weight_kg: 84.35,
    body_metrics: [
      { name: 'Weight', value: 84.35, unit: 'kg' },
      { name: 'Body Weight', value: 84.35, unit: 'kg' },
      { name: 'Best Visual Weight', value: 73.8, unit: 'kg' },
    ],
  });
  assert.deepStrictEqual(r.body_metrics.map(m => m.name), ['Best Visual Weight'],
    'Weight/Body Weight must be dropped; derived weights like Best Visual Weight stay');
});

test('junk metric rows are filtered without crashing', () => {
  const r = cleanScalePayload({ body_metrics: [
    { name: 'Health Score', value: '79.60' },
    { name: '', value: 5 }, { name: 'X' }, null, { value: 3 },
    { name: 'Protein', value: 'high' },
  ]});
  assert.deepStrictEqual(r.body_metrics.map(m => m.name), ['Health Score']);
});

test('a meal photo (no scale fields) parses to nulls harmlessly', () => {
  const r = cleanScalePayload({ foods: [{ name: 'Chapati' }] });
  assert.strictEqual(r.weight_kg, null);
  assert.strictEqual(r.body_metrics.length, 0);
});


// ── The REAL voice composer state machine, imported ──────────────────────────
// The copy that sat here did not .trim() the joined transcript on a finished
// take, while the shipped one does. A leading space is invisible in a test and
// goes straight to the parser in production.
const { createComposerModel: voiceComposerModel } = importClient('utils/voiceComposer.js');

console.log('\nVoice composer continue semantics');

test('a second take appends to the first with a single space', () => {
  const m = voiceComposerModel();
  m.record(); m.interim('2 roti'); m.final('2 roti with ghee');
  m.record(); m.interim('aur'); m.final('aur ek katori dal');
  assert.strictEqual(m.draft, '2 roti with ghee aur ek katori dal');
});

test('a finished take is trimmed before it is committed', () => {
  // The copy that used to stand in for this file skipped the .trim() the
  // shipped code does. Padding from the speech API is invisible on screen and
  // reaches the parser as a leading space.
  const m = voiceComposerModel();
  m.record(); m.final('   weight 82.5   ');
  assert.strictEqual(m.draft, 'weight 82.5');
  m.record(); m.final('  500 ml water  ');
  assert.strictEqual(m.draft, 'weight 82.5 500 ml water',
    'takes must join with exactly one space, not with whatever padding arrived');
});

test('interim results never overwrite committed takes', () => {
  const m = voiceComposerModel();
  m.record(); m.final('weight 82.5');
  m.record(); m.interim('morning');
  assert.strictEqual(m.draft, 'weight 82.5 morning');
  m.interim('morning walk done');
  assert.strictEqual(m.draft, 'weight 82.5 morning walk done');
});

test('manual edits become the base for the next take', () => {
  const m = voiceComposerModel();
  m.record(); m.final('2 rothi with ghee');
  m.edit('2 roti with ghee');
  m.record(); m.final('khaya chutney ke saath');
  assert.strictEqual(m.draft, '2 roti with ghee khaya chutney ke saath');
});

test('send drains the card and returns the full text', () => {
  const m = voiceComposerModel();
  m.record(); m.final('slept 10:30 to 6:30');
  assert.strictEqual(m.send(), 'slept 10:30 to 6:30');
  assert.strictEqual(m.draft, null, 'card must close after send');
  m.record(); m.final('drank 1 litre water');
  assert.strictEqual(m.draft, 'drank 1 litre water', 'a fresh session must not inherit sent text');
});

test('discard clears everything including committed takes', () => {
  const m = voiceComposerModel();
  m.record(); m.final('2 chapati'); m.discard();
  m.record(); m.final('1 bowl dal');
  assert.strictEqual(m.draft, '1 bowl dal');
});


// ── The REAL lab-upload routing, imported ────────────────────────────────────
// client/src/utils/labRouting.js, the same module AIChatLog.saveLabs calls.
const { routeLabRows, isWeightName: clientIsWeightName } =
  importClient('utils/labRouting.js');

console.log('\nLab upload weight routing (the scale-screenshot-via-lab-button bug)');

test("today's scale screenshot: weight to daily log, metrics to labs", () => {
  const rows = [
    { test_name: 'Weight', value: '84.35', unit: 'kg' },
    { test_name: 'Body Fat', value: '26.10', unit: '%' },
    { test_name: 'BMI', value: '25.50' },
  ];
  const { weightRow, labRows } = routeLabRows(rows, '2026-08-26', '2026-08-26');
  assert.strictEqual(parseFloat(weightRow.value), 84.35);
  assert.deepStrictEqual(labRows.map(r => r.test_name), ['Body Fat', 'BMI']);
});

test('name variants still route: "Weight (kg)", "Body Weight"', () => {
  for (const name of ['Weight (kg)', 'Body Weight', 'weight kg', ' Weight ']) {
    const { weightRow } = routeLabRows([{ test_name: name, value: 84 }], 'd', 'd');
    assert.ok(weightRow, `${name} should be recognised as the scale weight`);
  }
});

test('a past-dated report keeps its weight in lab history', () => {
  const rows = [{ test_name: 'Weight', value: '78.5', unit: 'kg' }];
  const { weightRow, labRows } = routeLabRows(rows, '2026-06-01', '2026-08-26');
  assert.strictEqual(weightRow, null, 'must not overwrite today\'s log from an old report');
  assert.strictEqual(labRows.length, 1);
});

test('markers that merely contain "weight" are NOT hijacked', () => {
  const rows = [
    { test_name: 'Best Visual Weight', value: '73.8', unit: 'kg' },
    { test_name: 'Molecular Weight', value: '180' },
    { test_name: 'Weight Control (kg)', value: '-11' },
  ];
  const { weightRow, labRows } = routeLabRows(rows, 'd', 'd');
  assert.ok(!weightRow);
  assert.strictEqual(labRows.length, 3);
});

test('an implausible "Weight" row stays a lab row', () => {
  const { weightRow } = routeLabRows([{ test_name: 'Weight', value: '1716' }], 'd', 'd');
  assert.ok(!weightRow, 'a BMR misread as weight must not reach the daily log');
});


// ── The REAL computeDayTotals, imported ──────────────────────────────────────
// This was a copy of the function, pasted into this file under a comment
// saying "mirrors computeDayTotals in aiChat.js". Three assertions ran against
// the copy, so changing the shipped function could not turn them red — the
// suite would have kept reporting the copy as correct forever.
//
// It is importable from services/digests, which is where aiChat.js gets it, so
// there was never a reason for the copy. Most of this file still has that
// problem: thirteen helpers here reimplement app logic. This is the one that
// had a real module sitting behind it.
const { computeDayTotals } = require('../services/digests');

console.log('\nDay totals for member questions');

test("Sachin's breakfast from the coach screenshot sums correctly", () => {
  const items = [
    { name: 'Ghee', grams: 12,  per_100g: { calories: 900, protein: 0,  total_carbs: 0,   fat: 99.5 } },
    { name: 'Coconut chutney', grams: 50, per_100g: { calories: 180, protein: 2,  total_carbs: 4,  fat: 16 } },
    { name: 'Whey protein powder', grams: 30, per_100g: { calories: 400, protein: 80, total_carbs: 8, fat: 5 } },
  ];
  const t = computeDayTotals(items);
  assert.strictEqual(t.cal, 318, '108 + 90 + 120');
  assert.strictEqual(t.pro, 25);
  assert.strictEqual(t.unknown, 0);
});

test('legacy items without per_100g are counted as unknown, not zero-priced silently', () => {
  const t = computeDayTotals([
    { name: 'Old item', grams: 100 },
    { name: 'Bad grams', grams: 'a lot', per_100g: { calories: 100 } },
    { name: 'Good', grams: 50, per_100g: { calories: 200, protein: 10, total_carbs: 20, fat: 2 } },
  ]);
  assert.strictEqual(t.cal, 100);
  assert.strictEqual(t.unknown, 2);
});

test('empty and missing food lists yield zeros', () => {
  assert.deepStrictEqual(computeDayTotals([]),        { cal: 0, pro: 0, carb: 0, fat: 0, unknown: 0 });
  assert.deepStrictEqual(computeDayTotals(undefined), { cal: 0, pro: 0, carb: 0, fat: 0, unknown: 0 });
});


// ── Digest message builders (real module, pure functions) ─────────────────────
const digests = require('../services/digests');

console.log('\nDigest messages');

test('recap with target: shows room left', () => {
  const body = digests.buildRecapBody({
    totals: { cal: 1450 }, kcalTarget: 1800, waterMl: 2100, waterTarget: 3000, weightLogged: true });
  assert.strictEqual(body, '1450 of 1800 kcal — room for ~350 more · water 2.1 of 3L');
});

test('recap over target says over, missing weigh-in is flagged', () => {
  const body = digests.buildRecapBody({
    totals: { cal: 2100 }, kcalTarget: 1800, waterMl: 3200, waterTarget: 3000, weightLogged: false });
  assert.ok(/300 over your 1800 target/.test(body));
  assert.ok(/water done/.test(body));
  assert.ok(/weigh-in still open/.test(body));
});

test('recap without any target still reads sensibly', () => {
  const body = digests.buildRecapBody({
    totals: { cal: 620 }, kcalTarget: null, waterMl: 0, waterTarget: null, weightLogged: true });
  assert.strictEqual(body, '620 kcal so far');
});

test('coach digest lists quiet members oldest-silence first, capped at 5', () => {
  const silent = [3,4,5,6,7,8,9].map(d => ({ name: `M${d}`, days: d })).sort((a,b)=>b.days-a.days);
  const body = digests.buildDigestBody({ total: 12, loggedYesterday: 5, silent });
  assert.ok(body.startsWith('5 of 12 members logged yesterday.'));
  assert.ok(/M9 \(9d\)/.test(body) && /\+2 more/.test(body));
});

test('coach digest with nobody quiet celebrates instead', () => {
  const body = digests.buildDigestBody({ total: 8, loggedYesterday: 8, silent: [] });
  assert.ok(/Nobody has gone quiet/.test(body));
});

// ── Member streak — the REAL StreakCard.computeStreak, imported ───────────────
// This was a copy, character-identical to the shipped function at the time it
// was pasted. That is exactly what makes a copy dangerous: it looks correct on
// the day it is written, and nothing turns red the day the original changes.
// StreakCard already exports the function; there was never anything to copy
// around. scripts/lib/client-bundle.js transpiles the module so a CommonJS
// suite can require it, which is the only reason the copy existed.
const { computeStreak } = importClient('components/StreakCard.jsx');

console.log('\nMember streak');

test('unbroken 5-day run counts 5', () => {
  const logs = [0,1,2,3,4].map(i => ({ log_date: `2026-08-${26-i}`, food_items: [{}] }));
  assert.strictEqual(computeStreak(logs, '2026-08-26').streak, 5);
});

test("today not yet logged doesn't break yesterday's streak", () => {
  const logs = [1,2,3].map(i => ({ log_date: `2026-08-${26-i}`, weight_kg: 84 }));
  assert.strictEqual(computeStreak(logs, '2026-08-26').streak, 3);
});

test('a gap two days ago resets the run', () => {
  const logs = [{ log_date: '2026-08-26', food_items: [{}] },
                { log_date: '2026-08-23', food_items: [{}] }];
  assert.strictEqual(computeStreak(logs, '2026-08-26').streak, 1);
});

test('empty logs and no-content logs count zero', () => {
  assert.strictEqual(computeStreak([], '2026-08-26').streak, 0);
  assert.strictEqual(computeStreak([{ log_date: '2026-08-26', food_items: [] }], '2026-08-26').streak, 0);
});


// ── The REAL WorkoutLog day-switch rules, imported ───────────────────────────
// Six assertions guarding the stacked-circuits bug used to run against a copy
// of these rules, so the component could have regressed without one of them
// turning red. The pure part now lives in client/src/utils/workoutSession.js;
// the haptics, state and toast stay in WorkoutLog.jsx.
const { applyProgramDay: switchProgramDay } = importClient('utils/workoutSession.js');

console.log('\nProgram day switching (the stacked-circuits bug)');

const LEG  = { day_number: 3, exercises: [{ exercise_id: 1, exercise_name: 'Squat' }, { exercise_id: 2, exercise_name: 'Leg Press' }] };
const PULL = { day_number: 2, exercises: [{ exercise_id: 3, exercise_name: 'Pull-Ups' }, { exercise_id: 4, exercise_name: 'Row' }] };

test('tapping Pull after Leg replaces, not stacks', () => {
  let sess = switchProgramDay([], LEG);
  sess = switchProgramDay(sess, PULL);
  assert.deepStrictEqual(sess.map(e => e.exercise_name).sort(), ['Pull-Ups', 'Row'],
    'leg exercises with no data must leave when switching to pull');
});

test('an exercise with a logged set survives the switch', () => {
  let sess = switchProgramDay([], LEG);
  sess = sess.map(e => e.exercise_id === 1 ? { ...e, sets: [{ reps: '10', weight_kg: '80' }] } : e);
  sess = switchProgramDay(sess, PULL);
  assert.deepStrictEqual(sess.map(e => e.exercise_name).sort(), ['Pull-Ups', 'Row', 'Squat'],
    'the squat with 10×80 logged is real data and must stay');
});

test('an empty set row does not count as logged data', () => {
  let sess = switchProgramDay([], LEG);
  sess = sess.map(e => e.exercise_id === 1 ? { ...e, sets: [{ reps: '', weight_kg: '' }] } : e);
  sess = switchProgramDay(sess, PULL);
  assert.ok(!sess.some(e => e.exercise_name === 'Squat'), 'a blank row from +Add Set is not data');
});

test('manually searched-in exercises are never swept by a chip tap', () => {
  let sess = switchProgramDay([{ exercise_id: 99, exercise_name: 'Farmer Walk', sets: [] }], LEG);
  sess = switchProgramDay(sess, PULL);
  assert.ok(sess.some(e => e.exercise_name === 'Farmer Walk'));
});

test('re-tapping the same day is a no-op', () => {
  let sess = switchProgramDay([], LEG);
  const again = switchProgramDay(sess, LEG);
  assert.deepStrictEqual(again.map(e => e.exercise_id).sort(), sess.map(e => e.exercise_id).sort());
});

test('overlapping exercise between days keeps its sets across the switch', () => {
  const PUSH = { day_number: 1, exercises: [{ exercise_id: 2, exercise_name: 'Leg Press' }] };
  let sess = switchProgramDay([], LEG);
  sess = sess.map(e => e.exercise_id === 2 ? { ...e, sets: [{ reps: '12', weight_kg: '150' }] } : e);
  sess = switchProgramDay(sess, PUSH);
  const lp = sess.find(e => e.exercise_id === 2);
  assert.strictEqual(lp.sets.length, 1, 'shared exercise must carry its logged set over');
});


// ── The REAL "From your coach today" rules, imported ─────────────────────────
// The copy that sat here covered three of the four rows — it knew nothing
// about prescribed meal plans. So "when nothing is pending the whole card
// leaves" was asserted against a rule that could not see one of the things
// keeping the card open.
const { coachCardRows, anyRow } = importClient('utils/coachCard.js');

console.log('\nCoach card pending logic');

test('morning: workout + targets both pending', () => {
  const r = coachCardRows({ coachPlan: { todayDay: {} }, macrosKcal: 1800, sets: [], cardio: [], food: [] });
  assert.deepStrictEqual(
    { workout: r.workout, rest: r.rest, targets: r.targets },
    { workout: true, rest: false, targets: true });
});

test('after first meal the targets row leaves, workout stays', () => {
  const r = coachCardRows({ coachPlan: { todayDay: {} }, macrosKcal: 1800, sets: [], cardio: [], food: [{ name: 'Poha' }] });
  assert.deepStrictEqual(
    { workout: r.workout, rest: r.rest, targets: r.targets },
    { workout: true, rest: false, targets: false });
});

test('after logging a set the workout row leaves', () => {
  const r = coachCardRows({ coachPlan: { todayDay: {} }, macrosKcal: 1800, sets: [{ reps: 10 }], cardio: [], food: [{}] });
  assert.ok(!r.workout && !r.targets && !anyRow(r), 'everything done → card gone');
});

test('cardio alone also completes the workout row', () => {
  const r = coachCardRows({ coachPlan: { todayDay: {} }, macrosKcal: null, sets: [], cardio: [{ type: 'walk' }], food: [] });
  assert.ok(!r.workout);
});

test('rest day row stays all day (informational, no action)', () => {
  const r = coachCardRows({ coachPlan: { todayDay: null }, macrosKcal: 1800, sets: [{}], cardio: [], food: [{}] });
  assert.deepStrictEqual(
    { workout: r.workout, rest: r.rest, targets: r.targets },
    { workout: false, rest: true, targets: false });
});

test('a prescribed meal keeps the card open on its own', () => {
  // The row the old copy was blind to. With no program and no calorie target,
  // an unlogged prescribed meal is the only thing holding the card open — and
  // it must.
  const r = coachCardRows({
    coachPlan: null, macrosKcal: null, sets: [], cardio: [], food: [],
    mealPlans: [{ meal: 'Lunch', items: [{ name: 'Dal' }, { name: 'Rice' }] }],
  });
  assert.strictEqual(r.pendingMeals.length, 1);
  assert.ok(anyRow(r), 'an unlogged prescribed meal is still pending');
});

test('logging ONE item of a prescribed meal retires that meal', () => {
  // The food panel's plan card tracks the rest from there; two places nagging
  // about one meal is one too many.
  const r = coachCardRows({
    coachPlan: null, macrosKcal: null, sets: [], cardio: [],
    food: [{ meal: 'Lunch', name: 'dal' }],
    mealPlans: [{ meal: 'Lunch', items: [{ name: 'Dal' }, { name: 'Rice' }] }],
  });
  assert.strictEqual(r.pendingMeals.length, 0, 'matching is case-insensitive');
  assert.ok(!anyRow(r), 'nothing pending → the whole card leaves');
});

test('the same food logged under a DIFFERENT slot does not retire the meal', () => {
  const r = coachCardRows({
    coachPlan: null, macrosKcal: null, sets: [], cardio: [],
    food: [{ meal: 'Dinner', name: 'Dal' }],
    mealPlans: [{ meal: 'Lunch', items: [{ name: 'Dal' }] }],
  });
  assert.strictEqual(r.pendingMeals.length, 1, 'lunch is still outstanding');
});

test('no program and no targets → no card at all', () => {
  assert.ok(!anyRow(coachCardRows({ coachPlan: null, macrosKcal: null, sets: [], cardio: [], food: [] })));
});


// ── The REAL today-day derivation, imported ──────────────────────────────────
// The copy that used to sit here matched with `.includes('Mon')`. The SERVER
// matches on a word boundary. So "Monsoon Circuit" was today's session on the
// member's dashboard and was not according to the server — and the only test
// covering it ran against a fourth copy that shared the client's bug, so the
// gate stayed green.
//
// One rule now, in client/src/utils/programDay.js, used by WorkoutLog and
// DailyLog and asserted below to agree with the server.
const { deriveTodayDay } = importClient('utils/programDay.js');
const { programDayForDate } = require('../routes/aiChat');

console.log('\nToday-day derivation (the "Rest day on Core Workout" bug)');

test('unscheduled single-day program is TODAY, never a rest day', () => {
  const r = deriveTodayDay([{ day_label: 'Core Workout', day_number: 1 }], 'Thu');
  assert.ok(r.todayDay, 'the program the coach just assigned must show as today');
  assert.strictEqual(r.scheduled, false);
});

test('scheduled program off-day is a genuine rest day', () => {
  const days = [{ day_label: 'Push · Mon' }, { day_label: 'Pull · Wed' }];
  const r = deriveTodayDay(days, 'Thu');
  assert.strictEqual(r.todayDay, null);
  assert.strictEqual(r.scheduled, true);
});

test('scheduled program on-day picks the matching day', () => {
  const days = [{ day_label: 'Push · Mon' }, { day_label: 'Leg · Thu' }];
  const r = deriveTodayDay(days, 'Thu');
  assert.strictEqual(r.todayDay.day_label, 'Leg · Thu');
});

test('a day label merely containing weekday-ish letters does not trip scheduling', () => {
  // "Monster Monday Madness" contains Mon — genuinely scheduled; but plain
  // "Strength" or "Hypertrophy" must not.
  const r = deriveTodayDay([{ day_label: 'Strength' }, { day_label: 'Hypertrophy' }], 'Fri');
  assert.strictEqual(r.scheduled, false);
  assert.strictEqual(r.todayDay.day_label, 'Strength');
});


console.log('\nClient/server agreement on what counts as "the weight"');

// The server strips the main weight OUT of body_metrics; the client picks it
// OUT of an uploaded lab result set. Same predicate, opposite use, opposite
// sides of the wire — they cannot import each other, so the copy is
// unavoidable. This is what keeps it honest.
//
// If they disagree, a scale screenshot writes its weight to the daily log AND
// keeps a second copy in lab history, and the member's body-composition chart
// grows a weight series that contradicts their weigh-in.
const WEIGHT_NAMES = [
  'Weight', 'weight', ' Weight ', 'Body Weight', 'Weight (kg)', 'Weight kg',
  'weight kgs', 'BODY WEIGHT (KG)',
];
const NOT_WEIGHT_NAMES = [
  'Body Fat', 'Muscle Mass', 'BMR', 'BMI', 'Weight Trend', 'Target Weight',
  'Bone Weight Index', 'Visceral Fat',
];

test('client and server agree on every name that IS the weight', () => {
  WEIGHT_NAMES.forEach(n => {
    assert.strictEqual(clientIsWeightName(n), isWeightName(n), `disagreed on "${n}"`);
    assert.strictEqual(isWeightName(n), true, `"${n}" should be the weight`);
  });
});

test('client and server agree on every name that is NOT the weight', () => {
  NOT_WEIGHT_NAMES.forEach(n => {
    assert.strictEqual(clientIsWeightName(n), isWeightName(n), `disagreed on "${n}"`);
    assert.strictEqual(isWeightName(n), false, `"${n}" is a metric, not the weigh-in`);
  });
});

test('"Weight (kg)" is stripped from body_metrics, not left to duplicate', () => {
  const { body_metrics } = cleanScalePayload({
    weight_kg: 84.3,
    body_metrics: [
      { name: 'Weight (kg)', value: 84.3, unit: 'kg' },
      { name: 'Body Fat', value: 26.1, unit: '%' },
    ],
  });
  assert.deepStrictEqual(body_metrics.map(m => m.name), ['Body Fat'],
    'the main weight must not also land in lab history');
});

console.log('\nOnboarding gate — a member must be able to leave first-run setup');

// Live bug: a new member completed setup, the PUT succeeded, and they landed
// straight back on the same screen with the button stuck on "Saving…". The
// server flag was read once on mount (false, correctly), and the gate ignored
// the local completion flag because the server value had "settled". Nobody
// could finish registering.
const { needsOnboarding } = importClient('utils/onboardingGate.js');

test('a brand-new member is sent to setup', () => {
  assert.strictEqual(needsOnboarding({ serverOnboarded: false, onboardingDone: false }), true);
});

test('finishing setup gets them OUT of it — the bug that blocked registration', () => {
  // serverOnboarded is still the value fetched on mount. It is stale the moment
  // the member finishes, and staleness must not outrank what just happened.
  assert.strictEqual(
    needsOnboarding({ serverOnboarded: false, onboardingDone: true, justFinished: true }),
    false, 'a member who just completed setup must never be shown it again');
});

test('a returning member is not asked to do it twice', () => {
  assert.strictEqual(needsOnboarding({ serverOnboarded: true, onboardingDone: false }), false);
});

test('the server outranks a stale local flag on a fresh device', () => {
  // Local storage on a shared or reset phone can claim done when it is not.
  assert.strictEqual(needsOnboarding({ serverOnboarded: false, onboardingDone: true }), true);
});

test('offline falls back to the local flag rather than trapping anyone', () => {
  assert.strictEqual(needsOnboarding({ serverOnboarded: null, onboardingDone: true }), false);
  assert.strictEqual(needsOnboarding({ serverOnboarded: null, onboardingDone: false }), true);
});

console.log('\nClient/server agreement on weekday scheduling');

// The two implementations live on opposite sides of the wire and cannot import
// each other. This is the thing that stops them drifting: if either changes its
// matching rule, these go red.
const PARITY_LABELS = [
  { day_number: 1, day_label: 'Push · Mon' },
  { day_number: 2, day_label: 'Monsoon Circuit' },
  { day_number: 3, day_label: 'Pull · Wed' },
  { day_number: 4, day_label: 'Sunday Long Walk' },
  { day_number: 5, day_label: 'Core Workout' },
];

// Monsoon FIRST, deliberately. With the array the other way round the real
// Monday day is found first and a `.includes` implementation passes by luck —
// an assertion that cannot fail, which is worse than not having one.
const MONSOON_FIRST = [
  { day_number: 9, day_label: 'Monsoon Circuit' },
  { day_number: 1, day_label: 'Push · Mon' },
];

test('"Monsoon Circuit" is not a Monday session — client', () => {
  const { todayDay } = deriveTodayDay(MONSOON_FIRST, 'Mon');
  assert.strictEqual(todayDay.day_label, 'Push · Mon',
    'a label merely containing "Mon" must not win over the real Monday day');
});

test('"Monsoon Circuit" is not a Monday session — server', () => {
  const d = programDayForDate(MONSOON_FIRST, '2026-08-31');   // a Monday
  assert.strictEqual(d.day_label, 'Push · Mon');
});

test('a Monsoon-only program schedules nothing on Monday', () => {
  const only = [{ day_number: 9, day_label: 'Monsoon Circuit' }];
  const { scheduled } = deriveTodayDay(only, 'Mon');
  assert.strictEqual(scheduled, false,
    '"Monsoon" contains no weekday, so this program is not weekday-scheduled at all');
});

test('client and server pick the same day for every weekday', () => {
  // 2026-08-31 is a Monday, so this walks Mon..Sun.
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  days.forEach((abbr, i) => {
    const date = `2026-08-${31 + i <= 31 ? String(31 + i).padStart(2, '0') : String(i - 0).padStart(2, '0')}`;
    const iso = new Date(Date.UTC(2026, 7, 31 + i)).toISOString().slice(0, 10);
    const serverDay = programDayForDate(PARITY_LABELS, iso);
    const { todayDay } = deriveTodayDay(PARITY_LABELS, abbr);
    assert.strictEqual(todayDay ? todayDay.day_number : null,
                       serverDay ? serverDay.day_number : null,
                       `disagreed on ${abbr} (${iso})`);
  });
});

test('a program with no weekdays falls back to the first day, not "rest"', () => {
  const { scheduled, todayDay } = deriveTodayDay([{ day_number: 1, day_label: 'Core Workout' }], 'Tue');
  assert.strictEqual(scheduled, false);
  assert.strictEqual(todayDay.day_label, 'Core Workout',
    'the program the coach just assigned must not read as a rest day');
});

// ── The REAL voice routing + auto-send rules, imported ───────────────────────
// Real report (28 Aug 2026): "76.7kg 500ml water" took 10–15s to reach the AI.
// The hook uploaded the audio to Gemini even when on-device recognition had
// already produced the words the member watched appear on screen. Both rules
// now live in client/src/utils/voiceComposer.js and are used by useVoiceInput
// and by the composer itself.
const { transcriptionRoute, autoSendDecision } = importClient('utils/voiceComposer.js');

console.log('\nVoice latency: transcription routing');

test('on-device transcript is used immediately, no upload', () => {
  const r = transcriptionRoute({ webSpeechText: 'weight 76.7 kg 500 ml water', blobBytes: 48000 });
  assert.strictEqual(r.source, 'on-device');
  assert.strictEqual(r.uploads, false, 'the Gemini round-trip was the 10-15s delay');
});

test('no on-device transcript falls back to Gemini', () => {
  const r = transcriptionRoute({ webSpeechText: '', blobBytes: 48000 });
  assert.strictEqual(r.source, 'gemini');
  assert.strictEqual(r.uploads, true, 'iOS Safari has no recognition — upload is the only path');
});

test('a silent tap uploads nothing at all', () => {
  assert.deepStrictEqual(transcriptionRoute({ webSpeechText: '', blobBytes: 300 }),
    { source: 'none', uploads: false });
});

console.log('\nVoice auto-send after the pause');

test('a real utterance is sent automatically and the card closes', () => {
  const r = autoSendDecision({ text: 'weight 76.7, 500ml water', autoSend: true });
  assert.strictEqual(r.sent, 'weight 76.7, 500ml water');
  assert.strictEqual(r.cardOpen, false);
});

test('a stray one-character noise does not fire an AI call', () => {
  assert.strictEqual(autoSendDecision({ text: 'a', autoSend: true }).sent, null);
});

test('whitespace-only transcript never sends', () => {
  assert.strictEqual(autoSendDecision({ text: '   ', autoSend: true }).sent, null);
});

test('with autoSend off the text waits in the card for the Send button', () => {
  const r = autoSendDecision({ text: '2 roti with ghee', autoSend: false });
  assert.strictEqual(r.sent, null);
  assert.strictEqual(r.cardOpen, true);
});


// ── The REAL Undo / Edit transition, imported ────────────────────────────────
// client/src/utils/chatCard.js, the same function AIChatLog's rollback calls.
const { rollbackCard, previewVisible } = importClient('utils/chatCard.js');

console.log('\nApplied card: Undo vs Edit');

test('Edit reopens the preview so values can be changed and re-applied', () => {
  const card = rollbackCard({ applied: true, pending: ['3 activities'] }, { reopen: true });
  assert.strictEqual(card.applied, false);
  assert.strictEqual(card.undone, false, 'editing is not a revert — the card must come back');
  assert.ok(previewVisible(card));
  assert.strictEqual(card.editing, true);
});

test('Undo closes the card as reverted, no preview', () => {
  const card = rollbackCard({ applied: true, pending: ['3 activities'] }, { reopen: false });
  assert.strictEqual(card.undone, true);
  assert.ok(!previewVisible(card), 'a reverted entry should not offer Apply again');
  assert.strictEqual(card.editing, false);
});

test('both paths clear the stale pending summary', () => {
  for (const reopen of [true, false]) {
    assert.strictEqual(rollbackCard({ applied: true, pending: ['x'] }, { reopen }).pending, null);
  }
});

// ── Never claim a save that did not happen ───────────────────────────────────
// Real report: sending "walking 40 minutes" twice replied "Got it — logged a
// 40-minute walk" while logging nothing, because the model's sentence was used
// even when every array came back empty.
function parseReply({ modelReply, nothingParsed }) {
  return nothingParsed
    ? "Nothing new to log there — it may already be in today's log. Tell me what to change (\"make the walk 30 minutes\"), or add something new."
    : (modelReply || "Here's what I understood — review and apply.");
}

console.log('\nReply honesty');

test('a false "logged it" claim is overridden when nothing parsed', () => {
  const r = parseReply({ modelReply: 'Got it — logged a 40-minute walk.', nothingParsed: true });
  assert.ok(!/Got it/.test(r), 'the model must not be allowed to claim a save');
  assert.ok(/Nothing new to log/.test(r));
});

test('the reply points at the fix rather than dead-ending', () => {
  const r = parseReply({ modelReply: '', nothingParsed: true });
  assert.ok(/make the walk 30 minutes/.test(r), 'show the member how to correct it');
});

test("a genuine parse keeps the model's summary", () => {
  const r = parseReply({ modelReply: 'Got it — 40 minute walk and 1L water.', nothingParsed: false });
  assert.strictEqual(r, 'Got it — 40 minute walk and 1L water.');
});


// ── Milestone detection (real module) ────────────────────────────────────────
const { detectMilestones, statsLine } = require('../services/milestones');

console.log('\nMilestone detection');

test("Padmini's real case: 85.2 → 84.9 crosses below 85", () => {
  const ms = detectMilestones({ start_weight: 94, latest_weight: 84.9, prev_weight: 85.2,
                                lowest_before: 85.2, target_weight: 80 });
  assert.ok(ms.some(m => /below 85 kg/.test(m)));
  assert.ok(ms.some(m => /new lowest weight/.test(m)));
});

test('the same weight next morning does NOT re-fire the milestone', () => {
  const ms = detectMilestones({ start_weight: 94, latest_weight: 84.8, prev_weight: 84.9,
                                lowest_before: 84.9, target_weight: 80 });
  assert.ok(!ms.some(m => /below 85 kg/.test(m)), 'congratulating daily would cheapen it');
  assert.ok(ms.some(m => /new lowest/.test(m)), 'but it is still a new best');
});

test('a 5 kg-lost threshold fires only on the crossing weigh-in', () => {
  const crossing = detectMilestones({ start_weight: 94, latest_weight: 88.9, prev_weight: 89.2, lowest_before: 89.2 });
  assert.ok(crossing.some(m => /5 kg down from the starting 94/.test(m)));
  const after = detectMilestones({ start_weight: 94, latest_weight: 88.5, prev_weight: 88.9, lowest_before: 88.9 });
  assert.ok(!after.some(m => /kg down from the starting/.test(m)));
});

test('reaching goal weight leads the list', () => {
  const ms = detectMilestones({ start_weight: 94, latest_weight: 79.8, prev_weight: 80.4,
                                lowest_before: 80.4, target_weight: 80 });
  assert.ok(/reached the goal weight of 80 kg/.test(ms[0]));
});

test('a weight gain produces no milestones', () => {
  assert.deepStrictEqual(
    detectMilestones({ start_weight: 94, latest_weight: 86.0, prev_weight: 85.2, lowest_before: 85.2 }), []);
});

test('streak milestones fire only on exact days', () => {
  assert.ok(detectMilestones({ latest_weight: 80, streak: 7 }).some(m => /7 days logged in a row/.test(m)));
  assert.strictEqual(detectMilestones({ latest_weight: 80, streak: 8 }).length, 0);
});

test('a member with no weigh-in yields nothing to celebrate', () => {
  assert.deepStrictEqual(detectMilestones({ start_weight: 94, latest_weight: null }), []);
});

test('the prompt line quotes only real figures', () => {
  const line = statsLine({ start_weight: 94, latest_weight: 84.9, prev_weight: 85.2,
                           lowest_before: 85.2, target_weight: 80, days_logged_14: 12, streak: 6 });
  assert.ok(/now 84.9 kg/.test(line) && /down 9.1 from 94/.test(line) && /goal 80/.test(line));
  assert.ok(/logged 12\/14 days/.test(line));
  assert.ok(/MILESTONE: dropped below 85 kg/.test(line));
});

test('a member without a start weight still gets a usable line', () => {
  const line = statsLine({ latest_weight: 72.4, days_logged_14: 3 });
  assert.ok(/now 72.4 kg/.test(line) && !/down/.test(line) && !/NaN/.test(line));
});

test('digest leads with milestones and tells the coach how to act', () => {
  const body = digests.buildDigestBody({ total: 12, loggedYesterday: 9, silent: [],
    milestones: [{ name: 'Padmini', text: 'dropped below 85 kg for the first time' }] });
  assert.ok(/🎉 Padmini — dropped below 85 kg/.test(body));
  assert.ok(/celebrate <name>/.test(body));
});


// ── Weekly progress report (real module) ─────────────────────────────────────
const wr = require('../services/weeklyReport');

console.log('\nWeekly report — week window');

test('the window is the 7 days ending on the run date', () => {
  const w = wr.weekWindow('2026-08-30');           // a Sunday
  assert.strictEqual(w.start, '2026-08-24');       // Monday
  assert.strictEqual(w.end, '2026-08-30');
  assert.strictEqual(w.prevEnd, '2026-08-23');
  assert.strictEqual(w.prevStart, '2026-08-17');
});

console.log('\nWeekly report — aggregation');

const food = (cal, pro) => [{ grams: 100, per_100g: { calories: cal, protein: pro, total_carbs: 0, fat: 0 } }];
const WIN = wr.weekWindow('2026-08-30');

test('averages count only days with food, not blank days', () => {
  const a = wr.aggregateWeek({ win: WIN, logs: [
    { log_date: '2026-08-24', food_items: food(1600, 100) },
    { log_date: '2026-08-25', food_items: food(1800, 120) },
    { log_date: '2026-08-26', food_items: [] },
  ]});
  assert.strictEqual(a.avgKcal, 1700, 'a blank day must not drag the average to zero');
  assert.strictEqual(a.avgPro, 110);
  assert.strictEqual(a.daysLogged, 2);
});

test('week delta measures against last week\'s final weigh-in', () => {
  const a = wr.aggregateWeek({ win: WIN, logs: [
    { log_date: '2026-08-22', weight_kg: 85.6, food_items: [] },   // previous week
    { log_date: '2026-08-25', weight_kg: 85.2, food_items: [] },
    { log_date: '2026-08-30', weight_kg: 84.9, food_items: [] },
  ]});
  assert.strictEqual(a.latestWeight, 84.9);
  assert.strictEqual(a.weekDelta, -0.7);
});

test('a first-ever week falls back to its own first weigh-in', () => {
  const a = wr.aggregateWeek({ win: WIN, logs: [
    { log_date: '2026-08-24', weight_kg: 86.0, food_items: [] },
    { log_date: '2026-08-30', weight_kg: 85.4, food_items: [] },
  ]});
  assert.strictEqual(a.weekDelta, -0.6);
});

test('a single weigh-in and no history yields no delta rather than a fake zero', () => {
  const a = wr.aggregateWeek({ win: WIN, logs: [{ log_date: '2026-08-30', weight_kg: 85.4, food_items: [] }] });
  assert.strictEqual(a.weekDelta, null);
});

test('workout days need a logged set; cardio counts separately', () => {
  const a = wr.aggregateWeek({ win: WIN, logs: [], sessions: [
    { session_date: '2026-08-25', set_count: 12, cardio: [] },
    { session_date: '2026-08-26', set_count: 0,  cardio: [{ type: 'walk' }, { type: 'cycle' }] },
  ]});
  assert.strictEqual(a.workoutDays, 1, 'an opened-but-empty session is not a workout');
  assert.strictEqual(a.cardioCount, 2);
});

test('rows outside the window are ignored entirely', () => {
  const a = wr.aggregateWeek({ win: WIN, logs: [
    { log_date: '2026-08-18', food_items: food(3000, 200) },   // previous week
    { log_date: '2026-08-25', food_items: food(1600, 100) },
  ]});
  assert.strictEqual(a.avgKcal, 1600);
  assert.strictEqual(a.daysLogged, 1);
});

console.log('\nWeekly report — goal projection');

const series = (from, perDay, n, startDate = '2026-08-03') => {
  const out = []; const d = new Date(startDate + 'T00:00:00Z');
  for (let i = 0; i < n; i++) {
    out.push({ date: new Date(d.getTime() + i * 86400e3).toISOString().slice(0, 10),
               kg: +(from + perDay * i).toFixed(2) });
  }
  return out;
};

test('a steady loss projects a plausible date', () => {
  const p = wr.projectGoalDate({ weights: series(86, -0.1, 21), target: 80, asOf: '2026-08-23' });
  assert.ok(p, 'should project');
  assert.ok(p > '2026-08-30' && p < '2027-08-23');
});

test('too few weigh-ins projects nothing', () => {
  assert.strictEqual(wr.projectGoalDate({ weights: series(86, -0.1, 3), target: 80, asOf: '2026-08-05' }), null);
});

test('a flat trend projects nothing rather than a date in 2049', () => {
  assert.strictEqual(wr.projectGoalDate({ weights: series(86, 0, 21), target: 80, asOf: '2026-08-23' }), null);
});

test('gaining while the goal is below projects nothing', () => {
  assert.strictEqual(wr.projectGoalDate({ weights: series(84, 0.05, 21), target: 80, asOf: '2026-08-23' }), null);
});

test('an implausibly fast trend is suppressed (>1 year out is the only allowance)', () => {
  // 2 kg to lose at 0.5 kg/day = 4 days — under the 7-day floor, so hidden.
  assert.strictEqual(wr.projectGoalDate({ weights: series(82, -0.5, 8), target: 80, asOf: '2026-08-10' }), null);
});

test('no target weight means no projection', () => {
  assert.strictEqual(wr.projectGoalDate({ weights: series(86, -0.1, 21), target: null, asOf: '2026-08-23' }), null);
});

console.log('\nWeekly report — win of the week & note');

test('crossing below 85 inside the week is the win', () => {
  const w = wr.winOfWeek({ latest: 84.9, beforeWindow: 85.2, lowestBefore: 85.2, start: 94, target: 80 });
  assert.ok(/below 85 kg/.test(w));
});

test('a week entirely under 85 has no crossing win', () => {
  const w = wr.winOfWeek({ latest: 84.6, beforeWindow: 84.8, lowestBefore: 84.2, start: 94, target: 80 });
  assert.strictEqual(w, null, 'already below and not a new low — nothing crossed');
});

test('the note prompt carries only real figures and forbids invention', () => {
  const p = wr.buildNotePrompt({
    name: 'Padmini',
    week: { latestWeight: 84.9, weekDelta: -0.7, daysLogged: 7, avgKcal: 1690, avgPro: 104,
            workoutDays: 3, cardioCount: 4 },
    targets: { kcal: 1800, pro: 110 },
    win: 'dropped below 85 kg for the first time',
  });
  assert.ok(/never invent a number/.test(p));
  assert.ok(/avg 1690 kcal vs target 1800/.test(p) && /avg protein 104 g vs target 110/.test(p));
  assert.ok(/logged 7\/7 days/.test(p));
  assert.ok(/max 220\s+characters/.test(p), 'must stay short enough to read on a card');
});

test('a flat week prompt demands honesty instead of cheering', () => {
  const p = wr.buildNotePrompt({
    name: 'Asha',
    week: { latestWeight: 86.2, weekDelta: 0.2, daysLogged: 6, avgKcal: 2100, avgPro: 70,
            workoutDays: 0, cardioCount: 1 },
    targets: { kcal: 1800, pro: 110 }, win: null,
  });
  assert.ok(/up 0.2 kg this week/.test(p), 'the gain is stated plainly');
  assert.ok(/no fake\s+cheering, no shame/.test(p));
});

test('the push line leads with the week movement', () => {
  const line = wr.buildPushLine({ weekDelta: -0.7, daysLogged: 7, win: 'dropped below 85 kg' });
  assert.ok(/▼ 0.7 kg this week/.test(line) && /7\/7 days logged/.test(line) && /milestone/.test(line));
});

test('a week with no weigh-in still produces a usable push line', () => {
  const line = wr.buildPushLine({ weekDelta: null, daysLogged: 4, win: null });
  assert.ok(/4\/7 days logged/.test(line) && !/NaN|undefined|null/.test(line));
});

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}\n`);
