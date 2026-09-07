/**
 * scripts/test-day-lib.js — the day's pure logic, imported from the REAL
 * client modules under client/src/lib/day/ (no mirroring).
 *
 * WHY THESE NUMBERS
 * -----------------
 * Sprint 0 moved calcFoodMacros, calcMicros, addSupplementMicros,
 * addActivityMicros, countMicrosMet, calcBMR, deriveActivityTicks and the
 * sleep/pending helpers out of pages/DailyLog.jsx. Every expected value below
 * was produced by running the ORIGINAL inline functions (the pre-move page
 * source) on the same fixtures. So this suite proves the move changed
 * nothing — and from now on, that nobody changes the maths by accident.
 *
 * Each block was mutation-checked: alter the function, the block goes red.
 */
const { importClient } = require('./lib/client-bundle');

let pass = 0, fail = 0;
const ck = (name, cond, detail) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else      { fail++; console.log('  \u2717 ' + name + ' ' + JSON.stringify(detail === undefined ? '' : detail).slice(0, 220)); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const eq   = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const day = importClient('lib/day/index.js');

// ── Fixtures (identical to the golden run) ──────────────────────────────────
const foods = [
  { name: 'idli',   grams: 120, per_100g: { calories: 130, protein: 3.5, total_carbs: 28, net_carbs: 26, fat: 0.8, vit_b12: 0.1, calcium: 12, iron: 1.1, fiber: 1.2, sodium: 250, potassium: 80, magnesium: 14, zinc: 0.4, folate: 20, vit_d: 0 } },
  { name: 'sambar', grams: 200, per_100g: { calories: 60, protein: 2.8, total_carbs: 9, fat: 1.5, vit_a: 120, vit_c: 8, calcium: 30, iron: 1.5, fiber: 2.5, sodium: 400, potassium: 180, magnesium: 22, zinc: 0.5, folate: 35, omega3_ala: 20 } },
  { name: 'chapati', grams: 80 },        // no per_100g, not in the static table → contributes nothing
  { name: 'unknownfood', grams: 50 },
];
const sup    = { b12: true, d3: true, fishoil: false, multi: true };
const acts   = { sun: true, walk: false };
const active = [{ id: 'sun', vitD_iu: 1000 }, { id: 'walk' }];

// ── 1. Macros ───────────────────────────────────────────────────────────────
console.log('\n[1] calcFoodMacros');
{
  const m = day.calcFoodMacros(foods);
  ck('kcal 276 (130×1.2 + 60×2; foods without data add nothing)', m.kcal === 276, m);
  ck('protein 9.8', near(m.pro, 9.8), m.pro);
  ck('net carbs win over total carbs → 49.2', near(m.carb, 49.2), m.carb);
  ck('fat 3.96', near(m.fat, 3.96), m.fat);
  ck('empty list → all zero', eq(day.calcFoodMacros([]), { kcal: 0, pro: 0, carb: 0, fat: 0 }));
  // Static-table fallback: a name the constants file knows.
  const legacy = day.calcFoodMacros([{ name: 'Avocado', grams: 50 }]);
  ck('static-table fallback still works for pre-food-DB foods (Avocado 50g → 80 kcal)', legacy.kcal === 80, legacy);
}

// ── 2. Micros ───────────────────────────────────────────────────────────────
console.log('\n[2] calcMicros / supplements / activities');
{
  const raw = day.calcMicros(foods);
  ck('31 nutrient keys, all present', Object.keys(raw).length === 31 && day.MICRO_TOTAL === 31, Object.keys(raw).length);
  ck('vit_a 240', near(raw.vit_a, 240), raw.vit_a);
  ck('calcium 74.4', near(raw.calcium, 74.4), raw.calcium);
  ck('sodium 1100', near(raw.sodium, 1100), raw.sodium);
  ck('fiber 6.44', near(raw.fiber, 6.44, 1e-6), raw.fiber);
  ck('omega3_ala 40', near(raw.omega3_ala, 40), raw.omega3_ala);
  ck('food without per_100g contributes nothing', near(day.calcMicros([{ name: 'chapati', grams: 80 }]).iron, 0));

  const withS = day.addSupplementMicros(raw, sup);
  ck('b12 supplement adds 1000 → 1002.52', near(withS.vit_b12, 1002.52, 1e-6), withS.vit_b12);
  ck('d3 (60000 IU/7) + multi 600 → vit_d 9171', near(withS.vit_d, 9171), withS.vit_d);
  ck('multi adds calcium 200 → 274.4', near(withS.calcium, 274.4), withS.calcium);
  ck('fishoil off → no EPA', withS.omega3_epa === 0);
  ck('input object not mutated', raw.vit_b12 === 0.12);

  const withA = day.addActivityMicros(withS, acts, active);
  ck('ticked sunlight adds its vitamin D → 10171', near(withA.vit_d, 10171), withA.vit_d);
  ck('unticked activity adds nothing', near(day.addActivityMicros(withS, {}, active).vit_d, 9171));
}

// ── 3. Targets met ───────────────────────────────────────────────────────────
console.log('\n[3] countMicrosMet');
{
  const r = day.countMicrosMet({ foodItems: foods, supplements: sup, activities: acts, activeActivities: active });
  ck('19 of 31 targets met', r.met === 19 && r.total === 31 && r.hasData === true, r);
  const none = day.countMicrosMet({ foodItems: [{ name: 'chapati', grams: 80 }] });
  ck('no per_100g food → hasData false, met 0', eq(none, { met: 0, total: 31, hasData: false }), none);
  const ov = day.countMicrosMet({ foodItems: foods, supplements: sup, activities: acts, activeActivities: active, rdaOverrides: { calcium: '10' } });
  ck('coach RDA override (calcium 10) flips one more target → 20', ov.met === 20, ov);
}

// ── 4. Energy ───────────────────────────────────────────────────────────────
console.log('\n[4] calcBMR / foodKcal / dayBalance');
{
  ck('male 82.4kg 172cm 41y → 1699',   day.calcBMR({ weightKg: 82.4, heightCm: 172, age: 41, gender: 'male' }) === 1699);
  ck('Female (any case) 64/158/35 → 1292', day.calcBMR({ weightKg: 64, heightCm: 158, age: 35, gender: 'Female' }) === 1292);
  ck('sex unknown → midpoint 1503',   day.calcBMR({ weightKg: 70, heightCm: 165, age: 30, gender: '' }) === 1503);
  ck('missing height → null, not a guess', day.calcBMR({ weightKg: 70, heightCm: 0, age: 30 }) === null);
  ck('missing age → null',            day.calcBMR({ weightKg: 70, heightCm: 165, age: null }) === null);

  ck('foodKcal matches calcFoodMacros.kcal on the same list', day.foodKcal(foods) === 276);
  ck('foodKcal uses the static table when per_100g is absent (Avocado 50g → 80)', day.foodKcal([{ name: 'Avocado', grams: 50 }]) === 80);
  ck('foodKcal tolerates a null item', day.foodKcal([null, foods[0]]) === 156);

  const b = day.dayBalance({ bmr: 1699, kcalIn: 1240, workoutKcal: 180 });
  ck('balance: 1240 − (round(1699×1.2)=2039 + 180) = −979 deficit', b.out === 2219 && b.balance === -979 && b.surplus === false, b);
  ck('surplus flagged', day.dayBalance({ bmr: 1500, kcalIn: 2500 }).surplus === true);
  ck('no BMR → null (UI shows a hint, not a fake deficit)', day.dayBalance({ bmr: null, kcalIn: 1200 }) === null);
  ck('nothing eaten → null', day.dayBalance({ bmr: 1699, kcalIn: 0 }) === null);
}

// ── 5. Ticks ────────────────────────────────────────────────────────────────
console.log('\n[5] deriveActivityTicks');
{
  ck('a set with reps ticks resistance',            eq(day.deriveActivityTicks({ sets: [{ reps: '8' }], cardio: [] }), { walk: false, resistance: true }));
  ck('walking with minutes ticks walk; zero-rep set does not', eq(day.deriveActivityTicks({ sets: [{ reps: 0 }], cardio: [{ type: 'walking', duration_min: '25' }] }), { walk: true, resistance: false }));
  ck('cycling is not foot cardio',                  eq(day.deriveActivityTicks({ sets: [], cardio: [{ type: 'cycling', duration_min: 30 }] }), { walk: false, resistance: false }));
  ck('empty input → nothing ticked',                eq(day.deriveActivityTicks({}), { walk: false, resistance: false }));
  ck('AUTO_TICK_IDS is walk + resistance',          eq(day.AUTO_TICK_IDS, ['walk', 'resistance']));
}

// ── 6. Sleep ────────────────────────────────────────────────────────────────
console.log('\n[6] sleep');
{
  ck('timeToMin 22:30 → 1350',        day.timeToMin('22:30') === 1350);
  ck('timeToMin tolerates seconds',   day.timeToMin('06:15:00') === 375);
  ck('timeToMin empty → 0',           day.timeToMin('') === 0 && day.timeToMin(null) === 0);
  ck('22:30 → 06:15 crosses midnight = 465 min', day.sleepMinutes('22:30', '06:15') === 465);
  ck('01:00 → 08:30 same day = 450',  day.sleepMinutes('01:00', '08:30') === 450);
  ck('equal times read as a full 24h, as the page always did', day.sleepMinutes('22:00', '22:00') === 1440);
  ck('missing either time → null',    day.sleepMinutes('22:30', '') === null && day.sleepMinutes(null, '06:00') === null);
  ck('formatSleep 465 → "7h 45m"',    day.formatSleep(465) === '7h 45m');
  ck('formatSleep null → ""',         day.formatSleep(null) === '');
  ck('tone bands: 7–9h great, <6h short, else ok',
     day.sleepTone(465) === 'great' && day.sleepTone(330) === 'short' && day.sleepTone(390) === 'ok' && day.sleepTone(600) === 'ok');
}

// ── 7. Pending ──────────────────────────────────────────────────────────────
console.log('\n[7] pendingLabels');
{
  const base = {
    activeActivities: [{ id: 'walk' }, { id: 'sun' }, { id: 'steps' }],
    activeACV: [{ id: 'acv1' }],
    activeSupplements: [{ id: 'b12' }, { id: 'd3' }],
  };
  const p1 = day.pendingLabels({ ...base, log: { activities: { walk: true }, acv: {}, supplements: { b12: true }, sleep: {} }, activitiesLabel: 'Activity' });
  ck('counts what is left, pluralised', eq(p1, ['2 activities', '1 ACV dose', '1 supplement', 'sleep times']), p1);
  const p2 = day.pendingLabels({ ...base, log: { activities: { walk: true }, acv: {}, supplements: { b12: true }, sleep: {} }, activitiesLabel: 'Activities' });
  ck('a coach label already plural is left alone (no "activitieses")', p2[0] === '2 activities', p2);
  const p3 = day.pendingLabels({ ...base, log: { activities: { walk: true, sun: true, steps: true }, acv: { acv1: true }, supplements: { b12: true, d3: true }, sleep: { bedtime: '22:30', waketime: '06:15' } } });
  ck('everything done → empty', eq(p3, []), p3);
  const p4 = day.pendingLabels({ ...base, log: {}, activitiesLabel: 'Habit' });
  ck('nothing logged → all counts', eq(p4, ['3 habits', '1 ACV dose', '2 supplements', 'sleep times']), p4);
}

// ── 7b. nextAction — the one button on Today's read ──────────────────────
console.log('\n[7b] nextAction');
{
  const base = { isToday: true, weight: '82', foodCount: 2, waterMl: 2000, waterTarget: 3000, protocolDone: 5, protocolTotal: 5, sleepSet: true, workoutPlanned: false, workoutLogged: false };
  const a = (o) => day.nextAction({ ...base, ...o });
  ck('past day → nothing',                            a({ isToday: false, weight: null }) === null);
  ck('no weight before 11 → log weight first',       a({ weight: null, hour: 8 })?.sheet === 'weight');
  ck('nothing eaten after 9 → log food',              a({ foodCount: 0, hour: 13 })?.sheet === 'food');
  ck('food logged, workout planned, not done → start the workout', a({ workoutPlanned: true, hour: 12 })?.sheet === 'workout');
  ck('workout logged → not asked again',              a({ workoutPlanned: true, workoutLogged: true, hour: 12 }) === null);
  ck('protocol items left → tick, with the count',    eq(a({ protocolDone: 3, hour: 12 }), { sheet: 'protocol', label: 'Tick the protocol · 2 left' }));
  ck('water under half target after 14:00 → water',   a({ waterMl: 1000, hour: 15 })?.sheet === 'water');
  ck('water not nagged before 14:00',                 a({ waterMl: 1000, hour: 10 }) === null);
  ck('sleep unset in the evening → sleep',            a({ sleepSet: false, hour: 20 })?.sheet === 'sleep');
  ck('complete day → nothing',                        a({ hour: 21 }) === null);
  ck('priority order: food beats protocol',           a({ foodCount: 0, protocolDone: 0, hour: 12 })?.sheet === 'food');
}

// ── 8. The page and Profile import from lib/day — no private copies left ────
console.log('\n[8] no mirrored copies');
{
  const fs = require('fs'), path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '../../client/src', p), 'utf8');
  // Sprint 3 moved the page's logic into hooks/useTodayModel.js; DailyLog.jsx
  // is a wrapper. The maths must be imported, never copied, wherever it lives.
  const model = read('hooks/useTodayModel.js'), profile = read('pages/Profile.jsx');
  const widgets = read('components/today/DayWidgets.jsx'), daily = read('pages/DailyLog.jsx');
  ck('useTodayModel imports from lib/day',  /from '\.\.\/lib\/day'/.test(model));
  ck('DayWidgets imports from lib/day',     /from '\.\.\/\.\.\/lib\/day'/.test(widgets));
  ck('Profile imports from lib/day',        /from '\.\.\/lib\/day'/.test(profile));
  ck('DailyLog.jsx carries no maths at all (it is a wrapper)', !/calc|kcal|reduce\(/.test(daily));
  ck('no local calcBMR left anywhere on the member side', ![model, profile, widgets].some(src => /function calcBMR/.test(src)));
  ck('no local calcMicros / countMicrosMet copies', ![model, widgets].some(src => /function calcMicros|function countMicrosMet/.test(src)));
  ck('no inline calorie reduce (foodKcal is the one definition)', !/per_100g\.calories \* \(it\.grams \|\| 0\) \/ 100\);\s*\n\s*const n = getNutrition/.test(model));
  ck('no inline midnight-wrap sleep maths', !/mins \+= 24 \* 60/.test(model) && !/mins \+= 24 \* 60/.test(read('components/sheets/SleepSheet.jsx')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
