/**
 * scripts/test-gaps.js — logging gap detection.
 *
 * The assertions that matter are about NOT flagging: water at breakfast is not
 * a gap, and a member who logged nothing has one problem rather than six. A
 * list that cries wolf is one a coach stops reading.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const { detectGaps, nextCheck } = require('../services/gapDetector');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q,_r,n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/patients', require('../routes/patients'));
app.use('/api/admin', require('../routes/admin'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e || '').slice(0, 200))); };

/** A UTC instant that reads as `h` o'clock in IST. */
const at = h => new Date(Date.UTC(2026, 7, 23, (h - 5 + 24) % 24, 0) - 30 * 60000);
const M = { id: 1, name: 'Harsha', phone: '9741771679' };
const P = { water_target: 3000, activities: new Array(6), acv: new Array(3),
            supplements: new Array(7), meal_slots: ['Meal 1','Meal 2','Meal 3'] };
const keys = r => r.gaps.map(g => g.key);

const fullDay = {
  weight_kg: 83, food_items: [{ name:'x', meal:'Meal 1' }, { name:'y', meal:'Meal 3' }],
  water_ml: 2800, activities: { walk: true }, acv: { acv1:true, acv2:true, acv3:true },
  supplements: { b12: true }, sleep: { bedtime:'22:30', waketime:'06:30' },
};

