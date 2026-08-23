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

console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}\n`);
