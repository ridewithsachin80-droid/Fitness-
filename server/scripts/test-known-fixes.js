/**
 * scripts/test-known-fixes.js — server half of the 10 Oct 2026 known fixes.
 *
 * Twenty-three test cases in FitLife-Test-Cases-v2.xlsx were marked "expected
 * to fail" from reading the code. These are the ones whose fix is on the
 * server, checked on a real Postgres over real HTTP:
 *
 *   [1] WKT-011  a workout save without notes keeps the notes (the AI chat's)
 *   [2] WKT-012  exercises on the list with no set done are still there on reopening
 *   [3] LAB-004  one printed limit is enough to flag a value (member and coach entry)
 *   [4] LAB-004  the comparison and the flags read one-sided ranges too
 *   [5] tracker sign-in: the OAuth state is signed, a forged one is refused
 *
 * VOI-011 / VOI-012 are in test-member-apply.js, MSG-003 in
 * test-morning-nudge.js, the screens in ui-tests.mjs.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q, _r, n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/workouts', require('../routes/workouts'));
app.use('/api/patients', require('../routes/patients'));
app.use('/api/trackers', require('../routes/trackers'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n))
                            : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e === undefined ? '' : e).slice(0, 260))); };

(async () => {
  const tag = String(Date.now()).slice(-7);
  const mk = async (name, phone, role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, phone, role])).rows[0].id;
  const coach  = await mk('Coach K', `73${tag}1`, 'monitor');
  const member = await mk('Asha K',  `73${tag}2`, 'patient');
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [member]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true)`, [coach, member]);
  const exIds = (await pool.query(
    `INSERT INTO exercises (name, muscle_group) VALUES ($1,'chest'),($2,'legs'),($3,'back') RETURNING id`,
    [`Bench ${tag}`, `Squat ${tag}`, `Row ${tag}`])).rows.map(r => r.id);
  const [bench, squat, row] = exIds;

  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u, r) => jwt.sign({ id: u, role: r, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const M = tok(member, 'patient'), C = tok(coach, 'monitor');
  const call = async (method, p, t, body, opts = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method, redirect: 'manual',
      headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), ...opts });
    return { status: res.status, location: res.headers.get('location'), data: await res.json().catch(() => ({})) };
  };
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  try {
    console.log('\n[1] WKT-011: the workout sheet no longer erases session notes');
    {
      // What the AI chat writes: a session with notes.
      await call('POST', '/api/workouts', M, { date: today, duration_min: 20, notes: '20 min walk · felt strong', exercises: [] });
      // What an OLDER workout sheet sends after the member adds a set: no notes field.
      const r = await call('POST', '/api/workouts', M, { date: today, duration_min: 20,
        exercises: [{ exercise_id: bench, sets: [{ reps: 10, weight_kg: 40 }] }] });
      const got = await call('GET', `/api/workouts?date=${today}`, M);
      ck('a save that does not send notes keeps the AI chat\'s notes', r.status === 200 && got.data.session?.notes === '20 min walk · felt strong', got.data.session);
      ck('…and the set was saved', got.data.exercises.some(e => e.exercise_id === bench && e.sets.length === 1), got.data.exercises);
      await call('POST', '/api/workouts', M, { date: today, notes: '20 min walk · felt strong', exercises: [{ exercise_id: bench, sets: [{ reps: 10, weight_kg: 40 }, { reps: 8, weight_kg: 45 }] }] });
      ck('the new sheet sends the notes it loaded — still there after another set', (await call('GET', `/api/workouts?date=${today}`, M)).data.session?.notes === '20 min walk · felt strong');
      await call('POST', '/api/workouts', M, { date: today, notes: null, exercises: [{ exercise_id: bench, sets: [{ reps: 10, weight_kg: 40 }] }] });
      ck('sending notes: null still clears them on purpose', (await call('GET', `/api/workouts?date=${today}`, M)).data.session?.notes === null);
    }

    console.log('\n[2] WKT-012: a program day pulled in and not started is still listed');
    {
      const d = new Date(Date.now() + 330 * 60000 - 86400000).toISOString().slice(0, 10);
      await call('POST', '/api/workouts', M, { date: d, exercises: [
        { exercise_id: squat, sets: [], fromProgram: true },
        { exercise_id: bench, sets: [{ reps: 10, weight_kg: 40 }], fromProgram: true },
        { exercise_id: row,   sets: [{ reps: '', weight_kg: '' }], fromProgram: true },
      ] });
      const got = await call('GET', `/api/workouts?date=${d}`, M);
      const ids = got.data.exercises.map(e => e.exercise_id);
      ck('all three are listed after reopening — the done one and the two not started', ids.length === 3 && [bench, squat, row].every(i => ids.includes(i)), got.data.exercises);
      const sq = got.data.exercises.find(e => e.exercise_id === squat);
      ck('a not-started exercise comes back with no sets, its name, and still marked as from the program (so a day switch can swap it)',
         sq && sq.sets.length === 0 && sq.exercise_name === `Squat ${tag}` && sq.fromProgram === true, sq);
      ck('an empty set row (blank reps) does not count as done', got.data.exercises.find(e => e.exercise_id === row)?.sets.length === 0);
      ck('the stored column is not leaked into the response', !('pending_exercises' in (got.data.session || {})));
      await call('POST', '/api/workouts', M, { date: d, exercises: [{ exercise_id: bench, sets: [{ reps: 10, weight_kg: 40 }] }] });
      const after = await call('GET', `/api/workouts?date=${d}`, M);
      ck('removing them from the list removes them (the list is what the sheet last saved)', after.data.exercises.length === 1, after.data.exercises.map(e => e.exercise_id));
      const { rows: [col] } = await pool.query(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='workout_sessions' AND column_name='pending_exercises'`);
      ck('workout_sessions.pending_exercises: jsonb, not null, default []', col && col.data_type === 'jsonb' && col.is_nullable === 'NO' && /'\[\]'::jsonb/.test(col.column_default), col);
    }

    console.log('\n[3] LAB-004: one printed limit is enough');
    {
      const d = '2026-09-01';
      const r = await call('POST', '/api/patients/me/labs', M, { test_date: d, results: [
        { test_name: 'Total Cholesterol', value: 250, unit: 'mg/dL', ref_min: '', ref_max: 200 },
        { test_name: 'HDL', value: 32, unit: 'mg/dL', ref_min: 40, ref_max: '' },
        { test_name: 'Triglycerides', value: 120, unit: 'mg/dL', ref_max: 150 },
        { test_name: 'Hb', value: 14, unit: 'g/dL' },
      ] });
      const labs = (await call('GET', '/api/patients/me/labs', M)).data.labs || [];
      const st = (n) => labs.find(l => l.test_name === n)?.status;
      ck('member entry: 250 with only "Ref max 200" is HIGH (it was saved as normal)', r.status < 300 && st('Total Cholesterol') === 'high', labs.map(l => [l.test_name, l.status]));
      ck('member entry: HDL 32 with only "Ref min 40" is LOW', st('HDL') === 'low');
      ck('inside a one-sided range stays normal; no range at all stays normal', st('Triglycerides') === 'normal' && st('Hb') === 'normal');
      const c = await call('POST', `/api/patients/${member}/labs`, C, { test_date: d, test_name: 'LDL', value: 180, unit: 'mg/dL', ref_min: '', ref_max: 130 });
      ck('coach entry: same rule — LDL 180 over "≤ 130" is HIGH, and the blank minimum is stored as empty, not an error',
         c.status === 201 && c.data.status === 'high' && c.data.ref_min === null && Number(c.data.ref_max) === 130, [c.status, c.data.status, c.data.ref_min, c.data.error]);
      const { classifyLab } = require('../routes/patients');
      ck('classify: blank strings and nonsense never flag', classifyLab(5, '', '') === 'normal' && classifyLab('abc', 1, 2) === 'normal');
    }

    console.log('\n[4] LAB-004: comparisons and flags read one-sided ranges');
    {
      const { analyseLabs, rangeState, refText } = require('../services/labAnalysis');
      ck('rangeState: max only → high above it', rangeState(250, null, 200) === 'high' && rangeState(150, null, 200) === 'normal');
      ck('rangeState: min only → low below it', rangeState(30, 40, null) === 'low');
      ck('rangeState: no limits → not judged', rangeState(5, null, null) === null);
      ck('the range is written the way a report prints it: "13–17", "≤ 200", "≥ 40"', refText(13, 17) === '13–17' && refText(null, 200) === '≤ 200' && refText(40, null) === '≥ 40' && refText(null, null) === null);
      const out = analyseLabs([
        { test_name: 'Total Cholesterol', value: 230, ref_min: null, ref_max: 200, test_date: '2026-06-01' },
        { test_name: 'Total Cholesterol', value: 250, ref_min: null, ref_max: 200, test_date: '2026-09-01' },
      ], [], []);
      ck('a value over a printed maximum alone is in "out of range", shown as "≤ 200" (not "null–200")',
         out.out_of_range.length === 1 && out.out_of_range[0].state === 'high' && out.out_of_range[0].ref === '≤ 200', out.out_of_range);
      ck('the comparison carries the same range text', out.comparisons[0]?.ref === '≤ 200' && out.comparisons[0]?.to_state === 'high', out.comparisons[0]);
    }

    console.log('\n[5] tracker sign-in: the state cannot be forged');
    {
      const go = await call('GET', '/api/trackers/oauth/fitbit', M);
      const state = go.location ? new URL(go.location).searchParams.get('state') : null;
      let decoded = null; try { decoded = jwt.verify(state, process.env.JWT_SECRET); } catch {}
      ck('the redirect to Fitbit carries a SIGNED state for this member and provider', go.status === 302 && decoded && decoded.userId === member && decoded.provider === 'fitbit', [go.status, decoded]);
      const forged = Buffer.from(JSON.stringify({ userId: coach, provider: 'fitbit' })).toString('base64');
      const cb = await call('GET', `/api/trackers/oauth/fitbit/callback?code=x&state=${encodeURIComponent(forged)}`, null);
      ck('a hand-made state (the old base64 format, naming another user) is refused — back to Devices with an error, no token exchange',
         cb.status === 302 && /\/devices\?error=oauth_state/.test(cb.location || ''), [cb.status, cb.location]);
      const cross = await call('GET', `/api/trackers/oauth/whoop/callback?code=x&state=${encodeURIComponent(state)}`, null);
      ck('a Fitbit state cannot be used for WHOOP', /error=oauth_state/.test(cross.location || ''), cross.location);
      const old = jwt.sign({ userId: member, provider: 'fitbit', k: 'tracker_oauth' }, process.env.JWT_SECRET, { expiresIn: -10 });
      const exp = await call('GET', `/api/trackers/oauth/fitbit/callback?code=x&state=${encodeURIComponent(old)}`, null);
      ck('an expired state is refused', /error=oauth_state/.test(exp.location || ''), exp.location);
      const login = jwt.sign({ id: member, role: 'patient' }, process.env.JWT_SECRET);
      const asLogin = await call('GET', `/api/trackers/oauth/fitbit/callback?code=x&state=${encodeURIComponent(login)}`, null);
      ck('a login token is not accepted as a state', /error=oauth_state/.test(asLogin.location || ''), asLogin.location);
    }
  } catch (e) {
    fail++; console.log('  ✗ suite crashed: ' + e.stack);
  } finally {
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[coach, member]]).catch(() => {});
    await pool.query(`DELETE FROM exercises WHERE id = ANY($1)`, [exIds]).catch(() => {});
    srv.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    await pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
