/**
 * scripts/test-voice-fallback-test.js — Fixes-2p (B18): the test-only voice
 * fallback switch, on REAL Postgres through the REAL routes
 * (routes/aiChat.js voice-transcribe and routes/voiceFallbackTest.js).
 * Only the speech providers are stubbed: no real Gemini or Whisper call.
 *
 * What must hold:
 *   - Off unless the server is the test deployment (RAILWAY_GIT_BRANCH = 'test'),
 *     even if an account row exists. Production never skips Gemini.
 *   - Administrators only; one account at a time; off after 24 hours.
 *   - The named account skips Gemini and gets the REAL fallback path (language
 *     setting, checks, refusal); everyone else is untouched.
 *   - Every try is recorded with Whisper's raw answer and FitLife's decision.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GEMINI_API_KEY = 'stub-gemini'; process.env.GROQ_API_KEY = 'stub-groq';
delete process.env.RAILWAY_GIT_BRANCH; delete process.env.FITLIFE_TEST_SERVER;
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
const calls = [];
let whisperReply = () => ({ data: { text: '', language: 'english', segments: [] } });
const stubbedPost = async (url, body, cfg) => {
  if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
    calls.push({ kind: 'gemini' });
    return { data: { candidates: [{ content: { parts: [{ text: 'gemini heard: 2 idli' }] } }] } };
  }
  if (url === 'https://api.groq.com/openai/v1/audio/transcriptions') {
    calls.push({ kind: 'whisper', language: body.get('language'), format: body.get('response_format') });
    return whisperReply();
  }
  throw new Error('Unexpected external request blocked: ' + url);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const pool = require('../db/pool');
const X = require('../services/xlsxLite');
const app = express();
app.use(express.json({ limit: '8mb' }));
app.use('/api/ai-chat', require('../routes/aiChat'));
app.use('/api/voice-fallback-test', require('../routes/voiceFallbackTest'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n))
                            : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };
const seg = (text, avg_logprob, no_speech_prob, compression_ratio = 1.1) => ({ start: 0, end: 4, text, avg_logprob, no_speech_prob, compression_ratio });

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tag = Date.now().toString(36);
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1))`);
  const mk = async (name, role = 'patient', active = true) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,$4) RETURNING id`,
    [name, '6' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), role, active])).rows[0].id;
  const A = await mk(`FB Test A ${tag}`), B = await mk(`FB Test B ${tag}`), OFFUSER = await mk(`FB Off ${tag}`, 'patient', false);
  const COACH = await mk(`FB Coach ${tag}`, 'monitor'), ADMIN = await mk(`FB Admin ${tag}`, 'admin');
  const tok = (id, role) => jwt.sign({ id, role, name: 'x' }, process.env.JWT_SECRET, { expiresIn: 600 });
  const http = async (method, url, id, role, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok(id, role)}` }, body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const audio = Buffer.from('synthetic recorded audio').toString('base64');
  const voice = async (id, langHint = 'en-IN') => { calls.length = 0; return http('POST', '/api/ai-chat/voice-transcribe', id, 'patient', { audio, mimeType: 'audio/webm', langHint }); };
  const runCount = async () => Number((await pool.query(`SELECT COUNT(*) FROM voice_fallback_test_runs`)).rows[0].count);
  const lastRun = async () => (await pool.query(`SELECT * FROM voice_fallback_test_runs ORDER BY id DESC LIMIT 1`)).rows[0];
  await pool.query(`DELETE FROM voice_fallback_test_account`); await pool.query(`DELETE FROM voice_fallback_test_runs`);

  try {
    console.log('\n[1] off unless this is the test server, even if an account row exists');
    for (const branch of [undefined, 'main', 'Test', '']) {
      branch === undefined ? delete process.env.RAILWAY_GIT_BRANCH : process.env.RAILWAY_GIT_BRANCH = branch;
      const g = await http('GET', '/api/voice-fallback-test', ADMIN, 'admin');
      const p = await http('PUT', '/api/voice-fallback-test', ADMIN, 'admin', { user_id: A });
      await pool.query(`INSERT INTO voice_fallback_test_account (id, user_id, set_at) VALUES (1, $1, NOW()) ON CONFLICT (id) DO UPDATE SET user_id = $1, set_at = NOW()`, [A]);
      const v = await voice(A);
      ck(`branch ${JSON.stringify(branch ?? 'unset')}: reported unavailable, cannot be set, and the account still uses Gemini (no Whisper, nothing recorded)`,
        g.data.available === false && /test server/.test(g.data.message) && p.status === 409 && v.data.transcript === 'gemini heard: 2 idli'
          && calls.length === 1 && calls[0].kind === 'gemini' && await runCount() === 0, { g: g.data, p: p.status, v: v.data, calls });
    }
    // The back-up setting for the test service counts only when Railway reports no branch:
    // a copy of it on production (branch 'main') must never turn the switch on.
    process.env.FITLIFE_TEST_SERVER = 'yes';
    for (const branch of ['main', 'Test']) {
      process.env.RAILWAY_GIT_BRANCH = branch;
      const g = await http('GET', '/api/voice-fallback-test', ADMIN, 'admin');
      const v = await voice(A);
      ck(`FITLIFE_TEST_SERVER=yes on a server that reports branch "${branch}" is ignored: still off, account still on Gemini`, g.data.available === false && calls[0]?.kind === 'gemini' && await runCount() === 0, { g: g.data, calls });
    }
    for (const val of ['true', '1', 'YES']) {
      delete process.env.RAILWAY_GIT_BRANCH; process.env.FITLIFE_TEST_SERVER = val;
      const g = await http('GET', '/api/voice-fallback-test', ADMIN, 'admin');
      ck(`no branch reported and FITLIFE_TEST_SERVER=${val} (not exactly "yes") → off`, g.data.available === false);
    }
    delete process.env.RAILWAY_GIT_BRANCH; process.env.FITLIFE_TEST_SERVER = 'yes';
    {
      const g = await http('GET', '/api/voice-fallback-test', ADMIN, 'admin');
      whisperReply = () => ({ data: { text: '1 cup coffee', language: 'english', segments: [seg('1 cup coffee', -0.2, 0.02)] } });
      const v = await voice(A);
      ck('no branch reported and FITLIFE_TEST_SERVER=yes → available, and the named account goes to Whisper', g.data.available === true && v.data.transcript === '1 cup coffee' && calls.map(c => c.kind).join() === 'whisper', { g: g.data, v: v.data, calls });
      await pool.query(`DELETE FROM voice_fallback_test_runs`);
    }
    delete process.env.FITLIFE_TEST_SERVER;
    await pool.query(`DELETE FROM voice_fallback_test_account`);

    process.env.RAILWAY_GIT_BRANCH = 'test';
    console.log('\n[2] administrators only');
    for (const [id, role] of [[A, 'patient'], [COACH, 'monitor']]) {
      const g = await http('GET', '/api/voice-fallback-test', id, role);
      const p = await http('PUT', '/api/voice-fallback-test', id, role, { user_id: id });
      const d = await http('DELETE', '/api/voice-fallback-test/runs', id, role);
      ck(`a ${role === 'patient' ? 'member' : 'coach'} cannot read, set or clear it (403)`, g.status === 403 && p.status === 403 && d.status === 403);
    }
    const noTok = await fetch(base + '/api/voice-fallback-test');
    ck('no sign-in → 401', noTok.status === 401);

    console.log('\n[3] an administrator names one account, for 24 hours');
    {
      const g0 = await http('GET', '/api/voice-fallback-test', ADMIN, 'admin');
      ck('on the test server it is available and starts off', g0.data.available === true && g0.data.account === null && g0.data.hours === 24);
      const bad = await http('PUT', '/api/voice-fallback-test', ADMIN, 'admin', { user_id: 'x' });
      const missing = await http('PUT', '/api/voice-fallback-test', ADMIN, 'admin', { user_id: 99999999 });
      const off = await http('PUT', '/api/voice-fallback-test', ADMIN, 'admin', { user_id: OFFUSER });
      ck('no account / unknown account / switched-off account are refused (400 / 404 / 400)', bad.status === 400 && missing.status === 404 && off.status === 400);
      const p = await http('PUT', '/api/voice-fallback-test', ADMIN, 'admin', { user_id: A });
      const hours = (new Date(p.data.account?.ends_at) - new Date(p.data.account?.set_at)) / 3600000;
      ck('naming account A works and ends 24 hours later', p.status === 200 && p.data.account.user_id === A && Math.round(hours) === 24, p.data);
      const row = (await pool.query(`SELECT set_by FROM voice_fallback_test_account`)).rows[0];
      ck('who set it is kept', row?.set_by === ADMIN);
    }

    console.log('\n[4] the named account skips Gemini and gets the real fallback path');
    {
      whisperReply = () => ({ data: { text: 'ಎರಡು ಇಡ್ಲಿ, weight 82.5 kg', language: 'kannada', segments: [seg('ಎರಡು ಇಡ್ಲಿ,', -0.2, 0.02), seg(' weight 82.5 kg', -0.3, 0.03)] } });
      const v = await voice(A, 'kn-IN');
      ck('Gemini is not asked; Whisper is asked once, told Kannada, verbose answer', calls.length === 1 && calls[0].kind === 'whisper' && calls[0].language === 'kn' && calls[0].format === 'verbose_json', calls);
      ck('the accepted answer is passed on exactly, as the normal fallback does', v.status === 200 && v.data.transcript === 'ಎರಡು ಇಡ್ಲಿ, weight 82.5 kg' && v.data.engine === 'groq/whisper-large-v3', v.data);
      const r = await lastRun();
      ck('the try is recorded: account, language chosen and sent, raw text and language, decision, transcript',
        r.user_id === A && r.lang_hint === 'kn-IN' && r.language_sent === 'kn' && r.whisper_text === 'ಎರಡು ಇಡ್ಲಿ, weight 82.5 kg'
          && r.whisper_language === 'kannada' && r.accepted === true && r.reason === null && r.transcript === 'ಎರಡು ಇಡ್ಲಿ, weight 82.5 kg', r);
      ck('each section\'s raw numbers are recorded', r.segments.length === 2 && r.segments[1].avg_logprob === -0.3 && r.segments[1].no_speech_prob === 0.03 && r.segments[1].compression_ratio === 1.1, r.segments);
      const vB = await voice(B);
      ck('everyone else is untouched: account B still goes to Gemini, nothing recorded for B', vB.data.transcript === 'gemini heard: 2 idli' && calls.length === 1 && calls[0].kind === 'gemini'
        && Number((await pool.query(`SELECT COUNT(*) FROM voice_fallback_test_runs WHERE user_id=$1`, [B])).rows[0].count) === 0);
      // The 2n review's mixed-confidence answer, through the switch: refused, and recorded as refused.
      whisperReply = () => ({ data: { text: '2 idli, weight 82.5 kg', language: 'english', segments: [seg('2 idli,', -0.1, 0.01), seg('weight 82.5 kg', -1.8, 0.95)] } });
      const v2 = await voice(A, 'en-IN');
      const r2 = await lastRun();
      ck('a doubtful answer is refused as for any member (retry/type), English not set on Whisper', v2.data.transcript === '' && v2.data.rejected === 'unsure' && /retry/i.test(v2.data.message) && calls[0].language === null, { v: v2.data, calls });
      ck('and recorded as refused, with the raw text and numbers that caused it', r2.accepted === false && r2.reason === 'unsure' && r2.transcript === null && r2.whisper_text === '2 idli, weight 82.5 kg' && r2.language_sent === null && r2.segments[1].no_speech_prob === 0.95, r2);
      whisperReply = () => { const e = new Error('boom'); e.response = { status: 503, data: { error: { message: 'Whisper is busy' } } }; throw e; };
      const v3 = await voice(A);
      const r3 = await lastRun();
      ck('Whisper failing → the usual "could not transcribe" (the app falls back as it already does), recorded with the error', v3.status === 502 && r3.accepted === null && r3.error === 'Whisper is busy', { v: v3, r3 });
    }

    console.log('\n[5] one account at a time; turning off; clearing; the file');
    {
      await http('PUT', '/api/voice-fallback-test', ADMIN, 'admin', { user_id: B });
      whisperReply = () => ({ data: { text: '1 cup coffee', language: 'english', segments: [seg('1 cup coffee', -0.2, 0.02)] } });
      const vA = await voice(A); const aCalls = calls.map(c => c.kind);
      const vB = await voice(B); const bCalls = calls.map(c => c.kind);
      ck('naming B replaces A: A is back on Gemini, B skips it', vA.data.transcript === 'gemini heard: 2 idli' && aCalls.join() === 'gemini' && vB.data.transcript === '1 cup coffee' && bCalls.join() === 'whisper');
      await pool.query(`UPDATE voice_fallback_test_account SET set_at = NOW() - INTERVAL '25 hours'`);
      const g = await http('GET', '/api/voice-fallback-test', ADMIN, 'admin');
      const vOld = await voice(B);
      ck('after 24 hours it is off by itself: no account shown, B back on Gemini', g.data.account === null && vOld.data.transcript === 'gemini heard: 2 idli' && calls[0].kind === 'gemini');
      await http('PUT', '/api/voice-fallback-test', ADMIN, 'admin', { user_id: B });
      const d = await http('DELETE', '/api/voice-fallback-test', ADMIN, 'admin');
      const vOff = await voice(B);
      ck('"Turn off" ends it at once', d.status === 200 && vOff.data.transcript === 'gemini heard: 2 idli' && (await http('GET', '/api/voice-fallback-test', ADMIN, 'admin')).data.account === null);
      const g2 = await http('GET', '/api/voice-fallback-test', ADMIN, 'admin');
      ck('the recorded tries stay after turning off, newest first, with names', g2.data.runs.length === 4 && g2.data.runs[0].name === `FB Test B ${tag}` && g2.data.runs[0].transcript === '1 cup coffee');
      ck('each try names its account id (Fixes-2s: the evidence robot keeps only its own)', g2.data.runs.every(r => Number.isInteger(r.user_id)) && g2.data.runs[0].user_id === B && g2.data.runs.some(r => r.user_id === A));
      const x = await http('GET', '/api/voice-fallback-test/runs.xlsx', ADMIN, 'admin');
      const files = X.unzipStored(x.data);
      const s1 = files['xl/worksheets/sheet1.xml'].toString('utf8'), s2 = files['xl/worksheets/sheet2.xml'].toString('utf8');
      ck('the Excel file has every try (raw text, decision, reason) and every section\'s numbers',
        x.status === 200 && s1.includes('whisper_text_raw') && s1.includes('refused') && s1.includes('unsure') && s1.includes('ಎರಡು ಇಡ್ಲಿ') && s2.includes('no_speech_prob') && s2.includes('-1.8') && s2.includes('0.95'), s1.slice(0, 200));
      const c = await http('DELETE', '/api/voice-fallback-test/runs', ADMIN, 'admin');
      ck('"Clear" deletes the recorded tries', c.data.deleted === 4 && await runCount() === 0);
    }

    console.log('\n[6] the record keeps an unknown confidence value unknown (Fixes-2q, 2p review)');
    {
      const T = require('../services/voiceFallbackTest');
      const unknown = { null: null, blank: '', spaces: '  ', false: false, true: true, text: 'abc', NaN: NaN, Infinity: Infinity, array: [5], hex: '0x1A', object: {} };
      const bad = Object.entries(unknown).filter(([, v]) => T.num(v) !== null).map(([k, v]) => `${k} → ${T.num(v)}`);
      ck('null, blank, false, true, words, NaN, Infinity, a list, hex and an object are all recorded as unknown (null), never 0 or 1', bad.length === 0, bad);
      ck('a genuine 0 stays 0; -0.3 stays -0.3; decimal text ("-0.3", "0", "1e-3") is read as its number',
        T.num(0) === 0 && T.num(-0.3) === -0.3 && T.num('-0.3') === -0.3 && T.num('0') === 0 && T.num('1e-3') === 0.001);
      const secs = T.sectionsOf({ segments: [{ start: 0, end: 2, text: 'a', avg_logprob: null, no_speech_prob: '', compression_ratio: false }, { start: 2, end: 4, text: 'b', avg_logprob: 0, no_speech_prob: 0, compression_ratio: 0 }, { text: 'c' }] });
      ck('per section: null/blank/false fields → null; genuine zeros → 0; missing fields → null',
        secs[0].avg_logprob === null && secs[0].no_speech_prob === null && secs[0].compression_ratio === null
          && secs[1].avg_logprob === 0 && secs[1].no_speech_prob === 0 && secs[1].compression_ratio === 0
          && secs[2].avg_logprob === null && secs[2].start === null, secs);

      // Through the real route and database: what is stored and exported for the named account.
      // An earlier try (written before this fix, with zeros) must stay exactly as it was.
      await pool.query(`INSERT INTO voice_fallback_test_runs (user_id, lang_hint, whisper_text, segments, accepted, transcript) VALUES ($1, 'en-IN', 'old try', $2, true, 'old try')`,
        [A, JSON.stringify([{ start: 0, end: 1, text: 'old try', avg_logprob: 0, no_speech_prob: 0, compression_ratio: 0 }])]);
      await http('PUT', '/api/voice-fallback-test', ADMIN, 'admin', { user_id: A });
      whisperReply = () => ({ data: { text: '2 idli', language: 'english', segments: [
        { start: 0, end: 2, text: '2 idli', avg_logprob: -0.2, no_speech_prob: null, compression_ratio: '' },
        { start: 2, end: 3, text: ' ', avg_logprob: false, no_speech_prob: 0, compression_ratio: 1.1 }] } });
      const v = await voice(A);
      const r = await lastRun();
      ck('the voice decision is unchanged by the fix (the same accepted text as before)', v.data.transcript === '2 idli' && r.accepted === true, v.data);
      ck('stored: unknown values are null, the genuine 0 is 0, real numbers kept',
        r.segments[0].avg_logprob === -0.2 && r.segments[0].no_speech_prob === null && r.segments[0].compression_ratio === null
          && r.segments[1].avg_logprob === null && r.segments[1].no_speech_prob === 0 && r.segments[1].compression_ratio === 1.1, r.segments);
      const old = (await pool.query(`SELECT segments FROM voice_fallback_test_runs WHERE whisper_text = 'old try'`)).rows[0];
      const want = { start: 0, end: 1, text: 'old try', avg_logprob: 0, no_speech_prob: 0, compression_ratio: 0 };   // (the database stores keys in its own order)
      ck('an earlier recorded try is left exactly as it was', old.segments.length === 1 && Object.keys(want).length === Object.keys(old.segments[0]).length && Object.entries(want).every(([k, val]) => old.segments[0][k] === val), old.segments);
      const x = await http('GET', '/api/voice-fallback-test/runs.xlsx', ADMIN, 'admin');
      const s2 = X.unzipStored(x.data)['xl/worksheets/sheet2.xml'].toString('utf8');
      const rowOf = (n) => (s2.match(new RegExp(`<row r="${n}">(.*?)</row>`)) || [])[1] || '';
      // Sheet "Sections", newest try first: row 2 = "2 idli" section 1, row 3 = its section 2.
      const cells = (row) => [...row.matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>(?:<is><t[^>]*>(.*?)<\/t><\/is>)?<\/c>)/g)].reduce((o, m) => (o[m[1]] = m[2] ?? '', o), {});
      const s1 = cells(rowOf(2)), sB = cells(rowOf(3));
      ck('the Excel file shows an unknown value as an empty cell and a genuine 0 as 0',
        s1.F === '-0.2' && s1.G === '' && s1.H === '' && sB.F === '' && sB.G === '0' && sB.H === '1.1', { s1, sB });
      await http('DELETE', '/api/voice-fallback-test', ADMIN, 'admin');
    }
  } catch (e) { ck('suite completed', false, e.stack); }
  finally {
    await pool.query(`DELETE FROM voice_fallback_test_account`); await pool.query(`DELETE FROM voice_fallback_test_runs`);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[A, B, OFFUSER, COACH, ADMIN]]);
    server.close(); await pool.end();
  }
  console.log(`\nVoice fallback test switch: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
