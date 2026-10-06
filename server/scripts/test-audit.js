/**
 * scripts/test-audit.js — regression tests for the October 2026 audit.
 *
 * Every block below is a bug that was REPRODUCED against this server and a real
 * Postgres before it was fixed. Each was then mutation-checked: put the bug
 * back, confirm the assertion goes red (see QA-REPORT.md for which).
 *
 * Unlike most suites here this one boots the REAL server/index.js — the same
 * middleware, mounts and Socket.io wiring production runs — because two of the
 * bugs (the open socket rooms and the shared rate-limit bucket) live in
 * index.js itself and cannot be seen from a router mounted on a bare app.
 * Cron is switched off and the AI transport is stubbed; nothing leaves the box.
 *
 *   A. Coach notes save (the INSERT failed every time on real Postgres)
 *   B. Live updates need a login (anonymous sockets could read a coach's feed)
 *   C. /foods/ai-test is admin-only and shows no key material
 *   D. A save from an out-of-date app does not erase newer data
 *   E. A malformed day is refused, and one already stored cannot break admin
 *   F. Disable/enable is safe to double-tap and cannot hit the wrong account
 *   G. Assigning a coach is atomic
 *   H. Double submits do not duplicate notes, replies or lab values
 *   I. Voice: a retried sentence is applied once; two at once both land
 *   J. Coaches see only their own members' reminder data
 *   K. Changing or resetting a PIN/password ends other sessions
 *   L. Deleting a member removes their photos from storage first
 *   M. Rate limits are per client address, not one shared bucket
 *   N. The app keeps edits made while a save is in flight (real client code)
 *   O. Sign out ends the session on the server (source contract)
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET         = process.env.JWT_SECRET || 'testsecret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'testrefresh';
process.env.GEMINI_API_KEY     = 'stub-key-AAAAAAAAAAAAAAAA';
process.env.GROQ_API_KEY       = '';
process.env.PORT               = '0';      // any free port
process.env.TRUST_PROXY        = '1';      // as in production: one proxy hop
process.env.NODE_ENV           = 'test';

const path = require('path');
const fs   = require('fs');
const SRV  = path.join(__dirname, '..');

// Cron off: this suite must never send a recap because the clock says 20:30.
const cronPath = require.resolve(path.join(SRV, 'services/cronService'));
require.cache[cronPath] = { id: cronPath, filename: cronPath, loaded: true, exports: { start() {} } };

// AI transport stubbed; everything else on axios is real.
const axiosPath = require.resolve('axios', { paths: [SRV] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
let aiAnswer = () => '{}', aiCalls = 0;
const stubbedPost = async (url, body, cfg) => {
  if (/generativelanguage|groq/.test(String(url))) {
    aiCalls++;
    const text = await aiAnswer(body);
    return { data: { candidates: [{ content: { parts: [{ text }] } }], choices: [{ message: { content: text } }] } };
  }
  return realAxios.post(url, body, cfg);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const jwt     = require('jsonwebtoken');
const pool    = require('../db/pool');
const storage = require('../services/storage');
const DM      = require('../services/dayMerge');
const { getISTDate } = require('../utils/istDate');
const { importClient } = require('./lib/client-bundle');
const { io }  = require('../index.js');
const { io: ioClient } = require(require.resolve('socket.io-client', { paths: [path.join(SRV, '../client'), path.join(SRV, '..')] }));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };
const q   = (s, p) => pool.query(s, p).then(r => r.rows);
const nap = (ms) => new Promise(r => setTimeout(r, ms));
const tok = (u) => jwt.sign({ id: u.id, role: u.role, name: u.name }, process.env.JWT_SECRET, { expiresIn: '15m' });

(async () => {
  const port = await new Promise((resolve) => {
    const t = setInterval(() => { const a = io.httpServer.address(); if (a) { clearInterval(t); resolve(a.port); } }, 20);
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, user, body, headers = {}) => {
    const h = { 'content-type': 'application/json', ...headers };
    if (user) h.authorization = 'Bearer ' + tok(user);
    const r = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) {}
    return { status: r.status, json, text };
  };
  const twice = (m, url, who, body) => Promise.all([call(m, url, who, body), call(m, url, who, body)]);

  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (name, phone, email, role) => ({ role, name, id: (await pool.query(
    `INSERT INTO users (name,phone,email,password,role,active) VALUES ($1,$2,$3,'x',$4,true) RETURNING id`, [name, phone, email, role])).rows[0].id });
  const admin  = await mk('Admin', null, 'admin@x.in', 'admin');
  const coachA = await mk('Coach A', null, 'a@x.in', 'monitor');
  const coachB = await mk('Coach B', null, 'b@x.in', 'monitor');
  const asha   = await mk('Asha', '9000000001', null, 'patient');
  const bala   = await mk('Bala', '9000000002', null, 'patient');
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1),($2)`, [asha.id, bala.id]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true),($3,$4,true)`, [coachA.id, asha.id, coachB.id, bala.id]);
  const today = getISTDate();
  const dayRow = async (m = asha) => (await q(`SELECT * FROM daily_logs WHERE patient_id=$1 AND log_date=$2`, [m.id, today]))[0];

  // ── A ───────────────────────────────────────────────────────────────────────
  console.log('\n[A] coach notes save');
  {
    let r = await call('POST', `/api/members/${asha.id}/notes`, coachA, { note: 'Good week', note_date: today, flagged: false });
    ck('a plain note saves (this returned 500 every time before)', r.status === 201 && r.json?.note === 'Good week', r.text);
    ck('and is unread for the member', r.json?.read_at === null, r.json);
    r = await call('POST', `/api/members/${asha.id}/notes`, coachA, { note: 'Sent on WhatsApp', note_date: today, delivered_via: 'whatsapp' });
    ck('a copy of a WhatsApp message saves, already marked read', r.status === 201 && r.json?.delivered_via === 'whatsapp' && r.json?.read_at !== null, r.text);
    r = await call('POST', `/api/members/${asha.id}/notes`, coachB, { note: 'x', note_date: today });
    ck('another coach still cannot write to this member', r.status === 403, r.status);
  }

  // ── B ───────────────────────────────────────────────────────────────────────
  console.log('\n[B] live updates need a login');
  {
    const connect = (opts) => new Promise((resolve) => { const s = ioClient(base, { transports: ['websocket'], ...opts }); s.on('connect', () => resolve(s)); });
    const anon   = await connect({});
    const mine   = await connect({ auth: { token: tok(coachA) } });
    const other  = await connect({ auth: { token: tok(coachB) } });
    const cookie = await connect({ extraHeaders: { cookie: `accessToken=${tok(coachA)}` } });   // a phone on the previous bundle
    const forged = await connect({ auth: { token: jwt.sign({ id: coachA.id, role: 'monitor' }, 'not-the-secret') } });
    const heard = { anon: [], mine: [], other: [], cookie: [], forged: [] };
    for (const [k, s] of Object.entries({ anon, mine, other, cookie, forged })) s.on('log_updated', (d) => heard[k].push(d));
    let asked = 0; anon.on('auth_required', () => asked++);
    anon.emit('join_monitor_room', coachA.id); anon.emit('join_room', asha.id);
    other.emit('join_monitor_room', coachA.id);          // a real coach asking for someone else's room
    forged.emit('join_monitor_room', coachA.id);
    await nap(150);
    const r = await call('POST', `/api/logs/${today}`, asha, { weight_kg: 81.2, food_items: [] });
    await nap(250);
    ck('the save itself works', r.status === 200, r.text);
    ck('an anonymous socket hears nothing, whatever room it asks for', heard.anon.length === 0, heard.anon);
    ck('and is told to authenticate', asked >= 1, asked);
    ck('a forged token hears nothing', heard.forged.length === 0, heard.forged);
    ck("another coach cannot join this coach's room", heard.other.length === 0, heard.other);
    ck("the member's own coach hears the update without asking to join", heard.mine.length === 1 && heard.mine[0].patientId === asha.id, heard.mine);
    ck('a phone on the previous app bundle (cookie only) still gets updates', heard.cookie.length === 1, heard.cookie);
    const ack = await new Promise((resolve) => anon.emit('authenticate', tok(coachA), resolve));
    await call('POST', `/api/logs/${today}`, asha, { weight_kg: 81.4, food_items: [] });
    await nap(250);
    ck('a socket that authenticates later starts receiving', ack?.ok === true && heard.anon.length === 1, { ack, n: heard.anon.length });
    for (const s of [anon, mine, other, cookie, forged]) s.close();
    await pool.query('DELETE FROM daily_logs');
  }

  // ── C ───────────────────────────────────────────────────────────────────────
  console.log('\n[C] the AI diagnostic');
  {
    const before = aiCalls;
    let r = await call('GET', '/api/foods/ai-test', null);
    ck('needs a login', r.status === 401, r.status);
    r = await call('GET', '/api/foods/ai-test', coachA);
    ck('and an admin one', r.status === 403, r.status);
    ck('refused calls spend no AI requests', aiCalls === before, aiCalls - before);
    r = await call('GET', '/api/foods/ai-test', admin);
    ck('an admin gets provider status', r.status === 200 && r.json?.gemini?.ok === true, r.text);
    ck('with no part of any API key in it', !/keyPrefix|stub-key|AAAA/.test(r.text), r.text);
  }

  // ── D ───────────────────────────────────────────────────────────────────────
  console.log('\n[D] a save from an out-of-date app');
  {
    const L = importClient('utils/logSync.js');
    const idli = { id: 1, name: 'Idli', grams: 100, meal: 'Breakfast', per_100g: { calories: 130 } };
    const tea  = { id: 2, name: 'Tea', grams: 150, meal: 'Breakfast', per_100g: { calories: 40 } };
    await call('POST', `/api/logs/${today}`, asha, { weight_kg: 80, food_items: [idli, tea], water_ml: 250, activities: { yoga: true } });
    // 8am: the app loads the day and keeps it
    const loaded = L.mapServerLog((await call('GET', `/api/logs/${today}`, asha)).json);
    await nap(15);
    // meanwhile: the coach corrects the weight; lunch and a walk are logged elsewhere; water +500; nutrition corrected
    await call('PATCH', `/api/members/${asha.id}/weight`, coachA, { date: today, weight_kg: 78.5 });
    await pool.query(
      `UPDATE daily_logs SET food_items = jsonb_set(food_items, '{0,per_100g}', '{"calories": 58}') || '[{"id":999,"name":"Voice lunch","grams":300,"meal":"Lunch"}]'::jsonb,
              water_ml = water_ml + 500, activities = activities || '{"walk": true}', saved_at = NOW()
        WHERE patient_id=$1 AND log_date=$2`, [asha.id, today]);
    // 3pm, in the still-open app: +250 water, tick ACV, un-tick yoga, make the idli 150g, delete the tea, add a snack
    const edited = { ...loaded, water: 500, acv: { morning: true }, activities: { yoga: false },
      food: [{ ...idli, grams: 150 }, { id: 3, name: 'Peanuts', grams: 30, meal: 'Snack' }] };
    const r = await call('POST', `/api/logs/${today}`, asha, L.mapToServer(edited, null));
    const row = await dayRow();
    const names = row.food_items.map(f => f.name).sort().join(',');
    ck('the save succeeds and says it was merged', r.status === 200 && r.json?.merged_live === true, r.text.slice(0, 200));
    ck("the coach's weight correction survives (the app never touched weight)", Number(row.weight_kg) === 78.5, row.weight_kg);
    ck('food logged elsewhere survives; the deleted item stays deleted; the new one is added', names === 'Idli,Peanuts,Voice lunch', names);
    const savedIdli = row.food_items.find(f => f.name === 'Idli');
    ck("the member's edit to an item wins (150 g) and keeps the corrected nutrition", Number(savedIdli.grams) === 150 && savedIdli.per_100g.calories === 58, savedIdli);
    ck('water adds up: 250 + 500 elsewhere + 250 here = 1000', row.water_ml === 1000, row.water_ml);
    ck("ticks merge per item: the walk logged elsewhere stays, the member's un-tick of yoga holds", row.activities.walk === true && !row.activities.yoga, row.activities);
    ck("the member's new ACV tick is saved", row.acv.morning === true, row.acv);
    ck('the answer tells the app which fields came from the server', (r.json.kept_server || []).includes('weight'), r.json.kept_server);

    // an in-date save is written exactly as sent
    const fresh = L.mapServerLog((await call('GET', `/api/logs/${today}`, asha)).json);
    const r2 = await call('POST', `/api/logs/${today}`, asha, L.mapToServer({ ...fresh, weight: '77', food: [] }, null));
    const row2 = await dayRow();
    ck('an up-to-date app is saved exactly as sent, no merge', r2.status === 200 && !r2.json.merged_live && Number(row2.weight_kg) === 77 && row2.food_items.length === 0, r2.text.slice(0, 160));

    // a phone on the previous bundle sends no base_fields: unchanged behaviour
    await pool.query(`UPDATE daily_logs SET saved_at = NOW() + INTERVAL '1 second' WHERE patient_id=$1`, [asha.id]);
    const r3 = await call('POST', `/api/logs/${today}`, asha, { weight_kg: 70, food_items: [tea], base_saved_at: fresh.savedAt, base_food_ids: [] });
    ck('a phone on the previous bundle (no base_fields) is written as sent, as before', r3.status === 200 && !r3.json.merged_live && Number((await dayRow()).weight_kg) === 70, r3.text.slice(0, 160));

    // the offline rule is untouched: food merged, server wins the rest
    const dosa = { id: 50, name: 'Dosa', grams: 120, meal: 'Dinner' };
    const off = await call('POST', `/api/logs/${today}`, asha, { ...L.mapToServer({ ...fresh, weight: '66', food: [dosa] }, null), offline_replay: true });
    const row4 = await dayRow();
    ck("the offline rule is unchanged: food merged, the server's weight kept", off.json?.merged === true && Number(row4.weight_kg) === 70 && row4.food_items.map(f => f.name).sort().join() === 'Dosa,Tea', off.text.slice(0, 300));

    // the day was created elsewhere before this phone's first save
    await pool.query('DELETE FROM daily_logs');
    const empty = L.mapServerLog((await call('GET', `/api/logs/${today}`, asha)).json);
    await call('PATCH', `/api/members/${asha.id}/weight`, coachA, { date: today, weight_kg: 79 });
    await call('POST', `/api/logs/${today}`, asha, L.mapToServer({ ...empty, supplements: { d3: true } }, null));
    const row5 = await dayRow();
    ck("first save of the day does not erase a weight the coach had already entered", Number(row5.weight_kg) === 79 && row5.supplements.d3 === true, row5);

    // pure rule
    const m = DM.mergeLiveDay({ weight_kg: '80.00', water_ml: 0, notes: 'srv', sleep: { quality: 4 }, food_items: [] },
      { weight_kg: 80, water_ml: 0, notes: '', sleep: { bedtime: '23:00' }, food_items: [] }, [], { weight_kg: '80.00', notes: '', sleep: {} });
    ck('rule: untouched text keeps the server value; sleep merges key by key', m.doc.notes === 'srv' && m.doc.sleep.quality === 4 && m.doc.sleep.bedtime === '23:00', m.doc);
    await pool.query('DELETE FROM daily_logs');
  }

  // ── E ───────────────────────────────────────────────────────────────────────
  console.log('\n[E] malformed days');
  {
    for (const [label, body] of [['food_items as text', { food_items: 'not-a-list' }], ['activities as text', { activities: 'x' }],
      ['a food item that is not an object', { food_items: ['roti'] }], ['notes as a number', { notes: 5 }], ['400 food items', { food_items: Array(400).fill({ name: 'x' }) }]]) {
      const r = await call('POST', `/api/logs/${today}`, asha, body);
      ck(`${label} is refused with a reason`, r.status === 400 && !!r.json?.error, r.text);
    }
    ck('nothing was stored by any of them', !(await dayRow()), await dayRow());
    let r = await call('POST', `/api/logs/${today}`, asha, { activities: null, acv: null, sleep: null, notes: null, food_items: null });
    const row = await dayRow();
    ck('nulls are stored as empty, not as JSON null', r.status === 200 && JSON.stringify([row.activities, row.acv, row.sleep, row.food_items]) === '[{},{},{},[]]', row);
    ck('an impossible date is a 400, not a database error', (await call('POST', '/api/logs/2026-02-30', asha, {})).status === 400);
    ck('reading an impossible date is a 400 too', (await call('GET', '/api/logs/2026-02-30', asha)).status === 400);
    ck('year 0001 is refused', (await call('POST', '/api/logs/0001-01-01', asha, {})).status === 400);
    // a row that is ALREADY malformed (stored before this fix) must not take the dashboard down
    await pool.query(`UPDATE daily_logs SET food_items = '"oops"', activities = '"oops"', supplements = 'null' WHERE patient_id=$1`, [asha.id]);
    r = await call('GET', '/api/admin/overview', admin);
    const r2 = await call('GET', '/api/admin/stats', admin);
    ck('admin overview and stats still load with a malformed row in the table', r.status === 200 && r2.status === 200, [r.status, r2.status, r.text.slice(0, 120)]);
    await pool.query('DELETE FROM daily_logs');
  }

  // ── F ───────────────────────────────────────────────────────────────────────
  console.log('\n[F] enable / disable');
  {
    const active = async (id) => (await q(`SELECT active FROM users WHERE id=$1`, [id]))[0].active;
    let rr = await twice('PATCH', `/api/admin/members/${asha.id}/toggle`, admin, { active: false });
    ck('a double tap on Disable leaves the member disabled', rr.every(x => x.status === 200 && x.json.active === false) && (await active(asha.id)) === false, rr.map(x => x.text));
    rr = await twice('PATCH', `/api/admin/members/${asha.id}/toggle`, admin, { active: true });
    ck('and on Enable, enabled', (await active(asha.id)) === true);
    let r = await call('PATCH', `/api/admin/members/${asha.id}/toggle`, admin);
    ck('a phone on the previous bundle (no body) still flips', r.status === 200 && r.json.active === false, r.text);
    await pool.query('UPDATE users SET active = true');
    r = await call('PATCH', `/api/admin/members/${admin.id}/toggle`, admin);
    ck('the members route cannot touch the admin account', (r.status === 400 || r.status === 404) && (await active(admin.id)) === true, r.text);
    r = await call('PATCH', `/api/admin/coaches/${admin.id}/toggle`, admin, { active: false });
    ck('an admin cannot disable themselves', r.status === 400 && (await active(admin.id)) === true, r.text);
    r = await call('PATCH', `/api/admin/members/${coachA.id}/toggle`, admin, { active: false });
    ck('the members route cannot disable a coach', r.status === 404 && (await active(coachA.id)) === true, r.text);
    r = await call('PATCH', `/api/admin/monitors/${coachB.id}/toggle`, admin, { active: false });
    ck('the coach route (and its legacy alias) disables a coach', r.status === 200 && (await active(coachB.id)) === false, r.text);
    await pool.query('UPDATE users SET active = true');
    ck('an id that does not exist is a 404, not a 500', (await call('PATCH', '/api/admin/members/99999/toggle', admin, { active: false })).status === 404);
  }

  // ── G ───────────────────────────────────────────────────────────────────────
  console.log('\n[G] assigning a coach');
  {
    const activeFor = async () => (await q(`SELECT monitor_id FROM monitor_patients WHERE patient_id=$1 AND active`, [asha.id])).map(r => r.monitor_id);
    for (let i = 0; i < 4; i++) {
      await Promise.all([call('POST', '/api/admin/assign', admin, { monitor_id: coachA.id, patient_id: asha.id }),
                         call('POST', '/api/admin/assign', admin, { monitor_id: coachB.id, patient_id: asha.id })]);
    }
    const now = await activeFor();
    ck('two assigns at once never leave a member with two coaches', now.length === 1, now);
    let r = await call('POST', '/api/admin/assign', admin, { monitor_id: coachA.id, patient_id: coachB.id });
    ck('a coach cannot be assigned as if they were a member', r.status === 404, r.text);
    r = await call('POST', '/api/admin/assign', admin, { monitor_id: coachA.id, patient_id: asha.id });
    ck('a normal assign works and is the only active link', r.status === 200 && (await activeFor()).join() === String(coachA.id), await activeFor());
  }

  // ── H ───────────────────────────────────────────────────────────────────────
  console.log('\n[H] double submits');
  {
    const count = async (sql, p) => (await q(`SELECT count(*)::int c FROM ${sql}`, p))[0].c;
    let rr = await twice('POST', `/api/members/${asha.id}/notes`, coachA, { note: 'Twice', note_date: today });
    ck('a coach note sent twice at once is stored once', await count(`monitor_notes WHERE note='Twice'`) === 1 && rr.every(x => x.status < 300) && rr[0].json.id === rr[1].json.id, rr.map(x => x.status));
    rr = await twice('POST', '/api/members/me/notes/reply', asha, { note: 'Thanks coach' });
    ck('a member reply sent twice at once is stored once', await count(`monitor_notes WHERE note='Thanks coach'`) === 1 && rr.every(x => x.status === 201), rr.map(x => x.status));
    rr = await twice('POST', `/api/members/${asha.id}/labs`, coachA, { test_name: 'HbA1c', value: 5.6, unit: '%', test_date: today });
    ck('a lab value sent twice at once is stored once', await count(`lab_values WHERE test_name='HbA1c'`) === 1 && rr.every(x => x.status < 300), rr.map(x => x.status));
    const r = await call('POST', `/api/members/${asha.id}/labs`, coachA, { test_name: 'HbA1c', value: 5.9, unit: '%', test_date: today });
    ck('a different value for the same test is a new row', r.status === 201 && await count(`lab_values WHERE test_name='HbA1c'`) === 2, r.text);
    const r2 = await call('POST', `/api/members/${asha.id}/notes`, coachA, { note: 'Different words', note_date: today });
    ck('a different note is a new row', r2.status === 201);
  }

  // ── I ───────────────────────────────────────────────────────────────────────
  console.log('\n[I] voice logging');
  {
    await pool.query('DELETE FROM daily_logs');
    const voiceTok = (await call('POST', '/api/quick-log/token', asha, {})).json.token;
    const say = (text) => fetch(base + '/api/quick-log', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + voiceTok }, body: JSON.stringify({ text }) }).then(r => r.json());
    const food = (name) => JSON.stringify({ foods: [{ name, grams: 80, meal: 'Lunch', per_100g: { calories: 297, protein: 9, carbs: 50, fat: 7 } }], reply: 'ok' });
    aiAnswer = async (body) => { await nap(120); const sent = JSON.stringify(body); return food(/curd/i.test(sent.slice(-400)) ? 'Curd' : 'Roti'); };
    const [a, b] = await Promise.all([say('two roti for lunch'), say('two roti for lunch')]);
    let row = await dayRow();
    ck('the same sentence sent twice at once is logged once', row?.food_items?.length === 1 && (a.duplicate === true || b.duplicate === true), { n: row?.food_items?.length, a, b });
    ck('both callers hear the same answer', a.reply === b.reply && /Logged/.test(a.reply), [a.reply, b.reply]);
    const c = await say('two roti for lunch');
    row = await dayRow();
    ck('a retry a moment later is not logged again', row.food_items.length === 1 && c.duplicate === true && c.ok === true, { n: row.food_items.length, c });
    await pool.query(`UPDATE quick_log_turns SET created_at = NOW() - INTERVAL '2 minutes'`);
    await say('two roti for lunch');
    ck('saying it again two minutes later IS a second log', (await dayRow()).food_items.length === 2);
    // two DIFFERENT sentences at the same moment: both must land (read-modify-write under the lock)
    await pool.query('DELETE FROM daily_logs');
    aiAnswer = async (body) => { await nap(60); const s = JSON.stringify(body); const i = s.lastIndexOf('a bowl of curd'), j = s.lastIndexOf('one roti now'); return food(i > j ? 'Curd' : 'Roti'); };
    await Promise.all([say('a bowl of curd'), say('one roti now')]);
    const names = (await dayRow()).food_items.map(f => f.name).sort().join(',');
    ck('two different sentences at the same moment are both kept', names === 'Curd,Roti', names);
    aiAnswer = () => '{}';
    await pool.query('DELETE FROM daily_logs');
  }

  // ── J ───────────────────────────────────────────────────────────────────────
  console.log('\n[J] reminder data is per coach');
  {
    await pool.query(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_name, active) VALUES ($1,'https://e/1','p','a','Bala phone',true)`, [bala.id]);
    await pool.query(`INSERT INTO reminder_schedules (patient_id, type, times, active) VALUES ($1,'water','{09:00}',true), ($2,'water','{10:00}',true), (NULL,'weight','{07:00}',true)`, [bala.id, asha.id]);
    let r = await call('GET', `/api/reminders/subscriptions/${bala.id}`, coachA);
    ck("a coach cannot list another coach's member's devices", r.status === 403 && !/Bala/.test(r.text), r.text);
    ck('their own coach can', (await call('GET', `/api/reminders/subscriptions/${bala.id}`, coachB)).json?.length === 1);
    r = await call('GET', '/api/reminders/schedules', coachA);
    ck("a coach's schedule list has their members and the global ones, nobody else's",
      r.status === 200 && !/Bala/.test(r.text) && r.json.some(s => s.patient_name === 'Asha') && r.json.some(s => s.patient_id === null), r.text.slice(0, 200));
    ck('an admin still sees all of them', (await call('GET', '/api/reminders/schedules', admin)).json.length === 3);
  }

  // ── K ───────────────────────────────────────────────────────────────────────
  console.log('\n[K] a changed credential ends other sessions');
  {
    const bcrypt = require('bcryptjs');
    await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [await bcrypt.hash('1234', 4), asha.id]);
    const login = async (pin, ip) => call('POST', '/api/auth/pin-login', null, { phone: '9000000001', pin }, { 'x-forwarded-for': ip });
    const refresh = (t) => call('POST', '/api/auth/refresh', null, { refreshToken: t });
    const phoneA = (await login('1234', '10.0.0.1')).json, phoneB = (await login('1234', '10.0.0.2')).json;
    ck('two devices are signed in', !!phoneA?.refreshToken && !!phoneB?.refreshToken && (await refresh(phoneB.refreshToken)).status === 200);
    const legacy = jwt.sign({ id: asha.id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
    ck('a token issued before this change (no version) still works: nobody is signed out by the deploy', (await refresh(legacy)).status === 200);
    // the member changes their PIN on phone A
    const ch = await call('PATCH', '/api/auth/change-pin', asha, { currentPin: '1234', newPin: '5678' });
    ck('changing the PIN works and returns a fresh session for this device', ch.status === 200 && !!ch.json?.refreshToken && !!ch.json?.accessToken, ch.text.slice(0, 120));
    ck('the device that changed it stays signed in', (await refresh(ch.json.refreshToken)).status === 200);
    ck('the other device is signed out', (await refresh(phoneB.refreshToken)).status === 401);
    ck('and so is any older token', (await refresh(legacy)).status === 401 && (await refresh(phoneA.refreshToken)).status === 401);
    // the coach resets it (lost phone)
    const before = (await login('5678', '10.0.0.3')).json;
    const rs = await call('PATCH', `/api/members/${asha.id}/pin`, coachA, { pin: '9999' });
    ck('a coach PIN reset signs the member out everywhere', rs.status === 200 && (await refresh(before.refreshToken)).status === 401 && (await refresh(ch.json.refreshToken)).status === 401, rs.text);
    const again = (await login('9999', '10.0.0.4')).json;
    const ad = await call('PATCH', `/api/admin/members/${asha.id}/pin`, admin, { pin: '4321' });
    ck('an admin PIN reset does too', ad.status === 200 && (await refresh(again.refreshToken)).status === 401, ad.text);
    ck('and the new PIN signs in', (await login('4321', '10.0.0.5')).status === 200);
    // coach password
    await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [await bcrypt.hash('old-password', 4), coachA.id]);
    const cl = (await call('POST', '/api/auth/login', null, { email: 'a@x.in', password: 'old-password' }, { 'x-forwarded-for': '10.0.1.1' })).json;
    const cp = await call('PATCH', '/api/auth/change-password', coachA, { currentPassword: 'old-password', newPassword: 'new-password-1' });
    ck('a coach changing their password keeps this session and ends the others', cp.status === 200 && (await refresh(cp.json.refreshToken)).status === 200 && (await refresh(cl.refreshToken)).status === 401, cp.text.slice(0, 100));
    ck('GET /auth/me says who the token belongs to', (await call('GET', '/api/auth/me', coachA)).json?.id === coachA.id && (await call('GET', '/api/auth/me', null)).status === 401);
  }

  // ── L ───────────────────────────────────────────────────────────────────────
  console.log('\n[L] deleting a member removes their photos first');
  {
    const real = { isConfigured: storage.isConfigured, deleteObject: storage.deleteObject };
    const gone = []; let failing = false, configured = true;
    storage.isConfigured = () => configured;
    storage.deleteObject = async (key) => { if (failing) throw new Error('R2 unreachable'); gone.push(key); };
    const doomed = await mk('Chitra', '9000000009', null, 'patient');
    await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [doomed.id]);
    await pool.query(`INSERT INTO progress_photos (patient_id, week_date, pose, object_key) VALUES ($1,$2,'front','progress/c/front.jpg'), ($1,$2,'side','progress/c/side.jpg')`, [doomed.id, today]);
    await pool.query(`INSERT INTO meal_photos (patient_id, log_date, meal, object_key, analysis) VALUES ($1,$2,'Lunch','meals/c/1.jpg','{}'), ($1,$2,'Dinner',NULL,'{}')`, [doomed.id, today]);
    const exists = async () => (await q(`SELECT 1 FROM users WHERE id=$1`, [doomed.id])).length === 1;
    configured = false;
    let r = await call('DELETE', `/api/admin/members/${doomed.id}`, admin, { confirm_name: 'Chitra' });
    ck('with photo storage not set up, nothing is deleted and the reason is given', r.status === 503 && /3 photo/.test(r.json?.error || '') && await exists(), r.text);
    configured = true; failing = true;
    r = await call('DELETE', `/api/admin/members/${doomed.id}`, admin, { confirm_name: 'Chitra' });
    ck('if storage cannot be reached, nothing is deleted', r.status === 502 && await exists(), r.text);
    failing = false;
    r = await call('DELETE', `/api/admin/members/${doomed.id}`, admin, { confirm_name: 'Chitra' });
    ck('otherwise every photo is removed from storage, then the member', r.status === 200 && !(await exists()) && gone.sort().join() === 'meals/c/1.jpg,progress/c/front.jpg,progress/c/side.jpg', { s: r.status, gone });
    const plain = await mk('Dev', '9000000010', null, 'patient');
    r = await call('DELETE', `/api/admin/members/${plain.id}`, admin, { confirm_name: 'Dev' });
    ck('a member with no photos is deleted as before', r.status === 200, r.text);
    r = await call('DELETE', `/api/admin/members/${asha.id}`, admin, { confirm_name: 'wrong name' });
    ck('the typed-name check is unchanged', r.status === 400, r.status);
    Object.assign(storage, real);
  }

  // ── M ───────────────────────────────────────────────────────────────────────
  console.log('\n[M] rate limits are per address');
  {
    const bad = (ip) => call('POST', '/api/auth/login', null, { email: 'b@x.in', password: 'wrong' }, { 'x-forwarded-for': ip });
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await bad('203.0.113.7')).status);
    ck('ten wrong passwords from one address, then that address is limited', statuses.slice(0, 10).every(s => s === 401) && statuses[10] === 429, statuses);
    ck('someone at a different address is NOT locked out by them', (await bad('198.51.100.9')).status === 401);
  }

  // ── N ───────────────────────────────────────────────────────────────────────
  console.log('\n[N] the app: edits made while a save is in flight (real client code)');
  {
    const L = importClient('utils/logSync.js');
    const serverRow = (over = {}) => ({ weight_kg: '80.0', activities: { walk: true }, acv: {}, supplements: {}, sleep: {}, notes: '', water_ml: 250,
      food_items: [{ id: 1, name: 'Idli', grams: 100, meal: 'Breakfast' }], saved_at: '2026-10-06T10:00:05.000Z', ...over });
    const sent = L.mapServerLog(serverRow({ saved_at: '2026-10-06T10:00:00.000Z', activities: {} }));
    const answer = { queued: false, data: serverRow() };
    let p = L.resolveSave({ now: { date: 'D', log: sent, saving: true }, sentDate: 'D', sentLog: sent, isLatest: true, result: answer });
    ck("nothing changed meanwhile: the server's copy is adopted and the day is clean", p.saved === true && p.dirty === false && p.log.activities.walk === true && p.log.savedAt === answer.data.saved_at, p);
    const editedMeanwhile = { ...sent, supplements: { d3: true } };
    p = L.resolveSave({ now: { date: 'D', log: editedMeanwhile, saving: true }, sentDate: 'D', sentLog: sent, isLatest: true, result: answer });
    ck('a tick made while the save was in flight is NOT wiped by the answer', p.log.supplements.d3 === true && p.saved === undefined, p);
    ck('but the base moves forward, so the next save is measured against the server', p.log.savedAt === answer.data.saved_at && p.log.base.activities.walk === true, p.log);
    p = L.resolveSave({ now: { date: 'YESTERDAY', log: { other: true }, saving: true }, sentDate: 'D', sentLog: sent, isLatest: true, result: answer });
    ck("an answer for a day no longer on screen does not land in the other day", p && p.log === undefined && p.saving === false, p);
    const newerBase = { ...sent, savedAt: '2026-10-06T10:00:09.000Z' };
    p = L.resolveSave({ now: { date: 'D', log: newerBase, saving: true }, sentDate: 'D', sentLog: sent, isLatest: false, result: answer });
    ck('an older answer arriving after a newer one never moves the base backwards', p === null, p);
    p = L.resolveSave({ now: { date: 'D', log: sent, saving: true }, sentDate: 'D', sentLog: sent, isLatest: true, result: { queued: true } });
    ck('a queued (offline) save is still reported as safe on this phone', p.saved === true && p.queued === true, p);
    const body = L.mapToServer(L.mapServerLog(serverRow()), null);
    ck('every save tells the server what the day looked like when loaded', body.base_saved_at === '2026-10-06T10:00:05.000Z' && body.base_fields.water_ml === 250 && body.base_fields.food['1'] === '100|Breakfast' && body.base_food_ids.join() === '1', body.base_fields);
    ck('a day never saved sends the empty base', JSON.stringify(L.mapToServer(L.mapServerLog({}), null).base_fields.activities) === '{}' && L.mapToServer({ food: [] }, null).base_fields === L.EMPTY_BASE);
    ck('a background refresh is refused while there is an unsaved edit, a save in flight, or a pending autosave',
      L.canRefresh({ dirty: false, saving: false, loading: false }) === true && !L.canRefresh({ dirty: true }) && !L.canRefresh({ saving: true }) && !L.canRefresh({}, true));
  }

  // ── O ───────────────────────────────────────────────────────────────────────
  console.log('\n[O] sign out (source contract — the behaviour needs a browser, see QA-REPORT)');
  {
    const src = (f) => fs.readFileSync(path.join(SRV, '../client/src', f), 'utf8');
    const store = src('store/authStore.js'), app = src('App.jsx');
    ck("the store's logout calls the server (the Profile button uses the store's, nothing else)", /fetch\('\/api\/auth\/logout'/.test(store) && /markSignedOut\(\)/.test(store));
    ck('boot does not restore a session after a deliberate sign-out', /if \(wasSignedOut\(\)\)/.test(app) && app.indexOf('wasSignedOut()') < app.indexOf(".post('/api/auth/refresh'"));
    ck('a real sign-in clears that flag', /clearSignedOut\(\)/.test(store));
    const out = await fetch(base + '/api/auth/logout', { method: 'POST' });
    const cookies = out.headers.getSetCookie ? out.headers.getSetCookie().join(';') : String(out.headers.get('set-cookie'));
    ck('the server logout clears both cookies', /refreshToken=;/.test(cookies) && /accessToken=;/.test(cookies), cookies);
  }

  console.log(`\n${fail === 0 ? '\u2705' : '\u274c'} test-audit: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.error('test-audit crashed:', err); process.exit(1); });
