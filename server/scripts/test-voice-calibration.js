/**
 * scripts/test-voice-calibration.js — Fixes-2x: the voice calibration kit, on REAL Postgres through
 * the REAL routes (routes/voiceCalibration.js and routes/aiChat.js voice-transcribe), with a local
 * stand-in for R2 and STUBBED speech providers (no real Gemini or Whisper call). The speech check
 * runs for real on real recordings (ffmpeg).
 *
 * What must hold:
 *   [0] the bounds: 6 volunteers (3/2/1), 144 planned slots (28/22/16), 6 offline settings, 32 Part C tries;
 *   [1] the offline replay reproduces the live speech check EXACTLY: the refactored check equals a frozen
 *       copy of the 2w check on every fixture; decide() on stored raw measurements equals the live result,
 *       through a Postgres round trip; the robot's silence and background-alone recordings are refused at
 *       every candidate setting;
 *   [2] each take is transcribed with exactly the everyday request (byte for byte) and every engine call is
 *       recorded (model asked, model that answered, attempts, language, prompt hash);
 *   [3] takes: consent, quotas, the wording check gate, quiet/noisy/retake records coexist, retakes need a
 *       reason and keep the earlier take, both engines get the SAME audio, listener labels keep their history,
 *       re-measuring stored audio gives the same measurements, withdrawal and expiry delete everything linked;
 *   [4] Part C: the actual path of every event (on-device with no upload is never labelled Gemini or Whisper;
 *       an actual fallback is labelled as such), previews linked to their attempt with edits flagged, one
 *       try at a time, the day's baseline, read-back and restore of the whole day, the switch verified off;
 *       member replies unchanged;
 *   [5] complete line outcomes: wrong units, extras, empty answers, provider errors, wrong scripts and
 *       uncertain takes can never be "all correct"; the listener's corrections are the reference;
 *   [6] rule 3: both legs through the logging parser's preview in evaluation mode (nothing written, no coach
 *       message), judged, deduplicated, with its own call count;
 *   [7] the export, empty and populated: codes only, real denominators, provenance, attempt history, no names.
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
const os = require('os');
const { execFileSync } = require('child_process');
const express = require('express');
const jwt = require('jsonwebtoken');

// ── Stubbed providers: every request captured; answers set per test ──────────
const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
const calls = [];
const stub = {
  gemini: (model) => ({ data: { candidates: [{ content: { parts: [{ text: 'Belagge 2 idli mattu 1 bowl sambar' }] }, finishReason: 'STOP' }], modelVersion: `${model}-001`, responseId: 'resp-1' } }),
  chat: () => ({ weight_kg: null, activities: [], acv: [], supplements: [], water_ml_add: null, sleep: null, foods: [{ name: 'Idli', qty_text: '2 idli', grams: 100, meal: 'Breakfast', per_100g: { calories: 130, protein: 4, total_carbs: 25, fat: 2 } }], workouts: [], corrections: [], reply: 'Got it.' }),
  whisper: () => ({ data: { text: 'ಬೆಳಗ್ಗೆ ಎರಡು ಇಡ್ಲಿ ಮತ್ತು ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್', language: 'kannada', segments: [{ start: 0, end: 3, text: 'x', avg_logprob: -0.2, no_speech_prob: 0.05, compression_ratio: 1.1 }], x_groq: { id: 'req_test' } } }),
};
const boom = (status, message) => Object.assign(new Error(message), { response: { status, data: { error: { message } } } });
const formEntries = async (fd) => {
  const out = [];
  for (const [k, v] of fd.entries()) {
    if (typeof v === 'string') out.push([k, v]);
    else out.push([k, { name: v.name, type: v.type, size: v.size, sha: require('crypto').createHash('sha256').update(Buffer.from(await v.arrayBuffer())).digest('hex') }]);
  }
  return out;
};
const stubbedPost = async (url, body, cfg) => {
  const u = String(url);
  if (u.startsWith('https://generativelanguage.googleapis.com/')) {
    const model = u.match(/models\/([^:]+):/)[1];
    calls.push({ kind: 'gemini', model, url: u.replace(/key=[^&]+/, 'key=…'), body: JSON.parse(JSON.stringify(body)), cfg: { timeout: cfg?.timeout, headers: cfg?.headers } });
    return stub.gemini(model);
  }
  if (u === 'https://api.groq.com/openai/v1/chat/completions') {
    calls.push({ kind: 'chat' });
    return { data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(stub.chat(body)) } }] } };
  }
  if (u === 'https://api.groq.com/openai/v1/audio/transcriptions') {
    calls.push({ kind: 'whisper', form: await formEntries(body), cfg: { timeout: cfg?.timeout } });
    return stub.whisper();
  }
  throw new Error('Unexpected external request blocked: ' + url);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const storage = require('../services/storage');
const { startR2 } = require('./lib/r2-standin');
const SP = require('../services/speechPresence');
const OLD = require('./fixtures/voice/speechPresence-2w-reference');
const C = require('../services/voiceCalibration');
const X = require('../services/xlsxLite');
const FF = require('ffmpeg-static');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 400))); };
const FIX = path.join(__dirname, 'fixtures/voice');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vcal-'));
const gen = (name, args) => { const f = path.join(TMP, name); execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args, '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', f]); return f; };
const b64 = (f) => fs.readFileSync(f).toString('base64');

(async () => {
  // ── [0] Bounds ──────────────────────────────────────────────────────────────
  console.log('\n[0] the bounds are fixed in code');
  {
    ck('slots per volunteer: Kannada 28, Hindi 22, English 16', C.PLANNED_PER_GROUP.kn === 28 && C.PLANNED_PER_GROUP.hi === 22 && C.PLANNED_PER_GROUP.en === 16, C.PLANNED_PER_GROUP);
    ck('six volunteers: 3 Kannada, 2 Hindi, 1 English; 144 planned slots in all', C.MAX_PARTICIPANTS === 6 && C.GROUPS.kn.quota + C.GROUPS.hi.quota + C.GROUPS.en.quota === 6 && C.PLANNED_TOTAL === 144, C.PLANNED_TOTAL);
    const ok = ['kn', 'hi', 'en'].every(g => { const p = C.slotPlan(g); return new Set(p.map(s => s.slot)).size === p.length
      && p.filter(s => s.kind === 'control').length === 6 && p.filter(s => s.kind === 'short').length === 2 && p.filter(s => s.kind === 'soft').length === 2
      && p.filter(s => s.kind !== 'control').every(s => C.slotInfo(s.slot, g).items.length > 0) && ['q', 'n'].every(pl => p.filter(s => s.place === pl && s.kind === 'speech').length === p.filter(s => s.kind === 'speech').length / 2); });
    ck('every group: unique slots; 6 controls (3 × quiet/noise), 2 short, 2 soft; every read line scored; quiet and noisy sets equal', ok);
    ck('six offline settings; exactly one is the live setting, equal to the live check\'s own limits', C.GRID.length === 6 && C.GRID.filter(g => g.live).length === 1
      && ['min_voiced_ms', 'min_run_ms', 'min_f0_spread_hz'].every(k => C.GRID.find(g => g.live)[k] === SP.LIVE_LIMITS[k]) && SP.LIVE_LIMITS.min_voiced_ms === 200, C.GRID);
    const P = C.PARTC_PLAN;
    ck('Part C: 32 tries, numbered 1–32, 16 per speaker, 16 per path, every line on both paths for both speakers',
      P.length === 32 && P.map(t => t.trial).join() === Array.from({ length: 32 }, (_, i) => i + 1).join() && P.filter(t => t.speaker === 'C1').length === 16 && P.filter(t => t.path === 'gemini').length === 16
      && new Set(P.map(t => `${t.speaker}|${t.line}|${t.noisy ? 'n' : ''}|${t.path}`)).size === 32);
    const before = C.scriptSha('kn'), say = C.LINES.k01.say;
    C.LINES.k01.say = say + ' (edited)'; const after = C.scriptSha('kn'); C.LINES.k01.say = say;
    ck('the wording hash covers the exact words: changing one Kannada line changes it (and voids a check)', before !== after && C.scriptSha('kn') === before && C.scriptSha('hi') !== before);
  }

  // ── [1] Exact replay of the live speech check ───────────────────────────────
  console.log('\n[1] the offline replay reproduces the live speech check exactly');
  const fixtures = fs.readdirSync(FIX).filter(f => /\.(webm|m4a)$/.test(f)).map(f => path.join(FIX, f));
  // Clips cut from the middle of real speech (it starts about 0.5 s in), so the 200 ms line is crossed.
  for (const ms of [200, 250, 300, 350, 400, 500, 600, 800, 1000]) fixtures.push(gen(`trim-${ms}.webm`, ['-ss', '0.5', '-t', String(ms / 1000), '-i', path.join(FIX, 'speech-en.webm')]));
  for (const vol of [0.02, 0.05, 0.1]) fixtures.push(gen(`quiet-${vol}.webm`, ['-i', path.join(FIX, 'speech-en.webm'), '-filter:a', `volume=${vol}`]));
  const silence6 = gen('robot-S4-silence.webm', ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '6']);
  const background = gen('robot-S5-background.webm', ['-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.5:duration=12:seed=7']);
  fixtures.push(silence6, background);
  let same = 0, decideSame = 0, gridSame = 0, speechN = 0; const diffs = []; const boundaryCases = [];
  const measured = [];
  for (const f of fixtures) {
    const pcm = await SP.decode(fs.readFileSync(f));
    const a = SP.analyse(pcm), b = OLD.analyse(pcm);
    const { features, ...shown } = a;
    if (JSON.stringify(shown) === JSON.stringify(b)) same++; else diffs.push(path.basename(f));
    if (SP.decide(features) === b.speech) decideSame++;
    // Every setting: decide() on the raw features vs the rule written out from the frame counts.
    const brute = (g) => Math.round(features.voiced_frames * 20) >= g.min_voiced_ms && Math.round(features.longest_run_frames * 20) >= g.min_run_ms && features.f0_spread_raw >= g.min_f0_spread_hz;
    if (C.GRID.every(g => SP.decide(features, g) === brute(g))) gridSame++;
    if (b.speech) speechN++;
    measured.push({ f: path.basename(f), a });
  }
  ck(`the refactored live check gives exactly the 2w check's results on ${fixtures.length} recordings (${speechN} with speech, ${fixtures.length - speechN} without)`, same === fixtures.length && fixtures.length >= 30, diffs);
  ck('…and its decision from the raw measurements equals the 2w decision on every one', decideSame === fixtures.length);
  ck('every offline setting decides from whole frame counts and the unrounded spread, on every recording', gridSame === fixtures.length);
  ck('the trimmed short clips cross the 200 ms line (some refused, some accepted), so the boundary is exercised', measured.filter(m => /trim-/.test(m.f)).some(m => m.a.speech) && measured.filter(m => /trim-/.test(m.f)).some(m => !m.a.speech));
  ck('a raw spread of 5.6 Hz is refused although it is REPORTED as 6 Hz: the replay must use the raw value', SP.decide({ voiced_frames: 30, longest_run_frames: 10, f0_spread_raw: 5.6, hop_ms: 20 }) === false && Math.round(5.6) === 6
    && SP.decide({ voiced_frames: 30, longest_run_frames: 10, f0_spread_raw: 6, hop_ms: 20 }) === true);
  ck('9 voiced frames (180 ms) are refused live; v160 and v120 would accept them (the targeted S5 case)', SP.decide({ voiced_frames: 9, longest_run_frames: 3, f0_spread_raw: 22, hop_ms: 20 }) === false
    && C.GRID.filter(g => SP.decide({ voiced_frames: 9, longest_run_frames: 3, f0_spread_raw: 22, hop_ms: 20 }, g)).map(g => g.id).join() === 'v160-r60,v160-r40,v120-r60,v120-r40');
  {
    const s4 = measured.find(m => m.f === 'robot-S4-silence.webm').a, s5 = measured.find(m => m.f === 'robot-S5-background.webm').a;
    const row = (a) => ({ speech_status: a.speech ? 'speech' : 'no_speech', voiced_frames: a.features.voiced_frames, longest_run_frames: a.features.longest_run_frames, f0_spread_raw: a.features.f0_spread_raw, hop_ms: a.features.hop_ms });
    ck('plan rule 1: the robot\'s S4 silence and S5 background-alone are refused at EVERY candidate setting', C.GRID.every(g => C.decision(row(s4), g) === 'refuse' && C.decision(row(s5), g) === 'refuse'), { s4: s4.voiced_ms, s5: s5.voiced_ms });
    // The review's boundary: displayed 6 Hz, raw below 6, refused live. A gated tone with a slow pitch wobble lands there.
    const tone = (depth) => { const R = 16000, n = R * 3, x = new Int16Array(n); let ph = 0; for (let i = 0; i < n; i++) { const tt = i / R; ph += 2 * Math.PI * (150 + depth * Math.sin(2 * Math.PI * 2 * tt)) / R; x[i] = (tt % 1) < 0.7 ? Math.round(9000 * Math.sin(ph)) : 0; } return x; };
    const below = SP.analyse(tone(3.0)), above = SP.analyse(tone(3.3));
    ck(`review boundary: ${below.voiced_ms} ms voiced, ${below.longest_run_ms} ms run, spread DISPLAYED ${below.f0_spread_hz} Hz but raw ${below.features.f0_spread_raw.toFixed(2)} Hz → refused live (and by the 2w check)`,
      below.f0_spread_hz === 6 && below.features.f0_spread_raw < 6 && below.voiced_ms >= 200 && below.longest_run_ms >= 60 && below.speech === false && OLD.analyse(tone(3.0)).speech === false);
    ck('…recomputing from the DISPLAYED figures would wrongly accept it at the live 200/60 baseline; the kit replays from the raw value and refuses',
      (below.voiced_ms >= 200 && below.longest_run_ms >= 60 && below.f0_spread_hz >= 6) === true && C.decision({ speech_status: 'no_speech', ...below.features }, SP.LIVE_LIMITS) === 'refuse');
    ck(`…its neighbour (also displayed ${above.f0_spread_hz} Hz, raw ${above.features.f0_spread_raw.toFixed(2)} Hz) is accepted live and by the replay`, above.f0_spread_hz === 6 && above.speech === true && C.decision({ speech_status: 'speech', ...above.features }, SP.LIVE_LIMITS) === 'accept');
    boundaryCases.push(below, above);
    ck('a take the live check could not decode is "not checked" at every setting (the live server lets it through)', C.GRID.every(g => C.decision({ speech_status: 'undecodable' }, g) === 'not checked') && C.replayMatches({ speech_status: 'undecodable' }));
  }

  // ── Database, storage and the app ──────────────────────────────────────────
  const KEYS = { id: 'AKIDTESTONLY0009', secret: 'calibration-test-secret' };
  const R2 = await startR2(storage, KEYS);
  Object.assign(process.env, { R2_ACCOUNT_ID: 'local', R2_ACCESS_KEY_ID: KEYS.id, R2_SECRET_ACCESS_KEY: KEYS.secret, R2_BUCKET: 'fitlife-test', R2_ENDPOINT: R2.endpoint });
  const pool = require('../db/pool');
  const app = express(); app.use(express.json({ limit: '15mb' }));
  app.use('/api/ai-chat', require('../routes/aiChat'));
  app.use('/api/voice-calibration', require('../routes/voiceCalibration'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tag = Date.now().toString(36);
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1))`);
  for (const t of ['voice_calibration_preview_evals', 'voice_calibration_takes', 'voice_calibration_participants', 'voice_calibration_wording', 'voice_calibration_partc', 'voice_calibration_partc_armed', 'voice_fallback_test_account']) await pool.query(`DELETE FROM ${t}`);
  const mk = async (name, role = 'patient', active = true) => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,$4) RETURNING id`,
    [name, '7' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), role, active])).rows[0].id;
  const tok = (id, role) => jwt.sign({ id, role, name: 'x' }, process.env.JWT_SECRET, { expiresIn: 600 });
  const http = async (method, url, id, role, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok(id, role)}` }, body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const ADMIN = await mk(`Cal Admin ${tag}`, 'admin');
  const NAMES = ['Kavya Hegde', 'Ravi Gowda', 'Shruti Rao', 'Imran Khan', 'Neha Verma', 'Arun Nair', 'Meena Kulkarni', 'Pooja Shetty'];
  const V = []; for (const n of NAMES) V.push(await mk(`${n} ${tag}`));
  const COACH = await mk(`Cal Coach ${tag}`, 'monitor'), TESTACC = await mk(`Voice Test ${tag}`), OTHER = await mk(`Other ${tag}`);
  const speechAudio = b64(path.join(FIX, 'speech-kn.webm')), silenceAudio = b64(silence6);

  try {
    // ── [2] Requests identical to everyday; provenance ────────────────────────
    console.log('\n[2] each take is transcribed with exactly the everyday request, and every call is recorded');
    {
      for (const langHint of ['kn-IN', 'hi-IN', 'en-IN']) {
        calls.length = 0;
        const r = await http('POST', '/api/ai-chat/voice-transcribe', OTHER, 'patient', { audio: speechAudio, mimeType: 'audio/webm', langHint });
        const everyday = calls.find(c => c.kind === 'gemini');
        calls.length = 0; await C.geminiTake(speechAudio, 'audio/webm', langHint);
        const kit = calls.find(c => c.kind === 'gemini');
        ck(`Gemini, ${langHint}: the kit's request equals everyday logging's (URL, model, prompt, audio, settings, timeout)`, r.status === 200 && everyday && kit && JSON.stringify(everyday) === JSON.stringify(kit), { everyday: everyday?.url, kit: kit?.url });
        // Everyday asks Whisper only when Gemini fails: make both Gemini models fail for that one request.
        const g0 = stub.gemini; stub.gemini = () => { throw boom(503, 'busy'); };
        calls.length = 0;
        await http('POST', '/api/ai-chat/voice-transcribe', OTHER, 'patient', { audio: speechAudio, mimeType: 'audio/webm', langHint });
        const ew = calls.find(c => c.kind === 'whisper'); stub.gemini = g0;
        calls.length = 0; await C.whisperTake(speechAudio, 'audio/webm', langHint);
        const kw = calls.find(c => c.kind === 'whisper');
        ck(`Whisper, ${langHint}: the kit's request equals the everyday fallback's (every form field, the file byte for byte)`, ew && kw && JSON.stringify(ew) === JSON.stringify(kw), { ew: ew?.form?.map(x => x[0]), kw: kw?.form?.map(x => x[0]) });
      }
      const g0 = stub.gemini; let first = true;
      stub.gemini = (model) => { if (first) { first = false; throw boom(503, 'overloaded, key=AIzaSECRET'); } return g0(model); };
      const g = await C.geminiTake(speechAudio, 'audio/webm', 'kn-IN'); stub.gemini = g0;
      ck('provenance: the first model failed (503), the second answered; both attempts kept, the model that answered and its reported version recorded',
        g.provenance.attempts.length === 2 && g.provenance.attempts[0].outcome === 'error' && g.provenance.attempts[0].status === 503 && g.provenance.attempts[1].outcome === 'answer'
        && g.provenance.model_used === 'gemini-2.5-flash' && g.provenance.model_version === 'gemini-2.5-flash-001' && /^[0-9a-f]{16}$/.test(g.provenance.prompt_sha256), g.provenance);
      ck('…and no key or secret is ever stored in an error', !JSON.stringify(g.provenance).includes('AIzaSECRET'));
      const w = await C.whisperTake(speechAudio, 'audio/webm', 'kn-IN');
      ck('Whisper provenance: language sent kn, language reported, request id, and the everyday fallback\'s own decision on the answer', w.provenance.language_sent === 'kn' && w.provenance.language_reported === 'kannada' && w.provenance.request_id === 'req_test' && w.review.accepted === true, w);
      const k = process.env.GROQ_API_KEY; delete process.env.GROQ_API_KEY; calls.length = 0;
      const w2 = await C.whisperTake(speechAudio, 'audio/webm', 'en-IN'); process.env.GROQ_API_KEY = k;
      ck('a key that is not set: not called, and the reason is recorded', !calls.length && w2.text === null && w2.error === 'GROQ_API_KEY is not set');
    }

    // ── [3] Takes through the routes ──────────────────────────────────────────
    console.log('\n[3] volunteers, the wording check, takes and their history');
    {
      let r = await http('GET', '/api/voice-calibration/me', V[0], 'patient');
      ck('off the test server: 404, nothing to see', r.status === 404);
      r = await http('GET', '/api/voice-calibration/admin', ADMIN, 'admin');
      ck('…the admin view too', r.status === 404);
      process.env.RAILWAY_GIT_BRANCH = 'test';
      ck('admin only: a coach and a member are refused', (await http('GET', '/api/voice-calibration/admin', COACH, 'monitor')).status === 403 && (await http('GET', '/api/voice-calibration/admin', V[0], 'patient')).status === 403);
      const inv = async (i, group) => http('POST', '/api/voice-calibration/admin/invite', ADMIN, 'admin', { member_id: V[i], group, profile_note: '40s' });
      const codes = [];
      for (const [i, g] of [[0, 'kn'], [1, 'kn'], [2, 'kn']]) codes.push((await inv(i, g)).data.code);
      r = await inv(3, 'kn');
      ck('quota: a fourth Kannada speaker is refused (3 is the plan)', r.status === 409 && /3 Kannada/.test(r.data.error), r.data);
      for (const [i, g] of [[3, 'hi'], [4, 'hi']]) codes.push((await inv(i, g)).data.code);
      ck('quota: a third Hindi speaker is refused', (await inv(5, 'hi')).status === 409);
      codes.push((await inv(5, 'en')).data.code);
      r = await inv(6, 'en');
      ck('six volunteers is the most (a seventh is refused); codes P1–P6 in order', r.status === 409 && codes.join() === 'P1,P2,P3,P4,P5,P6', { codes, r: r.data });
      ck('only members can be invited', (await http('POST', '/api/voice-calibration/admin/invite', ADMIN, 'admin', { member_id: COACH, group: 'kn' })).status === 400);
      const pilotBefore = (await pool.query(`SELECT COUNT(*)::int n FROM voice_samples`)).rows[0].n;
      let st = (await http('GET', '/api/voice-calibration/admin', ADMIN, 'admin')).data;
      ck('the admin view: 6 volunteers, 144 planned slots, every language NOT yet confirmed', st.participants.length === 6 && st.planned_total === 144 && st.wording.every(w => !w.confirmed));
      r = await http('POST', '/api/voice-calibration/take', V[0], 'patient', { slot: 'x01-q', audio: silenceAudio, mimeType: 'audio/webm' });
      ck('a take before agreeing is refused', r.status === 409 && /agree/.test(r.data.error));
      ck('agreeing needs the phone and browser', (await http('POST', '/api/voice-calibration/consent', V[0], 'patient', { phone_type: 'nokia', browser: 'chrome' })).status === 400);
      r = await http('POST', '/api/voice-calibration/consent', V[0], 'patient', { phone_type: 'android_budget', browser: 'chrome', installed_app: true });
      let me = (await http('GET', '/api/voice-calibration/me', V[0], 'patient')).data;
      ck('after agreeing: only this group\'s task list (28 slots; no Hindi lines); read lines locked until the wording check; controls open', r.status === 200 && me.consented && me.slots.length === 28
        && !me.slots.some(s => s.lang === 'hi') && me.slots.filter(s => s.lang).every(s => s.locked) && me.slots.filter(s => s.kind === 'control').every(s => !s.locked));
      calls.length = 0;
      r = await http('POST', '/api/voice-calibration/take', V[0], 'patient', { slot: 'k01-q', audio: speechAudio, mimeType: 'audio/webm', duration_ms: 3100 });
      ck('collection is blocked until a fluent speaker\'s check is recorded: a Kannada line is refused, nothing sent to a provider', r.status === 409 && r.data.locked === true && calls.length === 0, r.data);
      r = await http('POST', '/api/voice-calibration/take', V[0], 'patient', { slot: 'x01-q', audio: silenceAudio, mimeType: 'audio/webm', duration_ms: 6000 });
      ck('a control (no words to check) can be recorded; no transcript is shown to the volunteer', r.status === 200 && r.data.take_no === 1 && !('gemini' in r.data) && !('whisper' in r.data), r.data);
      ck('the wording check needs who checked it', (await http('POST', '/api/voice-calibration/admin/wording', ADMIN, 'admin', { lang: 'kn', confirmed_by: '' })).status === 400);
      r = await http('POST', '/api/voice-calibration/admin/wording', ADMIN, 'admin', { lang: 'kn', confirmed_by: 'Fluent Kannada speaker (Sachin)', note: 'k01–k13 and Eradu idli read aloud' });
      me = (await http('GET', '/api/voice-calibration/me', V[0], 'patient')).data;
      ck('after the Kannada check: Kannada lines open, English still locked', r.status === 200 && me.slots.filter(s => s.lang === 'kn').every(s => !s.locked) && me.slots.filter(s => s.lang === 'en').every(s => s.locked));
      const say = C.LINES.k01.say; C.LINES.k01.say = 'Belagge eradu idli thinde';
      me = (await http('GET', '/api/voice-calibration/me', V[0], 'patient')).data;
      r = await http('POST', '/api/voice-calibration/take', V[0], 'patient', { slot: 'k02-q', audio: speechAudio, mimeType: 'audio/webm' });
      C.LINES.k01.say = say;
      ck('changing any Kannada line after the check voids it: the lines lock again until a new check', me.slots.filter(s => s.lang === 'kn').every(s => s.locked) && r.status === 409, r.data);
      calls.length = 0;
      r = await http('POST', '/api/voice-calibration/take', V[0], 'patient', { slot: 'k01-q', audio: speechAudio, mimeType: 'audio/webm', duration_ms: 3100 });
      const t1 = (await pool.query(`SELECT * FROM voice_calibration_takes WHERE slot_code='k01-q'`)).rows[0];
      const crypto = require('crypto');
      const gCall = calls.find(c => c.kind === 'gemini'), wCall = calls.find(c => c.kind === 'whisper');
      const gSha = gCall && crypto.createHash('sha256').update(Buffer.from(gCall.body.contents[0].parts[1].inline_data.data, 'base64')).digest('hex');
      ck('a Kannada take: stored privately, measured by the live check (raw measurements kept), both engines asked once', r.status === 200 && R2.objects.size === 2 && t1.speech_status === 'speech' && t1.voiced_frames > 0
        && typeof t1.f0_spread_raw === 'number' && calls.filter(c => c.kind === 'gemini').length === 1 && calls.filter(c => c.kind === 'whisper').length === 1, { r: r.data });
      ck('paired: both engines received the SAME captured audio, and it is the stored take (SHA-256)', gSha && wCall && gSha === wCall.form.find(x => x[0] === 'file')[1].sha && gSha === t1.audio_sha256);
      ck('…with what was asked and what answered: Gemini model and version, Whisper language sent and its fallback decision', t1.gemini_provenance.model_used === 'gemini-2.5-flash-lite' && t1.gemini_provenance.model_version === 'gemini-2.5-flash-lite-001'
        && t1.whisper_provenance.language_sent === 'kn' && t1.whisper_review.accepted === true && t1.phone_type === 'android_budget');
      await http('POST', '/api/voice-calibration/take', V[0], 'patient', { slot: 'k01-n', audio: speechAudio, mimeType: 'audio/webm' });
      r = await http('POST', '/api/voice-calibration/take', V[0], 'patient', { slot: 'k01-q', audio: silenceAudio, mimeType: 'audio/webm' });
      ck('recording a line again needs a reason (a recording problem, not a wrong answer)', r.status === 409 && r.data.needs_reason === true);
      r = await http('POST', '/api/voice-calibration/take', V[0], 'patient', { slot: 'k01-q', audio: silenceAudio, mimeType: 'audio/webm', retake_reason: 'cut_off', retake_note: 'stopped early' });
      const hist = (await pool.query(`SELECT * FROM voice_calibration_takes WHERE slot_code='k01-q' ORDER BY take_no`)).rows;
      const noisy = (await pool.query(`SELECT * FROM voice_calibration_takes WHERE slot_code='k01-n'`)).rows;
      ck('quiet, noisy and retake records coexist: k01 quiet take 1 KEPT (audio too) and superseded, take 2 current with its reason; the noisy take untouched', r.status === 200 && hist.length === 2 && hist[0].superseded_at && !hist[1].superseded_at
        && hist[1].retake_reason === 'cut_off' && noisy.length === 1 && !noisy[0].superseded_at && R2.objects.size === 4 && [...R2.objects.keys()].some(k => k.includes(hist[0].object_key)));
      ck('the old pilot evidence is untouched (voice_samples unchanged)', (await pool.query(`SELECT COUNT(*)::int n FROM voice_samples`)).rows[0].n === pilotBefore);
      for (const v of [5.999999999999999, 0.1 + 0.2, 1 / 3, 6, 22.0000000001]) {
        await pool.query(`UPDATE voice_calibration_takes SET f0_spread_raw=$1 WHERE id=$2`, [v, hist[1].id]);
        const back = (await pool.query(`SELECT f0_spread_raw FROM voice_calibration_takes WHERE id=$1`, [hist[1].id])).rows[0].f0_spread_raw;
        if (!Object.is(back, v)) ck(`double ${v} round trip`, false, back);
      }
      await pool.query(`UPDATE voice_calibration_takes SET f0_spread_raw=$1 WHERE id=$2`, [hist[1].f0_spread_raw, hist[1].id]);
      pass++; console.log('  ✓ raw measurements survive the database bit for bit (5.999999999999999, 0.1+0.2, 1/3, 6, 22.0000000001)');
      {
        let okB = true;
        for (const a of boundaryCases) {
          const f = a.features;
          await pool.query(`UPDATE voice_calibration_takes SET speech_status=$2, voiced_frames=$3, longest_run_frames=$4, f0_spread_raw=$5, hop_ms=$6 WHERE id=$1`, [hist[1].id, a.speech ? 'speech' : 'no_speech', f.voiced_frames, f.longest_run_frames, f.f0_spread_raw, f.hop_ms]);
          const back = (await pool.query(`SELECT * FROM voice_calibration_takes WHERE id=$1`, [hist[1].id])).rows[0];
          okB = okB && C.replayMatches(back) && C.decision(back, SP.LIVE_LIMITS) === (a.speech ? 'accept' : 'refuse');
        }
        await pool.query(`UPDATE voice_calibration_takes SET speech_status=$2, voiced_frames=$3, longest_run_frames=$4, f0_spread_raw=$5, hop_ms=$6 WHERE id=$1`, [hist[1].id, hist[1].speech_status, hist[1].voiced_frames, hist[1].longest_run_frames, hist[1].f0_spread_raw, hist[1].hop_ms]);
        ck('the review boundary through the database: stored, read back and replayed at 200/60, both cases equal the live decision', okB);
      }
      const all = (await pool.query(`SELECT * FROM voice_calibration_takes`)).rows;
      ck('every stored take: the replay at the live setting equals the live result stored at upload', all.length === 4 && all.every(t => C.replayMatches(t)) && all.every(t => C.decision(t, SP.LIVE_LIMITS) === (t.speech_status === 'speech' ? 'accept' : 'refuse')));
      r = await http('POST', '/api/voice-calibration/admin/remeasure', ADMIN, 'admin', {});
      ck('measuring the stored audio again gives exactly the stored measurements (4 of 4 the same)', r.status === 200 && r.data.checked === 4 && r.data.same === 4 && r.data.different === 0, r.data);
      await http('POST', '/api/voice-calibration/admin/label', ADMIN, 'admin', { take_id: noisy[0].id, heard: 'speech' });
      await http('POST', '/api/voice-calibration/admin/label', ADMIN, 'admin', { take_id: noisy[0].id, heard: 'uncertain' });
      r = await http('POST', '/api/voice-calibration/admin/label', ADMIN, 'admin', { take_id: noisy[0].id, spoken_as_script: false, reference_text: 'Belagge mooru idli…', reference_items: [{ label: '2 idli', n: 3 }] });
      const lab = (await pool.query(`SELECT heard, spoken_as_script, reference_items, label_history FROM voice_calibration_takes WHERE id=$1`, [noisy[0].id])).rows[0];
      ck('the listener\'s label is speech / no speech / UNCERTAIN, plus "said as written" and the numbers actually said; every change kept', r.status === 200 && lab.heard === 'uncertain' && lab.spoken_as_script === false
        && lab.reference_items[0].n === 3 && lab.label_history.length === 3);
      ck('a label outside speech / no_speech / uncertain is refused', (await http('POST', '/api/voice-calibration/admin/label', ADMIN, 'admin', { take_id: noisy[0].id, heard: 'maybe' })).status === 400);
      const takes = (await http('GET', '/api/voice-calibration/admin/takes', ADMIN, 'admin')).data.takes;
      ck('the admin list shows every take (history) with a signed player link', takes.length === 4 && takes.every(t => /X-Amz-Signature/.test(t.audio_url || '')) && takes.filter(t => !t.current).length === 1);
      // Expiry: a take past its 90 days goes, with its audio and everything linked to it.
      await pool.query(`INSERT INTO voice_calibration_preview_evals (take_id, engine, stage, parser_calls) VALUES ($1,'gemini','parsed',1)`, [hist[0].id]);
      await pool.query(`UPDATE voice_calibration_takes SET delete_after = NOW() - INTERVAL '1 day' WHERE id=$1`, [hist[0].id]);
      const n = await require('../routes/voiceCalibration').deleteExpiredTakes(pool);
      ck('expiry: the expired take, its audio and its linked preview judgments are deleted; nothing else', n === 1 && R2.objects.size === 3 && !(await pool.query(`SELECT 1 FROM voice_calibration_takes WHERE id=$1`, [hist[0].id])).rows.length
        && !(await pool.query(`SELECT 1 FROM voice_calibration_preview_evals WHERE take_id=$1`, [hist[0].id])).rows.length && (await pool.query(`SELECT COUNT(*)::int n FROM voice_calibration_takes`)).rows[0].n === 3);
      await pool.query(`INSERT INTO voice_calibration_preview_evals (take_id, engine, stage, parser_calls) VALUES ($1,'gemini','parsed',1)`, [hist[1].id]);
      r = await http('POST', '/api/voice-calibration/withdraw', V[0], 'patient');
      ck('withdrawing deletes every take, its audio and its linked preview judgments', r.status === 200 && R2.objects.size === 0 && (await pool.query(`SELECT COUNT(*)::int n FROM voice_calibration_takes`)).rows[0].n === 0
        && (await pool.query(`SELECT COUNT(*)::int n FROM voice_calibration_preview_evals`)).rows[0].n === 0);
      r = await inv(7, 'kn');
      ck('a new volunteer gets a new code (P7); codes are never reused', r.status === 200 && r.data.code === 'P7', r.data);
    }

    // ── [4] Part C ─────────────────────────────────────────────────────────────
    console.log('\n[4] Part C: what actually happened on every everyday try');
    {
      const voice = (id, audio = speechAudio, langHint = 'kn-IN') => http('POST', '/api/ai-chat/voice-transcribe', id, 'patient', { audio, mimeType: 'audio/webm', langHint });
      const parse = (id, message) => http('POST', '/api/ai-chat/parse', id, 'patient', { message, context: {} });
      const row = async (n) => (await pool.query(`SELECT * FROM voice_calibration_partc WHERE trial_no=$1`, [n])).rows[0];
      const settle = () => new Promise(res => setTimeout(res, 200));
      const { getISTDate } = require('../utils/istDate');
      const today = getISTDate();
      const baseFood = [{ id: 'f0', name: 'Coffee', grams: 150, meal: 'Breakfast' }];
      await pool.query(`INSERT INTO daily_logs (patient_id, log_date, food_items, weight_kg, water_ml) VALUES ($1,$2,$3,81,500)`, [TESTACC, today, JSON.stringify(baseFood)]);
      let r = await voice(TESTACC);
      ck('nothing is recorded when no try is armed', r.status === 200 && !(await row(1)));
      const plain = r.data;
      ck('the app\'s question "is a try armed for me?" answers none', (await http('GET', '/api/voice-calibration/partc/me', TESTACC, 'patient')).data.armed === null);
      r = await http('POST', '/api/voice-calibration/admin/partc/arm', ADMIN, 'admin', { trial: 1, account_id: TESTACC });
      ck('arming try 1 (controlled, Gemini leg) keeps the day as its baseline', r.status === 200 && r.data.route === 'controlled' && r.data.path === 'gemini' && !r.data.warning
        && (await row(1)).baseline.day.food_items.length === 1 && Number((await row(1)).baseline.day.weight_kg) === 81, r.data);
      const me = (await http('GET', '/api/voice-calibration/partc/me', TESTACC, 'patient')).data.armed;
      ck('the test account\'s app is told: try 1, controlled, upload the recording (on-device words not used); another account is told nothing', me?.trial === 1 && me.force_upload === true && (await http('GET', '/api/voice-calibration/partc/me', OTHER, 'patient')).data.armed === null);
      ck('one try at a time: arming another while try 1 is open is refused', (await http('POST', '/api/voice-calibration/admin/partc/arm', ADMIN, 'admin', { trial: 2, account_id: TESTACC })).status === 409);
      const armedReply = (await voice(TESTACC)).data;
      ck('the member\'s reply is exactly the same whether or not a try is armed', JSON.stringify(armedReply) === JSON.stringify(plain), { armedReply, plain });
      await settle();
      let t = await row(1);
      let c0 = t.captures[0];
      ck('the server recording: actual path gemini/gemini-2.5-flash-lite, uploaded, attempt 1, the trail and the live speech check (raw)', c0.kind === 'server recording' && c0.actual_path === 'gemini/gemini-2.5-flash-lite' && c0.upload === true
        && c0.attempt === 1 && c0.trail[0].outcome === 'answer' && c0.speech.features.voiced_frames > 0 && c0.speech.live_decision === 'accept', c0);
      await voice(OTHER); await voice(TESTACC); await settle();
      t = await row(1);
      ck('a Retry is a separate attempt linked to the original recording (same audio); another account\'s note is not recorded', t.captures.length === 2 && t.captures[1].attempt === 2 && t.captures[1].retry_of === 1);
      await parse(TESTACC, armedReply.transcript); await settle();
      await parse(TESTACC, `${armedReply.transcript} and 1 vada`); await settle();
      t = await row(1);
      const pv = t.captures.filter(c => c.kind === 'preview');
      ck('previews are recorded and linked to their attempt; text edited before the preview is flagged as EDITED (a manual change, never a recognition pass)', pv.length === 2 && pv[0].attempt === 2 && !pv[0].edited && /unedited/.test(pv[0].text_source)
        && pv[1].edited === true && /EDITED/.test(pv[1].text_source) && pv[0].preview.foods[0].name === 'Idli', pv.map(x => x.text_source));
      // Apply (simulated save), read back, restore the whole day.
      await pool.query(`UPDATE daily_logs SET food_items = food_items || $3::jsonb, weight_kg = 82.5 WHERE patient_id=$1 AND log_date=$2`, [TESTACC, today, JSON.stringify([{ id: 'f1', name: 'Idli', grams: 100, meal: 'Breakfast' }])]);
      await pool.query(`INSERT INTO workout_sessions (patient_id, session_date, duration_min) VALUES ($1,$2,20)`, [TESTACC, today]);
      r = await http('POST', '/api/voice-calibration/admin/partc/readback', ADMIN, 'admin');
      ck('read-back: the idli added, the weight changed 81 → 82.5, a workout added; nothing else', r.status === 200 && r.data.diff.added_foods.length === 1 && r.data.diff.added_foods[0].name === 'Idli' && r.data.diff.removed_foods.length === 0
        && r.data.diff.changed_fields.map(f => f.field).join() === 'weight_kg' && r.data.diff.workouts_changed === true, r.data.diff);
      r = await http('POST', '/api/voice-calibration/admin/partc/restore', ADMIN, 'admin');
      const after = await C.dayState(pool, TESTACC, today);
      ck('restore: only this try\'s changes undone; the whole day (coffee, weight 81, water 500, no workout) equals the baseline', r.data.ok === true && after.day.food_items.length === 1 && after.day.food_items[0].name === 'Coffee' && after.day.weight_kg === 81 && after.day.water_ml === 500 && after.workouts.length === 0);
      r = await http('POST', '/api/voice-calibration/admin/partc/finish', ADMIN, 'admin');
      ck('finish: the Voice backup switch verified off, the day restored, the try closed', r.data.switch_off_verified === true && r.data.restored === true && !r.data.warning && (await row(1)).finished_at);
      // A controlled Gemini try that Gemini failed: Whisper answered, and that is what is recorded.
      await http('POST', '/api/voice-calibration/admin/partc/arm', ADMIN, 'admin', { trial: 3, account_id: TESTACC });
      const g0 = stub.gemini; stub.gemini = () => { throw boom(503, 'busy'); };
      await voice(TESTACC); stub.gemini = g0; await settle();
      t = await row(3);
      ck('an actual fallback is labelled as such: answered by groq/whisper-large-v3, both Gemini models\' errors in the trail', t.captures[0].actual_path === 'groq/whisper-large-v3'
        && t.captures[0].trail.filter(x => x.engine === 'gemini' && x.outcome === 'error').length === 2 && t.captures[0].trail.some(x => x.engine === 'whisper' && x.outcome === 'accepted'), t.captures[0].trail);
      await http('POST', '/api/voice-calibration/admin/partc/finish', ADMIN, 'admin');
      // Silence: refused by the speech check before any provider.
      await http('POST', '/api/voice-calibration/admin/partc/arm', ADMIN, 'admin', { trial: 13, account_id: TESTACC });
      calls.length = 0; r = await voice(TESTACC, silenceAudio, 'en-IN'); await settle();
      t = await row(13);
      ck('the silence try: refused before any provider (no provider called), recorded as such', r.data.rejected === 'no_speech_detected' && calls.length === 0 && /^none \(speech check refused/.test(t.captures[0].actual_path) && t.captures[0].speech.live_decision === 'refuse');
      await http('POST', '/api/voice-calibration/admin/partc/finish', ADMIN, 'admin');
      // Natural observation: on-device dictation with NO upload is never labelled Gemini or Whisper.
      r = await http('POST', '/api/voice-calibration/admin/partc/arm', ADMIN, 'admin', { trial: 33, account_id: TESTACC });
      const meN = (await http('GET', '/api/voice-calibration/partc/me', TESTACC, 'patient')).data.armed;
      calls.length = 0;
      await http('POST', '/api/voice-calibration/partc/device-event', TESTACC, 'patient', { text: 'two idli one bowl sambar', lang: 'en-IN' });
      await parse(TESTACC, 'two idli one bowl sambar'); await settle();
      t = await row(33);
      ck('natural observation: the app is NOT told to upload; on-device dictation is recorded as "browser/on-device (no upload)", no provider asked', r.data.route === 'natural' && meN.force_upload === false
        && t.captures[0].kind === 'on-device dictation' && t.captures[0].upload === false && t.captures[0].actual_path === 'browser/on-device (no upload)' && !calls.some(c => c.kind === 'gemini' || c.kind === 'whisper'));
      ck('…its preview is linked to that on-device attempt, unedited', t.captures[1].kind === 'preview' && t.captures[1].attempt === 1 && !t.captures[1].edited);
      ck('an on-device result can never carry an engine label (no Gemini or Whisper name in its record)', !/gemini|whisper/i.test(JSON.stringify(t.captures[0])));
      await http('POST', '/api/voice-calibration/admin/partc/finish', ADMIN, 'admin');
      // The switch: a Whisper try, the switch left on at Finish.
      r = await http('POST', '/api/voice-calibration/admin/partc/arm', ADMIN, 'admin', { trial: 2, account_id: TESTACC });
      ck('arming a Whisper-leg try while the Voice backup switch is off warns', /not on for that account/.test(r.data.warning || ''), r.data);
      await pool.query(`INSERT INTO voice_fallback_test_account (id, user_id, set_by) VALUES (1,$1,$2) ON CONFLICT (id) DO UPDATE SET user_id=$1, set_at=NOW()`, [TESTACC, ADMIN]);
      await voice(TESTACC); await settle();
      t = await row(2);
      ck('with the switch on: recorded as Gemini skipped by the switch, Whisper answered (the controlled leg)', t.captures[0].voice_backup_switch === true && t.captures[0].trail[0].outcome.startsWith('skipped') && t.captures[0].actual_path === 'groq/whisper-large-v3');
      r = await http('POST', '/api/voice-calibration/admin/partc/finish', ADMIN, 'admin');
      ck('finishing with the switch still on: NOT verified off, with a warning', r.data.switch_off_verified === false && /still ON/.test(r.data.warning || ''), r.data);
      await pool.query(`DELETE FROM voice_fallback_test_account`);
      await http('POST', '/api/voice-calibration/admin/partc/arm', ADMIN, 'admin', { trial: 4, account_id: TESTACC });
      await pool.query(`UPDATE voice_calibration_partc_armed SET armed_at = NOW() - INTERVAL '31 minutes'`);
      await voice(TESTACC); await settle();
      ck('a try armed more than 30 minutes ago records nothing (but stays open until Finish)', !((await row(4)).captures || []).length && (await http('POST', '/api/voice-calibration/admin/partc/arm', ADMIN, 'admin', { trial: 5, account_id: TESTACC })).status === 409);
      await http('POST', '/api/voice-calibration/admin/partc/finish', ADMIN, 'admin');
      await http('POST', '/api/voice-calibration/admin/partc/arm', ADMIN, 'admin', { trial: 6, account_id: TESTACC });
      delete process.env.RAILWAY_GIT_BRANCH;
      await voice(TESTACC); await settle();
      ck('off the test server nothing is recorded, even with a try armed', !((await row(6)).captures || []).length);
      process.env.RAILWAY_GIT_BRANCH = 'test';
      await http('POST', '/api/voice-calibration/admin/partc/finish', ADMIN, 'admin');
      r = await http('PUT', '/api/voice-calibration/admin/partc/1', ADMIN, 'admin', { items: [{ label: '2 idli', ok: true }, { label: '1 bowl sambar', ok: false }, { label: 'not in the plan', ok: true }], applied: true, day_correct: false, notes: 'sambar became a cup' });
      await http('PUT', '/api/voice-calibration/admin/partc/1', ADMIN, 'admin', { items: [{ label: '2 idli', ok: true }, { label: '1 bowl sambar', ok: false }], applied: true, day_correct: false, notes: 'checked' });
      t = await row(1);
      ck('the hand-marked outcome keeps only the planned items, and every edit is kept', r.status === 200 && t.items.length === 2 && t.edits.length === 2);
      ck('a try number outside 1–32 and 33–40 is refused', (await http('POST', '/api/voice-calibration/admin/partc/arm', ADMIN, 'admin', { trial: 41, account_id: TESTACC })).status === 400);
      const sheets = C.workbookSheets({ partc: (await pool.query(`SELECT * FROM voice_calibration_partc ORDER BY trial_no`)).rows });
      const pc = sheets.find(s => s.name === 'Part C tries').rows, H = pc[0];
      const pcol = (trial, col) => pc.find(r => r[0] === trial)[H.indexOf(col)];
      ck('export: try 1 counts as a Gemini test; try 3 (Gemini failed) does NOT; natural 33 is not a provider test; try 2 switch not verified off', pcol(1, 'counts as a test of the planned provider') === 'yes'
        && /^NO/.test(pcol(3, 'counts as a test of the planned provider')) && /natural/.test(pcol(33, 'counts as a test of the planned provider')) && pcol(2, 'voice backup switch verified off') === 'no' && pcol(1, 'restore: whole day equal to the baseline') === 'yes');
      ck('export: the event ledger lists every event (recordings, retries, previews, on-device) in order', sheets.find(s => s.name === 'Part C events').rows.filter(r => r[0] === 1).map(r => r[2]).join() === 'server recording,server recording,preview,preview');
    }

    // ── [5] Complete line outcomes ────────────────────────────────────────────
    console.log('\n[5] line outcomes are complete: no material error can be "all correct"');
    {
      const sc = (id, tx, o) => C.scoreTranscript(C.LINES[id].items, tx, C.LINES[id].lang, o);
      const out = (id, tx) => sc(id, tx).items.map(i => i.outcome).join(',');
      ck('English, digits and words: all correct', sc('e01', '2 idli, 1 bowl sambar, weight 82.5 kg').line === 'all correct' && sc('e01', 'Two idli one bowl sambar weight eighty two point five kilos').line === 'all correct');
      ck('a wrong number is its own outcome (the dangerous case): 3 idli, 72.5 kg', out('e01', '3 idli, 1 bowl sambar, weight 72.5 kg') === 'wrong number,correct,wrong number' && sc('e01', '3 idli, 1 bowl sambar, weight 82.5 kg').line === 'wrong number');
      ck('a wrong unit (a cup for a bowl) is "wrong unit", never all correct; a bowl for a katori is the accepted dal alias', sc('e01', '2 idli, 1 cup sambar, weight 82.5 kg').line === 'wrong unit' && sc('e02', '3 chapati and 1 bowl dal').line === 'all correct' && out('e02', '3 chapati and 1 bowl dal') === 'correct,unit alias');
      ck('an EXTRA food is "extra", never all correct', sc('k01', 'eradu idli ondu bowl sambar 2 vada').line === 'extra' && JSON.stringify(sc('k01', 'eradu idli ondu bowl sambar 2 vada').extra) === '["2 vada"]');
      ck('an invented amount for curd (none was spoken) is "extra"; curd heard with no amount is correct', out('k04', '2 chapati, 1 katori dal and 1 bowl curd') === 'correct,correct,invented amount' && sc('k04', '2 chapati, 1 katori dal and 1 bowl curd').line === 'extra'
        && out('k04', '2 chapati, 1 katori dal mattu mosaru') === 'correct,correct,correct (no amount spoken)');
      ck('missing items are "missing": a weight with no unit, a food with no number, the S2 failure (eradu lost)', sc('h03', 'aaj mera wazan 82.5 hai').line === 'missing' && sc('k01', 'idli mattu sambar').line === 'missing' && out('k01', 'Belaggera duidli mattu ondu bowl sambar') === 'missing,correct');
      ck('an empty answer and a provider error are their own outcomes', sc('e01', '').line === 'empty answer' && sc('e01', null, { error: '503: busy' }).line === 'provider error');
      ck('the wrong language or script (Tamil script for a Kannada line) is its own outcome', sc('k01', 'விளைகே இரடு இட்ளி').line === 'wrong language/script' && sc('k01', 'ಬೆಳಗ್ಗೆ ಎರಡು ಇಡ್ಲಿ ಮತ್ತು ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್ ತಿಂದೆ').line === 'all correct');
      ck('conflicting numbers, or a take the listener could not establish, are "uncertain/unscorable"', sc('k01', '2 idli 3 idli ondu bowl sambar').line === 'uncertain/unscorable' && sc('k01', 'eradu idli ondu bowl sambar', { unscorable: true }).line === 'uncertain/unscorable');
      ck('flags coexist: wrong number AND extra both listed; the line takes the more serious', JSON.stringify(sc('e01', '3 idli, 1 bowl sambar, 2 vada, weight 82.5 kg').flags.sort()) === JSON.stringify(['extra', 'wrong number']) && sc('e01', '3 idli, 1 bowl sambar, 2 vada, weight 82.5 kg').line === 'wrong number');
      ck('Hindi in Roman and Devanagari, and Kannada number words incl. 72.5', sc('h01', 'दो रोटी और एक कटोरी दाल खाया').line === 'all correct' && sc('h03', 'aaj mera wazan bayaasi point paanch kilo hai').line === 'all correct' && sc('k11', 'Ivattu belagge nanna tooka eppattu eradu point aidu kg').line === 'all correct');
      ck('"do" counts as 2 only in a Hindi line, never in an English one', out('se1', 'I do two idli') === 'correct' && out('e02', 'do chapati and one katori dal') !== 'correct,correct');
      const ref = C.itemsWithReference(C.LINES.k01.items, [{ label: '2 idli', n: 3 }]);
      ck('the listener\'s reference wins: a volunteer who said 3 idli makes "3 idli" correct and "2 idli" a wrong number', C.scoreTranscript(ref, 'mooru idli ondu bowl sambar', 'kn').line === 'all correct' && C.scoreTranscript(ref, 'eradu idli ondu bowl sambar', 'kn').line === 'wrong number');
      ck('every line outcome is one of the nine named outcomes', C.LINE_OUTCOMES.length === 9 && ['3 idli', '', 'விளை', '2 vada 2 idli 1 bowl sambar'].every(tx => C.LINE_OUTCOMES.includes(sc('k01', tx).line)));
    }

    // ── [6] Rule 3: the logging parser's preview, both legs ───────────────────
    console.log('\n[6] rule 3: newly admitted takes through the parser\'s preview (evaluation mode, nothing written)');
    {
      const items = C.LINES.e01.items;
      const P = (o) => ({ weight_kg: null, activities: [], acv: [], supplements: [], water_ml_add: null, sleep: null, foods: [], workouts: [], corrections: [], ...o });
      const idli = { name: 'Idli', qty_text: '2 idli', grams: 100 }, sambar = { name: 'Sambar', qty_text: '1 bowl', grams: 200 };
      ck('a correct preview (2 idli, 1 bowl sambar, 82.5 kg): correct reviewable', C.judgePreview(items, P({ foods: [idli, sambar], weight_kg: 82.5 }), 'en').result === 'correct reviewable');
      ck('a surfaced wrong number (3 idli) disqualifies', C.judgePreview(items, P({ foods: [{ ...idli, qty_text: '3 idli' }, sambar], weight_kg: 82.5 }), 'en').result === 'disqualifying');
      ck('a wrong unit (sambar as a cup) disqualifies', C.judgePreview(items, P({ foods: [idli, { ...sambar, qty_text: '1 cup' }], weight_kg: 82.5 }), 'en').result === 'disqualifying');
      ck('an invented item (vada) disqualifies', /invented item: Vada/.test(C.judgePreview(items, P({ foods: [idli, sambar, { name: 'Vada', qty_text: '1 vada' }], weight_kg: 82.5 }), 'en').problems.join()));
      ck('an unspoken health change (water, sleep, a weight nobody said) disqualifies', C.judgePreview(items, P({ foods: [idli, sambar], weight_kg: 82.5, water_ml_add: 1000 }), 'en').result === 'disqualifying'
        && C.judgePreview(C.LINES.k01.items, P({ foods: [idli, sambar], weight_kg: 80 }), 'kn').result === 'disqualifying');
      ck('a missing spoken item stays visible as missing/unresolved, never "correct"', C.judgePreview(items, P({ foods: [idli], weight_kg: 82.5 }), 'en').result === 'missing/unresolved (visible)'
        && C.judgePreview(items, P({ foods: [idli], unresolved_foods: [{ name: 'sambar' }], weight_kg: 82.5 }), 'en').items[1].outcome === 'unresolved (shown)');
      ck('a question or a safety reply (no log card) is an explicit refusal; no preview is a provider error', C.judgePreview(items, P({ question: true, reply: 'What do you mean?' }), 'en').result === 'explicit refusal' && C.judgePreview(items, null, 'en').result === 'provider error');
      ck('curd with an amount nobody said is shown for checking, not scored as recognition success', /amount not spoken/.test(C.judgePreview(C.LINES.k04.items, P({ foods: [{ name: 'Chapati', qty_text: '2 chapati' }, { name: 'Dal', qty_text: '1 katori' }, { name: 'Curd', qty_text: '1 bowl', grams: 150 }] }), 'kn').items[2].outcome));
      // Evaluation mode writes nothing and messages no one.
      const { parseMemberMessage } = require('../routes/aiChat');
      const writes = []; let spying = true;   // pooled clients keep the spy after release: record only while spying
      const q0 = pool.query.bind(pool), c0 = pool.connect.bind(pool);
      pool.query = (sql, ...a) => { const t = typeof sql === 'string' ? sql : sql?.text || ''; if (/^\s*(INSERT|UPDATE|DELETE)/i.test(t)) writes.push(t.slice(0, 60)); return q0(sql, ...a); };
      // Every write through a pooled client too (pg's own pool.query calls connect with a callback).
      const spyClient = (cl) => { if (!cl || cl.__spied) return cl; const cq = cl.query.bind(cl); cl.query = (sql, ...a) => { const t = typeof sql === 'string' ? sql : sql?.text || ''; if (spying && /^\s*(INSERT|UPDATE|DELETE)/i.test(t)) writes.push(t.slice(0, 60)); return cq(sql, ...a); }; cl.__spied = true; return cl; };
      pool.connect = (cb) => (cb ? c0((err, cl, done) => cb(err, spyClient(cl), done)) : c0().then(spyClient));
      const notesBefore = (await q0(`SELECT COUNT(*)::int n FROM monitor_notes`)).rows[0].n;
      const ch0 = stub.chat;
      stub.chat = () => ({ ...ch0(), foods: [{ name: `Brand New Food ${Date.now().toString(36)}`, qty_text: '2 pieces', grams: 80, meal: 'Breakfast', per_100g: { calories: 200, protein: 5, total_carbs: 30, fat: 6 } }] });
      const pr1 = await parseMemberMessage({ userId: V[1], message: 'two pieces of brand new food xyz', context: {}, evaluation: true });
      stub.chat = () => ({ ...ch0(), coach_message: 'please call me' });
      const pr2 = await parseMemberMessage({ userId: V[1], message: 'tell my coach to call me', context: {}, evaluation: true });
      stub.chat = () => ({ ...ch0(), question: 'how many calories today?' });
      const pr3 = await parseMemberMessage({ userId: V[1], message: 'how many calories today?', context: {}, evaluation: true });
      await new Promise(res => setTimeout(res, 600));    // the live path learns foods in the background: give it time to show up
      // A correction to an earlier entry: the live path records it as an evaluation-set sample; evaluation mode must not.
      pool.query = q0; pool.connect = c0; spying = false;
      await q0(`INSERT INTO ai_parse_turns (patient_id, message, foods) VALUES ($1, 'idli for breakfast', $2::jsonb)`, [V[1], JSON.stringify([{ name: 'Idli', grams: 100, meal: 'Breakfast', qty_text: '2 idli' }])]);
      pool.query = (sql, ...a) => { const t = typeof sql === 'string' ? sql : sql?.text || ''; if (/^\s*(INSERT|UPDATE|DELETE)/i.test(t)) writes.push(t.slice(0, 60)); return q0(sql, ...a); };
      pool.connect = (cb) => (cb ? c0((err, cl, done) => cb(err, spyClient(cl), done)) : c0().then(spyClient)); spying = true;
      const corrCtx = { lastFoods: [{ name: 'Idli', grams: 100, meal: 'Breakfast' }] };
      stub.chat = () => ({ ...ch0(), foods: [], corrections: [{ name: 'Idli', grams: 150 }] });
      const pr4 = await parseMemberMessage({ userId: V[1], message: 'actually the idli was 150 grams', context: corrCtx, evaluation: true });
      await new Promise(res => setTimeout(res, 600));    // the live path learns foods and records corrections in the background: give it time to show up
      pool.query = q0; pool.connect = c0; spying = false;
      const samples = async () => (await q0(`SELECT COUNT(*)::int n FROM ai_parse_samples WHERE patient_id=$1`, [V[1]])).rows[0].n;
      const samplesEval = await samples();
      await parseMemberMessage({ userId: V[1], message: 'actually the idli was 150 grams', context: corrCtx });   // positive control: the live path
      await new Promise(res => setTimeout(res, 600));
      const samplesLive = await samples();
      stub.chat = ch0;
      ck('evaluation mode: the preview comes back, and NO database write happens (no food learning, no evaluation-set rows, no coach note)', pr1.foods?.[0]?.name && writes.length === 0
        && (await pool.query(`SELECT COUNT(*)::int n FROM monitor_notes`)).rows[0].n === notesBefore, writes);
      ck('…a correction to an earlier entry is shown in the preview but records no evaluation-set sample (the same message on the live path does record one)', pr4.corrections?.length === 1
        && samplesLive === samplesEval + 1 && writes.length === 0, { corrections: pr4.corrections, samplesEval, samplesLive, writes });
      ck('…a coach message is not sent, and a question is not answered (no extra AI call): both shown as explicit refusals', pr2.sent_to_coach === false && /would send/.test(pr2.evaluation_note) && pr3.question === true && pr3.reply === null
        && C.judgePreview(items, pr2, 'en').result === 'explicit refusal');
      // The route: newly admitted takes (live refuses 180 ms; v160/v120 accept), both legs, deduplicated.
      await http('POST', '/api/voice-calibration/consent', V[7], 'patient', { phone_type: 'iphone', browser: 'safari' });
      const pid = (await pool.query(`SELECT id FROM voice_calibration_participants WHERE patient_id=$1 AND withdrawn_at IS NULL`, [V[7]])).rows[0].id;
      const mkTake = async (slot, frames, gem, whisp, review) => (await pool.query(`INSERT INTO voice_calibration_takes (participant_id, slot_code, take_no, speech_status, voiced_frames, longest_run_frames, f0_spread_raw, hop_ms,
        gemini_text, gemini_generated, whisper_text, whisper_review) VALUES ($1,$2,1,$3,$4,4,22,20,$5,false,$6,$7) RETURNING id`, [pid, slot, frames >= 10 ? 'speech' : 'no_speech', frames, gem, whisp, JSON.stringify(review)])).rows[0].id;
      const ok = await mkTake('k01-n', 9, 'eradu idli ondu bowl sambar', 'ಎರಡು ಇಡ್ಲಿ', { accepted: false, reason: 'unsure' });
      const bad = await mkTake('k02-n', 9, 'ondu plate upma ondu cup coffee', 'ondu plate upma', { accepted: true });
      await mkTake('k04-n', 30, '2 chapati', '2 chapati', { accepted: true });       // accepted live: not newly admitted
      // The parser's answer depends on the message it was given (taken from the prompt's member message).
      const said = (body) => { const prompt = (body?.messages || []).map(m => m.content).join('\n'); return (prompt.match(/ondu plate upma ondu cup coffee|eradu idli ondu bowl sambar/) || [''])[0]; };
      let nChat = 0; stub.chat = (body) => { nChat++; const m = said(body);
        const per = { calories: 120, protein: 3, total_carbs: 20, fat: 3 };
        return /upma/.test(m) ? { ...ch0(), foods: [{ name: 'Upma', qty_text: '3 plate', grams: 600, meal: 'Breakfast', per_100g: per }, { name: 'Coffee', qty_text: '1 cup', grams: 150, meal: 'Breakfast', per_100g: per }] }
          : { ...ch0(), foods: [{ name: 'Idli', qty_text: '2 idli', grams: 100, meal: 'Breakfast', per_100g: per }, { name: 'Sambar', qty_text: '1 bowl', grams: 200, meal: 'Breakfast', per_100g: per }] }; };
      let r = await http('POST', '/api/voice-calibration/admin/preview-eval', ADMIN, 'admin', {});
      const ev = (await pool.query(`SELECT * FROM voice_calibration_preview_evals ORDER BY take_id, engine`)).rows;
      const evOf = (id, e) => ev.find(x => x.take_id === id && x.engine === e);
      ck('rule 3 route: only newly admitted takes, both legs: the refused Whisper leg is an explicit refusal with no parser call', r.status === 200 && ev.length === 4 && evOf(ok, 'whisper').stage === 'voice refused'
        && evOf(ok, 'whisper').judgment.result === 'explicit refusal' && evOf(ok, 'whisper').parser_calls === 0, ev.map(e => [e.take_id, e.engine, e.stage]));
      ck('…a correct Gemini preview is correct reviewable; a preview with 3 plates of upma disqualifies (both legs of that take)', evOf(ok, 'gemini').judgment.result === 'correct reviewable' && evOf(bad, 'gemini').judgment.result === 'disqualifying' && evOf(bad, 'whisper').judgment.result === 'disqualifying',
        ev.map(e => [e.take_id, e.engine, e.stage, e.judgment?.result, (e.judgment?.problems || []).join('|'), JSON.stringify(e.preview?.foods || e.preview?.error || '').slice(0, 120)]));
      ck('…the parser calls are counted separately (3 here: one per leg that reached the parser)', r.data.parser_calls === 3 && nChat === 3 && ev.reduce((n, e) => n + e.parser_calls, 0) === 3, r.data);
      r = await http('POST', '/api/voice-calibration/admin/preview-eval', ADMIN, 'admin', {});
      ck('deduplicated by take: running it again judges nothing new and calls nothing', r.data.judged === 0 && r.data.parser_calls === 0 && nChat === 3);
      stub.chat = ch0;
      const part = (await pool.query(`SELECT * FROM voice_calibration_participants`)).rows, tk = (await pool.query(`SELECT * FROM voice_calibration_takes`)).rows;
      await pool.query(`UPDATE voice_calibration_takes SET heard='speech'`);
      const S = C.workbookSheets({ participants: part, takes: (await pool.query(`SELECT * FROM voice_calibration_takes`)).rows, evals: (await pool.query(`SELECT * FROM voice_calibration_preview_evals`)).rows });
      const A = S.find(s => s.name === 'Part A summary').rows, AH = A[0];
      const v160 = A.find(x => x[0] === 'v160-r60' && x[1] === 'all');
      ck('Part A: v160 newly admits 2 takes, both judged, 1 disqualified → "fails screen: rule 3"', v160[AH.indexOf('newly accepted speech vs live')] === 2 && v160[AH.indexOf('rule 3: newly accepted takes with both legs judged')] === 2
        && v160[AH.indexOf('rule 3: disqualified takes')] === 1 && /fails screen.*rule 3/.test(v160[AH.indexOf('screening result (all slice; a proposal, never a release)')]), v160);
      ck('the Rule 3 previews sheet lists each leg with its judgment and parser calls', S.find(s => s.name === 'Rule 3 previews').rows.length === 5);
      void tk;
    }

    // ── [7] The export ────────────────────────────────────────────────────────
    console.log('\n[7] the export: empty and populated; codes, denominators, provenance, history; never a name');
    {
      for (const t of ['voice_calibration_preview_evals', 'voice_calibration_takes', 'voice_calibration_participants', 'voice_calibration_wording', 'voice_calibration_partc', 'voice_calibration_partc_armed']) await pool.query(`DELETE FROM ${t}`);
      let r = await http('GET', '/api/voice-calibration/admin/export.xlsx', ADMIN, 'admin');
      const files = X.unzipStored(r.data);
      const sheetNames = (String(files['xl/workbook.xml'] || '').match(/name="[^"]+"/g) || []).map(s => s.slice(6, -1));
      ck('the unpopulated export: 14 sheets', r.status === 200 && sheetNames.join('|') === 'About|Volunteers|Plan|Lines|Slots|Takes|Items|Part A summary|Rule 3 previews|Part B summary|Number words|Controls|Part C tries|Part C events', sheetNames);
      const sheets = C.workbookSheets({});
      const about = JSON.stringify(sheets[0].rows);
      ck('…the plan with no data: 66 slot definitions, 15 lines, the 32 controlled Part C tries, 6 settings × 14 slices', sheets.find(s => s.name === 'Plan').rows.length === 67 && sheets.find(s => s.name === 'Lines').rows.length === 16
        && sheets.find(s => s.name === 'Part C tries').rows.length === 33 && sheets.find(s => s.name === 'Part A summary').rows.length === 1 + 6 * 14);
      ck('…About: 0 of 6, 144 slots (108 speech, 36 controls), budgets (288 initial calls, 64 Part C attempts, rule 3 separate), every language NOT CONFIRMED, script version, no "8%" claim',
        /0 of 6/.test(about) && /108 speech, 36 no-speech/.test(about) && /planned 288/.test(about) && /of 64 planned/.test(about) && /rule 3 parser calls/.test(about) && (about.match(/NOT CONFIRMED/g) || []).length === 3
        && /round1-script-v1/.test(about) && !/8%/.test(about) && /cannot choose an engine/.test(about));
      if (process.env.CAL_EXPORT_OUT) { fs.writeFileSync(process.env.CAL_EXPORT_OUT, r.data); console.log(`    (unpopulated example written to ${process.env.CAL_EXPORT_OUT})`); }
      const P = [{ id: 1, code: 'P1', grp: 'kn', phone_type: 'iphone' }];
      const f = (frames, run, spread = 20) => ({ voiced_frames: frames, longest_run_frames: run, f0_spread_raw: spread, hop_ms: 20 });
      const take = (id, slot, status, feat, heard, gem, extra = {}) => ({ id, participant_id: 1, slot_code: slot, take_no: 1, speech_status: status, ...feat, heard, gemini_text: gem ?? null, whisper_text: null, created_at: new Date(), ...extra });
      const takes = [
        take(1, 'k01-q', 'speech', f(40, 10), 'speech', '2 idli 1 bowl sambar'),
        take(2, 'k02-q', 'no_speech', f(9, 3), 'speech', '1 plate upma 1 cup coffee'),
        take(3, 'k04-q', 'no_speech', f(7, 2), 'speech', '3 chapati 1 katori dal curd'),
        take(4, 'x01-q', 'no_speech', f(0, 0, 0), 'no_speech', ''),
        take(5, 'x02-q', 'no_speech', f(7, 3, 9), 'no_speech', ''),
        take(6, 'x03-q', 'no_speech', f(0, 0, 0), 'speech', ''),            // a TV voice in a control: protocol deviation, kept visible
        take(7, 'k11-q', 'speech', f(30, 8), null, null),                    // unlabelled
        take(8, 'k13-q', 'speech', f(30, 8), 'uncertain', null),             // uncertain
        take(9, 'k06-q', 'speech', f(30, 8), 'speech', null, { superseded_at: new Date() }),   // a retake's earlier take
        take(10, 'k06-q', 'undecodable', {}, 'speech', null, { take_no: 2 }), // a capture failure
      ];
      const S = C.workbookSheets({ participants: P, takes });
      const A = S.find(s => s.name === 'Part A summary').rows, H = A[0];
      const get = (setting, slice, col) => A.find(x => x[0].startsWith(setting) && x[1] === slice)[H.indexOf(col)];
      ck('denominators: 9 current takes, 1 retake, 1 capture failure, 1 protocol deviation, 1 uncertain, 1 unlabelled, all shown',
        get('v200-r60', 'all', 'current takes') === 9 && get('v200-r60', 'all', 'retakes (superseded, not counted)') === 1 && get('v200-r60', 'all', 'capture failures (not checked)') === 1
        && get('v200-r60', 'all', 'protocol deviations (heard ≠ intended)') === 1 && get('v200-r60', 'all', 'uncertain labels') === 1 && get('v200-r60', 'all', 'unlabelled') === 1);
      ck('live: 4 speech takes, 2 missed; 2 no-speech, 0 accepted (absolute)', get('v200-r60', 'all', 'speech takes (listener)') === 4 && get('v200-r60', 'all', 'missed speech (refused)') === 2
        && get('v200-r60', 'all', 'no-speech takes (listener)') === 2 && get('v200-r60', 'all', 'accepted non-speech (absolute)') === 0);
      ck('v120-r40: 1 non-speech accepted (absolute and newly) → fails rule 1; recovers 2 of 2 missed but < 3 → fails rule 2', get('v120-r40', 'all', 'accepted non-speech (absolute)') === 1
        && /rule 1/.test(get('v120-r40', 'all', 'screening result (all slice; a proposal, never a release)')) && /rule 2: recovers 2 of 2/.test(get('v120-r40', 'all', 'screening result (all slice; a proposal, never a release)')));
      ck('per-volunteer slices are in every setting', A.filter(x => x[1] === 'volunteer P1').length === 6);
      ck('Part B: wrong numbers not yet confirmed by the listener are counted for a recheck', S.find(s => s.name === 'Part B summary').rows.slice(1).some(x => x[x.length - 1] > 0));
      const bad = C.workbookSheets({ participants: P, takes: [take(9, 'k01-n', 'speech', f(5, 2), 'speech', null)] });
      ck('a stored live result the replay does not reproduce is flagged as a MISMATCH in About', /1 MISMATCH/.test(JSON.stringify(bad[0].rows)));
      process.env.RAILWAY_GIT_BRANCH = 'test';
      await http('POST', '/api/voice-calibration/admin/invite', ADMIN, 'admin', { member_id: V[1], group: 'kn', profile_note: '30s, man' });
      await http('POST', '/api/voice-calibration/consent', V[1], 'patient', { phone_type: 'iphone', browser: 'safari' });
      await http('POST', '/api/voice-calibration/take', V[1], 'patient', { slot: 'x02-n', audio: silenceAudio, mimeType: 'audio/webm' });
      await http('POST', '/api/voice-calibration/admin/wording', ADMIN, 'admin', { lang: 'kn', confirmed_by: 'Fluent Kannada speaker' });
      await http('POST', '/api/voice-calibration/take', V[1], 'patient', { slot: 'k01-n', audio: speechAudio, mimeType: 'audio/webm' });
      r = await http('GET', '/api/voice-calibration/admin/export.xlsx', ADMIN, 'admin');
      const raw = r.data.toString('utf8');
      ck('a populated export from the routes names no one (codes only), holds no audio, and has the provenance', r.status === 200 && !NAMES.some(n => raw.includes(n) || raw.includes(n.split(' ')[0])) && raw.includes('P1') && raw.includes('k01-n')
        && raw.includes('gemini-2.5-flash-lite') && !raw.includes(speechAudio.slice(0, 200)));
    }
  } catch (e) { ck('the suite ran to the end', false, e.stack); }
  finally {
    for (const t of ['voice_calibration_preview_evals', 'voice_calibration_takes', 'voice_calibration_participants', 'voice_calibration_wording', 'voice_calibration_partc', 'voice_calibration_partc_armed', 'voice_fallback_test_account']) await pool.query(`DELETE FROM ${t}`).catch(() => {});
    await pool.query(`DELETE FROM daily_logs WHERE patient_id = ANY($1::int[])`, [[...V, TESTACC, OTHER]]).catch(() => {});
    server.close(); R2.server?.close?.(); await pool.end().catch(() => {});
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(`\nVoice calibration kit: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
