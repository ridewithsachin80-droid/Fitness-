/**
 * scripts/validate-foods.js — audits every seeded food for nutritional sanity.
 *
 * Written after two real bugs reached members' logs: whey protein logged at a
 * third of its true value, and "Egg" resolving to egg yolk. Both were lookup
 * faults rather than bad data, but they showed there was no check standing
 * between the seed files and someone's calorie total.
 *
 * The checks, in rough order of how badly they'd hurt if violated:
 *
 *   ATWATER      calories must agree with 4·protein + 4·carbs + 9·fat.
 *                This catches transcription slips and per-serving values
 *                pasted into a per-100g field. Tolerance is deliberately
 *                loose (25% or 30 kcal) because real foods include alcohol,
 *                polyols and fibre that the 4/4/9 model ignores.
 *
 *   MASS         protein + carbs + fat cannot exceed 100g per 100g of food.
 *
 *   SUBSET       fibre and sugar are parts of total carbohydrate; saturated
 *                and trans fat are parts of total fat. None may exceed its
 *                parent.
 *
 *   DENSITY      per-category ceilings and floors. Nothing beats pure fat at
 *                900 kcal/100g, so anything above that is an error, and a
 *                declared oil below 700 means a serving-size mix-up.
 *
 *   MICROS       nutrients within plausible per-100g bounds, to catch unit
 *                slips (mg entered where mcg was meant, a 1000x error).
 *
 *   DUPLICATES   same food seeded twice with materially different numbers.
 *
 * Run:  node scripts/validate-foods.js          (report only)
 *       node scripts/validate-foods.js --strict (exit 1 on any error)
 */

const path = require('path');
const { macroPlausibility } = require('../services/macroCheck');
const Module = require('module');

// The seed files connect to Postgres on require. Stub the pool so this can run
// as a pure data check with no database and no risk of writing anything.
const origResolve = Module._resolveFilename;
const stubPath = path.join(__dirname, '__pool_stub__.js');
require.cache[stubPath] = {
  id: stubPath, filename: stubPath, loaded: true, exports: {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
    end: async () => {},
  },
};
Module._resolveFilename = function (request, ...rest) {
  if (request.endsWith('db/pool')) return stubPath;
  return origResolve.call(this, request, ...rest);
};

function loadFoods(file) {
  const src = require('fs').readFileSync(path.join(__dirname, file), 'utf8');
  // Take everything from the FOODS array up to its closing bracket, and the
  // n() helper above it, then evaluate that alone — far safer than running
  // the seeder itself.
  const helperStart = src.indexOf('function n(');
  const helperEnd = src.indexOf('\nconst FOODS');
  const helper = src.slice(helperStart, helperEnd);
  const arrStart = src.indexOf('const FOODS = [');
  const arrEnd = src.indexOf('\n];', arrStart) + 3;
  const arr = src.slice(arrStart, arrEnd);
  // eslint-disable-next-line no-new-func
  return new Function(`${helper}\n${arr}\nreturn FOODS;`)();
}

// ── category expectations, kcal per 100g ─────────────────────────────────────
//
// These have to be narrow or they generate noise instead of findings. The
// first pass matched "coconut water" against the nuts rule and "butter
// chicken" against butter, burying two real errors under 46 false ones.
//
// EXCLUDE catches compound foods where the keyword is an ingredient rather
// than the food: coconut milk is not a nut, sugarcane juice is not sugar.
const EXCLUDE = /\b(water|milk|juice|curry|chicken|masala|gravy|sabzi|bhurji|smoothie|shake|chutney|cake|biscuit|cookie|bar|halwa|barfi|laddu|kheer|payasam|syrup|sharbat|pickle|coffee|tea|fried|roasted|paneer|no sugar|sugar[- ]free|low oil)\b/i;

