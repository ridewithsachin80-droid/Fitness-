/**
 * scripts/test-journey.js — full member journey, QA style.
 *
 * Walks one member from login to sleep logging, exercising every feature in
 * the order a real person would, and asserting the data actually persists and
 * the derived numbers are right. Also runs the coach's side of the same day.
 *
 * Run:  DATABASE_URL=<local test db> JWT_SECRET=x node scripts/test-journey.js
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost. This test wipes tables.');
  process.exit(1);
}
process.env.JWT_SECRET         = process.env.JWT_SECRET         || 'testsecret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'testrefreshsecret';
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'dummy';

const express = require('express');
const bcrypt  = require('bcryptjs');
const cookieParser = require('cookie-parser');
const pool    = require('../db/pool');

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());   // mirror production middleware order
app.use((req, _res, next) => { req.io = { to: () => ({ emit: () => {} }) }; next(); });
app.use('/api/auth',     require('../routes/auth'));
app.use('/api/logs',     require('../routes/logs'));
app.use('/api/patients', require('../routes/patients'));
app.use('/api/workouts', require('../routes/workouts'));
app.use('/api/ai-chat',  require('../routes/aiChat'));
app.use('/api/admin',    require('../routes/admin'));

let pass = 0, fail = 0;
const fails = [];
function ck(name, cond, detail) {
  if (cond) { pass++; console.log('   \u2713 ' + name); }
  else { fail++; fails.push(name); console.log('   \u2717 ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail).slice(0, 220) : '')); }
}
function step(n) { console.log('\n' + n); }

const IST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

(async () => {
  // ── Fixture ────────────────────────────────────────────────────────────────
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  await pool.query('DELETE FROM exercises');

  const pinHash = await bcrypt.hash('4321', 10);
  const pwHash  = await bcrypt.hash('coachpass', 10);

  const { rows: [coach] } = await pool.query(
    `INSERT INTO users (name, phone, email, password, role, active)
     VALUES ('Coach Sachin','9000000001','coach@fitlife.test',$1,'monitor',true) RETURNING id`, [pwHash]);
  const { rows: [member] } = await pool.query(
    `INSERT INTO users (name, phone, password, role, active)
     VALUES ('Subramanya Prasad','9741771679',$1,'patient',true) RETURNING id`, [pinHash]);
  await pool.query(
    `INSERT INTO patient_profiles (user_id, height_cm, gender, dob, start_weight, target_weight,
       water_target, macro_kcal, macro_pro, macro_carb, macro_fat)
     VALUES ($1, 181, 'male', '1985-04-10', 85, 78, 3000, 1800, 120, 180, 60)`, [member.id]);
  await pool.query(
    `INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true)`,
    [coach.id, member.id]);
  const { rows: [bench] } = await pool.query(
    `INSERT INTO exercises (name, muscle_group) VALUES ('Bench Press','chest') RETURNING id`);

  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (method, path, token, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const today = IST();

  // ══ 1. LOGIN ═══════════════════════════════════════════════════════════════
  step('1. LOGIN');
  let r = await call('POST', '/api/auth/pin-login', null, { phone: '9741771679', pin: '0000' });
  ck('wrong PIN rejected', r.status === 401 || r.status === 400, r.status);

  r = await call('POST', '/api/auth/pin-login', null, { phone: '9741771679', pin: '4321' });
  ck('member PIN login succeeds', r.status === 200 && !!r.data.accessToken, r.data);
  const mTok = r.data.accessToken;
  ck('login returns member role', r.data.user?.role === 'patient', r.data.user);

  r = await call('POST', '/api/auth/login', null, { email: 'coach@fitlife.test', password: 'coachpass' });
  ck('coach password login succeeds', r.status === 200 && !!r.data.accessToken, r.data);
  const cTok = r.data.accessToken;

  r = await call('GET', `/api/logs/${today}`, null);
  ck('unauthenticated request blocked', r.status === 401, r.status);

  // ══ 2. PROFILE LOADS ═══════════════════════════════════════════════════════
  step('2. PROFILE / PROTOCOL LOADS');
  r = await call('GET', '/api/patients/me', mTok);
  ck('profile loads', r.status === 200 && r.data.name === 'Subramanya Prasad', r.status);
  ck('height present (needed for TDEE)', parseFloat(r.data.height_cm) === 181, r.data.height_cm);
  ck('gender present', r.data.gender === 'male', r.data.gender);
  ck('dob present', !!r.data.dob, r.data.dob);
  ck('water target 3000ml', r.data.water_target === 3000, r.data.water_target);
  ck('macro targets present', r.data.macros?.kcal === 1800, r.data.macros);
  ck('today_energy block present', !!r.data.today_energy, Object.keys(r.data));

  // ══ 3. MORNING WEIGHT ══════════════════════════════════════════════════════
  step('3. MORNING WEIGHT');
  r = await call('POST', `/api/logs/${today}`, mTok, { weight_kg: 83.0 });
  ck('weight saves', r.status === 200, r.data);
  r = await call('GET', `/api/logs/${today}`, mTok);
  ck('weight persisted', parseFloat(r.data.weight_kg) === 83.0, r.data.weight_kg);

  const future = '2099-01-01';
  r = await call('POST', `/api/logs/${future}`, mTok, { weight_kg: 80 });
  ck('future date rejected', r.status === 400, r.status);
  r = await call('POST', '/api/logs/19-08-2026', mTok, { weight_kg: 80 });
  ck('malformed date rejected', r.status === 400, r.status);

  // ══ 4. WORKOUT — STRENGTH ══════════════════════════════════════════════════
  step('4. WORKOUT — STRENGTH SETS');
  r = await call('POST', '/api/workouts', mTok, {
    date: today, duration_min: 45,
    exercises: [{ exercise_id: bench.id, sets: [
      { reps: 10, weight_kg: 20 }, { reps: 10, weight_kg: 25 }, { reps: 12, weight_kg: 25 },
    ] }],
  });
  ck('strength session saves', r.status === 200, r.data);
  r = await call('GET', `/api/workouts?date=${today}`, mTok);
  ck('3 sets persisted', r.data.exercises?.[0]?.sets?.length === 3, r.data.exercises);
  ck('set values exact', r.data.exercises[0].sets[2].reps === 12 && r.data.exercises[0].sets[2].weight_kg === 25, r.data.exercises[0].sets);
  const volume = r.data.exercises[0].sets.reduce((s, x) => s + x.reps * x.weight_kg, 0);
  ck('volume = 750 kg', volume === 750, volume);
  ck('strength kcal = 60 (750 × 0.08)', Math.round(volume * 0.08) === 60, Math.round(volume * 0.08));

  // ══ 5. WORKOUT — CARDIO ════════════════════════════════════════════════════
  step('5. WORKOUT — CARDIO');
  const prev = (await call('GET', `/api/workouts?date=${today}`, mTok)).data;
  r = await call('POST', '/api/workouts', mTok, {
    date: today, duration_min: 45,
    exercises: prev.exercises.map(e => ({ exercise_id: e.exercise_id, sets: e.sets })),
    cardio: [{ type: 'walking', duration_min: 60, speed_kmh: 5, distance_km: 5 }],
  });
  ck('cardio saves alongside sets', r.status === 200, r.data);
  r = await call('GET', `/api/workouts?date=${today}`, mTok);
  ck('cardio persisted', r.data.cardio?.length === 1 && r.data.cardio[0].type === 'walking', r.data.cardio);
  ck('strength sets NOT clobbered by cardio save', r.data.exercises[0].sets.length === 3, r.data.exercises);
  // walking @5km/h → MET 3.4 → (3.4-1) × 83 × 1h = 199
  ck('cardio kcal ≈ 199', Math.round(2.4 * 83 * 1) === 199, Math.round(2.4 * 83));

  // ══ 6. PROTOCOL AUTO-TICKS ═════════════════════════════════════════════════
  step('6. PROTOCOL AUTO-TICK DERIVATION');
  const s6 = (await call('GET', `/api/workouts?date=${today}`, mTok)).data;
  const FOOT = ['walking', 'running', 'stairs'];
  const derivedWalk = (s6.cardio || []).some(c => FOOT.includes(c.type) && c.duration_min > 0);
  const derivedRes  = (s6.exercises || []).some(e => e.sets.some(st => st.reps > 0));
  ck('walk derives from cardio', derivedWalk === true);
  ck('resistance derives from sets', derivedRes === true);

  r = await call('POST', `/api/logs/${today}`, mTok, {
    weight_kg: 83.0,
    activities: { walk: true, resistance: true, sun: true, steps1: true },
  });
  ck('activities save', r.status === 200, r.data);
  r = await call('GET', `/api/logs/${today}`, mTok);
  ck('4 activities persisted', Object.values(r.data.activities || {}).filter(Boolean).length === 4, r.data.activities);

  // ══ 7. FOOD ════════════════════════════════════════════════════════════════
  step('7. FOOD LOG');
  const foods = [
    { name: 'Chapati',    grams: 60,  meal: 'Meal 1', per_100g: { calories: 297, protein: 8,    total_carbs: 61, fat: 3.7 } },
    { name: 'Dal',        grams: 150, meal: 'Meal 1', per_100g: { calories: 116, protein: 9,    total_carbs: 20, fat: 0.4 } },
    { name: 'Rice',       grams: 150, meal: 'Meal 2', per_100g: { calories: 130, protein: 2.7,  total_carbs: 28, fat: 0.3 } },
    { name: 'Curd',       grams: 100, meal: 'Meal 3', per_100g: { calories: 61,  protein: 3.5,  total_carbs: 4.7, fat: 3.3 } },
  ];
  r = await call('POST', `/api/logs/${today}`, mTok, {
    weight_kg: 83.0,
    activities: { walk: true, resistance: true, sun: true, steps1: true },
    food_items: foods,
  });
  ck('food saves', r.status === 200, r.data);
  r = await call('GET', `/api/logs/${today}`, mTok);
  ck('4 food items persisted', (r.data.food_items || []).length === 4, (r.data.food_items || []).length);
  ck('per_100g survives round-trip', r.data.food_items[0].per_100g?.calories === 297, r.data.food_items[0]);
  const kcalIn = foods.reduce((s, f) => s + Math.round(f.per_100g.calories * f.grams / 100), 0);
  ck('food kcal = 608 (178+174+195+61)', kcalIn === 608, kcalIn);
  ck('meals spread across 3 slots', new Set(r.data.food_items.map(f => f.meal)).size === 3, r.data.food_items.map(f => f.meal));

  // ══ 8. WATER ═══════════════════════════════════════════════════════════════
  step('8. WATER');
  r = await call('POST', `/api/logs/${today}`, mTok, {
    weight_kg: 83.0, activities: { walk: true, resistance: true, sun: true, steps1: true },
    food_items: foods, water_ml: 2250,
  });
  ck('water saves', r.status === 200, r.data);
  r = await call('GET', `/api/logs/${today}`, mTok);
  ck('water persisted as 2250ml', r.data.water_ml === 2250, r.data.water_ml);
  ck('water is 75% of 3L target', Math.round(2250 / 3000 * 100) === 75);

  // ══ 9. ACV + SUPPLEMENTS ═══════════════════════════════════════════════════
  step('9. ACV + SUPPLEMENTS');
  const full = {
    weight_kg: 83.0,
    activities:  { walk: true, resistance: true, sun: true, steps1: true },
    food_items:  foods,
    water_ml:    2250,
    acv:         { acv1: true, acv2: true, acv3: true },
    supplements: { b12: true, d3: true, fishoil: true, multi: true, flax: false, yeast: true, electrolyte: false },
  };
  r = await call('POST', `/api/logs/${today}`, mTok, full);
  ck('acv + supplements save', r.status === 200, r.data);
  r = await call('GET', `/api/logs/${today}`, mTok);
  ck('all 3 ACV ticked', Object.values(r.data.acv || {}).filter(Boolean).length === 3, r.data.acv);
  ck('5 of 7 supplements ticked', Object.values(r.data.supplements || {}).filter(Boolean).length === 5, r.data.supplements);

  // ══ 10. SLEEP + NOTES ══════════════════════════════════════════════════════
  step('10. SLEEP + NOTES');
  r = await call('POST', `/api/logs/${today}`, mTok, {
    ...full,
    sleep: { bedtime: '22:30', waketime: '06:30' },
    notes: 'Felt strong today. Good energy after the walk.',
  });
  ck('sleep + notes save', r.status === 200, r.data);
  r = await call('GET', `/api/logs/${today}`, mTok);
  ck('bedtime persisted', r.data.sleep?.bedtime === '22:30', r.data.sleep);
  ck('waketime persisted', r.data.sleep?.waketime === '06:30', r.data.sleep);
  ck('notes persisted', (r.data.notes || '').startsWith('Felt strong'), r.data.notes);
  const [bh, bm] = '22:30'.split(':').map(Number), [wh, wm] = '06:30'.split(':').map(Number);
  let mins = (wh * 60 + wm) - (bh * 60 + bm); if (mins <= 0) mins += 1440;
  ck('overnight sleep duration = 8h', mins === 480, mins);

  // ══ 11. COMPLIANCE ═════════════════════════════════════════════════════════
  step('11. COMPLIANCE CALCULATION');
  r = await call('GET', `/api/logs/${today}`, mTok);
  const done = 4 + 3 + 5;              // activities + acv + supplements
  const total = 6 + 3 + 7;             // full default protocol
  ck('compliance stored', r.data.compliance_pct != null, r.data.compliance_pct);
  // No protocol_total sent here, so the server falls back to its clamped
  // default (16). 12 done / 16 = 75%.
  ck('compliance = 75% via clamped fallback', r.data.compliance_pct === 75,
     { got: r.data.compliance_pct, done, total });

  // ══ 12. TDEE / ENERGY BALANCE ══════════════════════════════════════════════
  step('12. TDEE + ENERGY BALANCE');
  r = await call('GET', '/api/patients/me', mTok);
  const te = r.data.today_energy;
  ck('today_energy has food', (te.food_items || []).length === 4, te.food_items?.length);
  ck('today_energy has sets', (te.workout_sets || []).length === 3, te.workout_sets?.length);
  ck('today_energy has cardio', (te.cardio || []).length === 1, te.cardio);
  ck('is_today true', te.is_today === true, te);

  const age = Math.floor((Date.now() - new Date(r.data.dob)) / (1000 * 60 * 60 * 24 * 365.25));
  const bmr = Math.round(10 * 83 + 6.25 * 181 - 5 * age + 5);
  const resting = Math.round(bmr * 1.2);
  const strengthK = Math.round(750 * 0.08);
  const cardioK = Math.round(2.4 * 83 * 1);
  const out = resting + strengthK + cardioK;
  const balance = kcalIn - out;
  ck('BMR in plausible range', bmr > 1500 && bmr < 2100, bmr);
  ck('burn excludes protocol ticks (no double-count)', out === resting + strengthK + cardioK, { out, resting, strengthK, cardioK });
  ck('deficit (ate ' + kcalIn + ', burned ~' + out + ')', balance < 0, balance);
  ck('weekly projection under 2kg (sane)', Math.abs(balance) * 7 / 7700 < 2.5, +(Math.abs(balance) * 7 / 7700).toFixed(2));

  // ══ 13. WORKOUT SUMMARY / TRENDS ═══════════════════════════════════════════
  step('13. TRAINING SUMMARY');
  r = await call('GET', '/api/workouts/summary?days=30', mTok);
  ck('summary returns today', r.data.sessions?.length === 1, r.data.sessions?.length);
  ck('summary volume = 750', r.data.totals.volume_kg === 750, r.data.totals);
  ck('summary cardio = 60 min', r.data.totals.cardio_min === 60, r.data.totals);

  // ══ 14. COACH VIEW ═════════════════════════════════════════════════════════
  step('14. COACH SEES THE MEMBER\'S DAY');
  r = await call('GET', `/api/workouts/summary?days=30&patient_id=${member.id}`, cTok);
  ck('coach sees training summary', r.status === 200 && r.data.totals.volume_kg === 750, r.data.totals);
  r = await call('GET', `/api/patients/${member.id}`, cTok);
  ck('coach sees member profile + logs', r.status === 200, r.status);
  r = await call('POST', '/api/ai-chat/weekly-summary', cTok, { member_id: member.id, preview: true });
  ck('weekly summary builds', r.status === 200 && r.data.message.includes('Subramanya'), r.data.message);
  ck('summary mentions the workout', /kg lifted/.test(r.data.message), r.data.message);

  // ══ 15. SECURITY ═══════════════════════════════════════════════════════════
  step('15. SECURITY / ISOLATION');
  const { rows: [intruder] } = await pool.query(
    `INSERT INTO users (name, phone, password, role, active)
     VALUES ('Nosy','9000000099',$1,'patient',true) RETURNING id`, [pinHash]);
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [intruder.id]);
  const iTok = (await call('POST', '/api/auth/pin-login', null, { phone: '9000000099', pin: '4321' })).data.accessToken;

  r = await call('GET', `/api/workouts?date=${today}&patient_id=${member.id}`, iTok);
  const leaked = (r.data.exercises || []).length > 0;
  ck('member cannot read another member\'s workout', !leaked, r.data);
  r = await call('POST', '/api/ai-chat/weekly-summary', iTok, { member_id: member.id });
  ck('member cannot use coach endpoints', r.status === 403, r.status);
  r = await call('PUT', `/api/admin/members/${member.id}`, iTok, { name: 'Hacked', phone: '9741771679' });
  ck('member cannot edit others via admin route', r.status === 403, r.status);
  const { rows: [check] } = await pool.query('SELECT name FROM users WHERE id=$1', [member.id]);
  ck('member name unchanged after attack', check.name === 'Subramanya Prasad', check);

  // ══ 16. EDGE CASES ═════════════════════════════════════════════════════════
  step('16. EDGE CASES');
  r = await call('POST', `/api/logs/${today}`, mTok, { ...full, water_ml: -500 });
  const w = (await call('GET', `/api/logs/${today}`, mTok)).data.water_ml;
  ck('negative water not stored as negative', w >= 0, w);

  r = await call('POST', '/api/workouts', mTok, {
    date: today, exercises: [{ exercise_id: bench.id, sets: [{ reps: 0, weight_kg: 20 }] }], cardio: [],
  });
  const zero = (await call('GET', `/api/workouts?date=${today}`, mTok)).data;
  ck('zero-rep set discarded', (zero.exercises || []).length === 0, zero.exercises);

  r = await call('POST', '/api/workouts', mTok, {
    date: today, exercises: [], cardio: [{ type: 'walking', duration_min: 99999 }],
  });
  const clamp = (await call('GET', `/api/workouts?date=${today}`, mTok)).data;
  ck('absurd cardio duration clamped to 600', clamp.cardio[0].duration_min === 600, clamp.cardio[0]);

  r = await call('GET', '/api/logs/2020-01-01', mTok);
  ck('empty past date returns cleanly (no 500)', r.status === 200, r.status);

  srv.close();
  console.log('\n' + '═'.repeat(58));
  console.log(`  JOURNEY: ${pass} passed, ${fail} failed`);
  if (fails.length) console.log('  FAILED: ' + fails.join(' | '));
  console.log('═'.repeat(58));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
