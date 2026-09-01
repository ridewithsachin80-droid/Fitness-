#!/usr/bin/env node
/**
 * test-weekly-report.js — the Sunday report, end to end on real Postgres.
 *
 * Every assertion here is about SQL and stored shape, which a stub pool cannot
 * verify — and stub pools have already shipped two SQL bugs on this project.
 *
 * The AI is injected as a fake, so no network and no axios stubbing.
 *
 * HOW THIS USED TO NOT RUN
 * ------------------------
 * This file required TEST_DATABASE_URL and exited 0 when it was absent. The
 * gate exports DATABASE_URL, not TEST_DATABASE_URL, so every run for months
 * printed a green tick reading "✓ test-weekly-report  0 assertions" while 214
 * lines of coverage did nothing. A skip that exits 0 is indistinguishable from
 * a pass at a glance, and "0 assertions" was the only tell.
 *
 * It now takes DATABASE_URL with the same localhost guard as every other
 * database suite. TEST_DATABASE_URL still works as an override so existing
 * habits do not break. `test-local.sh` separately fails any suite that reports
 * zero assertions, so this cannot come back quietly.
 */
'use strict';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
if (/railway|rlwy\.net|amazonaws|prod/i.test(process.env.DATABASE_URL || '')) {
  console.error('Refusing to run: DATABASE_URL points at a live database.');
  process.exit(1);
}
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.');
  process.exit(1);
}
process.env.JWT_SECRET = 'smoke-test-secret';
process.env.NODE_ENV = 'test';

const path = require('path');
const http = require('http');
const assert = require('assert');
const SERVER = path.resolve(__dirname, '..');
const pool = require(path.join(SERVER, 'db/pool'));
const wr = require(path.join(SERVER, 'services/weeklyReport'));

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log('  \u2713 ' + name); passed++; }
  catch (e) { console.log('  \u2717 ' + name + '\n      ' + e.message); process.exitCode = 1; }
};

// Fixed run date so the fixture is stable regardless of when the suite runs.
const RUN = '2026-08-30';                       // a Sunday
const W = wr.weekWindow(RUN);                   // 24–30 Aug, prev 17–23 Aug
const MEMBER = 402;
const COACH  = 300;

const fakeAI = async (prompt) => ({
  text: /Padmini/.test(prompt)
    ? 'Protein slipped on the weekend — one extra egg at breakfast closes it. Everything else, exactly how it is done.'
    : 'Steady week.',
  provider: 'fake',
});

