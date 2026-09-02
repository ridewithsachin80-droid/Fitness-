/**
 * scripts/test-nutrition-contract.js — every food carries the same nutrition,
 * whichever door it came in through.
 *
 * A member logs food five different ways: typed into the AI chat, photographed,
 * scanned from a barcode, tapped from their coach's prescribed plan, or entered
 * by hand. Their iron total for the day is a sum across all of those. It only
 * means anything if every path agrees on what a food's nutrition looks like.
 *
 * They did not agree:
 *
 *   · `normaliseNutrients` existed TWICE, in routes/aiChat.js and in
 *     routes/aiFoods.js, and had drifted — on identical input one returned
 *     net_carbs 1.4 and the other returned NaN, which reaches Postgres as null
 *     and makes every downstream sum NaN.
 *   · `learnFoods` inserted the model's raw object without normalising, so a
 *     food learned from chat could enter the table with six fields. Every
 *     member who logged it afterwards inherited those gaps, through every path.
 *   · The coach's prescribed plan kept four macros and dropped 35 fields.
 *
 * None of these failed loudly. The numbers were just quietly wrong, and only
 * for the foods that happened to arrive by a particular route.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const pool = require('../db/pool');
const { normaliseNutrients } = require('../services/nutrients');
const ai = require('../routes/aiChat');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 200))); };

/** The contract: the exact field set every stored food must have. */
const CONTRACT = Object.keys(normaliseNutrients({}));

const PALAK = { calories: 23, protein: 2.9, total_carbs: 3.6, fat: 0.4, fiber: 2.2,
                iron: 2.7, vit_k: 483, folate: 194, calcium: 99, magnesium: 79,
                vit_a: 469, vit_c: 28, potassium: 558, zinc: 0.53 };

