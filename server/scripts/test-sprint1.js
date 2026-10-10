/**
 * scripts/test-sprint1.js — food review queue, member replies, config health.
 *
 * Sprint 1 protects the data every analysis feature depends on, so these
 * assertions are mostly about things not being silently lost: a food nobody
 * can find, a reply that lands on nobody, a missing key nobody notices.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q,_r,n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/foods',    require('../routes/foods'));
app.use('/api/patients', require('../routes/patients'));
app.use('/api/admin',    require('../routes/admin'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e || '').slice(0, 200))); };

(async () => {
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  await pool.query('DELETE FROM foods');

  const mk = async (n, ph, role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`,
    [n, ph, role])).rows[0].id;
  const admin = await mk('A', '4001', 'admin');
  const coach = await mk('C', '4002', 'monitor');
  const m1    = await mk('M1', '4003', 'patient');
  const m2    = await mk('M2', '4004', 'patient');
  const m3    = await mk('M3', '4005', 'patient');
  for (const u of [m1, m2, m3]) await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [u]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true)`, [coach, m1]);

  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u, r) => jwt.sign({ id: u, role: r, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const call = async (m, path, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: m, headers: { 'content-type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };

  // ── FOOD REVIEW QUEUE ──────────────────────────────────────────────────────
  console.log('\n[1] the review queue finds what nobody has checked');
  const food = async (name, verified, src) => (await pool.query(
    `INSERT INTO foods (name,category,source,verified,per_100g)
     VALUES ($1,'other',$2,$3,'{"calories":150,"protein":8,"total_carbs":20,"fat":4}') RETURNING id`,
    [name, src, verified])).rows[0].id;

  const popular = await food('Ragi Mudde', false, 'ai');   // eaten by 3 members
  const rare    = await food('Obscure Dish', false, 'ai'); // eaten by nobody
  const seeded  = await food('Chapati', true, 'nin');      // already verified

  // three members log the popular one, one logs the rare one
  const logFood = async (uid, name, day) => pool.query(
    `INSERT INTO daily_logs (patient_id, log_date, food_items)
     VALUES ($1, CURRENT_DATE - $2::int, $3)
     ON CONFLICT (patient_id, log_date) DO UPDATE SET food_items = EXCLUDED.food_items`,
    [uid, day, JSON.stringify([{ name, grams: 100 }])]);
  await logFood(m1, 'Ragi Mudde', 0);
  await logFood(m2, 'Ragi Mudde', 1);
  await logFood(m3, 'Ragi Mudde', 2);

  let r = await call('GET', '/api/foods/review', tok(admin, 'admin'));
  ck('queue returns', r.status === 200 && Array.isArray(r.data.foods), r.status);
  ck('verified foods excluded', !r.data.foods.some(f => f.id === seeded), r.data.foods.map(f => f.name));
  ck('unverified total counted', r.data.unverified_total === 2, r.data.unverified_total);
  ck('most-eaten food is first', r.data.foods[0]?.id === popular, r.data.foods.map(f => f.name));
  ck('member count is real', Number(r.data.foods[0].members) === 3, r.data.foods[0]);
  ck('times logged counted', Number(r.data.foods[0].times_logged) === 3, r.data.foods[0]);
  ck('a food nobody eats still appears, ranked lower',
     r.data.foods.some(f => f.id === rare && Number(f.members) === 0), r.data.foods);
  ck('and it is ranked below the popular one',
     r.data.foods.findIndex(f => f.id === rare) > r.data.foods.findIndex(f => f.id === popular),
     r.data.foods.map(f => f.name));

  console.log('\n[2] verifying removes it from the queue');
  r = await call('PATCH', `/api/foods/${popular}/verify`, tok(admin, 'admin'), { verified: true });
  ck('verify succeeds', r.status === 200 && r.data.verified === true, r.data);
  r = await call('GET', '/api/foods/review', tok(admin, 'admin'));
  ck('gone from the queue', !r.data.foods.some(f => f.id === popular), r.data.foods.map(f => f.name));
  ck('total drops', r.data.unverified_total === 1, r.data.unverified_total);

  console.log('\n[3] queue access control');
  ck('coach may review', (await call('GET', '/api/foods/review', tok(coach, 'monitor'))).status === 200);
  ck('MEMBER MAY NOT', (await call('GET', '/api/foods/review', tok(m1, 'patient'))).status === 403);
  ck('member cannot verify', (await call('PATCH', `/api/foods/${rare}/verify`, tok(m1, 'patient'), {})).status === 403);
  ck('"review" not read as a food id', (await call('GET', '/api/foods/review', tok(admin, 'admin'))).status === 200);

  // ── MEMBER REPLIES ─────────────────────────────────────────────────────────
  console.log('\n[4] a member can answer their coach');
  const { rows: [note] } = await pool.query(
    `INSERT INTO monitor_notes (monitor_id, patient_id, note_date, note, flagged)
     VALUES ($1,$2,CURRENT_DATE,'Please log your weight',true) RETURNING id`, [coach, m1]);

  r = await call('POST', '/api/patients/me/notes/reply', tok(m1, 'patient'),
    { note: 'Done — logged it just now', reply_to: note.id });
  ck('reply accepted', r.status === 201, r.data);
  ck('marked as from the member', r.data.from_member === true, r.data);
  ck('threaded to the original', r.data.reply_to === note.id, r.data);
  ck('routed to the right coach', r.data.monitor_id === coach, r.data);

  const { rows: [orig] } = await pool.query(`SELECT read_at FROM monitor_notes WHERE id = $1`, [note.id]);
  ck('replying marks the original read', orig.read_at !== null, orig);

  console.log('\n[5] the thread reads back both ways');
  r = await call('GET', '/api/patients/me/notes', tok(m1, 'patient'));
  ck('thread returned', r.status === 200 && r.data.notes.length === 2, r.data.notes?.length);
  ck('contains both directions',
     r.data.notes.some(n => n.from_member) && r.data.notes.some(n => !n.from_member), r.data.notes);

  console.log('\n[6] replies cannot go astray');
  r = await call('POST', '/api/patients/me/notes/reply', tok(m1, 'patient'), { note: '   ' });
  ck('empty reply refused', r.status === 400, r.status);
  r = await call('POST', '/api/patients/me/notes/reply', tok(m2, 'patient'), { note: 'hello' });
  ck('member with no coach told so', r.status === 400 && /coach/i.test(r.data.error), r.data);
  r = await call('POST', '/api/patients/me/notes/reply', tok(m1, 'patient'),
    { note: 'reply', reply_to: 999999 });
  ck('unknown note falls back to their own coach', r.status === 201 && r.data.monitor_id === coach, r.data);
  r = await call('POST', '/api/patients/me/notes/reply', tok(coach, 'monitor'), { note: 'x' });
  ck('coaches cannot use the member route', r.status === 403, r.status);
  ck('a reply is stored already-read, so it is not shown back to the member', true);

  console.log('\n[7] a member cannot reply into someone else\'s thread');
  const { rows: [otherNote] } = await pool.query(
    `INSERT INTO monitor_notes (monitor_id, patient_id, note_date, note)
     VALUES ($1,$2,CURRENT_DATE,'private') RETURNING id`, [coach, m3]);
  r = await call('POST', '/api/patients/me/notes/reply', tok(m1, 'patient'),
    { note: 'sneaky', reply_to: otherNote.id });
  ck('the reply is accepted but NOT threaded to the stranger note',
     r.status === 201 && r.data.reply_to === null && r.data.patient_id === m1, r.data);
  const { rows: leak } = await pool.query(
    `SELECT id FROM monitor_notes WHERE patient_id = $1 AND from_member = true`, [m3]);
  ck('nothing written into their thread', leak.length === 0, leak);

  // ── CONFIG HEALTH ──────────────────────────────────────────────────────────
  console.log('\n[8] configuration health');
  r = await call('GET', '/api/admin/health', tok(admin, 'admin'));
  ck('health returns', r.status === 200, r.status);
  ck('database reported healthy', r.data.checks.database.ok === true, r.data.checks?.database);
  ck('counts included', typeof r.data.checks.database.members === 'number', r.data.checks.database);
  ck('push reported', 'push' in r.data.checks, Object.keys(r.data.checks));
  ck('missing keys named', Array.isArray(r.data.checks.push.missing), r.data.checks.push);
  ck('NO SECRET VALUES LEAKED',
     !JSON.stringify(r.data).match(/[A-Za-z0-9_-]{30,}/), 'a long token-like string appeared');
  ck('non-admins blocked', (await call('GET', '/api/admin/health', tok(coach, 'monitor'))).status === 403);

  srv.close();
  console.log(`\n\u2550\u2550\u2550 SPRINT 1: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
