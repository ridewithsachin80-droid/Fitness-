/**
 * ad-hoc test: proves the workout-merge fix (AI chat writing to workout_sessions
 * without clobbering manually-logged sets). Simulates the exact client sequence:
 *   1. member manually logs a real exercise with sets (via POST /api/workouts)
 *   2. AI chat "applies" a freeform workout — GETs current session, resends
 *      the existing exercises UNCHANGED, adds duration + a note line
 *   3. assert the manual sets survived, and duration/notes are merged correctly
 */
process.env.JWT_SECRET = 'testsecret';
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const workoutRoutes = require('../routes/workouts');

const app = express();
app.use(express.json());
app.use('/api/workouts', workoutRoutes);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + JSON.stringify(extra).slice(0,200) : ''}`); }
}
async function request(server, method, path, token, body) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

(async () => {
  await pool.query(`DELETE FROM users`);
  const { rows: [pat] } = await pool.query(
    `INSERT INTO users (name, phone, password, role, active) VALUES ('Test Member','9000000099','x','patient',true) RETURNING id`);
  const { rows: [ex] } = await pool.query(
    `INSERT INTO exercises (name, muscle_group) VALUES ('Bench Press','chest') ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id`);

  const token = jwt.sign({ id: pat.id, role: 'patient', name: 'Test' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const server = app.listen(0);
  const date = '2026-08-19';

  // Step 1 — member manually logs Bench Press: 3 sets
  let r = await request(server, 'POST', '/api/workouts', token, {
    date, duration_min: 20, notes: 'Felt strong today',
    exercises: [{ exercise_id: ex.id, sets: [{ reps: 8, weight_kg: 40 }, { reps: 8, weight_kg: 40 }, { reps: 6, weight_kg: 42.5 }] }],
  });
  check('manual session saved', r.status === 200 && r.data.saved, r.data);

  // Step 2 — simulate AI chat's applyWorkouts(): GET current session first
  r = await request(server, 'GET', `/api/workouts?date=${date}`, token);
  const existing = r.data;
  check('GET returns the manual session', existing.session?.duration_min === 20, existing);
  check('GET returns the manual sets', existing.exercises?.[0]?.sets?.length === 3, existing);

  const prevExercises = existing.exercises.map(e => ({
    exercise_id: e.exercise_id, sets: e.sets.map(s => ({ reps: s.reps, weight_kg: s.weight_kg })),
  }));
  const addedMinutes = 120; // "Pushpendra 2 hours workout"
  const newDuration = (existing.session.duration_min || 0) + addedMinutes;
  const combinedNotes = [existing.session.notes, '✨ Workout — 2 hours (~600 kcal)'].filter(Boolean).join('\n');

  r = await request(server, 'POST', '/api/workouts', token, {
    date, duration_min: newDuration, notes: combinedNotes, exercises: prevExercises,
  });
  check('AI-merged apply succeeds', r.status === 200 && r.data.saved, r.data);

  // Step 3 — verify nothing was clobbered
  r = await request(server, 'GET', `/api/workouts?date=${date}`, token);
  const after = r.data;
  check('duration merged (20+120=140)', after.session.duration_min === 140, after.session);
  check('notes contain BOTH manual + AI lines', after.session.notes.includes('Felt strong today') && after.session.notes.includes('2 hours'), after.session.notes);
  check('manual Bench Press sets SURVIVED the AI apply', after.exercises?.[0]?.sets?.length === 3, after.exercises);
  check('exact set data unchanged (8reps/40kg first set)', after.exercises[0].sets[0].reps === 8 && after.exercises[0].sets[0].weight_kg === 40, after.exercises[0].sets[0]);

  // Step 4 — undo path: restore original snapshot
  r = await request(server, 'POST', '/api/workouts', token, {
    date, duration_min: 20, notes: 'Felt strong today', exercises: prevExercises,
  });
  r = await request(server, 'GET', `/api/workouts?date=${date}`, token);
  check('undo restores original duration/notes', r.data.session.duration_min === 20 && r.data.session.notes === 'Felt strong today', r.data.session);
  check('undo still preserves the sets', r.data.exercises[0].sets.length === 3, r.data.exercises);

  server.close();
  console.log(`\n═══ WORKOUT PLUMBING TEST: ${pass} passed, ${fail} failed ═══`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