(async () => {
  console.log('\n[1] the contract itself');
  {
    ck('a food has 45 nutrition fields', CONTRACT.length === 45, CONTRACT.length);
    ck('macros are present',
      ['calories','protein','total_carbs','net_carbs','fat','fiber'].every(k => CONTRACT.includes(k)));
    ck('vitamins are present',
      ['vit_a','vit_b12','vit_c','vit_d','vit_k','folate'].every(k => CONTRACT.includes(k)));
    ck('minerals are present',
      ['iron','calcium','magnesium','zinc','selenium','potassium'].every(k => CONTRACT.includes(k)));
    ck('the widest copy had six extra nutrients and none were lost',
      ['glycemic_index','glycemic_load','probiotic','prebiotic_fiber','lycopene','beta_glucan']
        .every(k => CONTRACT.includes(k)), CONTRACT.length);
    ck('fats are broken out',
      ['saturated_fat','trans_fat','omega3_dha','omega6'].every(k => CONTRACT.includes(k)));

    // NaN is the failure that started this: it survives JSON.stringify as null,
    // so nothing throws and every sum built on it silently becomes NaN.
    const all = normaliseNutrients(PALAK);
    ck('no field is ever NaN', Object.entries(all).every(([, v]) => Number.isFinite(v)),
      Object.entries(all).filter(([, v]) => !Number.isFinite(v)));
    ck('net carbs are derived from fibre, not left blank', all.net_carbs === 1.4, all.net_carbs);
    ck('an empty food is all zeroes, never undefined',
      Object.values(normaliseNutrients({})).every(v => v === 0));
    ck('junk values become 0 rather than NaN',
      Object.values(normaliseNutrients({ iron: 'lots', calories: null })).every(Number.isFinite));
  }

  console.log('\n[2] there is only ONE implementation');
  {
    const fs = require('fs');
    const copies = ['routes/aiChat.js', 'routes/aiFoods.js', 'routes/foods.js']
      .filter(f => /function normaliseNutrients/.test(fs.readFileSync(f, 'utf8')));
    ck('no route defines its own normaliser', copies.length === 0, copies);
  }

  console.log('\n[3] the coach-prescribed path');
  {
    const plan = ai.normaliseMealPlan({
      meals: [{ meal: 'Lunch', items: [{ name: 'Palak', grams: 100, per_100g: PALAK }] }] });
    const kept = plan.meals[0].items[0].per_100g;
    ck('a prescribed item satisfies the whole contract',
      CONTRACT.every(k => k in kept), CONTRACT.filter(k => !(k in kept)));
    ck('and keeps the real values', kept.iron === 2.7 && kept.vit_k === 483, kept.iron);
  }

  console.log('\n[4] the learned-from-chat path');
  {
    await pool.query(`DELETE FROM foods WHERE name = 'Contract Test Sabzi'`);
    // Deliberately partial, the way a model actually replies.
    await ai.learnFoods([{ name: 'Contract Test Sabzi', category: 'vegetable',
                           per_100g: { calories: 80, protein: 3, iron: 1.4 } }]);
    const { rows } = await pool.query(
      `SELECT per_100g FROM foods WHERE name = 'Contract Test Sabzi'`);
    ck('the food was learned', rows.length === 1, rows.length);
    ck('and stored against the full contract, not the six fields the model sent',
      rows.length === 1 && CONTRACT.every(k => k in rows[0].per_100g),
      rows[0] && CONTRACT.filter(k => !(k in rows[0].per_100g)));
    ck('with the values it did send intact',
      rows[0]?.per_100g?.iron === 1.4 && rows[0]?.per_100g?.calories === 80, rows[0]?.per_100g);
    ck('and no NaN reaching the database',
      rows.length === 1 && Object.values(rows[0].per_100g).every(v => v === null || Number.isFinite(v)),
      rows[0] && Object.entries(rows[0].per_100g).filter(([, v]) => v !== null && !Number.isFinite(v)));
    await pool.query(`DELETE FROM foods WHERE name = 'Contract Test Sabzi'`);
  }

  console.log('\n[5] the barcode path');
  {
    const foods = require('../routes/foods');
    // OpenFoodFacts gives grams; the app stores mg and mcg. A unit slip here is
    // invisible — it just makes someone's iron look 1000x wrong.
    const off = normaliseNutrients({
      calories: 52, protein: 0.3, total_carbs: 14, fat: 0.2, fiber: 2.4, iron: 0.12 });
    ck('a scanned food satisfies the contract too',
      CONTRACT.every(k => k in off), CONTRACT.filter(k => !(k in off)));
  }

  console.log('\n[6] the member is told when a number looks wrong');
  {
    // Real report: "Malasa dosa" logged as 200g / 280 kcal / 6g fat. The app
    // stated it with complete confidence and the member had no signal at all.
    await pool.query(`DELETE FROM foods WHERE name IN ('Masala Dosa','Idli')`);
    await pool.query(
      `INSERT INTO foods (name,category,source,verified,per_100g)
       VALUES ('Masala Dosa','grain','ai',false,$1::jsonb)`,
      [JSON.stringify(normaliseNutrients({ calories: 140, protein: 3, total_carbs: 25, fat: 3 }))]);
    await pool.query(
      `INSERT INTO foods (name,category,source,verified,per_100g)
       VALUES ('Idli','grain','nin',true,$1::jsonb)`,
      [JSON.stringify(normaliseNutrients({ calories: 110, protein: 2.5, total_carbs: 23, fat: 0.4 }))]);

    const [dosa] = await ai.enrichFromDB([{ name: 'Masala Dosa', grams: 200,
      per_100g: { calories: 140, protein: 3, total_carbs: 25, fat: 3 } }]);
    ck('a cooked dish with no cooking fat is flagged at log time',
      dosa.confidence === 'low' && /cooked dish/i.test(dosa.warning || ''), dosa.warning);
    ck('and the member is told who will check it',
      /coach will check/i.test(dosa.warning || ''), dosa.warning);

    // Steamed food must not be flagged, or every idli carries a warning and
    // members learn to ignore all of them.
    const [idli] = await ai.enrichFromDB([{ name: 'Idli', grams: 100,
      per_100g: { calories: 110, protein: 2.5, total_carbs: 23, fat: 0.4 } }]);
    ck('a steamed food is NOT flagged', !idli.warning, idli.warning);

    // The per-serving diagnosis is more specific, so it must not be replaced.
    const [whey] = await ai.enrichFromDB([{ name: 'Whey Protein Masala', grams: 30,
      per_100g: { calories: 120, protein: 24, total_carbs: 3, fat: 1.5 } }]);
    ck('a per-serving label keeps its own, more specific warning',
      /per-serving/i.test(whey.warning || ''), whey.warning);

    await pool.query(`DELETE FROM foods WHERE name IN ('Masala Dosa','Idli')`);
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} test-nutrition-contract: ${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