// Foods whose name declares a serving unit are stored per unit by design
// (a 1g capsule, a 5ml teaspoon), so per-100g rules do not apply to them.
const PER_UNIT = /\(\s*\d|\bcapsule|\btablet|\bdrops?\b|\bper\s|\btsp\b|\btbsp\b|\bml\b|\bIU\b|\bmcg\b|\binjection\b|\bsachet\b/i;

const DENSITY = [
  [/\b(oil|ghee)\b/i,                              700, 920],
  [/\b(peanut|almond|cashew|nut)\s+butter\b/i,      520, 700],
  [/\bbutter\b/i,                                  600, 920],
  [/\b(whey|casein)\b|protein (powder|isolate)/i,  320, 460],
  [/\b(almonds?|cashews?|walnuts?|pistachios?)\b/i, 400, 700],
  [/\b(sugar|jaggery|honey)\b/i,                   260, 420],
];

const MICRO_MAX = {          // per 100g, generous ceilings
  vit_a: 30000, vit_b1: 50, vit_b2: 50, vit_b3: 200, vit_b5: 100,
  vit_b6: 50, vit_b12: 200, vit_c: 3000, vit_d: 2000, vit_e: 300,
  vit_k: 5000, folate: 5000, biotin: 500, choline: 2500,
  calcium: 3000, iron: 200, magnesium: 1200, phosphorus: 2000,
  potassium: 5000, sodium: 40000, zinc: 200, copper: 50,
  manganese: 100, selenium: 2000,
};

const results = { error: [], warn: [] };
const add = (level, name, msg) => results[level].push({ name, msg });

function checkFood(name, category, p) {
  const cal = +p.calories || 0;
  const pro = +p.protein || 0;
  const carb = +p.total_carbs || 0;
  const fat = +p.fat || 0;

  // ── mass ──
  const mass = pro + carb + fat;
  if (mass > 100.5) add('error', name, `macros total ${mass.toFixed(1)}g per 100g`);

  // ── subset ──
  if ((+p.fiber || 0) > carb + 0.5)          add('error', name, `fibre ${p.fiber} > carbs ${carb}`);
  if ((+p.sugar || 0) > carb + 0.5)          add('error', name, `sugar ${p.sugar} > carbs ${carb}`);
  if ((+p.saturated_fat || 0) > fat + 0.5)   add('error', name, `sat fat ${p.saturated_fat} > fat ${fat}`);
  if ((+p.trans_fat || 0) > fat + 0.5)       add('error', name, `trans fat ${p.trans_fat} > fat ${fat}`);
  if ((+p.net_carbs || 0) > carb + 0.5)      add('warn',  name, `net carbs ${p.net_carbs} > total ${carb}`);

  // ── Atwater ──
  // Shared with the live review queue via services/macroCheck.js — one
  // implementation, so the seed audit and the coach's queue can never disagree
  // about whether a food's calories match its macros. The 25% tolerance here is
  // kept deliberately: it has run against this corpus for months, and tightening
  // it would re-flag hundreds of already-reviewed rows as a side effect of an
  // unrelated sprint. The queue runs at 20%, which is stated where it is set.
  const check = macroPlausibility(p, name, { tolerance: 0.25, floorKcal: 30 });
  if (check.status === 'suspect') {
    const atwater = check.atwater;
    add(cal < atwater * 0.5 || cal > atwater * 1.6 ? 'error' : 'warn', name,
      `stated ${cal} kcal vs ${Math.round(atwater)} from macros (P${pro} C${carb} F${fat})`);
  }

  // ── density ──
  if (cal > 920) add('error', name, `${cal} kcal/100g exceeds pure fat`);
  const skipDensity = EXCLUDE.test(name) || PER_UNIT.test(name)
                      || /supplement/i.test(category || '');
  for (const [rx, lo, hi] of (skipDensity ? [] : DENSITY)) {
    if (rx.test(name)) {
      if (cal < lo) add('error', name, `${cal} kcal/100g is low for this category (expect ${lo}-${hi}) — possible per-serving value`);
      if (cal > hi) add('warn',  name, `${cal} kcal/100g is high for this category (expect ${lo}-${hi})`);
      break;
    }
  }

  // ── micros ──
  // A B12 injection legitimately holds 1000mcg in one unit; the ceilings only
  // make sense for foods actually measured per 100g.
  for (const [k, max] of (PER_UNIT.test(name) ? [] : Object.entries(MICRO_MAX))) {
    const v = +p[k] || 0;
    if (v > max) add('error', name, `${k} = ${v} per 100g exceeds plausible max ${max} — unit slip?`);
    if (v < 0)   add('error', name, `${k} is negative`);
  }
  if (cal < 0 || pro < 0 || carb < 0 || fat < 0) add('error', name, 'negative macro');
}

// ── run ──────────────────────────────────────────────────────────────────────
const files = ['seed-nin-india.js', 'seed-usda.js'];
const seen = new Map();
let total = 0;

for (const f of files) {
  let foods;
  try { foods = loadFoods(f); }
  catch (e) { console.error(`could not read ${f}: ${e.message}`); continue; }

  for (const row of foods) {
    // NIN rows: [name, hindi, local, category, per100g]
    // USDA rows: [name, hindi, local, category, source, per100g]
    const name = row[0];
    const per = row[row.length - 1];
    const category = row[3];
    if (!name || typeof per !== 'object') continue;
    total++;
    checkFood(name, category, per);

    const key = name.toLowerCase().replace(/\s*\(.*$/, '').trim();
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push({ name, cal: +per.calories || 0, file: f });
  }
}

// ── duplicates that disagree ────────────────────────────────────────────────
for (const [key, entries] of seen) {
  if (entries.length < 2) continue;
  const cals = entries.map(e => e.cal);
  const spread = Math.max(...cals) - Math.min(...cals);
  if (spread > Math.max(60, Math.min(...cals) * 0.4)) {
    add('warn', key, `${entries.length} entries disagree by ${spread} kcal: ` +
      entries.map(e => `${e.name}=${e.cal}`).join(', '));
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const show = (level, label) => {
  const rows = results[level];
  if (!rows.length) { console.log(`\n${label}: none`); return; }
  console.log(`\n${label} (${rows.length}):`);
  for (const r of rows) console.log(`  ${r.name}\n      ${r.msg}`);
};

console.log(`Checked ${total} foods from ${files.length} seed files.`);
show('error', 'ERRORS');
show('warn', 'WARNINGS');
console.log(`\n${results.error.length} errors, ${results.warn.length} warnings`);

if (process.argv.includes('--strict') && results.error.length) process.exit(1);