async function seed() {
  // The coach has to exist before the link row: monitor_patients.monitor_id is
  // a foreign key. This suite used to assume coach 300 was already seeded, from
  // the old "member 214 + coach 300" fixture convention. Nothing seeds that any
  // more — every other suite creates what it needs — so on a bare schema this
  // died on the FK. It never surfaced because the suite was also skipping
  // itself before it got this far.
  await pool.query(`INSERT INTO users (id,name,phone,role,password,active)
    VALUES ($1,'Weekly Test Coach','7790000300','monitor','x',true) ON CONFLICT (id) DO NOTHING`, [COACH]);
  await pool.query(`INSERT INTO users (id,name,phone,role,password,active)
    VALUES ($1,'Padmini Test','778','patient','x',true) ON CONFLICT (id) DO NOTHING`, [MEMBER]);
  // Explicit ids do not advance the SERIAL sequence, so a later suite calling
  // INSERT without an id would eventually collide with 300 or 402. Push the
  // sequence past whatever is now the highest id.
  await pool.query(
    `SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT MAX(id) FROM users), 1))`);
  await pool.query(`INSERT INTO patient_profiles (user_id,start_weight,target_weight,macro_kcal,macro_pro)
    VALUES ($1,94.0,80.0,1800,110)
    ON CONFLICT (user_id) DO UPDATE SET start_weight=94.0, target_weight=80.0,
      macro_kcal=1800, macro_pro=110`, [MEMBER]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id) VALUES ($2,$1)
    ON CONFLICT DO NOTHING`, [MEMBER, COACH]);
  await pool.query(`DELETE FROM weekly_reports WHERE patient_id=$1`, [MEMBER]);
  await pool.query(`DELETE FROM daily_logs WHERE patient_id=$1`, [MEMBER]);
  await pool.query(`DELETE FROM workout_sessions WHERE patient_id=$1`, [MEMBER]);

  const meal = (cal, pro) => JSON.stringify(
    [{ name: 'Meal', grams: 100, per_100g: { calories: cal, protein: pro, total_carbs: 10, fat: 5 } }]);

  // Four weeks of weigh-ins so the projection has enough points, ending 84.9.
  const rows = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(Date.parse(W.end + 'T00:00:00Z') - i * 86400e3).toISOString().slice(0, 10);
    rows.push([MEMBER, d, +(86.7 - (27 - i) * 0.065).toFixed(1)]);
  }
  for (const [pid, d, kg] of rows) {
    await pool.query(`INSERT INTO daily_logs (patient_id, log_date, weight_kg) VALUES ($1,$2::date,$3)
      ON CONFLICT (patient_id, log_date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg`, [pid, d, kg]);
  }
  // Exact numbers for the report week: 85.2 last Sunday → 84.9 this Sunday.
  await pool.query(`UPDATE daily_logs SET weight_kg=85.2 WHERE patient_id=$1 AND log_date=$2::date`, [MEMBER, W.prevEnd]);
  await pool.query(`UPDATE daily_logs SET weight_kg=84.9 WHERE patient_id=$1 AND log_date=$2::date`, [MEMBER, W.end]);

  // Food on 5 of the 7 days: avg must ignore the two blank days.
  for (let i = 0; i < 5; i++) {
    const d = new Date(Date.parse(W.start + 'T00:00:00Z') + i * 86400e3).toISOString().slice(0, 10);
    await pool.query(`UPDATE daily_logs SET food_items=$3::jsonb WHERE patient_id=$1 AND log_date=$2::date`,
      [MEMBER, d, meal(1700, 104)]);
  }
  // Two training days (one with sets, one cardio-only) inside the window.
  const { rows: [s1] } = await pool.query(
    `INSERT INTO workout_sessions (patient_id, session_date, cardio) VALUES ($1,$2::date,'[]')
     ON CONFLICT (patient_id, session_date) DO UPDATE SET cardio='[]' RETURNING id`,
    [MEMBER, W.start]);
  const { rows: [ex] } = await pool.query(
    `INSERT INTO exercises (name, muscle_group) VALUES ('Weekly Test Squat','legs')
     ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id`);
  await pool.query(`DELETE FROM session_sets WHERE session_id=$1`, [s1.id]);
  await pool.query(`INSERT INTO session_sets (session_id, exercise_id, set_number, reps, weight_kg)
    VALUES ($1,$2,1,10,60)`, [s1.id, ex.id]);
  await pool.query(
    `INSERT INTO workout_sessions (patient_id, session_date, cardio)
     VALUES ($1,$2::date,'[{"type":"walk"},{"type":"cycle"}]')
     ON CONFLICT (patient_id, session_date) DO UPDATE SET cardio=EXCLUDED.cardio`,
    [MEMBER, new Date(Date.parse(W.start + 'T00:00:00Z') + 86400e3).toISOString().slice(0, 10)]);
}

(async () => {
  console.log('\nWeekly report — real Postgres');
  await seed();

  const report = await wr.generateForMember(
    { id: MEMBER, name: 'Padmini Test', monitor_id: COACH }, RUN, { ai: fakeAI });

  await test('a report is generated for an active week', () => {
    assert.ok(report && report.id, 'expected a stored report');
  });

  await test('the stored numbers match the seeded week', () => {
    const d = report.data;
    assert.strictEqual(d.latestWeight, 84.9);
    assert.strictEqual(d.weekDelta, -0.3, '85.2 → 84.9');
    assert.strictEqual(d.avgKcal, 1700, 'blank days must not drag the average down');
    assert.strictEqual(d.avgPro, 104);
    assert.strictEqual(d.daysLogged, 7, 'weigh-in alone counts as a logged day');
    assert.strictEqual(d.workoutDays, 1);
    assert.strictEqual(d.cardioCount, 2);
    assert.strictEqual(d.totalDelta, 9.1, '94 start − 84.9');
  });

  await test('the coach note is stored', () => {
    assert.ok(/extra egg at breakfast/.test(report.coachNote || ''));
  });

  await test('the projection lands in a plausible future window', () => {
    const p = report.data.projectedDate;
    assert.ok(p, 'a steady 4-week decline toward 80 should project');
    assert.ok(p > W.end && p < '2027-08-30', `implausible projection: ${p}`);
  });

  await test('the row is stored under the right week with its JSONB intact', async () => {
    const { rows } = await pool.query(
      `SELECT week_start, week_end, data, coach_note, monitor_id FROM weekly_reports
       WHERE patient_id=$1 AND week_start=$2::date`, [MEMBER, W.start]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(String(rows[0].week_end).slice(0, 10), W.end);
    assert.strictEqual(rows[0].monitor_id, 300);
    assert.strictEqual(rows[0].data.latestWeight, 84.9);
  });

  await test('regenerating the same week updates in place, never duplicates', async () => {
    await wr.generateForMember({ id: MEMBER, name: 'Padmini Test', monitor_id: COACH }, RUN, { ai: fakeAI });
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM weekly_reports WHERE patient_id=$1 AND week_start=$2::date`,
      [MEMBER, W.start]);
    assert.strictEqual(rows[0].n, 1);
  });

  await test('a member with an empty week gets no report at all', async () => {
    const GHOST = 403;
    await pool.query(`INSERT INTO users (id,name,phone,role,password,active)
      VALUES ($1,'Ghost Member','779','patient','x',true) ON CONFLICT (id) DO NOTHING`, [GHOST]);
    await pool.query(`DELETE FROM daily_logs WHERE patient_id=$1`, [GHOST]);
    const r = await wr.generateForMember({ id: GHOST, name: 'Ghost Member' }, RUN, { ai: fakeAI });
    assert.strictEqual(r, null, 'silence beats an empty report');
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM weekly_reports WHERE patient_id=$1`, [GHOST]);
    assert.strictEqual(rows[0].n, 0);
  });

  await test('a failing AI still produces the report, just without a note', async () => {
    const boom = async () => { throw new Error('gemini down'); };
    await pool.query(`DELETE FROM weekly_reports WHERE patient_id=$1`, [MEMBER]);
    const r = await wr.generateForMember({ id: MEMBER, name: 'Padmini Test', monitor_id: COACH }, RUN, { ai: boom });
    assert.ok(r && r.data.latestWeight === 84.9, 'the numbers matter more than the prose');
    assert.strictEqual(r.coachNote, null);
  });

  // ── Member endpoint ────────────────────────────────────────────────────────
  const rl = http.Server.prototype.listen;
  http.Server.prototype.listen = function (...a) { const cb = a.find(x => typeof x === 'function'); cb && cb(); return this; };
  const { app } = require(path.join(SERVER, 'index.js'));
  http.Server.prototype.listen = rl;
  const jwt = require(path.join(SERVER, 'node_modules/jsonwebtoken'));
  const token = jwt.sign({ id: MEMBER, role: 'patient', name: 'Padmini Test' }, 'smoke-test-secret');
  const server = app.listen(0);
  const port = server.address().port;
  const get = (p) => new Promise(r => {
    http.request({ host: '127.0.0.1', port, path: p, method: 'GET',
      headers: { authorization: 'Bearer ' + token } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r({ code: res.statusCode, body: JSON.parse(d || '{}') })); }).end();
  });

  await test('the member endpoint returns the latest report', async () => {
    const r = await get('/api/members/me/weekly-report');
    assert.strictEqual(r.code, 200);
    assert.ok(r.body.latest, 'expected a latest report');
    assert.strictEqual(r.body.latest.data.latestWeight, 84.9);
  });

  await test('history holds previous weeks, newest first, without the full payload', async () => {
    await pool.query(
      `INSERT INTO weekly_reports (patient_id, monitor_id, week_start, week_end, data, coach_note)
       VALUES ($1,300,$2::date,$3::date,$4::jsonb,'older')
       ON CONFLICT (patient_id, week_start) DO NOTHING`,
      [MEMBER, W.prevStart, W.prevEnd, JSON.stringify({ weekDelta: -0.4, daysLogged: 6 })]);
    const r = await get('/api/members/me/weekly-report');
    assert.strictEqual(String(r.body.latest.week_start).slice(0, 10), W.start, 'newest first');
    assert.strictEqual(r.body.history.length, 1);
    assert.strictEqual(r.body.history[0].weekDelta, -0.4);
    assert.strictEqual(r.body.history[0].data, undefined, 'history is a strip, not a payload');
  });

  server.close();
  console.log(`\n${passed} assertions passed${process.exitCode ? ' (with failures)' : ''}\n`);
  // Loading index.js starts socket.io and the cron schedules, which keep the
  // event loop alive — exit explicitly rather than hanging the suite.
  await pool.end().catch(() => {});
  process.exit(process.exitCode ? 1 : 0);
})();
