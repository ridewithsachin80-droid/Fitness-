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
 *   G. (Fixes-2m, after the 19 Oct real recordings) Whisper is told the
 *      language and its reported language is stored; a Tamil-script answer is
 *      labelled, never "fixed"; Kannada script is spelled out to be scored;
 *      English-letter scores are exactly as before; meaning checks (sugar vs no
 *      sugar, quantities, decimal weight, meal, day) are separate from the
 *      keyword score; re-runs sit beside the original, which never changes;
 *      the Excel file and the CSV carry the exact UTF-8 text.
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
let lastWhisperForm = null, whisperLanguageReply = undefined;   // Fixes-2m: what Whisper was asked; what it says it used
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
    lastWhisperForm = body?.get ? { language: body.get('language'), response_format: body.get('response_format'), model: body.get('model') } : null;
    if (hard.whisper) throw boom(400, 'Unsupported audio type');
    if (failOnce.whisper > 0) { failOnce.whisper--; throw boom(503, 'Service busy'); }
    if (down.whisper) throw boom(500, 'Internal error, Bearer gsk_SECRET456 rejected');
    return { data: whisperLanguageReply === undefined ? { text: heard.whisper } : { text: heard.whisper, language: whisperLanguageReply } };
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
    // Changed 19 Oct 2026 (Fixes-2m): the two score columns are named for what they are, KEYWORD scores
    // (Sachin's request), and six columns are added at the end. The original columns keep their order.
    // Changed again 19 Oct 2026 (Fixes-2n): the reviewer asked that the checks be described as limited
    // rule checks, not meaning, so the two columns are renamed *_rule_checks. Still compared exactly.
    ck('a header and one row per recording', rows[0] === 'member,line_id,line,meaning,own_words,gemini_heard,whisper_heard,gemini_keyword_score,whisper_keyword_score,seconds,audio_type,recorded_at,gemini_problem,whisper_problem,gemini_rule_checks,whisper_rule_checks,gemini_script,whisper_script,whisper_language_asked,whisper_language_used' && rows.length === 3, rows);
    ck('members as codes, never names', /^M1,k01,/.test(rows[1]) && !/Padmini/.test(f.text));
    ck('both transcripts and both scores', rows[1].includes(heard.gemini) && rows[1].includes(',100%,67%,') , rows[1]);
    ck('the phone\'s audio type, said plainly', /webm \(usually Android\)/.test(rows[1]) && /mp4 \(usually iPhone\)/.test(f.text));
    ck('a transcript a spreadsheet would run as a formula is made plain text', f.text.includes(",'=cmd(1),") && !/,=cmd/.test(f.text), rows[2]);
    // Changed 19 Oct 2026 (Fixes-2m): the reason is no longer the LAST cell (six columns follow it), so
    // the check looks for it followed by the new columns; the same reason must be there.
    ck('the file says "no answer" as the score, and why, for the line Whisper missed', /^M1,k15,/.test(rows[2]) && rows[2].includes(',0%,no answer,') && rows[2].includes(',,"500: Internal error, Bearer … rejected",') && !/SECRET/.test(f.text), rows[2]);
    ck('no audio, no links in the file', !/r2|http|X-Amz/i.test(f.text));
    ck('another coach gets only the header (none of these members)', (await get(O)).text.replace(/^\ufeff/, '').trim().split('\r\n').length === 1);
    ck('a member cannot download it', (await get(M)).status === 403);

    // Phase 8c: ask an engine again for a stored recording it did not answer.
    {
      const state = async () => (await pool.query(`SELECT gemini_text, whisper_text, whisper_score, whisper_error FROM voice_samples WHERE phrase_id='k15'`)).rows[0];
      ck('a member cannot use "try again"', (await call('POST', '/api/voice-pilot/results/retry', M)).status === 403);
      let c0 = { ...calls };
      let r = await call('POST', '/api/voice-pilot/results/retry', O);
      ck('another coach\'s "try again" touches none of these recordings', r.status === 200 && r.data.asked === 0 && calls.whisper === c0.whisper, r.data);
      down.whisper = true; c0 = { ...calls };
      r = await call('POST', '/api/voice-pilot/results/retry', C);
      down.whisper = false;
      ck('engine still down: 1 asked, 0 answered, the reason returned and stored, nothing invented', r.data.asked === 1 && r.data.fixed === 0 && r.data.still === 1 && /^Whisper: 500: /.test(r.data.problems[0]) && !/SECRET/.test(JSON.stringify(r.data))
         && (await state()).whisper_text === null && /^500: /.test((await state()).whisper_error), r.data);
      ck('only the engine that gave no answer was asked (Gemini already had one)', calls.gemini === c0.gemini && calls.whisper - c0.whisper === 2, [c0, calls]);
      const audioBefore = [...R2.objects.keys()].length;
      // This time Whisper hears two of the line's three key words (masala, dose; no chutney).
      const usual = heard.whisper; heard.whisper = 'Ondu masala dose';
      r = await call('POST', '/api/voice-pilot/results/retry', C);
      heard.whisper = usual;
      const st = await state();
      ck('engine back: the stored recording is read again and answered, with no new recording', r.data.asked === 1 && r.data.fixed === 1 && r.data.still === 0 && r.data.more === false && st.whisper_text === 'Ondu masala dose' && st.whisper_error === null && [...R2.objects.keys()].length === audioBefore, [r.data, st]);
      ck('the new answer is scored like any other (2 of 3 key words: 0.67)', st.whisper_score !== null && Number(st.whisper_score) === 0.67 && V.score('k15', 'Ondu masala dose') === 0.67, st);
      ck('Gemini\'s existing answer was left alone', st.gemini_text === '=cmd(1)');
      const o2 = (await call('GET', '/api/voice-pilot/results', C)).data.overall;
      ck('and the headline now counts it as answered (2 of 2)', o2.whisper_answered === 2 && o2.gemini_answered === 2, o2);
      c0 = { ...calls };
      r = await call('POST', '/api/voice-pilot/results/retry', C);
      ck('with nothing unanswered, "try again" asks nobody', r.data.asked === 0 && calls.gemini === c0.gemini && calls.whisper === c0.whisper, r.data);
    }
  }

  console.log('\n[3b] Fixes-2m: language, scripts, meaning checks, re-runs, the files');
  {
    const TAMIL = 'விளைகே இரடு இட்ளி, ஒந்து போல் சாம்பா திந்தே.';   // Whisper's real 19 Oct answer to k01
    const SHEET = 'à®µà®¿à®³à¯ˆà®•à¯‡ à®‡à®°à®Ÿà¯\x81 à®‡à®Ÿà¯\x8dà®³à®¿, à®’à®¨à¯\x8dà®¤à¯\x81 à®ªà¯‹à®²à¯\x8d à®šà®¾à®®à¯\x8dà®ªà®¾ à®¤à®¿à®¨à¯\x8dà®¤à¯‡.';   // the same cell in Sachin's converted spreadsheet
    // The 19 Oct cell is exactly this text's UTF-8 bytes read as Windows-1252 (bytes Windows leaves undefined pass through).
    const cp1252 = (buf) => { const hi = '€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8dŽ\x8f\x90‘’“”•–—˜™š›œ\x9džŸ'; return [...buf].map(b => (b >= 0x80 && b < 0xA0 ? hi[b - 0x80] : String.fromCharCode(b))).join(''); };
    ck('trace: the spreadsheet cell is the stored Tamil text, read as Windows-1252 — one wrong decoding step, after FitLife', cp1252(Buffer.from(TAMIL, 'utf8')) === SHEET);
    ck('…and that text is Tamil script (Whisper took Kannada speech for Tamil); its keyword score is 0, as stored',
       V.scriptOf(TAMIL) === 'tamil' && V.score('k01', TAMIL) === 0);
    // Whisper is now told the language, and says which it used.
    whisperLanguageReply = 'kannada';
    const KN = 'ಬೆಳಗ್ಗೆ ಎರಡು ಇಡ್ಲಿ ಮತ್ತು ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್ ತಿಂದೆ';
    const usual = heard.whisper; heard.whisper = KN;
    let r = await call('POST', '/api/voice-pilot/sample', M, { phrase_id: 'k06', audio: AUDIO, mimeType: 'audio/webm' });
    heard.whisper = usual;
    ck('Whisper is asked for Kannada ("kn") with a reply that says which language it used (verbose_json)', r.status === 200 && lastWhisperForm?.language === 'kn' && lastWhisperForm?.response_format === 'verbose_json' && lastWhisperForm?.model === 'whisper-large-v3', lastWhisperForm);
    const k06 = (await pool.query(`SELECT * FROM voice_samples WHERE phrase_id='k06'`)).rows[0];
    ck('the language asked and the language used are stored with the recording', k06.whisper_setting === 'kn' && k06.whisper_language === 'kannada', k06);
    ck('Kannada script is spelled out in English letters to be scored (ಇಡ್ಲಿ → idli, ಎರಡು → eradu, ಸಾಂಬಾರ್ → saambaar)',
       V.kannadaToLatin(KN) === 'belagge eradu idli mattu ondu baul saambaar tinde' && V.score('k01', KN) === 1, V.kannadaToLatin(KN));
    ck('a Kannada-script answer gets the meaning checks too (morning ✓, 2 idli ✓, 1 bowl ✓)', V.checksText(V.meaningChecks('k01', KN)) === 'morning ✓ · 2 idli ✓ · 1 bowl sambar ✓');
    ck('VOICE_PILOT_WHISPER_LANGUAGE can set another language or "auto" (Whisper guesses, as before 20 Oct)',
       V.whisperLanguage({ VOICE_PILOT_WHISPER_LANGUAGE: 'auto' }) === 'auto' && V.whisperLanguage({ VOICE_PILOT_WHISPER_LANGUAGE: 'en' }) === 'en' && V.whisperLanguage({}) === 'kn' && V.whisperLanguage({ VOICE_PILOT_WHISPER_LANGUAGE: 'x;y' }) === 'auto');
    // English-letter answers score EXACTLY as before Fixes-2m (the 2k–2l scorer, frozen here).
    const oldNorm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9.\u0C80-\u0CFF ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const oldScore = (id, tr) => { const p = V.PHRASES.find(x => x.id === id); if (!p || !p.keys.length) return null; const t = ` ${oldNorm(tr)} `; if (!t.trim()) return 0;
      const hit = p.keys.filter(k => k.split('|').some(v => { const w = oldNorm(v); return /^\d+$/.test(w) ? new RegExp(`(^|[^0-9])${w}([^0-9]|$)`).test(t) : t.includes(w); })); return Math.round((hit.length / p.keys.length) * 100) / 100; };
    const corpus = [];
    for (const p of V.PHRASES) corpus.push(p.say, p.means, p.say.toLowerCase(), p.say.split(' ').slice(0, 3).join(' '), p.say.replace(/a/g, 'aa'), p.say.replace(/ee/g, 'i'), '');
    corpus.push('Belagge eradu idli ondu bowl sambar tinde', 'Breakfast ge ondu plate uppittu ondu cup coffee.', 'breakfast 1 cup coffee', heard.whisper, 'Ondu masala dose', '12 idli sambar', TAMIL);
    const moved = [];
    for (const p of V.PHRASES) for (const t of corpus) if (oldScore(p.id, t) !== V.score(p.id, t)) moved.push([p.id, t]);
    ck(`English-letter (and Tamil) answers score exactly as before: ${V.PHRASES.length * corpus.length} line × answer pairs, none moved`, moved.length === 0, moved.slice(0, 3));
    ck('the real 19 Oct answers keep their stored scores (Gemini 100%, 100%; Whisper 0%, 50%)',
       V.score('k01', 'Belagge eradu idli ondu bowl sambar tinde') === 1 && V.score('k02', 'Breakfast ge ondu plate uppittu ondu cup coffee.') === 1 && V.score('k01', TAMIL) === 0 && V.score('k02', 'breakfast 1 cup coffee') === 0.5);

    // Meaning checks: separate from the keyword score.
    const C2 = (id, t) => V.checksText(V.meaningChecks(id, t));
    ck('sugar vs no sugar: "sakkare haakilla" / "no sugar" pass; "sakkare haakide" / "tea with sugar" fail — the keyword score cannot tell them apart (both 100%)',
       C2('k18', 'Tea-ge sakkare haakilla') === 'no sugar ✓' && C2('k18', 'tea no sugar') === 'no sugar ✓' && C2('k18', 'Tea-ge sakkare haakide') === 'no sugar ✗' && C2('k18', 'tea with sugar') === 'no sugar ✗'
       && V.score('k18', 'tea with sugar') === 1 && V.score('k18', 'Tea-ge sakkare haakilla') === 1);
    ck('quantities: "eradu idli" passes, "mooru idli" fails although the keyword score is the same', C2('k01', 'belagge eradu idli ondu bowl sambar') === 'morning ✓ · 2 idli ✓ · 1 bowl sambar ✓' && /2 idli ✗/.test(C2('k01', 'belagge mooru idli ondu bowl sambar 2')) && V.score('k01', 'belagge mooru idli ondu bowl sambar 2') === 1);
    ck('the real Whisper upma answer: breakfast ✓, upma ✗ (it was left out), coffee ✓', C2('k02', 'breakfast 1 cup coffee') === 'breakfast ✓ · 1 plate upma ✗ · 1 cup coffee ✓');
    ck('decimal weight: 72.5 and "eppattu eradu point aidu" pass; 725 and 72 fail', /72\.5 kg ✓/.test(C2('k11', 'ivattu weight 72.5 kg')) && /72\.5 kg ✓/.test(C2('k11', 'Ivattu belagge nanna tooka eppattu eradu point aidu kg'))
       && /72\.5 kg ✗/.test(C2('k11', 'ivattu weight 725 kg')) && /72\.5 kg ✗/.test(C2('k11', 'ivattu weight 72 kg')));
    ck('meals: lunch passes for a lunch line, dinner does not', /lunch ✓/.test(C2('k04', 'Lunch-ge eradu chapati')) && /lunch ✗/.test(C2('k04', 'dinner-ge eradu chapati')));
    ck('days: "nenne raatri" passes for last night; "ivattu" (today) fails it, and passes the today line', /last night ✓/.test(C2('k14', 'Nenne raatri elu gante nidde')) && /last night ✗/.test(C2('k14', 'ivattu elu gante nidde')) && /today ✓/.test(C2('k06', 'Ivattu mooru litre neeru')));
    ck('a line with no checks, and an engine with no answer, have none', V.meaningChecks('k10', 'whey protein haalu').length === 0 && V.meaningChecks('k01', null).length === 0);
    const res2 = (await call('GET', '/api/voice-pilot/results', C)).data;
    const s06 = res2.samples.find(x => x.phrase_id === 'k06');
    ck('results: each recording says its script, Kannada in English letters, the meaning checks, and Whisper\'s language', s06.whisper_script === 'kannada' && s06.whisper_latin === V.kannadaToLatin(KN) && s06.whisper_setting === 'kn' && s06.whisper_language === 'kannada' && Array.isArray(s06.gemini_checks) && s06.gemini_checks.length === 2, s06);
    ck('results: a summary of meaning checks per engine', res2.checks && res2.checks.gemini && typeof res2.checks.gemini === 'object', res2.checks);

    // Re-runs: beside the original, never over it.
    await pool.query(`UPDATE voice_samples SET whisper_text=$1, whisper_score=0, whisper_setting=NULL, whisper_language=NULL WHERE phrase_id='k01'`, [TAMIL]);
    const before01 = (await pool.query(`SELECT whisper_text, whisper_score, gemini_text, gemini_score FROM voice_samples WHERE phrase_id='k01'`)).rows[0];
    {
      // k01 now stands for a recording made before 20 Oct: Whisper's real Tamil answer, no language stored.
      const s01 = (await call('GET', '/api/voice-pilot/results', C)).data.samples.find(x => x.phrase_id === 'k01');
      ck('an older recording (no language stored) reads "auto" (Whisper guessed) and "Tamil script"', s01.whisper_setting === 'auto' && s01.whisper_language === null && s01.whisper_script === 'tamil' && s01.whisper_latin === null, s01);
    }
    heard.whisper = KN; whisperLanguageReply = 'kannada';
    const c0 = { ...calls };
    r = await call('POST', '/api/voice-pilot/results/rerun', C, { setting: 'kn' });
    heard.whisper = usual;
    const after01 = (await pool.query(`SELECT whisper_text, whisper_score, gemini_text, gemini_score FROM voice_samples WHERE phrase_id='k01'`)).rows[0];
    const rr = (await pool.query(`SELECT x.* FROM voice_sample_reruns x JOIN voice_samples s ON s.id = x.sample_id WHERE s.phrase_id='k01'`)).rows;
    ck('re-run (Kannada): Whisper asked once per stored recording, with language kn; Gemini not asked', r.status === 200 && r.data.asked === 3 && r.data.answered === 3 && calls.whisper - c0.whisper === 3 && calls.gemini === c0.gemini && lastWhisperForm.language === 'kn', [r.data, calls, c0]);
    ck('…the original Tamil answer and its 0 are untouched; the new answer is stored beside it, scored 100%', JSON.stringify(before01) === JSON.stringify(after01) && after01.whisper_text === TAMIL
       && rr.length === 1 && rr[0].setting === 'kn' && rr[0].text === KN && Number(rr[0].score) === 1 && rr[0].language === 'kannada', [after01, rr]);
    ck('…asking again with the same setting asks nobody', (await call('POST', '/api/voice-pilot/results/rerun', C, { setting: 'kn' })).data.asked === 0);
    whisperLanguageReply = 'english';
    r = await call('POST', '/api/voice-pilot/results/rerun', C, { setting: 'en' });
    ck('re-run (English): a second setting is kept separately', r.data.asked === 3 && lastWhisperForm.language === 'en' && (await pool.query(`SELECT COUNT(*)::int n FROM voice_sample_reruns`)).rows[0].n === 6);
    whisperLanguageReply = 'kannada';
    r = await call('POST', '/api/voice-pilot/results/rerun', C, { setting: 'auto' });
    ck('re-run "auto": no language is sent (Whisper guesses, as on 19 Oct)', r.data.asked === 3 && lastWhisperForm.language === null);
    ck('re-run: an unknown setting is refused; another coach touches none; a member cannot', (await call('POST', '/api/voice-pilot/results/rerun', C, { setting: 'ta' })).status === 400
       && (await call('POST', '/api/voice-pilot/results/rerun', O, { setting: 'kn' })).data.asked === 0 && (await call('POST', '/api/voice-pilot/results/rerun', M, { setting: 'kn' })).status === 403);
    // Fixes-2t: a re-run limited to named recordings touches no other recording.
    {
      await pool.query(`DELETE FROM voice_sample_reruns WHERE setting = 'kn'`);
      heard.whisper = KN; whisperLanguageReply = 'kannada';   // the same answers as the Kannada re-run above, so later checks see the same rows
      const all = (await pool.query(`SELECT s.id, s.phrase_id FROM voice_samples s ORDER BY s.created_at`)).rows;
      const pick = all.find(x => x.phrase_id === 'k01').id;
      const c1 = { ...calls };
      r = await call('POST', '/api/voice-pilot/results/rerun', C, { setting: 'kn', sample_ids: [pick] });
      const knRows = (await pool.query(`SELECT sample_id FROM voice_sample_reruns WHERE setting = 'kn'`)).rows.map(x => x.sample_id);
      ck('re-run limited to sample_ids: only that recording reaches Whisper and gets a re-run row; the others none', r.status === 200 && r.data.asked === 1 && calls.whisper - c1.whisper === 1
         && JSON.stringify(r.data.sample_ids) === JSON.stringify([pick]) && knRows.length === 1 && knRows[0] === pick, [r.data, knRows, calls.whisper - c1.whisper]);
      const bad = await Promise.all([{ sample_ids: [] }, { sample_ids: 'all' }, { sample_ids: [1.5] }, { sample_ids: [-3] }, { sample_ids: Array.from({ length: 21 }, (_, i) => i + 1) }]
        .map(b => call('POST', '/api/voice-pilot/results/rerun', C, { setting: 'kn', ...b })));
      ck('…an empty, non-list, fractional, negative or over-20 sample_ids is refused (400), nothing asked', bad.every(x => x.status === 400) && calls.whisper - c1.whisper === 1);
      const none = await call('POST', '/api/voice-pilot/results/rerun', O, { setting: 'kn', sample_ids: all.map(x => x.id) });
      ck('…another coach naming these recordings still touches none of them', none.status === 200 && none.data.asked === 0);
      r = await call('POST', '/api/voice-pilot/results/rerun', C, { setting: 'kn' });
      ck('…without sample_ids the button still asks for every remaining recording (unchanged)', r.data.asked === all.length - 1);
      heard.whisper = usual;
    }
    const res3 = (await call('GET', '/api/voice-pilot/results', C)).data.samples.find(x => x.phrase_id === 'k01');
    ck('results show the re-runs under the recording, with script, score and checks', res3.reruns.length === 3 && res3.reruns.find(x => x.setting === 'kn').script === 'kannada' && res3.reruns.find(x => x.setting === 'kn').checks.length === 3 && res3.whisper === TAMIL && res3.whisper_script === 'tamil', res3.reruns);

    // The files: exact UTF-8 text.
    const csv = await fetch(`http://127.0.0.1:${port}/api/voice-pilot/results.csv`, { headers: { Authorization: 'Bearer ' + C } });
    const cbytes = Buffer.from(await csv.arrayBuffer());
    ck('CSV: UTF-8 mark, and the Tamil answer as its exact UTF-8 bytes; labelled "Tamil script"', cbytes.slice(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])) && cbytes.includes(Buffer.from(TAMIL, 'utf8')) && cbytes.toString('utf8').includes(',Tamil script,'));
    const X = require('../services/xlsxLite');
    const xr = await fetch(`http://127.0.0.1:${port}/api/voice-pilot/results.xlsx`, { headers: { Authorization: 'Bearer ' + C } });
    const xbuf = Buffer.from(await xr.arrayBuffer());
    const parts = X.unzipStored(xbuf);
    const sheet1 = parts['xl/worksheets/sheet1.xml'].toString('utf8'), sheet2 = parts['xl/worksheets/sheet2.xml'].toString('utf8');
    ck('Excel file: right type and name; a real workbook (zip, CRCs check) with two sheets', xr.status === 200 && /spreadsheetml\.sheet/.test(xr.headers.get('content-type')) && /filename="FitLife-Voice-Pilot-\d{4}-\d{2}-\d{2}\.xlsx"/.test(xr.headers.get('content-disposition'))
       && /<sheet name="Recordings"/.test(parts['xl/workbook.xml'].toString()) && /<sheet name="Re-runs"/.test(parts['xl/workbook.xml'].toString()));
    ck('Excel file: the Tamil and Kannada text stored exactly (UTF-8 XML), headers say "keyword_score"', sheet1.includes(TAMIL) && sheet2.includes(KN) && sheet1.includes('>gemini_keyword_score<') && sheet2.includes('>keyword_score<'));
    const cellText = (x) => (x.match(/<t xml:space="preserve">[^<]*/g) || []).join('\n');
    ck('Excel file: every value is text, so "=cmd(1)" can never run as a formula; members as codes, no names, no links',
       !/<f>|<f /.test(sheet1) && sheet1.includes('>=cmd(1)<') && !/Padmini/.test(sheet1 + sheet2) && !/http|X-Amz/i.test(cellText(sheet1) + cellText(sheet2)) && /<t xml:space="preserve">M1</.test(sheet2));
    ck('Excel file: another coach gets only the headers; a member cannot download it', (X.unzipStored(Buffer.from(await (await fetch(`http://127.0.0.1:${port}/api/voice-pilot/results.xlsx`, { headers: { Authorization: 'Bearer ' + O } })).arrayBuffer()))['xl/worksheets/sheet1.xml'].toString().match(/<row /g) || []).length === 1
       && (await fetch(`http://127.0.0.1:${port}/api/voice-pilot/results.xlsx`, { headers: { Authorization: 'Bearer ' + M } })).status === 403);
    // Recording the line again: the re-runs were about the old audio, so they go.
    await call('POST', '/api/voice-pilot/sample', M, { phrase_id: 'k01', audio: Buffer.from('third-take').toString('base64') });
    ck('recording a line again removes the re-runs of the old recording (the others stay)', (await pool.query(`SELECT COUNT(*)::int n FROM voice_sample_reruns x JOIN voice_samples s ON s.id = x.sample_id WHERE s.phrase_id='k01'`)).rows[0].n === 0
       && (await pool.query(`SELECT COUNT(*)::int n FROM voice_sample_reruns`)).rows[0].n === 6);
    whisperLanguageReply = undefined;
    // Leave the store as section [4] expects it (two recordings): k06 was added here.
    const k06key = (await pool.query(`SELECT object_key FROM voice_samples WHERE phrase_id='k06'`)).rows[0].object_key;
    await storage.deleteObject(k06key); await pool.query(`DELETE FROM voice_samples WHERE phrase_id='k06'`);
  }

  console.log('\n[3c] Fixes-2n: rule checks bind the number, unit, food and "no" to the same phrase (19 Oct review)');
  {
    const R = (id, t, label) => (V.meaningChecks(id, t).find(c => c.label === label) || {}).result;
    // The reviewer's five false passes, each with a correct counterpart.
    const cases = [
      ['k18', 'tea with sugar no milk', 'no sugar', 'fail', 'tea with no sugar and no milk', 'pass'],
      ['k01', 'morning 2 idli one bowl rice', '1 bowl sambar', 'fail', 'morning 2 idli one bowl sambar', 'pass'],
      ['k01', 'morning 1 idli 2 bowls sambar', '2 idli', 'fail', 'morning 2 idli 1 bowl sambar', 'pass'],
      ['k11', 'today weight 72.5 pounds', '72.5 kg', 'fail', 'today weight 72.5 kg', 'pass'],
      ['k02', 'breakfast one plate rice then two plates upma one cup coffee', '1 plate upma', 'fail', 'breakfast two plates rice then one plate upma one cup coffee', 'pass'],
    ];
    const wrong = cases.flatMap(([id, bad, label, want, good, want2]) => [[id, bad, label, want, R(id, bad, label)], [id, good, label, want2, R(id, good, label)]]).filter(x => x[3] !== x[4]);
    ck('the reviewer\'s five false passes now fail, and their correct counterparts pass (10 cases)', wrong.length === 0, wrong);
    // Kannada script: the same rules after spelling it out.
    ck('Kannada script: "ಎರಡು ಇಡ್ಲಿ … ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್" passes; "ಮೂರು ಇಡ್ಲಿ … ಒಂದು ಬೌಲ್ ಅನ್ನ" fails both; "ಸಕ್ಕರೆ ಹಾಕಿಲ್ಲ" passes, "ಸಕ್ಕರೆ ಹಾಕಿದೆ" fails',
       V.checksText(V.meaningChecks('k01', 'ಬೆಳಗ್ಗೆ ಎರಡು ಇಡ್ಲಿ ಮತ್ತು ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್ ತಿಂದೆ')) === 'morning ✓ · 2 idli ✓ · 1 bowl sambar ✓'
       && V.checksText(V.meaningChecks('k01', 'ಬೆಳಗ್ಗೆ ಮೂರು ಇಡ್ಲಿ ಒಂದು ಬೌಲ್ ಅನ್ನ')) === 'morning ✓ · 2 idli ✗ · 1 bowl sambar ✗'
       && R('k18', 'ಟೀಗೆ ಸಕ್ಕರೆ ಹಾಕಿಲ್ಲ', 'no sugar') === 'pass' && R('k18', 'ಟೀಗೆ ಸಕ್ಕರೆ ಹಾಕಿದೆ', 'no sugar') === 'fail');
    // Conflicting text stays unverified, never a pass.
    ck('conflicting text is UNVERIFIED, not passed: "2 idli and 3 idli", "no sugar in tea but sugar in coffee", "72.5 kg, last week 74 kg", a bare "72.5", "breakfast … lunch"',
       R('k01', 'morning 2 idli and 3 idli one bowl sambar', '2 idli') === 'unverified' && R('k18', 'no sugar in tea but sugar in coffee', 'no sugar') === 'unverified'
       && R('k11', 'today weight 72.5 kg, last week 74 kg', '72.5 kg') === 'unverified' && R('k11', 'today 72.5', '72.5 kg') === 'unverified'
       && R('k02', 'breakfast and lunch one plate upma', 'breakfast') === 'unverified');
    ck('…and shows as "?" in the text form', V.checksText(V.meaningChecks('k01', 'morning 2 idli and 3 idli one bowl sambar')) === 'morning ✓ · 2 idli ? · 1 bowl sambar ✓');
    ck('with no "and"/"then"/comma between them, one item\'s number never runs into the next: "one plate rice two plates upma" fails "1 plate upma"; "one bowl rice two bowl sambar" fails "1 bowl sambar"',
       R('k02', 'breakfast one plate rice two plates upma one cup coffee', '1 plate upma') === 'fail' && R('k01', 'morning one bowl rice two bowl sambar', '1 bowl sambar') === 'fail');
    ck('a container must be the right one ("1 cup sambar" is not "1 bowl sambar"); a food never heard fails', R('k01', 'morning 2 idli 1 cup sambar', '1 bowl sambar') === 'fail' && R('k02', 'breakfast 1 cup coffee', '1 plate upma') === 'fail');
    ck('spoken numbers: "eppattu eradu point aidu kg" is 72.5 kg; "two idli, a bowl of sambar"; "akki rotti eradu" (number after the food); "nooru gram"',
       R('k11', 'Ivattu belagge nanna tooka eppattu eradu point aidu kg', '72.5 kg') === 'pass' && R('k01', 'morning two idli, a bowl of sambar', '2 idli') === 'pass' && R('k01', 'morning two idli, a bowl of sambar', '1 bowl sambar') === 'pass'
       && R('k17', 'Akki rotti eradu, kaayi chutney jote', '2 rice rotti') === 'pass' && R('k20', 'Paneer nooru gram, soppina palya jote', '100 grams') === 'pass');
    const lines = V.PHRASES.filter(p => !p.free && V.CHECKS[p.id]);
    const own = lines.filter(p => V.meaningChecks(p.id, p.say).some(c => c.result !== 'pass')).map(p => [p.id, V.checksText(V.meaningChecks(p.id, p.say))]);
    ck(`every line's own words pass its rule checks (${lines.length} lines) — the checks are not stricter than the script`, own.length === 0, own);
    ck('the summary counts unverified separately', JSON.stringify(V.checksSummary([{ phrase_id: 'k01', gemini_text: 'morning 2 idli and 3 idli one bowl sambar', whisper_text: null }]).gemini.quantity) === '{"passed":1,"unverified":1,"total":2}');
    // Rule checks change nothing stored: raw answers and keyword scores.
    const rowsNow = (await pool.query(`SELECT phrase_id, gemini_text, whisper_text, gemini_score, whisper_score FROM voice_samples ORDER BY id`)).rows;
    ck('raw answers and stored keyword scores are untouched by the rule checks (reading results changes no row)',
       JSON.stringify(rowsNow) === JSON.stringify((await (async () => { await call('GET', '/api/voice-pilot/results', C); return (await pool.query(`SELECT phrase_id, gemini_text, whisper_text, gemini_score, whisper_score FROM voice_samples ORDER BY id`)).rows; })())));
  }

  console.log('\n[4] stopping, removing, 90 days');
  {
    R2.down = true;
    ck('storage down: withdrawing refuses rather than leave recordings behind', (await call('POST', '/api/voice-pilot/withdraw', M)).status === 502 && (await pool.query(`SELECT COUNT(*)::int n FROM voice_samples`)).rows[0].n === 2);
    R2.down = false;
    let r = await call('POST', '/api/voice-pilot/withdraw', M);
    ck('the member stops: every recording deleted from storage and the database', r.status === 200 && R2.objects.size === 0 && (await pool.query(`SELECT COUNT(*)::int n FROM voice_samples`)).rows[0].n === 0);
    ck('…and every re-run with them (Fixes-2m)', (await pool.query(`SELECT COUNT(*)::int n FROM voice_sample_reruns`)).rows[0].n === 0);
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
