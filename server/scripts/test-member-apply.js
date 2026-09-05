/**
 * scripts/test-member-apply.js — the server-side apply path (sprint V0).
 *
 * WHAT THIS PROTECTS
 * ------------------
 * `POST /ai-chat/parse` returns a preview and writes nothing. The React chat
 * component is what actually saves the log. Voice logging has no component and
 * no tick-to-confirm step, so those rules had to move to the server.
 *
 * services/memberLogApply.js is a faithful port of AIChatLog.jsx applyAll.
 * Until the app itself migrates, the two coexist — which is precisely the
 * situation that produced the weekday-matching bug, where the same logic lived
 * in three places and two of them disagreed.
 *
 * So these assertions are written against the CLIENT's rules, not against
 * whatever the server happens to do. Each one names the behaviour it pins.
 *
 * Every assertion was checked by breaking the rule and confirming it goes red.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}

const pool = require('../db/pool');
const { applyParsed, composeVoiceReply, computeTotals } = require('../services/memberLogApply');
const { calcCompliance, protocolTotalFor } = require('../services/compliance');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 220))); };

const DATE = '2026-09-04';
const rice = { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 };
const dal  = { calories: 120, protein: 9,   carbs: 20, fat: 0.4 };

/** A parsed object with everything off, so each test turns on only its rule. */
const EMPTY = () => ({
  weightOn: false, weight_kg: null,
  activities: [], acv: [], supplements: [],
  waterOn: false, water_ml_add: 0,
  sleepOn: false, sleep: null,
  corrections: [], foods: [],
  bodyMetricsOn: false, bodyMetrics: [],
});

