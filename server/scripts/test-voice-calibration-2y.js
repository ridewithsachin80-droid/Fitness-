/**
 * scripts/test-voice-calibration-2y.js — Fixes-2y: the 2x calibration-kit review (24 Oct 2026), finding by finding,
 * on REAL Postgres through the REAL routes, with STUBBED providers (no real Gemini, Whisper or parser model call).
 * Every counterexample the review reproduced must now fail safely, next to a positive control that still passes.
 *
 *   [1] screening passes only on completed, valid evidence with full coverage (errors, hand checks, missing/unresolved,
 *       no controls, replay mismatches, stale or unfrozen references, phone mix) — and passes when everything is in;
 *   [2] the judges: "2 kg idli", "… and banana", an unnumbered extra, unexplained words, curd's unspoken amount,
 *       a refusal flag WITH saveable content, every health field;
 *   [3] references: recorded before transcripts are shown, frozen, versioned; complete corrected items or unscorable;
 *       a changed reference makes the old judgment stale (kept), re-evaluation counted apart; concurrent taps evaluate once;
 *   [5] Part C sessions: Finish never loses Restore; no success while the day differs or the switch is on; expired
 *       sessions recoverable; repeats keep every baseline; only the session's account and date are restored; the app's
 *       session key decides what counts;
 *   [6] the phone's make, model and versions per take; reviewer codes, never names; complete anonymous export with
 *       history; registered names removed from free text.
 *   (Finding 4, the app's controlled mode, is tested in the browser module suite test-calibration-mode.mjs.)
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
const base = () => ({ weight_kg: null, activities: [], acv: [], supplements: [], water_ml_add: null, sleep: null, foods: [], workouts: [], corrections: [], reply: 'Got it.' });
let nChat = 0, chatDelay = 0;
const stub = {
  gemini: (model) => ({ data: { candidates: [{ content: { parts: [{ text: 'Belagge 2 idli mattu 1 bowl sambar' }] }, finishReason: 'STOP' }], modelVersion: `${model}-001`, responseId: 'r1' } }),
  chat: () => ({ ...base(), foods: [{ name: 'Idli', qty_text: '2 idli', grams: 100, meal: 'Breakfast', per_100g: per }, { name: 'Sambar', qty_text: '1 bowl', grams: 200, meal: 'Breakfast', per_100g: per }] }),
  whisper: () => ({ data: { text: 'eradu idli ondu bowl sambar', language: 'kannada', segments: [{ start: 0, end: 3, text: 'x', avg_logprob: -0.2, no_speech_prob: 0.05, compression_ratio: 1.1 }] } }),
};
const stubbedPost = async (url, body) => {
  const u = String(url);
  if (u.startsWith('https://generativelanguage.googleapis.com/')) return stub.gemini(u.match(/models\/([^:]+):/)[1]);
  if (u === 'https://api.groq.com/openai/v1/chat/completions') { nChat++; if (chatDelay) await new Promise(r => setTimeout(r, chatDelay)); return { data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(stub.chat(body)) } }] } }; }
  if (u === 'https://api.groq.com/openai/v1/audio/transcriptions') return stub.whisper();
  throw new Error('Unexpected external request blocked: ' + url);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const storage = require('../services/storage');
const { startR2 } = require('./lib/r2-standin');
const C = require('../services/voiceCalibration');
const SP = require('../services/speechPresence');
const X = require('../services/xlsxLite');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 500))); };
const FIX = path.join(__dirname, 'fixtures/voice');
const b64 = (f) => fs.readFileSync(f).toString('base64');

// ── A synthetic, COMPLETE cohort for the screen (pure: workbookSheets) ────────
const DEV = [
  { phone_type: 'android_budget', browser: 'chrome', device: { make: 'Redmi', model: '12C', os: 'android', os_version: '13', browser_version: '129' } },
  { phone_type: 'android_mid', browser: 'chrome', device: { make: 'Samsung', model: 'Galaxy A34', os: 'android', os_version: '14', browser_version: '130' } },
  { phone_type: 'iphone', browser: 'safari', device: { make: 'Apple', model: 'iPhone 13', os: 'ios', os_version: '17.6', browser_version: '17.6' } },
  { phone_type: 'android_budget', browser: 'chrome', device: { make: 'Realme', model: 'C55', os: 'android', os_version: '13', browser_version: '129' } },
  { phone_type: 'iphone', browser: 'safari', device: { make: 'Apple', model: 'iPhone 12', os: 'ios', os_version: '17.5', browser_version: '17.5' } },
  { phone_type: 'android_mid', browser: 'samsung', device: { make: 'Samsung', model: 'Galaxy M14', os: 'android', os_version: '14', browser_version: '25' } },
];
function cohort() {
  const groups = ['kn', 'kn', 'kn', 'hi', 'hi', 'en'];
  const participants = groups.map((grp, i) => ({ id: i + 1, code: `P${i + 1}`, grp, consented_at: new Date(), consent_version: C.CONSENT_VERSION, ...DEV[i] }));
  const takes = []; let id = 1;
  for (const p of participants) for (const s of C.slotPlan(p.grp)) {
    const speech = s.label === 'speech';
    const ref = { heard: speech ? 'speech' : 'no_speech', spoken_as_script: speech ? true : null, mode: speech ? 'as_script' : null, items: null, text: null };
    const t = { id: id++, participant_id: p.id, slot_code: s.slot, take_no: 1, speech_status: speech ? 'speech' : 'no_speech', voiced_frames: speech ? 40 : 0, longest_run_frames: speech ? 12 : 0, f0_spread_raw: speech ? 22 : 0, hop_ms: 20,
      heard: ref.heard, spoken_as_script: ref.spoken_as_script, reference_mode: ref.mode, reference_frozen_at: new Date(), reference_version: 1, reference_sha: C.referenceSha(ref),
      remeasure: { match: true }, gemini_text: speech ? 'x' : '', whisper_text: speech ? 'x' : '', created_at: new Date() };
    takes.push(t);
  }
  // Three speech takes the live check refused (180 ms voiced) and v160-r60 would accept: the only live misses.
  const missed = takes.filter(t => /^k01-|^k02-/.test(t.slot_code) && t.participant_id === 1).slice(0, 3);
  for (const t of missed) Object.assign(t, { speech_status: 'no_speech', voiced_frames: 9, longest_run_frames: 4 });
  return { participants, takes, missed };
}
const J = (t, engine, result, extra = {}) => ({ id: `${t.id}-${engine}`, take_id: t.id, engine, reference_sha: t.reference_sha, reference_version: t.reference_version, judge_version: C.JUDGE_VERSION, status: 'done',
  reason: 'initial', stage: 'parsed', judgment: { result, problems: [], hand: [], items: [] }, parser_calls: 1, created_at: new Date(), ...extra });
const screenOf = (data) => { const A = C.workbookSheets(data).find(s => s.name === 'Part A summary').rows; const H = A[0]; return A.find(r => r[0] === 'v160-r60' && r[1] === 'all')[H.indexOf('screening result (all slice; a proposal, never a release)')]; };

(async () => {
  // ── [1] Screening needs completed, valid evidence and full coverage ────────
  console.log('\n[1] the screen passes only on completed, valid evidence with full coverage');
  {
    const legs = (r1, r2) => { const c = cohort(); return { ...c, judgments: c.missed.flatMap(t => [J(t, 'gemini', r1), J(t, 'whisper', r2)]) }; };
    const good = legs('correct reviewable', 'explicit refusal');
    const sGood = screenOf(good);
    ck('positive control: full cohort (6, 144 slots, 36 controls), frozen references, re-measured, phone mix met, 3 of 3 misses recovered, both legs valid → passes (a proposal only)',
      /^passes the screen on 108 speech and 36 no-speech/.test(sGood) && /proposal for review only/.test(sGood), sGood);
    const sErr = screenOf(legs('provider error', 'provider error'));
    ck('review repro: both legs "provider error" on all three takes → NOT a pass: incomplete (errors are not evidence)', /^incomplete: rule 3: 3 newly admitted take\(s\) without a completed valid judgment \(3 provider\/parser error\)/.test(sErr) && !/passes/.test(sErr), sErr);
    const sHand = screenOf(legs('needs a hand check', 'needs a hand check'));
    ck('review repro: "needs a hand check" on every leg → incomplete (hand check outstanding), never a pass', /^incomplete: .*hand check outstanding/.test(sHand) && !/passes/.test(sHand), sHand);
    const sMiss = screenOf(legs('missing/unresolved (visible)', 'explicit refusal'));
    ck('review repro: "missing/unresolved (visible)" → the agreed rule applied explicitly: FAILS (needs a correct reviewable preview or an explicit refusal on both legs)',
      /^fails screen: rule 3: 3 newly admitted take\(s\) with missing or unresolved items/.test(sMiss), sMiss);
    const noCtl = legs('correct reviewable', 'explicit refusal'); noCtl.takes = noCtl.takes.filter(t => !/^x0/.test(t.slot_code));
    const sNoCtl = screenOf(noCtl);
    ck('review repro: ZERO recorded no-speech controls → incomplete (recordings 108 of 144; controls 0 of 36), never a pass', /^incomplete: recordings: 108 of 144 planned slots; no-speech controls: 0 of 36/.test(sNoCtl), sNoCtl);
    const hand = legs('needs a hand check', 'explicit refusal');
    for (const j of hand.judgments.filter(x => x.engine === 'gemini')) j.hand_verdict = { verdict: 'correct reviewable', by: 9, at: new Date() };
    ck('…a recorded hand verdict settles the hand check: passes', /^passes the screen/.test(screenOf(hand)), screenOf(hand));
    const handBad = legs('needs a hand check', 'explicit refusal');
    handBad.judgments[0].hand_verdict = { verdict: 'disqualifying', by: 9, at: new Date() };
    ck('…and a hand verdict of "disqualifying" fails the candidate', /^fails screen: rule 3: 1 newly admitted take\(s\) disqualified/.test(screenOf(handBad)), screenOf(handBad));
    const stale = legs('correct reviewable', 'explicit refusal'); stale.missed[0].reference_sha = 'f'.repeat(64);
    ck('a judgment made under an earlier reference version is STALE: incomplete until re-evaluated', /incomplete: .*1 stale/.test(screenOf(stale)), screenOf(stale));
    const oldJudge = legs('correct reviewable', 'explicit refusal'); oldJudge.judgments.forEach(j => { j.judge_version = 'judge-2x'; });
    ck('…so is one made under an earlier judge version', /incomplete: .*stale/.test(screenOf(oldJudge)));
    const unfrozen = legs('correct reviewable', 'explicit refusal'); unfrozen.takes[50].reference_frozen_at = null;
    ck('one take without a frozen listener reference → incomplete', /incomplete: listener reference: 1 take\(s\) not yet frozen/.test(screenOf(unfrozen)), screenOf(unfrozen));
    const noRem = legs('correct reviewable', 'explicit refusal'); noRem.takes[7].remeasure = null;
    ck('one take not yet measured again → incomplete', /incomplete: re-measure: 1 take\(s\) not yet measured again/.test(screenOf(noRem)), screenOf(noRem));
    const mism = legs('correct reviewable', 'explicit refusal'); mism.takes[10].voiced_frames = 5;   // stored "speech" that the replay refuses
    ck('a replay mismatch BLOCKS the screen (fails; the offline settings cannot be trusted)', /^fails screen: 1 replay mismatch/.test(screenOf(mism)), screenOf(mism));
    const mix = legs('correct reviewable', 'explicit refusal'); mix.participants.forEach(p => { p.phone_type = 'android_mid'; p.device = { ...p.device, make: 'Samsung', model: 'Galaxy A34' }; });
    ck('the phone mix (3 models, a budget Android, an iPhone, Chrome on Android) unmet → incomplete', /incomplete: phone mix: 1 different phone model\(s\) recorded \(3 needed\), no budget Android, no iPhone/.test(screenOf(mix)), screenOf(mix));
    const five = legs('correct reviewable', 'explicit refusal'); five.participants[5].withdrawn_at = new Date();
    ck('a partial cohort (5 of 6) → incomplete', /incomplete: cohort: 5 of 6 volunteers; recordings: 128 of 144/.test(screenOf(five)), screenOf(five));
    const one = legs('correct reviewable', 'explicit refusal'); one.judgments = one.judgments.filter(j => !(j.take_id === one.missed[0].id && j.engine === 'whisper'));
    ck('one leg never judged → incomplete', /incomplete: rule 3: 1 newly admitted take\(s\) without a completed valid judgment \(1 not judged\)/.test(screenOf(one)), screenOf(one));
    const running = legs('correct reviewable', 'explicit refusal'); running.judgments[0].status = 'running';
    ck('a judgment still running → incomplete', /evaluation running/.test(screenOf(running)), screenOf(running));
    const ns = legs('correct reviewable', 'explicit refusal'); const ctl = ns.takes.find(t => t.slot_code === 'x02-n'); Object.assign(ctl, { voiced_frames: 9, longest_run_frames: 4, f0_spread_raw: 9 });
    ck('with full coverage, one more non-speech accepted still fails rule 1', /^fails screen: rule 1: 1 more non-speech accepted/.test(screenOf(ns)), screenOf(ns));
    const A = C.workbookSheets(good).find(s => s.name === 'Part A summary').rows, H = A[0];
    const row = A.find(r => r[0] === 'v160-r60' && r[1] === 'all');
    ck('Part A shows the rule 3 counts separately: judged 3, disqualified 0, failing the agreed rule 0, incomplete 0, labels not frozen 0',
      row[H.indexOf('rule 3: newly accepted takes with both legs judged')] === 3 && row[H.indexOf('rule 3: takes failing the agreed rule (missing or unresolved items)')] === 0
      && row[H.indexOf('rule 3: incomplete (errors, hand checks, stale or unfrozen)')] === 0 && row[H.indexOf('labels not yet frozen')] === 0);
    const about = JSON.stringify(C.workbookSheets(sErr ? legs('provider error', 'provider error') : good)[0].rows);
    ck('About states the screening coverage', /screening coverage/.test(about) && /"complete"/.test(JSON.stringify(C.workbookSheets(good)[0].rows)));
  }

  // ── [2] The judges ─────────────────────────────────────────────────────────
  console.log('\n[2] the transcript and preview judges catch every material error');
  {
    const sc = (id, tx, o = {}) => C.scoreTranscript(C.LINES[id].items, tx, C.LINES[id].lang, { allowedText: [C.LINES[id].say, C.LINES[id].means], ...o });
    ck('review repro: "2 kg idli 1 bowl sambar" for 2 idli + 1 bowl sambar → wrong unit (kg is not a count of idli)', sc('k01', '2 kg idli 1 bowl sambar').line === 'wrong unit' && sc('k01', '2 kg idli 1 bowl sambar').items[0].outcome === 'wrong unit');
    ck('review repro: "2 idli 1 bowl sambar and banana" → extra (a food with no number is still an extra)', sc('k01', '2 idli 1 bowl sambar and banana').line === 'extra' && sc('k01', '2 idli 1 bowl sambar and banana').extra.includes('banana'));
    ck('…a count word is neutral: "2 pieces idli" is 2 idli', sc('se1', '2 pieces idli').line === 'all correct');
    ck('a word nobody can explain → "needs a hand check" (never all correct); a stray number too', sc('k01', 'eradu idli ondu bowl sambar zebra').line === C.HAND_CHECK && sc('k01', 'eradu idli ondu bowl sambar 7').line === C.HAND_CHECK
      && sc('k01', 'eradu idli ondu bowl sambar zebra').unexplained.includes('zebra'));
    ck('…but the hand check is a pending state, not a tenth outcome: the nine outcomes are unchanged', C.LINE_OUTCOMES.length === 9 && !C.LINE_OUTCOMES.includes(C.HAND_CHECK));
    ck('positive controls: the script, its Kannada script, an English translation, Hindi in Devanagari, k13\'s sets and e03\'s minutes are all correct',
      ['Belagge eradu idli mattu ondu bowl sambar thinde', 'ಬೆಳಗ್ಗೆ ಎರಡು ಇಡ್ಲಿ ಮತ್ತು ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್ ತಿಂದೆ', 'This morning I ate two idlis and a bowl of sambar'].every(tx => sc('k01', tx).line === 'all correct')
      && sc('h01', 'दो रोटी और एक कटोरी दाल खाया').line === 'all correct' && sc('k13', 'Gym-alli squat mooru set, hattu reps maadide').line === 'all correct' && sc('e03', 'Walked 40 minutes and drank 2 litres of water').line === 'all correct');
    ck('"minutes" is never taken for a food (no loose prefix match to "meenu")', C.foodKeysOf('minutes').length === 0 && C.foodKeysOf(C.tokens('meenu')[0]).join() === 'fish');
    const P = (o) => ({ ...base(), ...o });
    const idli = { name: 'Idli', qty_text: '2 idli', grams: 100 }, sambar = { name: 'Sambar', qty_text: '1 bowl', grams: 200 };
    const jp = (id, pv) => C.judgePreview(C.LINES[id].items, P(pv), C.LINES[id].lang);
    ck('review repro: an e01 preview with Idli "2 kg", 1 bowl sambar and 82.5 kg → DISQUALIFYING (wrong food unit)', jp('e01', { foods: [{ ...idli, qty_text: '2 kg' }, sambar], weight_kg: 82.5 }).result === 'disqualifying');
    const curd = jp('k04', { foods: [{ name: 'Chapati', qty_text: '2 chapati' }, { name: 'Dal', qty_text: '1 katori' }, { name: 'Curd', qty_text: '1 bowl', grams: 150 }] });
    ck('review repro: k04 with curd "1 bowl", 150 g and no estimate label → needs a hand check (an outstanding check, not "correct reviewable")', curd.result === 'needs a hand check' && /no amount was spoken/.test(curd.hand.join()), curd);
    ck('…curd asked about (shown as unresolved) is a correct, reviewable preview', jp('k04', { foods: [{ name: 'Chapati', qty_text: '2 chapati' }, { name: 'Dal', qty_text: '1 katori' }], unresolved_foods: [{ name: 'Curd' }] }).result === 'correct reviewable');
    const mixed = jp('e01', { question: true, foods: [{ ...idli, qty_text: '3 idli' }, sambar], weight_kg: 82.5 });
    ck('review repro: question: true WITH a wrong-number food card → inspected and DISQUALIFYING, not a refusal', mixed.result === 'disqualifying' && /question or safety flag came WITH saveable content/.test(mixed.hand.join()), mixed);
    ck('…a pure question with nothing saveable is still an explicit refusal; so is a safety reply', jp('e01', { question: true }).result === 'explicit refusal' && jp('e01', { safety: 'medical', reply: 'Please see a doctor' }).result === 'explicit refusal');
    const ok = { foods: [idli, sambar], weight_kg: 82.5 };
    const fields = { water_ml_add: 500, sleep: { bedtime: '23:00', waketime: '06:00', quality: 3 }, activities: [{ id: 1 }], acv: [{ id: 2 }], supplements: [{ id: 3 }], workouts: [{ name: 'Walk' }], corrections: [{ name: 'Rice', grams: 100 }] };
    const bad = Object.entries(fields).filter(([k, v]) => jp('e01', { ...ok, [k]: v }).result !== 'disqualifying').map(([k]) => k);
    ck('every saveable health field, unspoken, disqualifies: water, sleep, activities, ACV, supplements, workouts, corrections', !bad.length, bad);
    ck('a note that would be saved, a draft edit, or an unrecognised field → needs a hand check', jp('e01', { ...ok, notes: 'felt good' }).result === C.PREVIEW_RESULTS[3] && jp('e01', { ...ok, draft_edit: { x: 1 } }).result === 'needs a hand check'
      && jp('e01', { ...ok, mystery: [1] }).result === 'needs a hand check');
    ck('positive control: the correct e01 preview is correct reviewable', jp('e01', ok).result === 'correct reviewable');
  }

  // ── Database, storage, the app ──────────────────────────────────────────────
  const KEYS = { id: 'AKIDTESTONLY0010', secret: 'calibration-2y-secret' };
  const R2 = await startR2(storage, KEYS);
  Object.assign(process.env, { R2_ACCOUNT_ID: 'local', R2_ACCESS_KEY_ID: KEYS.id, R2_SECRET_ACCESS_KEY: KEYS.secret, R2_BUCKET: 'fitlife-test', R2_ENDPOINT: R2.endpoint });
  const pool = require('../db/pool');
  const app = express(); app.use(express.json({ limit: '15mb' }));
  app.use('/api/ai-chat', require('../routes/aiChat'));
  app.use('/api/voice-calibration', require('../routes/voiceCalibration'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const tag = Date.now().toString(36);
  const TABLES = ['voice_calibration_preview_judgments', 'voice_calibration_preview_evals', 'voice_calibration_takes', 'voice_calibration_participants', 'voice_calibration_wording', 'voice_calibration_partc',
    'voice_calibration_partc_sessions', 'voice_calibration_partc_armed', 'voice_calibration_reviewers', 'voice_fallback_test_account'];
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1))`);
  for (const t of TABLES) await pool.query(`DELETE FROM ${t}`);
  const mk = async (name, role = 'patient') => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, '6' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), role])).rows[0].id;
  const tok = (id, role) => jwt.sign({ id, role, name: 'x' }, process.env.JWT_SECRET, { expiresIn: 600 });
  const http = async (method, u, id, role, body) => {
    const r = await fetch(url + u, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok(id, role)}` }, body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const ADMIN = await mk(`Cal Admin ${tag}`, 'admin');
  const NAMES = ['Lakshmi Prasad', 'Farhan Qureshi', 'Divya Ramesh'];
  const V = []; for (const n of NAMES) V.push(await mk(`${n} ${tag}`));
  const TESTACC = await mk(`Part C Account ${tag}`), OTHER = await mk(`Other Account ${tag}`);
  const speechAudio = b64(path.join(FIX, 'speech-kn.webm'));
  const A = (m, u, b) => http(m, u, ADMIN, 'admin', b);
  process.env.RAILWAY_GIT_BRANCH = 'test';

  try {
    // ── [6a] Devices and reviewer codes (setup for [3]) ───────────────────────
    console.log('\n[6] the phone itself per take; reviewer codes, never names');
    const listener = (await A('POST', '/api/voice-calibration/admin/reviewers', { name: 'Shalini Murthy', role: 'listener', langs: 'kn' })).data.code;
    const speaker = (await A('POST', '/api/voice-calibration/admin/reviewers', { name: 'Venkatesh Iyer', role: 'fluent speaker', langs: 'kn' })).data.code;
    ck('reviewers get codes R1, R2 (names stay in the private register)', listener === 'R1' && speaker === 'R2');
    let r = await A('POST', '/api/voice-calibration/admin/wording', { lang: 'kn', confirmed_by: 'Venkatesh Iyer' });
    ck('review repro: a wording check given a NAME is refused (codes only)', r.status === 400 && /reviewer code/.test(r.data.error), r.data);
    ck('…a listener-only code cannot confirm wording', (await A('POST', '/api/voice-calibration/admin/wording', { lang: 'kn', reviewer_code: listener })).status === 400);
    ck('…a check prepared against an older script hash is refused', (await A('POST', '/api/voice-calibration/admin/wording', { lang: 'kn', reviewer_code: speaker, script_sha256: 'a'.repeat(64) })).status === 409);
    r = await A('POST', '/api/voice-calibration/admin/wording', { lang: 'kn', reviewer_code: speaker, script_sha256: C.scriptSha('kn') });
    ck('…the fluent speaker\'s code against the CURRENT script hash is recorded', r.status === 200 && r.data.sha === C.scriptSha('kn'));
    await A('POST', '/api/voice-calibration/admin/invite', { member_id: V[0], group: 'kn', profile_note: '30s, woman' });
    r = await http('POST', '/api/voice-calibration/consent', V[0], 'patient', { phone_type: 'android_budget', browser: 'chrome' });
    ck('agreeing without the phone\'s make, model and versions is refused', r.status === 400 && r.data.needs_device === true, r.data);
    r = await http('POST', '/api/voice-calibration/consent', V[0], 'patient', { phone_type: 'android_budget', browser: 'chrome', device: { make: 'Redmi', model: '12C', os: 'android', os_version: "I don't know", browser_version: 'unknown' } });
    const p0 = (await pool.query(`SELECT * FROM voice_calibration_participants WHERE patient_id=$1`, [V[0]])).rows[0];
    ck('…"I don\'t know" is an explicit answer, stored as "unknown"', r.status === 200 && p0.device.make === 'Redmi' && p0.device.os_version === 'unknown' && p0.device.browser_version === 'unknown' && p0.device.browser === 'chrome', p0.device);
    await http('POST', '/api/voice-calibration/take', V[0], 'patient', { slot: 'k01-q', audio: speechAudio, mimeType: 'audio/webm' });
    await http('POST', '/api/voice-calibration/consent', V[0], 'patient', { phone_type: 'android_mid', browser: 'chrome', device: { make: 'Samsung', model: 'Galaxy A34', os: 'android', os_version: '14', browser_version: '130' } });
    await http('POST', '/api/voice-calibration/take', V[0], 'patient', { slot: 'k02-q', audio: speechAudio, mimeType: 'audio/webm' });
    const tk = (await pool.query(`SELECT slot_code, device, phone_type FROM voice_calibration_takes ORDER BY id`)).rows;
    ck('each take keeps the device it was recorded on (a phone change later does not rewrite earlier takes)', tk[0].device.model === '12C' && tk[1].device.model === 'Galaxy A34' && tk[0].phone_type === 'android_budget', tk);

    // ── [3] References ────────────────────────────────────────────────────────
    console.log('\n[3] the listener\'s reference: before the transcripts, frozen, versioned');
    const take1 = (await pool.query(`SELECT * FROM voice_calibration_takes WHERE slot_code='k01-q'`)).rows[0];
    let list = (await A('GET', '/api/voice-calibration/admin/takes')).data.takes;
    let v1 = list.find(t => t.id === take1.id);
    ck('review repro: before the reference is frozen the admin card shows NO transcript, engine verdict or detector verdict (only the audio and the line)',
      v1.revealed === false && !('gemini' in v1) && !('whisper' in v1) && !('live_decision' in v1) && !('voiced_ms' in v1) && !('whisper_review' in v1) && !('scores' in v1) && /X-Amz-Signature/.test(v1.audio_url || ''), Object.keys(v1));
    const S0 = C.workbookSheets({ participants: [p0], takes: (await pool.query(`SELECT * FROM voice_calibration_takes`)).rows });
    const B0 = S0.find(s => s.name === 'Part B summary').rows, BH = B0[0];
    const bk = B0.find(x => x[0] === 'gemini' && x[1] === 'Kannada, quiet');
    ck('review repro: an unlabelled, unfrozen take contributes NOTHING to Part B outcomes ("all correct" 0); it is shown as awaiting the reference',
      bk[BH.indexOf('all correct')] === 0 && bk[BH.indexOf('lines')] === 0 && bk[BH.indexOf("awaiting the listener's reference (not counted)")] === 2, bk);
    ck('…and the Items sheet marks its rows provisional', S0.find(s => s.name === 'Items').rows.slice(1).every(x => x[x.length - 2] === 'yes'));
    ck('freezing needs a registered LISTENER code (a fluent-speaker-only code is refused)', (await A('POST', '/api/voice-calibration/admin/reference', { take_id: take1.id, listener_code: speaker, heard: 'speech', spoken_as_script: true })).status === 400
      && (await A('POST', '/api/voice-calibration/admin/reference', { take_id: take1.id, listener_code: 'Shalini', heard: 'speech', spoken_as_script: true })).status === 400);
    ck('a speech take needs "said as written?" answered', (await A('POST', '/api/voice-calibration/admin/reference', { take_id: take1.id, listener_code: listener, heard: 'speech' })).status === 400);
    r = await A('POST', '/api/voice-calibration/admin/reference', { take_id: take1.id, listener_code: listener, heard: 'speech', spoken_as_script: true });
    ck('reference v1 frozen (said as written) → the card now reveals the transcripts and scores', r.status === 200 && r.data.version === 1);
    list = (await A('GET', '/api/voice-calibration/admin/takes')).data.takes; v1 = list.find(t => t.id === take1.id);
    ck('…revealed: transcripts, live verdict and each engine\'s line result', v1.revealed === true && typeof v1.gemini === 'string' && v1.live_decision && v1.scores.gemini.line === 'all correct', v1.scores);
    ck('…the draft label route is closed once frozen (a change must be a new version)', (await A('POST', '/api/voice-calibration/admin/label', { take_id: take1.id, heard: 'uncertain' })).data.frozen === true);
    r = await A('POST', '/api/voice-calibration/admin/reference', { take_id: take1.id, listener_code: listener, heard: 'speech', spoken_as_script: true });
    ck('…saving the same reference again makes no new version', r.data.unchanged === true && r.data.version === 1);
    // Rule 3 on this take: make it newly admitted (live refuses at 180 ms) and evaluate.
    await pool.query(`UPDATE voice_calibration_takes SET speech_status='no_speech', voiced_frames=9, longest_run_frames=4, f0_spread_raw=22, hop_ms=20, gemini_text='eradu idli ondu bowl sambar', whisper_text='eradu idli ondu bowl sambar', whisper_review='{"accepted":true}' WHERE id=$1`, [take1.id]);
    nChat = 0;
    r = await A('POST', '/api/voice-calibration/admin/preview-eval', {});
    let js = (await pool.query(`SELECT * FROM voice_calibration_preview_judgments WHERE take_id=$1 ORDER BY id`, [take1.id])).rows;
    ck('rule 3 under reference v1: both legs judged correct reviewable (2 parser calls, initial)', r.data.parser_calls === 2 && nChat === 2 && js.length === 2 && js.every(j => j.judgment.result === 'correct reviewable' && j.reason === 'initial' && j.reference_version === 1), r.data);
    // The review's stale-judgment counterexample: the listener corrects the reference to 1 idli.
    r = await A('POST', '/api/voice-calibration/admin/reference', { take_id: take1.id, listener_code: listener, heard: 'speech', spoken_as_script: false,
      items: [{ kind: 'count', n: 1, food: 'idli' }, { kind: 'count', n: 1, unit: 'bowl', food: 'sambar' }], text: 'ondu idli ondu bowl sambar' });
    ck('review repro: the reference corrected to 1 idli → version 2; the 2 earlier judgments are reported stale', r.status === 200 && r.data.version === 2 && r.data.stale_judgments === 2, r.data);
    let t1 = (await pool.query(`SELECT t.*, p.grp FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE t.id=$1`, [take1.id])).rows[0];
    ck('…recognition scoring follows the new reference: "eradu idli" is now a wrong number', C.takeScore(t1, C.slotInfo('k01-q', 'kn'), 'gemini').line === 'wrong number');
    ck('…and the old successful judgment is NOT reused: rule 3 for this take is stale', C.legStatus(t1, 'gemini', js).cls === 'stale' && C.rule3Status({ t: t1, truth: 'speech' }, js).status === 'incomplete');
    nChat = 0;
    r = await A('POST', '/api/voice-calibration/admin/preview-eval', {});
    ck('…an ordinary tap does not re-run stale judgments (no call; 2 waiting for "Re-evaluate")', r.data.parser_calls === 0 && r.data.reevaluation_calls === 0 && r.data.stale_waiting === 2 && nChat === 0, r.data);
    r = await A('POST', '/api/voice-calibration/admin/preview-eval', { reevaluate: true });
    js = (await pool.query(`SELECT * FROM voice_calibration_preview_judgments WHERE take_id=$1 ORDER BY id`, [take1.id])).rows;
    ck('…"Re-evaluate" re-runs both legs under v2, counted as re-evaluation calls; the preview of 2 idli now DISQUALIFIES; the v1 judgments are kept',
      r.data.reevaluation_calls === 2 && r.data.parser_calls === 0 && js.length === 4 && js.filter(j => j.reference_version === 2).every(j => j.reason === 're-evaluation' && j.judgment.result === 'disqualifying')
      && js.filter(j => j.reference_version === 1).length === 2, js.map(j => [j.reference_version, j.reason, j.judgment?.result]));
    const S1 = C.workbookSheets({ participants: [p0], takes: (await pool.query(`SELECT * FROM voice_calibration_takes`)).rows, judgments: js });
    const R3 = S1.find(s => s.name === 'Rule 3 previews').rows, RH = R3[0];
    ck('the export keeps every judgment: 2 STALE (v1) and 2 current (v2), with reference and judge versions', R3.filter(x => /STALE/.test(x[RH.indexOf('state')])).length === 2 && R3.filter(x => x[RH.indexOf('state')] === 'current').length === 2
      && R3.slice(1).every(x => x[RH.indexOf('judge version')] === C.JUDGE_VERSION));
    ck('About counts initial and re-evaluation parser calls apart', /4: 2 initial .* and 2 re-evaluation/.test(JSON.stringify(S1[0].rows)));
    const hist = S1.find(s => s.name === 'History').rows;
    ck('History keeps both reference versions with the listener\'s code', hist.filter(x => /^reference v[12]$/.test(x[0])).length === 2 && hist.filter(x => /^reference v/.test(x[0])).every(x => /^R1/.test(x[3])));
    // Complete corrected items, and unsupported deviations.
    const take2 = (await pool.query(`SELECT * FROM voice_calibration_takes WHERE slot_code='k02-q'`)).rows[0];
    r = await A('POST', '/api/voice-calibration/admin/reference', { take_id: take2.id, listener_code: listener, heard: 'speech', spoken_as_script: false, items: [{ kind: 'count', n: 2, food: 'pizza' }] });
    ck('a food the judges cannot read is refused with "mark it unscorable" (never silently scored)', r.status === 400 && /unscorable/.test(r.data.error), r.data);
    r = await A('POST', '/api/voice-calibration/admin/reference', { take_id: take2.id, listener_code: listener, heard: 'speech', spoken_as_script: false,
      items: [{ kind: 'count', n: 2, food: 'dosa' }, { kind: 'count', n: 1, unit: 'cup', food: 'coffee' }, { kind: 'presence', food: 'chutney' }] });
    let t2 = (await pool.query(`SELECT t.*, p.grp FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE t.id=$1`, [take2.id])).rows[0];
    const info2 = C.slotInfo('k02-q', 'kn');
    const sc2 = (tx) => C.takeScore({ ...t2, gemini_text: tx }, info2, 'gemini');
    ck('a COMPLETE corrected reference (a different food, the coffee, an extra chutney with no amount, upma omitted) is what scoring uses',
      r.status === 200 && sc2('eradu dosa ondu cup coffee chutney').line === 'all correct' && sc2('eradu dosa, ondu cup coffee mattu chutney').line === 'all correct' && sc2('ondu plate upma ondu cup coffee').line !== 'all correct'
      && sc2('eradu dosa ondu cup coffee').line === 'missing' && sc2('eradu dosa ondu cup coffee 2 bowl chutney').line === 'extra', [sc2('eradu dosa ondu cup coffee chutney'), sc2('eradu dosa ondu cup coffee').line]);
    await A('POST', '/api/voice-calibration/admin/reference', { take_id: take2.id, listener_code: listener, heard: 'speech', spoken_as_script: false, mode: 'unscorable', text: 'mixed two languages mid-word' });
    t2 = (await pool.query(`SELECT t.*, p.grp FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE t.id=$1`, [take2.id])).rows[0];
    ck('…a deviation the items cannot describe is marked unscorable: every line "uncertain/unscorable", version 3 kept', C.takeScore(t2, info2, 'gemini').line === 'uncertain/unscorable' && t2.reference_version === 2 && t2.reference_history.length === 2);
    // A Part B hand check: only "needs a hand check", only the current reference.
    await pool.query(`UPDATE voice_calibration_takes SET gemini_text='ondu idli ondu bowl sambar zebra' WHERE id=$1`, [take1.id]);
    r = await A('POST', '/api/voice-calibration/admin/hand-check', { take_id: take1.id, engine: 'whisper', verdict: 'all correct' });
    ck('a hand check on a line that does not need one is refused', r.status === 409, r.data);
    r = await A('POST', '/api/voice-calibration/admin/hand-check', { take_id: take1.id, engine: 'gemini', verdict: 'all correct', note: 'background word' });
    t1 = (await pool.query(`SELECT t.*, p.grp FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE t.id=$1`, [take1.id])).rows[0];
    ck('…a "needs a hand check" line is settled by the listener against the current reference (kept in history)', r.status === 200 && C.takeScore(t1, C.slotInfo('k01-q', 'kn'), 'gemini').line === 'all correct' && t1.hand_history.length === 1);
    await pool.query(`UPDATE voice_calibration_takes SET gemini_text='eradu idli ondu bowl sambar zebra' WHERE id=$1`, [take1.id]);
    await A('POST', '/api/voice-calibration/admin/reference', { take_id: take1.id, listener_code: listener, heard: 'speech', spoken_as_script: true, text: 'v3: as written' });
    t1 = (await pool.query(`SELECT t.*, p.grp FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE t.id=$1`, [take1.id])).rows[0];
    ck('…a new reference version re-opens that hand check (the old verdict belonged to the old reference)', t1.reference_version === 3 && C.takeScore(t1, C.slotInfo('k01-q', 'kn'), 'gemini').line === C.HAND_CHECK, C.takeScore(t1, C.slotInfo('k01-q', 'kn'), 'gemini'));
    // Concurrent taps: one claim per leg.
    await pool.query(`UPDATE voice_calibration_takes SET gemini_text='eradu idli ondu bowl sambar' WHERE id=$1`, [take1.id]);
    nChat = 0; chatDelay = 300;
    const [c1, c2] = await Promise.all([A('POST', '/api/voice-calibration/admin/preview-eval', { reevaluate: true }), A('POST', '/api/voice-calibration/admin/preview-eval', { reevaluate: true })]);
    chatDelay = 0;
    const v4 = (await pool.query(`SELECT * FROM voice_calibration_preview_judgments WHERE take_id=$1 AND reference_version=$2`, [take1.id, t1.reference_version])).rows;
    ck('review repro: two taps at once evaluate each leg ONCE (2 parser calls, 2 rows; the other tap reports them busy)',
      nChat === 2 && v4.length === 2 && c1.data.reevaluation_calls + c2.data.reevaluation_calls === 2 && c1.data.busy + c2.data.busy === 2, { nChat, rows: v4.length, c1: c1.data, c2: c2.data });
    // Rule 3 hand verdicts.
    stub.chat = () => ({ ...base(), foods: [{ name: 'Idli', qty_text: '2 idli', grams: 100, meal: 'Breakfast', per_100g: per }, { name: 'Sambar', qty_text: '1 bowl', grams: 200, meal: 'Breakfast', per_100g: per }], notes: 'from voice' });
    await A('POST', '/api/voice-calibration/admin/reference', { take_id: take1.id, listener_code: listener, heard: 'speech', spoken_as_script: true, text: 'as written' });
    await A('POST', '/api/voice-calibration/admin/preview-eval', { reevaluate: true });
    const hj = (await pool.query(`SELECT j.* FROM voice_calibration_preview_judgments j JOIN voice_calibration_takes t ON t.id=j.take_id AND t.reference_sha=j.reference_sha WHERE j.take_id=$1 ORDER BY j.id`, [take1.id])).rows;
    ck('a preview that would also save a note → "needs a hand check" (current judgment)', hj.length === 2 && hj.every(j => j.judgment.result === 'needs a hand check'), hj.map(j => j.judgment?.result));
    ck('…a hand verdict outside the four preview results is refused', (await A('POST', `/api/voice-calibration/admin/judgments/${hj[0].id}/hand`, { verdict: 'fine' })).status === 400);
    r = await A('POST', `/api/voice-calibration/admin/judgments/${hj[0].id}/hand`, { verdict: 'correct reviewable', note: 'note is harmless' });
    const old = (await pool.query(`SELECT j.id FROM voice_calibration_preview_judgments j JOIN voice_calibration_takes t ON t.id=j.take_id WHERE j.take_id=$1 AND j.reference_sha <> t.reference_sha LIMIT 1`, [take1.id])).rows[0];
    ck('…a hand verdict settles it; a STALE judgment cannot be settled by hand', r.status === 200 && (await A('POST', `/api/voice-calibration/admin/judgments/${old.id}/hand`, { verdict: 'correct reviewable' })).status === 409);
    stub.chat = () => ({ ...base(), foods: [{ name: 'Idli', qty_text: '2 idli', grams: 100, meal: 'Breakfast', per_100g: per }, { name: 'Sambar', qty_text: '1 bowl', grams: 200, meal: 'Breakfast', per_100g: per }] });
    // Withdrawal and expiry cover the new judgment rows too.
    await pool.query(`UPDATE voice_calibration_takes SET delete_after = NOW() - INTERVAL '1 day' WHERE id=$1`, [take2.id]);
    await pool.query(`INSERT INTO voice_calibration_preview_judgments (take_id, engine, reference_sha, reference_version, judge_version, status) VALUES ($1,'gemini',$2,1,$3,'done')`, [take2.id, 'e'.repeat(64), C.JUDGE_VERSION]);
    await require('../routes/voiceCalibration').deleteExpiredTakes(pool);
    ck('expiry deletes the take with its versioned judgments', !(await pool.query(`SELECT 1 FROM voice_calibration_preview_judgments WHERE take_id=$1`, [take2.id])).rows.length);

    // ── [5] Part C sessions ──────────────────────────────────────────────────
    console.log('\n[5] Part C: recoverable sessions; the app\'s session key decides what counts');
    {
      const { getISTDate } = require('../utils/istDate');
      const today = getISTDate();
      const yesterday = new Date(Date.now() - 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);
      const settle = () => new Promise(res => setTimeout(res, 200));
      await pool.query(`INSERT INTO daily_logs (patient_id, log_date, food_items, weight_kg, water_ml) VALUES ($1,$2,$3,81,500)`, [TESTACC, today, JSON.stringify([{ id: 'f0', name: 'Coffee', grams: 150 }])]);
      await pool.query(`INSERT INTO daily_logs (patient_id, log_date, food_items, weight_kg) VALUES ($1,$2,$3,80)`, [TESTACC, yesterday, JSON.stringify([{ id: 'y0', name: 'Rice', grams: 200 }])]);
      await pool.query(`INSERT INTO daily_logs (patient_id, log_date, food_items, weight_kg) VALUES ($1,$2,$3,70)`, [OTHER, today, JSON.stringify([{ id: 'o0', name: 'Poha', grams: 200 }])]);
      const day = async (id, d = today) => (await pool.query(`SELECT food_items, weight_kg FROM daily_logs WHERE patient_id=$1 AND log_date=$2`, [id, d])).rows[0];
      r = await A('POST', '/api/voice-calibration/admin/partc/arm', { trial: 1, account_id: TESTACC });
      const s1 = r.data.session_id;
      const me = (await http('GET', '/api/voice-calibration/partc/me', TESTACC, 'patient')).data.armed;
      ck('arming gives the account\'s app a session key and the time left (not a clock time)', r.status === 200 && me.session_key && me.expires_in_ms > 29 * 60000 && me.expires_in_ms <= 30 * 60000, me);
      // The app's session key decides what can count.
      await http('POST', '/api/ai-chat/voice-transcribe', TESTACC, 'patient', { audio: speechAudio, mimeType: 'audio/webm', langHint: 'kn-IN' });
      await http('POST', '/api/ai-chat/voice-transcribe', TESTACC, 'patient', { audio: speechAudio, mimeType: 'audio/webm', langHint: 'kn-IN', calibration_session: 'not-this-session' });
      await settle();
      let caps = (await pool.query(`SELECT captures FROM voice_calibration_partc WHERE trial_no=1`)).rows[0].captures;
      ck('a recording with NO session key is kept but marked "not sent"; one with ANOTHER session\'s key is noted and never counted as an attempt',
        caps[0].kind === 'server recording' && caps[0].session_match === 'not sent' && caps[1].kind === 'ignored recording (another session)' && caps.length === 2, caps.map(c => [c.kind, c.session_match]));
      let S = C.workbookSheets({ partc: (await pool.query(`SELECT * FROM voice_calibration_partc`)).rows, sessions: (await pool.query(`SELECT * FROM voice_calibration_partc_sessions`)).rows });
      let pc = S.find(s => s.name === 'Part C tries').rows; let PH = pc[0];
      ck('…so try 1 does NOT yet count as a Gemini test (the app never confirmed the session)', /^NO: the app did not confirm/.test(pc.find(x => x[0] === 1)[PH.indexOf('counts as a test of the planned provider')]));
      await http('POST', '/api/ai-chat/voice-transcribe', TESTACC, 'patient', { audio: speechAudio, mimeType: 'audio/webm', langHint: 'kn-IN', calibration_session: me.session_key });
      await settle();
      S = C.workbookSheets({ partc: (await pool.query(`SELECT * FROM voice_calibration_partc`)).rows, sessions: (await pool.query(`SELECT * FROM voice_calibration_partc_sessions`)).rows });
      pc = S.find(s => s.name === 'Part C tries').rows;
      ck('…with the right key it counts (positive control)', pc.find(x => x[0] === 1)[PH.indexOf('counts as a test of the planned provider')] === 'yes');
      const ev = S.find(s => s.name === 'Part C events').rows, EH = ev[0];
      const rec = ev.find(x => x[0] === 1 && x[EH.indexOf('session sent by the app')] === 'yes');
      ck('the event ledger carries the session, audio fingerprint, language, HTTP status and model version', rec[EH.indexOf('session')] === s1 && /^[0-9a-f]{16}$/.test(rec[EH.indexOf('audio sha256')]) && rec[EH.indexOf('language')] === 'kn-IN'
        && rec[EH.indexOf('HTTP status')] === 200 && rec[EH.indexOf('model version')] === 'gemini-2.5-flash-lite-001', rec);
      // The review's Finish counterexample: an unrestored day and the switch on.
      await pool.query(`UPDATE daily_logs SET food_items = food_items || $3::jsonb WHERE patient_id=$1 AND log_date=$2`, [TESTACC, today, JSON.stringify([{ id: 'f1', name: 'Idli', grams: 100 }])]);
      await pool.query(`INSERT INTO voice_fallback_test_account (id, user_id, set_by) VALUES (1,$1,$2) ON CONFLICT (id) DO UPDATE SET user_id=$1, set_at=NOW()`, [TESTACC, ADMIN]);
      r = await A('POST', '/api/voice-calibration/admin/partc/finish');
      ck('review repro: Finish with the day unrestored and the switch ON → NOT complete (ok false), both problems listed, recording stopped',
        r.status === 200 && r.data.ok === false && r.data.completed === false && r.data.capture_stopped === true && r.data.restored === false && r.data.switch_off_verified === false && r.data.outstanding.length === 2, r.data);
      ck('…the account is no longer recording (the armed row is gone)', (await http('GET', '/api/voice-calibration/partc/me', TESTACC, 'patient')).data.armed === null);
      r = await A('POST', '/api/voice-calibration/admin/partc/restore');
      ck('review repro: Restore AFTER Finish still works (was "409, No try is open"): the day equals its baseline again', r.status === 200 && r.data.ok === true && r.data.session_id === s1 && (await day(TESTACC)).food_items.length === 1, r.data);
      ck('…restore touched only that account and that date: yesterday and another account\'s day unchanged; the switch untouched', (await day(TESTACC, yesterday)).food_items[0].name === 'Rice' && (await day(OTHER)).food_items[0].name === 'Poha'
        && (await pool.query(`SELECT user_id FROM voice_fallback_test_account`)).rows[0].user_id === TESTACC);
      r = await A('POST', '/api/voice-calibration/admin/partc/arm', { trial: 2, account_id: TESTACC });
      ck('another try cannot be armed while this session is unresolved (switch still on)', r.status === 409 && r.data.session_id === s1, r.data);
      r = await A('POST', '/api/voice-calibration/admin/partc/finish');
      ck('…Finish again with the switch still on: still not complete', r.data.completed === false && r.data.outstanding.length === 1 && /switch/.test(r.data.outstanding[0]));
      await pool.query(`DELETE FROM voice_fallback_test_account`);
      r = await A('POST', `/api/voice-calibration/admin/partc/sessions/${s1}/finish`);
      ck('…switch off, Finish (by session) → complete: day equal to its baseline, switch verified off', r.data.completed === true && r.data.ok === true && r.data.switch_off_verified === true && r.data.restored === true, r.data);
      ck('…a database guard allows only one unresolved session at a time', await (async () => {
        await pool.query(`INSERT INTO voice_calibration_partc_sessions (session_key, trial_no, route, log_date, baseline) VALUES ('k-a', 99, 'controlled', NOW(), '{}')`);
        try { await pool.query(`INSERT INTO voice_calibration_partc_sessions (session_key, trial_no, route, log_date, baseline) VALUES ('k-b', 98, 'controlled', NOW(), '{}')`); return false; }
        catch (e) { return e.code === '23505'; } finally { await pool.query(`DELETE FROM voice_calibration_partc_sessions WHERE session_key IN ('k-a','k-b')`); }
      })());
      // An interrupted (expired) session stays recoverable.
      r = await A('POST', '/api/voice-calibration/admin/partc/arm', { trial: 3, account_id: TESTACC });
      const s3 = r.data.session_id;
      await pool.query(`UPDATE voice_calibration_partc_armed SET armed_at = NOW() - INTERVAL '31 minutes'`);
      await pool.query(`UPDATE daily_logs SET weight_kg = 90 WHERE patient_id=$1 AND log_date=$2`, [TESTACC, today]);
      ck('an expired, unfinished session still blocks arming and is listed for recovery', (await A('POST', '/api/voice-calibration/admin/partc/arm', { trial: 4, account_id: TESTACC })).status === 409
        && (await A('GET', '/api/voice-calibration/admin')).data.partc.unresolved.some(x => x.id === s3));
      r = await A('POST', `/api/voice-calibration/admin/partc/sessions/${s3}/finish`);
      ck('…Finish reports the changed day (not complete); Restore by session, then Finish → complete; the stop is recorded as after the window', r.data.completed === false
        && (await A('POST', `/api/voice-calibration/admin/partc/sessions/${s3}/restore`)).data.ok === true && (await A('POST', `/api/voice-calibration/admin/partc/sessions/${s3}/finish`)).data.completed === true
        && (await pool.query(`SELECT stop_reason FROM voice_calibration_partc_sessions WHERE id=$1`, [s3])).rows[0].stop_reason === 'finish (window had ended)', r.data);
      // Repeating a try keeps every session and baseline.
      await pool.query(`UPDATE daily_logs SET water_ml = 900 WHERE patient_id=$1 AND log_date=$2`, [TESTACC, today]);
      r = await A('POST', '/api/voice-calibration/admin/partc/arm', { trial: 1, account_id: TESTACC });
      const s1b = r.data.session_id;
      await A('POST', '/api/voice-calibration/admin/partc/finish');
      const ss = (await pool.query(`SELECT id, baseline, readbacks, cleanups, switch_checks FROM voice_calibration_partc_sessions WHERE trial_no=1 ORDER BY id`)).rows;
      ck('repeating try 1 keeps BOTH sessions with their own baselines, read-backs, restores and switch checks', ss.length === 2 && ss[0].id === s1 && ss[1].id === s1b && ss[0].baseline.day.water_ml === 500 && ss[1].baseline.day.water_ml === 900
        && ss[0].cleanups.length === 1 && ss[0].switch_checks.length === 3 && ss[1].readbacks.length >= 1, ss.map(x => [x.id, x.baseline.day.water_ml, x.cleanups.length, x.switch_checks.length]));
      S = C.workbookSheets({ partc: (await pool.query(`SELECT * FROM voice_calibration_partc`)).rows, sessions: (await pool.query(`SELECT * FROM voice_calibration_partc_sessions`)).rows });
      const sess = S.find(s => s.name === 'Part C sessions').rows, SH = sess[0];
      ck('the export lists every session: armed, stopped (and why), baseline, restores, the switch at the first Finish, resolved', sess.length === 4 && sess.find(x => x[0] === s1)[SH.indexOf('switch at first Finish')] === 'ON'
        && sess.find(x => x[0] === s3)[SH.indexOf('stop reason')] === 'finish (window had ended)' && sess.slice(1).every(x => x[SH.indexOf('resolved at')]));
      pc = S.find(s => s.name === 'Part C tries').rows;
      ck('…and the try row shows its sessions and that the latest is resolved', pc.find(x => x[0] === 1)[PH.indexOf('sessions')] === 2 && /^yes/.test(pc.find(x => x[0] === 1)[PH.indexOf('resolved (day equal to its baseline and switch off)')]));
    }

    // ── [6b] The shared export ────────────────────────────────────────────────
    console.log('\n[6] the export: complete evidence, anonymous IDs, codes, and no registered name anywhere');
    {
      await A('POST', '/api/voice-calibration/admin/invite', { member_id: V[1], group: 'hi', profile_note: 'Farhan, 40s' });
      await http('POST', '/api/voice-calibration/consent', V[1], 'patient', { phone_type: 'iphone', browser: 'safari', device: { make: 'Apple', model: 'iPhone 13', os: 'ios', os_version: '17.6', browser_version: '17.6' } });
      const t0 = (await pool.query(`SELECT id FROM voice_calibration_takes WHERE slot_code='k01-q'`)).rows[0];
      await pool.query(`UPDATE voice_calibration_takes SET retake_note='Lakshmi coughed', reference_text='lakshmi said ondu idli' WHERE id=$1`, [t0.id]);
      await A('PUT', '/api/voice-calibration/admin/partc/1', { items: [{ label: '2 idli', ok: true }], applied: false, day_correct: true, notes: `operator Divya noticed a delay; Shalini listened; Other Account ${tag} watched` });
      // A 2x-style wording row that stored a NAME.
      await pool.query(`INSERT INTO voice_calibration_wording (lang, script_sha256, confirmed_by) VALUES ('hi', $1, 'Old Hindi Checker') ON CONFLICT (lang) DO UPDATE SET confirmed_by=EXCLUDED.confirmed_by, script_sha256=EXCLUDED.script_sha256`, [C.scriptSha('hi')]);
      r = await A('GET', '/api/voice-calibration/admin/export.xlsx');
      const files = X.unzipStored(r.data);
      const raw = Object.values(files).map(String).join('\n');
      const names = [NAMES[0], NAMES[1], 'Shalini Murthy', 'Venkatesh Iyer'];     // the study's registered people
      const leaked = names.flatMap(n => [n, ...n.split(' ')]).filter(w => new RegExp(`(?<![A-Za-z])${w}(?![A-Za-z])`, 'i').test(raw));
      ck('review repro fixed: no volunteer\'s or reviewer\'s name (or name part) appears anywhere in the shared file, free text included', r.status === 200 && !leaked.length, leaked);
      ck('…any account\'s FULL name typed into a note is removed too (here another account\'s)', !raw.includes(`Other Account ${tag}`) && raw.includes('[name removed] watched'));
      ck('…reviewers appear by code (R2 confirmed Kannada); a legacy name in the wording table is withheld', /confirmed by R2/.test(raw) && /unregistered reviewer \(name withheld\)/.test(raw) && !/Old Hindi Checker/.test(raw));
      ck('…the Free text sheet says where free text is and how many names were removed', /Free text/.test(String(files['xl/workbook.xml'])) && /names removed from free text/.test(raw) && /read these cells before sharing/.test(raw));
      const sheets = C.workbookSheets({ participants: (await pool.query(`SELECT * FROM voice_calibration_participants`)).rows, takes: (await pool.query(`SELECT * FROM voice_calibration_takes`)).rows,
        partc: (await pool.query(`SELECT * FROM voice_calibration_partc`)).rows, sessions: (await pool.query(`SELECT * FROM voice_calibration_partc_sessions`)).rows,
        judgments: (await pool.query(`SELECT * FROM voice_calibration_preview_judgments`)).rows, wording: (await pool.query(`SELECT * FROM voice_calibration_wording`)).rows, privateNames: names.map(n => `${n} ${tag}`) });
      const F = sheets.find(s => s.name === 'Free text').rows;
      const noteRow = F.find(x => x[0] === 'Part C tries' && x[1] === 'notes');
      ck('…an UNREGISTERED name in a note ("Divya") cannot be known: that note column is listed on the Free text sheet, with its cell count, to read before sharing',
        noteRow && noteRow[2] === 1 && /read these cells before sharing/.test(noteRow[4]) && F.find(x => x[0] === 'Takes' && x[1] === 'reference transcript')[3] >= 1, F);
      const T = sheets.find(s => s.name === 'Takes').rows, TH = T[0];
      ck('Takes carry the anonymous take id, the device per take and the reference version', ['take id', 'phone make', 'phone model', 'os version', 'browser version', 'reference version', 'listener'].every(c => TH.includes(c))
        && T.slice(1).some(x => x[TH.indexOf('phone model')] === '12C') && T.slice(1).some(x => x[TH.indexOf('reference version')] >= 2));
      const H = sheets.find(s => s.name === 'History').rows;
      const kinds = new Set(H.slice(1).map(x => x[0].replace(/ v\d+$/, ' v').replace(/ \(.*\)$/, '')));
      ck('History holds labels, every reference version, hand checks, judgments, hand verdicts, marks, sessions and wording checks',
        ['reference v', 'Part B hand check', 'rule 3 judgment', 'rule 3 hand verdict', 'Part C marks', 'Part C session armed', 'Part C restore', 'Part C switch check', 'Part C session resolved', 'wording confirmed'].every(k => kinds.has(k)), [...kinds]);
      ck('…every "by" is a code (A1… or R1…), never an account id', H.slice(1).every(x => /^((R\d+|A\d+)( \/ A\d+)?)?$/.test(String(x[3]))), H.slice(1).map(x => x[3]).filter(b => !/^((R\d+|A\d+)( \/ A\d+)?)?$/.test(String(b))));
      const R3 = sheets.find(s => s.name === 'Rule 3 previews').rows, RH = R3[0];
      ck('rule 3 rows show the preview content (foods with amounts, notes) and the parser that made it', R3.slice(1).some(x => /food: 2 idli Idli \(100 g\)/.test(x[RH.indexOf('preview content')]) && /note: from voice/.test(x[RH.indexOf('preview content')])));
      const about = JSON.stringify(sheets[0].rows);
      ck('About reports the phone mix as INCOMPLETE for this partial cohort', /phone mix","INCOMPLETE/.test(about) && /no Chrome on Android/.test(about) === false);
    }
  } catch (e) { ck('the suite ran to the end', false, e.stack); }
  finally {
    for (const t of TABLES) await pool.query(`DELETE FROM ${t}`).catch(() => {});
    await pool.query(`DELETE FROM daily_logs WHERE patient_id = ANY($1::int[])`, [[...V, TESTACC, OTHER]]).catch(() => {});
    server.close(); R2.server?.close?.(); await pool.end().catch(() => {});
  }
  console.log(`\nVoice calibration 2y review fixes: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
