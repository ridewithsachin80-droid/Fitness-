/**
 * scripts/test-weekly.js — Phase 7: weekly check-in, and the coach's AI brief.
 *
 * Real Postgres and routes. "Today" is pinned (utils/istDate replaced before
 * the routes load), and the AI is passed in or stubbed, so every rule about
 * which week, and every number in the brief, is exact.
 *
 * WHAT MUST HOLD
 *   A. The check-in opens Sunday and Monday only, belongs to the week ending
 *      that Sunday, takes five answers from 1 to 5, and a second answer that
 *      week replaces the first.
 *   B. The brief covers the last FULL week (Mon–Sun), is written only from
 *      facts computed here (logged days, kcal, weight, workouts, photos,
 *      off-plan meals, swap requests, the check-in), and the model is told
 *      to use only them.
 *   C. If the model is down, a plain brief from the same facts is stored.
 *   D. Coach-only: a member cannot read a brief; another coach cannot.
 *   E. A check-in made after the brief makes the brief again.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'stub-key';
const path = require('path');
let fakeToday = '2026-10-04';                       // a Sunday
const istPath = require.resolve('../utils/istDate');
require(istPath);
const realIst = require.cache[istPath].exports;
require.cache[istPath].exports = { ...realIst, getISTDate: () => fakeToday };

const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
let aiMode = 'ok', lastPrompt = '';
const stubbedPost = async (url, body, cfg) => {
  if (/generativelanguage|groq/.test(String(url))) {
    const sent = body.messages?.[0]?.content || body.contents?.[0]?.parts?.[0]?.text || '';
    if (sent.startsWith('You are writing a short WEEKLY BRIEF')) {
      lastPrompt = sent;
      if (aiMode === 'down') { const e = new Error('500'); e.response = { status: 500 }; throw e; }
      const text = 'Padmini logged 5 of 7 days and stress was high. Try: ask about the wedding.';
      return { data: { candidates: [{ content: { parts: [{ text }] } }], choices: [{ message: { content: text } }] } };
    }
  }
  return realAxios.post(url, body, cfg);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const W = require('../services/weeklyBrief');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };

(async () => {
  console.log('\n[0] which week (no database)');
  ck('a Sunday check-in is about the week ending that Sunday', W.weekEndFor('2026-10-04') === '2026-10-04');
  ck('a Monday check-in is about the week that ended yesterday', W.weekEndFor('2026-10-05') === '2026-10-04');
  ck('open on Sunday and Monday, closed Tuesday to Saturday', W.checkinOpen('2026-10-04') && W.checkinOpen('2026-10-05') && !['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'].some(W.checkinOpen));
  ck('the brief covers the last FULL week: on Sunday 4 Oct, the week ending 27 Sep', W.lastWeekEnd('2026-10-04') === '2026-09-27');
  ck('on Monday 5 Oct, the week ending yesterday', W.lastWeekEnd('2026-10-05') === '2026-10-04' && W.lastWeekEnd('2026-10-10') === '2026-10-04');
  ck('answers: only whole 1 to 5 kept', JSON.stringify(W.normaliseAnswers({ energy: 3, hunger: '4', sleep: 6, stress: 0, plan: 2.5, x: 5 })) === '{"energy":3,"hunger":4}');

  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (name, phone, role) => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, phone, role])).rows[0].id;
  const coach = await mk('Sachin', '9701', 'monitor'), other = await mk('Other Coach', '9702', 'monitor');
  const member = await mk('Padmini', '9703', 'patient');
  await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true)`, [coach, member]);
  await pool.query(`INSERT INTO patient_profiles (user_id, macro_kcal, macro_pro, target_weight) VALUES ($1, 1500, 110, 65)`, [member]);
  // The week Mon 28 Sep to Sun 4 Oct: 5 days with food (1,400 kcal each), weights 72.0 then 71.4;
  // last week ended at 72.2. Two workout days. One off-plan meal of 156 kcal. Two progress photos.
  const f = (k) => JSON.stringify([{ name: 'x', grams: 100, meal: 'Lunch', per_100g: { calories: k, protein: 20 } }]);
  for (const [d, w, food] of [['2026-09-26', 72.2, null], ['2026-09-28', 72.0, f(1400)], ['2026-09-29', null, f(1400)], ['2026-09-30', null, f(1400)], ['2026-10-02', null, f(1400)], ['2026-10-04', 71.4, f(1400)]]) {
    await pool.query(`INSERT INTO daily_logs (patient_id, log_date, weight_kg, food_items) VALUES ($1,$2,$3,$4)`, [member, d, w, food || '[]']);
  }
  const { rows: [ex] } = await pool.query(`INSERT INTO exercises (name, muscle_group) VALUES ('Test squat (weekly)', 'legs')
    ON CONFLICT (name) DO UPDATE SET muscle_group = EXCLUDED.muscle_group RETURNING id`);
  for (const d of ['2026-09-29', '2026-10-01']) {
    const { rows: [s] } = await pool.query(`INSERT INTO workout_sessions (patient_id, session_date) VALUES ($1,$2) RETURNING id`, [member, d]);
    await pool.query(`INSERT INTO session_sets (session_id, exercise_id, set_number, reps, weight_kg) VALUES ($1,$2,1,10,20)`, [s.id, ex.id]);
  }
  await pool.query(`INSERT INTO meal_photos (patient_id, log_date, meal, status, flagged, extras_kcal) VALUES ($1,'2026-10-01','Meal 2','logged',true,156)`, [member]);
  await pool.query(`INSERT INTO progress_photos (patient_id, week_date, pose, object_key) VALUES ($1,'2026-10-04','front','k1'), ($1,'2026-10-04','side','k2')`, [member]);
  await pool.query(`INSERT INTO plan_swaps (patient_id, food_name, alt_name, status, source) VALUES ($1,'Guava','Papaya','requested','member')`, [member]);

  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use('/api/weekly', require('../routes/weekly'));
  const srv = app.listen(0); const port = srv.address().port;
  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const M = tok(member, 'patient'), C = tok(coach, 'monitor'), O = tok(other, 'monitor');
  const call = async (method, p, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const all5 = { energy: 3, hunger: 2, sleep: 3, stress: 5, plan: 4 };

  console.log('\n[1] the member checks in');
  {
    let r = await call('GET', '/api/weekly/checkin', M);
    ck('on Sunday it is open, for the week ending today, with five questions', r.data.open === true && r.data.week_end === '2026-10-04' && r.data.questions.length === 5 && r.data.checkin === null, r.data);
    ck('four answers are not enough', (await call('POST', '/api/weekly/checkin', M, { answers: { energy: 3, hunger: 2, sleep: 3, stress: 5 } })).status === 400);
    r = await call('POST', '/api/weekly/checkin', M, { answers: all5, note: 'Wedding at home, ate out twice' });
    ck('five answers and a note are saved for this week', r.status === 200 && r.data.week_end === '2026-10-04');
    await call('POST', '/api/weekly/checkin', M, { answers: { ...all5, stress: 4 }, note: 'Wedding at home, ate out twice' });
    const rows = (await pool.query(`SELECT answers FROM weekly_checkins WHERE patient_id=$1`, [member])).rows;
    ck('answering again the same week replaces it (one row, stress now 4)', rows.length === 1 && rows[0].answers.stress === 4, rows);
    ck('a coach cannot check in for a member', (await call('POST', '/api/weekly/checkin', C, { answers: all5 })).status === 403);
    fakeToday = '2026-10-07';
    ck('on Wednesday it is closed', (await call('GET', '/api/weekly/checkin', M)).data.open === false && (await call('POST', '/api/weekly/checkin', M, { answers: all5 })).status === 409);
  }

  console.log('\n[2] the coach\'s brief');
  {
    fakeToday = '2026-10-05';                         // Monday
    const facts = await W.weekFacts(pool, member, '2026-10-04');
    ck('the week is Mon 28 Sep to Sun 4 Oct', facts.week_start === '2026-09-28' && facts.week_end === '2026-10-04');
    ck('5 days logged, 1,400 kcal average against 1,500', facts.days_logged === 5 && facts.avg_kcal === 1400 && facts.target_kcal === 1500, facts);
    ck('weight 71.4, down 0.8 from last week\'s 72.2', facts.weight_latest === 71.4 && facts.weight_change === -0.8, [facts.weight_latest, facts.weight_change]);
    ck('two workout days, two progress photos, one off-plan meal (+156 kcal), one swap request', facts.workout_days === 2 && facts.progress_photos === 2 && facts.off_plan_meals === 1 && facts.off_plan_extra_kcal === 156 && facts.swap_requests_waiting === 1, facts);
    ck('the check-in, with the note', facts.checkin?.answers?.stress === 4 && facts.checkin.note === 'Wedding at home, ate out twice');

    let r = await call('GET', `/api/weekly/brief/${member}`, C);
    ck('the coach gets the brief for that week, written by the AI', r.status === 200 && r.data.brief.week_end === '2026-10-04' && r.data.brief.source === 'ai' && /stress was high/.test(r.data.brief.text), r.data);
    ck('the AI was given only the facts, and told to use only them', /Use ONLY the facts below/.test(lastPrompt) && /"avg_kcal":1400/.test(lastPrompt) && /"note":"Wedding at home, ate out twice"/.test(lastPrompt) && /never sees it/.test(lastPrompt));
    ck('the facts come back with it, for the numbers under the text', r.data.brief.facts.days_logged === 5);
    ck('a member cannot read it', (await call('GET', `/api/weekly/brief/${member}`, M)).status === 403);
    ck('another coach cannot read it', (await call('GET', `/api/weekly/brief/${member}`, O)).status === 403);
    const before = (await pool.query(`SELECT created_at FROM coach_briefs WHERE patient_id=$1`, [member])).rows[0].created_at;
    await call('GET', `/api/weekly/brief/${member}`, C);
    ck('opening it again does not rewrite it', String((await pool.query(`SELECT created_at FROM coach_briefs WHERE patient_id=$1`, [member])).rows[0].created_at) === String(before));
    await new Promise(res => setTimeout(res, 20));
    await call('POST', '/api/weekly/checkin', M, { answers: { ...all5, stress: 2 }, note: 'Better now' });
    r = await call('GET', `/api/weekly/brief/${member}`, C);
    ck('a check-in made after the brief makes it again, with the new answers', r.data.brief.facts.checkin.answers.stress === 2 && r.data.brief.facts.checkin.note === 'Better now', r.data.brief.facts.checkin);

    aiMode = 'down';
    r = await call('POST', `/api/weekly/brief/${member}`, C);
    aiMode = 'ok';
    ck('the AI down: a plain brief from the same numbers, marked as such', r.status === 200 && r.data.brief.source === 'template'
       && /Logged 5 of 7 days/.test(r.data.brief.text) && /Average 1400 kcal against 1500/.test(r.data.brief.text) && /-0.8 kg/.test(r.data.brief.text) && /Note: "Better now"/.test(r.data.brief.text), r.data.brief?.text);
    await pool.query(`DELETE FROM coach_briefs`);
    const n = await W.makeAllBriefs(pool, '2026-10-05', { ai: async () => 'A week.' });
    ck('the Monday run makes one brief per member for the week that ended yesterday', n === 1 && (await pool.query(`SELECT week_end::text AS w FROM coach_briefs`)).rows[0].w === '2026-10-04');
    ck('and running it again makes none', (await W.makeAllBriefs(pool, '2026-10-05', { ai: async () => 'x' })) === 0);
  }

  console.log(`\n${fail === 0 ? '\u2713' : '\u2717'} test-weekly: ${pass} passed, ${fail} failed\n`);
  srv.close(); await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
