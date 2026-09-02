/**
 * scripts/test-diet-plan.js — a diet plan uploaded as a PDF becomes a
 * prescribed meal plan (coach chat attach → preview → apply).
 *
 * The document path deliberately reuses /coach-apply rather than writing its
 * own save. What it DOES add is a plan that spans days: a dietitian's sheet
 * says "same every day", so prescribing it onto today alone would be useless
 * by tomorrow morning.
 *
 * Three things have to hold, and each has a way of failing quietly:
 *
 *   1. `repeat_days` DEFAULTS TO 1. Every existing caller — "add whey to
 *      lunch" typed into the coach chat — must keep touching today and nothing
 *      else. A default of 14 there would silently overwrite a fortnight of a
 *      member's plans from a one-line instruction.
 *   2. A multi-day plan writes one row per meal PER DATE, and re-uploading
 *      replaces rather than duplicating.
 *   3. The coach still approves it. Nothing parsed out of a PDF may reach a
 *      member without passing through the same preview and the same Apply.
 *      The plan we built this against carries diabetic-range HbA1c and an
 *      instruction to consult a doctor.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'stub-key';

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const path = require('path');

// AI transport stubbed, everything else real. The route's own work — resolving
// which member the plan is for, mapping the document's words onto op keys,
// enriching items from the food table — runs for real, which is where the bugs
// have actually been.
const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
const PLAN_JSON = {
  member_name: 'T V Sharada',
  plan_title: 'Low-carb plan',
  macros: { kcal: 1400, protein: 120, carbs: 60, fat: 50 },
  meals: [
    { meal: 'Breakfast', items: [ { name: 'Avocado', grams: 75, qty_text: '1/2 avocado' },
                                  { name: 'Paneer',  grams: 50, qty_text: '50g' } ] },
    { meal: 'Lunch',     items: [ { name: 'Egg',   grams: 100, qty_text: '2 eggs' },
                                  { name: 'Roti',  grams: 40,  qty_text: '1 small roti' } ] },
    { meal: 'Dinner',    items: [ { name: 'Paneer', grams: 50, qty_text: '50g' } ] },
  ],
  repeat_days: 14,
  summary: 'Low-carb plan for T V Sharada — carbs at lunch only.',
};
const stubbedPost = async (url, body, cfg) => {
  if (String(url).includes('generativelanguage') || String(url).includes('groq')) {
    return { data: { candidates: [{ content: { parts: [{ text: JSON.stringify(PLAN_JSON) }] } }] } };
  }
  return realAxios.post(url, body, cfg);
};
require.cache[axiosPath].exports = new Proxy(realAxios, {
  get: (t, k) => (k === 'post' ? stubbedPost : t[k]),
});

const pool = require('../db/pool');
const ai   = require('../routes/aiChat');

const app = express(); app.use(express.json({ limit: '15mb' })); app.use(cookieParser());
app.use('/api/ai-chat', require('../routes/aiChat'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 200))); };

const item = (name, grams) => ({ name, grams, qty_text: `${grams} g`,
  per_100g: { calories: 100, protein: 10, total_carbs: 5, fat: 3 } });

(async () => {
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (name, phone, role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`,
    [name, phone, role])).rows[0].id;
  const coach  = await mk('Sachin', '5001', 'monitor');
  const member = await mk('T V Sharada', '5002', 'patient');
  await pool.query(
    `INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true)`,
    [coach, member]);

  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const srv = app.listen(0); const port = srv.address().port;
  const call = async (method, path, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const planRows = async () => (await pool.query(
    `SELECT plan_date::text AS d, meal, items FROM meal_plans
      WHERE patient_id=$1 ORDER BY plan_date, meal`, [member])).rows;

  // ── 1. repeat_days defaults, and is bounded ────────────────────────────────
  console.log('\n[1] how long a plan holds');
  {
    const one = ai.normaliseMealPlan({ meals: [{ meal: 'Lunch', items: [item('Roti', 40)] }] });
    ck('a plan with no span given covers today only — every typed instruction',
      one.repeat_days === 1, one.repeat_days);

    const two = ai.normaliseMealPlan({
      meals: [{ meal: 'Lunch', items: [item('Roti', 40)] }], repeat_days: 14 });
    ck('an uploaded plan can span days', two.repeat_days === 14, two.repeat_days);

    ck('a nonsense span falls back to today, not to zero days',
      ai.normaliseMealPlan({ meals: [{ meal: 'Lunch', items: [item('Roti', 40)] }],
        repeat_days: 'lots' }).repeat_days === 1);
    ck('the span is capped — a plan cannot claim a year',
      ai.normaliseMealPlan({ meals: [{ meal: 'Lunch', items: [item('Roti', 40)] }],
        repeat_days: 999 }).repeat_days === 30);
    ck('a negative span cannot erase the plan',
      ai.normaliseMealPlan({ meals: [{ meal: 'Lunch', items: [item('Roti', 40)] }],
        repeat_days: -5 }).repeat_days === 1);
  }

  // ── 1b. Targets read off the page ─────────────────────────────────────────
  console.log('\n[1b] targets from the document');
  {
    // A dietitian's sheet says "protein" and "carbohydrates"; the ops say pro
    // and carb. Getting this wrong parses the plan correctly and then silently
    // discards half the targets.
    const m = ai.dietPlanMacros({ kcal: 1400, protein: 120, carbs: 60, fat: 50 });
    ck('a document\'s "protein" reaches the pro target', m.pro === 120, m);
    ck('a document\'s "carbs" reaches the carb target', m.carb === 60, m);
    ck('"carbohydrates" spelled out also lands',
      ai.dietPlanMacros({ carbohydrates: 70 }).carb === 70);
    ck('the op spelling still works', ai.dietPlanMacros({ pro: 90, carb: 40 }).pro === 90);
    ck('calories under either name', ai.dietPlanMacros({ calories: 1500 }).kcal === 1500);

    ck('a range the model already reduced is taken as given', m.kcal === 1400);
    ck('an implausible target is dropped, not clamped',
      ai.dietPlanMacros({ kcal: 99999 }) === null);
    ck('an empty macro block is null, not a row of zeroes',
      ai.dietPlanMacros({}) === null && ai.dietPlanMacros(null) === null);
  }

  // ── 2. Applying it ─────────────────────────────────────────────────────────
  console.log('\n[2] applying a multi-day plan');
  {
    await pool.query('DELETE FROM meal_plans');
    const ops = {
      water_target: null, macros: { kcal: 1400, pro: 120, carb: 60, fat: null },
      target_weight: null, program: null, activities: null, acv: null,
      supplements: null, note: null, push: null,
      meal_plan: ai.normaliseMealPlan({
        repeat_days: 3,
        meals: [
          { meal: 'Breakfast', mode: 'replace', items: [item('Avocado', 75), item('Paneer', 50)] },
          { meal: 'Lunch',     mode: 'replace', items: [item('Egg', 100), item('Roti', 40)] },
        ],
      }),
    };
    const r = await call('POST', '/api/ai-chat/coach-apply', tok(coach, 'monitor'), {
      actions: [{ member_id: member, member_name: 'T V Sharada', resolved: true, is_all: false, ops }],
    });
    ck('apply succeeds', r.status === 200, r.data);

    const rows = await planRows();
    ck('2 meals × 3 days = 6 rows', rows.length === 6, rows.length);
    ck('three distinct dates', new Set(rows.map(x => x.d)).size === 3, rows.map(x => x.d));
    ck('both meals on every date',
      [...new Set(rows.map(x => x.d))].every(d =>
        rows.filter(x => x.d === d).map(x => x.meal).sort().join() === 'Breakfast,Lunch'));
    ck('items survive the round trip',
      rows[0].items.length === 2 && rows[0].items[0].name === 'Avocado', rows[0].items);

    const { rows: prof } = await pool.query(
      'SELECT macro_kcal, macro_pro, macro_carb FROM patient_profiles WHERE user_id=$1', [member]);
    ck('the targets from the document are applied too',
      prof[0]?.macro_kcal === 1400 && prof[0]?.macro_pro === 120, prof[0]);
    ck('and the carb ceiling — the whole point of a low-carb plan',
      prof[0]?.macro_carb === 60, prof[0]);
  }

  // ── 3. Re-uploading replaces ───────────────────────────────────────────────
  console.log('\n[3] a corrected plan replaces the old one');
  {
    const ops = {
      water_target: null, macros: null, target_weight: null, program: null,
      activities: null, acv: null, supplements: null, note: null, push: null,
      meal_plan: ai.normaliseMealPlan({
        repeat_days: 3,
        meals: [{ meal: 'Lunch', mode: 'replace', items: [item('Quinoa', 40)] }],
      }),
    };
    await call('POST', '/api/ai-chat/coach-apply', tok(coach, 'monitor'), {
      actions: [{ member_id: member, member_name: 'T V Sharada', resolved: true, is_all: false, ops }],
    });
    const rows = await planRows();
    const lunches = rows.filter(x => x.meal === 'Lunch');
    ck('still three lunches, not six — a re-upload replaces', lunches.length === 3, lunches.length);
    ck('and they carry the corrected item',
      lunches.every(l => l.items.length === 1 && l.items[0].name === 'Quinoa'), lunches[0].items);
    ck('breakfasts are untouched — replacing lunch is not replacing the plan',
      rows.filter(x => x.meal === 'Breakfast').length === 3);
  }

  // ── 4. A single-day instruction still touches one day ──────────────────────
  console.log('\n[4] the typed path is unchanged');
  {
    await pool.query('DELETE FROM meal_plans');
    const ops = {
      water_target: null, macros: null, target_weight: null, program: null,
      activities: null, acv: null, supplements: null, note: null, push: null,
      meal_plan: ai.normaliseMealPlan({
        meals: [{ meal: 'Dinner', mode: 'replace', items: [item('Paneer', 50)] }],
      }),
    };
    await call('POST', '/api/ai-chat/coach-apply', tok(coach, 'monitor'), {
      actions: [{ member_id: member, member_name: 'T V Sharada', resolved: true, is_all: false, ops }],
    });
    const rows = await planRows();
    ck('"add paneer to dinner" writes exactly one row', rows.length === 1, rows.length);
  }

  // ── 4b. The upload route, end to end ──────────────────────────────────────
  // The bug this exists for: the route called coachMembers(id, role) when the
  // helper takes the whole user object, so the roster came back EMPTY and every
  // upload answered "No members assigned to you yet" — while the typed chat,
  // which calls it correctly, worked fine. Nothing in the suite reached this
  // line, because the access tests all return before it.
  console.log('\n[4b] uploading a plan');
  {
    const r = await call('POST', '/api/ai-chat/coach-doc', tok(coach, 'monitor'), {
      file: 'JVBERi0xLjQK', mimeType: 'application/pdf',
      fileName: 'Low-Carb-Diet-Plan-TV-Sharada.pdf',
    });
    ck('the upload is accepted', r.status === 200, r.data);
    ck('the coach\'s roster is found — not "no members assigned"',
      !/No members assigned/i.test(r.data.reply || ''), r.data.reply);
    ck('one action comes back', (r.data.actions || []).length === 1, r.data.actions?.length);

    const a = (r.data.actions || [])[0] || {};
    ck('the member named in the document is resolved', a.resolved === true, a);
    ck('to the right person', a.member_id === member, a.member_id);
    ck('three meals are prescribed', a.ops?.meal_plan?.meals?.length === 3,
      a.ops?.meal_plan?.meals?.map(m => m.meal));
    ck('the plan spans the days the document implies',
      a.ops?.meal_plan?.repeat_days === 14, a.ops?.meal_plan?.repeat_days);
    ck('targets carry through in op spelling',
      a.ops?.macros?.pro === 120 && a.ops?.macros?.carb === 60, a.ops?.macros);
    ck('the preview lists the changes', (a.changes || []).length >= 3, a.changes);
    ck('nothing is applied yet — the coach still approves it',
      (await planRows()).length === 1, 'meal_plans should be untouched by a preview');
  }

  // ── 5. Access ──────────────────────────────────────────────────────────────
  console.log('\n[5] who may upload a plan');
  {
    let r = await call('POST', '/api/ai-chat/coach-doc', tok(member, 'patient'),
      { file: 'x', mimeType: 'application/pdf' });
    ck('a member cannot upload a plan for themselves', r.status === 403, r.status);

    r = await call('POST', '/api/ai-chat/coach-doc', null, { file: 'x' });
    ck('nor can an anonymous caller', r.status === 401, r.status);

    r = await call('POST', '/api/ai-chat/coach-doc', tok(coach, 'monitor'), {});
    ck('a request with no file is a clear 400', r.status === 400, r.status);

    r = await call('POST', '/api/ai-chat/coach-doc', tok(coach, 'monitor'),
      { file: 'A'.repeat(10_000_001), mimeType: 'application/pdf' });
    ck('an oversized file is refused before it reaches the model',
      r.status === 413, r.status);
  }

  // ── 6. The preview says how long it lasts ──────────────────────────────────
  console.log('\n[6] the coach can see what they are approving');
  {
    const long = ai.describeOps({
      meal_plan: ai.normaliseMealPlan({
        repeat_days: 14,
        meals: [{ meal: 'Lunch', mode: 'replace', items: [item('Roti', 40)] }] }),
    });
    ck('a multi-day plan says so in the preview',
      /next 14 days/.test(long.map(c => c.text).join(' ')), long);

    const short = ai.describeOps({
      meal_plan: ai.normaliseMealPlan({
        meals: [{ meal: 'Lunch', mode: 'replace', items: [item('Roti', 40)] }] }),
    });
    ck('a today-only plan does not claim a span',
      !/next \d+ days/.test(short.map(c => c.text).join(' ')), short);
  }

  srv.close();
  console.log(`\n${fail === 0 ? '✅' : '❌'} test-diet-plan: ${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
