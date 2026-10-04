/**
 * scripts/test-diet-studio.js — Diet Plan Studio (Phase 1): versioned plans.
 *
 * Real Postgres, real routes, real service. Only the AI transport is stubbed.
 *
 * WHAT MUST HOLD
 * --------------
 *   1. A draft is never visible to the member, and writes no meals.
 *   2. Flags come from stored lab rows and profile conditions, each with its
 *      source and date — not from whatever the model says.
 *   3. Checks are arithmetic: macros against calories, meals against the
 *      target, the avoid list against the meals. Errors block approval;
 *      warnings need an explicit yes.
 *   4. An approved version cannot be edited or discarded.
 *   5. Two approvals at once: exactly one wins.
 *   6. Revising keeps the plan in force until the new version's start date.
 *   7. A plan does not run out: any day is generated from the version in force.
 *   8. A coach's one-day change is never overwritten by that generation, and
 *      lands on top of the plan rather than replacing the day.
 *   9. A multi-day plan applied from the coach chat becomes a version too.
 *  11. A plan draft gets a large reply limit, and a reply cut off at that
 *      limit is retried on the next model, never parsed as a plan. A change
 *      request shows the model the draft in the shape it must answer in.
 *  10. A food with no calorie figure blocks approval. The app asks the model
 *      once more for just those foods, and never swaps an as-eaten figure for
 *      a raw-ingredient row from the food table.
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

const it100 = (name, grams, kcal, p, c, f) => ({ name, grams, qty_text: `${grams} g`, kcal_100g: kcal, protein_100g: p, carbs_100g: c, fat_100g: f });
const DISH = ['Paneer bhurji', 'Paneer-mushroom masala', 'Paneer-stuffed capsicum', 'Methi paneer', 'Paneer-bean sabzi', 'Paneer-tomato masala', 'Paneer-peas bhurji'];
const DRAFT = () => ({
  title: 'Low-carb vegetarian, 16:8',
  eating_window: '12:00-20:00',
  // Deliberately inconsistent, as in the plan this feature was designed
  // around: 4*120 + 4*105 + 9*90 = 1710, not 1950.
  targets: { kcal: 1950, protein: 120, carbs: 105, fat: 90, fiber: 35 },
  timetable: [{ time: '5:30', what: 'Wake, 500 ml water' }, { time: '12:00', what: 'Meal 1' }],
  meals: [
    { meal: 'Meal 1', time: '12:00',
      items: [it100('Curd', 150, 60, 3.5, 4.5, 3), it100('Moong dal', 100, 105, 7, 18, 0.5)],
      rotation: { mon: it100(DISH[0], 100, 280, 18, 4, 21), tue: it100(DISH[1], 100, 240, 15, 6, 17),
                  wed: it100(DISH[2], 100, 230, 14, 7, 16), thu: it100(DISH[3], 100, 250, 16, 5, 18),
                  fri: it100(DISH[4], 100, 220, 14, 8, 15), sat: it100(DISH[5], 100, 240, 15, 6, 17),
                  sun: it100(DISH[6], 100, 260, 16, 8, 18) } },
    { meal: 'Meal 2', time: '15:30', items: [it100('Tofu', 100, 76, 8, 2, 4.8), it100('Guava', 100, 68, 2.6, 14, 1)] },
    { meal: 'Meal 3', time: '19:30', items: [it100('Almonds', 20, 579, 21, 22, 50), it100('Mystery soup', 200, 0, 0, 0, 0)] },
  ],
  avoid: ['sugar', 'ghee', 'potato'],
  cautions: ['See your doctor for a BP check before starting the gym.'],
  adjustments: [{ for: 'LDL', note: 'Low-fat paneer; MCT oil capped.' }],
  // A model that invents its own flags must not get them onto the plan.
  flags: [{ kind: 'lab', text: 'Potassium is critically high' }],
});

let aiMode = 'ok', lastPrompt = '', nextDraft = null, nextFill = null, fillCalls = 0, lastFillPrompt = '';
let lastDraftText = '', lastDraftBody = null, draftCalls = 0;
const stubbedPost = async (url, body, cfg) => {
  if (String(url).includes('generativelanguage') || String(url).includes('groq')) {
    // The second, smaller request: per-100 g figures for foods that came back
    // without any. Routed on its marker line, never on food words.
    if (JSON.stringify(body).includes('NUTRITION LOOKUP')) {
      fillCalls += 1; lastFillPrompt = JSON.stringify(body);
      const text = JSON.stringify(nextFill || { foods: [] });
      return { data: { candidates: [{ content: { parts: [{ text }] } }], choices: [{ message: { content: text } }] } };
    }
    lastPrompt = JSON.stringify(body);
    lastDraftBody = body; draftCalls += 1;
    lastDraftText = body.messages?.[0]?.content || body.contents?.[0]?.parts?.[0]?.text || '';
    if (aiMode === 'truncate-once') {
      aiMode = 'ok';
      const cut = JSON.stringify(nextDraft || DRAFT()).slice(0, 400);
      return { data: { candidates: [{ content: { parts: [{ text: cut }] }, finishReason: 'MAX_TOKENS' }],
                       choices: [{ message: { content: cut }, finish_reason: 'length' }] } };
    }
    if (aiMode === 'days-shape') {
      aiMode = 'ok';
      const d = DP.normaliseDraft(DRAFT());
      const text = JSON.stringify({ title: 'Seven-day answer', targets: DRAFT().targets,
        days: d.days.map(day => day.map(m => ({ meal: m.meal, time: m.time,
          items: m.items.map(i => ({ name: i.name, grams: i.grams, kcal_100g: i.per_100g.calories || 40,
            protein_100g: i.per_100g.protein, carbs_100g: i.per_100g.total_carbs, fat_100g: i.per_100g.fat })) }))) });
      return { data: { candidates: [{ content: { parts: [{ text }] } }], choices: [{ message: { content: text } }] } };
    }
    if (aiMode === 'down') { const e = new Error('503'); e.response = { status: 500 }; throw e; }
    const text = aiMode === 'garbage' ? 'Sorry, I cannot help with that.' : JSON.stringify(nextDraft || DRAFT());
    return { data: { candidates: [{ content: { parts: [{ text }] } }], choices: [{ message: { content: text } }] } };
  }
  return realAxios.post(url, body, cfg);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const pool = require('../db/pool');
const ai   = require('../routes/aiChat');
const DP   = require('../services/dietPlan');
const { getISTDate } = require('../utils/istDate');

const app = express(); app.use(express.json({ limit: '15mb' })); app.use(cookieParser());
app.use('/api/ai-chat', require('../routes/aiChat'));
app.use('/api/diet-plans', require('../routes/dietPlans'));
app.use('/api/members', require('../routes/patients'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };

(async () => {
  // ── Pure rules ──────────────────────────────────────────────────────────────
  console.log('\n[0] calendar and checks (no database)');
  {
    ck('2026-10-02 is a Friday (index 4, Monday = 0)', DP.weekdayOf('2026-10-02') === 4);
    ck('2026-10-04 is a Sunday (index 6)', DP.weekdayOf('2026-10-04') === 6);
    ck('addDays crosses a month end', DP.addDays('2026-10-30', 3) === '2026-11-02');

    const d = DP.normaliseDraft(DRAFT());
    ck('seven days', d.days.length === 7);
    ck("Monday's Meal 1 leads with Monday's dish", d.days[0][0].items[0].name === DISH[0]);
    ck("Sunday's Meal 1 leads with Sunday's dish", d.days[6][0].items[0].name === DISH[6]);
    ck('everyday items are on every day', d.days.every(day => day[0].items.some(i => i.name === 'Curd')));
    ck('a draft with no meals is rejected, not saved empty', DP.normaliseDraft({ meals: [] }) === null && DP.normaliseDraft({}) === null);

    const checks = DP.runChecks(d);
    const has = (code) => checks.some(c => c.code === code);
    ck('macros that do not add up to the calories are caught (1710 vs 1950)',
       has('macro_mismatch') && /1710/.test(checks.find(c => c.code === 'macro_mismatch').text), checks);
    ck('an item with no calorie figure is named', has('no_nutrition') && /Mystery soup/.test(checks.find(c => c.code === 'no_nutrition').text));
    ck('meals far under the target are caught', has('day_under'));
    ck('no avoid-list hit when no meal contains one', !has('avoid_conflict'));
    ck('a food with no calorie figure is an ERROR: it blocks approval', checks.find(c => c.code === 'no_nutrition').level === 'error' && DP.hasErrors(checks));
    ck('the other two are warnings', checks.filter(c => c.level === 'warn').map(c => c.code).sort().join() === 'day_under,macro_mismatch', checks);
    const fed = JSON.parse(JSON.stringify(d));
    fed.days.forEach(day => day.forEach(m => m.items.forEach(i => { if (i.name === 'Mystery soup') i.per_100g.calories = 35; })));
    ck('once every food has a figure there is no error', !DP.hasErrors(DP.runChecks(fed)));

    const ok = DP.runChecks({ ...d, targets: { kcal: 1710, protein: 120, carbs: 105, fat: 90 } });
    ck('consistent macros raise no macro warning', !ok.some(c => c.code === 'macro_mismatch'));

    const conflict = JSON.parse(JSON.stringify(d));
    conflict.days[2][1].items.push({ name: 'Aloo (potato) sabzi', grams: 100, per_100g: { calories: 90 } });
    conflict.days[2][1].items.push({ name: 'Gheeya', grams: 100, per_100g: { calories: 15 } });
    const cc = DP.runChecks(conflict).find(c => c.code === 'avoid_conflict');
    ck('an avoid-list food inside a meal is caught', !!cc && /potato/i.test(cc.text), cc);
    ck('a whole-word match: "ghee" does not flag "Gheeya"', !!cc && !/Gheeya/.test(cc.text), cc);

    const emptyDay = JSON.parse(JSON.stringify(d)); emptyDay.days[3] = [];
    const ec = DP.runChecks(emptyDay);
    ck('a weekday with no meals is an ERROR, naming the day', DP.hasErrors(ec) && /Thursday/.test(ec.find(c => c.level === 'error').text), ec);

    const flags = DP.buildFlags([
      { test_name: 'LDL', value: 150, unit: 'mg/dL', status: 'high', test_date: '2026-03-01' },
      { test_name: 'LDL', value: 185, unit: 'mg/dL', status: 'high', test_date: '2026-09-10' },
      { test_name: 'Vitamin D', value: 7.2, unit: 'ng/mL', status: 'low', test_date: '2025-12-01' },
      { test_name: 'HbA1c', value: 5.4, unit: '%', status: 'normal', test_date: '2026-09-10' },
    ], ['fatty_liver'], '2026-10-02');
    ck('only the latest result per test is used', flags.filter(f => f.test === 'LDL').length === 1 && flags.find(f => f.test === 'LDL').value === 185, flags);
    ck('a normal result raises no flag', !flags.some(f => f.test === 'HbA1c'));
    ck('every lab flag names its source and date', flags.filter(f => f.kind === 'lab').every(f => f.source === 'Lab result' && /^\d{4}-\d{2}-\d{2}$/.test(f.date)));
    ck('a result over six months old is marked as old', flags.find(f => f.test === 'Vitamin D').stale === true && flags.find(f => f.test === 'LDL').stale === false);
    ck('a profile condition is flagged with its source', flags.some(f => f.kind === 'condition' && /fatty liver/.test(f.text) && f.source === 'Member profile'));

    const b = JSON.parse(JSON.stringify(d));
    b.days.forEach(day => { day[0].items.find(i => i.name === 'Curd').grams = 200; });
    b.days[0][1].items.push({ name: 'Sprouts', grams: 50, per_100g: {} });
    b.days.forEach(day => { day[2].items = day[2].items.filter(i => i.name !== 'Almonds'); });
    b.targets = { ...b.targets, kcal: 1800 };
    const df = DP.diffPlans(d, b);
    ck('the same change on all seven days is ONE line', df.changed.length === 1 && df.changed[0].weekdays.length === 7 && df.changed[0].from === 150 && df.changed[0].to === 200, df.changed);
    ck('an item added on one day is listed for that day', df.added.length === 1 && df.added[0].name === 'Sprouts' && df.added[0].weekdays.join() === '0', df.added);
    ck('a removed item is listed', df.removed.length === 1 && df.removed[0].name === 'Almonds' && df.removed[0].weekdays.length === 7);
    ck('a changed target is listed', df.targets.length === 1 && df.targets[0].key === 'kcal' && df.targets[0].to === 1800);
    ck('identical plans diff as same', DP.diffPlans(d, JSON.parse(JSON.stringify(d))).same === true);
  }

  // ── Database ────────────────────────────────────────────────────────────────
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (name, phone, role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`,
    [name, phone, role])).rows[0].id;
  const coach   = await mk('Sachin', '6001', 'monitor');
  const coach2  = await mk('Other Coach', '6002', 'monitor');
  const member  = await mk('Ravi Kumar', '6003', 'patient');
  const member2 = await mk('Someone Else', '6004', 'patient');
  await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true), ($3,$4,true)`, [coach, member, coach2, member2]);
  const today = getISTDate();
  await pool.query(`INSERT INTO patient_profiles (user_id, height_cm, start_weight, conditions) VALUES ($1, 180, 103, '["fatty_liver"]')`, [member]);
  await pool.query(
    `INSERT INTO lab_values (patient_id, test_date, test_name, value, unit, status) VALUES
       ($1, $2::date - 20, 'LDL', 185, 'mg/dL', 'high'),
       ($1, $2::date - 20, 'HbA1c', 5.4, '%', 'normal'),
       ($1, $2::date - 300, 'Vitamin D', 7.2, 'ng/mL', 'low'),
       ($3, $2::date - 5, 'Uric acid', 9.9, 'mg/dL', 'high')`, [member, today, member2]);

  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const C = tok(coach, 'monitor'), C2 = tok(coach2, 'monitor'), M = tok(member, 'patient');
  const srv = app.listen(0); const port = srv.address().port;
  const call = async (method, p, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, {
      method, headers: { 'content-type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const mealRows = async (who = member) => (await pool.query(
    `SELECT plan_date::text AS d, meal, items FROM meal_plans WHERE patient_id=$1 ORDER BY plan_date, created_at`, [who])).rows;
  const plans = async () => (await pool.query(
    `SELECT id, version, status, source, effective_from::text AS ef FROM diet_plans WHERE patient_id=$1 ORDER BY version`, [member])).rows;
  const BRIEF = 'Low carb, 3 meals, intermittent fasting 16:8. Paneer and curd in every meal.';

  console.log('\n[1] drafting');
  let draftId;
  {
    const r = await call('POST', '/api/diet-plans/draft', C, { member_id: member, brief: BRIEF });
    ck('a coach can draft for their member', r.status === 200 && r.data.plan?.status === 'draft', r.data);
    const p = r.data.plan; draftId = p.id;
    ck('the draft is version 1 with seven days of meals', p.version === 1 && p.days.length === 7 && p.days.every(d => d.length === 3));
    ck('the brief and the stored lab result were given to the model', lastPrompt.includes('Paneer and curd in every meal') && lastPrompt.includes('LDL is high: 185'));
    ck("another member's lab result was not", !lastPrompt.includes('Uric acid'));
    ck('flags come from stored data: LDL, old Vitamin D, the condition', p.flags.length === 3 && p.flags.some(f => f.test === 'LDL') && p.flags.some(f => f.stale) && p.flags.some(f => f.kind === 'condition'), p.flags);
    ck('a flag the model invented is not on the plan', !JSON.stringify(p.flags).includes('Potassium'));
    ck("the model's notes are kept apart, as adjustments", p.content.adjustments.length === 1 && p.content.adjustments[0].for === 'LDL');
    ck('the checks ran and found the macro mismatch', p.checks.some(c => c.code === 'macro_mismatch'), p.checks);
    ck('every item has a stable id', p.days.every(d => d.every(m => m.items.every(i => Number.isInteger(i.id)))));
    ck('the app asked the model once more, for just the food with no figure', fillCalls === 1 && lastFillPrompt.includes('Mystery soup') && !lastFillPrompt.includes('Almonds'), [fillCalls]);
    ck('the lookup found nothing, so the draft carries a must-fix error', p.checks.some(c => c.code === 'no_nutrition' && c.level === 'error'), p.checks);

    const me = await call('GET', '/api/diet-plans/me', M);
    ck('the member sees NO plan while it is a draft', me.status === 200 && me.data.plan === null, me.data);
    ck('a draft writes no meals for the member', (await mealRows()).length === 0);
    const mp = await call('GET', '/api/members/me/meal-plan', M);
    ck("the member's food log has no prescribed meals from a draft", mp.status === 200 && mp.data.meals.length === 0, mp.data);

    ck('a member cannot draft', (await call('POST', '/api/diet-plans/draft', M, { member_id: member, brief: BRIEF })).status === 403);
    ck('another coach cannot draft for this member', (await call('POST', '/api/diet-plans/draft', C2, { member_id: member, brief: BRIEF })).status === 403);
    ck("another coach cannot read this member's plans", (await call('GET', `/api/diet-plans/member/${member}`, C2)).status === 403);
    ck('another coach cannot open the draft by id', (await call('GET', `/api/diet-plans/${draftId}`, C2)).status === 403);
    ck('an empty brief is refused', (await call('POST', '/api/diet-plans/draft', C, { member_id: member, brief: 'hi' })).status === 400);
    ck('signed out is refused', (await call('GET', `/api/diet-plans/member/${member}`, null)).status === 401);

    aiMode = 'garbage';
    const g = await call('POST', '/api/diet-plans/draft', C, { member_id: member, brief: BRIEF });
    ck('an unreadable AI answer is a clear error', g.status === 502 && /Nothing was changed/.test(g.data.error), g.data);
    aiMode = 'down';
    const dn = await call('POST', '/api/diet-plans/draft', C, { member_id: member, brief: BRIEF });
    ck('an AI outage is a clear error', dn.status === 502, dn.data);
    aiMode = 'ok';
    const still = await plans();
    ck('and the existing draft is untouched by either failure', still.length === 1 && still[0].id === draftId, still);

    const again = await call('POST', '/api/diet-plans/draft', C, { member_id: member, brief: BRIEF + ' Add sprouts.' });
    const after = await plans();
    ck('drafting again replaces the draft: still one, still version 1', after.length === 1 && after[0].version === 1 && after[0].id !== draftId, after);
    draftId = again.data.plan.id;
    const tokens = lastDraftBody.max_tokens || lastDraftBody.generationConfig?.maxOutputTokens;
    ck('a plan draft asks for a large reply (8000 tokens, not the usual 3000)', tokens === 8000, tokens);

    // A reply cut off at the limit is half a JSON object. It must be retried,
    // not parsed — and certainly not reported as "could not be read".
    aiMode = 'truncate-once';
    const callsBefore = draftCalls;
    const t = await call('POST', '/api/diet-plans/draft', C, { member_id: member, brief: BRIEF });
    ck('a reply cut off at the limit is retried on the next model, and the draft succeeds', t.status === 200 && draftCalls === callsBefore + 2 && t.data.plan?.days?.length === 7, [t.status, draftCalls - callsBefore, t.data.error]);
    draftId = t.data.plan.id;

    // "Tell the AI what to change": the current draft goes to the model in
    // the meals + rotation shape it must answer in, never as seven days.
    const ch = await call('POST', '/api/diet-plans/draft', C, { member_id: member, instruction: 'swap tofu for sprouts in Meal 2' });
    ck('a change request redrafts', ch.status === 200 && ch.data.plan?.status === 'draft', ch.data);
    const m = /CURRENT DRAFT[^\n]*\n(\{.*\})\n/.exec(lastDraftText);
    let shown = null; try { shown = JSON.parse(m[1]); } catch (_) { /* stays null */ }
    ck('the model is shown the draft as meals + rotation, not seven days', !!shown && Array.isArray(shown.meals) && !('days' in shown)
       && shown.meals[0].rotation?.mon?.name === DISH[0] && shown.meals[0].items.some(i => i.name === 'Curd'), shown && Object.keys(shown));
    ck("the model's own notes are not fed back to it", !!shown && !('adjustments' in shown));
    ck('the change request reached the model', lastDraftText.includes('swap tofu for sprouts in Meal 2'));
    draftId = ch.data.plan.id;

    // And if it answers in seven explicit days anyway, that is still a plan.
    aiMode = 'days-shape';
    const ds = await call('POST', '/api/diet-plans/draft', C, { member_id: member, instruction: 'keep everything' });
    ck('a seven-day answer is read as a plan, not "could not be read"', ds.status === 200 && ds.data.plan?.title === 'Seven-day answer' && ds.data.plan.days[0][0].items[0].name === DISH[0], [ds.status, ds.data.error]);
    // Back to the standard draft for the sections that follow.
    const std = await call('POST', '/api/diet-plans/draft', C, { member_id: member, brief: BRIEF });
    draftId = std.data.plan.id;
  }

  console.log('\n[2] editing a draft');
  {
    const blocked = await call('POST', `/api/diet-plans/${draftId}/approve`, C, { acknowledge_warnings: true });
    ck('a food with no calorie figure cannot be ticked through: approve is refused', blocked.status === 422 && !blocked.data.needs_ack && /No calorie figure/.test(blocked.data.error), blocked.data);
    ck('and nothing reached the member', (await call('GET', '/api/diet-plans/me', M)).data.plan === null && (await mealRows()).length === 0);
    nextFill = { foods: [{ name: 'Mystery soup', kcal_100g: 35, protein_100g: 1.5, carbs_100g: 5, fat_100g: 1 }] };
    const f = await call('PATCH', `/api/diet-plans/${draftId}`, C, { fill_nutrition: true });
    ck('"Look up missing calories" fills the food on every weekday', f.status === 200 && f.data.plan.days.every(d => d[2].items.find(i => i.name === 'Mystery soup').per_100g.calories === 35), f.data.plan?.days?.[0]?.[2]);
    ck('and the error is gone', !f.data.plan.checks.some(c => c.code === 'no_nutrition'), f.data.plan.checks);
    ck('foods that already had a figure are untouched', f.data.plan.days[0][2].items.find(i => i.name === 'Almonds').per_100g.calories === 579);

    let r = await call('PATCH', `/api/diet-plans/${draftId}`, C, { edits: [{ meal: 'Meal 1', name: 'Curd', grams: 200 }] });
    ck('changing grams applies to every weekday', r.status === 200 && r.data.plan.days.every(d => d[0].items.find(i => i.name === 'Curd').grams === 200), r.data);
    r = await call('PATCH', `/api/diet-plans/${draftId}`, C, { edits: [{ meal: 'Meal 3', name: 'Mystery soup', remove: true }] });
    ck('removing an item removes it everywhere', r.data.plan.days.every(d => !d[2].items.some(i => i.name === 'Mystery soup')));
    ck('and the "no calorie figure" warning goes with it', !r.data.plan.checks.some(c => c.code === 'no_nutrition'), r.data.plan.checks);
    r = await call('PATCH', `/api/diet-plans/${draftId}`, C, { edits: [{ meal: 'Meal 2', weekday: 0, add: { name: 'Sprouts', grams: 60, per_100g: { calories: 30 } } }] });
    ck('adding an item to one weekday touches only that day', r.data.plan.days[0][1].items.some(i => i.name === 'Sprouts') && !r.data.plan.days[1][1].items.some(i => i.name === 'Sprouts'));
    r = await call('PATCH', `/api/diet-plans/${draftId}`, C, { edits: [{ meal: 'Meal 1', name: 'Curd', grams: 99999 }] });
    ck('absurd grams are ignored, not stored', r.data.plan.days[0][0].items.find(i => i.name === 'Curd').grams === 200);
    r = await call('PATCH', `/api/diet-plans/${draftId}`, C, { targets: { kcal: 1710, protein: 120, carbs: 105, fat: 90 } });
    ck('fixing the targets clears the macro warning', !r.data.plan.checks.some(c => c.code === 'macro_mismatch'), r.data.plan.checks);
    r = await call('PATCH', `/api/diet-plans/${draftId}`, C, { content: { avoid: ['sugar', 'tofu'] } });
    ck('adding a meal item to the avoid list raises the conflict', r.data.plan.checks.some(c => c.code === 'avoid_conflict'));
    ck("editing the lists keeps the model's adjustment notes", r.data.plan.content.adjustments.length === 1);
    await call('PATCH', `/api/diet-plans/${draftId}`, C, { content: { avoid: ['sugar', 'ghee'] } });
    ck('another coach cannot edit it', (await call('PATCH', `/api/diet-plans/${draftId}`, C2, { title: 'x' })).status === 403);
    ck('still nothing for the member', (await call('GET', '/api/diet-plans/me', M)).data.plan === null && (await mealRows()).length === 0);
  }

  console.log('\n[3] approving');
  {
    let r = await call('POST', `/api/diet-plans/${draftId}/approve`, C, {});
    ck('warnings stop a plain approve and ask for a yes', r.status === 422 && r.data.needs_ack === true && r.data.checks.length > 0, r.data);
    ck('and the plan is still a draft', (await plans())[0].status === 'draft');
    ck('another coach cannot approve it', (await call('POST', `/api/diet-plans/${draftId}/approve`, C2, { acknowledge_warnings: true })).status === 403);
    ck('the member cannot approve it', (await call('POST', `/api/diet-plans/${draftId}/approve`, M, { acknowledge_warnings: true })).status === 403);

    r = await call('POST', `/api/diet-plans/${draftId}/approve`, C, { acknowledge_warnings: true });
    ck('approving with the yes succeeds', r.status === 200 && r.data.plan.status === 'approved' && r.data.plan.effective_from === today, r.data);

    const rows = await mealRows();
    const dates = [...new Set(rows.map(x => x.d))];
    ck(`meals are written for ${DP.FILL_AHEAD_DAYS} days from today`, dates.length === DP.FILL_AHEAD_DAYS && dates[0] === today && dates[dates.length - 1] === DP.addDays(today, DP.FILL_AHEAD_DAYS - 1), [dates.length, dates[0]]);
    ck('each date carries the dish for ITS weekday',
       dates.every(d => rows.find(x => x.d === d && x.meal === 'Meal 1').items[0].name === DISH[DP.weekdayOf(d)]));
    ck('meals come back in plan order', dates.every(d => rows.filter(x => x.d === d).map(x => x.meal).join() === 'Meal 1,Meal 2,Meal 3'));
    ck('each prescribed item carries its plan item id and version', rows.every(x => x.items.every(i => Number.isInteger(i.plan_item_id) && i.plan_version === 1 && i.plan_id === draftId)));
    const { rows: [prof] } = await pool.query(`SELECT macro_kcal, macro_pro, macro_carb, macro_fat FROM patient_profiles WHERE user_id=$1`, [member]);
    ck("the member's targets now come from the plan", prof.macro_kcal === 1710 && prof.macro_pro === 120 && prof.macro_carb === 105 && prof.macro_fat === 90, prof);

    const me = await call('GET', '/api/diet-plans/me', M);
    ck('the member now sees the plan', me.data.plan?.version === 1 && me.data.plan.days.length === 7);
    ck("without the coach's brief, flags, checks or model notes",
       !('brief' in me.data.plan) && !('flags' in me.data.plan) && !('checks' in me.data.plan) && !('adjustments' in me.data.plan.content), Object.keys(me.data.plan));
    const mp = await call('GET', '/api/members/me/meal-plan', M);
    ck("and today's meals in the food log", mp.data.meals.length === 3);
    // The audit row is written AFTER the approval returns (so a slow audit can
    // never fail an approval). Wait for it, up to 5 s: a fixed 100 ms wait
    // passed on one run and failed on a re-run of the same code.
    let aud = [];
    for (let i = 0; i < 50 && !aud.length; i++) {
      ({ rows: aud } = await pool.query(`SELECT 1 FROM audit_log WHERE action='diet_plan_approved' AND target_id=$1`, [member]));
      if (!aud.length) await new Promise(r2 => setTimeout(r2, 100));
    }
    ck('the approval is in the audit log', aud.length === 1, aud.length);

    ck('approving again is refused', (await call('POST', `/api/diet-plans/${draftId}/approve`, C, { acknowledge_warnings: true })).status === 409);
    ck('an approved plan cannot be edited', (await call('PATCH', `/api/diet-plans/${draftId}`, C, { edits: [{ meal: 'Meal 1', name: 'Curd', grams: 10 }] })).status === 409);
    ck('or discarded', (await call('POST', `/api/diet-plans/${draftId}/discard`, C)).status === 409);
    const p = await DP.loadPlan(pool, draftId);
    ck('and it really is unchanged', p.days[0][0].items.find(i => i.name === 'Curd').grams === 200);
  }

  console.log('\n[4] a plan with an error cannot be approved at all');
  {
    nextDraft = DRAFT(); nextDraft.meals = [{ meal: 'Meal 1', time: '12:00', items: [], rotation: { mon: it100(DISH[0], 100, 280, 18, 4, 21) } }];
    const r = await call('POST', '/api/diet-plans/draft', C, { member_id: member, brief: BRIEF });
    nextDraft = null;
    ck('the draft saves and shows the error', r.status === 200 && r.data.plan.checks.some(c => c.level === 'error'), r.data.plan?.checks);
    const a = await call('POST', `/api/diet-plans/${r.data.plan.id}/approve`, C, { acknowledge_warnings: true });
    ck('approve is refused even with the yes', a.status === 422 && !a.data.needs_ack, a.data);
    ck('the plan in force is still version 1', (await call('GET', '/api/diet-plans/me', M)).data.plan.version === 1);
    ck('a draft can be discarded', (await call('POST', `/api/diet-plans/${r.data.plan.id}/discard`, C)).status === 200 && (await plans()).length === 1);
  }

  console.log('\n[5] revising keeps the plan in force');
  let v2;
  {
    const r = await call('POST', `/api/diet-plans/member/${member}/revise`, C);
    ck('revise makes a draft copy as version 2', r.status === 200 && r.data.plan.version === 2 && r.data.plan.status === 'draft' && r.data.plan.source === 'revision', r.data);
    v2 = r.data.plan.id;
    ck('with no differences yet', r.data.plan.diff?.same === true && r.data.plan.compared_to_version === 1, r.data.plan.diff);
    const e = await call('PATCH', `/api/diet-plans/${v2}`, C, { edits: [{ meal: 'Meal 1', name: 'Curd', grams: 120 }], targets: { kcal: 1600, protein: 120, carbs: 100, fat: 80 } });
    ck('the edit shows as one difference line plus the targets', e.data.plan.diff.changed.length === 1 && e.data.plan.diff.changed[0].from === 200 && e.data.plan.diff.changed[0].to === 120 && e.data.plan.diff.targets.some(t => t.key === 'kcal'), e.data.plan.diff);
    ck('the member still sees version 1', (await call('GET', '/api/diet-plans/me', M)).data.plan.version === 1);
    ck("and today's meals are still version 1's", (await mealRows()).filter(x => x.d === today).every(x => x.items.every(i => i.plan_version === 1)));
    const s = await call('GET', `/api/diet-plans/member/${member}`, C);
    ck('the coach sees the plan in force, the draft and the history', s.data.in_force.version === 1 && s.data.draft.version === 2 && s.data.history.length === 1 && s.data.history[0].in_force === true, s.data.history);
  }

  console.log('\n[6] two approvals at once');
  {
    const start = DP.addDays(today, 3);
    const [a, b] = await Promise.all([
      call('POST', `/api/diet-plans/${v2}/approve`, C, { acknowledge_warnings: true, effective_from: start }),
      call('POST', `/api/diet-plans/${v2}/approve`, C, { acknowledge_warnings: true, effective_from: start }),
    ]);
    ck('exactly one wins, the other is told it is gone', [a.status, b.status].sort().join() === '200,409', [a.status, b.status, a.data.error, b.data.error]);
    const all = await plans();
    ck('there is one version 2, approved, starting in three days', all.length === 2 && all[1].status === 'approved' && all[1].ef === start, all);

    console.log('\n[7] a future start date');
    ck('today the member is still on version 1', (await call('GET', '/api/diet-plans/me', M)).data.plan.version === 1);
    const rows = await mealRows();
    ck('days before the start keep version 1 meals', rows.filter(x => x.d < start).every(x => x.items.every(i => i.plan_version === 1)));
    ck('days from the start carry version 2 meals', rows.filter(x => x.d >= start).length > 0 && rows.filter(x => x.d >= start).every(x => x.items.every(i => i.plan_version === 2)));
    const { rows: [prof] } = await pool.query(`SELECT macro_kcal FROM patient_profiles WHERE user_id=$1`, [member]);
    ck('the targets have NOT changed early', prof.macro_kcal === 1710, prof);
    const s = await call('GET', `/api/diet-plans/member/${member}`, C);
    ck('the coach sees version 2 as upcoming', s.data.upcoming?.version === 2 && s.data.in_force.version === 1, s.data.upcoming);
    // The start date arrives: the first read on that day moves the targets.
    await DP.ensureDay(pool, member, start, start);
    const { rows: [prof2] } = await pool.query(`SELECT macro_kcal FROM patient_profiles WHERE user_id=$1`, [member]);
    ck('on the start date the targets move to version 2', prof2.macro_kcal === 1600, prof2);
    ck('and version 2 is the plan in force that day', (await DP.planInForce(pool, member, start)).version === 2);
  }

  console.log('\n[7b] a start date in the past');
  {
    const r = await call('POST', `/api/diet-plans/member/${member2}/revise`, C2);
    ck('revise with no approved plan is a clear 404', r.status === 404, r.data);
    // Two rows in the food table: a RAW grain whose everyday name is what a
    // plan would say, and a food whose table value is close to the model's.
    await pool.query(`DELETE FROM foods WHERE name IN ('Zzgrain, Raw (Brown)', 'Zzcurd')`);
    await pool.query(
      `INSERT INTO foods (name, name_local, category, source, verified, per_100g) VALUES
         ('Zzgrain, Raw (Brown)', 'Zzbrown Rice', 'grain', 'nin', true, '{"calories":362,"protein":7.5,"total_carbs":76,"fat":2.2}'),
         ('Zzcurd', 'Zzcurd', 'dairy', 'nin', true, '{"calories":62,"protein":3.4,"total_carbs":4.6,"fat":3.1}')`);
    nextDraft = DRAFT();
    nextDraft.meals[1].items.push(it100('Zzbrown Rice', 120, 125, 2.7, 26, 1), it100('Zzcurd', 100, 60, 3.5, 4.5, 3));
    const fillsBefore = fillCalls;
    const d = await call('POST', '/api/diet-plans/draft', C2, { member_id: member2, brief: BRIEF });
    nextDraft = null;
    const m2 = d.data.plan.days[0][1].items;
    ck('cooked rice keeps its as-eaten figure, not the raw-grain row (125, not 362)', m2.find(i => i.name === 'Zzbrown Rice').per_100g.calories === 125, m2.find(i => i.name === 'Zzbrown Rice'));
    ck("a food the table agrees with takes the table's measured figure (62)", m2.find(i => i.name === 'Zzcurd').per_100g.calories === 62, m2.find(i => i.name === 'Zzcurd'));
    ck('the missing food was looked up while drafting, so there is no error', fillCalls === fillsBefore + 1 && !d.data.plan.checks.some(c => c.level === 'error'), d.data.plan.checks);
    await pool.query(`DELETE FROM foods WHERE name IN ('Zzgrain, Raw (Brown)', 'Zzcurd')`);
    const a = await call('POST', `/api/diet-plans/${d.data.plan.id}/approve`, C2, { acknowledge_warnings: true, effective_from: DP.addDays(today, -10) });
    ck('a past start date becomes today, never back-dating meals', a.status === 200 && a.data.plan.effective_from === today, a.data.plan?.effective_from);
    ck('no meals are written for past days', (await mealRows(member2)).every(x => x.d >= today));
    ck("this member's draft carried THEIR lab flag, not the other member's", d.data.plan.flags.some(f => f.test === 'Uric acid') && !d.data.plan.flags.some(f => f.test === 'LDL'), d.data.plan.flags);
  }

  console.log('\n[8] the plan does not run out');
  {
    const far = DP.addDays(today, 75);
    ck('nothing is stored 75 days out', (await mealRows()).filter(x => x.d === far).length === 0);
    const r = await call('GET', `/api/members/me/meal-plan?date=${far}`, M);
    ck('opening that day generates its meals from the plan in force', r.status === 200 && r.data.meals.length === 3 && r.data.meals[0].items.every(i => i.plan_version === 2), r.data);
    ck('with the right dish for that weekday', r.data.meals[0].meal === 'Meal 1' && r.data.meals[0].items[0].name === DISH[DP.weekdayOf(far)]);
    await call('GET', `/api/members/me/meal-plan?date=${far}`, M);
    ck('opening it twice does not duplicate', (await mealRows()).filter(x => x.d === far).length === 3);

    // The coach changed one day by hand. Generation must leave it alone.
    await pool.query(`DELETE FROM meal_plans WHERE patient_id=$1 AND plan_date=$2`, [member, far]);
    await pool.query(`INSERT INTO meal_plans (patient_id, monitor_id, plan_date, meal, items) VALUES ($1,$2,$3,'Lunch','[{"name":"Khichdi","grams":250}]')`, [member, coach, far]);
    const again = await call('GET', `/api/members/me/meal-plan?date=${far}`, M);
    ck('a day the coach set by hand is left exactly as it is', again.data.meals.length === 1 && again.data.meals[0].items[0].name === 'Khichdi', again.data);
    const member3 = await mk('No Plan', '6005', 'patient');
    const np = await call('GET', '/api/members/me/meal-plan', tok(member3, 'patient'));
    ck('a member with no plan gets no meals and no error', np.status === 200 && np.data.meals.length === 0, np.data);
  }

  console.log('\n[9] a typed one-day change lands on top of the plan');
  {
    await pool.query(`DELETE FROM meal_plans WHERE patient_id=$1 AND plan_date=$2`, [member, today]);
    const ops = { water_target: null, macros: null, target_weight: null, program: null, activities: null, acv: null, supplements: null, note: null, push: null,
      meal_plan: ai.normaliseMealPlan({ meals: [{ meal: 'Meal 1', mode: 'append', items: [{ name: 'Whey', grams: 30, per_100g: { calories: 400, protein: 80 } }] }] }) };
    const r = await call('POST', '/api/ai-chat/coach-apply', C, { actions: [{ member_id: member, member_name: 'Ravi Kumar', resolved: true, is_all: false, ops }] });
    ck('apply succeeds', r.status === 200, r.data);
    const rows = (await mealRows()).filter(x => x.d === today);
    const m1 = rows.find(x => x.meal === 'Meal 1');
    ck('"add whey to Meal 1" keeps the plan items and adds whey', !!m1 && m1.items.some(i => i.name === 'Whey') && m1.items.some(i => i.name === 'Curd'), m1?.items.map(i => i.name));
    ck("and today's other meals are still there", rows.length === 3, rows.map(x => x.meal));
    ck('it is a one-day change: no new plan version', (await plans()).length === 2);
    ck("tomorrow's Meal 1 has no whey", !(await mealRows()).find(x => x.d === DP.addDays(today, 1) && x.meal === 'Meal 1').items.some(i => i.name === 'Whey'));
  }

  const item = (name, grams) => ({ name, grams, qty_text: `${grams} g`, per_100g: { calories: 100, protein: 10, total_carbs: 5, fat: 3 } });

  console.log('\n[10] a plan imported from a document becomes a version');
  {
    const ops = { water_target: null, macros: { kcal: 1400, pro: 120, carb: 60, fat: null }, target_weight: null, program: null,
      activities: null, acv: null, supplements: null, push: null,
      note: { text: 'Diet plan attached: Dietitian plan (plan.pdf)', flagged: false },
      meal_plan: ai.normaliseMealPlan({ repeat_days: 14, meals: [
        { meal: 'Breakfast', mode: 'replace', items: [item('Avocado', 75), item('Paneer', 50)] },
        { meal: 'Dinner', mode: 'replace', items: [item('Dal', 150)] } ] }) };
    const r = await call('POST', '/api/ai-chat/coach-apply', C, { actions: [{ member_id: member, member_name: 'Ravi Kumar', resolved: true, is_all: false, ops }] });
    ck('apply succeeds', r.status === 200, r.data);
    const all = await plans();
    const v3 = all[all.length - 1];
    ck('it is recorded as an approved version from an import', all.length === 3 && v3.version === 3 && v3.status === 'approved' && v3.source === 'import' && v3.ef === today, all);
    const me = await call('GET', '/api/diet-plans/me', M);
    ck('it is the plan in force, with its title and targets', me.data.plan.version === 3 && me.data.plan.title === 'Dietitian plan' && me.data.plan.targets.kcal === 1400 && me.data.plan.targets.protein === 120, me.data.plan);
    const rows = await mealRows();
    const inWindow = rows.filter(x => x.d >= today && x.d <= DP.addDays(today, 13));
    ck("the old plan's meals are gone from the imported days", inWindow.every(x => x.meal === 'Breakfast' || x.meal === 'Dinner'), [...new Set(inWindow.map(x => x.meal))]);
    const later = rows.filter(x => x.d > DP.addDays(today, 13));
    ck('no meals generated from an older version are left after the imported days', later.every(x => x.items.every(i => i.plan_id == null)), later.length);
    ck('the one day the coach set by hand is still there', later.length === 1 && later[0].items[0].name === 'Khichdi', later.map(x => x.d));
    const d20 = await call('GET', `/api/members/me/meal-plan?date=${DP.addDays(today, 20)}`, M);
    ck('day 20 fills from the imported plan, so it does not run out after 14 days', d20.data.meals.map(m => m.meal).join() === 'Breakfast,Dinner', d20.data.meals.map(m => m.meal));
    const sum = (await call('GET', `/api/diet-plans/member/${member}`, C)).data;
    ck('the version scheduled earlier is overruled by this later approval, so nothing is upcoming', sum.upcoming === null && sum.in_force.version === 3, sum.upcoming);
    ck('and stays overruled on the date it was due to start', (await DP.planInForce(pool, member, DP.addDays(today, 10))).version === 3);
    ck('all three versions are in the history, newest first', sum.history.map(h => h.version).join() === '3,2,1' && sum.history[0].in_force === true, sum.history.map(h => h.version));
  }

  console.log('\n[11] a multi-day change to ONE meal is not a new plan');
  {
    const ops = { water_target: null, macros: null, target_weight: null, program: null, activities: null, acv: null, supplements: null, push: null, note: null,
      meal_plan: ai.normaliseMealPlan({ repeat_days: 3, meals: [{ meal: 'Dinner', mode: 'replace', items: [item('Khichdi', 250)] }] }) };
    const r = await call('POST', '/api/ai-chat/coach-apply', C, { actions: [{ member_id: member, member_name: 'Ravi Kumar', resolved: true, is_all: false, ops }] });
    ck('apply succeeds', r.status === 200, r.data);
    const me = (await call('GET', '/api/diet-plans/me', M)).data.plan;
    ck('it is version 4', me.version === 4);
    ck('breakfast survives: the version is the plan in force with dinner swapped', me.days.every(d => d.map(m => m.meal).join() === 'Breakfast,Dinner' && d[1].items[0].name === 'Khichdi' && d[0].items[0].name === 'Avocado'), me.days[0]);
    ck('title and targets carry over from the plan it changed', me.title === 'Dietitian plan' && me.targets.kcal === 1400, [me.title, me.targets]);
    const rows = (await mealRows()).filter(x => x.d === today);
    ck('today still has breakfast', rows.some(x => x.meal === 'Breakfast') && rows.find(x => x.meal === 'Dinner').items[0].name === 'Khichdi', rows.map(x => x.meal));

    // Rows written before plans were versioned carry no plan_id. They must
    // never be cleared by a later multi-day change.
    const member4 = await mk('Legacy Member', '6006', 'patient');
    await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true)`, [coach, member4]);
    for (let d = 0; d < 10; d++) {
      await pool.query(`INSERT INTO meal_plans (patient_id, monitor_id, plan_date, meal, items) VALUES ($1,$2,$3,'Breakfast','[{"name":"Idli","grams":120}]')`, [member4, coach, DP.addDays(today, d)]);
    }
    await call('POST', '/api/ai-chat/coach-apply', C, { actions: [{ member_id: member4, member_name: 'Legacy Member', resolved: true, is_all: false, ops }] });
    const legacy = (await mealRows(member4)).filter(x => x.meal === 'Breakfast');
    ck("a member's pre-versioning meals are all still there", legacy.length === 10, legacy.length);
  }

  console.log(`\n${fail === 0 ? '\u2713' : '\u2717'} test-diet-studio: ${pass} passed, ${fail} failed\n`);
  srv.close(); await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
