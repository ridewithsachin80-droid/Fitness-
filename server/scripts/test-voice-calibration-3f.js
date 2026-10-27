/**
 * scripts/test-voice-calibration-3f.js — Fixes-3f: the 3e calibration-kit review (27 Oct 2026). REAL Postgres, the REAL routes,
 * the REAL transcription functions and the REAL parser (callAI with its fallback and retries); only axios.post is stubbed, and
 * the stub counts every outbound request itself. Timing is controlled by holding individual requests or request-start writes.
 *
 *   [1] the two transcription engines: one engine's request-start write fails while the other's is still pending (both orders,
 *       and during Gemini's fallback): the route waits for both, every request that ran is counted, "no call" never sits beside
 *       a request; positive controls: ordinary success (2 requests), both start writes refused (0, "no call");
 *   [2] ownership of queued preview checks: three checks, the first done at "minute 6", the second running, a second tap at
 *       "minute 11" → each check runs ONCE and no result is overwritten; the minute-5 control; the heartbeat keeps an active
 *       check from expiring; abandoned work is still recovered; a tap that lost ownership neither sends its next request nor
 *       saves over the new owner's result (its requests stay counted);
 *   [3] the export never adds older parser checks to request totals: 12 requests + 1 older check → 12, and the check apart, in
 *       the headline and in the deleted / never-kept subtotals;
 *   [4] the REAL upgrade from Fixes-3d: a database built from the 3d schema (the current schema.sql before its Fixes-3e section,
 *       which is byte-identical to d58250c's), holding 3d-shaped attempts, then the current schema twice: an unresolved 3d parser
 *       attempt gets the defensible bound (12, original kept), its start count is reported unknown (not 0), a provider-confirmed
 *       settlement of 2 is accepted (3e refused it), and replays, withdrawal and expiry leave the uncertainty intact.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GEMINI_API_KEY = 'stub-gemini'; process.env.GROQ_API_KEY = 'stub-groq';
process.env.VC_CLAIM_HEARTBEAT_MS = '200';   // the claim heartbeat, fast for the test (60 s in use)
delete process.env.GEMINI_MODEL; delete process.env.GEMINI_FALLBACK_MODEL; delete process.env.GROQ_MODEL; delete process.env.GROQ_FALLBACK_MODEL;
delete process.env.RAILWAY_GIT_BRANCH; delete process.env.FITLIFE_TEST_SERVER;
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const express = require('express');
const jwt = require('jsonwebtoken');

// ── The HTTP stub: counts every outbound request ──
const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
const per = { calories: 120, protein: 3, total_carbs: 20, fat: 3 };
const PREVIEW = JSON.stringify({ weight_kg: null, activities: [], acv: [], supplements: [], water_ml_add: null, sleep: null, workouts: [], corrections: [], reply: 'Got it.',
  foods: [{ name: 'Idli', qty_text: '2 idli', grams: 100, meal: 'Breakfast', per_100g: per }, { name: 'Sambar', qty_text: '1 bowl', grams: 200, meal: 'Breakfast', per_100g: per }] });
const seen = { gemini: 0, whisper: 0, parser: 0 };
let phase = 'transcribe', parserMode = 'ok', parserSeen = 0, gemPlan = [], hold = false;
const held = [];   // parser requests waiting for the test to let them go
const busyErr = () => { const e = new Error('Service Unavailable (stub)'); e.response = { status: 503, data: {} }; return e; };
const stubbedPost = async (url) => {
  const u = String(url);
  if (u === 'https://api.groq.com/openai/v1/audio/transcriptions') { seen.whisper++; return { data: { text: 'eradu idli ondu bowl sambar', language: 'kannada', segments: [] } }; }
  const gem = u.startsWith('https://generativelanguage.googleapis.com/');
  if (gem && phase === 'transcribe') {
    seen.gemini++;
    if ((gemPlan.shift() || 'ok') === '503') throw busyErr();
    return { data: { candidates: [{ content: { parts: [{ text: 'eradu idli ondu bowl sambar' }] }, finishReason: 'STOP' }], modelVersion: 'stub-001' } };
  }
  if (u === 'https://api.groq.com/openai/v1/chat/completions' || gem) {
    seen.parser++; parserSeen++;
    if (hold) await new Promise(res => held.push(res));
    if (parserMode === 'all503') throw busyErr();
    if (parserMode === 'empty-then-ok' && parserSeen === 1) return { data: { choices: [{ finish_reason: 'stop', message: { content: '' } }] } };
    if (gem) return { data: { candidates: [{ content: { parts: [{ text: PREVIEW }] }, finishReason: 'STOP' }] } };
    return { data: { choices: [{ finish_reason: 'stop', message: { content: PREVIEW } }] } };
  }
  throw new Error('Unexpected external request blocked: ' + url);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const storage = require('../services/storage');
const { startR2 } = require('./lib/r2-standin');
const C = require('../services/voiceCalibration');
const FIX = path.join(__dirname, 'fixtures/voice');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
const MARK3E = '-- Fixes-3e (the 3d review): the units are explicit.';

async function startServer(keyId) {
  const KEYS = { id: keyId, secret: 'calibration-3f-secret' };
  const R2 = await startR2(storage, KEYS);
  Object.assign(process.env, { R2_ACCOUNT_ID: 'local', R2_ACCESS_KEY_ID: KEYS.id, R2_SECRET_ACCESS_KEY: KEYS.secret, R2_BUCKET: 'fitlife-test', R2_ENDPOINT: R2.endpoint });
  const pool = require('../db/pool');
  const routes = require('../routes/voiceCalibration');
  const app = express(); app.use(express.json({ limit: '15mb' }));
  app.use('/api/voice-calibration', routes);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const tok = (id, role) => jwt.sign({ id, role, name: 'x' }, process.env.JWT_SECRET, { expiresIn: 600 });
  const http = async (method, u, id, role, body) => {
    const r = await fetch(url + u, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok(id, role)}` }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  return { R2, pool, routes, server, http };
}
const rawOf = (buf) => Object.values(require('../services/xlsxLite').unzipStored(buf)).map(String).join('\n');
const totalsOf = (raw) => { const m = raw.match(/(\d+) transcription call\(s\) and (\d+) parser call\(s\) in the round/); return m ? { t: +m[1], r: +m[2] } : null; };

// ── CHILD for [4]: the routes running against the UPGRADED 3d database ──
if (process.argv[2] === '--upgrade-child') {
  (async () => {
    const S = await startServer('AKIDTESTONLY0020');
    process.env.RAILWAY_GIT_BRANCH = 'test';
    const q = async (sql, a) => (await S.pool.query(sql, a)).rows;
    const admin = (await q(`INSERT INTO users (name,phone,password,role,active) VALUES ('Upgrade Admin','5000000077','x','admin',true) RETURNING id`))[0].id;
    const A = (m, u, b) => S.http(m, u, admin, 'admin', b);
    const out = {};
    out.raw1 = rawOf((await A('GET', '/api/voice-calibration/admin/export.xlsx')).data).match(/UNRESOLVED:[^<]*/)?.[0] || '';
    out.settle2 = await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: 'rule3:legacy-started', calls: 2, why: 'Groq console: two requests at that minute (empty answer, then fallback)' });
    out.settle13 = await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: 'take:legacy-started', calls: 4, why: 'console' });
    out.spend2 = (await q(`SELECT calls, unit, outcome FROM voice_calibration_spend WHERE attempt_key='rule3:legacy-started'`))[0] || null;
    await S.routes.deleteExpiredTakes(S.pool);
    await S.pool.query(SCHEMA);
    const raw2 = rawOf((await A('GET', '/api/voice-calibration/admin/export.xlsx')).data);
    out.raw2 = (raw2.match(/UNRESOLVED:[^<]*/)?.[0] || '') + ' || ' + (raw2.match(/\d+ transcription call\(s\) and[^<]*/)?.[0] || '');
    out.attempts = await q(`SELECT attempt_key, kind, state, max_calls, legacy_max_calls, counting, requests_started, settled, bound_note FROM voice_calibration_attempts ORDER BY attempt_key`);
    console.log('CHILD_RESULT ' + JSON.stringify(out));
    S.server.close(); await S.pool.end().catch(() => {});
    process.exit(0);
  })().catch(e => { console.log('CHILD_RESULT ' + JSON.stringify({ error: e.stack })); process.exit(1); });
  return;
}

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 600))); };
const until = async (f, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await new Promise(r => setTimeout(r, 20)); } return false; };

