#!/usr/bin/env node
/**
 * test-coach-program.js — the "assign push/pull/legs via coach AI chat" flow,
 * end to end over real HTTP with only the AI transport stubbed.
 *
 * Modes (same convention as test-member-questions.js):
 *   default          — stubbed pg pool (wiring + validation only)
 *   TEST_DATABASE_URL — real Postgres with schema.sql loaded; users 214
 *                       (member) and 300 (coach, assigned) seeded. This mode
 *                       is the one that matters: it executes the real SQL,
 *                       exercises the one-active-program unique index, and
 *                       verifies replace-not-stack on reassignment.
 *
 * PRODUCTION GUARD: refuses live database URLs.
 */
'use strict';
if (/railway|rlwy\.net|amazonaws|prod/i.test(process.env.TEST_DATABASE_URL || '')) {
  console.error('Refusing to run: TEST_DATABASE_URL points at a live database.');
  process.exit(1);
}
const path = require('path');
const http = require('http');
process.env.JWT_SECRET = 'smoke-test-secret';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'stub-key';
delete process.env.GROQ_API_KEY;

const USE_REAL_DB = !!process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = USE_REAL_DB
  ? process.env.TEST_DATABASE_URL
  : 'postgres://stub:stub@127.0.0.1:1/stub';

const SERVER = path.resolve(__dirname, '..');
const poolPath = require.resolve(path.join(SERVER, 'db/pool.js'));
if (!USE_REAL_DB) {
  const stub = {
    query: async (sql) => {
      if (/FROM users u[\s\S]*monitor_patients/i.test(sql) || /monitor_patients/.test(sql)) {
        return { rows: [{ id: 214, name: 'Sachin' }], rowCount: 1 };
      }
      if (/SELECT id, name FROM users WHERE id=\$1/.test(sql)) return { rows: [{ id: 214, name: 'Sachin' }], rowCount: 1 };
      if (/INSERT INTO workout_programs/.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
      if (/INSERT INTO exercises/.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
      if (/FROM patient_profiles/.test(sql)) return { rows: [{}], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    connect: async () => ({ query: stubQuery, release() {} }),
    on() {}, end: async () => {},
  };
  async function stubQuery(sql) { return stub.query(sql); }
  require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: stub, children: [], paths: [] };
}

// AI stub: coach-parse asks for a program without exercises → model proposes them
const axiosPath = require.resolve('axios', { paths: [SERVER] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
const PROGRAM_CMD = {
  reply: "Assigning Sachin a Push/Pull/Legs split — this replaces his current program.",
  commands: [{
    member_name: 'Sachin',
    program: {
      name: 'Push Pull Legs',
      days: [
        { label: 'Push', weekday: 'monday', exercises: [
          { name: 'Barbell Bench Press', sets: 4, reps_min: 8, reps_max: 12, muscle_group: 'chest' },
          { name: 'Overhead Press', sets: 3, reps_min: 8, reps_max: 12, muscle_group: 'shoulders' },
          { name: 'Tricep Pushdown', sets: 3, reps_min: 10, reps_max: 15, muscle_group: 'arms' },
        ]},
        { label: 'Pull', weekday: 'wednesday', exercises: [
          { name: 'Deadlift', sets: 3, reps_min: 5, reps_max: 8, muscle_group: 'back' },
          { name: 'Lat Pulldown', sets: 3, reps_min: 10, reps_max: 12, muscle_group: 'back' },
          // junk the validator must clean:
          { name: '', sets: 3 },
          { name: 'Barbell Curl', sets: 99, reps_min: 200, muscle_group: 'biceps' },
        ]},
        { label: 'Legs', weekday: 'friday', exercises: [
          { name: 'Barbell Squat', sets: 4, reps_min: 6, reps_max: 10, muscle_group: 'legs' },
          { name: 'Leg Press', sets: 3, reps_min: 10, reps_max: 12, muscle_group: 'legs' },
        ]},
      ],
    },
    water_target: null, macros: null, target_weight: null,
    activities: null, acv: null, supplements: null, note: null, push: null,
  }],
};
const MEAL_CMD = {
  reply: "Setting Sachin's dinner plan — this replaces any dinner plan already set today.",
  commands: [{
    member_name: 'Sachin',
    meal_plan: { meals: [{ meal: 'Dinner', items: [
      { name: 'Avocado', qty_text: '100 g', grams: 100, per_100g: { calories: 160, protein: 2, total_carbs: 9, fat: 15 } },
      { name: 'Ghee', qty_text: '1 spoon', grams: 13, per_100g: { calories: 900, protein: 0, total_carbs: 0, fat: 99.5 } },
      { name: 'Olive Oil', qty_text: '1 spoon', grams: 13, per_100g: { calories: 884, protein: 0, total_carbs: 0, fat: 100 } },
      { name: 'Paneer', qty_text: '150 g', grams: 150, per_100g: { calories: 265, protein: 18, total_carbs: 3.5, fat: 20 } },
      { name: 'Eggs', qty_text: '4 medium', grams: 200, per_100g: { calories: 143, protein: 13, total_carbs: 0.7, fat: 9.5 } },
      { name: 'Chicken', qty_text: '100 g', grams: 100, per_100g: { calories: 165, protein: 31, total_carbs: 0, fat: 3.6 } },
      { name: 'Junk item', grams: 0 },
    ]}]},
    program: null, water_target: null, macros: null, target_weight: null,
    activities: null, acv: null, supplements: null, note: null, push: null,
  }],
};
const fake = async (url, body) => {
  if (!/generativelanguage/.test(String(url))) throw new Error('unexpected ' + url);
  const prompt = body.contents[0].parts.map(x => x.text || '').join('');
  // Route on the coach's actual message line — the prompt's own documentation
  // contains example food text, which burned us once already in the voice tests.
  const msgLine = (prompt.match(/Coach's message: "([^"]*)"/) || [])[1] || '';
  const APPEND_CMD = {
    reply: "Adding whey protein to Sachin's dinner plan.",
    commands: [{
      member_name: 'Sachin',
      meal_plan: { meals: [{ meal: 'Dinner', mode: 'append', items: [
        { name: 'Whey Protein', qty_text: '1 scoop', grams: 30,
          per_100g: { calories: 400, protein: 80, total_carbs: 8, fat: 5 } },
      ]}]},
      program: null, water_target: null, macros: null, target_weight: null,
      activities: null, acv: null, supplements: null, note: null, push: null,
    }],
  };
  // Celebration: assert the REAL figures reached the prompt, then answer with a
  // note the way the model would. If the stats never arrive the AI can only
  // invent numbers, which is the failure this guards.
  if (/celebrate/i.test(msgLine)) {
    global.__celebratePrompt = prompt;
    const CELEBRATE_CMD = { reply: 'Sending Padmini a congratulations note.', commands: [{
      member_name: 'Padmini',
      note: { text: 'Padmini, 84.9 kg — below 85 for the first time! That is 9.1 kg down from 94, built on steady logging and your daily walks. Same energy, one day at a time.', flagged: false },
      push: { title: 'Milestone!', body: 'Below 85 kg — 9.1 kg down. Proud of you.' },
      program: null, meal_plan: null, water_target: null, macros: null, target_weight: null,
      activities: null, acv: null, supplements: null,
    }]};
    return { data: { candidates: [{ content: { parts: [{ text: JSON.stringify(CELEBRATE_CMD) }] } }] } };
  }
  const cmd = /whey/i.test(msgLine) ? APPEND_CMD
            : /avocado/i.test(msgLine) ? MEAL_CMD : PROGRAM_CMD;
  return { data: { candidates: [{ content: { parts: [{ text: JSON.stringify(cmd) }] } }] } };
};
const stubAx = (...a) => fake(...a);
stubAx.post = fake; stubAx.get = realAxios.get; stubAx.create = realAxios.create;
stubAx.isAxiosError = realAxios.isAxiosError; stubAx.default = stubAx;
require.cache[axiosPath].exports = stubAx;

const rl = http.Server.prototype.listen;
http.Server.prototype.listen = function (...a) { const cb = a.find(x => typeof x === 'function'); cb && cb(); return this; };
const { app } = require(path.join(SERVER, 'index.js'));
http.Server.prototype.listen = rl;
const jwt = require(path.join(SERVER, 'node_modules/jsonwebtoken'));
const coachToken = jwt.sign({ id: 300, role: 'monitor', name: 'Sachin Coach' }, 'smoke-test-secret');
const server = app.listen(0); const port = server.address().port;

const req = (p, body) => new Promise(r => {
  const q = http.request({ host: '127.0.0.1', port, path: p, method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + coachToken } },
    res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r({ code: res.statusCode, body: JSON.parse(d || '{}') })); });
  q.end(JSON.stringify(body));
});

(async () => {
  let ok = true;
  const t = (n, c) => { console.log((c ? '  \u2713 ' : '  \u2717 ') + n); if (!c) ok = false; };

  // ── Parse: preview must describe the program with cleaned exercises ─────────
  const parse = await req('/api/ai-chat/coach-parse',
    { message: 'assign sachin push pull legs — push monday, pull wednesday, legs friday' });
  t('coach-parse 200', parse.code === 200);
  const action = parse.body.actions?.[0];
  t('member resolved', !!action?.resolved);
  const progChange = (action?.changes || []).find(c => /Assign program/.test(c.text));
  t('preview describes the program with weekdays',
    !!progChange && /Push · Mon \(3\)/.test(progChange.text) && /Legs · Fri \(2\)/.test(progChange.text));
  t('junk exercise dropped, silly numbers clamped (Pull has 3, not 4)',
    /Pull · Wed \(3\)/.test(progChange?.text || ''));

  // ── Apply ───────────────────────────────────────────────────────────────────
  const apply = await req('/api/ai-chat/coach-apply', { actions: [action] });
  t('coach-apply 200', apply.code === 200);
  const okResult = (apply.body.results || [])[0];
  t('apply reports the program', !!okResult?.ok && /program "Push Pull Legs" \(3 days\)/.test(String(okResult.detail || JSON.stringify(okResult))));

  if (USE_REAL_DB) {
    const pool = require(poolPath);
    const { rows: progs } = await pool.query(
      `SELECT id, name, active FROM workout_programs WHERE patient_id=214 ORDER BY id`);
    t('exactly one active program in DB', progs.filter(p => p.active).length === 1);

    const { rows: pex } = await pool.query(
      `SELECT pe.day_number, pe.day_label, pe.target_sets, pe.target_reps_min, pe.target_reps_max, e.name
       FROM program_exercises pe JOIN exercises e ON e.id = pe.exercise_id
       WHERE pe.program_id = $1 ORDER BY pe.day_number, pe.order_index`,
      [progs.find(p => p.active).id]);
    t('8 exercises across 3 days persisted', pex.length === 8);
    t('day labels carry the weekday', pex.some(r => r.day_label === 'Push · Mon') && pex.some(r => r.day_label === 'Legs · Fri'));
    t('targets persisted (bench 4 × 8-12)',
      !!pex.find(r => r.name === 'Barbell Bench Press' && r.target_sets === 4 && r.target_reps_min === 8 && r.target_reps_max === 12));
    t('clamped exercise saved with defaults, invalid muscle_group nulled',
      !!pex.find(r => r.name === 'Barbell Curl' && r.target_sets === 3 && r.target_reps_min === 8));

    // ── Reassign: replace, not stack ─────────────────────────────────────────
    const apply2 = await req('/api/ai-chat/coach-apply', { actions: [action] });
    t('reassignment succeeds (unique index not violated)', apply2.code === 200 && apply2.body.results?.[0]?.ok);
    const { rows: progs2 } = await pool.query(
      `SELECT active FROM workout_programs WHERE patient_id=214`);
    t('old program retired, still exactly one active',
      progs2.length >= 2 && progs2.filter(p => p.active).length === 1);
    const { rows: exCount } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM exercises WHERE name='Barbell Squat'`);
    t('exercises reused by name, not duplicated', exCount[0].n === 1);
  }

  // ── Meal plan: dictate dinner, verify preview + storage + member fetch ─────
  const mp = await req('/api/ai-chat/coach-parse',
    { message: 'Sachin dinner: avocado 100 grams, 1 spoon ghee, 1 spoon olive oil, 150g paneer, 4 medium egg, 100g chicken' });
  const mpAction = mp.body.actions?.[0];
  const mpChange = (mpAction?.changes || []).find(c => /Dinner plan/.test(c.text));
  t('meal plan previewed with kcal + items',
    !!mpChange && /~\d{3,4} kcal/.test(mpChange.text) && /Avocado 100g/.test(mpChange.text));
  t('zero-gram junk item dropped by normaliser', !/Junk/.test(JSON.stringify(mpAction || {})));

  const mpApply = await req('/api/ai-chat/coach-apply', { actions: [mpAction] });
  t('meal plan applied', mpApply.code === 200 && /meal plan \(Dinner\)/.test(String(mpApply.body.results?.[0]?.detail)));

  if (USE_REAL_DB) {
    const pool = require(poolPath);
    const { rows } = await pool.query(
      `SELECT meal, items FROM meal_plans WHERE patient_id=214
       AND plan_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY id DESC LIMIT 1`);
    t('dinner stored with 6 valid items', rows[0]?.meal === 'Dinner' && rows[0].items.length === 6);
    t('nutrition attached to each item', rows[0].items.every(it => it.per_100g?.calories >= 0));

    await req('/api/ai-chat/coach-apply', { actions: [mpAction] });
    const IST_TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const { rows: after } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM meal_plans
       WHERE patient_id=214 AND meal='Dinner' AND plan_date=$1::date`, [IST_TODAY]);
    t('re-prescribing replaces, not duplicates', after[0].n === 1);

    // Member fetches it
    const memberToken = jwt.sign({ id: 214, role: 'patient', name: 'Sachin' }, 'smoke-test-secret');
    const got = await new Promise(r => {
      const q = http.request({ host: '127.0.0.1', port, path: '/api/members/me/meal-plan', method: 'GET',
        headers: { authorization: 'Bearer ' + memberToken } },
        res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r({ code: res.statusCode, body: JSON.parse(d || '{}') })); });
      q.end();
    });
    t('member endpoint returns the plan', got.code === 200
      && got.body.meals?.[0]?.meal === 'Dinner'
      && got.body.meals[0].items.some(it => it.name === 'Paneer' && it.grams === 150));

    // ── Append: "add whey protein to the dinner" must merge, never wipe ──────
    const ap = await req('/api/ai-chat/coach-parse', { message: 'add whey protein to the dinner of Sachin' });
    const apAction = ap.body.actions?.[0];
    t('append previewed as "Add to Dinner plan"',
      (apAction?.changes || []).some(c => /Add to Dinner plan/.test(c.text)));
    const apApply = await req('/api/ai-chat/coach-apply', { actions: [apAction] });
    t('append applied', apApply.code === 200 && apApply.body.results?.[0]?.ok);
    const TODAY_IST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const { rows: merged } = await pool.query(
      `SELECT items FROM meal_plans
       WHERE patient_id=214 AND meal='Dinner' AND plan_date=$1::date`, [TODAY_IST]);
    t('whey joined the existing 6 items (7 total, originals intact)',
      merged[0].items.length === 7
      && merged[0].items.some(it => it.name === 'Whey Protein' && it.grams === 30)
      && merged[0].items.some(it => it.name === 'Paneer' && it.grams === 150));

    // Re-appending the same food updates grams instead of duplicating
    await req('/api/ai-chat/coach-apply', { actions: [apAction] });
    const { rows: again } = await pool.query(
      `SELECT items FROM meal_plans
       WHERE patient_id=214 AND meal='Dinner' AND plan_date=$1::date`, [TODAY_IST]);
    t('re-appending the same food does not duplicate it',
      again[0].items.filter(it => it.name === 'Whey Protein').length === 1
      && again[0].items.length === 7);
  }

  if (USE_REAL_DB) {
    const pool = require(poolPath);
    // Padmini: 94 start, 85.2 three days ago, 84.9 today, goal 80
    await pool.query(`INSERT INTO users (id,name,phone,role,password,active)
      VALUES (401,'Padmini','777','patient','x',true) ON CONFLICT (id) DO NOTHING`);
    await pool.query(`INSERT INTO patient_profiles (user_id,start_weight,target_weight)
      VALUES (401,94.0,80.0) ON CONFLICT (user_id) DO UPDATE SET start_weight=94.0, target_weight=80.0`);
    await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id) VALUES (300,401) ON CONFLICT DO NOTHING`);
    await pool.query(`DELETE FROM daily_logs WHERE patient_id=401`);
    const IST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    await pool.query(`INSERT INTO daily_logs (patient_id,log_date,weight_kg) VALUES
      (401,$1::date - 10,94.0),(401,$1::date - 3,85.2),(401,$1::date,84.9)`, [IST]);

    const cel = await req('/api/ai-chat/coach-parse', { message: 'celebrate Padmini' });
    const prompt = global.__celebratePrompt || '';
    t('real progress figures reach the AI prompt',
      /now 84.9 kg/.test(prompt) && /down 9.1 from 94/.test(prompt));
    t('the crossed-threshold milestone is flagged to the AI',
      /MILESTONE: dropped below 85 kg for the first time/.test(prompt));

    const celAction = cel.body.actions?.[0];
    t('celebration previews as a message + push',
      (celAction?.changes || []).some(c => /Message:/.test(c.text))
      && (celAction?.changes || []).some(c => /push|notification/i.test(c.text)));

    const celApply = await req('/api/ai-chat/coach-apply', { actions: [celAction] });
    t('celebration applied to the member', celApply.code === 200 && celApply.body.results?.[0]?.ok);
    const { rows: notes } = await pool.query(
      `SELECT note FROM monitor_notes WHERE patient_id=401 ORDER BY id DESC LIMIT 1`);
    t('the note reaching the member quotes her real numbers',
      /84\.9/.test(notes[0]?.note || '') && /9\.1 kg down from 94/.test(notes[0]?.note || ''));
  }

  server.close();
  console.log(ok ? '\nAll checks passed\n' : '\nFAILURES\n');
  process.exit(ok ? 0 : 1);
})();
