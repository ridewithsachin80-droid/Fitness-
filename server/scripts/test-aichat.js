/**
 * scripts/test-aichat.js — end-to-end tests for the AI chat coach endpoints
 * against a real PostgreSQL TEST database.
 *
 * ⚠️  DESTRUCTIVE: wipes the users table to seed clean state.
 *     NEVER point DATABASE_URL at production. The guard below refuses
 *     non-localhost URLs unless ALLOW_TEST_DB=1 is explicitly set.
 *
 * Run from server/:  npm run test:aichat
 * (set DATABASE_URL to your local test DB and JWT_SECRET first)
 */

// ── Production guard — refuse non-local databases unless explicitly allowed ──
if (!process.env.DATABASE_URL?.includes('localhost') &&
    !process.env.DATABASE_URL?.includes('127.0.0.1') &&
    !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.');
  console.error('This test WIPES the users table. Point it at a throwaway test DB.');
  console.error('To run against a remote TEST database anyway, set ALLOW_TEST_DB=1.');
  process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GROQ_API_KEY = 'dummy'; // provider never called in these tests

const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const aiChatRoutes = require('../routes/aiChat');

const app = express();
app.use(express.json());
app.use('/api/ai-chat', aiChatRoutes);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + JSON.stringify(extra).slice(0, 200) : ''}`); }
}

async function request(server, method, path, token, body) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

(async () => {
  // ── Seed users ─────────────────────────────────────────────────────────────
  await pool.query(`TRUNCATE users RESTART IDENTITY CASCADE`);
  const { rows: [admin] } = await pool.query(
    `INSERT INTO users (name, phone, password, role, active) VALUES ('Admin Sachin','9000000001','x','admin',true) RETURNING id`);
  const { rows: [mon] } = await pool.query(
    `INSERT INTO users (name, phone, password, role, active) VALUES ('Monitor Veeru','9000000002','x','monitor',true) RETURNING id`);
  const { rows: [bujju] } = await pool.query(
    `INSERT INTO users (name, phone, password, role, active) VALUES ('Bujju','9000000003','x','patient',true) RETURNING id`);
  const { rows: [asha] } = await pool.query(
    `INSERT INTO users (name, phone, password, role, active) VALUES ('Asha','9000000004','x','patient',true) RETURNING id`);
  // monitor is linked to Bujju only
  await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true)`, [mon.id, bujju.id]);

  const tokenFor = (u, role) => jwt.sign({ id: u.id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const adminTok = tokenFor(admin, 'admin');
  const monTok   = tokenFor(mon, 'monitor');
  const patTok   = tokenFor(bujju, 'patient');

  const server = app.listen(0);

  // ── TEST GROUP 1: auth & scoping ───────────────────────────────────────────
  console.log('\n[1] Auth & scoping');
  let r = await request(server, 'POST', '/api/ai-chat/coach-apply', patTok, { actions: [{ member_id: bujju.id, ops: {} }] });
  check('patient blocked from coach-apply (403)', r.status === 403, r);

  r = await request(server, 'POST', '/api/ai-chat/coach-apply', monTok,
    { actions: [{ member_id: asha.id, ops: { water_target: 4000 } }] });
  check('monitor blocked from unassigned member', r.status === 200 && r.data.results[0].ok === false, r.data);

  // ── TEST GROUP 2: coach-apply merge logic ──────────────────────────────────
  console.log('\n[2] coach-apply protocol merge');
  // 2a: water + macros + goal on fresh profile (no profile row yet)
  r = await request(server, 'POST', '/api/ai-chat/coach-apply', adminTok, {
    actions: [{ member_id: bujju.id, ops: {
      water_target: 4000,
      macros: { kcal: 1600, pro: 100, carb: null, fat: null },
      target_weight: 75,
    } }],
  });
  check('apply water/macros/goal succeeds', r.status === 200 && r.data.results[0].ok, r.data);
  let { rows: [p] } = await pool.query(`SELECT * FROM patient_profiles WHERE user_id=$1`, [bujju.id]);
  check('water_target = 4000', p.water_target === 4000, p.water_target);
  check('macro_kcal = 1600', p.macro_kcal === 1600, p.macro_kcal);
  check('macro_pro = 100', p.macro_pro === 100, p.macro_pro);
  check('macro_carb untouched (null)', p.macro_carb === null, p.macro_carb);
  check('target_weight = 75', parseFloat(p.target_weight) === 75, p.target_weight);

  // 2b: remove from null protocol (materialise-all first)
  r = await request(server, 'POST', '/api/ai-chat/coach-apply', adminTok, {
    actions: [{ member_id: bujju.id, ops: {
      supplements: { add: [], remove: ['flax'], add_custom: [], remove_custom: [] },
    } }],
  });
  ({ rows: [p] } = await pool.query(`SELECT * FROM patient_profiles WHERE user_id=$1`, [bujju.id]));
  const suppList = p.protocol_supplements;
  check('remove flax: protocol materialised to explicit list', Array.isArray(suppList), suppList);
  check('flax removed', Array.isArray(suppList) && !suppList.includes('flax'), suppList);
  check('other 6 defaults kept', Array.isArray(suppList) && ['b12','d3','fishoil','multi','yeast','electrolyte'].every(id => suppList.includes(id)), suppList);

  // 2c: add flax back
  r = await request(server, 'POST', '/api/ai-chat/coach-apply', adminTok, {
    actions: [{ member_id: bujju.id, ops: {
      supplements: { add: ['flax'], remove: [], add_custom: [], remove_custom: [] },
    } }],
  });
  ({ rows: [p] } = await pool.query(`SELECT * FROM patient_profiles WHERE user_id=$1`, [bujju.id]));
  check('flax re-added', p.protocol_supplements.includes('flax'), p.protocol_supplements);

  // 2d: add custom activity while protocol is null → custom saved, protocol stays null (= all incl. custom)
  r = await request(server, 'POST', '/api/ai-chat/coach-apply', adminTok, {
    actions: [{ member_id: bujju.id, ops: {
      activities: { add: [], remove: [], add_custom: [{ label: 'Evening Walk', sub: '20 min after dinner' }], remove_custom: [] },
    } }],
  });
  ({ rows: [p] } = await pool.query(`SELECT * FROM patient_profiles WHERE user_id=$1`, [bujju.id]));
  check('custom activity saved', Array.isArray(p.custom_activities) && p.custom_activities.some(c => c.label === 'Evening Walk'), p.custom_activities);
  check('protocol_activities stays null (all assigned)', p.protocol_activities === null, p.protocol_activities);

  // 2e: duplicate custom add is idempotent
  await request(server, 'POST', '/api/ai-chat/coach-apply', adminTok, {
    actions: [{ member_id: bujju.id, ops: {
      activities: { add: [], remove: [], add_custom: [{ label: 'evening walk', sub: 'dupe' }], remove_custom: [] },
    } }],
  });
  ({ rows: [p] } = await pool.query(`SELECT * FROM patient_profiles WHERE user_id=$1`, [bujju.id]));
  check('duplicate custom not added twice', p.custom_activities.filter(c => c.label.toLowerCase() === 'evening walk').length === 1, p.custom_activities);

  // 2f: remove a catalog activity AFTER custom exists → materialised list includes custom id
  await request(server, 'POST', '/api/ai-chat/coach-apply', adminTok, {
    actions: [{ member_id: bujju.id, ops: {
      activities: { add: [], remove: ['steps3'], add_custom: [], remove_custom: [] },
    } }],
  });
  ({ rows: [p] } = await pool.query(`SELECT * FROM patient_profiles WHERE user_id=$1`, [bujju.id]));
  const actList = p.protocol_activities;
  const customId = p.custom_activities[0].id;
  check('steps3 removed', Array.isArray(actList) && !actList.includes('steps3'), actList);
  check('custom id survives materialisation', actList.includes(customId), { actList, customId });

  // 2g: remove_custom by label cleans both lists
  await request(server, 'POST', '/api/ai-chat/coach-apply', adminTok, {
    actions: [{ member_id: bujju.id, ops: {
      activities: { add: [], remove: [], add_custom: [], remove_custom: ['Evening Walk'] },
    } }],
  });
  ({ rows: [p] } = await pool.query(`SELECT * FROM patient_profiles WHERE user_id=$1`, [bujju.id]));
  check('custom removed from custom_activities', !p.custom_activities.some(c => c.label === 'Evening Walk'), p.custom_activities);
  check('custom id removed from protocol list', !p.protocol_activities.includes(customId), p.protocol_activities);

  // 2h: note lands in monitor_notes
  await request(server, 'POST', '/api/ai-chat/coach-apply', adminTok, {
    actions: [{ member_id: bujju.id, ops: { note: { text: 'Please log daily', flagged: true } } }],
  });
  const { rows: notes } = await pool.query(`SELECT * FROM monitor_notes WHERE patient_id=$1`, [bujju.id]);
  check('coach note inserted + flagged', notes.length === 1 && notes[0].flagged === true && notes[0].note === 'Please log daily', notes);

  // 2i: broadcast note to ALL (admin sees both patients)
  await request(server, 'POST', '/api/ai-chat/coach-apply', adminTok, {
    actions: [{ is_all: true, ops: { note: { text: 'Log before 9 PM', flagged: false } } }],
  });
  const { rows: bc } = await pool.query(`SELECT patient_id FROM monitor_notes WHERE note='Log before 9 PM'`);
  check('broadcast reached both members', bc.length === 2, bc);

  // 2j: audit trail written
  // coachAudit is fire-and-forget by design (an audit write must never fail the
  // member-facing action), so give it a moment before asserting.
  await new Promise(r => setTimeout(r, 400));
  const { rows: audits } = await pool.query(`SELECT action FROM audit_log ORDER BY id`);
  check('audit rows written', audits.length >= 5 && audits.some(a => a.action === 'coach_ai_update') && audits.some(a => a.action === 'coach_ai_broadcast'), audits.map(a => a.action));

  // ── TEST GROUP 3: remind ───────────────────────────────────────────────────
  console.log('\n[3] remind');
  r = await request(server, 'POST', '/api/ai-chat/remind', monTok, { members: [{ id: bujju.id }, { id: asha.id }] });
  check('monitor remind: assigned ok, unassigned rejected',
    r.data.sent === 1 && r.data.results.find(x => x.id === asha.id)?.ok === false, r.data);
  const { rows: rn } = await pool.query(
    `SELECT * FROM monitor_notes WHERE patient_id=$1 AND flagged=true AND note != 'Please log daily'`, [bujju.id]);
  check('remind note flagged + personalised',
    rn.length === 1 && rn[0].note.includes('Bujju'), rn);

  r = await request(server, 'POST', '/api/ai-chat/remind', adminTok, { members: [] });
  check('empty members rejected 400', r.status === 400, r);

  // ── TEST GROUP 4: member parse validators (no AI — validation-only paths) ──
  console.log('\n[4] input validation');
  r = await request(server, 'POST', '/api/ai-chat/parse', patTok, { message: '' });
  check('empty message 400', r.status === 400, r);
  r = await request(server, 'POST', '/api/ai-chat/coach-parse', adminTok, { message: 'x' });
  check('1-char coach message 400', r.status === 400, r);

  server.close();
  console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
