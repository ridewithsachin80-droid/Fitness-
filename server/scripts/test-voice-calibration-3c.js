/**
 * scripts/test-voice-calibration-3c.js — Fixes-3c: the 3b calibration-kit review (26 Oct 2026), three findings. REAL Postgres,
 * the REAL routes and the FULL schema.sql replayed as startup runs it; STUBBED providers whose calls this suite counts itself.
 *
 *   [1] schema replay never double-counts: completed parser work (new attempt rows, a legacy row, a mixed judgment, several
 *       genuine attempts for one judgment) survives two full replays unchanged; a database from before Fixes-3b (no spend
 *       columns) migrates; duplicates an earlier boot already added are moved to a reconciliation record, nothing genuine lost;
 *       the real export equals the independently counted calls before and after the replays, withdrawal and expiry;
 *   [2] a failed spend write is never swallowed: one-off, repeated and persistent failures on the parser path, and the shared
 *       helper on refused and failed uploads; recovery reuses the attempt key (no provider called again); anything not yet
 *       written is UNRESOLVED in the export and keeps the screen incomplete;
 *   [3] an upload whose database connection cannot be had is cleaned up: the audio deleted, the outcome marked, the calls
 *       counted; a failed deletion is recorded and retried by the daily clean-up; kept uploads are untouched.
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

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 500))); };
const FIX = path.join(__dirname, 'fixtures/voice');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');

(async () => {
  const KEYS = { id: 'AKIDTESTONLY0014', secret: 'calibration-3c-secret' };
  const R2 = await startR2(storage, KEYS);
  Object.assign(process.env, { R2_ACCOUNT_ID: 'local', R2_ACCESS_KEY_ID: KEYS.id, R2_SECRET_ACCESS_KEY: KEYS.secret, R2_BUCKET: 'fitlife-test', R2_ENDPOINT: R2.endpoint });
  const pool = require('../db/pool');
  const routes = require('../routes/voiceCalibration');
  const app = express(); app.use(express.json({ limit: '15mb' }));
  app.use('/api/voice-calibration', routes);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`, tag = Date.now().toString(36);
  const TABLES = ['voice_calibration_preview_judgments', 'voice_calibration_preview_evals', 'voice_calibration_takes', 'voice_calibration_participants', 'voice_calibration_wording', 'voice_calibration_partc',
    'voice_calibration_partc_sessions', 'voice_calibration_partc_armed', 'voice_calibration_reviewers', 'voice_calibration_replacement_grants', 'voice_calibration_spend', 'voice_calibration_spend_reconciled', 'voice_calibration_uploads'];
  const q = async (sql, args) => (await pool.query(sql, args)).rows;
  const cleanAll = async () => { for (const t of TABLES) await pool.query(`DELETE FROM ${t}`).catch(() => {}); };
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1))`);
  const mk = async (name, role = 'patient') => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, '4' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), role])).rows[0].id;
  const tok = (id, role) => jwt.sign({ id, role, name: 'x' }, process.env.JWT_SECRET, { expiresIn: 600 });
  const http = async (method, u, id, role, body) => {
    const r = await fetch(url + u, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok(id, role)}` }, body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const ledger = async (kind) => Number((await q(`SELECT COALESCE(SUM(calls), 0)::int AS n FROM voice_calibration_spend${kind ? ' WHERE kind=$1' : ''}`, kind ? [kind] : []))[0].n);
  const silence = fs.readFileSync(path.join(FIX, 'silence-digital.webm')).toString('base64');
  const speech = fs.readFileSync(path.join(FIX, 'speech-kn.webm')).toString('base64');
  // The failure count lives in a SEQUENCE: a rolled-back failure still uses up its number (a table counter would be undone).
  const failSpend = async (n, pattern) => { await pool.query(`CREATE TABLE IF NOT EXISTS vc_test_spend_fail (n INT, pattern TEXT)`); await pool.query(`CREATE SEQUENCE IF NOT EXISTS vc_test_spend_seq`);
    await pool.query(`DELETE FROM vc_test_spend_fail`); await pool.query(`INSERT INTO vc_test_spend_fail VALUES ($1,$2)`, [n, pattern]); await pool.query(`ALTER SEQUENCE vc_test_spend_seq RESTART WITH 1`); };
  const exportRaw = async (ADMIN) => { const r = await http('GET', '/api/voice-calibration/admin/export.xlsx', ADMIN, 'admin'); return { status: r.status, raw: Object.values(require('../services/xlsxLite').unzipStored(r.data)).map(String).join('\n') }; };
  const exportTotals = (raw) => { const m = raw.match(/(\d+) transcription call\(s\) and (\d+) parser call\(s\) in the round/); return m ? { t: +m[1], r: +m[2] } : null; };
  process.env.RAILWAY_GIT_BRANCH = 'test';
  try {
    await cleanAll();
    // Test-only failure switches: a spend INSERT whose attempt key matches `pattern` fails while n > 0.
    await failSpend(0, '');
    await pool.query(`CREATE OR REPLACE FUNCTION vc_test_spend_fail_fn() RETURNS trigger AS $$ BEGIN
      IF NEW.attempt_key IS NOT NULL AND EXISTS (SELECT 1 FROM vc_test_spend_fail WHERE n > 0 AND NEW.attempt_key LIKE pattern)
         AND nextval('vc_test_spend_seq') <= (SELECT n FROM vc_test_spend_fail LIMIT 1) THEN
        RAISE EXCEPTION 'forced spend-write failure (test)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`DROP TRIGGER IF EXISTS vc_test_spend_fail ON voice_calibration_spend`);
    await pool.query(`CREATE TRIGGER vc_test_spend_fail BEFORE INSERT ON voice_calibration_spend FOR EACH ROW EXECUTE FUNCTION vc_test_spend_fail_fn()`);

    // ── [1] Schema replay ───────────────────────────────────────────────────
    console.log('\n[1] the schema runs at every boot: it never double-counts and never loses a genuine call');
    await pool.query(SCHEMA); await pool.query(SCHEMA);
    ck('an empty database: two full schema runs create no spend rows', await ledger() === 0 && (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_spend_reconciled`))[0].n === 0);
    // A database from before Fixes-3b: the spend table without its 3b columns, holding a 3a-style row.
    await pool.query(`DROP INDEX IF EXISTS voice_cal_spend_attempt`);
    await pool.query(`ALTER TABLE voice_calibration_spend DROP COLUMN IF EXISTS attempt_key, DROP COLUMN IF EXISTS outcome, DROP COLUMN IF EXISTS judgment_ref`);
    let migrated = true; try { await pool.query(SCHEMA); } catch (e) { migrated = e.message; }
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='voice_calibration_spend' AND column_name IN ('attempt_key','outcome','judgment_ref')`)).length;
    await pool.query(`DROP TRIGGER IF EXISTS vc_test_spend_fail ON voice_calibration_spend`);
    await pool.query(`CREATE TRIGGER vc_test_spend_fail BEFORE INSERT ON voice_calibration_spend FOR EACH ROW EXECUTE FUNCTION vc_test_spend_fail_fn()`);
    ck('a database from before Fixes-3b (no attempt_key/outcome/judgment_ref): the schema adds the columns BEFORE the back-fills read them', migrated === true && cols === 3, migrated);

    const ADMIN = await mk(`Cal Admin ${tag}`, 'admin');
    const A = (m, u, b) => http(m, u, ADMIN, 'admin', b);
    const listener = (await A('POST', '/api/voice-calibration/admin/reviewers', { name: 'Ledger3c Listener Example', role: 'listener' })).data.code;
    const kv = await mk(`Ananya Hegde ${tag}`);
    await A('POST', '/api/voice-calibration/admin/invite', { member_id: kv, group: 'kn', profile_note: '40s' });
    await http('POST', '/api/voice-calibration/consent', kv, 'patient', { phone_type: 'android_mid', browser: 'chrome', device: { make: 'Samsung', model: 'Galaxy A34', os: 'android', os_version: '14', browser_version: '130' } });
    await pool.query(`INSERT INTO voice_calibration_wording (lang, script_sha256, confirmed_by, recorded_by) VALUES ('kn', $1, 'R9', $2) ON CONFLICT (lang) DO UPDATE SET script_sha256 = EXCLUDED.script_sha256`, [C.scriptSha('kn'), ADMIN]);
    const prep = async (slot) => {
      await http('POST', '/api/voice-calibration/take', kv, 'patient', { slot, audio: speech, mimeType: 'audio/webm' });
      const t = (await q(`SELECT t.id FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE p.patient_id=$1 AND t.slot_code=$2 AND t.superseded_at IS NULL`, [kv, slot]))[0];
      await A('POST', '/api/voice-calibration/admin/reference', { take_id: t.id, listener_code: listener, heard: 'speech', spoken_as_script: true });
      await pool.query(`UPDATE voice_calibration_takes SET speech_status='no_speech', voiced_frames=9, longest_run_frames=4, f0_spread_raw=22, hop_ms=20, gemini_text='eradu idli ondu bowl sambar', whisper_text='eradu idli ondu bowl sambar', whisper_review='{"accepted":true}' WHERE id=$1`, [t.id]);
      return t.id;
    };
    // NEW: completed 3b-style parser work through the real route (2 calls, attempt-recorded, judgment_ref).
    const k1 = await prep('k01-q');
    let r = await A('POST', '/api/voice-calibration/admin/preview-eval', {});
    // MULTIPLE GENUINE ATTEMPTS for one judgment: a reclaimed claim called the parser a second time (two attempt rows, one judgment).
    const jA = (await q(`SELECT id FROM voice_calibration_preview_judgments WHERE take_id=$1 ORDER BY id LIMIT 1`, [k1]))[0].id;
    await pool.query(`INSERT INTO voice_calibration_spend (kind, attempt_key, take_id, judgment_ref, participant_code, slot_code, calls, outcome) VALUES ('rule3', 'rule3:reclaimed-genuine', $1, $2, 'P1', 'k01-q', 1, NULL)`, [k1, jA]);
    // LEGACY: a judgment completed under 3a (its call recorded by judgment_id, no attempt key).
    const k2 = await prep('k02-q');
    const jL = (await q(`INSERT INTO voice_calibration_preview_judgments (take_id, engine, reference_sha, reference_version, judge_version, status, parser_calls, finished_at) VALUES ($1,'gemini','legacy-sha',1,'judge-3a.1','done',1,NOW()) RETURNING id`, [k2]))[0].id;
    await pool.query(`INSERT INTO voice_calibration_spend (kind, take_id, judgment_id, participant_code, slot_code, calls) VALUES ('rule3', $1, $2, 'P1', 'k02-q', 1)`, [k2, jL]);
    // UNRECORDED: a judgment done with no spend row at all (the back-fill must add exactly one).
    const jU = (await q(`INSERT INTO voice_calibration_preview_judgments (take_id, engine, reference_sha, reference_version, judge_version, status, parser_calls, finished_at) VALUES ($1,'whisper','legacy-sha',1,'judge-3a.1','done',1,NOW()) RETURNING id`, [k2]))[0].id;
    const expectRule3 = calls.parser + 1 /* reclaimed */ + 1 /* legacy */ + 1 /* unrecorded, back-filled */;
    const expectT = engineCalls();
    await pool.query(SCHEMA);
    const after1 = { r: await ledger('rule3'), t: await ledger('transcription') };
    await pool.query(SCHEMA);
    const after2 = { r: await ledger('rule3'), t: await ledger('transcription') };
    const perJudgment = await q(`SELECT COALESCE(judgment_ref, judgment_id) AS j, COUNT(*)::int AS rows, SUM(calls)::int AS calls FROM voice_calibration_spend WHERE kind='rule3' GROUP BY 1 ORDER BY 1`);
    ck(`review repro: completed new parser work + a legacy call + an unrecorded judgment → ${expectRule3} parser calls after the first AND the second full replay (was +2 per replay)`, r.status === 200 && after1.r === expectRule3 && after2.r === expectRule3 && after1.t === expectT && after2.t === expectT, { after1, after2, expectRule3, expectT, parser: calls.parser });
    ck('…the two genuine attempts for one judgment are both kept; the legacy row stays single; the unrecorded judgment is back-filled once', perJudgment.find(x => x.j === jA)?.rows === 2 && perJudgment.find(x => x.j === jL)?.rows === 1 && perJudgment.find(x => x.j === jU)?.rows === 1, perJudgment);
    let ex = await exportRaw(ADMIN);
    // Fixes-3f (the 3e review, finding 3): the export's parser total counts provider REQUESTS only (the stub's own count); the three
    // older rows (reclaimed 3b attempt, legacy, back-filled: parser checks with no unit) are reported apart, never added in.
    ck('the real export equals the independently counted calls after both replays (requests in the total; the 3 older checks apart)', ex.status === 200 && JSON.stringify(exportTotals(ex.raw)) === JSON.stringify({ t: expectT, r: calls.parser })
      && /Kept apart, NOT in these totals: 3 older parser check\(s\) on 3 row\(s\)/.test(ex.raw), exportTotals(ex.raw));
    // Duplicates an earlier (3b) boot already added: a legacy-shaped row for a judgment whose calls are attempt-recorded.
    const jN = (await q(`SELECT DISTINCT judgment_ref AS j FROM voice_calibration_spend WHERE kind='rule3' AND attempt_key LIKE 'rule3:%' AND judgment_ref <> $1`, [jA]))[0].j;   // the other new judgment (one duplicate per judgment, as a boot could add)
    await pool.query(`INSERT INTO voice_calibration_spend (kind, take_id, judgment_id, calls) VALUES ('rule3', $1, $2, 1), ('rule3', $1, $3, 1)`, [k1, jN, jA]);
    const inflated = await ledger('rule3');
    await pool.query(SCHEMA); await pool.query(SCHEMA);
    const rec = await q(`SELECT judgment_id, calls, duplicate_of FROM voice_calibration_spend_reconciled ORDER BY id`);
    ck(`duplicates an earlier boot added (${inflated - expectRule3}) are moved to the reconciliation record: the ledger is back to ${expectRule3}, every genuine attempt untouched`, inflated === expectRule3 + 2 && await ledger('rule3') === expectRule3 && rec.length === 2 && rec.every(x => /^rule3:/.test(x.duplicate_of || ''))
      && (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_spend WHERE judgment_ref=$1`, [jA]))[0].n === 2, { inflated, now: await ledger('rule3'), rec });
    ex = await exportRaw(ADMIN);
    // Fixes-3f: the reconciled rows are labelled by their unit (older parser checks), and the request total is the stub's count.
    ck('…and the export reports the reconciliation separately (2 rows, 2 older parser checks, kept in the record)', /2 duplicate row\(s\) \(2 older parser check\(s\)\) added by an earlier boot back-fill were removed from these totals/.test(ex.raw) && exportTotals(ex.raw)?.r === calls.parser);

    // ── [2] Spend write failures ─────────────────────────────────────────────
    console.log('\n[2] a failed spend write is never swallowed');
    let k = await prep('k01-n'), p0 = calls.parser, l0 = await ledger('rule3');
    await failSpend(1, 'rule3:%');
    r = await A('POST', '/api/voice-calibration/admin/preview-eval', {});
    ck('one failed spend INSERT (transient): retried with the same attempt key → judged 2, 2 parser calls made, 2 counted', r.status === 200 && r.data.judged === 2 && calls.parser - p0 === 2 && await ledger('rule3') - l0 === 2 && r.data.accounting_unresolved === 0, { data: r.data, made: calls.parser - p0, counted: await ledger('rule3') - l0 });
    k = await prep('k02-n'); p0 = calls.parser; l0 = await ledger('rule3');
    await failSpend(2, 'rule3:%');
    r = await A('POST', '/api/voice-calibration/admin/preview-eval', {});
    const rows2 = await q(`SELECT outcome, judgment_ref FROM voice_calibration_spend WHERE kind='rule3' AND take_id=$1`, [k]);
    ck('the early record fails twice: the judgment writes its own spend row in the same statement → judged 2, 2 made, 2 counted, both "judged", nothing waiting', r.status === 200 && r.data.judged === 2 && calls.parser - p0 === 2 && await ledger('rule3') - l0 === 2 && rows2.length === 2 && rows2.every(x => x.outcome === 'judged') && routes._spend.pending.size === 0, { data: r.data, rows2 });
    k = await prep('k04-q'); p0 = calls.parser; l0 = await ledger('rule3');
    await failSpend(999, 'rule3:%');
    r = await A('POST', '/api/voice-calibration/admin/preview-eval', {});
    const madeP = calls.parser - p0;
    const jStuck = await q(`SELECT status FROM voice_calibration_preview_judgments WHERE take_id=$1`, [k]);
    ck('persistent failure: the judgment is NOT saved without its call (500; it stays "running"); the call made is waiting, not lost', r.status === 500 && madeP === 1 && await ledger('rule3') - l0 === 0 && routes._spend.pending.size === 1 && jStuck.every(x => x.status === 'running'), { status: r.status, madeP, pending: routes._spend.pending.size, jStuck });
    ex = await exportRaw(ADMIN);
    const A0 = ex.raw;
    ck('…while it waits, the export says UNRESOLVED (totals short by 1 call) and the screen stays incomplete ("call ledger: 1 attempt(s) not yet written")', /UNRESOLVED: 1 attempt\(s\) \(1 call\(s\)\) could not be written to the ledger yet, so the totals below are short by 1/.test(A0) && /call ledger: 1 attempt\(s\) not yet written/.test(A0), (A0.match(/.{0,40}UNRESOLVED.{0,120}/) || [''])[0]);
    await failSpend(0, '');
    const pBefore = calls.parser;
    ex = await exportRaw(ADMIN);
    ck('…when the database accepts writes again, the next request writes it with the SAME attempt key (no provider called again); UNRESOLVED clears', routes._spend.pending.size === 0 && await ledger('rule3') - l0 === madeP && calls.parser === pBefore && !/UNRESOLVED/.test(ex.raw), { pending: routes._spend.pending.size });
    // The shared helper on the upload paths.
    const vol = await mk(`Sneha Pai ${tag}`);
    await A('POST', '/api/voice-calibration/admin/invite', { member_id: vol, group: 'en', profile_note: '30s' });
    await http('POST', '/api/voice-calibration/consent', vol, 'patient', { phone_type: 'android_budget', browser: 'chrome', device: { make: 'Redmi', model: '12C', os: 'android', os_version: '13', browser_version: '129' } });
    const up = (slot, extra = {}) => http('POST', '/api/voice-calibration/take', vol, 'patient', { slot, audio: silence, mimeType: 'audio/webm', ...extra });
    const takeOf = async (slot) => (await q(`SELECT t.* FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE p.patient_id=$1 AND t.slot_code=$2 AND t.superseded_at IS NULL`, [vol, slot]))[0];
    r = await up('x01-q'); const t1 = await takeOf('x01-q');
    await A('POST', '/api/voice-calibration/admin/reference', { take_id: t1.id, listener_code: listener, heard: 'uncertain' });
    await A('POST', '/api/voice-calibration/admin/replacement', { take_id: t1.id });
    let e0 = engineCalls(), lt0 = await ledger('transcription');
    await failSpend(2, 'take:%');
    engineDelay = 150;
    const twin = await Promise.all([1, 2].map(() => up('x01-q', { retake_reason: 'replacement' })));
    engineDelay = 0;
    await failSpend(0, ''); await routes._spend.flush();
    const refusedRow = (await q(`SELECT outcome FROM voice_calibration_spend WHERE kind='transcription' AND slot_code='x01-q' AND take_id IS NULL`))[0];
    ck('two replacement uploads at once while spend writes fail twice: one 200, one 409, and after the retry 4 made = 4 counted, the refused one marked "refused"', twin.filter(x => x.status === 200).length === 1 && twin.filter(x => x.status === 409).length === 1
      && engineCalls() - e0 === 4 && await ledger('transcription') - lt0 === 4 && /^refused/.test(refusedRow?.outcome || ''), { st: twin.map(x => x.status), made: engineCalls() - e0, counted: await ledger('transcription') - lt0, refusedRow });
    await pool.query(`CREATE OR REPLACE FUNCTION vc_test_fail_take() RETURNS trigger AS $$ BEGIN IF NEW.slot_code = 'x02-q' THEN RAISE EXCEPTION 'forced take-write failure (test)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER vc_test_fail_take BEFORE INSERT ON voice_calibration_takes FOR EACH ROW EXECUTE FUNCTION vc_test_fail_take()`);
    e0 = engineCalls(); lt0 = await ledger('transcription');
    await failSpend(2, 'take:%');
    try { r = await up('x02-q'); } finally { await pool.query(`DROP TRIGGER IF EXISTS vc_test_fail_take ON voice_calibration_takes`); await pool.query(`DROP FUNCTION IF EXISTS vc_test_fail_take()`); }
    await failSpend(0, ''); await routes._spend.flush();
    const nsRow = (await q(`SELECT outcome, calls FROM voice_calibration_spend WHERE kind='transcription' AND slot_code='x02-q'`))[0];
    ck('a take that cannot be written while its early spend record also fails: after the retry its 2 calls are counted, marked "not saved"', r.status === 500 && engineCalls() - e0 === 2 && await ledger('transcription') - lt0 === 2 && /^not saved/.test(nsRow?.outcome || '') && nsRow.calls === 2, nsRow);

    // ── [3] Upload clean-up ──────────────────────────────────────────────────
    console.log('\n[3] an upload that is not kept is always cleaned up');
    const objects = () => R2.objects.size;
    let o0 = objects(); e0 = engineCalls(); lt0 = await ledger('transcription');
    r = await up('x03-q'); const kept = await takeOf('x03-q');
    const keptUp = (await q(`SELECT state FROM voice_calibration_uploads WHERE object_key=$1`, [kept.object_key]))[0];
    ck('positive control: a kept upload: its audio stays, registered "kept", 2 calls counted', r.status === 200 && objects() === o0 + 1 && keptUp?.state === 'kept' && await ledger('transcription') - lt0 === 2);
    const realConnect = pool.connect.bind(pool);
    o0 = objects(); e0 = engineCalls(); lt0 = await ledger('transcription');
    let once = true; pool.connect = (...a) => { if (once && a.length === 0) { once = false; return Promise.reject(new Error('forced: no database connection (test)')); } return realConnect(...a); };   // only the route's own pool.connect() (pool.query calls connect(cb) internally)
    try { r = await up('x01-n'); } finally { pool.connect = realConnect; }
    const lostUp = (await q(`SELECT state, reason FROM voice_calibration_uploads WHERE slot_code='x01-n' ORDER BY created_at DESC LIMIT 1`))[0];
    const lostSpend = (await q(`SELECT outcome, calls FROM voice_calibration_spend WHERE kind='transcription' AND slot_code='x01-n' ORDER BY id DESC LIMIT 1`))[0];
    ck('review repro: no database connection after the engines answered → 500, the uploaded audio DELETED (was left behind), no take, 2 made = 2 counted, marked "not saved"',
      r.status === 500 && objects() === o0 && !(await takeOf('x01-n')) && engineCalls() - e0 === 2 && await ledger('transcription') - lt0 === 2 && lostUp?.state === 'deleted' && /^not saved/.test(lostSpend?.outcome || ''), { status: r.status, objects: objects() - o0, lostUp, lostSpend });
    o0 = objects();
    once = true; pool.connect = (...a) => { if (once && a.length === 0) { once = false; return Promise.reject(new Error('forced: no database connection (test)')); } return realConnect(...a); };   // only the route's own pool.connect() (pool.query calls connect(cb) internally)
    const realDelete = storage.deleteObject; let delOnce = true;
    storage.deleteObject = async (...a) => { if (delOnce) { delOnce = false; throw new Error('forced: storage delete failed (test)'); } return realDelete.apply(storage, a); };
    try { r = await up('x02-n'); } finally { pool.connect = realConnect; storage.deleteObject = realDelete; }
    const dfUp = (await q(`SELECT object_key, state FROM voice_calibration_uploads WHERE slot_code='x02-n' ORDER BY created_at DESC LIMIT 1`))[0];
    ck('…and if deleting the audio also fails, the object is not abandoned: registered "delete failed" (still in storage, findable)', r.status === 500 && dfUp?.state === 'delete failed' && objects() === o0 + 1, dfUp);
    const swept = await routes.sweepUploads(pool);
    ck('…the daily clean-up retries it: deleted from storage, registered "deleted"', swept >= 1 && objects() === o0 && (await q(`SELECT state FROM voice_calibration_uploads WHERE object_key=$1`, [dfUp.object_key]))[0].state === 'deleted');
    // A server that died mid-upload leaves an "uploading" row: the clean-up finds it once it is old.
    await storage.putObject('voice-calibration/crash/x03-n-test.webm', Buffer.from('x'), 'audio/webm');
    await pool.query(`INSERT INTO voice_calibration_uploads (object_key, participant_id, slot_code, created_at) VALUES ('voice-calibration/crash/x03-n-test.webm', NULL, 'x03-n', NOW() - INTERVAL '2 hours')`);
    o0 = objects();
    await routes.deleteExpiredTakes(pool);
    ck('an upload left "uploading" by a crash is deleted by the daily clean-up once it is an hour old; kept uploads are untouched', objects() === o0 - 1 && (await q(`SELECT state FROM voice_calibration_uploads WHERE object_key='voice-calibration/crash/x03-n-test.webm'`))[0].state === 'deleted'
      && (await q(`SELECT state FROM voice_calibration_uploads WHERE object_key=$1`, [kept.object_key]))[0].state === 'kept');

    // ── Withdrawal and expiry: never lower the ledger; the export still matches ──
    console.log('\n[1] withdrawal and expiry, then the export again');
    const beforeW = { t: await ledger('transcription'), r: await ledger('rule3') };
    const independent = { t: engineCalls(), r: calls.parser + 1 /* reclaimed */ + 1 /* legacy */ + 1 /* back-filled */ };
    ck('the ledger equals every call counted independently (stub calls + the seeded legacy, reclaimed and back-filled calls)', JSON.stringify(beforeW) === JSON.stringify(independent), { beforeW, independent });
    await http('POST', '/api/voice-calibration/withdraw', vol, 'patient');
    await http('POST', '/api/voice-calibration/withdraw', kv, 'patient');
    await pool.query(`UPDATE voice_calibration_takes SET delete_after = NOW() - INTERVAL '1 day'`);
    await routes.deleteExpiredTakes(pool);
    await pool.query(SCHEMA);
    ex = await exportRaw(ADMIN);
    ck('after withdrawal, expiry and one more replay: the ledger and the real export still equal the independent count; no recording left in storage',
      // Fixes-3f: the ledger (every row) still equals the independent count; the export's request total excludes the 3 older checks.
      JSON.stringify({ t: await ledger('transcription'), r: await ledger('rule3') }) === JSON.stringify(independent) && JSON.stringify(exportTotals(ex.raw)) === JSON.stringify({ t: independent.t, r: calls.parser }) && objects() === 0
      && /Kept apart, NOT in these totals: 3 older parser check\(s\) on 3 row\(s\)/.test(ex.raw)
      && /recordings never kept \(refused or not saved\)/.test(ex.raw), { totals: exportTotals(ex.raw), independent, objects: objects() });
  } catch (e) { ck('the suite ran to the end', false, e.stack); }
  finally {
    await pool.query(`DROP TRIGGER IF EXISTS vc_test_spend_fail ON voice_calibration_spend`).catch(() => {});
    await pool.query(`DROP FUNCTION IF EXISTS vc_test_spend_fail_fn()`).catch(() => {});
    await pool.query(`DROP TABLE IF EXISTS vc_test_spend_fail`).catch(() => {});
    await pool.query(`DROP SEQUENCE IF EXISTS vc_test_spend_seq`).catch(() => {});
    await pool.query(`DROP TRIGGER IF EXISTS vc_test_fail_take ON voice_calibration_takes`).catch(() => {});
    await cleanAll();
    server.close(); R2.server?.close?.(); await pool.end().catch(() => {});
  }
  console.log(`\nVoice calibration 3c review fixes: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
