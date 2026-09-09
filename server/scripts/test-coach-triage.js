/**
 * scripts/test-coach-triage.js — GET /members/triage (Sprint 8), against real
 * Postgres. Six members seeded into six situations; each must land in exactly
 * the bucket a coach would put them in, with the reason line and the action
 * that follow. Then the pure composer is pinned directly.
 *
 * Refuses to run unless DATABASE_URL is localhost (this suite writes).
 */
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const { composeMember, summarise, sleepMinutes } = require('../services/triage');
const { NEVER_LOGGED } = require('../services/gapDetector');

if (!/localhost/.test(process.env.DATABASE_URL || '')) { console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1); }

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q,_r,n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/members', require('../routes/patients'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n)) : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e === undefined ? '' : e).slice(0, 240))); };
const IST = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600000 - offsetDays * 86400000).toISOString().slice(0, 10);

(async () => {
  const SECRET = process.env.JWT_SECRET || 'local-test-secret';
  await pool.query(`DELETE FROM users WHERE phone LIKE '9000009%' OR email LIKE 'triage-%'`);
  const { rows: [coach] } = await pool.query(`INSERT INTO users (name, email, password, role, active) VALUES ('Triage Coach','triage-coach@x.test','x','monitor',true) RETURNING id`);
  const mk = async (name, phone) => {
    const { rows: [u] } = await pool.query(`INSERT INTO users (name, phone, password, role, active) VALUES ($1,$2,'x','patient',true) RETURNING id`, [name, phone]);
    await pool.query(`INSERT INTO patient_profiles (user_id, water_target, protocol_activities, protocol_acv, protocol_supplements) VALUES ($1, 3000, '["walk"]', '["acv1"]', '["b12"]')`, [u.id]);
    await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true)`, [coach.id, u.id]);
    return u.id;
  };
  const log = (id, daysAgo, o = {}) => pool.query(
    `INSERT INTO daily_logs (patient_id, log_date, weight_kg, food_items, water_ml, activities, acv, supplements, sleep, compliance_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, IST(daysAgo), o.w ?? null, JSON.stringify(o.food || []), o.water ?? 0, JSON.stringify(o.act || {}), JSON.stringify(o.acv || {}), JSON.stringify(o.sup || {}), JSON.stringify(o.sleep || {}), o.pct ?? 0]);
  const full = (w, sleep = { bedtime: '22:30', waketime: '06:30' }) => ({ w, food: [{ name: 'idli', meal: 'Meal 1' }, { name: 'dal', meal: 'Meal 2' }], water: 2800, act: { walk: true }, acv: { acv1: true }, sup: { b12: true }, sleep, pct: 90 });

  const never   = await mk('Never Logged',  '9000009001');
  const quiet   = await mk('Quiet Five',    '9000009002');
  const star    = await mk('Asha Star',     '9000009003');
  const gaining = await mk('Vishwas Gain',  '9000009004');
  const sleepy  = await mk('Daya Sleepy',   '9000009005');
  const today0  = await mk('Bujju Blank',   '9000009006');

  await log(quiet, 5, full(80)); await log(quiet, 6, full(80.2));
  for (let i = 0; i < 8; i++) await log(star, i, full(84 + i * 0.15));                          // 8-day streak, older days heavier → down ~1 kg
  for (let i = 0; i < 13; i += 2) await log(gaining, i, full(70 + (12 - i) * 0.15));            // every other day, older days lighter → up 1.8 kg
  for (let i = 1; i < 8; i++) await log(sleepy, i, full(75, { bedtime: '22:30', waketime: '06:30' }));
  await log(sleepy, 0, full(75, { bedtime: '01:00', waketime: '06:00' }));                        // 5h vs 8h → down 3 h
  await pool.query(`INSERT INTO monitor_notes (monitor_id, patient_id, note, note_date, from_member) VALUES ($1,$2,'Can I skip ACV today?',$3,true)`, [coach.id, sleepy, IST(0)]);
  await log(today0, 1, full(90)); await log(today0, 2, full(90));                                 // yesterday yes, today nothing

  const tok = jwt.sign({ id: coach.id, role: 'monitor', name: 'Triage Coach' }, SECRET);
  const srv = app.listen(0); const port = srv.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/members/triage`, { headers: { Authorization: 'Bearer ' + tok } });
  const body = await res.json();
  const by = Object.fromEntries((body.members || []).map(m => [m.name, m]));

  console.log('\n[1] route');
  ck('200 with members, counts, today', res.status === 200 && Array.isArray(body.members) && body.counts && /^\d{4}-\d{2}-\d{2}$/.test(body.today), [res.status, body.error]);
  ck('exactly the coach\'s six members', body.members.length === 6, body.members.map(m => m.name));
  ck('header counts add up', body.counts.total === 6 && body.counts.on_track + body.counts.watch + body.counts.attention + body.counts.high === 6, body.counts);

  console.log('\n[2] buckets, reasons, actions');
  ck('never logged → high · "Never logged" · Help them start', by['Never Logged'].priority === 'high' && by['Never Logged'].reasons[0] === 'Never logged' && by['Never Logged'].action.key === 'onboard', by['Never Logged']);
  ck('quiet 5 days → high · "Quiet 5 days" · Send a nudge', by['Quiet Five'].priority === 'high' && by['Quiet Five'].reasons[0] === 'Quiet 5 days' && by['Quiet Five'].action.key === 'nudge', by['Quiet Five']);
  const star8 = by['Asha Star'];
  ck('the star → ok · 8-day streak + weight down + logged every day · Send praise', star8.priority === 'ok' && star8.reasons.length === 0 && star8.wins.includes('8-day streak') && star8.wins.some(w => /^Down 1\.\d kg/.test(w)) && star8.wins.includes('Logged every day this week') && star8.action.key === 'praise', star8);
  ck('week strip: seven dots, all on for the star', star8.week.length === 7 && star8.logged_days === 7);
  const g = by['Vishwas Gain'];
  ck('weight up 1.8 kg over two weeks → attention · Review meals (even though today is logged)', g.priority === 'attention' && g.reasons.some(r => /Weight up 1\.8 kg/.test(r)) && g.action.key === 'review', g);
  const d = by['Daya Sleepy'];
  ck('sleep down 3 h + 1 unread → attention, both reasons, Reply first', d.priority === 'attention' && d.reasons.some(r => /Sleep down 3\.\d h|Sleep down 3 h/.test(r)) && d.reasons.some(r => /1 unread message/.test(r)) && d.action.key === 'reply' && d.unread === 1, d);
  const b = by['Bujju Blank'];
  const hour = parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }), 10) % 24;
  ck('nothing today (after the gap detector\'s hour gate) → attention · Check in; before it → ok', hour >= 11 ? (b.priority === 'attention' && b.reasons[0] === 'Nothing logged today' && b.action.key === 'checkin') : (b.priority === 'ok'), [hour, b]);
  ck('sorted worst first: the two high members lead, the star is last', body.members[0].priority === 'high' && body.members[1].priority === 'high' && body.members[body.members.length - 1].name === 'Asha Star', body.members.map(m => m.name + ':' + m.priority));
  ck('per-member: last_logged, latest_weight, streak, days_since_log', star8.last_logged === IST(0) && star8.latest_weight === 84 && star8.streak === 8 && by['Quiet Five'].days_since_log === 5 && by['Never Logged'].days_since_log === null, [star8.last_logged, star8.latest_weight, star8.streak]);

  console.log('\n[3] pure composer');
  const base = { logs: [], protocol: {}, daysSince: NEVER_LOGGED, todayDay: null, workoutLoggedToday: false, streak: 0, unread: 0, todayStr: IST(0), hour: 20 };
  const m = { id: 1, name: 'X', phone: '9' };
  ck('sleepMinutes crosses midnight', sleepMinutes({ bedtime: '23:30', waketime: '06:00' }) === 390 && sleepMinutes({ bedtime: '01:00', waketime: '06:00' }) === 300 && sleepMinutes({}) === null);
  const planned = composeMember(m, { ...base, daysSince: 0, todayDay: { day_label: 'Push · Mon' }, hour: 20,
    logs: [{ log_date: IST(0), weight_kg: 80, food_items: [{ name: 'x', meal: 'Meal 1' }], water_ml: 2800, activities: { walk: true }, acv: { acv1: true }, supplements: { b12: true }, sleep: {} }] });
  ck('planned workout not logged by evening → "Missed workout" · Nudge workout', planned.reasons.includes('Missed workout') && planned.action.key === 'nudge' && planned.workout_today?.logged === false, planned);
  const done = composeMember(m, { ...base, daysSince: 0, todayDay: { day_label: 'Push · Mon' }, workoutLoggedToday: true, hour: 20,
    logs: [{ log_date: IST(0), weight_kg: 80, food_items: [{ name: 'x', meal: 'Meal 1' }], water_ml: 2800, activities: { walk: true }, acv: { acv1: true }, supplements: { b12: true }, sleep: {} }] });
  ck('same day with the workout logged → no reason, Open', done.reasons.length === 0 && done.action.key === 'open', done);
  const morning = composeMember(m, { ...base, daysSince: 0, todayDay: { day_label: 'Push · Mon' }, hour: 9, logs: [{ log_date: IST(0), weight_kg: 80, food_items: [], water_ml: 0, sleep: {} }] });
  ck('at 09:00 nothing is nagged: no "Missed workout", no food gap', !morning.reasons.includes('Missed workout') && !morning.reasons.includes('No food log'), morning.reasons);
  const s2 = summarise([{ priority: 'ok', name: 'b' }, { priority: 'high', name: 'a' }, { priority: 'watch', name: 'c' }]);
  ck('summarise sorts high → attention → watch → ok and counts', s2.members.map(x => x.name).join('') === 'acb' && s2.counts.high === 1 && s2.counts.on_track === 1 && s2.counts.watch === 1);

  srv.close();
  await pool.query(`DELETE FROM users WHERE phone LIKE '9000009%' OR email LIKE 'triage-%'`);
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