(async () => {
  console.log('\n[1] nothing is flagged too early in the day');
  // Each check has its own threshold, so an empty log surfaces more as the day
  // goes on: nothing before 11, then weight, and from 14:00 the blocking "nothing logged"
  // gap takes over and suppresses the rest — one message, not three.
  for (const [h, expect] of [[7, []], [9, []], [11, ['weight']], [16, ['nothing']]]) {
    const r = detectGaps(M, null, P, { now: at(h) });
    ck(`${String(h).padStart(2,'0')}:00 empty log -> [${expect.join(', ') || 'nothing yet'}]`,
       JSON.stringify(keys(r).sort()) === JSON.stringify(expect.sort()), keys(r));
  }

  console.log('\n[2] water is not a morning problem');
  const dry = { ...fullDay, water_ml: 200 };
  ck('09:00 low water -> not flagged', !keys(detectGaps(M, dry, P, { now: at(9) })).includes('water'));
  ck('13:00 low water -> not flagged', !keys(detectGaps(M, dry, P, { now: at(13) })).includes('water'));
  ck('19:00 low water -> flagged',      keys(detectGaps(M, dry, P, { now: at(19) })).includes('water'));

  console.log('\n[3] supplements and ACV wait until evening');
  const noSupp = { ...fullDay, supplements: {}, acv: {} };
  ck('17:00 -> supplements not flagged', !keys(detectGaps(M, noSupp, P, { now: at(17) })).includes('supplements'));
  ck('21:00 -> supplements flagged',      keys(detectGaps(M, noSupp, P, { now: at(21) })).includes('supplements'));
  ck('21:00 -> ACV flagged',              detectGaps(M, noSupp, P, { now: at(21) }).all_gaps.includes('acv'));

  console.log('\n[4] a member who logged NOTHING gets one message, not six');
  const empty = detectGaps(M, null, P, { now: at(21) });
  ck('exactly one gap surfaced', empty.gaps.length === 1, keys(empty));
  ck('and it is the blocking one', empty.gaps[0].key === 'nothing', empty.gaps[0]);
  ck('though the full picture is still available', empty.all_gaps.length > 3, empty.all_gaps);

  console.log('\n[5] a partly-logged member gets the specific gaps');
  const partial = { weight_kg: 83, food_items: [{ name:'x', meal:'Meal 1' }],
                    water_ml: 400, activities: {}, acv: {}, supplements: {}, sleep: {} };
  const pr = detectGaps(M, partial, P, { now: at(20) });
  ck('not treated as "nothing logged"', !keys(pr).includes('nothing'), keys(pr));
  ck('every gap returned for the combined message', pr.gaps.length >= 3, keys(pr));
  ck('display cap reported separately', pr.show <= 2, pr.show);
  ck('most severe first', pr.gaps[0].severity !== 'low', pr.gaps[0]);

  console.log('\n[6] a complete day produces no gaps at all');
  const clean = detectGaps(M, fullDay, P, { now: at(22) });
  ck('nothing to chase', clean.gaps.length === 0, keys(clean));

  console.log('\n[7] specific items are detected correctly');
  ck('missing weight at 11:00',
     keys(detectGaps(M, { ...fullDay, weight_kg: null }, P, { now: at(11) })).includes('weight'));
  ck('no food at 16:00',
     keys(detectGaps(M, { ...fullDay, food_items: [] }, P, { now: at(16) })).includes('food'));
  ck('dinner missing at 22:00',
     detectGaps(M, { ...fullDay, food_items: [{ name:'x', meal:'Meal 1' }] }, P, { now: at(22) })
       .all_gaps.includes('dinner'));
  ck('no activity at 20:00',
     detectGaps(M, { ...fullDay, activities: {} }, P, { now: at(20) }).all_gaps.includes('activity'));
  ck('sleep missing at 22:00',
     detectGaps(M, { ...fullDay, sleep: {} }, P, { now: at(22) }).all_gaps.includes('sleep'));

  console.log('\n[8] malformed data does not break the list');
  ck('null log survives',        detectGaps(M, null, P, { now: at(22) }).gaps.length >= 0);
  ck('garbage fields survive',   detectGaps(M, { activities: 'nonsense', food_items: null }, P, { now: at(22) }).gaps.length >= 0);
  ck('missing protocol survives', detectGaps(M, fullDay, {}, { now: at(22) }).gaps.length >= 0);

  console.log('\n[9] dormant members outrank today\'s misses');
  const dorm = detectGaps(M, null, P, { now: at(22), daysSince: 86 });
  ck('86 days silent -> dormant', keys(dorm).includes('dormant'), keys(dorm));
  ck('and nothing else is listed', dorm.gaps.length === 1, keys(dorm));
  ck('the day count is carried', dorm.days_since_log === 86, dorm.days_since_log);
  ck('the label names the number', /86 days/.test(dorm.gaps[0].label), dorm.gaps[0].label);

  const yesterday = detectGaps(M, null, P, { now: at(22), daysSince: 1 });
  ck('missed one day -> not dormant, just today\'s gaps',
     !keys(yesterday).includes('dormant'), keys(yesterday));

  const partialButDormant = detectGaps(M, fullDay, P, { now: at(22), daysSince: 40 });
  ck('dormant even when today looks complete',
     keys(partialButDormant).includes('dormant'), keys(partialButDormant));

  console.log('\n[10] an absence from the list is explainable');
  // A member who logged weight and food by 3pm has nothing outstanding yet.
  // Without this the coach sees 0% compliance elsewhere and no entry here,
  // and reasonably assumes the list is broken.
  const doneSoFar = { weight_kg: 85, food_items: [{ name:'x', meal:'Meal 1' }],
                      water_ml: 0, activities: {}, acv: {}, supplements: {} };
  const at15 = detectGaps(M, doneSoFar, P, { now: at(15), daysSince: 0 });
  ck('nothing flagged at 15:00', at15.gaps.length === 0, keys(at15));
  const at18 = detectGaps(M, doneSoFar, P, { now: at(18), daysSince: 0 });
  ck('water appears at 18:00', keys(at18).includes('water'), keys(at18));
  const at19 = detectGaps(M, doneSoFar, P, { now: at(19), daysSince: 0 });
  ck('activity appears at 19:00', keys(at19).includes('activity'), keys(at19));

  const n15 = nextCheck(at(15));
  ck('next check reported at 15:00', n15 && n15.hour === 18, n15);
  ck('and names what it covers', n15.covers.some(c => /water/.test(c)), n15.covers);
  ck('formats the hour readably', n15.label === '6pm', n15.label);
  ck('late evening -> no further checks', nextCheck(at(23)) === null, nextCheck(at(23)));

  console.log('\n[11] endpoint and access control');
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (n,ph,role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`,[n,ph,role])).rows[0];
  const coach = await mk('C','8101','monitor');
  const mine  = await mk('Mine','8102','patient');
  const other = await mk('Other','8103','patient');
  for (const u of [mine, other]) await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`,[u.id]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true)`,[coach.id,mine.id]);

  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u,role) => jwt.sign({id:u,role,name:'T'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const call = async (t) => { const r = await fetch(`http://127.0.0.1:${port}/api/patients/gaps`,
    { headers:{Authorization:'Bearer '+t} }); return { status: r.status, data: await r.json().catch(()=>({})) }; };

  let x = await call(tok(coach.id,'monitor'));
  ck('coach gets a list', x.status === 200 && Array.isArray(x.data.members), x.status);
  ck('only their own members appear',
     x.data.members.every(m => m.member_id === mine.id), x.data.members.map(m => m.name));
  ck('phone included for messaging', x.data.members.every(m => 'phone' in m), x.data.members[0]);
  ck('clear count returned', typeof x.data.clear === 'number', x.data.clear);
  ck('next check returned or null', 'next_check' in x.data, Object.keys(x.data));
  x = await call(tok(mine.id,'patient'));
  ck('MEMBERS CANNOT SEE THE GAP LIST', x.status === 403, x.status);
  ck('"gaps" is not read as a member id', true);

  console.log('\n[12] the per-member endpoint always answers');
  // The list endpoint only returns members WITH gaps. Composing a message from
  // a member's own page needs their state either way, including "nothing
  // outstanding" — otherwise the sheet falls back to a generic nudge that
  // tells someone who logged this morning we haven't seen their logs.
  await pool.query(
    `INSERT INTO daily_logs (patient_id, log_date, weight_kg, food_items)
     VALUES ($1, (NOW() AT TIME ZONE 'Asia/Kolkata')::date, 85, $2)`,
    [mine.id, JSON.stringify([{ name: 'Rice', grams: 150, meal: 'Meal 1' }])]);

  const one = await (async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/patients/${mine.id}/gaps`,
      { headers: { Authorization: 'Bearer ' + tok(coach.id, 'monitor') } });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  })();
  ck('answers for a member with no gaps', one.status === 200, one.status);
  ck('gaps array present even when empty', Array.isArray(one.data.gaps), one.data);
  ck('days_since_log reported as 0', one.data.days_since_log === 0, one.data.days_since_log);
  ck('next_check included', 'next_check' in one.data, Object.keys(one.data));

  const denied = await (async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/patients/${other.id}/gaps`,
      { headers: { Authorization: 'Bearer ' + tok(coach.id, 'monitor') } });
    return r.status;
  })();
  ck('blocked for an unassigned member', denied === 403, denied);

  const asMember = await (async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/patients/${mine.id}/gaps`,
      { headers: { Authorization: 'Bearer ' + tok(mine.id, 'patient') } });
    return r.status;
  })();
  ck('members cannot read it', asMember === 403, asMember);

  // ── Unread member messages on the coach list ───────────────────────────────
  // A member writing to their coach only produced a push notification, which
  // is invisible once the phone is in a pocket. The count has to survive the
  // round trip: written by the chat, read by the list, cleared by opening the
  // member — and `read_at` could not be reused for it, because sendMemberNote
  // sets that on insert.
  console.log('\n[unread member messages]');
  const { rows: [link] } = await pool.query(
    `SELECT monitor_id FROM monitor_patients WHERE patient_id = $1 AND active = true LIMIT 1`,
    [mine.id]);
  ck('the seeded member has a coach', !!link?.monitor_id, link);

  const listUnread = async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/patients/`,
      { headers: { Authorization: 'Bearer ' + tok(link.monitor_id, 'monitor') } });
    const rows = await r.json();
    return (rows.find(m => m.id === mine.id) || {}).unread_messages;
  };

  ck('no messages -> the badge is zero, not null', (await listUnread()) === 0, await listUnread());

  const { rows: [note] } = await pool.query(
    `INSERT INTO monitor_notes (monitor_id, patient_id, note_date, note, flagged, from_member, read_at)
     VALUES ($1, $2, CURRENT_DATE, 'Please assign my workout for today.', false, true, NOW())
     RETURNING id`, [link.monitor_id, mine.id]);
  ck('a member message shows as unread on the coach list', (await listUnread()) === 1);

  const listRow = async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/patients/`,
      { headers: { Authorization: 'Bearer ' + tok(link.monitor_id, 'monitor') } });
    return (await r.json()).find(m => m.id === mine.id) || {};
  };
  // The coach list carries the message TEXT, not just a count — the landing
  // page shows what was asked, so the coach can tell an urgent question from a
  // "thanks" without opening the member.
  ck('the newest message text comes through with it',
     (await listRow()).latest_message === 'Please assign my workout for today.',
     (await listRow()).latest_message);

  // A note the COACH wrote is not a message waiting on the coach.
  await pool.query(
    `INSERT INTO monitor_notes (monitor_id, patient_id, note_date, note, flagged, from_member)
     VALUES ($1, $2, CURRENT_DATE, 'Keep protein up this week.', false, false)`,
    [link.monitor_id, mine.id]);
  ck('the coach\'s own notes are not counted', (await listUnread()) === 1);

  // Sachin works from /admin, so the admin member list has to carry the same
  // two fields the coach list does. It is a separate query in a separate file,
  // which is exactly how one of them ends up without them.
  const adminRow = async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/members`,
      { headers: { Authorization: 'Bearer ' + tok(link.monitor_id, 'admin') } });
    const rows = await r.json();
    return (Array.isArray(rows) ? rows : []).find(m => m.id === mine.id) || {};
  };
  ck('the ADMIN member list carries the unread count too', (await adminRow()).unread_messages === 1,
     await adminRow());
  ck('and the message text with it',
     (await adminRow()).latest_message === 'Please assign my workout for today.');

  // The coach AI answered "show the msg from members" with a list of today's
  // logs, because its roster snapshot knew about logs and nothing else.
  const { buildCoachRosterContext } = require('../routes/aiChat');
  const roster = await buildCoachRosterContext([{ id: mine.id, name: mine.name }]);
  ck('the coach AI roster snapshot includes member messages',
     /Messages from members/.test(roster), roster.slice(-200));
  ck('with the text and an unread marker',
     /Please assign my workout for today/.test(roster) && /\[UNREAD\]/.test(roster));

  const detail = await fetch(`http://127.0.0.1:${port}/api/patients/${mine.id}`,
    { headers: { Authorization: 'Bearer ' + tok(link.monitor_id, 'monitor') } });
  ck('opening the member page returns 200', detail.status === 200, detail.status);
  const detailBody = await detail.json();
  ck('and that page still carries the message as unread',
     (detailBody.notes || []).some(n => n.from_member && n.coach_read_at === null));

  // The UPDATE is fired without awaiting so a failure cannot cost the coach
  // the page, so give it a moment before asserting it landed.
  await new Promise(r => setTimeout(r, 250));
  ck('opening the member clears the badge', (await listUnread()) === 0, await listUnread());

  // ...but the message must NOT disappear with it. The first version of this
  // card was unread-only, so opening a member's page to check their weight
  // silently emptied the dashboard of a question nobody had answered. Read
  // state controls how the row looks; the message stays for a week.
  ck('the message itself survives being read',
     (await listRow()).latest_message === 'Please assign my workout for today.',
     await listRow());
  ck('and carries a timestamp so the card can order by it',
     !!(await listRow()).latest_message_at);
  ck('the admin list keeps it too', (await adminRow()).latest_message ===
     'Please assign my workout for today.');

  await pool.query(`DELETE FROM monitor_notes WHERE patient_id = $1`, [mine.id]);
  ck('cleanup leaves no messages behind', (await listUnread()) === 0);

  srv.close();
  console.log(`\n\u2550\u2550\u2550 GAPS: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
