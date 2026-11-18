/**
 * scripts/test-voice-calibration-3b.js — Fixes-3b: the 3a calibration-kit review (25 Oct 2026). Provider and parser calls are
 * counted when they HAPPEN, so a request refused or rolled back after the engines answered still has its calls in the ledger.
 * REAL Postgres and the REAL routes; STUBBED providers, whose calls this suite counts itself, independently of the ledger.
 *
 *   - the review repro: two simultaneous replacement uploads for one grant → one 200, one 409, one replacement kept, one grant
 *     used, and the ledger equals the provider calls actually made (both uploads called the engines: 4 and 4);
 *   - positive control: one ordinary upload, its calls counted once (the early record and the commit link are one attempt);
 *   - a take that cannot be written after the engines answered: its calls are counted, marked "not saved";
 *   - a repeated upload refused before the engines are called costs nothing and adds nothing; a double submit counts each attempt once;
 *   - a parser call whose judgment cannot be saved is counted; ordinary judged calls are counted once;
 *   - withdrawal and the 90-day clean-up never lower the ledger; the export's totals equal the independently counted calls,
 *     and the calls whose result was never kept are reported as such (not as deleted recordings).
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

// Provider stubs that COUNT their own calls (the independent count the ledger is checked against).
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

(async () => {
  const KEYS = { id: 'AKIDTESTONLY0013', secret: 'calibration-3b-secret' };
  const R2 = await startR2(storage, KEYS);
  Object.assign(process.env, { R2_ACCOUNT_ID: 'local', R2_ACCESS_KEY_ID: KEYS.id, R2_SECRET_ACCESS_KEY: KEYS.secret, R2_BUCKET: 'fitlife-test', R2_ENDPOINT: R2.endpoint });
  const pool = require('../db/pool');
  const app = express(); app.use(express.json({ limit: '15mb' }));
  app.use('/api/voice-calibration', require('../routes/voiceCalibration'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`, tag = Date.now().toString(36);
  const TABLES = ['voice_calibration_preview_judgments', 'voice_calibration_preview_evals', 'voice_calibration_takes', 'voice_calibration_participants', 'voice_calibration_wording', 'voice_calibration_partc',
    'voice_calibration_partc_sessions', 'voice_calibration_partc_armed', 'voice_calibration_reviewers', 'voice_calibration_replacement_grants', 'voice_calibration_spend'];
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1))`);
  for (const t of TABLES) await pool.query(`DELETE FROM ${t}`);
  const mk = async (name, role = 'patient') => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, '8' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), role])).rows[0].id;
  const tok = (id, role) => jwt.sign({ id, role, name: 'x' }, process.env.JWT_SECRET, { expiresIn: 600 });
  const http = async (method, u, id, role, body) => {
    const r = await fetch(url + u, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok(id, role)}` }, body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const q = async (sql, args) => (await pool.query(sql, args)).rows;
  const ledger = async (kind) => Number((await q(`SELECT COALESCE(SUM(calls), 0)::int AS n FROM voice_calibration_spend WHERE kind=$1`, [kind]))[0].n);
  const ADMIN = await mk(`Cal Admin ${tag}`, 'admin');
  const A = (m, u, b) => http(m, u, ADMIN, 'admin', b);
  const silence = fs.readFileSync(path.join(FIX, 'silence-digital.webm')).toString('base64');
  const speech = fs.readFileSync(path.join(FIX, 'speech-kn.webm')).toString('base64');
  process.env.RAILWAY_GIT_BRANCH = 'test';
  try {
    const listener = (await A('POST', '/api/voice-calibration/admin/reviewers', { name: 'Spend Listener Example', role: 'listener' })).data.code;
    const vol = await mk(`Kavya Rao ${tag}`);
    await A('POST', '/api/voice-calibration/admin/invite', { member_id: vol, group: 'en', profile_note: '30s' });
    await http('POST', '/api/voice-calibration/consent', vol, 'patient', { phone_type: 'android_budget', browser: 'chrome', device: { make: 'Redmi', model: '12C', os: 'android', os_version: '13', browser_version: '129' } });
    const up = (slot, extra = {}) => http('POST', '/api/voice-calibration/take', vol, 'patient', { slot, audio: silence, mimeType: 'audio/webm', ...extra });
    const takeOf = async (slot) => (await q(`SELECT t.* FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE p.patient_id=$1 AND t.slot_code=$2 AND t.superseded_at IS NULL`, [vol, slot]))[0];

    console.log('\n[1] one ordinary upload (positive control): its calls are counted once');
    let e0 = engineCalls(), l0 = await ledger('transcription');
    let r = await up('x01-q');
    const t1 = await takeOf('x01-q');
    const rows1 = await q(`SELECT * FROM voice_calibration_spend WHERE take_id=$1`, [t1.id]);
    ck('one upload: 2 engine calls made (Gemini + Whisper), 2 in the ledger, ONE row for the attempt, marked saved and linked to its take',
      r.status === 200 && engineCalls() - e0 === 2 && await ledger('transcription') - l0 === 2 && rows1.length === 1 && rows1[0].calls === 2 && rows1[0].outcome === 'saved' && /^take:/.test(rows1[0].attempt_key || ''), rows1);

    console.log('\n[2] the review repro: two simultaneous replacement uploads for one grant');
    await A('POST', '/api/voice-calibration/admin/reference', { take_id: t1.id, listener_code: listener, heard: 'uncertain' });
    const g = await A('POST', '/api/voice-calibration/admin/replacement', { take_id: t1.id });
    e0 = engineCalls(); l0 = await ledger('transcription');
    engineDelay = 150;   // both requests are inside the engines at the same time
    const twin = await Promise.all([1, 2].map(() => up('x01-q', { retake_reason: 'replacement' })));
    engineDelay = 0;
    const made = engineCalls() - e0, counted = await ledger('transcription') - l0;
    const reps = (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_takes WHERE retake_reason='replacement'`))[0].n;
    const used = (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_replacement_grants WHERE replacement_take_id IS NOT NULL`))[0].n;
    const outcomes = (await q(`SELECT outcome, take_id IS NOT NULL AS linked FROM voice_calibration_spend WHERE kind='transcription' ORDER BY id DESC LIMIT 2`)).map(x => `${x.outcome}|${x.linked}`).sort();
    ck('one 200, one 409; one replacement kept; one grant used', g.status === 200 && twin.filter(x => x.status === 200).length === 1 && twin.filter(x => x.status === 409).length === 1 && reps === 1 && used === 1, { st: twin.map(x => x.status), reps, used });
    ck(`…the ledger equals the calls actually made: both uploads called the engines (${made}), and ${counted} are counted (was 2 of 4)`, made === 4 && counted === 4, { made, counted });
    ck('…the refused attempt is kept as such: one row saved and linked, one "refused (the grant was already used)" with no take', JSON.stringify(outcomes) === JSON.stringify(['refused (the grant was already used)|false', 'saved|true']), outcomes);

    console.log('\n[3] a take that cannot be written after the engines answered');
    await pool.query(`CREATE OR REPLACE FUNCTION vc_test_fail_take() RETURNS trigger AS $$ BEGIN IF NEW.slot_code = 'x02-q' THEN RAISE EXCEPTION 'forced take-write failure (test)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`DROP TRIGGER IF EXISTS vc_test_fail_take ON voice_calibration_takes`);
    await pool.query(`CREATE TRIGGER vc_test_fail_take BEFORE INSERT ON voice_calibration_takes FOR EACH ROW EXECUTE FUNCTION vc_test_fail_take()`);
    e0 = engineCalls(); l0 = await ledger('transcription');
    const objectsBefore = R2.objects ? R2.objects.size : null;
    try { r = await up('x02-q'); }
    finally { await pool.query(`DROP TRIGGER IF EXISTS vc_test_fail_take ON voice_calibration_takes`); await pool.query(`DROP FUNCTION IF EXISTS vc_test_fail_take()`); }
    const failedRow = (await q(`SELECT * FROM voice_calibration_spend WHERE kind='transcription' ORDER BY id DESC LIMIT 1`))[0];
    await new Promise(res => setTimeout(res, 300));
    ck('…and its uploaded audio is deleted (only the accounting row is kept)', objectsBefore !== null && R2.objects.size === objectsBefore, { objectsBefore, now: R2.objects.size });
    ck('the write failed (500, no take kept), yet its 2 engine calls are in the ledger, marked "not saved", with no take', r.status === 500 && !(await takeOf('x02-q')) && engineCalls() - e0 === 2 && await ledger('transcription') - l0 === 2
      && failedRow.take_id === null && /^not saved/.test(failedRow.outcome || ''), { status: r.status, failedRow });

    console.log('\n[4] repeated and duplicate requests');
    e0 = engineCalls(); l0 = await ledger('transcription');
    r = await up('x01-n'); const again = await up('x01-n');   // the same upload sent again: refused before the engines (no reason given)
    ck('a repeated upload refused before the engines are called (needs a reason) costs nothing and adds nothing; the first counts 2', r.status === 200 && again.status === 409 && engineCalls() - e0 === 2 && await ledger('transcription') - l0 === 2);
    e0 = engineCalls(); l0 = await ledger('transcription');
    const dbl = await Promise.all([1, 2].map(() => up('x02-n')));
    const keys = (await q(`SELECT attempt_key FROM voice_calibration_spend WHERE kind='transcription' AND slot_code='x02-n'`)).map(x => x.attempt_key);
    ck('a double submit (two at once) runs the engines twice: each attempt counted once (4 made, 4 counted, 2 distinct attempt keys)', dbl.every(x => x.status === 200) && engineCalls() - e0 === 4 && await ledger('transcription') - l0 === 4 && new Set(keys).size === 2 && keys.length === 2, keys);

    console.log('\n[5] parser calls: counted when the parser answers, even if the judgment cannot be saved');
    // A Kannada volunteer, wording confirmed, one speech take the live check refused at 180 ms (newly admitted at 160 ms).
    const kv = await mk(`Ravi Gowda ${tag}`);
    await A('POST', '/api/voice-calibration/admin/invite', { member_id: kv, group: 'kn', profile_note: '40s' });
    await http('POST', '/api/voice-calibration/consent', kv, 'patient', { phone_type: 'android_mid', browser: 'chrome', device: { make: 'Samsung', model: 'Galaxy A34', os: 'android', os_version: '14', browser_version: '130' } });
    await pool.query(`INSERT INTO voice_calibration_wording (lang, script_sha256, confirmed_by, recorded_by) VALUES ('kn', $1, 'R9', $2) ON CONFLICT (lang) DO UPDATE SET script_sha256 = EXCLUDED.script_sha256`, [C.scriptSha('kn'), ADMIN]);
    const kup = (slot) => http('POST', '/api/voice-calibration/take', kv, 'patient', { slot, audio: speech, mimeType: 'audio/webm' });
    const prep = async (slot) => {
      await kup(slot);
      const t = (await q(`SELECT t.id FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE p.patient_id=$1 AND t.slot_code=$2 AND t.superseded_at IS NULL`, [kv, slot]))[0];
      await A('POST', '/api/voice-calibration/admin/reference', { take_id: t.id, listener_code: listener, heard: 'speech', spoken_as_script: true });
      await pool.query(`UPDATE voice_calibration_takes SET speech_status='no_speech', voiced_frames=9, longest_run_frames=4, f0_spread_raw=22, hop_ms=20, gemini_text='eradu idli ondu bowl sambar', whisper_text='eradu idli ondu bowl sambar', whisper_review='{"accepted":true}' WHERE id=$1`, [t.id]);
      return t.id;
    };
    const kt1 = await prep('k01-q');
    let p0 = calls.parser, lp0 = await ledger('rule3');
    r = await A('POST', '/api/voice-calibration/admin/preview-eval', {});
    const judged = await q(`SELECT outcome, calls, judgment_ref FROM voice_calibration_spend WHERE kind='rule3' AND take_id=$1`, [kt1]);
    ck('positive control: two legs judged → 2 parser calls made, 2 counted, both rows "judged" and tied to their judgments', r.status === 200 && calls.parser - p0 === 2 && await ledger('rule3') - lp0 === 2 && judged.length === 2 && judged.every(x => x.outcome === 'judged' && x.judgment_ref), judged);
    const kt2 = await prep('k02-q');
    await pool.query(`CREATE OR REPLACE FUNCTION vc_test_fail_judgment() RETURNS trigger AS $$ BEGIN IF NEW.status = 'done' THEN RAISE EXCEPTION 'forced judgment-write failure (test)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER vc_test_fail_judgment BEFORE UPDATE ON voice_calibration_preview_judgments FOR EACH ROW EXECUTE FUNCTION vc_test_fail_judgment()`);
    p0 = calls.parser; lp0 = await ledger('rule3');
    try { r = await A('POST', '/api/voice-calibration/admin/preview-eval', {}); }
    finally { await pool.query(`DROP TRIGGER IF EXISTS vc_test_fail_judgment ON voice_calibration_preview_judgments`); await pool.query(`DROP FUNCTION IF EXISTS vc_test_fail_judgment()`); }
    const lost = await q(`SELECT outcome, calls FROM voice_calibration_spend WHERE kind='rule3' AND take_id=$1`, [kt2]);
    ck('the judgment could not be saved (500), yet the parser call it made is counted (made = counted), and not marked judged', r.status === 500 && calls.parser - p0 >= 1 && await ledger('rule3') - lp0 === calls.parser - p0 && lost.length === calls.parser - p0 && lost.every(x => x.outcome == null), { status: r.status, made: calls.parser - p0, lost });

    console.log('\n[6] withdrawal, the 90-day clean-up and the export');
    const before = { t: await ledger('transcription'), r: await ledger('rule3') };
    ck('the ledger matches every call the stubs saw, across the whole suite', before.t === engineCalls() && before.r === calls.parser, { before, engines: engineCalls(), parser: calls.parser });
    await http('POST', '/api/voice-calibration/withdraw', vol, 'patient');
    await pool.query(`UPDATE voice_calibration_takes SET delete_after = NOW() - INTERVAL '1 day'`);
    await require('../routes/voiceCalibration').deleteExpiredTakes(pool);
    const after = { t: await ledger('transcription'), r: await ledger('rule3') };
    ck('withdrawal and the 90-day clean-up delete the recordings but never lower the ledger', (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_takes`))[0].n === 0 && JSON.stringify(before) === JSON.stringify(after), { before, after });
    r = await A('GET', '/api/voice-calibration/admin/export.xlsx');
    const raw = Object.values(require('../services/xlsxLite').unzipStored(r.data)).map(String).join('\n');
    const line = (raw.match(/\d+ transcription call\(s\) and \d+ parser call\(s\) in the round[^<]*/) || [''])[0];
    const m = line.match(/^(\d+) transcription call\(s\) and (\d+) parser call\(s\).*?Of these, (\d+) were on recordings deleted since.*?and (\d+) on attempts whose result was never kept/);
    const notKept = 2 + 2 + (calls.parser ? lost.reduce((n, x) => n + x.calls, 0) : 0);   // the refused replacement, the failed write, the unsaved judgment
    ck(`the export's totals equal the independently counted calls (${engineCalls()} transcription, ${calls.parser} parser)`, r.status === 200 && m && +m[1] === engineCalls() && +m[2] === calls.parser, line);
    ck(`…and the calls whose result was never kept (${notKept}) are reported as such, apart from recordings deleted since`, m && +m[4] === notKept && +m[3] === engineCalls() + calls.parser - notKept, line);
  } catch (e) { ck('the suite ran to the end', false, e.stack); }
  finally {
    await pool.query(`DROP TRIGGER IF EXISTS vc_test_fail_take ON voice_calibration_takes`).catch(() => {});
    await pool.query(`DROP TRIGGER IF EXISTS vc_test_fail_judgment ON voice_calibration_preview_judgments`).catch(() => {});
    for (const t of TABLES) await pool.query(`DELETE FROM ${t}`).catch(() => {});
    server.close(); R2.server?.close?.(); await pool.end().catch(() => {});
  }
  console.log(`\nVoice calibration 3b review fixes: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
