/**
 * scripts/test-member-plan.js — Phase 2: the member side of the diet plan.
 *
 * The meal rules are imported from the REAL client module (lib/day/planMeals.js,
 * no mirroring). Everything else is real Postgres and real routes; only the AI
 * transport is stubbed.
 *
 * WHAT MUST HOLD
 * --------------
 *   A. "Next up" is the earliest prescribed meal not yet logged. A meal whose
 *      time has gone by is "missed" and still next: nothing is skipped for the
 *      member. When every meal is logged there is no next meal.
 *   B. "Log as planned" writes exactly the planned grams unless the member
 *      changed them, never logs an item twice, and says what differs.
 *   C. The member is sent the APPROVED plan only: never a draft, never the
 *      coach's brief, flags, checks or the model's notes. Lab cautions are sent.
 *   D. Each of today's meals carries its time from the plan, in eating order.
 *      A coach's one-off meal for the day is kept, without a time.
 *   E. The member chat is given today's prescribed meals, each marked logged
 *      or not, and is told never to change the plan.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'stub-key';

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const path = require('path');
const { importClient } = require('./lib/client-bundle');

const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;

// The member chat makes two calls: the parser, then the answer. The answer
// prompt is recognised by its own fixed opening words, never by food words.
const ANSWER_MARK = 'The member asked:';
let lastAnswerPrompt = '', nextQuestion = "what is today's meal plan?";
const stubbedPost = async (url, body, cfg) => {
  if (String(url).includes('generativelanguage') || String(url).includes('groq')) {
    const sent = body.messages?.[0]?.content || body.contents?.[0]?.parts?.[0]?.text || JSON.stringify(body);
    const reply = (text) => ({ data: { candidates: [{ content: { parts: [{ text }] } }], choices: [{ message: { content: text } }] } });
    if (sent.includes(ANSWER_MARK)) { lastAnswerPrompt = sent; return reply('Stub answer.'); }
    return reply(JSON.stringify({ reply: '', question: nextQuestion, weight_kg: null, activity_ids: [], acv_ids: [],
      supplement_ids: [], water_ml_add: null, sleep: null, foods: [], workouts: [] }));
  }
  return realAxios.post(url, body, cfg);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const pool = require('../db/pool');
const DP   = require('../services/dietPlan');
const ai   = require('../routes/aiChat');
const { getISTDate } = require('../utils/istDate');

const app = express(); app.use(express.json({ limit: '15mb' })); app.use(cookieParser());
app.use('/api/ai-chat', ai);
app.use('/api/diet-plans', require('../routes/dietPlans'));
app.use('/api/members', require('../routes/patients'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 400))); };

const it = (name, grams, k, p, c, f) => ({ name, grams, qty_text: `${grams} g`, kcal_100g: k, protein_100g: p, carbs_100g: c, fat_100g: f });
const PLAN = () => ({
  title: 'Low carb vegetarian', eating_window: '12:00-20:00',
  targets: { kcal: 1500, protein: 110, carbs: 120, fat: 64 },
  timetable: [{ time: '06:00', what: 'Wake, 500 ml water' }, { time: '12:00', what: 'Meal 1' }],
  meals: [
    // Deliberately NOT in time order: the member must still get them in eating order.
    { meal: 'Meal 3', time: '19:30', items: [it('Paneer bhurji', 120, 265, 18, 4, 20), it('Mixed veg sabzi', 150, 90, 3, 9, 5), it('Jowar roti', 40, 260, 8, 52, 2), it('Ghee', 5, 900, 0, 0, 100)] },
    { meal: 'Meal 1', time: '12:00', items: [it('Curd', 200, 60, 3.5, 4.5, 3), it('Palak paneer', 150, 180, 9, 5, 14), it('Moong dal', 100, 105, 7, 15, 0.5), it('Cucumber salad', 100, 16, 0.7, 3.6, 0.1)] },
    { meal: 'Meal 2', time: '16:00', items: [it('Whey protein', 30, 400, 80, 8, 6), it('Almonds', 20, 579, 21, 22, 50), it('Guava', 150, 68, 2.6, 14, 1), it('Buttermilk', 200, 40, 3, 5, 1)] },
  ],
  avoid: ['sugar', 'maida'],
  cautions: ['See your doctor for a BP check before starting the gym.'],
  adjustments: [{ for: 'Glucose', note: 'Carbs kept low at every meal.' }],
});

(async () => {
  // ── A, B: the meal rules, from the real client module ──────────────────────
  const day = importClient('lib/day/index.js');
  const per = (k) => ({ calories: k });
  const mealPlans = [
    { meal: 'Meal 1', time: '12:00', items: [{ name: 'Curd', grams: 200, per_100g: per(60) }, { name: 'Moong dal', grams: 100, per_100g: per(105) }] },
    { meal: 'Meal 2', time: '16:00', items: [{ name: 'Guava', grams: 150, per_100g: per(68) }, { name: 'Buttermilk', grams: 200, per_100g: per(40) }] },
    { meal: 'Meal 3', time: '19:30', items: [{ name: 'Paneer bhurji', grams: 120, per_100g: per(265) }] },
  ];
  const at = (h, m = 0) => h * 60 + m;

  console.log('\n[0] which meal is next (no database)');
  {
    let r = day.planMeals({ mealPlans, food: [], nowMin: at(11, 20) });
    ck('before lunch with nothing logged: Meal 1 is next, Meal 2 after it', r.next.meal === 'Meal 1' && r.then.meal === 'Meal 2' && r.loggedCount === 0 && r.total === 3, r);
    ck('its calories are the planned grams added up (120 + 105)', r.next.kcal === 225, r.next.kcal);
    ck('it is not "missed" before its time', r.next.missed === false);
    ck('"in 40 min" before a meal', day.untilText('12:00', at(11, 20)) === 'in 40 min', day.untilText('12:00', at(11, 20)));
    ck('"now" at its time, "in 2 h" well ahead', day.untilText('12:00', at(12, 0)) === 'now' && day.untilText('16:00', at(14, 0)) === 'in 2 h');
    ck('no countdown once the time has clearly passed', day.untilText('12:00', at(12, 40)) === null);
    ck('no countdown for a meal more than three hours away', day.untilText('19:30', at(12, 0)) === null && day.untilText('16:00', at(13, 0)) === 'in 3 h');

    r = day.planMeals({ mealPlans, food: [{ name: 'curd', grams: 200, meal: 'Meal 1' }], nowMin: at(15, 20) });
    ck('one item of Meal 1 logged: Meal 1 counts as logged, Meal 2 is next', r.next.meal === 'Meal 2' && r.loggedCount === 1, r.next);
    ck('matching ignores letter case', r.meals[0].logged === true);
    ck('a meal logged in part remembers what is still to log', r.meals[0].complete === false && r.meals[0].pending.map(i => i.name).join() === 'Moong dal');

    r = day.planMeals({ mealPlans, food: [{ name: 'Curd', grams: 200, meal: 'Breakfast' }], nowMin: at(11, 0) });
    ck('the same food logged under a DIFFERENT meal slot does not tick the plan', r.next.meal === 'Meal 1' && r.loggedCount === 0);

    r = day.planMeals({ mealPlans, food: [], nowMin: at(13, 30) });
    ck('exactly 90 minutes late is not yet "missed"', r.next.meal === 'Meal 1' && r.next.missed === false);
    r = day.planMeals({ mealPlans, food: [], nowMin: at(13, 31) });
    ck('91 minutes late is "missed"', r.next.missed === true);
    r = day.planMeals({ mealPlans, food: [], nowMin: at(17, 0) });
    ck('a missed meal is STILL next up: the app never skips a meal for the member', r.next.meal === 'Meal 1' && r.next.missed && r.then.meal === 'Meal 2' && r.then.missed === false, [r.next.meal, r.then.meal]);

    // Live test, 5 Oct: a different meal logged "instead of the plan" under
    // Breakfast left Breakfast as "Missed" and next up, so it was logged twice.
    r = day.planMeals({ mealPlans, food: [{ name: 'idli', grams: 150, meal: 'Meal 1' }, { name: 'sambar', grams: 200, meal: 'meal 1' }], nowMin: at(13, 30) });
    ck('a different meal logged under the meal\'s slot counts as that meal: Next up moves on', r.meals[0].logged === true && r.next.meal === 'Meal 2' && r.loggedCount === 1, [r.next?.meal, r.loggedCount]);
    const cc = importClient('utils/coachCard.js');
    const rows = cc.coachCardRows({ coachPlan: null, macrosKcal: null, sets: [], cardio: [], food: [{ name: 'idli', grams: 150, meal: 'Meal 1' }], mealPlans });
    ck('the coach card agrees: that meal is no longer pending', !JSON.stringify(rows).includes('"Meal 1"') && JSON.stringify(rows).includes('Meal 2'), rows);

    const all = mealPlans.map(mp => ({ name: mp.items[0].name, grams: 1, meal: mp.meal }));
    r = day.planMeals({ mealPlans, food: all, nowMin: at(21, 0) });
    ck('every meal logged: nothing is next', r.next === null && r.then === null && r.loggedCount === 3);
    ck('no prescribed meals: nothing is next, nothing breaks', day.planMeals({ mealPlans: [], food: [], nowMin: 0 }).next === null && day.planMeals({}).total === 0);

    r = day.planMeals({ mealPlans: [{ meal: 'Snack', time: null, items: mealPlans[1].items }, mealPlans[2], mealPlans[0]], food: [], nowMin: at(8, 0) });
    ck('meals come in time order whatever order they arrive in; a meal with no time goes last', r.meals.map(m => m.meal).join() === 'Meal 1,Meal 3,Snack', r.meals.map(m => m.meal));
    ck('"4:00 PM" from "16:00", "12:00 PM" from "12:00", nothing from no time', day.clock('16:00') === '4:00 PM' && day.clock('12:00') === '12:00 PM' && day.clock(null) === '');
    ck('India time is used whatever the phone is set to (06:30 UTC is 12:00 IST)', day.istMinutes(new Date('2026-10-04T06:30:00Z')) === 720, day.istMinutes(new Date('2026-10-04T06:30:00Z')));
  }

  console.log('\n[1] log as planned (no database)');
  {
    const meal = day.planMeals({ mealPlans, food: [], nowMin: at(16, 0) }).meals[1];
    let r = day.plannedRows(meal, {}, []);
    ck('untouched, it logs every item at the planned grams, under the meal\'s slot', r.rows.length === 2 && r.rows[0].name === 'Guava' && r.rows[0].grams === 150 && r.rows.every(x => x.meal === 'Meal 2'), r.rows);
    ck('with the calories of what is logged (102 + 80)', r.kcal === 182, r.kcal);
    ck('and nothing "different from the plan"', r.changes.length === 0);
    ck('each row keeps the food\'s nutrition, so totals work offline', r.rows[0].per_100g.calories === 68);

    r = day.plannedRows(meal, { Guava: { on: true, grams: '100' }, Buttermilk: { on: false, grams: '200' } }, []);
    ck('changed grams are logged as changed; an unticked item is not logged', r.rows.length === 1 && r.rows[0].grams === 100 && r.kcal === 68, r);
    ck('the differences are spelled out', r.changes.join('; ') === 'Guava 100 g (plan 150 g); Buttermilk skipped', r.changes);

    r = day.plannedRows(meal, { Guava: { on: true, grams: '' }, Buttermilk: { on: true, grams: '-5' } }, []);
    ck('an empty or negative amount is never logged', r.rows.length === 0 && r.changes.length === 2, r);
    r = day.plannedRows(meal, { Guava: { on: true, grams: '99999' } }, []);
    ck('an absurd amount is capped at 2,000 g', r.rows[0].grams === 2000);

    r = day.plannedRows(meal, {}, [{ name: 'guava', grams: 150, meal: 'Meal 2' }]);
    ck('an item already logged under this meal is not logged twice', r.rows.length === 1 && r.rows[0].name === 'Buttermilk', r.rows);
  }

  // ── Database ────────────────────────────────────────────────────────────────
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (name, phone, role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`,
    [name, phone, role])).rows[0].id;
  const coach   = await mk('Sachin', '8001', 'monitor');
  const member  = await mk('Padmini', '8003', 'patient');
  const member2 = await mk('No Plan Yet', '8004', 'patient');
  await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true), ($1,$3,true)`, [coach, member, member2]);
  const today = getISTDate();
  await pool.query(`INSERT INTO patient_profiles (user_id, height_cm, start_weight) VALUES ($1, 160, 72), ($2, 170, 80)`, [member, member2]);
  await pool.query(`INSERT INTO lab_values (patient_id, test_date, test_name, value, unit, status) VALUES ($1, $2::date - 20, 'Fasting Glucose', 132, 'mg/dL', 'high')`, [member, today]);

  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const M = tok(member, 'patient'), M2 = tok(member2, 'patient');
  const srv = app.listen(0); const port = srv.address().port;
  const call = async (method, p, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, {
      method, headers: { 'content-type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const inTx = async (fn) => { const c = await pool.connect(); try { await c.query('BEGIN'); const o = await fn(c); await c.query('COMMIT'); return o; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } };
  const saveDraft = (raw, brief) => {
    const d = DP.normaliseDraft(raw);
    const flags = [{ kind: 'lab', test: 'Fasting Glucose', status: 'high', value: 132, unit: 'mg/dL', source: 'Lab result', date: DP.addDays(today, -20), stale: false, text: 'Fasting Glucose is high: 132 mg/dL' }];
    return inTx(c => DP.saveDraft(c, { memberId: member, coachId: coach, source: 'brief', title: d.title, brief, targets: d.targets, content: d.content, flags, days: d.days }));
  };

  console.log('\n[2] a draft is never sent to the member');
  let planId;
  {
    planId = await saveDraft(PLAN(), 'SECRET-BRIEF low carb veg 1500 kcal');
    const t = await call('GET', '/api/members/me/today', M);
    ck('the day still loads', t.status === 200 && Array.isArray(t.data.meal_plan?.meals), t.data);
    ck('with a draft only, diet_plan is null and no meals are prescribed', t.data.diet_plan === null && t.data.meal_plan.meals.length === 0, [t.data.diet_plan, t.data.meal_plan]);
    ck('the chat is given no plan lines for a draft', (await DP.memberPlanLines(pool, member, today, [])).length === 0);
  }

  console.log('\n[3] the approved plan, as the member gets it');
  {
    await inTx(c => DP.approveDraft(c, planId, { coachId: coach, today, effectiveFrom: today, acknowledgeWarnings: true }));
    const t = await call('GET', '/api/members/me/today', M);
    const p = t.data.diet_plan;
    ck('diet_plan is now the approved plan', t.status === 200 && p && p.id === planId && p.version === 1 && p.title === 'Low carb vegetarian', p);
    ck('with its targets, eating window, timetable and avoid list', p.targets.kcal === 1500 && p.content.eating_window === '12:00-20:00' && p.content.timetable.length === 2 && p.content.avoid.join() === 'sugar,maida', p.content);
    ck('and seven days of meals for looking ahead', p.days.length === 7 && p.days.every(d => d.length === 3));
    ck('the lab cautions are sent', p.content.lab_cautions.length === 1 && /Fasting Glucose is high: 132 mg\/dL/.test(p.content.lab_cautions[0]), p.content.lab_cautions);
    const raw = JSON.stringify(t.data.diet_plan);
    ck('the coach\'s brief is NOT sent', !raw.includes('SECRET-BRIEF') && p.brief === undefined);
    ck('nor the flags, the checks, or the model\'s adjustment notes', p.flags === undefined && p.checks === undefined && p.content.adjustments === undefined && !raw.includes('Carbs kept low'), Object.keys(p));
    ck('it is the same plan GET /diet-plans/me returns', JSON.stringify((await call('GET', '/api/diet-plans/me', M)).data.plan) === raw);

    const meals = t.data.meal_plan.meals;
    ck('today\'s meals come in eating order, though the plan listed Meal 3 first', meals.map(m => m.meal).join() === 'Meal 1,Meal 2,Meal 3', meals.map(m => m.meal));
    ck('each carries its time from the plan', meals.map(m => m.time).join() === '12:00,16:00,19:30', meals.map(m => m.time));
    ck('and its items with grams and nutrition', meals[1].items.length === 4 && meals[1].items[0].name === 'Whey protein' && meals[1].items[0].per_100g.calories === 400);
    const mp = await call('GET', '/api/members/me/meal-plan', M);
    ck('GET /me/meal-plan gives the same meals with the same times', JSON.stringify(mp.data.meals) === JSON.stringify(meals), mp.data.meals?.map(m => m.time));
    const tomorrow = await call('GET', `/api/members/me/meal-plan?date=${DP.addDays(today, 1)}`, M);
    ck('another date gets that weekday\'s times too', tomorrow.data.meals.length === 3 && tomorrow.data.meals[0].time === '12:00');

    const none = await call('GET', '/api/members/me/today', M2);
    ck('a member with no plan: diet_plan null, day loads, no meals', none.status === 200 && none.data.diet_plan === null && none.data.meal_plan.meals.length === 0);
    ck('a coach token cannot read a member\'s day', (await call('GET', '/api/members/me/today', tok(coach, 'monitor'))).status === 403);
  }

  console.log('\n[4] a coach\'s one-off meal for today');
  {
    await pool.query(`INSERT INTO meal_plans (patient_id, monitor_id, plan_date, meal, items) VALUES ($1,$2,$3,'Evening snack','[{"name":"Roasted chana","grams":30,"per_100g":{"calories":360}}]')`, [member, coach, today]);
    const meals = (await call('GET', '/api/members/me/today', M)).data.meal_plan.meals;
    ck('it is kept, after the timed meals, with no time', meals.length === 4 && meals[3].meal === 'Evening snack' && meals[3].time === null, meals.map(m => [m.meal, m.time]));
  }

  console.log('\n[5] what the member chat is told');
  {
    let lines = await DP.memberPlanLines(pool, member, today, []);
    const text = lines.join('\n');
    ck('a headline with the plan name, the number of meals and the day\'s calories', /Diet plan from the coach for today: "Low carb vegetarian" - 4 meals, 1639 kcal in all/.test(lines[0]), lines[0]);
    ck('the eating window', /Eating window: 12:00-20:00/.test(text));
    ck('each meal with its time, calories and every item with grams', /12:00 Meal 1 \(511 kcal\) - NOT logged yet: Curd 200 g, Palak paneer 150 g, Moong dal 100 g, Cucumber salad 100 g/.test(text), text);
    ck('in eating order', text.indexOf('Meal 1') < text.indexOf('Meal 2') && text.indexOf('Meal 2') < text.indexOf('Meal 3'));
    ck('the avoid list', /Avoid: sugar, maida/.test(text));
    ck('lab values are NOT put into the chat prompt', !/132/.test(text));

    const food = [{ name: 'Curd', grams: 200, meal: 'Meal 1' }, ...['Whey protein', 'Almonds', 'Guava', 'Buttermilk'].map(n => ({ name: n, grams: 1, meal: 'Meal 2' }))];
    lines = await DP.memberPlanLines(pool, member, today, food);
    ck('a meal logged in part says so', lines.some(l => /Meal 1 .* partly logged \(1 of 4 items\)/.test(l)), lines);
    ck('a meal logged in full says LOGGED', lines.some(l => /Meal 2 \(418 kcal\) - LOGGED/.test(l)), lines);
    ck('a meal not touched says NOT logged yet', lines.some(l => /Meal 3 \(602 kcal\) - NOT logged yet/.test(l)));
    ck('no plan, no lines', (await DP.memberPlanLines(pool, member2, today, [])).length === 0);
    ck('a database failure gives no lines instead of breaking the chat', (await DP.memberPlanLines({ query: async () => { throw new Error('down'); } }, member, today, [])).length === 0);

    await pool.query(`INSERT INTO daily_logs (patient_id, log_date, food_items) VALUES ($1, $2::date, $3)`, [member, today, JSON.stringify([{ name: 'Curd', grams: 200, meal: 'Meal 1', per_100g: { calories: 60 } }])]);
    const r = await call('POST', '/api/ai-chat/parse', M, { message: "aaj ka meal plan kya hai?", context: {} });
    ck('asking the chat returns an answer, not a log', r.status === 200 && r.data.question === true && r.data.reply === 'Stub answer.', r.data);
    ck('the answer was written from the plan lines: times, foods, grams', /16:00 Meal 2 \(418 kcal\) - NOT logged yet: Whey protein 30 g, Almonds 20 g, Guava 150 g, Buttermilk 200 g/.test(lastAnswerPrompt), lastAnswerPrompt.slice(lastAnswerPrompt.indexOf('Diet plan'), lastAnswerPrompt.indexOf('Diet plan') + 500));
    ck('with the real food log deciding what is logged', /Meal 1 \(511 kcal\) - partly logged \(1 of 4 items\)/.test(lastAnswerPrompt));
    ck('the AI is told to answer meal-plan questions from those lines only', /answer from the "Diet plan from\s+the coach" lines only/.test(lastAnswerPrompt));
    ck('and never to add, swap, remove or resize a food', /Never add, swap, remove\s+or resize a food/.test(lastAnswerPrompt));
    await call('POST', '/api/ai-chat/parse', M2, { message: 'what do I eat today?', context: {} });
    ck('a member with no plan: the prompt has no plan lines, and says what to answer', !/Diet plan from the coach for today/.test(lastAnswerPrompt) && /has not set a meal plan for today/.test(lastAnswerPrompt));
  }

  console.log(`\n${fail === 0 ? '\u2713' : '\u2717'} test-member-plan: ${pass} passed, ${fail} failed\n`);
  srv.close(); await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
