/**
 * scripts/test-voice-calibration-3d.js — Fixes-3d: the 3c calibration-kit review (26 Oct 2026). Accounting must survive a
 * server restart or stay visibly unresolved. REAL Postgres and the REAL routes; STUBBED providers whose calls are counted.
 *
 * The restart is real: a CHILD node process (this file with --child) makes the provider/parser calls while ledger writes fail,
 * then exits without writing them (its memory is gone, exactly as in a restart). The parent, a separate process with its own
 * copy of the routes, then inspects the same database and the real export.
 *
 *   - after a restart, an attempt whose calls were never recorded stays UNRESOLVED (unknown calls, with an upper bound, never an
 *     invented number) and the screen stays incomplete; nothing calls a provider again to repair it; an administrator settles
 *     it from the provider's own records (rules enforced, once);
 *   - parser, failed-upload and refused-upload paths; the attempt is written BEFORE the call, and when it cannot be written no
 *     call is made (positive control); a one-off failure there is retried; ordinary flows leave nothing unresolved; repeated
 *     bookkeeping retries never double-count; genuine repeated calls stay distinct; withdrawal, expiry and schema replay keep it;
 *   - the export tells "never kept" uploads apart from kept recordings deleted later (withdrawal).
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GEMINI_API_KEY = 'stub-gemini'; process.env.GROQ_API_KEY = 'stub-groq';
delete process.env.GEMINI_MODEL; delete process.env.GEMINI_FALLBACK_MODEL;
delete process.env.RAILWAY_GIT_BRANCH; delete process.env.FITLIFE_TEST_SERVER;
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const express = require('express');
const jwt = require('jsonwebtoken');

const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
const per = { calories: 120, protein: 3, total_carbs: 20, fat: 3 };
const calls = { gemini: 0, whisper: 0, parser: 0 };
let engineDelay = 0;
const stubbedPost = async (url) => {
  const u = String(url);
  if (u.startsWith('https://generativelanguage.googleapis.com/')) { calls.gemini++; if (engineDelay) await new Promise(r => setTimeout(r, engineDelay)); return { data: { candidates: [{ content: { parts: [{ text: 'eradu idli ondu bowl sambar' }] }, finishReason: 'STOP' }], modelVersion: 'stub-001' } }; }
  if (u === 'https://api.groq.com/openai/v1/audio/transcriptions') { calls.whisper++; if (engineDelay) await new Promise(r => setTimeout(r, engineDelay)); return { data: { text: 'eradu idli ondu bowl sambar', language: 'kannada', segments: [{ start: 0, end: 3, text: 'x', avg_logprob: -0.2, no_speech_prob: 0.05, compression_ratio: 1.1 }] } }; }
  if (u === 'https://api.groq.com/openai/v1/chat/completions') {
    calls.parser++;
    return { data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ weight_kg: null, activities: [], acv: [], supplements: [], water_ml_add: null, sleep: null, workouts: [], corrections: [], reply: 'Got it.',
      foods: [{ name: 'Idli', qty_text: '2 idli', grams: 100, meal: 'Breakfast', per_100g: per }, { name: 'Sambar', qty_text: '1 bowl', grams: 200, meal: 'Breakfast', per_100g: per }] }) } }] } };
  }
  throw new Error('Unexpected external request blocked: ' + url);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });
const engineCalls = () => calls.gemini + calls.whisper;

const storage = require('../services/storage');
const { startR2 } = require('./lib/r2-standin');
const C = require('../services/voiceCalibration');
const FIX = path.join(__dirname, 'fixtures/voice');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
const silence = fs.readFileSync(path.join(FIX, 'silence-digital.webm')).toString('base64');

/** A server: the real routes on a local port, with a local storage stand-in. */
async function startServer(keyId) {
  const KEYS = { id: keyId, secret: 'calibration-3d-secret' };
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
    const r = await fetch(url + u, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok(id, role)}` }, body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  return { R2, pool, routes, server, http };
}

// ── CHILD: make the calls while ledger writes fail, then exit with them unwritten (a restart) ──
if (process.argv[2] === '--child') {
  (async () => {
    const job = JSON.parse(process.argv[3]);
    const S = await startServer('AKIDTESTONLY0016');
    const out = {};
    process.env.RAILWAY_GIT_BRANCH = 'test';
    if (job.mode === 'parser') {
      const r = await S.http('POST', '/api/voice-calibration/admin/preview-eval', job.admin, 'admin', {});
      Object.assign(out, { status: r.status });
    } else if (job.mode === 'take-failed') {
      const r = await S.http('POST', '/api/voice-calibration/take', job.vol, 'patient', { slot: job.slot, audio: silence, mimeType: 'audio/webm' });
      Object.assign(out, { status: r.status });
    } else if (job.mode === 'take-refused') {
      engineDelay = 150;
      const rs = await Promise.all([1, 2].map(() => S.http('POST', '/api/voice-calibration/take', job.vol, 'patient', { slot: job.slot, audio: silence, mimeType: 'audio/webm', retake_reason: 'replacement' })));
      Object.assign(out, { statuses: rs.map(x => x.status) });
    }
    out.engines = engineCalls(); out.parser = calls.parser; out.waiting = S.routes._spend.pending.size;
    console.log('CHILD_RESULT ' + JSON.stringify(out));
    process.exit(0);   // no flush, no clean shutdown: whatever was only in memory is gone
  })().catch(e => { console.log('CHILD_RESULT ' + JSON.stringify({ error: e.stack })); process.exit(1); });
  return;
}

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 500))); };
const child = (job) => {
  const r = spawnSync(process.execPath, [__filename, '--child', JSON.stringify(job)], { env: { ...process.env, RAILWAY_GIT_BRANCH: '' }, encoding: 'utf8', timeout: 120000 });
  const line = (r.stdout || '').split('\n').find(l => l.startsWith('CHILD_RESULT ')) || 'CHILD_RESULT {"error":"no result"}';
  return { ...JSON.parse(line.slice(13)), pid: r.pid, exit: r.status };
};

(async () => {
  const S = await startServer('AKIDTESTONLY0015');
  const { pool, routes, http, R2 } = S;
  const q = async (sql, args) => (await pool.query(sql, args)).rows;
  const TABLES = ['voice_calibration_preview_judgments', 'voice_calibration_preview_evals', 'voice_calibration_takes', 'voice_calibration_participants', 'voice_calibration_wording', 'voice_calibration_partc',
    'voice_calibration_partc_sessions', 'voice_calibration_partc_armed', 'voice_calibration_reviewers', 'voice_calibration_replacement_grants', 'voice_calibration_spend', 'voice_calibration_spend_reconciled',
    'voice_calibration_uploads', 'voice_calibration_attempts'];
  const cleanAll = async () => { for (const t of TABLES) await pool.query(`DELETE FROM ${t}`).catch(() => {}); };
  const tag = Date.now().toString(36);
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1))`);
  const mk = async (name, role = 'patient') => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, '3' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), role])).rows[0].id;
  const ledger = async (kind) => Number((await q(`SELECT COALESCE(SUM(calls), 0)::int AS n FROM voice_calibration_spend WHERE kind=$1`, [kind]))[0].n);
  const started = async () => (await q(`SELECT kind, max_calls FROM voice_calibration_attempts WHERE state='started' ORDER BY attempt_key`));
  const exportRaw = async (ADMIN) => { const r = await http('GET', '/api/voice-calibration/admin/export.xlsx', ADMIN, 'admin'); return Object.values(require('../services/xlsxLite').unzipStored(r.data)).map(String).join('\n'); };
  const totals = (raw) => { const m = raw.match(/(\d+) transcription call\(s\) and (\d+) parser call\(s\) in the round/); return m ? { t: +m[1], r: +m[2] } : null; };
  // Failure switches (counted with a sequence, which a rolled-back failure still uses up).
  const ctl = async (table, n, pattern, mode = 'all') => { await pool.query(`DELETE FROM ${table}`); await pool.query(`INSERT INTO ${table} VALUES ($1,$2,$3)`, [n, pattern, mode]); await pool.query(`ALTER SEQUENCE ${table}_seq RESTART WITH 1`); };
  process.env.RAILWAY_GIT_BRANCH = 'test';
  try {
    await cleanAll();
    for (const t of ['vc_test_spend_ctl', 'vc_test_attempt_ctl']) { await pool.query(`CREATE TABLE IF NOT EXISTS ${t} (n INT, pattern TEXT, mode TEXT)`); await pool.query(`CREATE SEQUENCE IF NOT EXISTS ${t}_seq`); await ctl(t, 0, ''); }
    await pool.query(`CREATE OR REPLACE FUNCTION vc_test_spend_fn() RETURNS trigger AS $$ BEGIN
      IF NEW.attempt_key IS NOT NULL AND EXISTS (SELECT 1 FROM vc_test_spend_ctl c WHERE c.n > 0 AND NEW.attempt_key LIKE c.pattern AND (c.mode = 'all' OR NEW.take_id IS NULL))
         AND nextval('vc_test_spend_ctl_seq') <= (SELECT n FROM vc_test_spend_ctl LIMIT 1) THEN RAISE EXCEPTION 'forced spend-write failure (test)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE OR REPLACE FUNCTION vc_test_attempt_fn() RETURNS trigger AS $$ BEGIN
      IF EXISTS (SELECT 1 FROM vc_test_attempt_ctl c WHERE c.n > 0 AND NEW.attempt_key LIKE c.pattern)
         AND nextval('vc_test_attempt_ctl_seq') <= (SELECT n FROM vc_test_attempt_ctl LIMIT 1) THEN RAISE EXCEPTION 'forced attempt-write failure (test)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`DROP TRIGGER IF EXISTS vc_test_spend ON voice_calibration_spend`); await pool.query(`CREATE TRIGGER vc_test_spend BEFORE INSERT ON voice_calibration_spend FOR EACH ROW EXECUTE FUNCTION vc_test_spend_fn()`);
    await pool.query(`DROP TRIGGER IF EXISTS vc_test_attempt ON voice_calibration_attempts`); await pool.query(`CREATE TRIGGER vc_test_attempt BEFORE INSERT ON voice_calibration_attempts FOR EACH ROW EXECUTE FUNCTION vc_test_attempt_fn()`);

    const ADMIN = await mk(`Cal Admin ${tag}`, 'admin');
    const A = (m, u, b) => http(m, u, ADMIN, 'admin', b);
    const listener = (await A('POST', '/api/voice-calibration/admin/reviewers', { name: 'Ledger3d Listener Example', role: 'listener' })).data.code;
    const kv = await mk(`Deepa Nayak ${tag}`);
    await A('POST', '/api/voice-calibration/admin/invite', { member_id: kv, group: 'kn', profile_note: '40s' });
    await http('POST', '/api/voice-calibration/consent', kv, 'patient', { phone_type: 'android_mid', browser: 'chrome', device: { make: 'Samsung', model: 'Galaxy A34', os: 'android', os_version: '14', browser_version: '130' } });
    await pool.query(`INSERT INTO voice_calibration_wording (lang, script_sha256, confirmed_by, recorded_by) VALUES ('kn', $1, 'R9', $2) ON CONFLICT (lang) DO UPDATE SET script_sha256 = EXCLUDED.script_sha256`, [C.scriptSha('kn'), ADMIN]);
    const speech = fs.readFileSync(path.join(FIX, 'speech-kn.webm')).toString('base64');
    const prep = async (slot) => {
      await http('POST', '/api/voice-calibration/take', kv, 'patient', { slot, audio: speech, mimeType: 'audio/webm' });
      const t = (await q(`SELECT t.id FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE p.patient_id=$1 AND t.slot_code=$2 AND t.superseded_at IS NULL`, [kv, slot]))[0];
      await A('POST', '/api/voice-calibration/admin/reference', { take_id: t.id, listener_code: listener, heard: 'speech', spoken_as_script: true });
      await pool.query(`UPDATE voice_calibration_takes SET speech_status='no_speech', voiced_frames=9, longest_run_frames=4, f0_spread_raw=22, hop_ms=20, gemini_text='eradu idli ondu bowl sambar', whisper_text='eradu idli ondu bowl sambar', whisper_review='{"accepted":true}' WHERE id=$1`, [t.id]);
      return t.id;
    };

    console.log('\n[1] ordinary flows: every attempt is started before its call and recorded with its count');
    const k1 = await prep('k01-q');
    let r = await A('POST', '/api/voice-calibration/admin/preview-eval', {});
    const att = await q(`SELECT kind, state FROM voice_calibration_attempts ORDER BY started_at`);
    ck('an upload (1 attempt) and a judged take (2 parser attempts): all recorded, none left started; ledger = calls made', r.status === 200 && att.length === 3 && att.every(a => a.state === 'recorded') && (await started()).length === 0
      && await ledger('transcription') === engineCalls() && await ledger('rule3') === calls.parser, att);
    const up1 = (await q(`SELECT state, ever_kept FROM voice_calibration_uploads WHERE slot_code='k01-q'`))[0];
    ck('…and its upload is marked kept AND "ever kept" when the take is saved (before any schema run could fill it in)', up1?.state === 'kept' && up1?.ever_kept === true, up1);

    console.log('\n[2] the attempt is written BEFORE the call: if it cannot be, no call is made');
    let e0 = engineCalls(), p0 = calls.parser;
    await ctl('vc_test_attempt_ctl', 999, 'take:%');
    r = await http('POST', '/api/voice-calibration/take', kv, 'patient', { slot: 'k02-q', audio: speech, mimeType: 'audio/webm' });
    await ctl('vc_test_attempt_ctl', 0, '');
    ck('upload: the attempt cannot be written → 503, NO engine call, nothing uploaded or registered', r.status === 503 && engineCalls() === e0 && (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_uploads WHERE slot_code='k02-q'`))[0].n === 0, { status: r.status });
    // An upload that fails to reach storage ends its attempt as "no call" (no engine was called), never as unresolved.
    e0 = engineCalls();
    const realPut = storage.putObject; storage.putObject = async () => { throw new Error('forced: storage put failed (test)'); };
    try { r = await http('POST', '/api/voice-calibration/take', kv, 'patient', { slot: 'k06-q', audio: speech, mimeType: 'audio/webm' }); } finally { storage.putObject = realPut; }
    const noCall = await q(`SELECT state FROM voice_calibration_attempts WHERE slot_code='k06-q'`);
    ck('an upload that cannot reach storage → 502, no engine call, its attempt closed as "no call" (not left unresolved)', r.status === 502 && engineCalls() === e0 && noCall.length === 1 && noCall[0].state === 'no call' && (await started()).length === 0, { status: r.status, noCall });
    const k2 = await prep('k02-q');
    await ctl('vc_test_attempt_ctl', 999, 'rule3:%');
    r = await A('POST', '/api/voice-calibration/admin/preview-eval', {});
    await ctl('vc_test_attempt_ctl', 0, '');
    const claims = await q(`SELECT status FROM voice_calibration_preview_judgments WHERE take_id=$1`, [k2]);
    ck('parser: the attempt cannot be written → 503, NO parser call, and the claim is released (nothing left "running")', r.status === 503 && r.data.parser_called === false && calls.parser === p0 && claims.length === 0, { status: r.status, claims });
    p0 = calls.parser;
    await ctl('vc_test_attempt_ctl', 1, 'rule3:%');
    r = await A('POST', '/api/voice-calibration/admin/preview-eval', {});
    await ctl('vc_test_attempt_ctl', 0, '');
    ck('…a one-off failure writing the attempt is retried: the check then runs normally (2 calls made, 2 counted, nothing started)', r.status === 200 && calls.parser - p0 === 2 && await ledger('rule3') === calls.parser && (await started()).length === 0, r.data);

    console.log('\n[3] a REAL restart: calls made, ledger writes failing, then the process exits');
    const k3 = await prep('k04-q');
    await ctl('vc_test_spend_ctl', 999, 'rule3:%');
    const lp0 = await ledger('rule3');
    const c1 = child({ mode: 'parser', admin: ADMIN });
    const s1 = await started();
    ck('child process (parser): its parser answered (1 call), every ledger write failed, the judgment was not saved (500), and it exited with the call only in memory',
      c1.status === 500 && c1.parser === 1 && c1.waiting === 1 && c1.exit === 0 && await ledger('rule3') === lp0 && s1.length === 1 && s1[0].kind === 'rule3', c1);
    await ctl('vc_test_spend_ctl', 0, '');
    const pBefore = calls.parser, eBefore = engineCalls();
    let raw = await exportRaw(ADMIN);
    ck('after the restart (a fresh process, writes working again): the export is still UNRESOLVED (calls UNKNOWN, at most 1, not in the totals) — never silently 0',
      /UNRESOLVED: 1 attempt\(s\) were started but their calls were never recorded .*at most 1/.test(raw) && totals(raw).r === lp0, (raw.match(/.{0,20}UNRESOLVED.{0,200}/) || [''])[0]);
    ck('…the screen stays incomplete ("call ledger: 1 attempt(s) not yet written (1 with unknown calls, to be settled)"), and nothing called a provider to repair it',
      /call ledger: 1 attempt\(s\) not yet written \(1 with unknown calls, to be settled\)/.test(raw) && calls.parser === pBefore && engineCalls() === eBefore);
    // Failed and refused uploads across a restart.
    const vol = await mk(`Rohan Kamath ${tag}`);
    await A('POST', '/api/voice-calibration/admin/invite', { member_id: vol, group: 'en', profile_note: '30s' });
    await http('POST', '/api/voice-calibration/consent', vol, 'patient', { phone_type: 'android_budget', browser: 'chrome', device: { make: 'Redmi', model: '12C', os: 'android', os_version: '13', browser_version: '129' } });
    await pool.query(`CREATE OR REPLACE FUNCTION vc_test_fail_take() RETURNS trigger AS $$ BEGIN IF NEW.slot_code = 'x02-q' THEN RAISE EXCEPTION 'forced take-write failure (test)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER vc_test_fail_take BEFORE INSERT ON voice_calibration_takes FOR EACH ROW EXECUTE FUNCTION vc_test_fail_take()`);
    await ctl('vc_test_spend_ctl', 999, 'take:%', 'unlinked');
    const lt0 = await ledger('transcription');
    let c2;
    try { c2 = child({ mode: 'take-failed', vol, slot: 'x02-q' }); } finally { await pool.query(`DROP TRIGGER IF EXISTS vc_test_fail_take ON voice_calibration_takes`); await pool.query(`DROP FUNCTION IF EXISTS vc_test_fail_take()`); }
    ck('child process (failed upload): the engines answered (2 calls), the take could not be written, its spend writes failed; exited with them only in memory',
      c2.status === 500 && c2.engines === 2 && c2.waiting === 1 && await ledger('transcription') === lt0 && (await started()).filter(a => a.kind === 'transcription').length === 1, c2);
    await http('POST', '/api/voice-calibration/take', vol, 'patient', { slot: 'x01-q', audio: silence, mimeType: 'audio/webm' });
    const tx = (await q(`SELECT t.id FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE p.patient_id=$1 AND t.slot_code='x01-q'`, [vol]))[0];
    await A('POST', '/api/voice-calibration/admin/reference', { take_id: tx.id, listener_code: listener, heard: 'uncertain' });
    await A('POST', '/api/voice-calibration/admin/replacement', { take_id: tx.id });
    const lt1 = await ledger('transcription');
    const c3 = child({ mode: 'take-refused', vol, slot: 'x01-q' });
    await ctl('vc_test_spend_ctl', 0, '');
    const after3 = await started();
    ck('child process (two replacement uploads at once): one kept (its spend written with the take), one refused whose spend never got written; exited',
      JSON.stringify((c3.statuses || []).slice().sort()) === JSON.stringify([200, 409]) && c3.engines === 4 && await ledger('transcription') - lt1 === 2 && after3.filter(a => a.kind === 'transcription').length === 2, { c3, after3 });
    raw = await exportRaw(ADMIN);
    ck('after the restart: 3 attempts UNRESOLVED (1 parser, at most 1 call; the failed and the refused upload, at most 3 calls each): "at most 7", none in the totals',
      /UNRESOLVED: 3 attempt\(s\) were started but their calls were never recorded .*at most 7/.test(raw) && /call ledger: 3 attempt\(s\) not yet written \(3 with unknown calls/.test(raw), (raw.match(/.{0,20}UNRESOLVED.{0,200}/) || [''])[0]);

    console.log('\n[4] repeated retries, genuine repeats, withdrawal, expiry, schema replay');
    const before = { t: await ledger('transcription'), r: await ledger('rule3'), s: (await started()).length };
    await routes._spend.flush(); await routes._spend.flush(); await exportRaw(ADMIN); await exportRaw(ADMIN);
    ck('repeated bookkeeping (flushes, exports) changes nothing and calls nothing', JSON.stringify({ t: await ledger('transcription'), r: await ledger('rule3'), s: (await started()).length }) === JSON.stringify(before) && calls.parser === pBefore && engineCalls() === eBefore + engineCalls() - eBefore);
    e0 = engineCalls();
    const dbl = await Promise.all([1, 2].map(() => http('POST', '/api/voice-calibration/take', vol, 'patient', { slot: 'x02-n', audio: silence, mimeType: 'audio/webm' })));
    const dAtt = await q(`SELECT state FROM voice_calibration_attempts WHERE slot_code='x02-n'`);
    ck('genuine repeated calls (a double submit): two distinct attempts, both recorded, 4 calls counted', dbl.every(x => x.status === 200) && dAtt.length === 2 && dAtt.every(a => a.state === 'recorded') && engineCalls() - e0 === 4);
    await http('POST', '/api/voice-calibration/withdraw', vol, 'patient');
    await pool.query(`UPDATE voice_calibration_takes SET delete_after = NOW() - INTERVAL '1 day'`);
    await routes.deleteExpiredTakes(pool);
    await pool.query(SCHEMA); await pool.query(SCHEMA);
    ck('withdrawal, the 90-day clean-up and two schema replays: the 3 unresolved attempts are still there (state "started")', (await started()).length === 3);

    console.log('\n[5] an administrator settles each from the provider\'s own records');
    const keys = (await q(`SELECT attempt_key, kind, max_calls FROM voice_calibration_attempts WHERE state='started' ORDER BY attempt_key`));
    const parserKey = keys.find(k => k.kind === 'rule3').attempt_key;
    r = await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: parserKey, calls: 1, why: 'Groq usage console shows the call' });
    ck('settling an attempt that may still be running is refused (under 10 minutes old)', r.status === 409 && /Wait 10 minutes/.test(r.data.error || ''));
    await pool.query(`UPDATE voice_calibration_attempts SET started_at = NOW() - INTERVAL '20 minutes' WHERE state='started'`);
    ck('…a number above the attempt\'s maximum, or no reason, is refused', (await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: parserKey, calls: 2, why: 'console says 2' })).status === 400
      && (await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: parserKey, calls: 1, why: '' })).status === 400);
    const rs = await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: parserKey, calls: 1, why: 'Groq usage console shows the call' });
    const again = await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: parserKey, calls: 1, why: 'Groq usage console shows the call' });
    ck('settled with 1 call: recorded once (a second settle is refused as already settled); the ledger gains exactly 1; no provider called', rs.status === 200 && again.status === 409 && /already settled/.test(again.data.error || '') && await ledger('rule3') === before.r + 1 && calls.parser === pBefore);
    for (const k of keys.filter(x => x.kind === 'transcription')) await A('POST', '/api/voice-calibration/admin/attempts/settle', { attempt_key: k.attempt_key, calls: 2, why: 'Gemini and Groq consoles: one call each' });
    raw = await exportRaw(ADMIN);
    ck('all three settled: UNRESOLVED clears; the export totals include the settled calls and say they were settled by hand (3 attempts, 5 calls)', !/UNRESOLVED/.test(raw) && !/call ledger:/.test(raw) && /3 attempt\(s\) were settled by an administrator from the provider's own records \(5 call\(s\), included above\)/.test(raw)
      && totals(raw).r === await ledger('rule3') && totals(raw).t === await ledger('transcription'), (raw.match(/.{0,40}settled by an administrator.{0,80}/) || [''])[0]);

    console.log('\n[6] the export tells never-kept uploads apart from kept recordings deleted later');
    raw = await exportRaw(ADMIN);
    const never = (raw.match(/recordings never kept \(refused or not saved\)<\/t><\/is><\/c><c[^>]*><is><t[^>]*>([^<]*)/) || [])[1] || '';
    const keptThen = (raw.match(/recordings kept, then deleted<\/t><\/is><\/c><c[^>]*><is><t[^>]*>([^<]*)/) || [])[1] || '';
    const states = await q(`SELECT ever_kept, state, COUNT(*)::int AS n FROM voice_calibration_uploads GROUP BY 1, 2`);
    const keptDeleted = states.filter(x => x.ever_kept && x.state === 'deleted').reduce((n, x) => n + x.n, 0), neverDeleted = states.filter(x => !x.ever_kept && x.state === 'deleted').reduce((n, x) => n + x.n, 0);
    // Kept, then deleted: the withdrawn volunteer's 4 kept recordings and the other volunteer's 3, removed by the 90-day clean-up.
    // Never kept: the upload that could not reach storage, the upload whose take could not be written, and the refused replacement.
    ck(`kept recordings later deleted by withdrawal or the 90-day limit (${keptDeleted}) are "kept, then deleted"; the failed and refused uploads (${neverDeleted}) are "never kept"`,
      keptDeleted === 7 && neverDeleted === 3 && keptThen.startsWith('7 (kept with their take') && never.startsWith('3 deleted'), { states, never, keptThen });
  } catch (e) { ck('the suite ran to the end', false, e.stack); }
  finally {
    for (const t of ['vc_test_spend', 'vc_test_attempt']) await pool.query(`DROP TRIGGER IF EXISTS ${t} ON voice_calibration_${t === 'vc_test_spend' ? 'spend' : 'attempts'}`).catch(() => {});
    await pool.query(`DROP TRIGGER IF EXISTS vc_test_fail_take ON voice_calibration_takes`).catch(() => {});
    for (const f of ['vc_test_spend_fn()', 'vc_test_attempt_fn()', 'vc_test_fail_take()']) await pool.query(`DROP FUNCTION IF EXISTS ${f}`).catch(() => {});
    for (const t of ['vc_test_spend_ctl', 'vc_test_attempt_ctl']) { await pool.query(`DROP TABLE IF EXISTS ${t}`).catch(() => {}); await pool.query(`DROP SEQUENCE IF EXISTS ${t}_seq`).catch(() => {}); }
    await cleanAll();
    S.server.close(); R2.server?.close?.(); await pool.end().catch(() => {});
  }
  console.log(`\nVoice calibration 3d review fixes: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
