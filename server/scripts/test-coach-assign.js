/**
 * scripts/test-coach-assign.js — a member may not be handed to a disabled coach.
 *
 * A member assigned to a disabled account sits on a roster nobody reads. They
 * are never chased, they never appear in anyone's "needs a nudge" list, and
 * nothing on the members page explains why — it looks like the gap detector is
 * broken rather than like the assignment is.
 *
 * The dropdown is filtered in the client, but that is not the guard: a PWA
 * whose service worker has not updated still holds the old option list, and the
 * endpoint is reachable directly. This asserts the SERVER refuses it, on both
 * paths that can create an assignment.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use('/api/admin', require('../routes/admin'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 200))); };

(async () => {
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (name, phone, role, active = true) => (await pool.query(
    `INSERT INTO users (name,phone,email,password,role,active)
     VALUES ($1,$2,$3,'x',$4,$5) RETURNING id`,
    [name, phone, `${phone}@t.test`, role, active])).rows[0].id;

  const admin    = await mk('Sachin', '4001', 'admin');
  const liveCoach = await mk('Veeru', '4002', 'monitor');
  const deadCoach = await mk('Sachin', '4003', 'admin', false);   // same display name, disabled
  const member    = await mk('Asha', '4004', 'patient');
  await pool.query(
    `INSERT INTO patient_profiles (user_id, water_target) VALUES ($1, 3000)`, [member]);

  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const srv = app.listen(0); const port = srv.address().port;
  const call = async (method, path, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const assignedTo = async (pid) => (await pool.query(
    `SELECT monitor_id FROM monitor_patients WHERE patient_id=$1 AND active=true`, [pid])).rows;

  console.log('\n[1] reassigning an existing member');
  {
    let r = await call('POST', '/api/admin/assign', tok(admin, 'admin'),
      { monitor_id: deadCoach, patient_id: member });
    ck('a disabled coach is refused', r.status === 400, r.status);
    ck('and the message names them and says what to do',
      /disabled/i.test(r.data.error || '') && /Sachin/.test(r.data.error || ''), r.data.error);
    ck('nothing was written', (await assignedTo(member)).length === 0);

    r = await call('POST', '/api/admin/assign', tok(admin, 'admin'),
      { monitor_id: liveCoach, patient_id: member });
    ck('an active coach is accepted', r.status === 200, r.data);
    ck('and the member lands on their roster',
      (await assignedTo(member))[0]?.monitor_id === liveCoach);

    r = await call('POST', '/api/admin/assign', tok(admin, 'admin'),
      { monitor_id: 999999, patient_id: member });
    ck('an id that does not exist is refused too', r.status === 400, r.status);
    ck('the existing assignment survives a refused change',
      (await assignedTo(member))[0]?.monitor_id === liveCoach);

    r = await call('POST', '/api/admin/assign', tok(admin, 'admin'),
      { monitor_id: member, patient_id: member });
    ck('a member cannot be made their own coach', r.status === 400, r.status);
  }

  console.log('\n[2] creating a member with a coach');
  {
    const before = (await pool.query('SELECT COUNT(*)::int n FROM users')).rows[0].n;
    let r = await call('POST', '/api/admin/members', tok(admin, 'admin'), {
      name: 'New Person', phone: '4009', pin: '1234', monitor_id: deadCoach });
    ck('creating against a disabled coach is refused', r.status === 400, r.status);

    // The whole create runs in a transaction, so a refused assignment must not
    // leave a half-made member behind with no coach and no profile.
    const after = (await pool.query('SELECT COUNT(*)::int n FROM users')).rows[0].n;
    ck('and no half-created member is left behind', after === before, { before, after });

    r = await call('POST', '/api/admin/members', tok(admin, 'admin'), {
      name: 'New Person', phone: '4009', pin: '1234', monitor_id: liveCoach });
    ck('creating against an active coach works', r.status === 200 || r.status === 201, r.status);
  }

  srv.close();
  console.log(`\n${fail === 0 ? '✅' : '❌'} test-coach-assign: ${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
