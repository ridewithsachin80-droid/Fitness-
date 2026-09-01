/**
 * scripts/test-nudges.js — did the nudge work? (Sprint L2)
 *
 * The thing this suite exists to protect is the REFUSAL. Below 20 sends in a
 * bucket the API must not return a percentage at all — not a rounded one, not a
 * hedged one. Two responses out of three is not 67%, and this codebase already
 * refuses to claim thin effects in the adaptive engine and the learning model.
 * A nudge dashboard quoting confident numbers off five data points would undo
 * that everywhere else, and it would do it silently.
 *
 * Also covered:
 *   · reconciliation only credits a log that came AFTER the message and inside
 *     the window — the failure mode here is generous matching, which inflates
 *     every rate on the screen and nobody would ever notice
 *   · it is idempotent, because it runs nightly on overlapping windows
 *   · the retention sweep does not delete the evidence (a 30-day sweep would
 *     have quietly starved this feature forever)
 *   · /gaps/effectiveness is not swallowed by /:id
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const nudges = require('../services/nudgeTracking');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use('/api/members', require('../routes/patients'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 200))); };

/** Insert a nudge at a chosen time in the past, so windows can be exercised. */
async function nudgeAt(memberId, coachId, gapKey, channel, hoursAgo) {
  const { rows } = await pool.query(
    `INSERT INTO notifications_log (user_id, type, title, body, gap_key, channel, sent_by, sent_at)
     VALUES ($1,'coach_nudge','Coach nudge','x',$2,$3,$4, NOW() - ($5 || ' hours')::interval)
     RETURNING id, sent_at`,
    [memberId, gapKey, channel, coachId, hoursAgo]);
  return rows[0];
}

/** A daily-log save at a chosen time. */
async function logAt(memberId, dayOffset, hoursAgo) {
  await pool.query(
    `INSERT INTO daily_logs (patient_id, log_date, water_ml, saved_at)
     VALUES ($1, (CURRENT_DATE - $2::int), 500, NOW() - ($3 || ' hours')::interval)
     ON CONFLICT (patient_id, log_date)
     DO UPDATE SET saved_at = EXCLUDED.saved_at`,
    [memberId, dayOffset, hoursAgo]);
}

