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
 * Pure logic — no DB, no network. Mirrors the helpers in Monitor.jsx.
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

const UNSORTED_MEAL = 'Unsorted';

// ── Mirrors the grouping in Monitor.jsx Daily Log ─────────────────────────────
function groupByMeal(foodItems = [], protocolSlots = []) {
  const slotOf = (f) => {
    const s = f.meal == null ? '' : String(f.meal).trim();
    return s || UNSORTED_MEAL;
  };
  const slots = protocolSlots.map(s => (typeof s === 'string' ? s : s && s.name)).filter(Boolean);
  const present = [];
  foodItems.forEach(f => {
    const s = slotOf(f);
    if (!present.includes(s)) present.push(s);
  });
  const ordered = [
    ...slots.filter(s => present.includes(s)),
    ...present.filter(s => !slots.includes(s) && s !== UNSORTED_MEAL),
    ...(present.includes(UNSORTED_MEAL) ? [UNSORTED_MEAL] : []),
  ];
  return ordered.map(meal => ({ meal, items: foodItems.filter(f => slotOf(f) === meal) }));
}

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

// ── Mirrors the bodyComp derivation in Monitor.jsx ────────────────────────────
function deriveBodyComp(labs = []) {
  const byTest = new Map();
  labs.forEach(l => {
    const date = String(l.test_date || '').slice(0, 10);
    if (!date) return;
    const value = parseFloat(l.value);
    if (!Number.isFinite(value)) return;
    if (!byTest.has(l.test_name)) byTest.set(l.test_name, new Map());
    byTest.get(l.test_name).set(date, value);
  });
  const markers = [...byTest.entries()].map(([name, dateMap]) => {
    const series = [...dateMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ date, value }));
    const latest = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : null;
    return { name, series, latest: latest ? latest.value : null,
             change: prev ? +(latest.value - prev.value).toFixed(2) : null };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { markers, trendable: markers.filter(m => m.series.length >= 2) };
}

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


// ── Mirrors the scale-screenshot validation in /ai-chat/photo ─────────────────
function cleanScalePayload(parsed) {
  let weight_kg = parseFloat(parsed.weight_kg);
  if (!Number.isFinite(weight_kg) || weight_kg < 20 || weight_kg > 300) weight_kg = null;
  const body_metrics = (Array.isArray(parsed.body_metrics) ? parsed.body_metrics : [])
    .filter(m => m && m.name && Number.isFinite(parseFloat(m.value)))
    .slice(0, 40)
    .map(m => ({
      name:  String(m.name).trim().slice(0, 80),
      value: parseFloat(m.value),
      unit:  m.unit ? String(m.unit).trim().slice(0, 20) : null,
    }))
    .filter(m => !/^(body )?weight$/i.test(m.name));
  return { weight_kg, body_metrics };
}

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


// ── Mirrors the voice composer's continue-by-mic state machine ────────────────
function voiceComposerModel() {
  let committed = '', draft = null;
  const join = (a, b) => (a && b ? `${a} ${b}` : a || b || '');
  return {
    record()        { committed = (draft || '').trim(); if (draft === null) draft = ''; },
    interim(t)      { draft = join(committed, t); },
    final(t)        { committed = join(committed, t); draft = committed; },
    edit(t)         { draft = t; committed = t; },
    send()          { const out = (draft || '').trim(); committed = ''; draft = null; return out; },
    discard()       { committed = ''; draft = null; },
    get draft()     { return draft; },
  };
}

console.log('\nVoice composer continue semantics');

test('a second take appends to the first with a single space', () => {
  const m = voiceComposerModel();
  m.record(); m.interim('2 roti'); m.final('2 roti with ghee');
  m.record(); m.interim('aur'); m.final('aur ek katori dal');
  assert.strictEqual(m.draft, '2 roti with ghee aur ek katori dal');
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


// ── Mirrors the lab-save weight routing in AIChatLog.saveLabs ─────────────────
function routeLabRows(rows, testDate, today) {
  const isScaleWeightRow = (r) => {
    const v = parseFloat(r.value);
    return /^(body )?weight( ?\(?kgs?\)?)?$/i.test(String(r.test_name || '').trim())
      && Number.isFinite(v) && v >= 20 && v <= 300;
  };
  const weightRow = testDate === today ? rows.find(isScaleWeightRow) : null;
  return { weightRow, labRows: weightRow ? rows.filter(r => r !== weightRow) : rows };
}

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


// ── Mirrors computeDayTotals in aiChat.js (member question answering) ─────────
function computeDayTotals(foodItems) {
  let cal = 0, pro = 0, carb = 0, fat = 0, unknown = 0;
  for (const f of (Array.isArray(foodItems) ? foodItems : [])) {
    const g = parseFloat(f.grams);
    const n = f.per_100g;
    if (!Number.isFinite(g) || !n || !(parseFloat(n.calories) > 0)) { unknown++; continue; }
    const k = g / 100;
    cal  += (parseFloat(n.calories)    || 0) * k;
    pro  += (parseFloat(n.protein)     || 0) * k;
    carb += (parseFloat(n.total_carbs) || 0) * k;
    fat  += (parseFloat(n.fat)         || 0) * k;
  }
  return { cal: Math.round(cal), pro: +pro.toFixed(1), carb: +carb.toFixed(1),
           fat: +fat.toFixed(1), unknown };
}

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

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}\n`);
