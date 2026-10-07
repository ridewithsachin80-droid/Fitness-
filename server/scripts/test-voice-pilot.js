/**
 * scripts/test-voice-pilot.js — Phase 8: the Kannada-English voice pilot.
 *
 * Real Postgres and routes; R2 is the signing stand-in; the two speech
 * engines are stubbed separately (Gemini and Groq Whisper), so each result
 * can be checked against what that engine "heard".
 *
 * WHAT MUST HOLD
 *   A. Only invited members, after agreeing, can record. Nothing is added to
 *      their food log.
 *   B. Each recording is sent to BOTH engines, scored separately by the key
 *      words heard, and one engine failing never loses the other's answer.
 *   C. The coach sees, per phrase, each engine's hit rate, and can play every
 *      recording with both transcripts; only for their own members.
 *   E. A recording an engine did not answer is a MISS in the scores, with how
 *      many it answered shown; one retry on a passing failure; the reason is
 *      stored (never the key) and reaches the coach and the downloaded file.
 *      (First real run, 7 Oct: "Gemini 80%" hid 2 no-answers out of 7.)
 *   F. A switched-off account cannot be invited.
 *   D. Recordings are private, links expire; withdrawing or being removed
 *      deletes every recording at once; after 90 days they are deleted.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GEMINI_API_KEY = 'stub-gemini'; process.env.GROQ_API_KEY = 'stub-groq';
process.env.VOICE_PILOT_RETRY_MS = '0';   // the one retry, without the wait
const path = require('path');
const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
const heard = { gemini: 'Belagge eradu idli mattu ondu bowl sambar thinde', whisper: 'Belage eradu idly mattu ondu bowl sambhar' };
let down = { gemini: false, whisper: false }, calls = { gemini: 0, whisper: 0 }, lastGeminiPrompt = '', lastWhisperPrompt = '';
// failOnce: the next call fails with "busy" (503), the one after works. hard: a 400, which no retry can fix.
const failOnce = { gemini: 0, whisper: 0 }, hard = { gemini: false, whisper: false };
const boom = (status, message) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { error: { message } } } });
const stubbedPost = async (url, body, cfg) => {
  const u = String(url);
  if (u.includes('generativelanguage')) {
    calls.gemini++; lastGeminiPrompt = body?.contents?.[0]?.parts?.[0]?.text || '';
    if (hard.gemini) throw boom(400, 'Unsupported audio type');
    if (failOnce.gemini > 0) { failOnce.gemini--; throw boom(503, 'The model is overloaded'); }
    if (down.gemini) throw boom(500, 'Internal error for https://x/y?key=AIzaSECRET123');
    return { data: { candidates: [{ content: { parts: [{ text: heard.gemini }] } }] } };
  }
  if (u.includes('api.groq.com/openai/v1/audio/transcriptions')) {
    calls.whisper++; lastWhisperPrompt = body?.get ? body.get('prompt') : '';
    if (hard.whisper) throw boom(400, 'Unsupported audio type');
    if (failOnce.whisper > 0) { failOnce.whisper--; throw boom(503, 'Service busy'); }
    if (down.whisper) throw boom(500, 'Internal error, Bearer gsk_SECRET456 rejected');
    return { data: { text: heard.whisper } };
  }
  return realAxios.post(url, body, cfg);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const storage = require('../services/storage');
const { startR2 } = require('./lib/r2-standin');
const V = require('../services/voicePilot');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };

(async () => {
  console.log('\n[0] phrases and scoring (no database)');
  {
    ck('20 lines to read and 2 in their own words, ids unique', V.PHRASES.length === 22 && V.PHRASES.filter(p => p.free).length === 2 && new Set(V.PHRASES.map(p => p.id)).size === 22);
    ck('every read line has key words, and English for what it means', V.PHRASES.filter(p => !p.free).every(p => p.keys.length >= 2 && p.means && p.say));
    ck('all key words heard: 1', V.score('k01', 'Belagge eradu idli mattu ondu bowl sambar thinde') === 1);
    ck('other spellings count the same ("sambhar" for "sambar", "2" for "eradu")', V.score('k01', 'Belage 2 idli mattu bowl sambhar') === 1);
    ck('a missed word lowers the score (2 of 3)', V.score('k01', 'idli and sambar') === 0.67);
    ck('a number must be the whole number: "12" does not count as "2"', V.score('k01', '12 idli sambar') === 0.67);
    ck('nothing heard: 0; a free line: no score', V.score('k01', '') === 0 && V.score('f01', 'anything') === null);
    ck('the Gemini prompt asks for Kannada in English letters, not translated', /Kannada words in ENGLISH LETTERS/.test(V.PROMPT) && /Do not translate/.test(V.PROMPT));
    const s = V.summarise([{ phrase_id: 'k01', gemini_score: 1, whisper_score: 0.5 }, { phrase_id: 'k01', gemini_score: 0.5, whisper_score: 0.5 }, { phrase_id: 'f01', gemini_score: null, whisper_score: null }]);
    ck('results average each engine per line, and overall', s.phrases.find(p => p.id === 'k01').gemini === 75 && s.phrases.find(p => p.id === 'k01').whisper === 50 && s.overall.gemini === 75 && s.overall.samples === 3, s.overall);
    // The first real run (7 Oct): Gemini —, 0, 100, —, 100, 100, 100; Whisper 100, 50, 75, 75, 50, 33, 100.
    {
      const G = [null, 0, 1, null, 1, 1, 1], Wh = [1, 0.5, 0.75, 0.75, 0.5, 0.33, 1];
      const real = ['k01', 'k02', 'k03', 'k04', 'k05', 'k06', 'k07'].map((id, n) => ({ phrase_id: id,
        gemini_text: G[n] == null ? null : 'heard', gemini_score: G[n], whisper_text: 'heard', whisper_score: Wh[n] }));
      const o = V.summarise(real).overall;
      ck('a recording an engine did not answer is a miss: that run is Gemini 57%, not 80%', o.gemini === 57 && o.whisper === 69, o);
      ck('and it says how many each engine answered (5 of 7, 7 of 7)', o.gemini_answered === 5 && o.whisper_answered === 7 && o.samples === 7 && o.scored === 7, o);
      const k1 = V.summarise(real).phrases.find(p => p.id === 'k01');
      ck('a line Gemini never answered has no Gemini score, and says 0 answered', k1.gemini === null && k1.gemini_answered === 0 && k1.whisper === 100, k1);
      const none = V.summarise(real.map(r => ({ ...r, whisper_text: null, whisper_score: null }))).overall;
      ck('an engine with no answers at all (key not set) has no score, not 0%', none.whisper === null && none.whisper_answered === 0, none);
      const free = V.summarise([{ phrase_id: 'f01', gemini_text: 'anything', gemini_score: null, whisper_text: null, whisper_score: null }]);
      ck('own-words lines are never scored, but still count as answered or not', free.overall.gemini === null && free.overall.scored === 0 && free.overall.gemini_answered === 1 && free.overall.whisper_answered === 0, free.overall);
    }
    ck('the reason an engine failed is short and never carries a key', V.reason(boom(429, 'Quota exceeded https://x?key=AIzaSECRET&a=1 Bearer gsk_abc')) === '429: Quota exceeded https://x?key=…&a=1 Bearer …'
       && V.reason(Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' })) === 'ECONNABORTED: timeout of 30000ms exceeded');
    {
      const A = Buffer.from('a').toString('base64');
      let c0 = { ...calls };
      failOnce.gemini = 1;
      let t = await V.transcribeBoth(A, 'audio/webm');
      ck('busy once (503): asked again, and the second answer is kept', calls.gemini - c0.gemini === 2 && t.gemini === heard.gemini && t.errors.gemini === null && calls.whisper - c0.whisper === 1, [calls, t]);
      c0 = { ...calls }; hard.gemini = true;
      t = await V.transcribeBoth(A, 'audio/webm'); hard.gemini = false;
      ck('a refusal no retry can fix (400): asked once, the reason kept, the other engine unaffected', calls.gemini - c0.gemini === 1 && t.gemini === null && t.errors.gemini === '400: Unsupported audio type' && t.whisper === heard.whisper, [calls, t]);
      c0 = { ...calls }; const key = process.env.GROQ_API_KEY; delete process.env.GROQ_API_KEY;
      t = await V.transcribeBoth(A, 'audio/webm'); process.env.GROQ_API_KEY = key;
      ck('a key that is not set: not called, and it says which key', calls.whisper === c0.whisper && t.whisper === null && t.errors.whisper === 'GROQ_API_KEY is not set' && t.gemini === heard.gemini, t);
      calls.gemini = 0; calls.whisper = 0;
    }
  }

  const KEYS = { id: 'AKIDTESTONLY0003', secret: 'voice-test-secret' };
  const R2 = await startR2(storage, KEYS);
  Object.assign(process.env, { R2_ACCOUNT_ID: 'local', R2_ACCESS_KEY_ID: KEYS.id, R2_SECRET_ACCESS_KEY: KEYS.secret, R2_BUCKET: 'fitlife-test', R2_ENDPOINT: R2.endpoint });
  const pool = require('../db/pool');
  const routes = require('../routes/voicePilot');
  const app = express(); app.use(express.json({ limit: '15mb' })); app.use(cookieParser());
  app.use('/api/voice-pilot', routes);
  const srv = app.listen(0); const port = srv.address().port;
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (name, phone, role) => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, phone, role])).rows[0].id;
  const coach = await mk('Sachin', '9801', 'monitor'), other = await mk('Other Coach', '9802', 'monitor');
  const member = await mk('Padmini', '9803', 'patient'), notInvited = await mk('Ravi', '9804', 'patient'), elsewhere = await mk('Not Yours', '9805', 'patient');
  await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true), ($1,$3,true), ($4,$5,true)`, [coach, member, notInvited, other, elsewhere]);
  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const M = tok(member, 'patient'), N = tok(notInvited, 'patient'), C = tok(coach, 'monitor'), O = tok(other, 'monitor');
  const call = async (method, p, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const AUDIO = Buffer.from('fake-opus-audio').toString('base64');
  const logsCount = async () => Number((await pool.query(`SELECT COUNT(*) AS n FROM daily_logs`)).rows[0].n);

  console.log('\n[1] invitation and agreement');
  {
    ck('a member not invited sees nothing and cannot record', (await call('GET', '/api/voice-pilot/me', N)).data.invited === false && (await call('POST', '/api/voice-pilot/sample', N, { phrase_id: 'k01', audio: AUDIO })).status === 404);
    ck('a coach cannot invite someone else\'s member', (await call('POST', '/api/voice-pilot/invite', C, { member_id: elsewhere })).status === 403);
    ck('a coach cannot be invited', (await call('POST', '/api/voice-pilot/invite', C, { member_id: coach })).status === 403);
    {
      const off = (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ('Mrs. Padmini','9806','x','patient',false) RETURNING id`)).rows[0].id;
      await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true)`, [coach, off]);
      const r = await call('POST', '/api/voice-pilot/invite', C, { member_id: off });
      ck('a switched-off account cannot be invited (it can never sign in to record)', r.status === 400 && /switched off/.test(r.data.error)
         && (await pool.query(`SELECT COUNT(*)::int n FROM voice_pilot_members WHERE patient_id=$1`, [off])).rows[0].n === 0, r);
    }
    ck('the coach invites their member', (await call('POST', '/api/voice-pilot/invite', C, { member_id: member })).status === 200);
    const me = (await call('GET', '/api/voice-pilot/me', M)).data;
    ck('the member sees 22 lines, not yet agreed', me.invited && !me.consented && me.phrases.length === 22 && me.phrases.every(p => !p.recorded));
    ck('recording before agreeing is refused', (await call('POST', '/api/voice-pilot/sample', M, { phrase_id: 'k01', audio: AUDIO })).status === 409);
    await call('POST', '/api/voice-pilot/consent', M);
    ck('after agreeing, consent is recorded', (await call('GET', '/api/voice-pilot/me', M)).data.consented === true);
  }

  console.log('\n[2] recording a line');
  {
    const before = await logsCount();
    let r = await call('POST', '/api/voice-pilot/sample', M, { phrase_id: 'k01', audio: AUDIO, mimeType: 'audio/webm;codecs=opus', duration_ms: 4200 });
    ck('saved; the member is shown what was heard', r.status === 200 && r.data.heard === heard.gemini, r.data);
    ck('BOTH engines were asked, once each', calls.gemini === 1 && calls.whisper === 1, calls);
    ck('with the Kannada-English prompts', /Kannada words in ENGLISH LETTERS/.test(lastGeminiPrompt) && /Kannada-English food log/.test(lastWhisperPrompt || ''), lastWhisperPrompt);
    const row = (await pool.query(`SELECT * FROM voice_samples WHERE patient_id=$1 AND phrase_id='k01'`, [member])).rows[0];
    ck('each engine\'s words and score stored separately (Gemini 1, Whisper 2 of 3)', row.gemini_text === heard.gemini && row.whisper_text === heard.whisper && Number(row.gemini_score) === 1 && Number(row.whisper_score) === 0.67, row);
    ck('the audio is private, under the member', [...R2.objects.keys()].some(k => k.startsWith(`/fitlife-test/voice-pilot/${member}/k01-`)) && R2.rejected === 0);
    ck('kept for 90 days, with its length and type', row.mime_type === 'audio/webm' && row.duration_ms === 4200 && (await pool.query(`SELECT delete_after > NOW() + INTERVAL '89 days' AS ok FROM voice_samples WHERE id=$1`, [row.id])).rows[0].ok);
    ck('nothing was added to the food log', (await logsCount()) === before);
    ck('an unknown line is refused', (await call('POST', '/api/voice-pilot/sample', M, { phrase_id: 'zz', audio: AUDIO })).status === 400);

    down.whisper = true;
    r = await call('POST', '/api/voice-pilot/sample', M, { phrase_id: 'k15', audio: AUDIO, mimeType: 'audio/mp4' });
    down.whisper = false;
    const k15 = (await pool.query(`SELECT gemini_text, whisper_text, whisper_score, gemini_error, whisper_error, object_key FROM voice_samples WHERE phrase_id='k15'`)).rows[0];
    ck('Whisper down: it was tried twice, and the reason is stored without the key', calls.whisper === 3 && /^500: Internal error, Bearer …/.test(k15.whisper_error || '') && !/SECRET/.test(k15.whisper_error) && k15.gemini_error === null, [calls, k15]);
    ck('Whisper down: Gemini\'s answer is still kept, Whisper\'s stored as no answer', r.status === 200 && k15.gemini_text && k15.whisper_text === null && k15.whisper_score === null && /\.m4a$/.test(k15.object_key), k15);
    const size = R2.objects.size;
    await call('POST', '/api/voice-pilot/sample', M, { phrase_id: 'k01', audio: Buffer.from('second-take').toString('base64') });
    await new Promise(res => setTimeout(res, 100));
    ck('recording a line again replaces it, and the old file goes', R2.objects.size === size && (await pool.query(`SELECT COUNT(*)::int n FROM voice_samples WHERE phrase_id='k01'`)).rows[0].n === 1);
  }

  console.log('\n[3] the coach\'s results');
  {
    const r = await call('GET', '/api/voice-pilot/results', C);
    const k01 = r.data.phrases.find(p => p.id === 'k01');
    ck('per line: each engine\'s hit rate', r.status === 200 && k01.samples === 1 && k01.gemini === 100 && k01.whisper === 67, k01);
    const k15r = r.data.phrases.find(p => p.id === 'k15'), o = r.data.overall;
    ck('the line Whisper did not answer: no Whisper score, 0 of 1 answered', k15r.whisper === null && k15r.whisper_answered === 0 && k15r.gemini_answered === 1, k15r);
    ck('overall counts that no-answer as a miss (Whisper 67 and nothing, about 34%), and says 1 of 2 answered', o.whisper_answered === 1 && o.gemini_answered === 2 && o.samples === 2 && [33, 34].includes(o.whisper), o);
    ck('the coach is told why, per recording', /^500: /.test(r.data.samples.find(x => x.phrase_id === 'k15').whisper_problem || '') && r.data.samples.find(x => x.phrase_id === 'k01').whisper_problem === null);
    ck('every recording, with both transcripts and a link that plays', r.data.samples.length === 2 && r.data.samples.every(s => s.gemini && s.audio_url) && (await fetch(r.data.samples[0].audio_url)).status === 200);
    ck('another coach sees none of them', (await call('GET', '/api/voice-pilot/results', O)).data.samples.length === 0);
    ck('a member cannot read the results', (await call('GET', '/api/voice-pilot/results', M)).status === 403);
    const ms = (await call('GET', '/api/voice-pilot/members', C)).data.members;
    ck('the coach\'s list: who agreed and how many recorded', ms.length === 1 && ms[0].name === 'Padmini' && ms[0].active === true && ms[0].consented_at && ms[0].recorded === 2, ms);
    ck('another coach\'s list is empty', (await call('GET', '/api/voice-pilot/members', O)).data.members.length === 0);

    // The file to send on.
    await pool.query(`UPDATE voice_samples SET gemini_text = '=cmd(1)' WHERE phrase_id='k15'`);
    const get = async (t) => { const x = await fetch(`http://127.0.0.1:${port}/api/voice-pilot/results.csv`, { headers: { Authorization: 'Bearer ' + t } });
      const buf = Buffer.from(await x.arrayBuffer());
      return { status: x.status, type: x.headers.get('content-type'), disp: x.headers.get('content-disposition'), bytes: buf, text: buf.toString('utf8') }; };
    const f = await get(C);
    const rows = f.text.replace(/^\ufeff/, '').trim().split('\r\n');
    ck('Download results: a CSV file, named with the date', f.status === 200 && /^text\/csv/.test(f.type) && /attachment; filename="FitLife-Voice-Pilot-\d{4}-\d{2}-\d{2}\.csv"/.test(f.disp), [f.status, f.type, f.disp]);
    ck('it opens in Excel with Kannada and quotes intact (UTF-8 mark at the start)', f.bytes[0] === 0xEF && f.bytes[1] === 0xBB && f.bytes[2] === 0xBF);
    ck('a header and one row per recording', rows[0] === 'member,line_id,line,meaning,own_words,gemini_heard,whisper_heard,gemini_score,whisper_score,seconds,audio_type,recorded_at,gemini_problem,whisper_problem' && rows.length === 3, rows);
    ck('members as codes, never names', /^M1,k01,/.test(rows[1]) && !/Padmini/.test(f.text));
    ck('both transcripts and both scores', rows[1].includes(heard.gemini) && rows[1].includes(',100%,67%,') , rows[1]);
    ck('the phone\'s audio type, said plainly', /webm \(usually Android\)/.test(rows[1]) && /mp4 \(usually iPhone\)/.test(f.text));
    ck('a transcript a spreadsheet would run as a formula is made plain text', f.text.includes(",'=cmd(1),") && !/,=cmd/.test(f.text), rows[2]);
    ck('the file says "no answer" as the score, and why, for the line Whisper missed', /^M1,k15,/.test(rows[2]) && rows[2].includes(',0%,no answer,') && rows[2].endsWith(',,"500: Internal error, Bearer … rejected"') && !/SECRET/.test(f.text), rows[2]);
    ck('no audio, no links in the file', !/r2|http|X-Amz/i.test(f.text));
    ck('another coach gets only the header (none of these members)', (await get(O)).text.replace(/^\ufeff/, '').trim().split('\r\n').length === 1);
    ck('a member cannot download it', (await get(M)).status === 403);
  }

  console.log('\n[4] stopping, removing, 90 days');
  {
    R2.down = true;
    ck('storage down: withdrawing refuses rather than leave recordings behind', (await call('POST', '/api/voice-pilot/withdraw', M)).status === 502 && (await pool.query(`SELECT COUNT(*)::int n FROM voice_samples`)).rows[0].n === 2);
    R2.down = false;
    let r = await call('POST', '/api/voice-pilot/withdraw', M);
    ck('the member stops: every recording deleted from storage and the database', r.status === 200 && R2.objects.size === 0 && (await pool.query(`SELECT COUNT(*)::int n FROM voice_samples`)).rows[0].n === 0);
    ck('and they are no longer in the pilot', (await call('GET', '/api/voice-pilot/me', M)).data.invited === false);
    await call('POST', '/api/voice-pilot/invite', C, { member_id: member });
    ck('invited again after stopping, they must agree again', (await call('GET', '/api/voice-pilot/me', M)).data.consented === false
       && (await call('POST', '/api/voice-pilot/sample', M, { phrase_id: 'k02', audio: AUDIO })).status === 409);
    await pool.query(`UPDATE voice_pilot_members SET consented_at = NOW() WHERE patient_id=$1`, [member]);
    await call('POST', '/api/voice-pilot/sample', M, { phrase_id: 'k02', audio: AUDIO });
    r = await call('DELETE', `/api/voice-pilot/invite/${member}`, C);
    ck('the coach removes them: recordings deleted too', r.status === 200 && R2.objects.size === 0 && (await pool.query(`SELECT COUNT(*)::int n FROM voice_pilot_members`)).rows[0].n === 0);
    await call('POST', '/api/voice-pilot/invite', C, { member_id: member });
    await pool.query(`UPDATE voice_pilot_members SET consented_at = NOW() WHERE patient_id=$1`, [member]);
    await call('POST', '/api/voice-pilot/sample', M, { phrase_id: 'k03', audio: AUDIO });
    await pool.query(`UPDATE voice_samples SET delete_after = NOW() - INTERVAL '1 day'`);
    const n = await routes.deleteExpiredSamples(pool);
    ck('past 90 days: deleted from storage and the database', n === 1 && R2.objects.size === 0 && (await pool.query(`SELECT COUNT(*)::int n FROM voice_samples`)).rows[0].n === 0);
  }

  console.log(`\n${fail === 0 ? '\u2713' : '\u2717'} test-voice-pilot: ${pass} passed, ${fail} failed\n`);
  srv.close(); R2.server.close(); await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
