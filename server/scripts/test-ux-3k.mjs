/**
 * scripts/test-ux-3k.mjs — Fixes-3k (5 Nov 2026): UX fix plan Phase 2a (claude/FitLife-UX-Fix-Plan-2026-11-05.md).
 *
 * Finding 3: a member with no coach selection was shown 7 "FitLife standard" supplements and 3 ACV doses nobody
 * prescribed. Sachin's decision (5 Nov): KEEP EXISTING MEMBERS EXACTLY AS THEY ARE, CHANGE NEW ONES. A new column,
 * patient_profiles.protocol_default_none, is NULL on every row that existed before 3k (old meaning: no selection =
 * every built-in item) and TRUE on rows created from 3k on (no selection for ACV/supplements = none, only the coach's
 * own items). TRUE is written only where a member is created (POST /api/admin/members, POST /api/patients); no column
 * default, so any other row (old members, lazily made rows, test fixtures) keeps the old meaning. Activities: unchanged.
 *
 *   [1] the migration on a scratch Postgres: rows from before keep NULL; no default; a second boot changes nothing;
 *   [2] the REAL client rule (resolveProtocolItems, computeProtocolTotal, pendingLabels) for both kinds of member;
 *   [3] the REAL server rules agree (protocolTotalFor, AI parser context, coach-AI summary, gap nudges, AI routine text);
 *   [4] real Postgres through the real routes: the day's protocol, the score, a save without a total, the coach's AI
 *       command, the admin editor's save for a member with no profile row;
 *   [5] reminders: no apple cider vinegar reminder for a member with none in force; existing members still get theirs;
 *   [6] the coach's protocol editor in jsdom (the REAL component), both kinds of member;
 *   [7] member wording and colours (finding 8 and 12).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) { console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1); }
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../client/src');
const SCHEMA = fs.readFileSync(path.resolve(HERE, '../db/schema.sql'), 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-ux-3k-'));
fs.writeFileSync(path.join(TMP, 'no-axios.js'), "const no = () => { throw new Error('test-ux-3k: a real HTTP request was attempted'); }; const ax = { create: () => ax, get: no, post: no, put: no, patch: no, delete: no, request: no, interceptors: { request: { use() {} }, response: { use() {} } }, defaults: { headers: { common: {} } } }; export default ax; export const isAxiosError = () => false;");
const { importClient } = require('./lib/client-bundle');
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 400))); };
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));
const ids = (xs) => xs.map(x => x.id).join(',');
const NEW = { default_none: true }, OLD = {};

let srv, pool, dayBundle;
const made = [];
try {
  const { Client } = require('pg');
  pool = require('../db/pool');

  console.log('\n[1] the migration (a scratch database, the real schema.sql)');
  {
    const base = new URL(process.env.DATABASE_URL);
    const name = `fitlife_ux3k_mig_${process.pid}`;
    const admin = new Client({ connectionString: Object.assign(new URL(base), { pathname: '/postgres' }).toString() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`); await admin.query(`CREATE DATABASE ${name}`);
    const db = new Client({ connectionString: Object.assign(new URL(base), { pathname: '/' + name }).toString() });
    await db.connect();
    try {
      await db.query(SCHEMA);
      // The state just before Fixes-3k: the column did not exist. Two existing members, one with a coach selection.
      await db.query(`ALTER TABLE patient_profiles DROP COLUMN protocol_default_none`);
      const u = async (n, p) => (await db.query(`INSERT INTO users (name,phone,role) VALUES ($1,$2,'patient') RETURNING id`, [n, p])).rows[0].id;
      const a = await u('Existing A', '9000000901'), b = await u('Existing B', '9000000902');
      await db.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [a]);
      await db.query(`INSERT INTO patient_profiles (user_id, protocol_supplements) VALUES ($1, '["d3"]')`, [b]);
      await db.query(SCHEMA);                                  // the first boot of Fixes-3k
      const flag = async (id) => (await db.query(`SELECT protocol_default_none AS f FROM patient_profiles WHERE user_id=$1`, [id])).rows[0].f;
      ck('rows that existed before Fixes-3k keep NULL (old meaning: their supplements and ACV stay exactly as they were)', (await flag(a)) === null && (await flag(b)) === null, [await flag(a), await flag(b)]);
      const c = await u('Lazy C', '9000000903');
      await db.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [c]);
      ck('a row made later without saying so (a lazy insert for an old member) also keeps the old meaning (NULL)', (await flag(c)) === null, await flag(c));
      await db.query(`UPDATE patient_profiles SET protocol_default_none = TRUE WHERE user_id=$1`, [c]);
      await db.query(SCHEMA);                                  // a later boot
      ck('a second boot changes nothing (NULL stays NULL, TRUE stays TRUE)', (await flag(a)) === null && (await flag(c)) === true);
      const d = (await db.query(`SELECT column_default FROM information_schema.columns WHERE table_name='patient_profiles' AND column_name='protocol_default_none'`)).rows[0]?.column_default;
      ck('no column default (TRUE is set only where a member is created)', d == null, d);
    } finally { await db.end(); await admin.query(`DROP DATABASE IF EXISTS ${name}`); await admin.end(); }
  }

  console.log('\n[2] the client rule, both kinds of member');
  const day = importClient('lib/day/index.js');
  const sync = importClient('utils/logSync.js');
  const ROW = { custom_activities: [], custom_acv: [], custom_supplements: [] };   // the real shape: custom lists default to []
  let r = day.resolveProtocolItems({ ...OLD, ...ROW });
  ck('EXISTING member, nothing chosen → 6 activities, 3 ACV, 7 supplements (exactly as before 3k)', r.activeActivities.length === 6 && r.activeACV.length === 3 && r.activeSupplements.length === 7, [r.activeActivities.length, r.activeACV.length, r.activeSupplements.length]);
  r = day.resolveProtocolItems(null);
  ck('no protocol at all (an old app or a loading screen) → the old meaning too (6 / 3 / 7)', r.activeACV.length === 3 && r.activeSupplements.length === 7);
  r = day.resolveProtocolItems({ ...NEW, ...ROW });
  ck('NEW member, nothing chosen → 6 activities, NO ACV, NO supplements', r.activeActivities.length === 6 && r.activeACV.length === 0 && r.activeSupplements.length === 0, [r.activeActivities.length, r.activeACV.length, r.activeSupplements.length]);
  r = day.resolveProtocolItems(day.protocolFromProfile({ protocol_default_none: true, protocol_acv: null, protocol_supplements: null, ...ROW }));
  ck('…the same from a profile row (protocol_default_none), as Plan and the coach\'s day view read it', r.activeACV.length === 0 && r.activeSupplements.length === 0);
  r = day.resolveProtocolItems({ ...NEW, custom_supplements: [{ id: 'cx1', label: 'Iron 60 mg' }], custom_acv: [{ id: 'cacv', label: 'ACV at lunch' }] });
  ck('NEW member: the coach\'s OWN items count with nothing chosen', ids(r.activeSupplements) === 'cx1' && ids(r.activeACV) === 'cacv', [ids(r.activeSupplements), ids(r.activeACV)]);
  for (const [who, p] of [['existing', OLD], ['new', NEW]]) {
    r = day.resolveProtocolItems({ ...p, acv: ['acv1'], supplements: ['d3', 'multi'] });
    ck(`${who} member: an explicit selection is honoured exactly (acv1; d3, multi)`, ids(r.activeACV) === 'acv1' && ids(r.activeSupplements) === 'd3,multi');
    r = day.resolveProtocolItems({ ...p, acv: [], supplements: [] });
    ck(`${who} member: an explicit empty choice → none`, r.activeACV.length === 0 && r.activeSupplements.length === 0);
  }
  ck('activities are the same for both (null = the 6 standard ones)', day.resolveProtocolItems({ ...NEW }).activeActivities.length === 6 && day.resolveProtocolItems(OLD).activeActivities.length === 6);
  const T = (p) => sync.computeProtocolTotal(p);
  ck('NEW member: the score total is exactly what Today lists (6; own items add; explicit lists as they are)',
    T({ ...NEW, ...ROW }) === 6 && T({ ...NEW, ...ROW, custom_supplements: [{ id: 'x' }] }) === 7 && T({ ...NEW, activities: ['walk'], acv: ['acv1'], supplements: ['d3', 'multi'] }) === 4,
    [T({ ...NEW, ...ROW }), T({ ...NEW, ...ROW, custom_supplements: [{ id: 'x' }] })]);
  // QA review of 3k (C1): existing members' scores must not change, so their total is the pre-3k formula, quirks included.
  const preT = (p) => (p.activities ? p.activities.length : p.custom_activities?.length ?? 6) + (p.acv ? p.acv.length : p.custom_acv?.length ?? 3) + (p.supplements ? p.supplements.length : p.custom_supplements?.length ?? 7);
  const shapes = [{ ...ROW }, {}, { ...ROW, custom_supplements: [{ id: 'x' }] }, { ...ROW, supplements: ['d3', 'multi', 'b12', 'flax', 'yeast'] }, { ...ROW, activities: ['walk', 'sun', 'steps1', 'steps2'] }, { activities: ['walk'], acv: ['acv1'], supplements: [] }];
  ck('EXISTING member: the score total is exactly the pre-3k number for every shape (so their stored scores do not change)', shapes.every(p => T({ ...OLD, ...p }) === preT(p)), shapes.map(p => [T({ ...OLD, ...p }), preT(p)]));
  const pend = (p) => day.pendingLabels({ ...day.resolveProtocolItems(p), log: {} });
  ck('NEW member: "Next" / "Still pending today" names no ACV or supplements', !pend(NEW).some(l => /ACV|supplement/i.test(l)), pend(NEW));
  ck('EXISTING member: still names them, as before', pend(OLD).some(l => /ACV/i.test(l)) && pend(OLD).some(l => /supplement/i.test(l)), pend(OLD));

  console.log('\n[3] the server rules agree');
  const { protocolTotalFor, calcCompliance } = require('../services/compliance');
  const SROW = { custom_activities: [], custom_acv: [], custom_supplements: [] };
  const preS = (p) => { const len = (v, d) => (Array.isArray(v) ? v.length : d); const t = len(p.protocol_activities, len(p.custom_activities, 6)) + len(p.protocol_acv, len(p.custom_acv, 3)) + len(p.protocol_supplements, len(p.custom_supplements, 7)); return t > 0 ? t : null; };
  const sShapes = [{}, { ...SROW }, { ...SROW, custom_supplements: [{ id: 'x' }] }, { ...SROW, protocol_supplements: ['d3', 'multi'] }, { protocol_activities: ['a'], protocol_acv: ['b'], protocol_supplements: ['c', 'd'] }];
  ck('protocolTotalFor, EXISTING member: exactly the pre-3k number for every shape (voice saves score as before)', sShapes.every(p => protocolTotalFor(p) === preS(p)), sShapes.map(p => [protocolTotalFor(p), preS(p)]));
  ck('protocolTotalFor, NEW member: 6, own items add, explicit lists as they are',
    protocolTotalFor({ ...SROW, protocol_default_none: true }) === 6
    && protocolTotalFor({ protocol_default_none: true, custom_acv: [{ id: 'c' }] }) === 7 && protocolTotalFor({ protocol_default_none: true, protocol_activities: ['a'], protocol_acv: ['b'], protocol_supplements: ['c', 'd'] }) === 4,
    [protocolTotalFor({ ...SROW, protocol_default_none: true })]);
  const pairs = [
    [{ ...ROW }, { ...SROW }], [{ ...ROW, ...NEW }, { ...SROW, protocol_default_none: true }],
    [{ ...NEW, custom_supplements: [{ id: 'x' }] }, { protocol_default_none: true, custom_supplements: [{ id: 'x' }] }],
    [{ custom_acv: [{ id: 'y' }] }, { custom_acv: [{ id: 'y' }] }],
    [{ activities: ['walk'], acv: ['acv1'], supplements: [] }, { protocol_activities: ['walk'], protocol_acv: ['acv1'], protocol_supplements: [] }],
  ];
  ck('the app\'s total and the server\'s total agree on every case (both kinds of member; 0 and null both mean "use the floor")', pairs.every(([c, s]) => (T(c) || null) === protocolTotalFor(s)), pairs.map(([c, s]) => [T(c), protocolTotalFor(s)]));
  const { inForceFor } = require('../services/compliance');
  ck('inForceFor: existing member → null (every tick counts, as before); new member → activities all, ACV/supplements only own items or the coach list',
    inForceFor({}) === null && inForceFor({ protocol_default_none: null }) === null
      && (() => { const f = inForceFor({ protocol_default_none: true, custom_acv: [{ id: 'c1' }], protocol_supplements: ['d3'] }); return f.activities === null && [...f.acv].join() === 'c1' && [...f.supplements].join() === 'd3'; })());
  ck('calcCompliance with inForce ignores ticks outside it; without, unchanged', calcCompliance({ walk: true }, { acv1: true }, {}, 6, inForceFor({ protocol_default_none: true })) === 17
    && calcCompliance({ walk: true }, { acv1: true }, {}, 16) === 13);
  const { resolveProtocolGroup } = require('../routes/aiChat');
  const g = (grp, p) => resolveProtocolGroup(grp, p, {});
  const gOld = g('supplements', { ...SROW }), gNew = g('supplements', { ...SROW, protocol_default_none: true });
  ck('coach AI summary (resolveProtocolGroup): an existing member\'s supplements are all 7 (unchanged); a new member has none',
    gOld.total === 7 && gNew.total === 0 && gNew.assigned === false && g('acv', { ...SROW, protocol_default_none: true }).total === 0 && g('acv', { ...SROW }).total === 3, [gOld.total, gNew.total]);
  const gOwn = g('supplements', { protocol_default_none: true, custom_supplements: [{ id: 'cx9', label: 'Iron' }] });
  ck('…a new member\'s own supplement is the only one listed', gOwn.total === 1 && gOwn.left.join() === 'Iron', gOwn);
  const { detectGaps } = require('../services/gapDetector');
  const gaps = (protocol) => detectGaps({ id: 1, name: 'T' }, { acv: {}, supplements: {}, activities: {}, water_ml: 3000 }, protocol, { now: new Date('2026-11-05T15:30:00Z'), daysSince: 0, max: 20 }).gaps.map(x => x.key);
  ck('gap nudges at 21:00: an existing member is still nudged about ACV and supplements', gaps({}).includes('acv') && gaps({}).includes('supplements'), gaps({}));
  ck('…a new member with none assigned is not', !gaps({ default_none: true }).includes('acv') && !gaps({ default_none: true }).includes('supplements'), gaps({ default_none: true }));
  ck('…a new member with an ACV item of the coach\'s own is', gaps({ default_none: true, custom_acv: [{ id: 'c1' }] }).includes('acv'));
  const { routineText } = require('../services/targetOrigin');
  ck('the AI\'s routine text: a new member has "no acv or supplements assigned… do not suggest any"; an existing one keeps "standard FitLife routine"',
    /no acv or supplements assigned/.test(routineText({ protocol_default_none: true })) && /do not suggest any/.test(routineText({ protocol_default_none: true }))
      && /standard FitLife routine for activities, acv, supplements/.test(routineText({})), [routineText({ protocol_default_none: true }), routineText({})]);

  console.log('\n[4] real Postgres through the real routes');
  const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use((q, _r, n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
  app.use('/api/logs', require('../routes/logs'));
  app.use('/api/ai-chat', require('../routes/aiChat'));
  app.use('/api/admin', require('../routes/admin'));
  app.use('/api/patients', require('../routes/patients'));
  srv = app.listen(0, '127.0.0.1'); await new Promise(res => srv.once('listening', res));
  const port = srv.address().port;
  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: 600 });
  const call = async (method, p, t, body) => { const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, data: await res.json().catch(() => ({})) }; };
  const tag = String(Date.now()).slice(-7);
  const mk = async (name, n, role = 'patient') => { const id = (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, `63${tag}${n}`, role])).rows[0].id; made.push(id); return id; };
  const oldM = await mk('UX3k Existing', 2), coach = await mk('UX3k Coach', 3, 'monitor'), admin = await mk('UX3k Admin', 4, 'admin'), bare = await mk('UX3k NoRow', 5);
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [oldM]);                                        // as every existing row
  const created = await call('POST', '/api/admin/members', tok(admin, 'admin'), { name: 'UX3k New', phone: `63${tag}1` });   // as the coach adds a member
  const newM = created.data?.id; if (newM) made.push(newM);
  const created2 = await call('POST', '/api/patients', tok(admin, 'admin'), { name: 'UX3k New 2', phone: `63${tag}9` });
  const newM2 = created2.data?.id ?? created2.data?.patient?.id ?? created2.data?.user?.id; if (newM2) made.push(newM2);
  await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true), ($1,$3,true)`, [coach, newM, oldM]);
  const flagOf = async (id) => (await pool.query(`SELECT protocol_default_none AS f FROM patient_profiles WHERE user_id=$1`, [id])).rows[0]?.f;
  ck('a member created by the admin screen (POST /admin/members) gets the new rule (TRUE)', created.status === 201 && (await flagOf(newM)) === true, [created.status, created.data]);
  ck('…and one created through POST /patients too', (created2.status === 201 || created2.status === 200) && (await flagOf(newM2)) === true, [created2.status, JSON.stringify(created2.data).slice(0, 120)]);
  ck('an existing member\'s row (and any row made without saying so) is NULL: the old meaning', (await flagOf(oldM)) === null);
  const day0 = (await pool.query(`SELECT ((NOW() AT TIME ZONE 'Asia/Kolkata')::date)::text AS d`)).rows[0].d;
  const getDay = async (id) => (await call('GET', `/api/logs/${day0}`, tok(id, 'patient'))).data;
  const dNew = await getDay(newM), dOld = await getDay(oldM);
  ck('GET /logs/:date tells the app which rule applies (new: default_none true; existing: false)', dNew?.protocol?.default_none === true && dOld?.protocol?.default_none === false, [dNew?.protocol?.default_none, dOld?.protocol?.default_none]);
  const save = async (id, body) => { const s = await call('POST', `/api/logs/${day0}`, tok(id, 'patient'), { activities: { walk: true }, acv: {}, supplements: {}, water_ml: 750, ...body }); return { s, pct: (await pool.query(`SELECT compliance_pct FROM daily_logs WHERE patient_id=$1 AND log_date=$2`, [id, day0])).rows[0]?.compliance_pct }; };
  let sv = await save(newM, { protocol_total: T(dNew.protocol) });
  ck(`NEW member, walk ticked, nothing assigned → ${sv.pct}% (1 of 6 = 17%; before 3k: 1 of 16 = 6%)`, sv.s.status < 300 && sv.pct === 17, [sv.s.status, sv.pct, T(dNew.protocol)]);
  sv = await save(oldM, { protocol_total: T(dOld.protocol) });
  ck(`EXISTING member, the same day → ${sv.pct}% (1 of 16 = 6%, exactly as before)`, sv.s.status < 300 && sv.pct === 6, [sv.s.status, sv.pct, T(dOld.protocol)]);
  sv = await save(newM, { activities: { walk: true, sun: true } });
  ck(`a save with no total (an older app) → the member's own total, not the 16 floor: new member 2 of 6 = ${sv.pct}% (33%)`, sv.pct === 33, sv.pct);
  sv = await save(oldM, { activities: { walk: true, sun: true } });
  ck(`…an existing member without a total: 2 of 16 = ${sv.pct}% (13%, as before)`, sv.pct === 13, sv.pct);
  sv = await save(newM, { acv: { acv1: true, acv2: true, acv3: true }, supplements: { d3: true, b12: true }, protocol_total: 6 });
  ck(`ticks of items a NEW member does not have (3 ACV, 2 supplements, e.g. from an old app) do not raise the score: walk only → ${sv.pct}% (17%)`, sv.pct === 17, sv.pct);
  sv = await save(oldM, { acv: { acv1: true }, protocol_total: 16 });
  ck(`…an EXISTING member's ACV tick still counts, as before: 2 of 16 → ${sv.pct}% (13%)`, sv.pct === 13, sv.pct);
  const ctx = require('../services/memberParse');
  const pcN = await ctx.buildParseContext(newM, { istDate: day0 }), pcO = await ctx.buildParseContext(oldM, { istDate: day0 });
  ck('AI parser context: the new member has no ACV or supplements to tick; the existing member still has the stock ones',
    pcN.acv.length === 0 && pcN.supplements.length === 0 && pcO.acv.length === 3 && pcO.supplements.length === 7, [pcN.acv.length, pcN.supplements.length, pcO.acv.length, pcO.supplements.length]);

  // The coach's AI command "add D3" / "remove fish oil".
  const apply = (id, supplements) => call('POST', '/api/ai-chat/coach-apply', tok(coach, 'monitor'), { actions: [{ member_id: id, member_name: 'x', resolved: true, is_all: false,
    ops: { water_target: null, macros: null, target_weight: null, program: null, activities: null, acv: null, supplements, note: null, push: null, meal_plan: null } }] });
  const supOf = async (id) => (await pool.query(`SELECT protocol_supplements AS s, custom_supplements AS c FROM patient_profiles WHERE user_id=$1`, [id])).rows[0];
  await pool.query(`UPDATE patient_profiles SET custom_supplements='[{"id":"cx_own","label":"Iron 60 mg"}]' WHERE user_id=$1`, [newM]);
  let a = await apply(newM, { add: ['d3'] });
  let s = await supOf(newM);
  ck('coach AI "add D3" for a NEW member → exactly D3 plus the coach\'s own Iron (not all seven)', a.status === 200 && JSON.stringify([...(s.s || [])].sort()) === JSON.stringify(['cx_own', 'd3']), [a.status, a.data?.results, s.s]);
  a = await apply(oldM, { remove: ['fishoil'] });
  s = await supOf(oldM);
  ck('coach AI "remove fish oil" for an EXISTING member → the other six stay (unchanged behaviour)', a.status === 200 && s.s?.length === 6 && !s.s.includes('fishoil'), [a.status, s.s]);
  await pool.query(`UPDATE patient_profiles SET protocol_supplements=NULL, custom_supplements='[]' WHERE user_id=$1`, [newM]);
  a = await apply(newM, { remove: ['fishoil'] });
  s = await supOf(newM);
  ck('coach AI "remove fish oil" for a NEW member with nothing assigned → still nothing (it never assigns the other six)', a.status === 200 && Array.isArray(s.s) && s.s.length === 0, s.s);

  // The admin editor's save, for a member who had no profile row at all (only possible for very old members).
  const put = await call('PUT', `/api/admin/members/${bare}`, tok(admin, 'admin'), { name: 'UX3k NoRow', phone: `63${tag}5`, protocol_supplements: null, protocol_acv: null });
  ck('admin save for a member with NO profile row creates it on the OLD rule (NULL): they existed before 3k', put.status === 200 && (await flagOf(bare)) === null, [put.status, put.data?.error, await flagOf(bare)]);
  const put2 = await call('PUT', `/api/admin/members/${newM}`, tok(admin, 'admin'), { name: 'UX3k New', phone: `63${tag}1` });
  ck('…and an admin save never changes an existing row\'s rule (new member stays TRUE)', put2.status === 200 && (await flagOf(newM)) === true && put2.data?.protocol_default_none === true, [put2.status, await flagOf(newM)]);

  console.log('\n[5] apple cider vinegar reminders');
  {
    const { getSchedulesForTime } = require('../services/cronService');
    const at = '03:17';
    const rs = (await pool.query(`INSERT INTO reminder_schedules (patient_id, type, times, active) VALUES (NULL,'acv',ARRAY[$1],true), (NULL,'water',ARRAY[$1],true) RETURNING id`, [at])).rows.map(x => x.id);
    try {
      const ownAcv = await mk('UX3k OwnACV', 6), chose = await mk('UX3k ChoseACV', 7), off = await mk('UX3k OffACV', 8), offNew = await mk('UX3k OffACVNew', 0);
      await pool.query(`INSERT INTO patient_profiles (user_id, protocol_acv, protocol_default_none) VALUES ($1, '[]', TRUE)`, [offNew]);
      await pool.query(`INSERT INTO patient_profiles (user_id, custom_acv, protocol_default_none) VALUES ($1, '[{"id":"cacv","label":"ACV at lunch"}]', TRUE)`, [ownAcv]);
      await pool.query(`INSERT INTO patient_profiles (user_id, protocol_acv, protocol_default_none) VALUES ($1, '["acv1"]', TRUE)`, [chose]);
      await pool.query(`INSERT INTO patient_profiles (user_id, protocol_acv, protocol_default_none) VALUES ($1, '[]', NULL)`, [off]);
      const rows = await getSchedulesForTime(at);
      const has = (id, type) => rows.some(x => x.uid === id && x.type === type);
      ck('an EXISTING member still gets the ACV reminder (unchanged)', has(oldM, 'acv'));
      ck('a NEW member with no ACV in force gets NO ACV reminder…', !has(newM, 'acv'));
      ck('…but still the water reminder', has(newM, 'water'));
      ck('a NEW member with the coach\'s own ACV item, or a chosen ACV dose, gets it', has(ownAcv, 'acv') && has(chose, 'acv'));
      ck('a NEW member whose coach switched every ACV item off (an empty list) gets none', !has(offNew, 'acv') && has(offNew, 'water'));
      ck('an EXISTING member with an empty ACV list still gets it, exactly as before (QA review of 3k)', has(off, 'acv'));
    } finally { await pool.query(`DELETE FROM reminder_schedules WHERE id = ANY($1)`, [rs]); }
  }

  console.log('\n[6] the coach\'s protocol editor (the real component, in jsdom)');
  {
    const calls = [];
    const apiFile = path.join(TMP, 'api.js');
    fs.writeFileSync(apiFile, `const rec = (m) => async (url, body) => { (window.__calls = window.__calls || []).push({ m, url, body }); return { data: { ...(body || {}), id: 1 } }; };
      export default { get: async () => ({ data: window.__row || [] }), post: rec('post'), put: rec('put'), patch: rec('patch'), delete: rec('delete') };`);
    const out = await build({ stdin: { resolveDir: SRC, loader: 'jsx', contents: `
        import { createRoot } from 'react-dom/client';
        import { EditMemberModal, noneByDefaultFor } from './components/admin/EditMemberModal';
        import DayDetail from './components/coach/DayDetail';
        window.T = { noneByDefaultFor, mount: (member) => { createRoot(document.getElementById('root')).render(<EditMemberModal member={member} onClose={() => {}} onSaved={() => {}} />); },
          day: (profile, log) => { createRoot(document.getElementById('root')).render(<DayDetail activeLog={log} activeDate="2026-11-04" memberId={1} workoutTick={0} data={{ profile }} />); } };` },
      bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty' },
      define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true}' },
      plugins: [{ name: 'stub-api', setup(b) {
        b.onResolve({ filter: /(?:^|\/)client(\.js)?$/ }, x => (/api\/client(\.js)?$/.test(x.path) || (/^\.\/client(\.js)?$/.test(x.path) && /[\\/]api$/.test(x.resolveDir))) ? { path: apiFile } : null);
        b.onResolve({ filter: /^axios$/ }, () => ({ path: path.join(TMP, 'no-axios.js') }));
      } }], logLevel: 'silent' });
    dayBundle = out.outputFiles[0].text;
    const editor = async (member, fullRow = null) => {
      const d = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
      const w = d.window; w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      if (fullRow) w.__row = fullRow;
      w.eval(out.outputFiles[0].text); w.T.mount({ id: 1, name: 'M', phone: '9000000000', ...member }); await tick(80);
      [...w.document.querySelectorAll('button')].find(b => /Protocol/.test(b.textContent))?.click(); await tick(60);
      const section = (title) => { const p = [...w.document.querySelectorAll('p')].find(x => x.textContent.includes(title)); return p?.parentElement; };
      const boxes = (title) => [...(section(title)?.querySelectorAll('input[type="checkbox"]') || [])];
      const ticked = (title) => boxes(title).filter(b => b.checked).length;
      const saveBody = async () => { [...w.document.querySelectorAll('button')].find(b => /Save Changes/.test(b.textContent))?.click(); await tick(80); return (w.__calls || []).find(c => c.m === 'put')?.body; };
      return { w, boxes, ticked, saveBody };
    };
    ck('noneByDefaultFor: only a new member\'s ACV and supplements', (() => { const w = new JSDOM('', { runScripts: 'outside-only' }).window; w.eval(out.outputFiles[0].text);
      return w.T.noneByDefaultFor({ protocol_default_none: true }, 'acv') && w.T.noneByDefaultFor({ protocol_default_none: true }, 'supplements')
        && !w.T.noneByDefaultFor({ protocol_default_none: true }, 'activities') && !w.T.noneByDefaultFor({ protocol_default_none: null }, 'supplements') && !w.T.noneByDefaultFor({}, 'acv'); })());
    let E = await editor({ protocol_default_none: null, custom_acv: [], custom_supplements: [], custom_activities: [] });
    ck(`EXISTING member, nothing chosen: the editor shows all 3 ACV and all 7 supplements ticked (as before) — ${E.ticked('Apple Cider Vinegar')} / ${E.ticked('Supplements')}`, E.ticked('Apple Cider Vinegar') === 3 && E.ticked('Supplements') === 7);
    let body = await E.saveBody();
    ck('…saving without a change keeps "no selection" (null), so nothing changes for them', body && body.protocol_supplements === null && body.protocol_acv === null, body && [body.protocol_supplements, body.protocol_acv]);
    E = await editor({ protocol_default_none: null });
    E.boxes('Supplements')[1].click(); await tick(30);
    body = await E.saveBody();
    ck('…unticking one supplement saves the other six (unchanged behaviour)', body?.protocol_supplements?.length === 6, body?.protocol_supplements);
    E = await editor({ protocol_default_none: true, custom_supplements: [{ id: 'cx_own', label: 'Iron 60 mg', custom: true }] });
    ck(`NEW member, nothing chosen: no built-in ACV or supplement ticked; the coach's own Iron is — ${E.ticked('Apple Cider Vinegar')} / ${E.ticked('Supplements')}`, E.ticked('Apple Cider Vinegar') === 0 && E.ticked('Supplements') === 1);
    E.boxes('Supplements')[1].click(); await tick(30);                    // the second built-in supplement
    body = await E.saveBody();
    ck('…ticking one built-in supplement saves exactly it plus the Iron (never all, never null)', Array.isArray(body?.protocol_supplements) && body.protocol_supplements.length === 2 && body.protocol_supplements.includes('cx_own'), body?.protocol_supplements);
    // QA review of 3k (blocker): the real editor gets the members-LIST row (no protocol columns) and loads the full row.
    E = await editor({}, { protocol_default_none: true, protocol_acv: null, protocol_supplements: null, custom_acv: [], custom_supplements: [], custom_activities: [] });
    ck(`NEW member opened from the members list (the flag arrives with the full row): no built-in ACV or supplement ticked — ${E.ticked('Apple Cider Vinegar')} / ${E.ticked('Supplements')}`, E.ticked('Apple Cider Vinegar') === 0 && E.ticked('Supplements') === 0);
    E.boxes('Supplements')[0].click(); await tick(30);
    body = await E.saveBody();
    ck('…ticking one supplement saves exactly that one (3k draft: unticking saved the other six)', body?.protocol_supplements?.length === 1, body?.protocol_supplements);
    E = await editor({}, { protocol_default_none: null, protocol_acv: null, protocol_supplements: null, custom_acv: [], custom_supplements: [], custom_activities: [] });
    ck('EXISTING member opened from the list: all 3 ACV and 7 supplements ticked, as before', E.ticked('Apple Cider Vinegar') === 3 && E.ticked('Supplements') === 7);
    E = await editor({ protocol_default_none: true });
    for (let i = 0; i < 7; i++) { E.boxes('Supplements')[i].click(); await tick(20); }   // re-found each time: the section re-renders
    body = await E.saveBody();
    ck('…ticking all seven saves the list of seven, not null (null would mean none for this member)', body?.protocol_supplements?.length === 7, body?.protocol_supplements);
  }

  console.log('\n[6b] the coach\'s day view (the real component, in jsdom)');
  {
    const dayView = async (profile, log) => {
      const d = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
      const w = d.window; w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.eval(dayBundle); w.T.day(profile, log); await tick(80);
      return w.document.body.textContent;
    };
    const log = { log_date: '2026-11-04', activities: { walk: true }, acv: { acv2: true }, supplements: {}, food_items: [], water_ml: 500 };
    const ROWP = { protocol_activities: null, protocol_acv: null, protocol_supplements: null, custom_activities: [], custom_acv: [], custom_supplements: [] };
    const oldTxt = await dayView({ ...ROWP }, log), newTxt = await dayView({ ...ROWP, protocol_default_none: true }, log);
    ck('EXISTING member: the day view lists every built-in group as before ("🍎 ACV", "💊 Supplements")', /🍎 ACV/.test(oldTxt) && /💊 Supplements/.test(oldTxt) && !/Apple cider vinegar/.test(oldTxt), oldTxt.slice(0, 300));
    ck('NEW member: no supplements group when none are assigned', !/💊 Supplements/.test(newTxt) && /🏃 Activities/.test(newTxt), newTxt.slice(0, 300));
    ck('NEW member: an ACV dose ticked THAT day still shows (history never loses a tick)', /Apple cider vinegar/.test(newTxt), newTxt.slice(0, 300));
  }

  console.log('\n[7] member wording and colours');
  const prog = fs.readFileSync(path.join(SRC, 'pages/Progress.jsx'), 'utf8');
  const prof = fs.readFileSync(path.join(SRC, 'pages/Profile.jsx'), 'utf8');
  ck('Progress: no red for a low checklist day; the low bar uses the readable `lo` colour; "of checklist" / "30-day checklist", not "compliance"',
    !/red-400/.test(prog) && /: 'bg-lo'/.test(prog) && /% of checklist/.test(prog) && /30-day checklist/.test(prog) && !/% compliance/.test(prog) && !/30-day Compliance/.test(prog));
  ck('Profile: "30-day checklist", not "30-day compliance"', /30-day checklist/.test(prof) && !/30-day compliance/.test(prof));
  ck('Progress calendar: a day with no log uses `lo` text (finding 12: `ghost` was 4.19:1 in dark)', /pct == null \? 'bg-white\/\[0\.04\] text-lo'/.test(prog));
} catch (e) { ck('the suite ran to the end', false, e.stack); }
finally {
  srv?.close();
  try { if (made.length) await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [made]); } catch {}
  try { await pool?.end(); } catch {}
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\nUX fixes 3k (Phase 2a): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
