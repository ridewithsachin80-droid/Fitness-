/**
 * scripts/test-ai-reads.js — the cached read (Sprint 10), against real Postgres.
 *
 * The point of ai_reads is that ONE sentence describes a member's day
 * everywhere: on Today, in the WhatsApp message, in the push. So these tests
 * check the store's rules (idempotent, one row per member/day/kind, no empty
 * rows), that both crons write the exact text they send, that the route serves
 * it, and that a member who turned notifications off still gets the read.
 *
 * Refuses to run unless DATABASE_URL is localhost (this suite writes).
 */
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const aiReads = require('../services/aiReads');

if (!/localhost/.test(process.env.DATABASE_URL || '')) { console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1); }

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q, _r, n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/members', require('../routes/patients'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n)) : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e === undefined ? '' : e).slice(0, 240))); };
const IST = (back = 0) => new Date(Date.now() + 5.5 * 3600000 - back * 86400000).toISOString().slice(0, 10);

(async () => {
  const SECRET = process.env.JWT_SECRET || 'local-test-secret';
  await pool.query(`DELETE FROM users WHERE phone LIKE '9000010%'`);
  const mk = async (name, phone, opts = {}) => {
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (name, phone, password, role, active) VALUES ($1,$2,'x','patient',true) RETURNING id`, [name, phone]);
    await pool.query(
      `INSERT INTO patient_profiles (user_id, water_target, macro_kcal, notify_push, notify_opted_out)
       VALUES ($1, 3000, 1800, $2, $3)`,
      [u.id, opts.push !== false, opts.optout === true]);
    return u.id;
  };
  const logDay = (id, back, o = {}) => pool.query(
    `INSERT INTO daily_logs (patient_id, log_date, weight_kg, food_items, water_ml, activities, acv, supplements, sleep, compliance_pct)
     VALUES ($1,$2,$3,$4,$5,'{}','{}','{}','{}',$6)
     ON CONFLICT (patient_id, log_date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg, food_items = EXCLUDED.food_items, water_ml = EXCLUDED.water_ml`,
    [id, IST(back), o.w ?? null, JSON.stringify(o.food || []), o.water ?? 0, o.pct ?? 50]);

  const alice = await mk('Alice Reads', '9000010001');
  const noPush = await mk('No Push', '9000010002', { push: false });
  const today = IST(0);

  console.log('\n[1] the store');
  const r1 = await aiReads.save({ memberId: alice, date: today, kind: 'morning', text: 'Good morning. Yesterday: 1,650 kcal.', facts: { kcal: 1650 } });
  ck('save returns the stored row', r1 && r1.kind === 'morning' && /1,650/.test(r1.text) && r1.facts.kcal === 1650, r1);
  const r2 = await aiReads.save({ memberId: alice, date: today, kind: 'morning', text: 'Rewritten line.', source: 'request' });
  const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM ai_reads WHERE patient_id=$1 AND read_date=$2::date AND kind='morning'`, [alice, today]);
  ck('re-running replaces rather than duplicating (one row, new text, new source)', cnt[0].n === 1 && r2.text === 'Rewritten line.' && r2.source === 'request', [cnt[0].n, r2.text]);
  ck('empty text is not stored', (await aiReads.save({ memberId: alice, date: today, kind: 'evening', text: '   ' })) === null && (await aiReads.get({ memberId: alice, date: today, kind: 'evening' })) === null);
  let threw = false;
  try { await aiReads.save({ memberId: alice, date: today, kind: 'nonsense', text: 'x' }); } catch { threw = true; }
  ck('an unknown kind is rejected before it reaches the database', threw);
  await aiReads.save({ memberId: alice, date: today, kind: 'evening', text: 'Evening: 1,200 of 1,800 kcal.' });
  ck('current() prefers the evening read once it exists', (await aiReads.current({ memberId: alice, date: today })).kind === 'evening');
  await pool.query(`DELETE FROM ai_reads WHERE patient_id=$1 AND kind='evening'`, [alice]);
  ck('current() falls back to the morning read', (await aiReads.current({ memberId: alice, date: today })).kind === 'morning');
  ck('current() is null for a day with nothing written', (await aiReads.current({ memberId: alice, date: IST(9) })) === null);
  ck('forDay lists every kind for the day', (await aiReads.forDay({ memberId: alice, date: today })).length === 1);
  ck('istDateStr is the IST calendar day', aiReads.istDateStr(new Date('2026-09-09T19:30:00Z')) === '2026-09-10');

  console.log('\n[2] the morning cron writes what it sends');
  await pool.query(`DELETE FROM ai_reads WHERE patient_id = ANY($1)`, [[alice, noPush]]);
  await pool.query(`DELETE FROM notifications_log WHERE user_id = ANY($1)`, [[alice, noPush]]);
  await logDay(alice, 1, { w: 82.4, food: [{ name: 'Idli', grams: 120, per_100g: { calories: 130 } }], water: 2500 });
  const digests = require('../services/digests');
  await digests.sendMorningNudges(today);
  const morning = await aiReads.get({ memberId: alice, date: today, kind: 'morning' });
  const { rows: sentRows } = await pool.query(
    `SELECT body FROM notifications_log WHERE user_id=$1 AND type='morning_nudge' ORDER BY id DESC LIMIT 1`, [alice]);
  ck('a morning read is cached for a member with yesterday logged', !!morning && morning.text.length > 10, morning && morning.text);
  ck('the cached text is EXACTLY what was sent (one wording, three places)', !!sentRows[0] && sentRows[0].body === morning.text, [sentRows[0] && sentRows[0].body, morning && morning.text]);
  ck('the read is marked as written by the cron', morning.source === 'cron');
  await digests.sendMorningNudges(today);
  const { rows: again } = await pool.query(`SELECT COUNT(*)::int AS n FROM ai_reads WHERE patient_id=$1 AND read_date=$2::date AND kind='morning'`, [alice, today]);
  ck('a second cron run in the same day does not add a second row', again[0].n === 1, again[0].n);

  console.log('\n[3] the evening recap');
  await logDay(alice, 0, { w: 82.2, food: [{ name: 'Dal', grams: 200, per_100g: { calories: 110 } }], water: 1500 });
  await logDay(noPush, 0, { w: 70, food: [{ name: 'Dal', grams: 200, per_100g: { calories: 110 } }], water: 1000 });
  await digests.sendEveningRecaps(today);
  const ev = await aiReads.get({ memberId: alice, date: today, kind: 'evening' });
  const { rows: evSent } = await pool.query(`SELECT body FROM notifications_log WHERE user_id=$1 AND type='evening_recap' ORDER BY id DESC LIMIT 1`, [alice]);
  ck('an evening read is cached and matches the notification body', !!ev && !!evSent[0] && ev.text === evSent[0].body, [ev && ev.text, evSent[0] && evSent[0].body]);
  const evNoPush = await aiReads.get({ memberId: noPush, date: today, kind: 'evening' });
  const { rows: noPushSent } = await pool.query(`SELECT COUNT(*)::int AS n FROM notifications_log WHERE user_id=$1 AND type='evening_recap'`, [noPush]);
  ck('a member with push OFF still gets the read on Today, but no notification', !!evNoPush && evNoPush.text.length > 5 && noPushSent[0].n === 0, [evNoPush && evNoPush.text, noPushSent[0].n]);

  console.log('\n[4] GET /members/me/read');
  const srv = app.listen(0); const port = srv.address().port;
  const tok = jwt.sign({ id: alice, role: 'patient', name: 'Alice Reads' }, SECRET);
  const call = async (q = '') => { const r = await fetch(`http://127.0.0.1:${port}/api/members/me/read${q}`, { headers: { Authorization: 'Bearer ' + tok } }); return { status: r.status, data: await r.json() }; };
  const res = await call();
  ck('200 with the evening read (the latest of the day)', res.status === 200 && res.data.read?.kind === 'evening' && res.data.read.text === ev.text, res.data);
  const past = await call(`?date=${IST(9)}`);
  ck('a day with no read returns { read: null } so the client falls back to its own', past.status === 200 && past.data.read === null && past.data.date === IST(9), past.data);
  const bad = await call('?date=not-a-date');
  ck('a malformed date falls back to today rather than erroring', bad.status === 200 && bad.data.date === today, bad.data);
  const coachTok = jwt.sign({ id: alice + 99999, role: 'monitor', name: 'Coach' }, SECRET);
  const asCoach = await fetch(`http://127.0.0.1:${port}/api/members/me/read`, { headers: { Authorization: 'Bearer ' + coachTok } });
  ck('a coach cannot read it (member-only route)', asCoach.status === 403, asCoach.status);

  srv.close();
  await pool.query(`DELETE FROM users WHERE phone LIKE '9000010%'`);
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