(async () => {
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (name, phone, role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`,
    [name, phone, role])).rows[0].id;

  const coach  = await mk('Sachin', '6001', 'monitor');
  const coach2 = await mk('Other Coach', '6002', 'monitor');
  const admin  = await mk('Admin', '6003', 'admin');
  const m1 = await mk('Asha',  '6101', 'patient');
  const m2 = await mk('Bujju', '6102', 'patient');
  for (const m of [m1, m2]) {
    await pool.query(
      `INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true)`,
      [coach, m]);
  }

  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const srv = app.listen(0); const port = srv.address().port;
  const call = async (method, path, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const clear = () => pool.query('DELETE FROM notifications_log');

  // ── 1. Recording ───────────────────────────────────────────────────────────
  console.log('\n[1] recording a nudge');
  {
    await clear();
    const id = await nudges.recordNudge({ memberId: m1, coachId: coach, gapKey: 'water', channel: 'whatsapp', body: 'pani piyo' });
    ck('a nudge is stored', Number.isFinite(id), id);

    const { rows } = await pool.query('SELECT * FROM notifications_log WHERE id = $1', [id]);
    ck('against the member, not the coach', rows[0].user_id === m1, rows[0].user_id);
    ck('the coach is recorded separately', rows[0].sent_by === coach, rows[0].sent_by);
    ck('with the gap that prompted it', rows[0].gap_key === 'water', rows[0].gap_key);
    ck('and the channel', rows[0].channel === 'whatsapp', rows[0].channel);
    ck('responded_at starts null', rows[0].responded_at === null, rows[0].responded_at);

    ck('an unknown channel is refused, not stored as junk',
      await nudges.recordNudge({ memberId: m1, coachId: coach, gapKey: 'water', channel: 'carrier pigeon' }) === null);
    ck('a missing gap key is refused',
      await nudges.recordNudge({ memberId: m1, coachId: coach, gapKey: '', channel: 'sms' }) === null);
    ck('a missing member is refused',
      await nudges.recordNudge({ memberId: null, coachId: coach, gapKey: 'water', channel: 'sms' }) === null);
  }

  // ── 2. Reconciliation ──────────────────────────────────────────────────────
  // The dangerous direction is generous matching. Every one of these asserts a
  // log that must NOT count, because that is the failure that silently inflates
  // every percentage on the coach's screen.
  console.log('\n[2] which logs count as a response');
  {
    await clear();
    await pool.query('DELETE FROM daily_logs');

    // Sent 10h ago, member logged 5h ago -> counts.
    const responded = await nudgeAt(m1, coach, 'water', 'whatsapp', 10);
    await logAt(m1, 0, 5);

    // Sent 10h ago, member's only log was 20h ago (BEFORE it) -> must not count.
    const beforeOnly = await nudgeAt(m2, coach, 'water', 'whatsapp', 10);
    await logAt(m2, 1, 20);

    let r = await nudges.reconcileResponses();
    ck('the reconciliation reports what it checked', r.checked >= 2, r);
    ck('exactly one matched', r.matched === 1, r);

    const got = async id => (await pool.query('SELECT responded_at FROM notifications_log WHERE id=$1', [id])).rows[0].responded_at;
    ck('a log AFTER the nudge counts', (await got(responded.id)) !== null);
    ck('a log from BEFORE the nudge does not', (await got(beforeOnly.id)) === null);

    // Idempotence — it runs nightly over overlapping windows.
    const first = await got(responded.id);
    const again = await nudges.reconcileResponses();
    ck('a second run matches nothing new', again.matched === 0, again);
    ck('and does not move the timestamp it already set',
      String(await got(responded.id)) === String(first));

    // Outside the 48h window.
    await clear();
    await pool.query('DELETE FROM daily_logs');
    const stale = await nudgeAt(m1, coach, 'dormant', 'sms', 80);
    await logAt(m1, 0, 1);
    r = await nudges.reconcileResponses();
    ck('a nudge older than the window is left alone', (await got(stale.id)) === null, r);

    // A log more than 48h after the nudge is not a response to it.
    await clear();
    await pool.query('DELETE FROM daily_logs');
    const old = await nudgeAt(m1, coach, 'food', 'sms', 47);
    await logAt(m1, 0, 0);   // now — that is 47h after, inside the window
    await nudges.reconcileResponses();
    ck('a log 47h later is inside the window', (await got(old.id)) !== null);

    // Another member's log must never credit this nudge.
    await clear();
    await pool.query('DELETE FROM daily_logs');
    const mine = await nudgeAt(m1, coach, 'food', 'sms', 5);
    await logAt(m2, 0, 1);
    await nudges.reconcileResponses();
    ck("another member's log does not count", (await got(mine.id)) === null);
  }

  // ── 3. The refusal ─────────────────────────────────────────────────────────
  console.log('\n[3] thin data is refused, not rounded');
  {
    ck('2 of 3 is NOT reported as 67%', nudges.summarise('x', 3, 2).rate_pct === null,
      nudges.summarise('x', 3, 2));
    ck('it says why', /need 20/.test(nudges.summarise('x', 3, 2).note || ''),
      nudges.summarise('x', 3, 2).note);
    ck('the raw counts are still shown — refusing is not hiding',
      nudges.summarise('x', 3, 2).sent === 3 && nudges.summarise('x', 3, 2).responded === 2);
    ck('one below the threshold is still refused',
      nudges.summarise('x', nudges.MIN_BUCKET - 1, 10).rate_pct === null);
    ck('exactly at the threshold a rate appears',
      nudges.summarise('x', nudges.MIN_BUCKET, 10).rate_pct === 50,
      nudges.summarise('x', nudges.MIN_BUCKET, 10));
    ck('a zero rate on enough data is 0, not null — those are different claims',
      nudges.summarise('x', 30, 0).rate_pct === 0);
    ck('enough_data is a flag the client cannot misread',
      nudges.summarise('x', 3, 2).enough_data === false
      && nudges.summarise('x', 30, 2).enough_data === true);
  }

  // ── 4. The endpoint ────────────────────────────────────────────────────────
  console.log('\n[4] GET /gaps/effectiveness');
  {
    await clear();
    await pool.query('DELETE FROM daily_logs');
    // 24 water nudges, 12 responded — over the threshold.
    for (let i = 0; i < 24; i++) {
      const n = await nudgeAt(m1, coach, 'water', 'whatsapp', 5);
      if (i < 12) await pool.query('UPDATE notifications_log SET responded_at = NOW() WHERE id = $1', [n.id]);
    }
    // 3 dormant nudges — under it.
    for (let i = 0; i < 3; i++) await nudgeAt(m2, coach, 'dormant', 'sms', 5);

    const r = await call('GET', '/api/members/gaps/effectiveness', tok(coach, 'monitor'));
    ck('the coach can read it', r.status === 200, r.status);
    ck('it is not swallowed by /:id as a member called "gaps"',
      Array.isArray(r.data.by_gap), r.data);

    const water = r.data.by_gap.find(b => b.label === 'water');
    ck('a bucket over the threshold reports a rate', water.rate_pct === 50, water);
    ck('with the count behind it', water.sent === 24 && water.responded === 12, water);

    const dormant = r.data.by_gap.find(b => b.label === 'dormant');
    ck('a bucket under the threshold reports NO rate', dormant.rate_pct === null, dormant);
    ck('and says how many it has', dormant.sent === 3, dormant);

    ck('hours are bucketed and labelled', r.data.by_hour.length > 0 && /:00$/.test(r.data.by_hour[0].label),
      r.data.by_hour);
    ck('channels are split', r.data.by_channel.length === 2, r.data.by_channel.map(b => b.label));
    ck('the threshold is published so the UI need not hardcode it',
      r.data.min_bucket === nudges.MIN_BUCKET, r.data.min_bucket);
    ck('so is the response window', r.data.response_window_hours === 48, r.data.response_window_hours);

    const r2 = await call('GET', '/api/members/gaps/effectiveness', tok(coach2, 'monitor'));
    ck("a coach sees only their own sends", r2.data.overall.sent === 0, r2.data.overall);
    const ra = await call('GET', '/api/members/gaps/effectiveness', tok(admin, 'admin'));
    ck('an admin sees everything', ra.data.overall.sent === 27, ra.data.overall);
    const rm = await call('GET', '/api/members/gaps/effectiveness', tok(m1, 'patient'));
    ck('a member cannot read it', rm.status === 403, rm.status);
  }

  // ── 5. The POST route ──────────────────────────────────────────────────────
  console.log('\n[5] POST /:id/nudge');
  {
    await clear();
    let r = await call('POST', `/api/members/${m1}/nudge`, tok(coach, 'monitor'),
      { gap_key: 'dinner', channel: 'whatsapp', body: 'khana log karo' });
    ck('a coach can record a nudge', r.status === 200 && r.data.recorded === true, r.data);

    r = await call('POST', `/api/members/${m1}/nudge`, tok(coach, 'monitor'), { gap_key: '', channel: 'x' });
    ck('an unusable payload is a 200 no-op, not an error after the message went out',
      r.status === 200 && r.data.recorded === false, r.data);

    r = await call('POST', `/api/members/${m1}/nudge`, tok(m1, 'patient'), { gap_key: 'water', channel: 'sms' });
    ck('a member cannot record nudges', r.status === 403, r.status);

    r = await call('POST', `/api/members/${m1}/nudge`, tok(coach2, 'monitor'), { gap_key: 'water', channel: 'sms' });
    ck('a coach cannot nudge a member who is not theirs', r.status === 403, r.status);
  }

  // ── 6. Retention ───────────────────────────────────────────────────────────
  // The midnight sweep deletes notifications_log rows after 30 days. Left alone
  // it would delete this evidence faster than a small roster accumulates it,
  // and the dashboard would sit on "not enough data yet" permanently while the
  // rows aged out behind it. This asserts the exemption, in both directions.
  console.log('\n[6] the cleanup sweep does not eat the evidence');
  {
    await clear();
    const sweep = `DELETE FROM notifications_log
                    WHERE (gap_key IS NULL     AND sent_at < NOW() - INTERVAL '30 days')
                       OR (gap_key IS NOT NULL AND sent_at < NOW() - INTERVAL '180 days')`;

    await pool.query(
      `INSERT INTO notifications_log (user_id, type, gap_key, channel, sent_at)
       VALUES ($1,'coach_nudge','water','sms', NOW() - INTERVAL '60 days')`, [m1]);
    await pool.query(
      `INSERT INTO notifications_log (user_id, type, sent_at)
       VALUES ($1,'recap', NOW() - INTERVAL '60 days')`, [m1]);
    await pool.query(
      `INSERT INTO notifications_log (user_id, type, gap_key, channel, sent_at)
       VALUES ($1,'coach_nudge','food','sms', NOW() - INTERVAL '200 days')`, [m1]);

    await pool.query(sweep);
    const { rows } = await pool.query(
      `SELECT type, gap_key FROM notifications_log ORDER BY id`);
    ck('a 60-day-old nudge survives', rows.some(r => r.gap_key === 'water'), rows);
    ck('a 60-day-old ordinary notification is still swept',
      !rows.some(r => r.type === 'recap'), rows);
    ck('a nudge past 180 days is swept too — this is retention, not hoarding',
      !rows.some(r => r.gap_key === 'food'), rows);
  }

  srv.close();
  console.log(`\n${fail === 0 ? '✅' : '❌'} test-nudges: ${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
