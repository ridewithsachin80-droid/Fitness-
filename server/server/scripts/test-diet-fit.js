/**
 * scripts/test-diet-fit.js — Diet Plan Studio, Phase 1.3.
 *
 * Real Postgres, real routes, real service. Only the AI transport is stubbed.
 *
 * WHAT MUST HOLD
 * --------------
 *   A. A day over the calorie target by more than 5% cannot be approved, with
 *      or without "I have read the warnings". Under the target is a warning.
 *      A day over the carb target (+5%) cannot be approved either.
 *   B. "Fit to target" is arithmetic: it brings every day inside the range by
 *      scaling portions, never touches a compulsory item, keeps an everyday
 *      food the same on every day, shows the change before saving, and says
 *      plainly when a day cannot be fitted.
 *   C. Lab cautions are written by the app from the stored flags. The model
 *      cannot add, change or drop them, and neither can an edit.
 *   D. "Soppu (kale)" is caught, and both prompts tell the model to name the
 *      actual green.
 *   E. "Draft a diet plan for …" in the coach chat creates a Studio DRAFT and
 *      nothing else: no meals written, nothing approved, nothing the member
 *      can see.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'stub-key';

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const path = require('path');

const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;

const it = (name, grams, k, p, c, f, compulsory) =>
  ({ name, grams, qty_text: `${grams} g`, kcal_100g: k, protein_100g: p, carbs_100g: c, fat_100g: f, ...(compulsory ? { compulsory: true } : {}) });

// The shape of the plan found on the live site on 3 Oct: a 1,500 kcal target
// and days of about 2,300. Curd and whey are fixed by the brief.
const OVER = () => ({
  title: 'Low carb vegetarian',
  targets: { kcal: 1500, protein: 120, carbs: 80, fat: 78 },
  meals: [
    { meal: 'Meal 1', time: '12:00',
      items: [it('Curd', 200, 60, 3.5, 4.5, 3, true), it('Moong dal', 150, 105, 7, 15, 0.5), it('Cucumber salad', 150, 16, 0.7, 3.6, 0.1)],
      rotation: { mon: it('Paneer bhurji', 150, 265, 18, 4, 20), tue: it('Paneer-mushroom masala', 180, 200, 13, 6, 14),
                  wed: it('Tofu stir fry', 200, 160, 14, 5, 10), thu: it('Methi paneer', 150, 250, 16, 5, 18),
                  fri: it('Paneer-bean sabzi', 200, 180, 11, 8, 12), sat: it('Soya chunk curry', 200, 170, 18, 9, 7),
                  sun: it('Paneer tikka', 160, 260, 17, 5, 19) } },
    { meal: 'Meal 2', time: '16:00',
      items: [it('Whey protein', 30, 400, 80, 8, 6, true), it('Almonds', 40, 579, 21, 22, 50), it('Peanut chikki', 40, 520, 14, 50, 28), it('Guava', 150, 68, 2.6, 14, 1)] },
    { meal: 'Meal 3', time: '19:30',
      items: [it('Paneer', 150, 265, 18, 3, 20), it('Mixed veg sabzi', 250, 90, 3, 9, 5), it('Jowar roti', 60, 260, 8, 52, 2), it('Ghee', 15, 900, 0, 0, 100), it('Buttermilk', 200, 40, 3, 5, 1)] },
  ],
  avoid: ['sugar'],
  cautions: ['See your doctor for a BP check before starting the gym.'],
  adjustments: [],
  // A model that writes its own lab cautions must not get them onto the plan.
  lab_cautions: ['Potassium is critically high. Stop eating bananas.'],
});

const COACH_MARK = 'fitness COACH managing members';
let aiMode = 'ok', nextDraft = null, nextCoach = null, lastDraftText = '', draftCalls = 0;
const stubbedPost = async (url, body, cfg) => {
  if (String(url).includes('generativelanguage') || String(url).includes('groq')) {
    const sent = JSON.stringify(body);
    const reply = (text) => ({ data: { candidates: [{ content: { parts: [{ text }] } }], choices: [{ message: { content: text } }] } });
    if (sent.includes('NUTRITION LOOKUP')) return reply(JSON.stringify({ foods: [] }));
    // The coach chat's own prompt. Routed on its opening line, never on food words.
    if (sent.includes(COACH_MARK)) return reply(JSON.stringify(nextCoach));
    draftCalls += 1;
    lastDraftText = body.messages?.[0]?.content || body.contents?.[0]?.parts?.[0]?.text || '';
    if (aiMode === 'down') { const e = new Error('500'); e.response = { status: 500 }; throw e; }
    return reply(JSON.stringify(nextDraft || OVER()));
  }
  return realAxios.post(url, body, cfg);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const pool = require('../db/pool');
const ai   = require('../routes/aiChat');
const DP   = require('../services/dietPlan');
const dietRoutes = require('../routes/dietPlans');
const { getISTDate } = require('../utils/istDate');

const app = express(); app.use(express.json({ limit: '15mb' })); app.use(cookieParser());
app.use('/api/ai-chat', require('../routes/aiChat'));
app.use('/api/diet-plans', dietRoutes);
app.use('/api/members', require('../routes/patients'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 400))); };
const gramsOf = (days, name) => days.map(d => d.flatMap(m => m.items).find(i => i.name === name)?.grams);

(async () => {
  // ── Pure rules ──────────────────────────────────────────────────────────────
  console.log('\n[0] the calorie and carb checks (no database)');
  const one = (kcalGrams, carbsPer100 = 0) => ({
    targets: { kcal: 1500, carbs: 80 }, content: {},
    days: DP.WEEKDAYS.map(() => [{ meal: 'Meal 1', time: null, items: [{ name: 'Mix', grams: kcalGrams, per_100g: { calories: 100, total_carbs: carbsPer100 } }] }]),
  });
  {
    ck('the allowed range for 1,500 kcal is 1,425 to 1,575', DP.kcalRange(1500).lo === 1425 && DP.kcalRange(1500).hi === 1575, DP.kcalRange(1500));
    const has = (plan, code) => DP.runChecks(plan).find(c => c.code === code);
    ck('a day exactly on the upper limit (1,575) passes', !has(one(1575), 'day_over'));
    ck('one kcal over the limit (1,576) is caught', !!has(one(1576), 'day_over'));
    ck('over the target is an ERROR: it blocks approval', has(one(2206), 'day_over').level === 'error' && DP.hasErrors(DP.runChecks(one(2206))));
    ck('the message names the day, its total and the allowed range', /Mon 2206/.test(has(one(2206), 'day_over').text) && /1425 to 1575/.test(has(one(2206), 'day_over').text), has(one(2206), 'day_over'));
    ck('a day exactly on the lower limit (1,425) passes', !has(one(1425), 'day_under'));
    ck('under the target (1,424) is a WARNING, not an error', has(one(1424), 'day_under')?.level === 'warn' && !DP.hasErrors(DP.runChecks(one(1424))));
    // 1500 g at 5.6 g carbs per 100 g = 84 g: exactly the limit for an 80 g target.
    ck('carbs exactly 5% over the target (84 g) pass', !has(one(1500, 5.6), 'carbs_over'), DP.runChecks(one(1500, 5.6)));
    ck('carbs past that (85 g) are an ERROR', has(one(1500, 5.667), 'carbs_over')?.level === 'error', DP.runChecks(one(1500, 5.667)));
    const noCarb = one(1500, 20); delete noCarb.targets.carbs;
    ck('no carb target, no carb check', !has(noCarb, 'carbs_over'));

    const green = (name) => { const p = one(1500); p.days[0][0].items[0].name = name; return has(p, 'vague_green'); };
    ck('"Sopu Palya (kale)" is caught', !!green('Sopu Palya (kale)'));
    ck('a bare "Soppu palya" is caught: it does not say which green', !!green('Soppu palya'));
    ck('"Palak soppu palya" names the green and passes', !green('Palak soppu palya'));
    ck('"Menthya soppu" passes', !green('Menthya soppu'));
    ck('an ordinary food is not flagged', !green('Paneer bhurji'));
  }

  console.log('\n[1] Fit to target (no database)');
  {
    const d = DP.normaliseDraft(OVER());
    const frozen = JSON.stringify(d);
    ck('the draft starts well over: every day is an error', DP.runChecks(d).some(c => c.code === 'day_over' && /Mon 2354/.test(c.text)), DP.runChecks(d));
    ck('compulsory marks survive normalising', d.days[0][0].items.find(i => i.name === 'Curd').compulsory === true && d.days[0][0].items.find(i => i.name === 'Moong dal').compulsory === false);

    const f = DP.fitToTarget(d);
    ck('it does not change the plan it was given', JSON.stringify(d) === frozen);
    ck('every day lands inside 1,425 to 1,575 kcal', f.totals.length === 7 && f.totals.every(t => t.fits && t.after.kcal >= 1425 && t.after.kcal <= 1575), f.totals);
    ck('and at or under the carb limit (84 g)', f.totals.every(t => t.after.carbs <= 84), f.totals.map(t => t.after.carbs));
    ck('nothing is reported as unfitted', f.unfit.length === 0, f.unfit);
    ck('the checks agree: no error is left', !DP.hasErrors(DP.runChecks({ ...d, days: f.days })), DP.runChecks({ ...d, days: f.days }));
    ck('compulsory curd keeps 200 g on all seven days', gramsOf(f.days, 'Curd').every(g => g === 200), gramsOf(f.days, 'Curd'));
    ck('compulsory whey keeps 30 g on all seven days', gramsOf(f.days, 'Whey protein').every(g => g === 30));
    ck('compulsory items are not in the list of changes', !f.changes.some(c => c.name === 'Curd' || c.name === 'Whey protein'), f.changes.map(c => c.name));
    ck('an everyday carb food is the same on every day (one change line, seven days)',
       new Set(gramsOf(f.days, 'Guava')).size === 1 && f.changes.find(c => c.name === 'Guava').weekdays.length === 7, gramsOf(f.days, 'Guava'));
    ck('each change says from and to', f.changes.every(c => c.from > 0 && c.to > 0 && c.from !== c.to && c.weekdays.length > 0));
    const ratios = f.days.flatMap((day, w) => day.flatMap((m, mi) => m.items.map((x, i) => x.grams / d.days[w][mi].items[i].grams)));
    ck('no portion is cut below 40% or raised above 250%', Math.min(...ratios) >= 0.39 && Math.max(...ratios) <= 2.51, [Math.min(...ratios), Math.max(...ratios)]);
    ck('a changed item shows its new grams as its quantity', f.days[0][0].items.find(i => i.name === 'Moong dal').qty_text === `${f.days[0][0].items.find(i => i.name === 'Moong dal').grams} g`);
    ck('compulsory marks are still on the fitted plan', f.days[3][0].items.find(i => i.name === 'Curd').compulsory === true);
    ck('fitting a plan that already fits changes nothing', DP.fitToTarget({ ...d, days: f.days }).changes.length === 0);

    const up = DP.fitToTarget({ ...d, targets: { kcal: 2800 } });
    ck('a plan under its target is scaled UP into range', up.totals.every(t => t.fits && t.after.kcal > t.before.kcal), up.totals);
    ck('scaled up, an everyday food still has the same grams on all seven days', ['Paneer', 'Almonds', 'Moong dal'].every(n => new Set(gramsOf(up.days, n)).size === 1 && gramsOf(up.days, n)[0] > gramsOf(d.days, n)[0]),
       ['Paneer', 'Almonds', 'Moong dal'].map(n => gramsOf(up.days, n)));

    const locked = JSON.parse(frozen); locked.days.forEach(day => day.forEach(m => m.items.forEach(i => { i.compulsory = true; })));
    const lf = DP.fitToTarget(locked);
    ck('all items compulsory: nothing changes and every day says why', lf.changes.length === 0 && lf.unfit.length === 7 && /compulsory/.test(lf.unfit[0].reason), lf.unfit[0]);

    const heavy = JSON.parse(frozen);
    heavy.days.forEach(day => { day[0].items.find(i => i.name === 'Curd').grams = 2000; day[2].items.find(i => i.name === 'Paneer').compulsory = true; });
    const hf = DP.fitToTarget(heavy);
    ck('compulsory items alone over the target: says so, with their total, and leaves the day alone',
       hf.unfit.length === 7 && /compulsory items alone are \d+ kcal/.test(hf.unfit[0].reason) && gramsOf(hf.days, 'Moong dal').every(g => g === 150), [hf.unfit[0], gramsOf(hf.days, 'Moong dal')]);

    const carby = JSON.parse(frozen); carby.targets.carbs = 30;
    const cf = DP.fitToTarget(carby);
    ck('a carb limit the foods cannot reach is reported, naming the biggest carb foods', cf.unfit.length > 0 && /Carbs still come to \d+ g/.test(cf.unfit[0].reason) && /remove or swap/.test(cf.unfit[0].reason), cf.unfit[0]);
    ck('and the day is still fitted on calories, not starved', cf.totals.every(t => t.after.kcal >= 1425 && t.after.kcal <= 1575), cf.totals.map(t => t.after.kcal));

    ck('no calorie target: refuses, with a reason', DP.fitToTarget({ targets: {}, days: d.days }).ok === false);
  }

  console.log('\n[2] lab cautions are written by the app');
  {
    const flags = DP.buildFlags([
      { test_name: 'Fasting Glucose', value: 132, unit: 'mg/dL', status: 'high', test_date: '2026-09-12' },
      { test_name: 'TSH', value: 6.8, unit: 'mIU/L', status: 'high', test_date: '2026-09-12' },
      { test_name: 'Vitamin B12', value: 180, unit: 'pg/mL', status: 'low', test_date: '2026-09-12' },
      { test_name: 'Vitamin D', value: 14, unit: 'ng/mL', status: 'low', test_date: '2025-11-01' },
      { test_name: 'Uric Acid', value: 8.1, unit: 'mg/dL', status: 'high', test_date: '2026-09-12' },
      { test_name: 'LDL', value: 162, unit: 'mg/dL', status: 'high', test_date: '2026-09-12' },
      { test_name: 'HDL Cholesterol', value: 32, unit: 'mg/dL', status: 'low', test_date: '2026-09-12' },
      { test_name: 'Zinc', value: 40, unit: 'ug/dL', status: 'low', test_date: '2026-09-12' },
      { test_name: 'HbA1c', value: 5.2, unit: '%', status: 'normal', test_date: '2026-09-12' },
    ], ['fatty_liver'], '2026-10-03');
    const c = DP.labCautions(flags);
    const find = (re) => c.find(x => re.test(x)) || '';
    ck('one caution for every flag, none for a normal result', c.length === flags.length && c.length === 9 && !find(/HbA1c/), c);
    ck('glucose: the value, the date, and food advice', /132 mg\/dL/.test(find(/Glucose/)) && /12 Sep 2026/.test(find(/Glucose/)) && /sweets/.test(find(/Glucose/)), find(/Glucose/));
    ck('TSH points to the doctor and prescribed medicine', /doctor/.test(find(/^TSH/)) && /as prescribed/.test(find(/^TSH/)), find(/^TSH/));
    ck('B12 and vitamin D each get their own line', /B12 supplement/.test(find(/B12 is low/)) && /vitamin D supplement/.test(find(/Vitamin D is low/)));
    ck('an old result says so', /old result/.test(find(/Vitamin D is low/)), find(/Vitamin D is low/));
    ck('uric acid and LDL are covered', /water/.test(find(/Uric Acid/)) && /fried food/.test(find(/^LDL/)));
    ck('low HDL does not get the high-cholesterol advice', !/fried food/.test(find(/HDL Cholesterol/)) && /exercise/.test(find(/HDL Cholesterol/)), find(/HDL Cholesterol/));
    ck('a test with no specific advice still gets a "see your doctor" line', /Zinc is low: 40 ug\/dL/.test(find(/Zinc/)) && /doctor/.test(find(/Zinc/)), find(/Zinc/));
    ck('a profile condition gets a line too', /fatty liver/.test(find(/Condition on file/)) && /alcohol/.test(find(/Condition on file/)));
    ck('no caution names a dose or tells anyone to start a medicine', c.every(x => !/\d+\s?(mg|mcg|iu)\b(?!\/)/i.test(x.split(').')[1] || '')), c);
    ck('no flags, no cautions', DP.labCautions([]).length === 0 && DP.labCautions(null).length === 0);
  }

  console.log('\n[3] what the model is told');
  {
    const ctx = { flags: [] };
    const p = dietRoutes.buildDraftPrompt(ctx, 'Low carb veg, 1,500 kcal, carbs below 80 g, 200 g curd daily');
    ck('a calorie figure in the brief becomes an exact allowed range', /ALLOWED RANGE PER DAY: 1425 to 1575 kcal/.test(p), p.slice(0, 900));
    ck('no calorie figure in the brief: no made-up range', !/ALLOWED RANGE PER DAY/.test(dietRoutes.buildDraftPrompt(ctx, 'Low carb veg, three meals a day')));
    ck('"80 g" of carbs is not mistaken for calories', dietRoutes.kcalFromBrief('carbs below 80 g, 3 meals') === null && dietRoutes.kcalFromBrief('1800 calories') === 1800);
    ck('the model is told a day must never go above the range', /never above it/.test(p) && /within 5% of targets\.kcal/.test(p));
    ck('and that compulsory items are marked', /"compulsory": true ONLY when the brief fixes/.test(p));
    ck('and to name the actual green, never kale', /Never write "kale"/.test(p) && /palak, dantu/.test(p));
    ck('the nutrition lookup carries the same greens rule', /Never write "kale"/.test(dietRoutes.buildFillPrompt(['Soppu palya'])));
    ck('and not to repeat the lab cautions the app writes', /The app adds a caution for each out-of-range result/.test(p));
  }

  // ── Database ────────────────────────────────────────────────────────────────
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (name, phone, role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`,
    [name, phone, role])).rows[0].id;
  const coach   = await mk('Sachin', '7001', 'monitor');
  const coach2  = await mk('Other Coach', '7002', 'monitor');
  const member  = await mk('Ravi Kumar', '7003', 'patient');
  const member2 = await mk('Someone Else', '7004', 'patient');
  await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true), ($3,$4,true)`, [coach, member, coach2, member2]);
  const today = getISTDate();
  await pool.query(`INSERT INTO patient_profiles (user_id, height_cm, start_weight, conditions) VALUES ($1, 172, 88, '["fatty_liver"]')`, [member]);
  await pool.query(
    `INSERT INTO lab_values (patient_id, test_date, test_name, value, unit, status) VALUES
       ($1, $2::date - 20, 'Fasting Glucose', 132, 'mg/dL', 'high'),
       ($1, $2::date - 20, 'TSH', 6.8, 'mIU/L', 'high'),
       ($1, $2::date - 20, 'Uric Acid', 8.1, 'mg/dL', 'high')`, [member, today]);

  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const C = tok(coach, 'monitor'), C2 = tok(coach2, 'monitor'), M = tok(member, 'patient');
  const srv = app.listen(0); const port = srv.address().port;
  const call = async (method, p, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, {
      method, headers: { 'content-type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const mealCount = async () => Number((await pool.query(`SELECT COUNT(*) AS n FROM meal_plans WHERE patient_id=$1`, [member])).rows[0].n);
  const dbItems = async (planId) => (await pool.query(`SELECT weekday, meal, name, grams, compulsory FROM diet_plan_items WHERE plan_id=$1 ORDER BY weekday, meal_order, position`, [planId])).rows;

  console.log('\n[4] an over-target draft cannot be approved');
  let draftId;
  {
    const r = await call('POST', '/api/diet-plans/draft', C, { member_id: member, brief: 'Low carb vegetarian, 1500 kcal, carbs below 80 g, 200 g curd daily, whey after gym' });
    ck('the draft is saved', r.status === 200 && r.data.plan?.status === 'draft', r.data);
    draftId = r.data.plan.id;
    const codes = r.data.plan.checks.map(c => `${c.level}:${c.code}`);
    ck('with a must-fix error for the calories and one for the carbs', codes.includes('error:day_over') && codes.includes('error:carbs_over'), codes);
    const a = await call('POST', `/api/diet-plans/${draftId}/approve`, C, { acknowledge_warnings: true });
    ck('approving is refused even with "I have read the warnings"', a.status === 422 && !a.data.needs_ack && /Over the 1500 kcal target/.test(a.data.error), a.data);
    ck('it is still a draft, and no meals were written', (await pool.query(`SELECT status FROM diet_plans WHERE id=$1`, [draftId])).rows[0].status === 'draft' && (await mealCount()) === 0);
    ck('the member still has no plan', (await call('GET', '/api/diet-plans/me', M)).data.plan === null);

    const rows = await dbItems(draftId);
    ck('compulsory is stored on the item rows (real Postgres column)', rows.filter(x => x.name === 'Curd').length === 7 && rows.filter(x => x.name === 'Curd').every(x => x.compulsory === true)
       && rows.filter(x => x.name === 'Guava').every(x => x.compulsory === false), rows.filter(x => x.name === 'Curd'));
    ck('and comes back on the plan the coach sees', r.data.plan.days[0][1].items.find(i => i.name === 'Whey protein').compulsory === true);
  }

  console.log('\n[5] lab cautions on the draft');
  {
    const plan = (await call('GET', `/api/diet-plans/${draftId}`, C)).data.plan;
    const lc = plan.content.lab_cautions || [];
    ck('one caution per stored flag: glucose, TSH, uric acid, fatty liver', lc.length === 4 && ['Fasting Glucose', 'TSH', 'Uric Acid', 'fatty liver'].every(k => lc.some(x => x.includes(k))), lc);
    ck('the model\'s own "lab caution" did not get onto the plan', !JSON.stringify(plan.content).includes('Potassium'), plan.content);
    ck('the model\'s ordinary caution is kept, separately', plan.content.cautions.length === 1 && /BP check/.test(plan.content.cautions[0]));

    let r = await call('PATCH', `/api/diet-plans/${draftId}`, C, { content: { cautions: [], lab_cautions: [] } });
    ck('an edit can clear the ordinary cautions', r.status === 200 && r.data.plan.content.cautions.length === 0, r.data.plan?.content);
    ck('but cannot clear the lab cautions', r.data.plan.content.lab_cautions.length === 4, r.data.plan?.content.lab_cautions);
    r = await call('PATCH', `/api/diet-plans/${draftId}`, C, { content: { lab_cautions: ['All clear, eat anything.'] } });
    ck('or replace them with other words', r.data.plan.content.lab_cautions.length === 4 && !JSON.stringify(r.data.plan.content).includes('All clear'), r.data.plan?.content.lab_cautions);
  }

  console.log('\n[6] fixing a portion from the Studio');
  {
    let r = await call('PATCH', `/api/diet-plans/${draftId}`, C, { edits: [{ meal: 'Meal 3', name: 'Ghee', compulsory: true }] });
    ck('"Fix this portion" marks the item on every day', r.status === 200 && r.data.plan.days.every(d => d[2].items.find(i => i.name === 'Ghee').compulsory === true), r.data);
    ck('its grams do not change', r.data.plan.days.every(d => d[2].items.find(i => i.name === 'Ghee').grams === 15));
    r = await call('PATCH', `/api/diet-plans/${draftId}`, C, { edits: [{ meal: 'Meal 3', name: 'Ghee', compulsory: false }] });
    ck('and it can be freed again', r.data.plan.days.every(d => d[2].items.find(i => i.name === 'Ghee').compulsory === false));
    r = await call('PATCH', `/api/diet-plans/${draftId}`, C, { edits: [{ meal: 'Meal 1', name: 'Moong dal', grams: 140 }] });
    ck('a grams edit does not lose the compulsory mark on other items', r.data.plan.days[0][0].items.find(i => i.name === 'Curd').compulsory === true && r.data.plan.days[0][0].items.find(i => i.name === 'Moong dal').grams === 140);
    await call('PATCH', `/api/diet-plans/${draftId}`, C, { edits: [{ meal: 'Meal 1', name: 'Moong dal', grams: 150 }] });
  }

  console.log('\n[7] Fit to target: preview, then save');
  {
    ck('the member cannot use it', (await call('POST', `/api/diet-plans/${draftId}/fit`, M, {})).status === 403);
    ck('another coach cannot use it', (await call('POST', `/api/diet-plans/${draftId}/fit`, C2, { apply: true })).status === 403);
    const before = JSON.stringify(await dbItems(draftId));
    const p = await call('POST', `/api/diet-plans/${draftId}/fit`, C, {});
    ck('the preview lists the changes and each day before and after', p.status === 200 && p.data.applied === false && p.data.fit.changes.length > 5 && p.data.fit.totals.length === 7 && p.data.fit.totals[0].before.kcal === 2354, p.data);
    ck('the preview carries the allowed range', p.data.fit.range.lo === 1425 && p.data.fit.range.hi === 1575 && p.data.fit.range.carb_cap === 84, p.data.fit.range);
    ck('the preview saves NOTHING', JSON.stringify(await dbItems(draftId)) === before);
    ck('the preview does not send the whole plan back', p.data.fit.days === undefined && p.data.plan === undefined);

    const a = await call('POST', `/api/diet-plans/${draftId}/fit`, C, { apply: true });
    ck('saving returns the re-checked plan', a.status === 200 && a.data.applied === true && a.data.plan.id === draftId, a.data);
    const codes = a.data.plan.checks.map(c => `${c.level}:${c.code}`);
    ck('no must-fix error is left', !codes.some(c => c.startsWith('error')), codes);
    const rows = await dbItems(draftId);
    const dayKcal = a.data.plan.days.map(d => DP.dayTotals(d).kcal);
    ck('every day in the database is inside 1,425 to 1,575 kcal', dayKcal.every(k => k >= 1425 && k <= 1575), dayKcal);
    ck('compulsory curd is still 200 g on all seven days in the database', rows.filter(x => x.name === 'Curd').every(x => Number(x.grams) === 200 && x.compulsory === true), rows.filter(x => x.name === 'Curd'));
    ck('what was saved is what the preview showed', p.data.fit.changes.every(c => c.weekdays.every(w => Number(rows.find(x => x.weekday === w && x.meal === c.meal && x.name === c.name).grams) === c.to)), p.data.fit.changes.slice(0, 3));
    ck('the lab cautions are still on the plan', a.data.plan.content.lab_cautions.length === 4);
    ck('still a draft: fitting approves nothing', a.data.plan.status === 'draft' && (await mealCount()) === 0);
    const again = await call('POST', `/api/diet-plans/${draftId}/fit`, C, { apply: true });
    ck('fitting a plan that already fits saves nothing and says so', again.status === 200 && again.data.applied === false && again.data.fit.changes.length === 0, again.data);
  }

  console.log('\n[8] a redraft cannot drop the lab cautions');
  {
    const redraft = OVER(); redraft.cautions = ['Drink more water.']; delete redraft.lab_cautions;
    redraft.meals[0].items[0].name = 'Sopu Palya (kale)';
    nextDraft = redraft;
    const r = await call('POST', '/api/diet-plans/draft', C, { member_id: member, instruction: 'swap the curd for a greens palya' });
    ck('the redraft is saved', r.status === 200, r.data);
    draftId = r.data.plan.id;
    ck('all four lab cautions are still there', r.data.plan.content.lab_cautions.length === 4 && r.data.plan.content.lab_cautions.some(x => /Fasting Glucose is high: 132 mg\/dL/.test(x)), r.data.plan.content);
    ck('the model is told to keep the existing cautions', /Keep every existing caution/.test(lastDraftText));
    ck('and that compulsory items keep their grams', /Items marked "compulsory" keep their grams/.test(lastDraftText));
    ck('the current draft is sent with its compulsory marks', /"name":"Curd","grams":200,"compulsory":true/.test(lastDraftText), lastDraftText.slice(lastDraftText.indexOf('CURRENT DRAFT'), lastDraftText.indexOf('CURRENT DRAFT') + 300));
    ck('and with the exact range for its own target', /ALLOWED RANGE PER DAY: 1425 to 1575 kcal/.test(lastDraftText) && /CARB LIMIT PER DAY: 80 g/.test(lastDraftText));
    ck('the app\'s lab cautions are not sent to the model to rewrite', !/Fasting Glucose is high: 132 mg\/dL \(/.test(lastDraftText.slice(lastDraftText.indexOf('CURRENT DRAFT'))));
    ck('"Sopu Palya (kale)" in the answer raises the greens warning', r.data.plan.checks.some(c => c.code === 'vague_green' && /Sopu Palya \(kale\)/.test(c.text)), r.data.plan.checks);
    nextDraft = null;
  }

  console.log('\n[9] fit, approve, and what the member gets');
  {
    await call('POST', '/api/diet-plans/draft', C, { member_id: member, brief: 'Low carb vegetarian, 1500 kcal, carbs below 80 g' });
    draftId = (await pool.query(`SELECT id FROM diet_plans WHERE patient_id=$1 AND status='draft'`, [member])).rows[0].id;
    await call('POST', `/api/diet-plans/${draftId}/fit`, C, { apply: true });
    const a = await call('POST', `/api/diet-plans/${draftId}/approve`, C, { acknowledge_warnings: true });
    ck('once fitted, the plan can be approved', a.status === 200 && a.data.plan.status === 'approved', a.data);
    const me = (await call('GET', '/api/diet-plans/me', M)).data.plan;
    ck('the member\'s plan carries the lab cautions', me.content.lab_cautions.length === 4, me?.content);
    const rows = (await pool.query(`SELECT items FROM meal_plans WHERE patient_id=$1 AND plan_date=$2::date`, [member, today])).rows;
    const kcal = Math.round(rows.flatMap(x => x.items).reduce((s, i) => s + i.grams * i.per_100g.calories / 100, 0));
    ck('today\'s prescribed meals add up inside the range', rows.length === 3 && kcal >= 1425 && kcal <= 1575, kcal);
    ck('an approved plan cannot be fitted', (await call('POST', `/api/diet-plans/${draftId}/fit`, C, { apply: true })).status === 409);
  }

  console.log('\n[10] "draft a diet plan" in the coach chat');
  {
    const cmd = (name, extra = {}) => ({ reply: 'Preparing a draft diet plan for review.', question: null,
      commands: [{ member_name: name, diet_plan: { brief: 'Low carb vegetarian, 1500 kcal, carbs below 80 g, three meals' }, ...extra }] });
    nextCoach = cmd('Ravi Kumar');
    const mealsBefore = await mealCount();
    const callsBefore = draftCalls;
    let r = await call('POST', '/api/ai-chat/coach-parse', C, { message: 'Draft a diet plan for Ravi: low carb veg, 1500 kcal, carbs below 80 g, three meals' });
    const act = r.data.actions?.[0];
    ck('the chat proposes one action for the member', r.status === 200 && r.data.actions.length === 1 && act.member_id === member && act.resolved === true, r.data);
    ck('carrying the brief', /1500 kcal/.test(act.ops.diet_plan.brief), act?.ops);
    ck('the preview says it is a draft, in the Studio, and not sent', /Draft a diet plan in the Studio/.test(act.changes[0].text) && /Not sent to the member/.test(act.changes[0].text), act?.changes);
    ck('parsing alone writes no draft and calls no plan AI', draftCalls === callsBefore && (await pool.query(`SELECT 1 FROM diet_plans WHERE patient_id=$1 AND status='draft'`, [member])).rows.length === 0);

    nextCoach = cmd('ALL');
    r = await call('POST', '/api/ai-chat/coach-parse', C, { message: 'Draft a diet plan for everyone' });
    ck('a diet plan for "everyone" is dropped', r.status === 200 && r.data.actions.length === 0, r.data);
    nextCoach = { reply: 'x', question: null, commands: [{ member_name: 'Ravi Kumar', diet_plan: { brief: 'ok' } }] };
    r = await call('POST', '/api/ai-chat/coach-parse', C, { message: 'Draft a diet plan for Ravi, 1800 kcal high protein' });
    ck('a brief the model cut to nothing falls back to the coach\'s own words', /1800 kcal high protein/.test(r.data.actions[0]?.ops.diet_plan.brief), r.data.actions?.[0]?.ops);

    const versionInForce = (await call('GET', '/api/diet-plans/me', M)).data.plan.version;
    r = await call('POST', '/api/ai-chat/coach-apply', C, { actions: [{ member_id: act.member_id, is_all: false, ops: act.ops }] });
    const res = r.data.results?.[0];
    ck('Apply creates the draft', r.status === 200 && res.ok === true && /diet plan draft ready/.test(res.detail), r.data);
    ck('and hands back a link target for the Nutrition tab', res.studio?.member_id === member && Number.isInteger(res.studio.plan_id), res);
    const row = (await pool.query(`SELECT id, status, source, brief, approved_at FROM diet_plans WHERE id=$1`, [res.studio.plan_id])).rows[0];
    ck('it is a DRAFT, not approved', row.status === 'draft' && row.approved_at === null && row.source === 'brief', row);
    ck('saved with the coach\'s brief', /1500 kcal/.test(row.brief));
    ck('the result says how many must-fix checks are waiting', /must-fix/.test(res.detail), res.detail);
    ck('no prescribed meal was written or changed', (await mealCount()) === mealsBefore, [await mealCount(), mealsBefore]);
    ck('the member still sees the plan they had', (await call('GET', '/api/diet-plans/me', M)).data.plan.version === versionInForce);
    ck('the Studio shows it as the open draft, with lab cautions and checks', await (async () => {
      const s = (await call('GET', `/api/diet-plans/member/${member}`, C)).data;
      return s.draft?.id === row.id && s.draft.content.lab_cautions.length === 4 && s.draft.checks.some(c => c.code === 'day_over');
    })());

    nextCoach = cmd('Ravi Kumar');
    r = await call('POST', '/api/ai-chat/coach-parse', C, { message: 'Draft a diet plan for Ravi: low carb veg, 1500 kcal' });
    ck('asking again warns that the open draft will be replaced', /replaces the draft already open/.test(r.data.actions[0].changes[0].text), r.data.actions[0].changes);

    aiMode = 'down';
    r = await call('POST', '/api/ai-chat/coach-apply', C, { actions: [{ member_id: member, is_all: false, ops: act.ops }] });
    aiMode = 'ok';
    ck('if the AI is down, the result is a failure that says so, not "Applied"', r.data.results[0].ok === false && /not created/.test(r.data.results[0].detail) && !r.data.results[0].studio, r.data.results);
    ck('and the draft already open is untouched', (await pool.query(`SELECT id FROM diet_plans WHERE patient_id=$1 AND status='draft'`, [member])).rows[0]?.id === row.id);

    r = await call('POST', '/api/ai-chat/coach-apply', C2, { actions: [{ member_id: member, is_all: false, ops: act.ops }] });
    ck('another coach cannot draft for this member', r.data.results[0].ok === false && /Not assigned/.test(r.data.results[0].detail), r.data.results);
    ck('the coach prompt teaches the diet_plan operation and keeps it apart from meal_plan',
       /- diet_plan: \{ "brief"/.test(ai.buildCoachPrompt('x', [{ id: 1, name: 'A' }])) && /This is NOT meal_plan/.test(ai.buildCoachPrompt('x', [{ id: 1, name: 'A' }])));
  }

  console.log(`\n${fail === 0 ? '\u2713' : '\u2717'} test-diet-fit: ${pass} passed, ${fail} failed\n`);
  srv.close(); await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
