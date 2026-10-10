/**
 * scripts/test-sleep-target.js — a member's own bedtime and wake time.
 *
 * Every member was shown one hard-coded sleep target (10:00 PM → 6:30 AM,
 * labelled "8 h" though the two times are eight and a half hours apart). The
 * coach now sets the two times per member; the member's Plan and sleep sheet
 * read them. This suite is the server half: the two columns, the coach's
 * route that writes them, who may call it, and that both places the member's
 * app reads from carry them.
 *
 * Real Postgres, real routes over real HTTP. The client half (the wording, the
 * worked-out hours, the coach's card) is in test-day-lib.js and ui-tests.mjs.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q, _r, n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/patients', require('../routes/patients'));
app.use('/api/logs',     require('../routes/logs'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n))
                            : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e === undefined ? '' : e).slice(0, 240))); };

(async () => {
  const mk = async (name, phone, role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, phone, role])).rows[0].id;
  // Unique phones so the suite can run after any other without a wipe.
  const tag = String(Date.now()).slice(-7);
  const coach  = await mk('Coach One', `71${tag}1`, 'monitor');
  const coach2 = await mk('Coach Two', `71${tag}2`, 'monitor');
  const admin  = await mk('Admin',     `71${tag}3`, 'admin');
  const member = await mk('Asha Rao',  `71${tag}4`, 'patient');
  const other  = await mk('Other',     `71${tag}5`, 'patient');
  await pool.query(`INSERT INTO patient_profiles (user_id, height_cm, water_target) VALUES ($1,160,3500), ($2,170,3000)`, [member, other]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true)`, [coach, member]);

  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u, r) => jwt.sign({ id: u, role: r, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const call = async (method, path, t, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const C = tok(coach, 'monitor'), M = tok(member, 'patient');
  const patch = (body, t = C, id = member) => call('PATCH', `/api/patients/${id}/profile`, t, body);
  const stored = async (id = member) => (await pool.query(`SELECT sleep_bed, sleep_wake, water_target FROM patient_profiles WHERE user_id=$1`, [id])).rows[0];
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  console.log('\n[1] the columns');
  {
    const { rows } = await pool.query(
      `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
         FROM information_schema.columns WHERE table_name='patient_profiles' AND column_name IN ('sleep_bed','sleep_wake') ORDER BY 1`);
    ck('patient_profiles has sleep_bed and sleep_wake, 5 characters, empty by default',
       rows.length === 2 && rows.every(r => r.data_type === 'character varying' && r.character_maximum_length === 5 && r.is_nullable === 'YES' && r.column_default === null), rows);
    ck('a member nobody has set a target for has neither', (await stored()).sleep_bed === null && (await stored()).sleep_wake === null);
  }

  console.log('\n[2] before the coach sets anything, the member\'s app is told "not set"');
  {
    const log = await call('GET', `/api/logs/${today}`, M);
    ck('the day\'s protocol carries sleep_bed and sleep_wake as null (the app then shows the standard times)',
       log.status === 200 && log.data.protocol && log.data.protocol.sleep_bed === null && log.data.protocol.sleep_wake === null
       && 'sleep_bed' in log.data.protocol, log.data.protocol && [log.data.protocol.sleep_bed, log.data.protocol.sleep_wake]);
    const plan = await call('GET', '/api/patients/me/today', M);
    ck('the Plan payload carries them as null too', plan.status === 200 && plan.data.profile.sleep_bed === null && plan.data.profile.sleep_wake === null, plan.data.profile && [plan.data.profile.sleep_bed]);
  }

  console.log('\n[3] the coach sets a member\'s own times');
  {
    const r = await patch({ sleep_bed: '23:30', sleep_wake: '05:30' });
    ck('saved, and the response carries the new times', r.status === 200 && r.data.sleep_bed === '23:30' && r.data.sleep_wake === '05:30', [r.status, r.data.sleep_bed, r.data.sleep_wake, r.data.error]);
    const s = await stored();
    ck('stored as typed', s.sleep_bed === '23:30' && s.sleep_wake === '05:30', s);
    ck('nothing else on the profile moved (water target is still 3500)', s.water_target === 3500, s.water_target);
    const log = await call('GET', `/api/logs/${today}`, M);
    ck('the member\'s day now carries 23:30 and 05:30', log.data.protocol.sleep_bed === '23:30' && log.data.protocol.sleep_wake === '05:30', log.data.protocol);
    const plan = await call('GET', '/api/patients/me/today', M);
    ck('and so does their Plan', plan.data.profile.sleep_bed === '23:30' && plan.data.profile.sleep_wake === '05:30', [plan.data.profile.sleep_bed, plan.data.profile.sleep_wake]);
    ck('another member is untouched', (await stored(other)).sleep_bed === null);
    const w = await patch({ water_target: 4000 });
    ck('changing only the water target leaves the sleep times alone', w.status === 200 && (await stored()).sleep_bed === '23:30' && (await stored()).water_target === 4000, await stored());
    const secs = await patch({ sleep_bed: '22:15:00', sleep_wake: '06:15:00' });
    ck('times with seconds (as a database or some phones send them) are stored as HH:MM', secs.status === 200 && (await stored()).sleep_bed === '22:15' && (await stored()).sleep_wake === '06:15', [secs.status, await stored()]);
    await patch({ sleep_bed: '23:30', sleep_wake: '05:30' });
  }

  console.log('\n[4] what is refused, and that a refusal changes nothing');
  {
    const bad = async (label, body, re) => {
      const r = await patch(body); const s = await stored();
      ck(label, r.status === 400 && re.test(r.data.error || '') && s.sleep_bed === '23:30' && s.sleep_wake === '05:30', [r.status, r.data.error, s]);
    };
    await bad('only a bedtime → refused: the two only mean something together', { sleep_bed: '22:00' }, /together/);
    await bad('only a wake time → refused', { sleep_wake: '06:00' }, /together/);
    await bad('one set and one blank → refused', { sleep_bed: '22:00', sleep_wake: '' }, /time like 22:30/);
    await bad('"10pm" is not a time', { sleep_bed: '10pm', sleep_wake: '06:00' }, /time like 22:30/);
    await bad('"24:00" is not a time', { sleep_bed: '24:00', sleep_wake: '06:00' }, /time like 22:30/);
    await bad('"9:5" is not a time', { sleep_bed: '9:5', sleep_wake: '06:00' }, /time like 22:30/);
    await bad('11 PM to 2 AM is 3 hours — a slipped AM/PM, refused with the hours named', { sleep_bed: '23:00', sleep_wake: '02:00' }, /That is 3 hours of sleep.*between 4 and 12/);
    await bad('8 PM to 9 AM is 13 hours — refused', { sleep_bed: '20:00', sleep_wake: '09:00' }, /That is 13 hours of sleep/);
    await bad('the same time twice reads as 24 hours — refused', { sleep_bed: '22:00', sleep_wake: '22:00' }, /That is 24 hours/);
    await bad('10 PM to 6:30 PM (PM chosen by mistake) is 20.5 hours — refused', { sleep_bed: '22:00', sleep_wake: '18:30' }, /That is 20\.5 hours/);
    const four = await patch({ sleep_bed: '23:00', sleep_wake: '03:00' });
    ck('exactly 4 hours is allowed', four.status === 200 && (await stored()).sleep_wake === '03:00', [four.status, four.data.error]);
    const twelve = await patch({ sleep_bed: '20:00', sleep_wake: '08:00' });
    ck('exactly 12 hours is allowed', twelve.status === 200 && (await stored()).sleep_bed === '20:00', [twelve.status, twelve.data.error]);
    const justUnder = await patch({ sleep_bed: '23:00', sleep_wake: '02:59' });
    ck('3 h 59 min is not', justUnder.status === 400, justUnder.status);
    const justOver = await patch({ sleep_bed: '20:00', sleep_wake: '08:01' });
    ck('12 h 1 min is not', justOver.status === 400, justOver.status);
    const day = await patch({ sleep_bed: '08:00', sleep_wake: '15:30' });
    ck('a night-shift worker\'s daytime sleep (8:00 AM → 3:30 PM) is fine', day.status === 200 && (await stored()).sleep_bed === '08:00', [day.status, day.data.error]);
  }

  console.log('\n[5] back to the standard times');
  {
    await patch({ sleep_bed: '23:30', sleep_wake: '05:30' });
    const r = await patch({ sleep_bed: null, sleep_wake: null });
    const s = await stored();
    ck('both sent as null → both cleared', r.status === 200 && s.sleep_bed === null && s.sleep_wake === null, [r.status, s]);
    ck('…and the water target set earlier is still there', s.water_target === 4000, s.water_target);
    await patch({ sleep_bed: '23:30', sleep_wake: '05:30' });
    const e = await patch({ sleep_bed: '', sleep_wake: '' });
    ck('both sent blank → both cleared', e.status === 200 && (await stored()).sleep_bed === null, [e.status, await stored()]);
    const log = await call('GET', `/api/logs/${today}`, M);
    ck('the member is back to "not set"', log.data.protocol.sleep_bed === null && log.data.protocol.sleep_wake === null, log.data.protocol);
  }

  console.log('\n[6] who may set it');
  {
    const body = { sleep_bed: '21:00', sleep_wake: '05:00' };
    const a = await patch(body, tok(coach2, 'monitor'));
    ck('a coach the member is not assigned to → refused', a.status === 403 && (await stored()).sleep_bed === null, [a.status, await stored()]);
    const b = await patch(body, M);
    ck('the member themselves → refused (the coach sets the plan)', b.status === 403 && (await stored()).sleep_bed === null, b.status);
    const c = await patch(body, tok(other, 'patient'));
    ck('another member → refused', c.status === 403, c.status);
    const d = await patch(body, null);
    ck('nobody signed in → refused', d.status === 401, d.status);
    const e = await patch(body, tok(admin, 'admin'));
    ck('an admin → allowed', e.status === 200 && (await stored()).sleep_bed === '21:00', [e.status, e.data.error]);
    const f = await patch(body, C, other);
    ck('the assigned coach cannot reach across to someone else\'s member', f.status === 403 && (await stored(other)).sleep_bed === null, f.status);
  }

  srv.close();
  await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[coach, coach2, admin, member, other]]);
  console.log(`\n═══ SLEEP TARGET: ${pass} passed, ${fail} failed ═══`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
