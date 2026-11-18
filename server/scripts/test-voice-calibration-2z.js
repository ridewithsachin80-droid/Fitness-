/**
 * scripts/test-voice-calibration-2z.js — Fixes-2z: the 2y calibration-kit review (24 Oct 2026), three findings, each with the
 * review's exact counterexample next to positive controls. REAL Postgres and the REAL routes for the route parts; STUBBED
 * providers (no real Gemini, Whisper or parser call).
 *
 *   [1] usable control coverage: a complete cohort whose 36 controls are all "unsure" or all contain speech never passes;
 *       excluded clips stay visible and an authorised replacement (budgeted apart) restores coverage; a valid full cohort
 *       still passes and a newly accepted valid control still fails rule 1;
 *   [2] every quantity mention: "2 idli and 2 idli and 1 bowl sambar" is never automatically all correct, a preview showing
 *       "2 idli and 3 idli" is never correct reviewable; single portions, count words and an agreed count-plus-weight pass;
 *   [3] derived export text: a registered name typed as a phone model is absent from EVERY sheet and the serialized workbook
 *       (About's phone mix and Part A's model slices included), with counts unchanged and the cells on the sharing checklist.
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
const stubbedPost = async (url) => {
  const u = String(url);
  if (u.startsWith('https://generativelanguage.googleapis.com/')) return { data: { candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }], modelVersion: 'stub-001' } };
  if (u === 'https://api.groq.com/openai/v1/audio/transcriptions') return { data: { text: '', language: 'english', segments: [] } };
  throw new Error('Unexpected external request blocked: ' + url);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const storage = require('../services/storage');
const { startR2 } = require('./lib/r2-standin');
const C = require('../services/voiceCalibration');
const X = require('../services/xlsxLite');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 500))); };
const FIX = path.join(__dirname, 'fixtures/voice');

// ── A complete synthetic cohort (pure: workbookSheets) — as in the 2y suite ──
const DEV = [
  { phone_type: 'android_budget', browser: 'chrome', device: { make: 'Redmi', model: '12C', os: 'android', os_version: '13', browser_version: '129' } },
  { phone_type: 'android_mid', browser: 'chrome', device: { make: 'Samsung', model: 'Galaxy A34', os: 'android', os_version: '14', browser_version: '130' } },
  { phone_type: 'iphone', browser: 'safari', device: { make: 'Apple', model: 'iPhone 13', os: 'ios', os_version: '17.6', browser_version: '17.6' } },
  { phone_type: 'android_budget', browser: 'chrome', device: { make: 'Realme', model: 'C55', os: 'android', os_version: '13', browser_version: '129' } },
  { phone_type: 'iphone', browser: 'safari', device: { make: 'Apple', model: 'iPhone 12', os: 'ios', os_version: '17.5', browser_version: '17.5' } },
  { phone_type: 'android_mid', browser: 'samsung', device: { make: 'Samsung', model: 'Galaxy M14', os: 'android', os_version: '14', browser_version: '25' } },
];
const refOf = (heard, speech) => ({ heard, spoken_as_script: speech && heard === 'speech' ? true : null, mode: speech && heard === 'speech' ? 'as_script' : null, items: null, text: null });
function cohort() {
  const groups = ['kn', 'kn', 'kn', 'hi', 'hi', 'en'];
  const participants = groups.map((grp, i) => ({ id: i + 1, code: `P${i + 1}`, grp, consented_at: new Date(), consent_version: C.CONSENT_VERSION, ...JSON.parse(JSON.stringify(DEV[i])) }));
  const takes = []; let id = 1;
  for (const p of participants) for (const s of C.slotPlan(p.grp)) {
    const speech = s.label === 'speech', r = refOf(speech ? 'speech' : 'no_speech', speech);
    takes.push({ id: id++, participant_id: p.id, slot_code: s.slot, take_no: 1, speech_status: speech ? 'speech' : 'no_speech', voiced_frames: speech ? 40 : 0, longest_run_frames: speech ? 12 : 0, f0_spread_raw: speech ? 22 : 0, hop_ms: 20,
      heard: r.heard, spoken_as_script: r.spoken_as_script, reference_mode: r.mode, reference_frozen_at: new Date(), reference_version: 1, reference_sha: C.referenceSha(r), remeasure: { match: true }, gemini_text: speech ? 'x' : '', whisper_text: speech ? 'x' : '', created_at: new Date() });
  }
  const missed = takes.filter(t => /^k01-|^k02-/.test(t.slot_code) && t.participant_id === 1).slice(0, 3);
  for (const t of missed) Object.assign(t, { speech_status: 'no_speech', voiced_frames: 9, longest_run_frames: 4 });
  const judgments = missed.flatMap(t => ['gemini', 'whisper'].map((e, k) => ({ id: `${t.id}-${e}`, take_id: t.id, engine: e, reference_sha: t.reference_sha, reference_version: 1, judge_version: C.JUDGE_VERSION, status: 'done', reason: 'initial',
    judgment: { result: k ? 'explicit refusal' : 'correct reviewable', problems: [], hand: [], items: [] }, parser_calls: 1, created_at: new Date() })));
  return { participants, takes, judgments };
}
const relabel = (t, heard) => { const r = refOf(heard, false); Object.assign(t, { heard, reference_sha: C.referenceSha(r) }); };
const screenOf = (data) => { const A = C.workbookSheets(data).find(s => s.name === 'Part A summary').rows; const H = A[0]; return A.find(r => r[0] === 'v160-r60' && r[1] === 'all')[H.indexOf('screening result (all slice; a proposal, never a release)')]; };
const controls = (d) => d.takes.filter(t => /^x0/.test(t.slot_code));

(async () => {
  // ── [1] Usable control coverage ────────────────────────────────────────────
  console.log('\n[1] rule 1 needs USABLE no-speech controls, in every volunteer × control × place');
  {
    const good = cohort();
    ck('positive control: a complete valid cohort still passes, and says all 36 controls are usable', /^passes the screen on 108 speech and 36 no-speech take\(s\), 36 of 36 controls usable/.test(screenOf(good)), screenOf(good));
    const unsure = cohort(); controls(unsure).forEach(t => relabel(t, 'uncertain'));
    const sU = screenOf(unsure);
    ck('review repro: all 36 controls marked "unsure" → NOT a pass on 0 no-speech takes: incomplete, 0 of 36 usable (36 unsure)', /^incomplete: no-speech controls: 0 of 36 usable .*36 unsure/.test(sU) && !/passes/.test(sU), sU);
    const speech = cohort(); controls(speech).forEach(t => relabel(t, 'speech'));
    const sS = screenOf(speech);
    ck('review repro: all 36 controls heard as containing speech → incomplete (36 speech); never counted as successful no-speech controls', /^incomplete: no-speech controls: 0 of 36 usable .*36 speech/.test(sS) && !/passes/.test(sS), sS);
    const A = C.workbookSheets(speech).find(s => s.name === 'Part A summary').rows, H = A[0];
    const live = A.find(r => r[0] === 'v200-r60 (live)' && r[1] === 'all');
    ck('…the exclusions stay visible: 36 protocol deviations, 0 no-speech takes counted', live[H.indexOf('protocol deviations (heard ≠ intended)')] === 36 && live[H.indexOf('no-speech takes (listener)')] === 0);
    const oneP = cohort(); controls(oneP).filter(t => t.participant_id === 6).forEach(t => relabel(t, 'uncertain'));
    ck('participant coverage: one volunteer\'s 6 controls unsure → incomplete (30 of 36), even with 30 usable elsewhere', /^incomplete: no-speech controls: 30 of 36 usable .*6 unsure/.test(screenOf(oneP)), screenOf(oneP));
    const cond = cohort(); controls(cond).filter(t => /-n$/.test(t.slot_code)).forEach(t => relabel(t, 'uncertain'));
    ck('condition coverage: every noisy-place control unsure → incomplete (18 of 36)', /^incomplete: no-speech controls: 18 of 36 usable/.test(screenOf(cond)), screenOf(cond));
    const unmeasured = cohort(); Object.assign(controls(unmeasured)[0], { speech_status: 'undecodable' });
    ck('a control the live check could not measure is not usable → incomplete (1 not measured)', /^incomplete: no-speech controls: 35 of 36 usable .*1 not measured/.test(screenOf(unmeasured)), screenOf(unmeasured));
    const unfrozen = cohort(); Object.assign(controls(unfrozen)[0], { reference_frozen_at: null });
    ck('a control whose label is not yet frozen is not usable, and is counted as such (35 of 36; 1 not labelled)', /no-speech controls: 35 of 36 usable .*1 not labelled/.test(screenOf(unfrozen)), screenOf(unfrozen));
    const ns = cohort(); Object.assign(ns.takes.find(t => t.slot_code === 'x02-n'), { voiced_frames: 9, longest_run_frames: 4, f0_spread_raw: 9 });
    ck('positive control: a newly accepted VALID control still fails rule 1 (full coverage)', /^fails screen: rule 1: 1 more non-speech accepted/.test(screenOf(ns)), screenOf(ns));
    // An authorised replacement: the excluded take is kept (superseded) and the new one supplies the coverage.
    const rep = cohort(); const bad = controls(rep).find(t => t.participant_id === 2 && t.slot_code === 'x02-q');
    relabel(bad, 'speech'); bad.replacement_authorised = { at: new Date(), by: 9, why: 'protocol deviation' };
    ck('one control with speech in it → incomplete (35 of 36)', /^incomplete: no-speech controls: 35 of 36 usable .*1 speech/.test(screenOf(rep)));
    bad.superseded_at = new Date();
    const r = refOf('no_speech', false);
    rep.takes.push({ ...bad, id: 999, take_no: 2, superseded_at: null, replacement_authorised: null, retake_reason: 'replacement', heard: 'no_speech', reference_sha: C.referenceSha(r) });
    const S = C.workbookSheets(rep);
    ck('…its authorised replacement restores coverage: passes again', /^passes the screen/.test(screenOf(rep)), screenOf(rep));
    const about = S[0].rows.find(x => x[0] === 'budget: authorised replacements (separate)')[1];
    const T = S.find(s => s.name === 'Takes').rows, TH = T[0];
    ck('…the excluded take stays visible (kept, superseded, "replacement authorised") and replacements are budgeted apart', /^1 of 12 asked for, 1 recorded/.test(about)
      && T.some(x => x[TH.indexOf('take id')] === bad.id && x[TH.indexOf('current')] === 'no' && /^yes/.test(x[TH.indexOf('replacement authorised')])) && T.some(x => x[TH.indexOf('take id')] === 999 && /replacement/.test(x[TH.indexOf('retake reason')])), about);
    const ctlSheet = S.find(s => s.name === 'Controls').rows, CH = ctlSheet[0];
    ck('the Controls sheet says which clips are usable for rule 1', ctlSheet.slice(1).filter(x => x[CH.indexOf('usable for rule 1')] === 'yes').length === 36);
  }

  // ── [2] Every quantity mention ─────────────────────────────────────────────
  console.log('\n[2] every quantity mention is judged; repeats and conflicts are never automatically correct');
  {
    const sc = (items, tx, lang = 'kn') => C.scoreTranscript(items, tx, lang, { allowedText: [C.LINES.k01.say, C.LINES.k01.means] });
    const k01 = C.LINES.k01.items;
    const rep = sc(k01, '2 idli and 2 idli and 1 bowl sambar');
    ck('review repro: "2 idli and 2 idli and 1 bowl sambar" against 2 idli + 1 bowl sambar → needs a hand check (said twice: one serving or two?), not all correct',
      rep.line === C.HAND_CHECK && rep.items[0].outcome === C.REPEATED && /said more than once/.test(rep.ambiguous.join()), rep);
    ck('…two different counts are conflicting ("uncertain/unscorable"), as before', sc(k01, '2 idli 3 idli ondu bowl sambar').line === 'uncertain/unscorable');
    ck('positive controls: a single portion, Kannada number words, and a count word are all correct', sc(k01, '2 idli 1 bowl sambar').line === 'all correct' && sc(k01, 'eradu idli mattu ondu bowl sambar').line === 'all correct'
      && C.scoreTranscript(C.LINES.se1.items, '2 pieces idli', 'en').line === 'all correct');
    ck('the 2y cases still hold: "2 kg idli" is a wrong unit, "… and banana" is extra', sc(k01, '2 kg idli 1 bowl sambar').line === 'wrong unit' && sc(k01, '2 idli 1 bowl sambar and banana').line === 'extra');
    // Count plus weight, deliberately: the weight must be in the listener's reference, never silently dropped.
    const withG = C.validReferenceItems([{ kind: 'count', n: 2, food: 'idli', grams: 100 }, { kind: 'count', n: 1, unit: 'bowl', food: 'sambar' }]).items;
    ck('agreed count-plus-weight: with the listener\'s reference "2 idli (100 g)", "2 idli, 100 grams, 1 bowl sambar" is all correct', sc(withG, '2 idli, 100 grams, 1 bowl sambar').line === 'all correct' && withG[0].label === '2 idli (100 g)');
    ck('…a different weight said ("150 grams") is a wrong number', sc(withG, '2 idli, 150 grams, 1 bowl sambar').line === 'wrong number');
    ck('…a weight given with the count but NOT in the reference is a hand check (was it said?), never dropped', sc(k01, '2 idli, 100 grams, 1 bowl sambar').line === C.HAND_CHECK && sc(k01, '2 idli 100 g idli 1 bowl sambar').line === C.HAND_CHECK);
    ck('…a weight after a joining word ("2 idli and 100 grams") is ambiguous: a hand check, not an extra and not a pass — even when it matches the reference weight',
      sc(k01, '2 idli and 100 grams and 1 bowl sambar').line === C.HAND_CHECK && sc(withG, '2 idli and 100 grams and 1 bowl sambar').line === C.HAND_CHECK && /after "2 idli"/.test(sc(withG, '2 idli and 100 grams and 1 bowl sambar').ambiguous.join()));
    ck('…a weight with its own food is still an extra', sc(k01, '2 idli 1 bowl sambar 100 grams rice').line === 'extra');
    ck('a weight can only go with a count (not with a food with no amount)', !!C.validReferenceItems([{ kind: 'presence', food: 'curd', grams: 100 }]).error && !!C.validReferenceItems([{ kind: 'count', n: 2, food: 'idli', grams: -5 }]).error);
    const P = (o) => ({ weight_kg: null, activities: [], acv: [], supplements: [], water_ml_add: null, sleep: null, foods: [], workouts: [], corrections: [], ...o });
    const sambar = { name: 'Sambar', qty_text: '1 bowl', grams: 200 };
    const jp = (items, idli) => C.judgePreview(items, P({ foods: [{ name: 'Idli', grams: 100, ...idli }, sambar], weight_kg: 82.5 }), 'en');
    const e01 = C.LINES.e01.items;
    const conf = jp(e01, { qty_text: '2 idli and 3 idli' });
    ck('review repro: an e01 preview with Idli "2 idli and 3 idli" → DISQUALIFYING (a surfaced 3), not correct reviewable', conf.result === 'disqualifying' && /2 idli and 3 idli/.test(conf.problems.join()), conf);
    const twice = jp(e01, { qty_text: '2 idli and 2 idli' });
    ck('…"2 idli and 2 idli" → needs a hand check (one serving or two?)', twice.result === 'needs a hand check' && /one serving or two/.test(twice.hand.join()), twice);
    ck('positive controls: "2 idli", "2 pieces", and the agreed "2 idli (100 g)" are correct reviewable', ['2 idli', '2 pieces', '2 idli (100 g)'].every(q => jp(e01, { qty_text: q }).result === 'correct reviewable'));
    ck('…with a weight in the reference, a preview showing another weight is a surfaced wrong amount', C.judgePreview([{ ...withG[0] }, ...e01.slice(1)], P({ foods: [{ name: 'Idli', qty_text: '2 idli (150 g)', grams: 150 }, sambar], weight_kg: 82.5 }), 'en').result === 'disqualifying'
      && C.judgePreview([{ ...withG[0] }, ...e01.slice(1)], P({ foods: [{ name: 'Idli', qty_text: '2 idli (100 g)', grams: 100 }, sambar], weight_kg: 82.5 }), 'en').result === 'correct reviewable');
    ck('the 2y preview cases still hold: "2 kg" disqualifies; curd\'s shown amount is a hand check', jp(e01, { qty_text: '2 kg' }).result === 'disqualifying'
      && C.judgePreview(C.LINES.k04.items, P({ foods: [{ name: 'Chapati', qty_text: '2 chapati' }, { name: 'Dal', qty_text: '1 katori' }, { name: 'Curd', qty_text: '1 bowl', grams: 150 }] }), 'kn').result === 'needs a hand check');
  }

  // ── [3] Derived export text, pure ─────────────────────────────────────────
  console.log('\n[3] derived export text: a registered name in a phone model never reaches the shared file');
  {
    const base = cohort(); base.participants[0].device.model = "ReviewerExample's phone"; base.takes.filter(t => t.participant_id === 1).forEach(t => { t.device = base.participants[0].device; });
    const plain = C.workbookSheets(base), clean = C.workbookSheets({ ...base, privateNames: ['ReviewerExample'] });
    ck('review repro (unscrubbed, to show it is real): the name appears in About\'s phone mix and in Part A\'s model slices', /reviewerexample/.test(plain[0].rows.find(r => r[0] === 'phone mix')[1]) && plain.find(s => s.name === 'Part A summary').rows.filter(r => /reviewerexample/.test(r[1])).length === 6);
    const leaks = clean.flatMap(sh => sh.rows.flatMap((r, i) => r.map((v, k) => [sh.name, i, k, v]))).filter(([, i, , v]) => i > 0 && /reviewerexample/i.test(String(v)));
    ck('…with the name registered: absent from EVERY cell of EVERY sheet (About and Part A included)', !leaks.length, leaks.slice(0, 4));
    const num = (S) => S.find(s => s.name === 'Part A summary').rows.slice(1).map(r => r.slice(2, -1).join('|'));
    ck('…the counts are unchanged (every Part A number identical with and without the name removed)', JSON.stringify(num(plain)) === JSON.stringify(num(clean)));
    ck('positive control: ordinary model labels survive ("phone model redmi 12c" is absent here, "samsung galaxy a34" present)', clean.find(s => s.name === 'Part A summary').rows.some(r => r[1] === 'phone model samsung galaxy a34'));
    const free = clean.find(s => s.name === 'Free text').rows;
    ck('the sharing checklist lists the derived cells (About phone mix, Part A model slices) with names removed counted', free.some(r => r[0] === 'About' && /phone mix/.test(r[1]) && r[3] === 1) && free.some(r => r[0] === 'Part A summary' && /phone model/.test(r[1]) && r[2] === 36 && r[3] === 6), free.filter(r => /built from/.test(r[1])));
    ck('…and the hand-check and replacement note columns', ['gemini hand check', 'whisper hand check', 'replacement authorised'].every(c => free.some(r => r[0] === 'Takes' && r[1] === c)));
    const { scrub } = C.nameScrubber(['R2', 'P1', 'Kiran Patil'], []);
    ck('permitted codes survive even if registered as "names" (R2, P1); a real name does not', scrub('R2 confirmed; P1 recorded; Kiran called').text === 'R2 confirmed; P1 recorded; [name removed] called');
  }

  // ── Routes: replacement flow and the serialized populated workbook ────────
  const KEYS = { id: 'AKIDTESTONLY0011', secret: 'calibration-2z-secret' };
  const R2 = await startR2(storage, KEYS);
  Object.assign(process.env, { R2_ACCOUNT_ID: 'local', R2_ACCESS_KEY_ID: KEYS.id, R2_SECRET_ACCESS_KEY: KEYS.secret, R2_BUCKET: 'fitlife-test', R2_ENDPOINT: R2.endpoint });
  const pool = require('../db/pool');
  const app = express(); app.use(express.json({ limit: '15mb' }));
  app.use('/api/voice-calibration', require('../routes/voiceCalibration'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`, tag = Date.now().toString(36);
  const TABLES = ['voice_calibration_preview_judgments', 'voice_calibration_preview_evals', 'voice_calibration_takes', 'voice_calibration_participants', 'voice_calibration_wording', 'voice_calibration_partc',
    'voice_calibration_partc_sessions', 'voice_calibration_partc_armed', 'voice_calibration_reviewers'];
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1))`);
  for (const t of TABLES) await pool.query(`DELETE FROM ${t}`);
  const mk = async (name, role = 'patient') => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, '5' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), role])).rows[0].id;
  const tok = (id, role) => jwt.sign({ id, role, name: 'x' }, process.env.JWT_SECRET, { expiresIn: 600 });
  const http = async (method, u, id, role, body) => {
    const r = await fetch(url + u, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok(id, role)}` }, body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const ADMIN = await mk(`Cal Admin ${tag}`, 'admin'), VOL = await mk(`Harini Subramanian ${tag}`);
  const A = (m, u, b) => http(m, u, ADMIN, 'admin', b);
  const silence = fs.readFileSync(path.join(FIX, fs.readdirSync(FIX).find(f => /silence|noise/i.test(f) && /\.webm$/.test(f)) || 'speech-en.webm')).toString('base64');
  process.env.RAILWAY_GIT_BRANCH = 'test';
  try {
    console.log('\n[1] routes: an authorised replacement of an excluded control');
    const listener = (await A('POST', '/api/voice-calibration/admin/reviewers', { name: 'ReviewerExample Listener', role: 'listener' })).data.code;
    await A('POST', '/api/voice-calibration/admin/invite', { member_id: VOL, group: 'en', profile_note: '30s' });
    await http('POST', '/api/voice-calibration/consent', VOL, 'patient', { phone_type: 'android_budget', browser: 'chrome', device: { make: 'Redmi', model: "ReviewerExample's phone", os: 'android', os_version: '13', browser_version: '129' } });
    let r = await http('POST', '/api/voice-calibration/take', VOL, 'patient', { slot: 'x02-n', audio: silence, mimeType: 'audio/webm' });
    const t1 = (await pool.query(`SELECT id FROM voice_calibration_takes WHERE slot_code='x02-n'`)).rows[0].id;
    const early = await A('POST', '/api/voice-calibration/admin/replacement', { take_id: t1 });
    ck('replacement before the reference is frozen is refused ("save the listener\'s reference first")', early.status === 409 && /Save the listener's reference first/.test(early.data.error || '') && r.status === 200, early.data);
    await A('POST', '/api/voice-calibration/admin/reference', { take_id: t1, listener_code: listener, heard: 'no_speech' });
    ck('…a USABLE control cannot be "replaced" (it is fine as it is)', /usable as it is/.test((await A('POST', '/api/voice-calibration/admin/replacement', { take_id: t1 })).data.error || ''));
    ck('…the volunteer cannot choose "replacement" unless the administrator asked', (await http('POST', '/api/voice-calibration/take', VOL, 'patient', { slot: 'x02-n', audio: silence, mimeType: 'audio/webm', retake_reason: 'replacement' })).status === 409);
    await A('POST', '/api/voice-calibration/admin/reference', { take_id: t1, listener_code: listener, heard: 'speech', text: 'TV voice in the background' });
    r = await A('POST', '/api/voice-calibration/admin/replacement', { take_id: t1 });
    let me = (await http('GET', '/api/voice-calibration/me', VOL, 'patient')).data;
    ck('a control with speech heard in it (protocol deviation): replacement asked for; the volunteer\'s list says so', r.status === 200 && r.data.why === 'protocol deviation' && me.slots.find(s => s.slot === 'x02-n').replacement_requested === true, r.data);
    r = await http('POST', '/api/voice-calibration/take', VOL, 'patient', { slot: 'x02-n', audio: silence, mimeType: 'audio/webm', retake_reason: 'replacement' });
    const hist = (await pool.query(`SELECT id, take_no, superseded_at, retake_reason, replacement_authorised FROM voice_calibration_takes WHERE slot_code='x02-n' ORDER BY take_no`)).rows;
    me = (await http('GET', '/api/voice-calibration/me', VOL, 'patient')).data;
    ck('…the replacement is recorded; the excluded take is KEPT (superseded, its authorisation recorded); the request clears', r.status === 200 && hist.length === 2 && hist[0].superseded_at && hist[0].replacement_authorised && hist[1].retake_reason === 'replacement'
      && !me.slots.find(s => s.slot === 'x02-n').replacement_requested, hist);
    // Rule 1 cannot be gamed: a control the live check ACCEPTED, labelled "no speech", is usable evidence (an extra accept), never replaceable.
    await http('POST', '/api/voice-calibration/take', VOL, 'patient', { slot: 'x01-n', audio: silence, mimeType: 'audio/webm' });
    const acc = (await pool.query(`UPDATE voice_calibration_takes SET voiced_frames = 40, longest_run_frames = 12, f0_spread_raw = 30, speech_status = 'speech' WHERE slot_code='x01-n' RETURNING id`)).rows[0].id;
    await A('POST', '/api/voice-calibration/admin/reference', { take_id: acc, listener_code: listener, heard: 'no_speech' });
    r = await A('POST', '/api/voice-calibration/admin/replacement', { take_id: acc });
    ck('a control the live check ACCEPTED (labelled no speech) cannot be replaced: it is rule 1 evidence, kept as it is', r.status === 409 && /usable as it is/.test(r.data.error || ''), r.data);
    // The budget agreed before collection: 12 authorised replacements for the round, then a stop.
    const { rows: [base] } = await pool.query(`SELECT COUNT(*)::int AS n FROM voice_calibration_takes WHERE replacement_authorised IS NOT NULL`);
    const pid = (await pool.query(`SELECT participant_id FROM voice_calibration_takes LIMIT 1`)).rows[0].participant_id;
    for (let i = base.n; i < C.REPLACEMENT_BUDGET; i++) await pool.query(`INSERT INTO voice_calibration_takes (participant_id, slot_code, take_no, replacement_authorised) VALUES ($1, $2, 1, '{"why":"seeded"}')`, [pid, `seed-${i}`]);
    await A('POST', '/api/voice-calibration/admin/reference', { take_id: acc, listener_code: listener, heard: 'uncertain' });
    r = await A('POST', '/api/voice-calibration/admin/replacement', { take_id: acc });
    ck(`the replacement budget (${C.REPLACEMENT_BUDGET} for the round) is enforced: the 13th is refused with "stop and review"`, C.REPLACEMENT_BUDGET === 12 && r.status === 409 && /budget \(12 for the round\) is used up/.test(r.data.error || '') && r.data.used === 12, r.data);
    await pool.query(`DELETE FROM voice_calibration_takes WHERE slot_code LIKE 'seed-%'`);
    r = await A('POST', '/api/voice-calibration/admin/replacement', { take_id: acc });
    ck('…below the budget, the same unsure control can be replaced, and the answer says how much of the budget is used', r.status === 200 && r.data.used === 2 && r.data.budget === 12 && r.data.why === 'uncertain', r.data);
    // The serialized populated workbook from the route.
    console.log('\n[3] routes: the serialized populated workbook');
    await http('POST', '/api/voice-calibration/take', VOL, 'patient', { slot: 'x01-q', audio: silence, mimeType: 'audio/webm' });
    r = await A('GET', '/api/voice-calibration/admin/export.xlsx');
    const files = X.unzipStored(r.data);
    const raw = Object.values(files).map(String).join('\n');
    ck('review repro: the registered name typed into a phone model is absent from the WHOLE serialized workbook (every part, any case)', r.status === 200 && !/reviewerexample/i.test(raw) && !/Harini|Subramanian/i.test(raw), (raw.match(/.{0,40}reviewerexample.{0,40}/i) || [''])[0]);
    ck('…the phone-mix summary and the model slices are still there, with the name removed', /phone model redmi \[name removed\]'s phone/.test(raw) && /redmi \[name removed\]'s phone/.test(raw));
    ck('…and the excluded control and its replacement are both in the workbook', /protocol deviation/.test(raw) && /replacement/.test(raw));
  } catch (e) { ck('the suite ran to the end', false, e.stack); }
  finally {
    for (const t of TABLES) await pool.query(`DELETE FROM ${t}`).catch(() => {});
    server.close(); R2.server?.close?.(); await pool.end().catch(() => {});
  }
  console.log(`\nVoice calibration 2z review fixes: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
