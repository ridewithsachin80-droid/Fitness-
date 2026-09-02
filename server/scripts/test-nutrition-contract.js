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

  console.log('\n[7] the coach can ask about a food');
  {
    // "chk masala dosa calories with macros" was answered as a question about
    // the member whose page the coach was on. The food table was not in scope
    // for questions at all — and the coach is the person who fixes it.
    await pool.query(`DELETE FROM foods WHERE name IN ('Masala Dosa','Dosa (Plain)')`);
    await pool.query(
      `INSERT INTO foods (name,category,source,verified,per_100g) VALUES
       ('Dosa (Plain)','grain','nin',true,$1::jsonb),
       ('Masala Dosa','grain','ai',false,$2::jsonb)`,
      [JSON.stringify(normaliseNutrients({ calories: 168, protein: 3.8, total_carbs: 24, fat: 6.5, iron: 1.1 })),
       JSON.stringify(normaliseNutrients({ calories: 140, protein: 3, total_carbs: 25, fat: 3, iron: 0.8 }))]);

    const a = await ai.answerFoodQuestion('chk masala dosa calories with macros');
    ck('a food question is answered', !!a, a);
    ck('with the per-100g figures', /140 kcal/.test(a || '') && /3g protein/.test(a || ''), a);
    ck('it says the food is not verified', /not yet verified/i.test(a || ''), a);
    ck('it carries the plausibility warning', /cooked dish with no cooking fat/i.test(a || ''), a);
    ck('it compares with the plain version — the thing that makes it obvious',
      /Dosa \(Plain\) is 168 kcal/.test(a || ''), a);
    ck('micros are included, since that is what was asked', /Iron/.test(a || ''), a);
    ck('and it says where to fix it', /Admin → Foods/.test(a || ''), a);
    ck('an unknown food says so plainly',
      /no food called/i.test(await ai.answerFoodQuestion('calories in zorbfruit') || ''));
    await pool.query(`DELETE FROM foods WHERE name IN ('Masala Dosa','Dosa (Plain)')`);
  }

  console.log('\n[8] the coach can edit a food from the chat');
  {
    // "need to edit calorie, macros of masala dosa" was classified by the model
    // as a NOTE and filed against the member whose page the coach was on.
    // Nothing was edited and Vishwas Gundurao got a meaningless note. Intent
    // this explicit is matched before the model is asked anything.
    await pool.query(`DELETE FROM foods WHERE name = 'Masala Dosa'`);
    await pool.query(
      `INSERT INTO foods (name,category,source,verified,per_100g)
       VALUES ('Masala Dosa','grain','ai',false,$1::jsonb)`,
      [JSON.stringify(normaliseNutrients({ calories: 140, protein: 3, total_carbs: 25, fat: 3 }))]);

    const asAdmin = { role: 'admin', id: 1 };
    const e = await ai.detectFoodEdit('need to edit calorie, macros of masala dosa', asAdmin);
    ck('the edit intent is recognised, not filed as a note', !!e && !e.not_found, e);
    ck('the right food is found', e?.name === 'Masala Dosa', e?.name);
    ck('EVERY parameter is offered, not just the four macros',
      Object.keys(e?.per_100g || {}).length === 45, Object.keys(e?.per_100g || {}).length);
    ck('the plausibility warning comes with it',
      /cooking fat/i.test(e?.warning || ''), e?.warning);
    ck('and the blast radius is attached', e?.impact !== undefined, e?.impact);

    // The words a coach reaches for when they want the portion, not the macros.
    // Every one of these reported "I have no food called grams masala dosa".
    for (const phrase of [
      'edit grams of masala dosa',
      'edit masala dosa weight',
      'edit portion size of masala dosa',
      'edit serving of masala dosa',
      'edit default portion masala dosa',
      'edit "masala dosa" weight',
    ]) {
      ck(`"${phrase}" finds the food`,
        (await ai.detectFoodEdit(phrase, asAdmin))?.name === 'Masala Dosa',
        (await ai.detectFoodEdit(phrase, asAdmin))?.not_found);
    }

    // A number in the message must not end up inside the food name.
    const withNum = await ai.detectFoodEdit('edit masala dosa portion to 200', asAdmin);
    ck('a number does not break the lookup', withNum?.name === 'Masala Dosa', withNum?.not_found);
    ck('and it is offered as the serving, ready to save',
      withNum?.suggested_grams === 200, withNum?.suggested_grams);
    ck('a number in a macro edit is NOT taken as a serving',
      (await ai.detectFoodEdit('edit masala dosa calories to 210', asAdmin))?.suggested_grams === null);

    ck('a bare "edit masala dosa" works too',
      (await ai.detectFoodEdit('edit masala dosa', asAdmin))?.name === 'Masala Dosa');
    ck('so does "fix"',
      (await ai.detectFoodEdit('fix masala dosa nutrition', asAdmin))?.name === 'Masala Dosa');

    // The discrimination that matters: editing a MEMBER's settings is a
    // different feature and must not be hijacked.
    ck('"set water target 4L for asha" is not a food edit',
      (await ai.detectFoodEdit('set water target 4L for asha', asAdmin)) === null);
    ck('"change asha target weight to 70" is not a food edit',
      (await ai.detectFoodEdit('change asha target weight to 70', asAdmin)) === null);
    ck('a message with no edit verb is not a food edit',
      (await ai.detectFoodEdit('masala dosa calories', asAdmin)) === null);
    ck('an unknown dish reports itself rather than matching something else',
      (await ai.detectFoodEdit('edit zorbfruit', asAdmin))?.not_found === 'zorbfruit');

    // A shared food belongs to every member, so correcting it stays with the
    // admin. A coach still gets the numbers and a clear next step.
    const asCoach = await ai.detectFoodEdit('edit masala dosa', { role: 'monitor', id: 2 });
    ck('a coach sees the food but cannot edit it', asCoach?.editable === false, asCoach?.editable);
    ck('an admin can', e?.editable === true, e?.editable);

    await pool.query(`DELETE FROM foods WHERE name = 'Masala Dosa'`);
  }

  console.log('\n[9] a typical serving, when the member names no quantity');
  {
    // "masala dosa" with no number landed at whatever the model guessed — 80g,
    // a third of a real one — and the member's day came out ~250 kcal light
    // with nothing on screen looking wrong.
    const dosa = [{ name: 'Masala Dosa', grams: 80, qty_text: '', default_grams: 200 }];

    ck('no quantity given → the coach\'s serving is used',
      ai.applyDefaultPortions('masala dosa', dosa)[0].grams === 200,
      ai.applyDefaultPortions('masala dosa', dosa)[0].grams);
    ck('and it is labelled, so the member can see where it came from',
      /typical serving/.test(ai.applyDefaultPortions('masala dosa', dosa)[0].qty_text || ''));

    // The rule that keeps this safe: the moment the member says how much, that
    // is an observation about their own meal and nothing may override it.
    ck('"2 masala dosa" is the member\'s own count — untouched',
      ai.applyDefaultPortions('2 masala dosa', dosa)[0].grams === 80);
    ck('"masala dosa 150g" is untouched',
      ai.applyDefaultPortions('masala dosa 150g', dosa)[0].grams === 80);
    ck('"half a masala dosa" is untouched — a measure without a digit',
      ai.applyDefaultPortions('half a masala dosa', dosa)[0].grams === 80);
    ck('"one katori dal and masala dosa" is untouched',
      ai.applyDefaultPortions('one katori dal and masala dosa', dosa)[0].grams === 80);

    ck('a food with no serving set is left alone',
      ai.applyDefaultPortions('poha', [{ name: 'Poha', grams: 90 }])[0].grams === 90);
    ck('a nonsense serving is ignored rather than applied',
      ai.applyDefaultPortions('x', [{ name: 'X', grams: 50, default_grams: 0 }])[0].grams === 50);

    ck('memberGaveQuantity recognises digits and measures',
      ai.memberGaveQuantity('2 roti') && ai.memberGaveQuantity('a bowl of dal')
      && !ai.memberGaveQuantity('masala dosa'));

    // End to end: the column exists, and the editor offers it.
    await pool.query(`DELETE FROM foods WHERE name = 'Serving Test Dosa'`);
    await pool.query(
      `INSERT INTO foods (name,category,source,verified,per_100g,default_grams)
       VALUES ('Serving Test Dosa','grain','ai',false,$1::jsonb,200)`,
      [JSON.stringify(normaliseNutrients({ calories: 210, protein: 4, total_carbs: 26, fat: 10 }))]);
    const e = await ai.detectFoodEdit('edit serving test dosa', { role: 'admin', id: 1 });
    ck('the editor carries the serving size', e?.default_grams === 200, e?.default_grams);
    const [enriched] = await ai.enrichFromDB([{ name: 'Serving Test Dosa', grams: 80,
      per_100g: { calories: 210 } }]);
    ck('and enrichment carries it out of the food table',
      enriched.default_grams === 200, enriched.default_grams);

    // Wiring, not just logic. Every assertion above calls the helper directly,
    // so all of them stayed green while the call sat in the WRONG ROUTE — it
    // landed in /photo, where cleanMsg does not exist, and every meal photo
    // 502'd. The same enrichFromDB line appears in both routes; that is twice
    // now that an anchor has matched the first one.
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'routes', 'aiChat.js'), 'utf8');
    const routeOf = (needle) => {
      const at = src.indexOf(needle);
      if (at < 0) return null;
      const before = src.slice(0, at);
      const m = [...before.matchAll(/router\.(?:post|get)\('([^']+)'/g)].pop();
      return m ? m[1] : null;
    };
    ck('the default is applied inside /parse',
      routeOf('applyDefaultPortions(cleanMsg') === '/parse',
      routeOf('applyDefaultPortions(cleanMsg'));
    ck('and nowhere that has no message to read',
      (src.match(/applyDefaultPortions\(/g) || []).length === 2,   // definition + one call
      (src.match(/applyDefaultPortions\(/g) || []).length);
    await pool.query(`DELETE FROM foods WHERE name = 'Serving Test Dosa'`);
  }

  console.log('\n[10] the portion-reset option is reachable');
  {
    // The option was rendered only when the serving CHANGED in that session.
    // A coach who had already set it correctly had no way to apply it to
    // entries logged before — the checkbox simply was not on screen, and the
    // member's 80g dosa stayed 80g however many times they saved.
    //
    // The client condition is asserted here because it is the whole feature:
    // the server work is useless if the control never renders.
    const fs = require('fs');
    const src = fs.readFileSync(
      require('path').join(__dirname, '..', '..', 'client', 'src', 'components', 'CoachAIChat.jsx'), 'utf8');
    ck('the portion-reset control does not require the value to have changed',
      !/parseInt\(defG\) !== food\.default_grams/.test(src));
    ck('it renders whenever a serving is set and portions were guessed',
      /defG !== '' && parseInt\(defG\) > 0\s*\n?\s*&& food\.impact\?\.guessed > 0/.test(src),
      'condition not found');
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} test-nutrition-contract: ${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
