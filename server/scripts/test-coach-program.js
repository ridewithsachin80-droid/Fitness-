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
const fake = async (url, body) => {
  if (!/generativelanguage/.test(String(url))) throw new Error('unexpected ' + url);
  return { data: { candidates: [{ content: { parts: [{ text: JSON.stringify(PROGRAM_CMD) }] } }] } };
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

  server.close();
  console.log(ok ? '\nAll checks passed\n' : '\nFAILURES\n');
  process.exit(ok ? 0 : 1);
})();