(async () => {
  let member;
  const freshMember = async (profile = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO users (name, phone, password, role, active)
       VALUES ('Apply Test', $1, 'x', 'patient', true) RETURNING id`,
      ['9' + String(Date.now()).slice(-9)]);
    const id = rows[0].id;
    await pool.query(
      `INSERT INTO patient_profiles (user_id, meal_slots, protocol_activities, protocol_acv, protocol_supplements)
       VALUES ($1,$2,$3,$4,$5)`,
      [id,
       JSON.stringify(profile.meal_slots || ['Breakfast', 'Lunch', 'Dinner']),
       profile.protocol_activities  ? JSON.stringify(profile.protocol_activities)  : null,
       profile.protocol_acv         ? JSON.stringify(profile.protocol_acv)         : null,
       profile.protocol_supplements ? JSON.stringify(profile.protocol_supplements) : null]);
    return id;
  };
  const readLog = async (id) => (await pool.query(
    `SELECT * FROM daily_logs WHERE patient_id=$1 AND log_date=$2`, [id, DATE])).rows[0];

  try {
    await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');

    // ── Weight ────────────────────────────────────────────────────────────
    console.log('\nWeight');
    member = await freshMember();
    await applyParsed(member, { ...EMPTY(), weightOn: true, weight_kg: 78.4 }, { istDate: DATE });
    ck('a plausible weight is written', Number((await readLog(member)).weight_kg) === 78.4);

    await applyParsed(member, { ...EMPTY(), weightOn: true, weight_kg: 850 }, { istDate: DATE });
    ck('an implausible weight is REJECTED, not written — a misheard "one eighty five" would rewrite the whole trend line and voice has no preview to catch it',
       Number((await readLog(member)).weight_kg) === 78.4, (await readLog(member)).weight_kg);

    await applyParsed(member, { ...EMPTY(), weightOn: true, weight_kg: 5 }, { istDate: DATE });
    ck('...and so is an impossibly low one', Number((await readLog(member)).weight_kg) === 78.4);

    await applyParsed(member, { ...EMPTY(), weightOn: false, weight_kg: 60 }, { istDate: DATE });
    ck('weight_kg is ignored when weightOn is false', Number((await readLog(member)).weight_kg) === 78.4);

    // ── Protocol ticks ────────────────────────────────────────────────────
    console.log('\nProtocol ticks');
    member = await freshMember();
    await applyParsed(member, { ...EMPTY(), activities: [{ id: 'walk', on: true }] }, { istDate: DATE });
    await applyParsed(member, { ...EMPTY(), activities: [{ id: 'sun',  on: true }] }, { istDate: DATE });
    let log = await readLog(member);
    ck('ticks MERGE rather than replace — a member who ticked in the app this morning must keep it after a voice log tonight',
       log.activities.walk === true && log.activities.sun === true, log.activities);

    await applyParsed(member, { ...EMPTY(),
      acv: [{ id: 'acv1', on: true }],
      supplements: [{ id: 's1', on: true }, { id: 's2', on: false }] }, { istDate: DATE });
    log = await readLog(member);
    ck('acv ticks apply', log.acv.acv1 === true, log.acv);
    ck('an item marked off is not ticked', log.supplements.s1 === true && log.supplements.s2 === undefined, log.supplements);

    // ── Water ─────────────────────────────────────────────────────────────
    console.log('\nWater');
    member = await freshMember();
    await applyParsed(member, { ...EMPTY(), waterOn: true, water_ml_add: 500 }, { istDate: DATE });
    await applyParsed(member, { ...EMPTY(), waterOn: true, water_ml_add: 300 }, { istDate: DATE });
    ck('water ADDS to the running total rather than replacing it',
       (await readLog(member)).water_ml === 800, (await readLog(member)).water_ml);

    await applyParsed(member, { ...EMPTY(), waterOn: true, water_ml_add: 50000 }, { istDate: DATE });
    ck('water is capped at 10 litres — a misheard number must not claim a dangerous intake',
       (await readLog(member)).water_ml === 10000, (await readLog(member)).water_ml);

    // ── Sleep ─────────────────────────────────────────────────────────────
    console.log('\nSleep');
    member = await freshMember();
    await applyParsed(member, { ...EMPTY(), sleepOn: true, sleep: { bedtime: '23:00' } }, { istDate: DATE });
    await applyParsed(member, { ...EMPTY(), sleepOn: true, sleep: { waketime: '06:30' } }, { istDate: DATE });
    log = await readLog(member);
    ck('sleep fields merge — logging a waketime must not erase the bedtime',
       log.sleep.bedtime === '23:00' && log.sleep.waketime === '06:30', log.sleep);

    // ── Foods ─────────────────────────────────────────────────────────────
    console.log('\nFoods');
    member = await freshMember();
    await applyParsed(member, { ...EMPTY(), foods: [
      { name: 'Rice', grams: 150, meal: 'Lunch',  per_100g: rice, on: true },
      { name: 'Dal',  grams: 200, meal: 'Brunch', per_100g: dal,  on: true },
    ] }, { istDate: DATE, source: 'voice' });
    log = await readLog(member);
    ck('foods are appended', log.food_items.length === 2, log.food_items.length);
    ck('a valid meal slot is kept', log.food_items[0].meal === 'Lunch', log.food_items[0].meal);
    ck('an unknown slot falls back to the member\'s FIRST slot rather than inventing a fourth only they have',
       log.food_items[1].meal === 'Breakfast', log.food_items[1].meal);
    ck('the source is stamped, so the coach can see a voice log from a typed one',
       log.food_items[0].source === 'voice', log.food_items[0]);
    ck('each item gets a distinct id', log.food_items[0].id !== log.food_items[1].id);

    await applyParsed(member, { ...EMPTY(), foods: [
      { name: 'Roti', grams: 60, meal: 'Dinner', per_100g: { calories: 0 }, on: true }] },
      { istDate: DATE });
    log = await readLog(member);
    ck('a food with zero calories stores per_100g as null rather than a fake zero',
       log.food_items[2].per_100g === null, log.food_items[2]);

    // ── Corrections ───────────────────────────────────────────────────────
    console.log('\nCorrections');
    member = await freshMember();
    await applyParsed(member, { ...EMPTY(), foods: [
      { name: 'Dal', grams: 100, meal: 'Lunch',  per_100g: dal, on: true }] }, { istDate: DATE });
    await applyParsed(member, { ...EMPTY(), foods: [
      { name: 'Dal', grams: 150, meal: 'Dinner', per_100g: dal, on: true }] }, { istDate: DATE });
    await applyParsed(member, { ...EMPTY(), corrections: [
      { name: 'dal', grams: 250, on: true }] }, { istDate: DATE });
    log = await readLog(member);
    ck('a correction updates the LAST matching item — the most recent dal is "the dal" they mean',
       log.food_items[1].grams === 250 && log.food_items[0].grams === 100,
       log.food_items.map(f => f.grams));
    ck('...and matches case-insensitively', log.food_items[1].grams === 250);
    ck('per_100g survives a correction, so calories recompute from the new grams instead of carrying a stale figure',
       log.food_items[1].per_100g.calories === 120, log.food_items[1].per_100g);

    const before = (await readLog(member)).food_items.length;
    await applyParsed(member, { ...EMPTY(), corrections: [
      { name: 'Nothing I Ate', grams: 100, on: true }] }, { istDate: DATE });
    ck('a correction naming a food that was never logged changes nothing and does not throw',
       (await readLog(member)).food_items.length === before);

    // Ordering matters: corrections run BEFORE new foods are appended, or
    // "make the dal 250g" would retarget a dal added in the same sentence.
    member = await freshMember();
    await applyParsed(member, { ...EMPTY(), foods: [
      { name: 'Dal', grams: 100, meal: 'Lunch', per_100g: dal, on: true }] }, { istDate: DATE });
    await applyParsed(member, { ...EMPTY(),
      corrections: [{ name: 'Dal', grams: 250, on: true }],
      foods:       [{ name: 'Dal', grams: 80, meal: 'Dinner', per_100g: dal, on: true }],
    }, { istDate: DATE });
    log = await readLog(member);
    ck('a correction in the same message targets the ALREADY-LOGGED item, not the one being added alongside it',
       log.food_items[0].grams === 250 && log.food_items[1].grams === 80,
       log.food_items.map(f => f.grams));

    // ── Meal slots ────────────────────────────────────────────────────────
    // These have only ever lived in the browser's local storage and were sent
    // to the server inside each request's context. For every existing member
    // the column is NULL, so a naive fallback to the defaults would file a
    // member whose slots are "Pre-workout / Post-workout / Dinner" under
    // "Breakfast" on every single voice log.
    console.log('\nMeal slots');
    const { mealSlotsFor, DEFAULT_MEAL_SLOTS } = require('../services/memberLogApply');

    ck('a synced profile wins',
       (await mealSlotsFor({ meal_slots: ['Pre-workout', 'Dinner'] }))[0] === 'Pre-workout');

    const noProfile = await freshMember();
    await pool.query(`UPDATE patient_profiles SET meal_slots = NULL WHERE user_id = $1`, [noProfile]);
    ck('a member with no history and no synced slots gets the defaults',
       JSON.stringify(await mealSlotsFor(null, noProfile)) === JSON.stringify(DEFAULT_MEAL_SLOTS),
       await mealSlotsFor(null, noProfile));

    // A member who has been eating under custom slots.
    const custom = await freshMember();
    await pool.query(`UPDATE patient_profiles SET meal_slots = NULL WHERE user_id = $1`, [custom]);
    await pool.query(
      `INSERT INTO daily_logs (patient_id, log_date, food_items)
       VALUES ($1, CURRENT_DATE - 2, $2)`,
      [custom, JSON.stringify([{ name: 'Shake', grams: 300, meal: 'Post-workout' }])]);
    const derived = await mealSlotsFor(null, custom);
    ck('...but a member with history gets the slots they have ACTUALLY been using',
       derived.includes('Post-workout'), derived);

    // And the fallback must reach applyParsed, not just the helper.
    await applyParsed(custom, { ...EMPTY(), foods: [
      { name: 'Eggs', grams: 100, meal: 'Nonsense', per_100g: rice, on: true }] }, { istDate: DATE });
    const customLog = await readLog(custom);
    ck('an unknown slot falls back to their real slot, not to "Breakfast"',
       customLog.food_items[0].meal === 'Post-workout', customLog.food_items[0].meal);

    // ── Compliance ────────────────────────────────────────────────────────
    console.log('\nCompliance');
    member = await freshMember({
      protocol_activities: ['walk', 'sun'], protocol_acv: ['acv1'], protocol_supplements: ['s1'] });
    await applyParsed(member, { ...EMPTY(), activities: [{ id: 'walk', on: true }] }, { istDate: DATE });
    ck('compliance is computed against the member\'s ASSIGNED total, not the keys present (1 of 4 = 25%)',
       (await readLog(member)).compliance_pct === 25, (await readLog(member)).compliance_pct);

    ck('protocolTotalFor reads the member\'s own protocol',
       protocolTotalFor({ protocol_activities: ['a', 'b'], protocol_acv: ['c'], protocol_supplements: ['d'] }) === 4);
    ck('...and falls back to the stock 16 when nothing is assigned',
       protocolTotalFor({}) === 16);
    ck('a partial payload cannot score 100% — {walk:true} alone is 6%, not full marks',
       calcCompliance({ walk: true }, {}, {}, null) === 6);

    // ── Totals ────────────────────────────────────────────────────────────
    console.log('\nTotals');
    ck('calories are computed per 100g',
       computeTotals([{ grams: 200, per_100g: dal }]).cal === 240,
       computeTotals([{ grams: 200, per_100g: dal }]));
    ck('an item with no nutrition data contributes nothing rather than a guess',
       computeTotals([{ grams: 200, per_100g: null }]).cal === 0);
    ck('macros add up', computeTotals([{ grams: 100, per_100g: dal }]).protein === 9);

    // ── Nothing to do ─────────────────────────────────────────────────────
    console.log('\nEmpty and hostile input');
    member = await freshMember();
    const empty = await applyParsed(member, EMPTY(), { istDate: DATE });
    ck('an empty parse applies nothing', empty.applied.foods === 0 && empty.applied.weight === null);
    ck('...and still does not throw', true);

    await applyParsed(member, null, { istDate: DATE });
    ck('a null parse is survivable', true);

    await applyParsed(member, { ...EMPTY(), foods: [{ name: 'X', grams: 'lots', per_100g: rice, on: true }] },
      { istDate: DATE });
    ck('a non-numeric grams becomes 0 rather than NaN in the database',
       (await readLog(member)).food_items[0].grams === 0, (await readLog(member)).food_items[0]);

    // ── The spoken reply ──────────────────────────────────────────────────
    // This text is READ ALOUD, which constrains it in ways ordinary UI copy
    // is not.
    console.log('\nSpoken reply');
    const r1 = composeVoiceReply({ foods: 2, weight: 78.4, activities: 0, acv: 0, supplements: 0 },
                                 { cal: 640 }, { calorieTarget: 1800 });
    ck('names what was logged', /2 items/.test(r1) && /78\.4 kg/.test(r1), r1);
    ck('gives calories so far and left', /640 calories/.test(r1) && /1,160 left/.test(r1), r1);
    ck('numbers are grouped, so 1160 is not read out as "one one six zero"', /1,160/.test(r1), r1);
    ck('NO emoji — text-to-speech reads them aloud or skips them',
       !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u2713\u2714]/u.test(r1), r1);
    ck('under 25 words — past that people stop listening and the useful part is at the end',
       r1.split(/\s+/).length <= 25, r1.split(/\s+/).length);
    ck('ONE reply, with no follow-up question — there is no round trip to answer it',
       !/\?/.test(r1), r1);

    const r2 = composeVoiceReply({ foods: 0, weight: null, activities: 0, acv: 0, supplements: 0 }, { cal: 0 });
    ck('nothing understood gives an EXAMPLE rather than an apology — hearing the shape of a working sentence beats hearing "I did not understand"',
       /two roti/.test(r2), r2);

    const r3 = composeVoiceReply({ foods: 1, activities: 2, acv: 1, supplements: 0, water_ml: 500 }, { cal: 300 });
    ck('ticks are summarised rather than listed one by one', /3 ticks/.test(r3), r3);
    ck('water is mentioned', /500 ml/.test(r3), r3);
    ck('without a target it does not invent one', !/left/.test(r3), r3);

    ck('a single item is not called "1 items"',
       /1 item\./.test(composeVoiceReply({ foods: 1 }, { cal: 0 })),
       composeVoiceReply({ foods: 1 }, { cal: 0 }));

  } catch (err) {
    fail++;
    console.log('  \u2717 suite threw: ' + (err && err.stack ? err.stack : err));
  } finally {
    await pool.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
