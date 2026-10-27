/**
 * scripts/test-voice-calibration-3e.js — Fixes-3e: the 3d calibration-kit review (27 Oct 2026). REAL Postgres, the REAL routes and
 * the REAL parser (parseMemberMessage → callAI with its provider/model fallback and retries); only the HTTP layer is stubbed,
 * and the stub counts every outbound request itself, independently of the kit's ledger.
 *
 *   [1] settlement counts: null, false, "", whitespace, [], {} (and missing, negative, fractional, above the maximum) are refused
 *       without settling, writing spend or clearing the warning; explicit 0 and whole numbers work; two at once settle once;
 *   [2] units: a parser CHECK and its provider REQUESTS are counted apart. First answer valid → 1 request; an empty HTTP-200
 *       answer then a valid one → 2; every model busy through every retry → 12 (2 providers × 2 models × 3 tries). The reservation
 *       bound is that real worst case; recordings count their requests too (one per Gemini model tried, plus Whisper);
 *   [3] restarts: a child process makes the requests (first answer valid; an empty answer then a valid one) and exits with its
 *       spend unwritten, or is KILLED in the middle of its retries (its own stub writes a trace line per request it sends); the fresh process says how many requests had been started, at most the real bound, and accepts the
 *       true number when it is settled; nothing calls a provider to repair it; if the start of a request cannot be recorded, the
 *       request is not made;
 *   [4] older rule-3 rows (parser checks, requests not recorded) are reported as such, never silently re-read as requests.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GEMINI_API_KEY = 'stub-gemini'; process.env.GROQ_API_KEY = 'stub-groq';
delete process.env.GEMINI_MODEL; delete process.env.GEMINI_FALLBACK_MODEL; delete process.env.GROQ_MODEL; delete process.env.GROQ_FALLBACK_MODEL;
delete process.env.RAILWAY_GIT_BRANCH; delete process.env.FITLIFE_TEST_SERVER;
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const express = require('express');
const jwt = require('jsonwebtoken');

// ── The HTTP stub: counts every outbound request; `mode` decides how the parser's providers answer ──
const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
const per = { calories: 120, protein: 3, total_carbs: 20, fat: 3 };
const PREVIEW = JSON.stringify({ weight_kg: null, activities: [], acv: [], supplements: [], water_ml_add: null, sleep: null, workouts: [], corrections: [], reply: 'Got it.',
  foods: [{ name: 'Idli', qty_text: '2 idli', grams: 100, meal: 'Breakfast', per_100g: per }, { name: 'Sambar', qty_text: '1 bowl', grams: 200, meal: 'Breakfast', per_100g: per }] });
const seen = { transcribeGemini: 0, whisper: 0, parser: 0 };
let mode = 'ok', parserSeen = 0;
const busy = () => { const e = new Error('Service Unavailable (stub)'); e.response = { status: 503, data: {} }; return e; };
const stubbedPost = async (url) => {
  const u = String(url);
  if (u === 'https://api.groq.com/openai/v1/audio/transcriptions') { seen.whisper++; return { data: { text: 'eradu idli ondu bowl sambar', language: 'kannada', segments: [] } }; }
  const parserGemini = u.startsWith('https://generativelanguage.googleapis.com/') && mode !== 'transcribe';
  if (u.startsWith('https://generativelanguage.googleapis.com/') && !parserGemini) { seen.transcribeGemini++; return { data: { candidates: [{ content: { parts: [{ text: 'eradu idli ondu bowl sambar' }] }, finishReason: 'STOP' }], modelVersion: 'stub-001' } }; }
  if (u === 'https://api.groq.com/openai/v1/chat/completions' || parserGemini) {
    seen.parser++; parserSeen++;
    // The child's own record of every request it sends, written synchronously BEFORE the answer, so a SIGKILL cannot lose it.
    if (process.env.VC3E_TRACE) fs.appendFileSync(process.env.VC3E_TRACE, 'request\n');
    if (mode === 'all503') throw busy();
    if (mode === 'empty-then-ok' && parserSeen === 1) return { data: { choices: [{ finish_reason: 'stop', message: { content: '' } }] } };
    if (parserGemini) return { data: { candidates: [{ content: { parts: [{ text: PREVIEW }] }, finishReason: 'STOP' }] } };
    return { data: { choices: [{ finish_reason: 'stop', message: { content: PREVIEW } }] } };
  }
  throw new Error('Unexpected external request blocked: ' + url);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const storage = require('../services/storage');
const { startR2 } = require('./lib/r2-standin');
const C = require('../services/voiceCalibration');
const FIX = path.join(__dirname, 'fixtures/voice');

async function startServer(keyId) {
  const KEYS = { id: keyId, secret: 'calibration-3e-secret' };
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

// ── CHILD: run the parser in this separate process (it exits, or is killed, with its spend unwritten) ──
if (process.argv[2] === '--child') {
  (async () => {
    const job = JSON.parse(process.argv[3]);
    const S = await startServer('AKIDTESTONLY0018');
    process.env.RAILWAY_GIT_BRANCH = 'test';
    mode = job.mode;
    const r = await S.http('POST', '/api/voice-calibration/admin/preview-eval', job.admin, 'admin', {});
    console.log('CHILD_RESULT ' + JSON.stringify({ status: r.status, parser: seen.parser, waiting: S.routes._spend.pending.size }));
    process.exit(0);
  })().catch(e => { console.log('CHILD_RESULT ' + JSON.stringify({ error: e.stack })); process.exit(1); });
  return;
}

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 500))); };
const childJob = (job) => {
  const r = spawnSync(process.execPath, [__filename, '--child', JSON.stringify(job)], { env: { ...process.env, RAILWAY_GIT_BRANCH: '' }, encoding: 'utf8', timeout: 120000 });
  const line = (r.stdout || '').split('\n').find(l => l.startsWith('CHILD_RESULT ')) || 'CHILD_RESULT {"error":"no result"}';
  return { ...JSON.parse(line.slice(13)), exit: r.status };
};

(async () => {
  const S = await startServer('AKIDTESTONLY0017');
  const { pool, routes, http, R2 } = S;
  const q = async (sql, args) => (await pool.query(sql, args)).rows;
  const TABLES = ['voice_calibration_preview_judgments', 'voice_calibration_preview_evals', 'voice_calibration_takes', 'voice_calibration_participants', 'voice_calibration_wording', 'voice_calibration_partc',
    'voice_calibration_partc_sessions', 'voice_calibration_partc_armed', 'voice_calibration_reviewers', 'voice_calibration_replacement_grants', 'voice_calibration_spend', 'voice_calibration_spend_reconciled',
    'voice_calibration_uploads', 'voice_calibration_attempts'];
  const cleanAll = async () => { for (const t of TABLES) await pool.query(`DELETE FROM ${t}`).catch(() => {}); };
  const tag = Date.now().toString(36);
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1))`);
  const mk = async (name, role = 'patient') => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, '2' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), role])).rows[0].id;
  const ledger = async (kind) => Number((await q(`SELECT COALESCE(SUM(calls), 0)::int AS n FROM voice_calibration_spend WHERE kind=$1`, [kind]))[0].n);
  const exportRaw = async (ADMIN) => { const r = await http('GET', '/api/voice-calibration/admin/export.xlsx', ADMIN, 'admin'); return Object.values(require('../services/xlsxLite').unzipStored(r.data)).map(String).join('\n'); };
  const totals = (raw) => { const m = raw.match(/(\d+) transcription call\(s\) and (\d+) parser call\(s\) in the round/); return m ? { t: +m[1], r: +m[2] } : null; };
  const { callAIMaxRequests } = require('../routes/aiChat');
  process.env.RAILWAY_GIT_BRANCH = 'test';
  let ch0 = null, ch = null, k = [], killedSent = -1;
  try {
    await cleanAll();
    await pool.query(`CREATE TABLE IF NOT EXISTS vc_test3e_ctl (what TEXT, n INT)`); await pool.query(`DELETE FROM vc_test3e_ctl`);
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS vc_test3e_seq`);
    await pool.query(`CREATE OR REPLACE FUNCTION vc_test3e_spend() RETURNS trigger AS $$ BEGIN IF NEW.kind='rule3' AND EXISTS (SELECT 1 FROM vc_test3e_ctl WHERE what='spend') THEN RAISE EXCEPTION 'forced spend failure (test)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE OR REPLACE FUNCTION vc_test3e_attempt_ins() RETURNS trigger AS $$ BEGIN IF NEW.kind='rule3' AND EXISTS (SELECT 1 FROM vc_test3e_ctl WHERE what='attempt') THEN RAISE EXCEPTION 'forced attempt failure (test)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE OR REPLACE FUNCTION vc_test3e_attempt_upd() RETURNS trigger AS $$ BEGIN IF NEW.requests_started > OLD.requests_started AND EXISTS (SELECT 1 FROM vc_test3e_ctl WHERE what='started') THEN RAISE EXCEPTION 'forced request-start failure (test)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`DROP TRIGGER IF EXISTS vc_test3e_spend ON voice_calibration_spend`); await pool.query(`CREATE TRIGGER vc_test3e_spend BEFORE INSERT ON voice_calibration_spend FOR EACH ROW EXECUTE FUNCTION vc_test3e_spend()`);
    await pool.query(`DROP TRIGGER IF EXISTS vc_test3e_attempt_ins ON voice_calibration_attempts`); await pool.query(`CREATE TRIGGER vc_test3e_attempt_ins BEFORE INSERT ON voice_calibration_attempts FOR EACH ROW EXECUTE FUNCTION vc_test3e_attempt_ins()`);
    await pool.query(`DROP TRIGGER IF EXISTS vc_test3e_attempt_upd ON voice_calibration_attempts`); await pool.query(`CREATE TRIGGER vc_test3e_attempt_upd BEFORE UPDATE ON voice_calibration_attempts FOR EACH ROW EXECUTE FUNCTION vc_test3e_attempt_upd()`);
    const sw = async (what, on) => { await pool.query(`DELETE FROM vc_test3e_ctl WHERE what=$1`, [what]); if (on) await pool.query(`INSERT INTO vc_test3e_ctl VALUES ($1, 1)`, [what]); };

    const ADMIN = await mk(`Cal Admin ${tag}`, 'admin');
    const A = (m, u, b) => http(m, u, ADMIN, 'admin', b);

    // ── [1] Settlement counts ────────────────────────────────────────────────
    console.log('\n[1] a settlement count must be an explicit whole number');
    const seedAttempt = async (key, max = 3) => pool.query(`INSERT INTO voice_calibration_attempts (attempt_key, kind, participant_code, slot_code, max_calls, started_at) VALUES ($1,'transcription','P9','x01-q',$2, NOW() - INTERVAL '20 minutes')`, [key, max]);
    await seedAttempt('take:settle-a');
    const bad = [['null', null], ['false', false], ['an empty string', ''], ['whitespace', '   '], ['[]', []], ['{}', {}], ['missing', undefined], ['negative', -1], ['fractional', 1.5], ['above the maximum', 4], ['"1.5"', '1.5'], ['true', true]];
    const refused = [];
    for (const [name, v] of bad) {
      const body = { attempt_key: 'take:settle-a', why: 'Reviewed provider records' }; if (v !== undefined) body.calls = v;
      const r = await A('POST', '/api/voice-calibration/admin/attempts/settle', body);
      if (r.status !== 400) refused.push([name, r.status]);
    }
    const stillA = (await q(`SELECT state FROM voice_calibration_attempts WHERE attempt_key='take:settle-a'`))[0].state;
    let raw = await exportRaw(ADMIN);
    ck('review repro: null, false, "", whitespace, [], {} (and missing, negative, fractional, above the maximum, "1.5", true) → all 400; the attempt stays unresolved, no spend, warning kept',
      refused.length === 0 && stillA === 'started' && (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_spend WHERE attempt_key='take:settle-a'`))[0].n === 0 && /UNRESOLVED: 1 attempt\(s\) were started/.test(raw), refused);
    let r = await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: 'take:settle-a', calls: 0, why: 'Gemini and Groq consoles show no request' });
    ck('explicit numeric 0 settles (no spend row: zero requests), and the warning clears', r.status === 200 && r.data.calls === 0 && (await q(`SELECT state FROM voice_calibration_attempts WHERE attempt_key='take:settle-a'`))[0].state === 'settled'
      && (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_spend WHERE attempt_key='take:settle-a'`))[0].n === 0 && !/UNRESOLVED/.test(await exportRaw(ADMIN)));
    await seedAttempt('take:settle-b'); await seedAttempt('take:settle-c');
    r = await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: 'take:settle-b', calls: '2', why: 'Gemini console: 1, Groq console: 1' });
    const [c1, c2] = await Promise.all([1, 2].map(() => A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: 'take:settle-c', calls: 3, why: 'consoles show three' })));
    ck('a whole number (also given as the string "2") settles with that many requests; two settlements at once → one 200, one 409, one spend row',
      r.status === 200 && (await q(`SELECT calls, unit FROM voice_calibration_spend WHERE attempt_key='take:settle-b'`))[0]?.calls === 2 && [c1.status, c2.status].sort().join() === '200,409'
      && (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_spend WHERE attempt_key='take:settle-c'`))[0].n === 1);
    await cleanAll();

    // ── [2] Units through the real parser ────────────────────────────────────
    console.log('\n[2] parser checks and provider requests are counted apart, through the real parser');
    const max = callAIMaxRequests();
    ck(`the parser's real worst case is read from its own settings: ${max} requests (Groq and Gemini, two models each, three tries on a busy reply)`, max === 12);
    const listener = (await A('POST', '/api/voice-calibration/admin/reviewers', { name: 'Units3e Listener Example', role: 'listener' })).data.code;
    const kv = await mk(`Lakshmi Iyer ${tag}`);
    await A('POST', '/api/voice-calibration/admin/invite', { member_id: kv, group: 'kn', profile_note: '40s' });
    await http('POST', '/api/voice-calibration/consent', kv, 'patient', { phone_type: 'android_mid', browser: 'chrome', device: { make: 'Samsung', model: 'Galaxy A34', os: 'android', os_version: '14', browser_version: '130' } });
    await pool.query(`INSERT INTO voice_calibration_wording (lang, script_sha256, confirmed_by, recorded_by) VALUES ('kn', $1, 'R9', $2) ON CONFLICT (lang) DO UPDATE SET script_sha256 = EXCLUDED.script_sha256`, [C.scriptSha('kn'), ADMIN]);
    const speech = fs.readFileSync(path.join(FIX, 'speech-kn.webm')).toString('base64');
    // One leg per take (Whisper refused before the parser), so each check is one parser attempt.
    const prep = async (slot) => {
      mode = 'transcribe';
      const s0 = { g: seen.transcribeGemini, w: seen.whisper };
      await http('POST', '/api/voice-calibration/take', kv, 'patient', { slot, audio: speech, mimeType: 'audio/webm' });
      const made = (seen.transcribeGemini - s0.g) + (seen.whisper - s0.w);
      const t = (await q(`SELECT t.id FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE p.patient_id=$1 AND t.slot_code=$2 AND t.superseded_at IS NULL`, [kv, slot]))[0];
      await A('POST', '/api/voice-calibration/admin/reference', { take_id: t.id, listener_code: listener, heard: 'speech', spoken_as_script: true });
      await pool.query(`UPDATE voice_calibration_takes SET speech_status='no_speech', voiced_frames=9, longest_run_frames=4, f0_spread_raw=22, hop_ms=20, gemini_text='eradu idli ondu bowl sambar', whisper_text='', whisper_review='{"accepted":false,"reason":"empty"}' WHERE id=$1`, [t.id]);
      return { id: t.id, made };
    };
    const runCheck = async (m) => { mode = m; parserSeen = 0; const p0 = seen.parser, l0 = await ledger('rule3'); const r = await A('POST', '/api/voice-calibration/admin/preview-eval', {}); return { r, made: seen.parser - p0, counted: await ledger('rule3') - l0 }; };
    const t1 = await prep('k01-q');
    const upAtt = (await q(`SELECT max_calls, requests_started, state FROM voice_calibration_attempts WHERE kind='transcription'`))[0];
    ck(`a recording counts its requests: ${t1.made} made (one Gemini model + Whisper), ${upAtt?.requests_started} started, recorded; its bound is 3 (two Gemini models + Whisper)`,
      t1.made === 2 && upAtt?.requests_started === 2 && upAtt?.max_calls === 3 && upAtt?.state === 'recorded' && await ledger('transcription') === 2, upAtt);
    let x = await runCheck('ok');
    let j = (await q(`SELECT parser_calls, provider_requests FROM voice_calibration_preview_judgments WHERE take_id=$1 AND engine='gemini'`, [t1.id]))[0];
    let a = (await q(`SELECT max_calls, requests_started, state FROM voice_calibration_attempts WHERE kind='rule3' ORDER BY started_at DESC LIMIT 1`))[0];
    ck('positive control: first answer valid → 1 check, 1 request made, 1 counted; the reservation bound is 12', x.r.status === 200 && x.made === 1 && x.counted === 1 && x.r.data.provider_requests === 1 && j.parser_calls === 1 && j.provider_requests === 1 && a.max_calls === 12 && a.requests_started === 1 && a.state === 'recorded', { made: x.made, counted: x.counted, j, a });
    const t2 = await prep('k02-q');
    x = await runCheck('empty-then-ok');
    j = (await q(`SELECT parser_calls, provider_requests, stage FROM voice_calibration_preview_judgments WHERE take_id=$1 AND engine='gemini'`, [t2.id]))[0];
    ck('review repro: an empty HTTP-200 answer, then a valid one → 1 check, 2 requests made, 2 counted (was 1); the parse succeeds ("parsed")', x.r.status === 200 && x.made === 2 && x.counted === 2 && j.parser_calls === 1 && j.provider_requests === 2 && j.stage === 'parsed', { made: x.made, counted: x.counted, j });
    const t3 = await prep('k04-q');
    x = await runCheck('all503');
    j = (await q(`SELECT parser_calls, provider_requests, stage FROM voice_calibration_preview_judgments WHERE take_id=$1 AND engine='gemini'`, [t3.id]))[0];
    ck('review repro: every model busy through every retry → 1 check, 12 requests made, 12 counted (was 1); a provider error, not a pass', x.r.status === 200 && x.made === 12 && x.counted === 12 && j.parser_calls === 1 && j.provider_requests === 12 && j.stage === 'parser error', { made: x.made, counted: x.counted, j });
    const t4 = await prep('k06-q');
    await sw('attempt', true);
    x = await runCheck('ok');
    await sw('attempt', false);
    ck('the attempt cannot be written → 503, 0 requests made, nothing counted, the claim released', x.r.status === 503 && x.made === 0 && x.counted === 0 && (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_preview_judgments WHERE take_id=$1`, [t4.id]))[0].n === 0);
    // The first request's start writes the attempt itself (covered just above); a LATER request whose start cannot be recorded
    // is not made: an empty answer, then the fallback request's start fails → only the first request leaves.
    await prep('k13-q');
    const since = (await q(`SELECT NOW() AS t`))[0].t;
    await sw('started', true);
    x = await runCheck('empty-then-ok');
    await sw('started', false);
    // Two legs are due here (this take, and the take whose claim was released above): each makes its first request, gets the
    // empty answer, and its fallback request's start cannot be recorded, so that request never leaves.
    const cuts = await q(`SELECT state, requests_started FROM voice_calibration_attempts WHERE kind='rule3' AND started_at >= $1`, [since]);
    ck(`a fallback request whose START cannot be recorded is not made: ${cuts.length} check(s), one request each (${x.made} made, ${x.counted} counted), each attempt recorded with 1 started`,
      cuts.length >= 1 && x.made === cuts.length && x.counted === cuts.length && cuts.every(c => c.state === 'recorded' && c.requests_started === 1), { made: x.made, counted: x.counted, cuts });

    // ── [3] Restarts during fallback ─────────────────────────────────────────
    console.log('\n[3] a restart during fallback: how many requests had started, at most the real bound');
    // First answer valid, then a restart before its spend is written: 1 request started (positive control for the bound).
    await prep('k01-n');
    await sw('spend', true);
    const lr00 = await ledger('rule3');
    ch0 = childJob({ mode: 'ok', admin: ADMIN });
    await sw('spend', false);
    const left0 = (await q(`SELECT attempt_key, requests_started, max_calls FROM voice_calibration_attempts WHERE state='started'`));
    raw = await exportRaw(ADMIN);
    ck('child process: the first answer valid (1 request), every spend write failed, it exited; the fresh process sees 1 attempt with 1 request started, at most 12',
      ch0.parser === 1 && ch0.exit === 0 && await ledger('rule3') === lr00 && left0.length === 1 && left0[0].requests_started === 1 && left0[0].max_calls === 12
      && /their provider requests are UNKNOWN \(1 had been started\), at most 12,/.test(raw), { ch0, left0 });
    await pool.query(`UPDATE voice_calibration_attempts SET started_at = NOW() - INTERVAL '20 minutes' WHERE state='started'`);
    r = await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: left0[0].attempt_key, calls: 1, why: 'Groq console: one request at that minute' });
    ck('…settled with the true number, 1; the ledger gains 1', r.status === 200 && await ledger('rule3') === lr00 + 1, r.data);
    // An empty answer then a valid one (the take whose claim was released in [2] is due again), then a restart.
    await pool.query(`DELETE FROM voice_calibration_preview_judgments WHERE take_id=$1`, [t4.id]);
    await sw('spend', true);
    const lr0 = await ledger('rule3');
    ch = childJob({ mode: 'empty-then-ok', admin: ADMIN });
    await sw('spend', false);
    const left = (await q(`SELECT attempt_key, requests_started, max_calls FROM voice_calibration_attempts WHERE state='started'`));
    raw = await exportRaw(ADMIN);
    ck('child process: an empty answer then a valid one (2 requests), every spend write failed, it exited; the fresh process sees 1 attempt with 2 requests started, at most 12',
      ch.parser === 2 && ch.exit === 0 && await ledger('rule3') === lr0 && left.length === 1 && left[0].requests_started === 2 && left[0].max_calls === 12
      && /their provider requests are UNKNOWN \(2 had been started\), at most 12,/.test(raw), { ch, left });
    await pool.query(`UPDATE voice_calibration_attempts SET started_at = NOW() - INTERVAL '20 minutes' WHERE state='started'`);
    const pBefore = seen.parser;
    r = await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: left[0].attempt_key, calls: 2, why: 'Groq console: two requests at that minute' });
    ck('…settled with the TRUE number, 2 (refused as "above the maximum" before), from the provider\'s records; the ledger gains 2; no provider called', r.status === 200 && await ledger('rule3') === lr0 + 2 && seen.parser === pBefore, r.data);
    // Killed in the middle of the retries (the 503 waits are 2 s and 4 s per model).
    const t5 = await prep('k11-q');
    const trace = path.join(require('os').tmpdir(), `vc3e-trace-${process.pid}.txt`);
    try { fs.unlinkSync(trace); } catch {}
    const killed = spawn(process.execPath, [__filename, '--child', JSON.stringify({ mode: 'all503', admin: ADMIN })], { env: { ...process.env, RAILWAY_GIT_BRANCH: '', VC3E_TRACE: trace }, stdio: 'ignore' });
    let startedNow = 0;
    for (let i = 0; i < 200 && startedNow < 4; i++) { await new Promise(res => setTimeout(res, 100)); startedNow = Number((await q(`SELECT COALESCE(MAX(requests_started),0)::int AS n FROM voice_calibration_attempts WHERE state='started'`))[0].n); }
    killed.kill('SIGKILL'); await new Promise(res => killed.once('exit', res));
    k = (await q(`SELECT attempt_key, requests_started, max_calls FROM voice_calibration_attempts WHERE state='started'`));
    // The child's own stub wrote a line for every request it actually sent; a request is counted as started just BEFORE it is
    // sent, so the started count is the sent count, or one more if the kill fell between the two.
    killedSent = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).length : -1;
    try { fs.unlinkSync(trace); } catch {}
    raw = await exportRaw(ADMIN);
    ck(`a child KILLED during its retries (it sent ${killedSent}, by its own count; ${k[0]?.requests_started} started): the fresh process reports exactly that many started, at most 12, calls unknown, screen incomplete`,
      k.length === 1 && killedSent >= 4 && (k[0].requests_started === killedSent || k[0].requests_started === killedSent + 1) && k[0].requests_started < 12
      && new RegExp(`UNKNOWN \\(${k[0].requests_started} had been started\\), at most 12,`).test(raw) && /call ledger: 1 attempt\(s\) not yet written \(1 with unknown calls/.test(raw), { k, killedSent });
    await pool.query(`UPDATE voice_calibration_attempts SET started_at = NOW() - INTERVAL '20 minutes' WHERE state='started'`);
    ck('…a settlement above its maximum (13) is refused; the number the child actually sent is accepted', (await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: k[0].attempt_key, calls: 13, why: 'console' })).status === 400
      && (await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: k[0].attempt_key, calls: killedSent, why: 'Groq and Gemini consoles: the busy replies' })).status === 200);
    void t5;

    // ── [4] Older rows keep their own unit ───────────────────────────────────
    console.log('\n[4] older parser rows are reported as checks, never re-read as requests');
    await pool.query(`INSERT INTO voice_calibration_spend (kind, take_id, judgment_id, calls) VALUES ('rule3', $1, 990001, 1)`, [t1.id]);
    raw = await exportRaw(ADMIN);
    const rows = await q(`SELECT unit, COUNT(*)::int AS n FROM voice_calibration_spend GROUP BY unit`);
    ck('every row written now says unit "requests"; the older one (no unit) is reported as a parser check whose requests were not recorded (at least one)', rows.find(x => x.unit === null)?.n === 1 && rows.find(x => x.unit === 'requests')?.n > 0
      // Fixes-3f: the older check is reported APART from the request totals, with no request number guessed for it.
      && /Kept apart, NOT in these totals: 1 older parser check\(s\) on 1 row\(s\) from before Fixes-3e, counted one per check; their provider requests were never recorded \(at least one each, number unknown\)/.test(raw), rows);
    ck('the export says what each number is: provider requests in the ledger; the rule 3 budget line counts parser CHECKS', /Each of these calls is one outbound provider request/.test(raw) && /These are parser CHECKS; their provider requests, fallbacks and retries included, are in the call ledger below/.test(raw));
    // Independent count: this process's stub (seen.parser) + the children's own stub counts (ch0, ch, and the killed child's
    // trace, settled as if from the provider's records). Fixes-3f (the 3e review, finding 3): the one older CHECK is no longer
    // added: it is not a request count (it was "+ 1" here in 3e, which was the very mixing the review found).
    const expectR = seen.parser + ch0.parser + ch.parser + killedSent;
    ck(`the ledger totals equal the requests counted independently: ${expectR} parser requests (this process ${seen.parser}, the children ${ch0.parser} + ${ch.parser} + ${killedSent}; the 1 older check kept apart), ${seen.transcribeGemini + seen.whisper} transcription`,
      totals(raw).r === expectR && totals(raw).t === seen.transcribeGemini + seen.whisper, { totals: totals(raw), expectR });
  } catch (e) { ck('the suite ran to the end', false, e.stack); }
  finally {
    await pool.query(`DROP TRIGGER IF EXISTS vc_test3e_spend ON voice_calibration_spend`).catch(() => {});
    await pool.query(`DROP TRIGGER IF EXISTS vc_test3e_attempt_ins ON voice_calibration_attempts`).catch(() => {});
    await pool.query(`DROP TRIGGER IF EXISTS vc_test3e_attempt_upd ON voice_calibration_attempts`).catch(() => {});
    for (const f of ['vc_test3e_spend()', 'vc_test3e_attempt_ins()', 'vc_test3e_attempt_upd()']) await pool.query(`DROP FUNCTION IF EXISTS ${f}`).catch(() => {});
    await pool.query(`DROP TABLE IF EXISTS vc_test3e_ctl`).catch(() => {}); await pool.query(`DROP SEQUENCE IF EXISTS vc_test3e_seq`).catch(() => {});
    await cleanAll();
    S.server.close(); R2.server?.close?.(); await pool.end().catch(() => {});
  }
  console.log(`\nVoice calibration 3e review fixes: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