(async () => {
  const S = await startServer('AKIDTESTONLY0019');
  const { pool, routes, http, R2 } = S;
  const q = async (sql, args) => (await pool.query(sql, args)).rows;
  const TABLES = ['voice_calibration_preview_judgments', 'voice_calibration_preview_evals', 'voice_calibration_takes', 'voice_calibration_participants', 'voice_calibration_wording', 'voice_calibration_partc',
    'voice_calibration_partc_sessions', 'voice_calibration_partc_armed', 'voice_calibration_reviewers', 'voice_calibration_replacement_grants', 'voice_calibration_spend', 'voice_calibration_spend_reconciled',
    'voice_calibration_uploads', 'voice_calibration_attempts'];
  const cleanAll = async () => { for (const t of TABLES) await pool.query(`DELETE FROM ${t}`).catch(() => {}); };
  const tag = Date.now().toString(36);
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1))`);
  const mk = async (name, role = 'patient') => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, '2' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), role])).rows[0].id;
  const exportRaw = async (ADMIN) => rawOf((await http('GET', '/api/voice-calibration/admin/export.xlsx', ADMIN, 'admin')).data);
  process.env.RAILWAY_GIT_BRANCH = 'test';

  // Request-start writes (the hook's UPDATE … requests_started + 1), scripted in the order they are issued. Gemini's hook is
  // always issued before Whisper's (both start in one Promise.allSettled, Gemini first, each reaching its hook synchronously).
  const realQuery = pool.query.bind(pool);
  let startScript = [];
  const releases = [];
  pool.query = (sql, ...a) => {
    if (startScript.length && typeof sql === 'string' && /SET requests_started = requests_started \+ 1/.test(sql)) {
      const act = startScript.shift();
      if (act === 'fail') return Promise.reject(new Error('forced request-start failure (test)'));
      if (act === 'hold') return new Promise((res, rej) => releases.push(() => realQuery(sql, ...a).then(res, rej)));
    }
    return realQuery(sql, ...a);
  };
  const upDb = (() => { const u = new URL(process.env.DATABASE_URL); const name = u.pathname.slice(1) + '_up3f'; const admin = new URL(process.env.DATABASE_URL); admin.pathname = '/postgres'; u.pathname = '/' + name; return { name, url: u.toString(), admin: admin.toString() }; })();

  try {
    await cleanAll();
    const ADMIN = await mk(`Cal Admin ${tag}`, 'admin');
    const A = (m, u, b) => http(m, u, ADMIN, 'admin', b);
    const speech = fs.readFileSync(path.join(FIX, 'speech-kn.webm')).toString('base64');
    let kv = null, listener = null;
    const setup = async () => {
      await cleanAll();
      listener = (await A('POST', '/api/voice-calibration/admin/reviewers', { name: 'Owner3f Listener Example', role: 'listener' })).data.code;
      kv = await mk(`Meera Rao ${tag}`);
      await A('POST', '/api/voice-calibration/admin/invite', { member_id: kv, group: 'kn', profile_note: '30s' });
      await http('POST', '/api/voice-calibration/consent', kv, 'patient', { phone_type: 'android_mid', browser: 'chrome', device: { make: 'Samsung', model: 'Galaxy A34', os: 'android', os_version: '14', browser_version: '130' } });
      await pool.query(`INSERT INTO voice_calibration_wording (lang, script_sha256, confirmed_by, recorded_by) VALUES ('kn', $1, 'R9', $2) ON CONFLICT (lang) DO UPDATE SET script_sha256 = EXCLUDED.script_sha256`, [C.scriptSha('kn'), ADMIN]);
    };
    const upload = async (slot) => { phase = 'transcribe'; return http('POST', '/api/voice-calibration/take', kv, 'patient', { slot, audio: speech, mimeType: 'audio/webm' }); };
    const lastAttempt = async () => (await q(`SELECT state, requests_started, max_calls, attempt_key FROM voice_calibration_attempts WHERE kind='transcription' ORDER BY started_at DESC LIMIT 1`))[0];
    const spendOf = async (key) => (await q(`SELECT calls, outcome, unit FROM voice_calibration_spend WHERE attempt_key=$1`, [key]))[0] || null;

    // ── [1] The two transcription engines ────────────────────────────────────
    console.log('\n[1] both engines finish before the recording attempt is closed; every request that ran is counted');
    await setup();
    // (a) the review repro: Gemini's start write fails, Whisper's is still pending.
    let s0 = { ...seen };
    startScript = ['fail', 'hold'];
    let answered = false;
    let p = upload('k01-q').then(r => { answered = true; return r; });
    await until(() => releases.length === 1);
    await new Promise(r => setTimeout(r, 300));
    const answeredEarly = answered;
    releases.shift()();
    let r = await p;
    let a = await lastAttempt(), sp = await spendOf(a.attempt_key);
    ck(`review repro: Gemini's start write fails while Whisper's is pending → the route waits (no answer before Whisper finished), 500; Whisper's request ran (${seen.whisper - s0.whisper}) and is COUNTED: attempt recorded with 1 started, spend 1 "not saved", never "no call"`,
      !answeredEarly && r.status === 500 && seen.whisper - s0.whisper === 1 && seen.gemini - s0.gemini === 0 && a.state === 'recorded' && a.requests_started === 1 && sp?.calls === 1 && /^not saved/.test(sp?.outcome || '') && sp?.unit === 'requests', { answeredEarly, status: r.status, a, sp });
    // (b) the other order: Whisper's start write fails, Gemini's is pending.
    s0 = { ...seen }; startScript = ['hold', 'fail'];
    p = upload('k02-q');
    await until(() => releases.length === 1);
    await new Promise(r => setTimeout(r, 200));
    releases.shift()();
    r = await p; a = await lastAttempt(); sp = await spendOf(a.attempt_key);
    ck(`the other order (Whisper's start write fails, Gemini's pending): Gemini's request ran (${seen.gemini - s0.gemini}) and is counted (1 started, spend 1); 500, never "no call"`,
      r.status === 500 && seen.gemini - s0.gemini === 1 && seen.whisper - s0.whisper === 0 && a.state === 'recorded' && a.requests_started === 1 && sp?.calls === 1, { status: r.status, a, sp });
    // (c) during Gemini's fallback: its first model is busy, the start of its second model's request fails.
    s0 = { ...seen }; gemPlan = ['503']; startScript = ['ok', 'ok', 'fail'];
    r = await upload('k04-q'); a = await lastAttempt(); sp = await spendOf(a.attempt_key);
    ck(`fallback: Gemini's first model busy, its second model's start write fails → 2 requests ran (Gemini's first, Whisper), 2 counted; the second model never sent; 500`,
      r.status === 500 && seen.gemini - s0.gemini === 1 && seen.whisper - s0.whisper === 1 && a.requests_started === 2 && sp?.calls === 2 && a.state === 'recorded', { status: r.status, a, sp, seen, s0 });
    // (d) a sibling's failure closes the attempt: Gemini's fallback request is not started after Whisper's start write failed.
    s0 = { ...seen }; gemPlan = ['503']; startScript = ['ok', 'fail'];
    r = await upload('k06-q'); a = await lastAttempt(); sp = await spendOf(a.attempt_key);
    ck('once a start write has failed, no NEW request starts: Gemini\'s first (busy) request ran and is counted, its fallback is refused before any write (1 made, 1 started, spend 1)',
      r.status === 500 && seen.gemini - s0.gemini === 1 && seen.whisper - s0.whisper === 0 && a.requests_started === 1 && sp?.calls === 1, { status: r.status, a, sp });
    gemPlan = []; startScript = [];
    // (e) positive control: an ordinary recording.
    s0 = { ...seen };
    r = await upload('k11-q'); a = await lastAttempt(); sp = await spendOf(a.attempt_key);
    ck('positive control: an ordinary recording → 200, 2 requests made (Gemini, Whisper), 2 started, 2 counted, "saved"',
      r.status === 200 && seen.gemini - s0.gemini === 1 && seen.whisper - s0.whisper === 1 && a.requests_started === 2 && a.state === 'recorded' && sp?.calls === 2 && sp?.outcome === 'saved', { status: r.status, a, sp });
    // (f) positive control: both start writes refused.
    s0 = { ...seen }; startScript = ['fail', 'fail'];
    r = await upload('k13-q'); a = await lastAttempt(); sp = await spendOf(a.attempt_key);
    ck('positive control: both start writes refused → 0 requests, "no call", no spend row; 500',
      r.status === 500 && seen.gemini - s0.gemini === 0 && seen.whisper - s0.whisper === 0 && a.state === 'no call' && a.requests_started === 0 && !sp, { status: r.status, a, sp });
    startScript = [];
    const raw1 = await exportRaw(ADMIN);
    const noCallWithReq = (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_attempts WHERE state='no call' AND requests_started > 0`))[0].n;
    const leftUploads = (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_uploads WHERE state NOT IN ('kept','deleted')`))[0].n;
    ck('afterwards: no "no call" attempt has a request, nothing is unresolved or waiting, every failed upload is deleted, and the export totals equal the stub\'s own count of transcription requests',
      noCallWithReq === 0 && !/UNRESOLVED/.test(raw1) && routes._spend.pending.size === 0 && leftUploads === 0 && totalsOf(raw1)?.t === seen.gemini + seen.whisper, { noCallWithReq, leftUploads, totals: totalsOf(raw1), seen });
    // An interrupted NEW recording (its spend never written, then the process forgets it, as after a restart) reports how many
    // requests it had started; it is never mistaken for an attempt from before Fixes-3e.
    await pool.query(`CREATE OR REPLACE FUNCTION vc_test3f_spend() RETURNS trigger AS $$ BEGIN IF NEW.kind='transcription' THEN RAISE EXCEPTION 'forced spend failure (test)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`DROP TRIGGER IF EXISTS vc_test3f_spend ON voice_calibration_spend`); await pool.query(`CREATE TRIGGER vc_test3f_spend BEFORE INSERT ON voice_calibration_spend FOR EACH ROW EXECUTE FUNCTION vc_test3f_spend()`);
    s0 = { ...seen };
    r = await upload('short-q');
    await pool.query(`DROP TRIGGER IF EXISTS vc_test3f_spend ON voice_calibration_spend`);
    routes._spend.pending.clear();   // the process is gone: only the attempt row remains
    a = await lastAttempt();
    const ac = (await q(`SELECT counting FROM voice_calibration_attempts WHERE attempt_key=$1`, [a.attempt_key]))[0];
    const rawI = await exportRaw(ADMIN);
    ck(`an interrupted NEW recording (2 requests made, its spend never written, then forgotten) is reported with its started requests: "(2 had been started), at most 3", marked as counting requests, never as "from before Fixes-3e"`,
      r.status === 500 && seen.gemini + seen.whisper - s0.gemini - s0.whisper === 2 && a.state === 'started' && a.requests_started === 2 && ac?.counting === 'requests'
      && /UNRESOLVED: 1 attempt\(s\) were started .*\(2 had been started\), at most 3,/.test(rawI) && !/from before Fixes-3e, whose requests started/.test(rawI), { status: r.status, a, ac, line: (rawI.match(/UNRESOLVED:[^<]{0,300}/) || [''])[0] });
    await pool.query(`UPDATE voice_calibration_attempts SET state='settled', settled='{"calls":2,"why":"test"}' WHERE attempt_key=$1`, [a.attempt_key]);
    // The database itself refuses to count a request on a closed attempt, and to close an attempt as "no call" once a request started.
    await pool.query(`INSERT INTO voice_calibration_attempts (attempt_key, kind, max_calls, state, counting) VALUES ('take:closed-x', 'transcription', 3, 'no call', 'requests'), ('take:open-x', 'transcription', 3, 'started', 'requests')`);
    const reqC = routes._requestCounter('take:closed-x');
    let refusedClosed = false; try { await reqC.onRequest({}); } catch { refusedClosed = true; }
    await routes._requestCounter('take:open-x').onRequest({});
    await routes._endAttemptNoCall('take:open-x');
    const ox = (await q(`SELECT state, requests_started FROM voice_calibration_attempts WHERE attempt_key='take:open-x'`))[0];
    ck('in the database: a request cannot be counted on a closed attempt (refused, nothing sent), and an attempt with a started request cannot be closed as "no call"',
      refusedClosed && reqC.n === 0 && ox.state === 'started' && ox.requests_started === 1, { refusedClosed, ox });

    // ── [2] Ownership of queued preview checks ───────────────────────────────
    console.log('\n[2] a queued or running preview check has one owner; a stale tap neither runs it nor saves over it');
    await setup();
    const prep = async (slot) => {
      await upload(slot);
      const t = (await q(`SELECT t.id FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE p.patient_id=$1 AND t.slot_code=$2 AND t.superseded_at IS NULL`, [kv, slot]))[0];
      await A('POST', '/api/voice-calibration/admin/reference', { take_id: t.id, listener_code: listener, heard: 'speech', spoken_as_script: true });
      await pool.query(`UPDATE voice_calibration_takes SET speech_status='no_speech', voiced_frames=9, longest_run_frames=4, f0_spread_raw=22, hop_ms=20, gemini_text='eradu idli ondu bowl sambar', whisper_text='', whisper_review='{"accepted":false,"reason":"empty"}' WHERE id=$1`, [t.id]);
      return t.id;
    };
    const claimOf = (takeId, engine) => q(`SELECT id, status, claim_owner, created_at, EXTRACT(EPOCH FROM NOW() - created_at)::int AS age, judgment, provider_requests FROM voice_calibration_preview_judgments WHERE take_id=$1 AND engine=$2`, [takeId, engine]).then(x => x[0]);
    const ageTo = (takeId, engine, minutes) => pool.query(`UPDATE voice_calibration_preview_judgments SET created_at = NOW() - make_interval(secs => $3) WHERE take_id=$1 AND engine=$2 AND status='running'`, [takeId, engine, minutes * 60]);
    const tap = () => { phase = 'parse'; return A('POST', '/api/voice-calibration/admin/preview-eval', {}); };
    const T = [await prep('k01-q'), await prep('k02-q'), await prep('k04-q')];
    parserMode = 'ok'; parserSeen = 0; hold = true;
    let p0 = seen.parser;
    const tap1 = tap();
    await until(() => held.length === 1); held.shift()();            // check 1 runs and finishes ("minute 6")
    await until(() => held.length === 1);                             // check 2 is running, check 3 still queued
    // "Minute 11": check 3 (and the queued Whisper legs) were claimed at minute 0; check 2's lease was renewed at minute 6.
    await ageTo(T[2], 'gemini', 11); await ageTo(T[2], 'whisper', 11); await ageTo(T[1], 'whisper', 11); await ageTo(T[1], 'gemini', 5);
    const tap2 = tap();
    await until(() => held.length === 2, 6000); (held.splice(1, 1)[0] || (() => {}))();     // the second tap took check 3 over and runs it
    const r2 = await tap2;
    // Expiry during ACTIVE work: check 2 is still running; its heartbeat renews the lease even if it looks 9.5 minutes old.
    await ageTo(T[1], 'gemini', 9.5);
    await new Promise(res => setTimeout(res, 700));
    const hb = await claimOf(T[1], 'gemini');
    hold = false; while (held.length) held.shift()();                 // check 2 finishes; any further check would go straight out (and be counted)
    const r1 = await tap1;
    const spend = await q(`SELECT outcome, calls FROM voice_calibration_spend WHERE kind='rule3' ORDER BY id`);
    const done = await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_preview_judgments WHERE status='done'`);
    ck(`review repro (three checks, check 1 done at minute 6, check 2 running, a second tap at minute 11): ${seen.parser - p0} parser checks ran (3e: 5); each leg judged ONCE, 3 spend rows all "judged"`,
      seen.parser - p0 === 3 && spend.length === 3 && spend.every(x => x.outcome === 'judged' && x.calls === 1) && done[0].n === 6, { ran: seen.parser - p0, spend, done });
    ck('…the second tap took over only the abandoned queued work (check 3 and the queued Whisper legs) and reported the running check busy; the first tap skipped what it no longer owned',
      r2.status === 200 && r2.data.parser_calls === 1 && r2.data.busy === 1 && r2.data.judged === 3 && r1.status === 200 && r1.data.parser_calls === 2 && r1.data.judged === 3 && r1.data.busy === 3, { r1: r1.data, r2: r2.data });
    ck(`…the heartbeat kept the RUNNING check from expiring (made to look 9.5 minutes old, renewed to ${hb?.age} s while it ran)`, hb?.status === 'running' && hb.age < 60, hb);
    // The minute-5 control: nothing has expired, so a second tap takes nothing.
    const T2 = [await prep('k06-q'), await prep('k11-q'), await prep('k13-q')];
    hold = true; p0 = seen.parser;
    const tap3 = tap();
    await until(() => held.length === 1); held.shift()();
    await until(() => held.length === 1);
    await ageTo(T2[2], 'gemini', 5); await ageTo(T2[2], 'whisper', 5); await ageTo(T2[1], 'whisper', 5);
    const r4 = await tap();
    held.shift()(); await until(() => held.length === 1); held.shift()();
    const r3 = await tap3; hold = false;
    ck('positive control (second tap at minute 5): it takes nothing (4 busy, 0 checks); the first tap runs all three; 3 checks in all',
      seen.parser - p0 === 3 && r4.data.parser_calls === 0 && r4.data.busy === 4 && r4.data.judged === 0 && r3.data.parser_calls === 3 && r3.data.judged === 6, { ran: seen.parser - p0, r3: r3.data, r4: r4.data });
    // Abandoned work is still recovered: a claim left "running" by a crashed tap 11 minutes ago is taken over and finished; one
    // left 5 minutes ago is not.
    const Ta = await prep('short-q'), Tb = await prep('k01-n');
    for (const [tid, min] of [[Ta, 11], [Tb, 5]]) {
      const t = (await q(`SELECT reference_sha, reference_version FROM voice_calibration_takes WHERE id=$1`, [tid]))[0];
      await pool.query(`INSERT INTO voice_calibration_preview_judgments (take_id, engine, reference_sha, reference_version, judge_version, status, reason, claim_owner, created_at) VALUES ($1,'gemini',$2,$3,$4,'running','initial','tap:crashed', NOW() - make_interval(mins => $5))`, [tid, t.reference_sha, t.reference_version, C.JUDGE_VERSION, min]);
    }
    p0 = seen.parser;
    const r5 = await tap();
    const ja = await claimOf(Ta, 'gemini'), jb = await claimOf(Tb, 'gemini');
    ck('abandoned work is recovered: a claim a crashed tap left 11 minutes ago is taken over and judged (1 check); one left 5 minutes ago stays busy',
      seen.parser - p0 === 1 && ja.status === 'done' && jb.status === 'running' && jb.claim_owner === 'tap:crashed' && r5.data.busy === 1, { ran: seen.parser - p0, ja: ja.status, jb: jb.status, r5: r5.data });
    await pool.query(`DELETE FROM voice_calibration_preview_judgments WHERE take_id=$1 AND status='running'`, [Tb]);
    // A tap that lost ownership while its request ran: it does not save over the new owner's finished result; its request counts.
    await tap();   // finishes the leg left over above (Tb's), so the next tap has exactly one check
    const Tc = await prep('k02-n');
    hold = true; p0 = seen.parser;
    const tap6 = tap();
    await until(() => held.length === 1);
    const other = { result: 'correct reviewable', note: 'written by the new owner (test)' };
    await pool.query(`UPDATE voice_calibration_preview_judgments SET claim_owner='tap:new-owner', status='done', judgment=$2, finished_at=NOW() WHERE take_id=$1 AND engine='gemini'`, [Tc, JSON.stringify(other)]);
    hold = false; held.shift()();   // any further request would now go straight out (and be counted below)
    const r6 = await tap6;
    const jc = await claimOf(Tc, 'gemini');
    const lostSpend = (await q(`SELECT calls, outcome FROM voice_calibration_spend WHERE kind='rule3' AND take_id=$1`, [Tc]));
    ck('a tap that lost ownership while its request ran does NOT save over the new owner\'s result; its 1 request is still counted, marked "not kept (another tap took over this check)"',
      seen.parser - p0 === 1 && jc.judgment?.note === other.note && lostSpend.length === 1 && lostSpend[0].calls === 1 && /^not kept \(another tap took over/.test(lostSpend[0].outcome || '') && r6.data.judged === 1 /* the take's Whisper leg, no parser */ && r6.data.busy === 1, { jc: jc.judgment, lostSpend, r6: r6.data });
    // …and one that loses ownership during a fallback sends no further request.
    const Td = await prep('k04-n');
    hold = true; parserMode = 'empty-then-ok'; parserSeen = 0; p0 = seen.parser;
    const tap7 = tap();
    await until(() => held.length === 1);
    await pool.query(`UPDATE voice_calibration_preview_judgments SET claim_owner='tap:new-owner' WHERE take_id=$1 AND engine='gemini'`, [Td]);
    hold = false; held.shift()();   // a second (fallback) request, if one were made, would go straight out and be counted
    const r7 = await tap7; parserMode = 'ok';
    const jd = await claimOf(Td, 'gemini');
    const att7 = (await q(`SELECT state, requests_started FROM voice_calibration_attempts WHERE kind='rule3' AND judgment_ref=$1`, [jd.id]))[0];
    ck('a tap that loses ownership during a fallback (empty answer, then the fallback) sends no further request: 1 made, 1 started, 1 counted; the new owner\'s claim untouched',
      seen.parser - p0 === 1 && att7?.requests_started === 1 && att7?.state === 'recorded' && jd.status === 'running' && jd.claim_owner === 'tap:new-owner' && r7.data.provider_requests === 1, { made: seen.parser - p0, att7, jd: { status: jd.status, owner: jd.claim_owner }, r7: r7.data });

    // ── [3] The export never adds older checks to request totals ─────────────
    console.log('\n[3] request totals and older parser checks are reported apart, subtotals included');
    await setup();
    const Te = await prep('k06-n');
    const t0 = { g: seen.gemini, w: seen.whisper };
    const transcriptionSoFar = (await q(`SELECT COALESCE(SUM(calls),0)::int AS n FROM voice_calibration_spend WHERE kind='transcription'`))[0].n;
    parserMode = 'all503'; p0 = seen.parser;
    await tap();
    parserMode = 'ok';
    const made12 = seen.parser - p0;
    await pool.query(`INSERT INTO voice_calibration_spend (kind, take_id, judgment_id, calls) VALUES ('rule3', $1, 990101, 1)`, [Te]);   // an older check (no unit)
    let raw = await exportRaw(ADMIN);
    ck(`review repro: ${made12} provider requests + 1 older check → the export says ${made12} parser calls (not ${made12 + 1}) and reports the older check apart, with no request number guessed`,
      made12 === 12 && totalsOf(raw)?.r === 12 && /Kept apart, NOT in these totals: 1 older parser check\(s\) on 1 row\(s\) from before Fixes-3e, counted one per check; their provider requests were never recorded \(at least one each, number unknown\)/.test(raw), totalsOf(raw));
    await pool.query(`INSERT INTO voice_calibration_spend (kind, take_id, calls, outcome) VALUES ('rule3', $1, 1, NULL)`, [Te]);   // an older check whose result was never kept
    await http('POST', '/api/voice-calibration/withdraw', kv, 'patient');
    raw = await exportRaw(ADMIN);
    const line = raw.match(/\d+ transcription call\(s\) and \d+ parser call\(s\) in the round[^<]*/)?.[0] || '';
    const m = line.match(/Of these, (\d+) were on recordings deleted since.*?and (\d+) on attempts whose result was never kept/);
    void t0;
    ck(`…after the withdrawal: the deleted-since subtotal is ${transcriptionSoFar + 12} requests (${transcriptionSoFar} transcription + 12 parser; was +1 in 3e), never-kept 0; the older checks have their own subtotals (1 deleted since, 1 never kept)`,
      m && +m[1] === transcriptionSoFar + 12 && +m[2] === 0 && /Kept apart, NOT in these totals: 2 older parser check\(s\) on 2 row\(s\).*Of these older checks, 1 were on recordings deleted since and 1 on attempts whose result was never kept/.test(line) && totalsOf(raw)?.r === 12, line.slice(0, 500));
    // The unit is stated beside every figure that could be read as both.
    ck('the export states the units: "Each of these calls is one outbound provider request"; the rule 3 budget line counts parser CHECKS',
      /Each of these calls is one outbound provider request/.test(raw) && /These are parser CHECKS; their provider requests, fallbacks and retries included, are in the call ledger below/.test(raw));

    // ── [4] The real upgrade from Fixes-3d ───────────────────────────────────
    console.log('\n[4] upgrading a Fixes-3d database: unresolved 3d attempts get a defensible bound; their start count stays unknown');
    const { Client } = require('pg');
    const adm = new Client({ connectionString: upDb.admin }); await adm.connect();
    await adm.query(`DROP DATABASE IF EXISTS ${upDb.name} WITH (FORCE)`); await adm.query(`CREATE DATABASE ${upDb.name}`);
    const up = new Client({ connectionString: upDb.url }); await up.connect();
    const cut = SCHEMA.indexOf(MARK3E);
    ck('the 3d schema is the current schema.sql up to its Fixes-3e section (append-only; checked byte for byte against d58250c when built)', cut > 0 && SCHEMA.indexOf(MARK3E, cut + 1) === -1);
    await up.query(SCHEMA.slice(0, cut));
    const cols3d = (await up.query(`SELECT column_name FROM information_schema.columns WHERE table_name='voice_calibration_attempts'`)).rows.map(x => x.column_name);
    // Rows exactly as the 3d code wrote them (startAttempt; SPEND_UPSERT; the settle route).
    await up.query(`INSERT INTO voice_calibration_attempts (attempt_key, kind, take_id, judgment_ref, participant_code, slot_code, max_calls, started_at) VALUES
      ('rule3:legacy-started', 'rule3', NULL, 77, 'P2', 'k02-q', 1, NOW() - INTERVAL '2 hours'),
      ('take:legacy-started', 'transcription', NULL, NULL, 'P2', 'k04-q', 3, NOW() - INTERVAL '2 hours'),
      ('rule3:legacy-recorded', 'rule3', NULL, 78, 'P2', 'k01-q', 1, NOW() - INTERVAL '3 hours')`);
    await up.query(`UPDATE voice_calibration_attempts SET state='recorded', resolved_at=NOW() WHERE attempt_key='rule3:legacy-recorded'`);
    await up.query(`INSERT INTO voice_calibration_attempts (attempt_key, kind, participant_code, slot_code, max_calls, state, settled, started_at) VALUES ('rule3:legacy-settled', 'rule3', 'P2', 'k06-q', 1, 'settled', '{"by":1,"at":"2026-10-26T15:00:00Z","calls":1,"why":"3d settlement"}', NOW() - INTERVAL '4 hours')`);
    await up.query(`INSERT INTO voice_calibration_spend (kind, attempt_key, judgment_ref, participant_code, slot_code, calls, outcome) VALUES ('rule3', 'rule3:legacy-recorded', 78, 'P2', 'k01-q', 1, 'judged'), ('rule3', 'rule3:legacy-settled', NULL, 'P2', 'k06-q', 1, 'settled by an administrator')`);
    await up.query(SCHEMA); await up.query(SCHEMA);
    const att = Object.fromEntries((await up.query(`SELECT attempt_key, state, max_calls, legacy_max_calls, counting, requests_started, settled, bound_note FROM voice_calibration_attempts`)).rows.map(x => [x.attempt_key, x]));
    const spend3d = (await up.query(`SELECT attempt_key, calls, outcome, unit FROM voice_calibration_spend ORDER BY attempt_key`)).rows;
    ck('after the upgrade (two schema runs): every 3d parser attempt\'s bound is 12 with the original 1 kept (legacy_max_calls) and a note; the recording attempt keeps its true bound 3; none is marked as counting requests',
      !cols3d.includes('requests_started') && att['rule3:legacy-started'].max_calls === 12 && att['rule3:legacy-started'].legacy_max_calls === 1 && /^Fixes-3f: recorded before Fixes-3e with max_calls 1/.test(att['rule3:legacy-started'].bound_note || '')
      && att['take:legacy-started'].max_calls === 3 && att['take:legacy-started'].legacy_max_calls === null && Object.values(att).every(x => x.counting === null), att);
    ck('…history preserved: states, the 3d settlement (1, its reason) and the 3d spend rows (no unit) are unchanged',
      att['rule3:legacy-started'].state === 'started' && att['rule3:legacy-recorded'].state === 'recorded' && att['rule3:legacy-settled'].state === 'settled' && att['rule3:legacy-settled'].settled?.why === '3d settlement'
      && spend3d.length === 2 && spend3d.every(x => x.unit === null && x.calls === 1), { spend3d });
    await up.end();
    const rch = spawnSync(process.execPath, [__filename, '--upgrade-child'], { env: { ...process.env, DATABASE_URL: upDb.url, RAILWAY_GIT_BRANCH: '' }, encoding: 'utf8', timeout: 120000 });
    const cl = (rch.stdout || '').split('\n').find(l => l.startsWith('CHILD_RESULT ')) || 'CHILD_RESULT {"error":"no result"}';
    const ch = JSON.parse(cl.slice(13));
    const ca = Object.fromEntries((ch.attempts || []).map(x => [x.attempt_key, x]));
    ck('the upgraded server\'s export: 2 unresolved 3d attempts, started requests UNKNOWN (not 0: "2 of them from before Fixes-3e, whose requests started were never recorded"), at most 15 (12 + 3)',
      /UNRESOLVED: 2 attempt\(s\) were started .*\(0 had been started \(2 of them from before Fixes-3e, whose requests started were never recorded\)\), at most 15,/.test(ch.raw1 || ''), ch.raw1 || ch.error);
    ck('review repro: the provider-confirmed count of 2 for the 3d parser attempt (empty answer, then the fallback) is accepted (3e: 400 "from 0 to 1"); written as 2 requests; the recording attempt still refuses 4 (> 3)',
      ch.settle2?.status === 200 && ch.spend2?.calls === 2 && ch.spend2?.unit === 'requests' && ch.settle13?.status === 400 && ca['rule3:legacy-started']?.settled?.calls === 2, { settle2: ch.settle2, spend2: ch.spend2, settle13: ch.settle13?.status });
    ck('…after the 90-day clean-up and another schema run, the recording attempt is still UNRESOLVED (unknown, at most 3), the bounds are not changed again, the 3d settlement stays an older check kept apart',
      /UNRESOLVED: 1 attempt\(s\) were started .*\(0 had been started \(1 of them from before Fixes-3e/.test(ch.raw2 || '') && /at most 3,/.test(ch.raw2 || '') && ca['rule3:legacy-started']?.legacy_max_calls === 1 && ca['rule3:legacy-started']?.max_calls === 12
      && /plus 1 older settlement\(s\) of 1 parser check\(s\) from before Fixes-3e, kept apart/.test(ch.raw2 || '') && /2 parser call\(s\) in the round/.test(ch.raw2 || ''), ch.raw2 || ch.error);
    await adm.query(`DROP DATABASE IF EXISTS ${upDb.name} WITH (FORCE)`); await adm.end();
    // The empty database (the gate loads schema.sql twice onto an empty one): nothing to migrate.
    ck('an empty database: the schema (loaded twice by the gate) migrates nothing', (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_attempts WHERE legacy_max_calls IS NOT NULL`))[0].n === 0);
  } catch (e) { ck('the suite ran to the end', false, e.stack); }
  finally {
    hold = false; while (held.length) held.shift()();
    pool.query = realQuery;
    await pool.query(`DROP TRIGGER IF EXISTS vc_test3f_spend ON voice_calibration_spend`).catch(() => {});
    await pool.query(`DROP FUNCTION IF EXISTS vc_test3f_spend()`).catch(() => {});
    await cleanAll();
    S.server.close(); R2.server?.close?.(); await pool.end().catch(() => {});
  }
  console.log(`\nVoice calibration 3f review fixes: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
