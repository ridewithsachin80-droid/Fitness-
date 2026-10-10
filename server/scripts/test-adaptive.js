/**
 * scripts/test-adaptive.js — the adaptive metabolic engine.
 *
 * The engine claims to recover a member's true maintenance calories from
 * their logs. These assertions simulate members whose real metabolism is
 * known, feed the engine only what the app would actually have, and check
 * how close it gets — plus that it refuses to answer when it should.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const { analyse, smooth, regress, KCAL_PER_KG, hasFigure, MIN_COVERAGE, MIN_DAYS_MICRO } = require('../services/adaptiveEngine');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q, _r, n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/patients', require('../routes/patients'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e || '').slice(0, 200))); };

function simulate({ days, trueTDEE, intake, startW, noise = 0.8, foodEvery = 1, seed = 7 }) {
  let s = seed; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const logs = []; let w = startW;
  const start = new Date(); start.setDate(start.getDate() - days);
  for (let d = 0; d < days; d++) {
    const date = new Date(start); date.setDate(date.getDate() + d);
    w += (intake - trueTDEE) / KCAL_PER_KG;
    logs.push({
      log_date: date.toISOString().slice(0, 10),
      weight_kg: (w + (rnd() - 0.5) * 2 * noise).toFixed(1),
      food_items: d % foodEvery === 0
        ? [{ name: 'Day', grams: 1000, per_100g: {
            calories: intake / 10, protein: 9, total_carbs: 11, fat: 3,
            iron: 0.6, calcium: 30, vit_c: 1.2, fiber: 1.5 } }]
        : [],
    });
  }
  return logs;
}

(async () => {
  console.log('\n[1] maths primitives');
  ck('smoothing flattens a spike', (() => {
    const sm = smooth([70, 70, 75, 70, 70], 3);
    return sm[2] < 73 && sm[2] > 70;
  })());
  ck('regression finds a known slope', (() => {
    const { slope, r2 } = regress([0, 1, 2, 3, 4], [10, 12, 14, 16, 18]);
    return Math.abs(slope - 2) < 0.001 && r2 > 0.99;
  })());

  console.log('\n[2] recovering a known metabolism');
  for (const c of [
    { label: 'losing  (TDEE 2400, eats 1900)', trueTDEE: 2400, intake: 1900, startW: 83 },
    { label: 'slow    (TDEE 2100, eats 1950)', trueTDEE: 2100, intake: 1950, startW: 78 },
    { label: 'gaining (TDEE 2500, eats 2800)', trueTDEE: 2500, intake: 2800, startW: 65 },
  ]) {
    const r = analyse(simulate({ days: 30, ...c }), { bmr: 1760, goalWeight: 75 });
    const err = Math.abs((r.observed_tdee - c.trueTDEE) / c.trueTDEE * 100);
    ck(`${c.label} -> ${r.observed_tdee} (within 5%)`, err < 5, { found: r.observed_tdee, err: err.toFixed(1) });
  }

  console.log('\n[3] a noisy scale does not break it');
  const noisy = analyse(simulate({ days: 30, trueTDEE: 2400, intake: 1900, startW: 83, noise: 1.5 }),
                        { bmr: 1760 });
  ck('±1.5kg daily swing still within 5%',
     Math.abs((noisy.observed_tdee - 2400) / 2400 * 100) < 5, noisy.observed_tdee);

  console.log('\n[4] it refuses when it should');
  const short = analyse(simulate({ days: 10, trueTDEE: 2400, intake: 1900, startW: 83 }), { bmr: 1760 });
  ck('10 days -> no answer', short.observed_tdee === null && short.confidence === 'insufficient', short.reason);
  const patchy = analyse(simulate({ days: 30, trueTDEE: 2400, intake: 1900, startW: 83, foodEvery: 3 }), { bmr: 1760 });
  ck('food logged 1 day in 3 -> no answer', patchy.observed_tdee === null, patchy.reason);
  ck('and it says why', typeof patchy.reason === 'string' && patchy.reason.length > 5, patchy.reason);
  const empty = analyse([], { bmr: 1760 });
  ck('no data at all -> no crash', empty.observed_tdee === null && empty.confidence === 'insufficient');

  console.log('\n[5] confidence tracks data quality');
  const good = analyse(simulate({ days: 40, trueTDEE: 2400, intake: 1900, startW: 83, noise: 0.5 }), { bmr: 1760 });
  ck('40 clean days -> high', good.confidence === 'high', good.confidence);
  const meh = analyse(simulate({ days: 16, trueTDEE: 2400, intake: 1900, startW: 83, noise: 1.2 }), { bmr: 1760 });
  ck('16 days -> not high', meh.confidence !== 'high', meh.confidence);

  console.log('\n[6] targets are sane');
  const t = analyse(simulate({ days: 30, trueTDEE: 2400, intake: 1900, startW: 83 }),
                    { bmr: 1760, goalWeight: 75 }).targets;
  ck('kcal below maintenance for a loss goal', t.kcal < 2400, t.kcal);
  ck('kcal never below 1200', t.kcal >= 1200, t.kcal);
  ck('protein 1.5-2.5 g/kg', t.protein_g / 83 >= 1.5 && t.protein_g / 83 <= 2.5, (t.protein_g / 83).toFixed(2));
  ck('fat at least 0.8 g/kg', t.fat_g / 83 >= 0.8, (t.fat_g / 83).toFixed(2));
  ck('macros reconcile with the kcal target',
     Math.abs((t.protein_g * 4 + t.carbs_g * 4 + t.fat_g * 9) - t.kcal) < 60,
     { fromMacros: t.protein_g * 4 + t.carbs_g * 4 + t.fat_g * 9, kcal: t.kcal });
  ck('loss rate under 1% of body weight per week', Math.abs(t.weekly_change_kg) / 83 < 0.01, t.weekly_change_kg);

  console.log('\n[7] micronutrient gaps');
  const gaps = analyse(simulate({ days: 30, trueTDEE: 2400, intake: 1900, startW: 83 }), { bmr: 1760 }).micro_gaps;
  ck('gaps reported', Array.isArray(gaps) && gaps.length > 0, gaps?.length);
  ck('each has a percentage under 70', gaps.every(g => g.pct < 70), gaps.map(g => g.pct));
  ck('worst gap listed first', gaps.every((g, i) => i === 0 || g.pct >= gaps[i - 1].pct), gaps.map(g => g.pct));

  // ── Unknown is not zero ────────────────────────────────────────────────────
  // A nutrient the food table has no figure for is stored as 0. The report
  // used to read that 0 as "ate none", so every member was "consistently
  // under target" for zinc, folate and vitamin E whatever they ate.
  console.log('\n[7b] a nutrient with no figure is not a nutrient not eaten');
  {
    const days = (n, items) => Array.from({ length: n }, (_, i) => ({
      log_date: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10), weight_kg: '80.0', food_items: items }));
    // Composition-table rows: minerals carried, zinc/folate/vitamin E not.
    const rice = { name: 'Rice',  grams: 300, per_100g: { calories: 130, protein: 2.7, total_carbs: 28, fat: 0.3, fiber: 0.4, calcium: 10, iron: 0.2, magnesium: 12, potassium: 35 } };
    const dal  = { name: 'Dal',   grams: 200, per_100g: { calories: 116, protein: 9, total_carbs: 20, fat: 0.4, fiber: 8, calcium: 19, iron: 3.3, magnesium: 36, potassium: 369 } };
    const ghee = { name: 'Ghee',  grams: 15,  per_100g: { calories: 900, protein: 0, total_carbs: 0, fat: 100 } };
    const guess = { name: 'Dosa (macros only)', grams: 150, per_100g: { calories: 170, protein: 4, total_carbs: 29, fat: 4 } };
    const byName = (list) => Object.fromEntries(list.map(g => [g.nutrient, g]));

    const table = analyse(days(10, [rice, dal, ghee]));
    const tg = byName(table.micro_gaps), tu = byName(table.micro_unknown);
    ck('zinc, folate and vitamin E — never recorded on these foods — are NOT reported as gaps',
       !tg.zinc && !tg.folate && !tg.vit_e, Object.keys(tg));
    ck('they are named as "cannot be judged" instead, with how little of the food carries a figure',
       tu.zinc && tu.folate && tu.vit_e && tu.vit_e.coverage === 0, table.micro_unknown);
    ck('vitamin A and omega-3 too: recorded too patchily to tell a 0 from a blank', tu.vit_a && tu.omega3_ala && !tg.vit_a && !tg.omega3_ala, Object.keys(tu));
    ck('a nutrient these foods do carry is still reported when it is low (calcium 68 mg of 1000 → 7%)',
       tg.calcium && tg.calcium.pct === 7 && tg.calcium.coverage === 100, tg.calcium);
    ck('B12 on real plant foods is a true zero and IS reported (0%), not hidden as unknown', tg.vit_b12 && tg.vit_b12.pct === 0 && !tu.vit_b12, [tg.vit_b12, tu.vit_b12]);
    ck('ghee carries no minerals and that is a fact, so it does not lower the mineral coverage', tg.calcium.coverage === 100 && hasFigure(ghee.per_100g, 'iron') === true && hasFigure(ghee.per_100g, 'vit_e') === false);
    ck('nothing is both a gap and unknown', table.micro_gaps.every(g => !tu[g.nutrient]));
    ck('unknowns are listed least-covered first', table.micro_unknown.every((u, i) => i === 0 || u.coverage >= table.micro_unknown[i - 1].coverage), table.micro_unknown.map(u => u.coverage));

    // A food with macros only says nothing about any micronutrient — not even
    // the "real zero" ones. 150 g × 2 of it is 40% of the day's calories.
    const mixed = analyse(days(10, [rice, dal, ghee, guess, guess]));
    const mu = byName(mixed.micro_unknown);
    ck('with 40% of calories from a macros-only food, coverage is 60%: below the bar, so NOTHING is claimed',
       MIN_COVERAGE === 0.7 && mixed.micro_gaps.length === 0 && mu.calcium && mu.calcium.coverage === 60 && mu.vit_b12 && mu.vit_b12.coverage === 60, [mixed.micro_gaps, mixed.micro_unknown]);
    ck('a macros-only food is not a "real zero" for B12 or fibre', hasFigure(guess.per_100g, 'vit_b12') === false && hasFigure(guess.per_100g, 'fiber') === false && hasFigure(rice.per_100g, 'vit_b12') === true);

    // Exactly on the bar, and one step under it. Calories: table foods 700, guess 300 → 70%.
    const tbl = { name: 'Table food', grams: 700, per_100g: { calories: 100, protein: 5, total_carbs: 15, fat: 2, fiber: 1, calcium: 20, iron: 1, magnesium: 20, potassium: 100 } };
    const g300 = { name: 'Guess', grams: 300, per_100g: { calories: 100, protein: 5, total_carbs: 15, fat: 2 } };
    const g310 = { ...g300, grams: 310 };
    const onBar = byName(analyse(days(10, [tbl, g300])).micro_gaps);
    ck('at exactly 70% coverage the nutrient is judged', onBar.calcium && onBar.calcium.coverage === 70, onBar.calcium);
    // 140 mg calcium counted over 70% of the calories → assume the other 30% was as rich: 200 mg → 20% of 1000.
    ck('…and the part with no figure is assumed as rich as the rest (140 mg counted → 200 mg → 20%), not empty (14%)', onBar.calcium.avg === 200 && onBar.calcium.pct === 20, onBar.calcium);
    const under = analyse(days(10, [tbl, g310]));
    ck('one step under 70% it is not judged', !byName(under.micro_gaps).calcium && byName(under.micro_unknown).calcium && byName(under.micro_unknown).calcium.coverage === 69, under.micro_unknown);

    // A nutrient that is fine must not appear anywhere.
    const rich = { name: 'Rich', grams: 1000, per_100g: { calories: 200, protein: 8, total_carbs: 30, fat: 5, fiber: 4, calcium: 120, iron: 2.5, magnesium: 45, potassium: 400, vit_c: 9, vit_b12: 0.3, vit_d: 90 } };
    const fine = analyse(days(10, [rich]));
    ck('enough of everything it carries → no gap and no "unknown" for those', ['fiber', 'calcium', 'iron', 'magnesium', 'potassium', 'vit_c', 'vit_b12', 'vit_d'].every(k => !byName(fine.micro_gaps)[k] && !byName(fine.micro_unknown)[k]), [fine.micro_gaps, fine.micro_unknown]);

    // "Consistently" needs days.
    const four = analyse(days(4, [rice, dal])), five = analyse(days(5, [rice, dal]));
    ck('4 logged days: no gaps, no unknowns, and it says why', MIN_DAYS_MICRO === 5 && four.micro_gaps.length === 0 && four.micro_unknown.length === 0 && four.micro_reason === '4 of 5 days of food logged', [four.micro_gaps.length, four.micro_reason]);
    ck('5 logged days: reported', five.micro_gaps.length > 0 && five.micro_reason === null, [five.micro_gaps.length, five.micro_reason]);
    const none = analyse([]);
    ck('no logs at all: empty lists, no crash', Array.isArray(none.micro_gaps) && none.micro_gaps.length === 0 && Array.isArray(none.micro_unknown) && none.micro_unknown.length === 0);

    // The six lowest used to be six invented ones. Real gaps must not be crowded out.
    const sixReal = table.micro_gaps.map(g => g.nutrient);
    ck('the list of six holds only nutrients with figures', sixReal.length <= 6 && sixReal.every(k => !['zinc', 'folate', 'vit_e', 'vit_a', 'omega3_ala'].includes(k)), sixReal);
  }

  console.log('\n[8] endpoints and access control');
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const { rows: [coach] } = await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ('C','2001','x','monitor',true) RETURNING id`);
  const { rows: [pat] }   = await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ('P','2002','x','patient',true) RETURNING id`);
  const { rows: [other] } = await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ('O','2003','x','patient',true) RETURNING id`);
  await pool.query(`INSERT INTO patient_profiles (user_id,height_cm,gender,dob,target_weight) VALUES ($1,181,'male','1985-04-10',75)`, [pat.id]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true)`, [coach.id, pat.id]);
  for (const l of simulate({ days: 30, trueTDEE: 2400, intake: 1900, startW: 83 })) {
    await pool.query(`INSERT INTO daily_logs (patient_id,log_date,weight_kg,food_items) VALUES ($1,$2,$3,$4)`,
      [pat.id, l.log_date, l.weight_kg, JSON.stringify(l.food_items)]);
  }
  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u, r) => jwt.sign({ id: u, role: r, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const call = async (path, t) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: 'Bearer ' + t } });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  let r = await call('/api/patients/me/adaptive', tok(pat.id, 'patient'));
  ck('member sees their own analysis', r.status === 200 && r.data.observed_tdee > 0, r.data.observed_tdee);
  ck('and it lands near the true 2400', Math.abs(r.data.observed_tdee - 2400) < 150, r.data.observed_tdee);
  ck('the response carries the gaps WITH their coverage, and the list of what could not be judged',
     r.data.micro_gaps.length > 0 && r.data.micro_gaps.every(g => g.coverage >= 70) && Array.isArray(r.data.micro_unknown)
     && r.data.micro_unknown.some(u => u.nutrient === 'zinc') && !r.data.micro_gaps.some(g => g.nutrient === 'zinc'), [r.data.micro_gaps, r.data.micro_unknown]);

  r = await call(`/api/patients/${pat.id}/adaptive`, tok(coach.id, 'monitor'));
  ck('coach sees their assigned member', r.status === 200 && r.data.observed_tdee > 0, r.status);
  r = await call(`/api/patients/${other.id}/adaptive`, tok(coach.id, 'monitor'));
  ck('coach blocked from an unassigned member', r.status === 403, r.status);
  r = await call(`/api/patients/${other.id}/adaptive`, tok(pat.id, 'patient'));
  ck('member blocked from the coach route', r.status === 403, r.status);

  srv.close();
  // ── Threshold boundaries ───────────────────────────────────────────────────
  // A mutation sweep flipped every `>=` in this file to `>` and this suite
  // noticed one change in six. The comparisons it missed are the ones that
  // decide whether a member is told a maintenance number at all, and how much
  // confidence to put on it — so an off-by-one there does not crash, it just
  // quietly answers "insufficient data" to someone who has logged for a
  // fortnight, or stamps "high confidence" on a fortnight of noise.
  //
  // Boundary cases only. Each pair sits exactly ON the threshold and one step
  // below it, which is the only place an off-by-one is visible.
  console.log('\n[boundaries] the thresholds that gate the answer');

  const at = (opts) => analyse(simulate({ trueTDEE: 2400, intake: 2000, startW: 85, noise: 0.2, ...opts }));

  // MIN_DAYS_WEIGHT = 14, MIN_DAYS_FOOD = 10, coverage >= 0.6
  ck('14 days of weight is enough — exactly at the bar',
     at({ days: 14 }).confidence !== 'insufficient', at({ days: 14 }).reason);
  ck('13 days is not, and it says which bar was missed',
     at({ days: 13 }).confidence === 'insufficient'
       && /13 of 14 days of weight/.test(at({ days: 13 }).reason || ''), at({ days: 13 }).reason);

  // foodEvery: 2 -> food on half the days, which is below the 0.6 coverage bar.
  const sparseFood = at({ days: 20, foodEvery: 2 });
  ck('food logged on only half the days is refused, not averaged',
     sparseFood.confidence === 'insufficient', sparseFood.reason);
  ck('and the reason names coverage rather than day counts',
     /food logged on only/.test(sparseFood.reason || ''), sparseFood.reason);

  // Confidence bands: high needs 28 days, moderate needs 21.
  const d28 = at({ days: 28 }), d27 = at({ days: 27 }), d21 = at({ days: 21 }), d20 = at({ days: 20 });
  ck('28 clean days reads as high confidence', d28.confidence === 'high', d28);
  ck('27 does not', d27.confidence !== 'high', d27.confidence);
  ck('21 clean days is at least moderate',
     ['moderate', 'high'].includes(d21.confidence), d21.confidence);
  ck('20 days is below the moderate bar', d20.confidence === 'low', d20.confidence);

  // The absurd-output guard: 800..6000 kcal.
  const absurd = analyse(simulate({ days: 30, trueTDEE: 2400, intake: 200, startW: 85, noise: 0.2 }));
  ck('an impossible maintenance number is withheld, not printed',
     absurd.observed_tdee === null || (absurd.observed_tdee >= 800 && absurd.observed_tdee <= 6000),
     absurd.observed_tdee);

  console.log(`\n\u2550\u2550\u2550 ADAPTIVE ENGINE: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
