/**
 * scripts/test-voice-calibration-3a.js — Fixes-3a: the 2z calibration-kit review (25 Oct 2026), two findings, each with the
 * review's exact counterexamples next to positive controls. REAL Postgres and the REAL routes for the budget; the REAL food
 * normaliser and the app's REAL Save builder for the weights; STUBBED providers (no real Gemini, Whisper or parser call).
 *
 *   [1] weights: against a listener reference of "2 idli (100 g)", a preview whose label says 100 g but whose saved amount is
 *       150 g, or whose label carries a second, conflicting figure, is never correct reviewable. Every weight in the label AND
 *       the amount Save would write are judged; consistent previews still pass; an estimate that disagrees with itself is a hand
 *       check; the judge version changed, so older judgments are stale;
 *   [2] the 12-replacement budget is atomic and auditable: sequential 12th/13th, two simultaneous requests for the last slot
 *       (exactly one granted), the database refusing a 13th grant number on its own, a repeated request (same grant, history
 *       kept), one grant → one replacement, and withdrawal/deletion never returning a spent allowance or spent calls.
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
const Module = require('module');
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
const { normaliseFoodReview } = require('../services/foodReview');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 500))); };
const FIX = path.join(__dirname, 'fixtures/voice');

/** The app's real Save builder (client/src/utils/aiSaveReceipt.js), bundled for Node exactly as the app imports it. */
async function saveBuilder() {
  const { build } = require('esbuild');
  const r = await build({ entryPoints: [path.join(__dirname, '../../client/src/utils/aiSaveReceipt.js')], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent' });
  const m = new Module('aiSaveReceipt.bundle'); m._compile(r.outputFiles[0].text, 'aiSaveReceipt.bundle.js'); return m.exports;
}

(async () => {
  // ── [1] Weights: every label figure AND the amount Save writes ────────────
  console.log('\n[1] the preview judge checks every weight shown and the amount that would be saved');
  {
    const P = (o) => ({ weight_kg: 82.5, activities: [], acv: [], supplements: [], water_ml_add: null, sleep: null, foods: [], workouts: [], corrections: [], ...o });
    const sambar = { name: 'Sambar', qty_text: '1 bowl', grams: 200 };
    const e01 = C.LINES.e01.items;
    const withG = C.validReferenceItems([{ kind: 'count', n: 2, food: 'idli', grams: 100 }, { kind: 'count', n: 1, unit: 'bowl', food: 'sambar' }]).items.concat(e01.filter(i => i.kind === 'weight'));
    const jp = (items, idli) => C.judgePreview(items, P({ foods: [{ name: 'Idli', ...idli }, sambar] }), 'en');
    const r1 = jp(withG, { qty_text: '2 idli (100 g)', grams: 150 });
    ck('review repro 1: reference 2 idli (100 g); preview label "2 idli (100 g)" with saved grams 150 → DISQUALIFYING (was correct reviewable)', r1.result === 'disqualifying' && /Idli/.test(r1.problems.join()), r1);
    const r2 = jp(withG, { qty_text: '2 idli (100 g) (150 g)', grams: 150 });
    ck('review repro 2: label "2 idli (100 g) (150 g)" with saved grams 150 → DISQUALIFYING (the later figure and the saved amount are judged)', r2.result === 'disqualifying', r2);
    ck('…a conflicting second label figure disqualifies even when the saved amount is right ("(100 g) (150 g)", grams 100)', jp(withG, { qty_text: '2 idli (100 g) (150 g)', grams: 100 }).result === 'disqualifying');
    ck('positive controls with the spoken weight: "2 idli (100 g)" + 100, "2 idli" + 100, "2 pieces" + 100 → correct reviewable', ['2 idli (100 g)', '2 idli', '2 pieces'].every(q => jp(withG, { qty_text: q, grams: 100 }).result === 'correct reviewable'));
    ck('…"2 idli (150 g)" + 150 against 100 g is still a surfaced wrong amount (the 2z control)', jp(withG, { qty_text: '2 idli (150 g)', grams: 150 }).result === 'disqualifying');
    const ml = jp(withG, { qty_text: '2 idli (100 ml)', grams: 100 });
    ck('…the spoken 100 g shown in another unit ("100 ml") cannot be compared: a hand check, never an automatic pass', ml.result === 'needs a hand check' && /100 ml/.test(ml.hand.join()), ml);
    // No weight spoken: a weight is the app's estimate; it must be ONE amount.
    ck('no weight spoken: an estimate beside a correct count passes ("2 idli" + 100; "2 idli (100 g)" + 100; the 2z positives)', jp(e01, { qty_text: '2 idli', grams: 100 }).result === 'correct reviewable' && jp(e01, { qty_text: '2 idli (100 g)', grams: 100 }).result === 'correct reviewable');
    const est = jp(e01, { qty_text: '2 idli (100 g)', grams: 150 });
    ck('…an estimate that disagrees with itself (label 100 g, saved 150 g) is a hand check, not silent', est.result === 'needs a hand check' && /disagrees with itself/.test(est.hand.join()) && est.items[0].outcome === C.WEIGHT_CHECK, est);
    ck('…and so are two different label figures ("(100 g) (150 g)")', jp(e01, { qty_text: '2 idli (100 g) (150 g)', grams: 150 }).result === 'needs a hand check');
    ck('…a drink shown as "(250 ml)" with 250 saved is one amount (ml taken as g): no hand check for that', C.weightCheck({ n: 1, unit: 'glass', food: 'buttermilk' }, C.phrasesOf('1 glass (250 ml)', 'en').phrases, { grams: 250 }).hand === null);
    ck('the 2y/2z preview cases still hold: "2 kg" disqualifies; "2 idli and 3 idli" disqualifies; curd\'s shown amount is a hand check', jp(e01, { qty_text: '2 kg', grams: 100 }).result === 'disqualifying' && jp(e01, { qty_text: '2 idli and 3 idli', grams: 100 }).result === 'disqualifying'
      && C.judgePreview(C.LINES.k04.items, P({ weight_kg: null, foods: [{ name: 'Chapati', qty_text: '2 chapati', grams: 80 }, { name: 'Dal', qty_text: '1 katori', grams: 150 }, { name: 'Curd', qty_text: '1 bowl', grams: 150 }] }), 'kn').result === 'needs a hand check');
    // The save payload: the real normaliser and the app's real Save builder carry the 150 g; the judge sees the same number.
    const norm = normaliseFoodReview([{ name: 'Idli', qty_text: '2 idli (100 g)', grams: 150, meal: 'breakfast' }], []);
    const { createDailyChange } = await saveBuilder();
    const change = createDailyChange({ foods: norm.foods.map(f => ({ ...f, on: true })) }, { food: [] }, { id: 'calib', mealSlots: ['breakfast'] });
    const saved = change.foods[0]?.after;
    ck('the save payload (real normaliser + the app\'s real Save builder) writes grams 150 with the label "2 idli (100 g)", as the review found', norm.foods[0].grams === 150 && saved?.grams === 150 && saved?.qty_text === '2 idli (100 g)', saved);
    ck('…the judge reads that same saved amount: the payload\'s food judged against 2 idli (100 g) is disqualifying; with grams 100 it is correct', jp(withG, { qty_text: saved.qty_text, grams: saved.grams }).result === 'disqualifying'
      && jp(withG, { qty_text: saved.qty_text, grams: createDailyChange({ foods: normaliseFoodReview([{ name: 'Idli', qty_text: '2 idli (100 g)', grams: 100 }], []).foods.map(f => ({ ...f, on: true })) }, { food: [] }, { id: 'c2', mealSlots: ['breakfast'] }).foods[0].after.grams }).result === 'correct reviewable');
    // A new judge version: judgments made under the 2z judge are stale and never qualify.
    ck('the judge version changed with these rules (judge-3a.1), so a judgment cached under judge-2y.1 is never reused', C.JUDGE_VERSION === 'judge-3a.1');
  }

  // ── [2] The replacement budget: atomic and auditable ──────────────────────
  const KEYS = { id: 'AKIDTESTONLY0012', secret: 'calibration-3a-secret' };
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
  const mk = async (name, role = 'patient') => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, '7' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), role])).rows[0].id;
  const tok = (id, role) => jwt.sign({ id, role, name: 'x' }, process.env.JWT_SECRET, { expiresIn: 600 });
  const http = async (method, u, id, role, body) => {
    const r = await fetch(url + u, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok(id, role)}` }, body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const ADMIN = await mk(`Cal Admin ${tag}`, 'admin');
  const A = (m, u, b) => http(m, u, ADMIN, 'admin', b);
  const silence = fs.readFileSync(path.join(FIX, 'silence-digital.webm')).toString('base64');
  const q = async (sql, args) => (await pool.query(sql, args)).rows;
  const grants = async () => Number((await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_replacement_grants`))[0].n);
  const seed = async (upTo) => { await pool.query(`DELETE FROM voice_calibration_replacement_grants WHERE take_id >= 900000`); for (let n = 1; n <= upTo; n++) await pool.query(`INSERT INTO voice_calibration_replacement_grants (grant_no, take_id, why) VALUES ($1, $2, 'seeded')`, [n, 900000 + n]); };
  process.env.RAILWAY_GIT_BRANCH = 'test';
  try {
    console.log('\n[2] the 12-replacement budget: one locked decision, a database-enforced ledger, never replenished');
    const listener = (await A('POST', '/api/voice-calibration/admin/reviewers', { name: 'Ledger Listener Example', role: 'listener' })).data.code;
    // Two volunteers, six excluded (unsure) controls each available.
    const vols = [];
    for (const [nm, grp] of [['Meera Kulkarni', 'en'], ['Arjun Shetty', 'kn']]) {
      const id = await mk(`${nm} ${tag}`);
      await A('POST', '/api/voice-calibration/admin/invite', { member_id: id, group: grp, profile_note: '30s' });
      await http('POST', '/api/voice-calibration/consent', id, 'patient', { phone_type: 'android_budget', browser: 'chrome', device: { make: 'Redmi', model: '12C', os: 'android', os_version: '13', browser_version: '129' } });
      vols.push(id);
    }
    const ctlSlots = C.slotPlan('en').filter(s => s.kind === 'control').map(s => s.slot);
    const excluded = [];
    for (const v of vols) for (const slot of ctlSlots.slice(0, 3)) {
      const r = await http('POST', '/api/voice-calibration/take', v, 'patient', { slot, audio: silence, mimeType: 'audio/webm' });
      const id = (await q(`SELECT t.id FROM voice_calibration_takes t JOIN voice_calibration_participants p ON p.id=t.participant_id WHERE p.patient_id=$1 AND t.slot_code=$2 AND t.superseded_at IS NULL`, [v, slot]))[0]?.id;
      await A('POST', '/api/voice-calibration/admin/reference', { take_id: id, listener_code: listener, heard: 'uncertain' });
      if (r.status === 200 && id) excluded.push({ id, v, slot });
    }
    ck('setup: six excluded (unsure) control takes through the real routes', excluded.length === 6, excluded.length);
    const [tA, tB, tC, tD, tE] = excluded;
    const ask = (t, why) => A('POST', '/api/voice-calibration/admin/replacement', { take_id: t.id, ...(why ? { why } : {}) });

    // Sequential 12th / 13th.
    await seed(11);
    let r = await ask(tA);
    const r13 = await ask(tB);
    ck('sequential: with 11 used, the 12th is granted (grant 12 of 12) and the 13th is refused with "stop and review"', r.status === 200 && r.data.grant_no === 12 && r.data.used === 12 && r13.status === 409 && /used up/.test(r13.data.error || '') && await grants() === 12, { r: r.data, r13: r13.data });

    // Two simultaneous requests for the last slot, five times over.
    let races = 0, raceOk = 0;
    for (let k = 0; k < 5; k++) {
      await pool.query(`DELETE FROM voice_calibration_replacement_grants WHERE take_id IN ($1,$2)`, [tA.id, tB.id]);
      await pool.query(`UPDATE voice_calibration_takes SET replacement_authorised = NULL WHERE id IN ($1,$2)`, [tA.id, tB.id]);
      await seed(11);
      const [x, y] = await Promise.all([ask(tA), ask(tB)]);
      const okN = [x, y].filter(z => z.status === 200).length, refused = [x, y].filter(z => z.status === 409).length;
      const marked = (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_takes WHERE id IN ($1,$2) AND replacement_authorised IS NOT NULL`, [tA.id, tB.id]))[0].n;
      races++; if (okN === 1 && refused === 1 && await grants() === 12 && marked === 1) raceOk++;
    }
    ck('review repro: with 11 used, two SIMULTANEOUS requests for different excluded takes → exactly one granted, one refused, 12 grants (5 of 5 rounds)', raceOk === races && races === 5, { raceOk, races });

    // A forced interleaving: a competing grant lands while the request waits for the round's lock → it must see 12 and refuse.
    await pool.query(`DELETE FROM voice_calibration_replacement_grants WHERE take_id IN ($1,$2)`, [tA.id, tB.id]);
    await pool.query(`UPDATE voice_calibration_takes SET replacement_authorised = NULL WHERE id IN ($1,$2)`, [tA.id, tB.id]);
    await seed(11);
    const holder = await pool.connect();
    let waited = false, competing = null;
    let settled = false, pending = null;
    try {
      await holder.query('BEGIN'); await holder.query(`SELECT pg_advisory_xact_lock(hashtext('voice_calibration_replacement_budget'))`);
      pending = ask(tC).then(z => { settled = true; return z; });
      await new Promise(res => setTimeout(res, 600));
      waited = !settled;
      competing = await holder.query(`INSERT INTO voice_calibration_replacement_grants (grant_no, take_id, why) VALUES (12, 900099, 'competing')`).then(() => 'inserted', e => e.code);
      await holder.query(competing === 'inserted' ? 'COMMIT' : 'ROLLBACK');
    } finally { await holder.query('ROLLBACK').catch(() => {}); holder.release(); }
    r = await pending;
    ck('forced interleaving: a request waits for the round\'s lock; a competing grant takes the last slot first → the request refuses (count read under the lock)', waited && competing === 'inserted' && r.status === 409 && /used up/.test(r.data.error || '') && await grants() === 12, { waited, competing, r: r.data });

    // The database alone refuses a 13th grant number, and a duplicate 12th — with no help from the route.
    const c1 = await pool.connect(), c2 = await pool.connect();
    let dupCode = null, overCode = null;
    try {
      await pool.query(`DELETE FROM voice_calibration_replacement_grants WHERE take_id = 900099`);
      await c1.query('BEGIN'); await c2.query('BEGIN');
      await c1.query(`INSERT INTO voice_calibration_replacement_grants (grant_no, take_id) VALUES (12, 900201)`);
      const second = c2.query(`INSERT INTO voice_calibration_replacement_grants (grant_no, take_id) VALUES (12, 900202)`).catch(e => e);
      await new Promise(res => setTimeout(res, 300)); await c1.query('COMMIT');
      dupCode = (await second)?.code; await c2.query('ROLLBACK');
      overCode = await pool.query(`INSERT INTO voice_calibration_replacement_grants (grant_no, take_id) VALUES (13, 900203)`).then(() => null, e => e.code);
    } finally { c1.release(); c2.release(); }
    ck('the database on its own: two transactions both writing grant 12 → the second is refused (unique); a grant 13 is refused (check)', dupCode === '23505' && overCode === '23514', { dupCode, overCode });

    // Repeated requests for the same take: the same grant, no new allowance, history kept.
    await pool.query(`DELETE FROM voice_calibration_replacement_grants`); await pool.query(`UPDATE voice_calibration_takes SET replacement_authorised = NULL`);
    await seed(9);
    const first = await ask(tD, 'TV in the background');
    const before = (await q(`SELECT * FROM voice_calibration_replacement_grants WHERE take_id=$1`, [tD.id]))[0];
    const again = await ask(tD, 'a different reason');
    const [p1, p2] = await Promise.all([ask(tD, 'x'), ask(tD, 'y')]);
    const rows = await q(`SELECT * FROM voice_calibration_replacement_grants WHERE take_id=$1`, [tD.id]);
    const col = (await q(`SELECT replacement_authorised FROM voice_calibration_takes WHERE id=$1`, [tD.id]))[0].replacement_authorised;
    ck('repeated requests for one take (one after another, and two at once) → the SAME grant: one ledger row, no new allowance, its reason and time unchanged',
      first.status === 200 && first.data.grant_no === 10 && again.status === 200 && again.data.already === true && again.data.grant_no === 10 && again.data.used === 10 && p1.status === 200 && p2.status === 200
      && rows.length === 1 && rows[0].why === 'TV in the background' && +new Date(rows[0].granted_at) === +new Date(before.granted_at) && col.why === 'TV in the background' && await grants() === 10, { again: again.data, rows: rows.length, col });

    // One grant → one replacement.
    const vD = vols.find(v => v === tD.v);
    r = await http('POST', '/api/voice-calibration/take', vD, 'patient', { slot: tD.slot, audio: silence, mimeType: 'audio/webm', retake_reason: 'replacement' });
    const g = (await q(`SELECT * FROM voice_calibration_replacement_grants WHERE take_id=$1`, [tD.id]))[0];
    const newTake = (await q(`SELECT id FROM voice_calibration_takes WHERE participant_id=(SELECT participant_id FROM voice_calibration_takes WHERE id=$1) AND slot_code=$2 AND superseded_at IS NULL`, [tD.id, tD.slot]))[0];
    const r2nd = await http('POST', '/api/voice-calibration/take', vD, 'patient', { slot: tD.slot, audio: silence, mimeType: 'audio/webm', retake_reason: 'replacement' });
    ck('one grant, one replacement: the recorded replacement is tied to the grant; a second "replacement" for that clip is refused', r.status === 200 && g.replacement_take_id === newTake.id && g.replaced_at && r2nd.status === 409, { g, r2nd: r2nd.status });
    ck('…and a repeated request on the replaced take does not open a new allowance', (await ask(tD)).data.already === true && await grants() === 10);

    // Withdrawal / deletion never returns a spent allowance (or spent calls).
    await ask(tE);                                   // grant 11, on volunteer tE.v
    // Two replacement recordings for the same clip at the same moment: both pass the quick check before the upload; the grant is
    // used inside the take's transaction, so exactly one is recorded and the other is refused.
    const twin = await Promise.all([1, 2].map(() => http('POST', '/api/voice-calibration/take', tE.v, 'patient', { slot: tE.slot, audio: silence, mimeType: 'audio/webm', retake_reason: 'replacement' })));
    const gE = (await q(`SELECT replacement_take_id FROM voice_calibration_replacement_grants WHERE take_id=$1`, [tE.id]))[0];
    const repTakes = (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_takes WHERE participant_id=(SELECT participant_id FROM voice_calibration_takes WHERE id=$1) AND slot_code=$2 AND retake_reason='replacement'`, [tE.id, tE.slot]))[0].n;
    ck('two replacement recordings for one clip at the same moment → exactly one recorded (tied to the grant), the other refused', twin.filter(x => x.status === 200).length === 1 && twin.filter(x => x.status === 409).length === 1 && repTakes === 1 && gE.replacement_take_id != null, { st: twin.map(x => x.status), repTakes, gE });
    const spendBefore = (await q(`SELECT kind, SUM(calls)::int AS n FROM voice_calibration_spend GROUP BY kind ORDER BY kind`));
    const usedBefore = await grants();
    const vE = tE.v;
    const w = await http('POST', '/api/voice-calibration/withdraw', vE, 'patient');
    const heldE = (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_takes WHERE id=$1`, [tE.id]))[0].n;
    const spendAfter = (await q(`SELECT kind, SUM(calls)::int AS n FROM voice_calibration_spend GROUP BY kind ORDER BY kind`));
    ck('withdrawal deletes the volunteer\'s recordings, but every grant stays in the ledger (11 used before and after) and spent calls are unchanged',
      w.status === 200 && heldE === 0 && usedBefore === 11 && await grants() === 11 && JSON.stringify(spendBefore) === JSON.stringify(spendAfter) && spendBefore.length > 0, { usedBefore, after: await grants(), spendBefore, spendAfter });
    await pool.query(`INSERT INTO voice_calibration_replacement_grants (grant_no, take_id, why) VALUES (12, 900012, 'seeded')`);   // grants 1–9 seeded, 10 and 11 real
    const full = await ask(tC);   // the other volunteer's excluded take (tF went with the withdrawal)
    ck('…so with the deleted volunteer\'s grant still counted, the budget is full: a further request is refused', full.status === 409 && /used up/.test(full.data.error || ''), full.data);
    // The 90-day clean-up deletes takes too: the ledger and spend ledger survive it.
    await pool.query(`UPDATE voice_calibration_takes SET delete_after = NOW() - INTERVAL '1 day'`);
    const n90 = await require('../routes/voiceCalibration').deleteExpiredTakes(pool);
    ck('the 90-day clean-up deletes takes, never grants or spend rows', n90 > 0 && (await q(`SELECT COUNT(*)::int AS n FROM voice_calibration_takes`))[0].n === 0 && await grants() === 12
      && JSON.stringify((await q(`SELECT kind, SUM(calls)::int AS n FROM voice_calibration_spend GROUP BY kind ORDER BY kind`))) === JSON.stringify(spendAfter), n90);
    // The export reads the ledgers: grants on deleted takes still count; the calls spent are kept.
    r = await A('GET', '/api/voice-calibration/admin/export.xlsx');
    const raw = Object.values(require('../services/xlsxLite').unzipStored(r.data)).map(String).join('\n');
    ck('the export\'s budget line comes from the ledger: 12 of 12, grants on takes since deleted still count; spent calls listed, deletion never lowers them',
      r.status === 200 && /12 of 12 asked for/.test(raw) && /grant\(s\) on takes since deleted still count/.test(raw) && /Deleting recordings never lowers these/.test(raw) && /replacement granted \(11 of 12\)/.test(raw), (raw.match(/.{0,80}of 12 asked for.{0,160}/) || [''])[0]);
    ck('…and the shared file still holds no volunteer name', !/Meera|Kulkarni|Arjun|Shetty/.test(raw));

    // Grants made before the ledger existed (Fixes-2z wrote only the take's column) join it at boot, up to 12, once.
    await pool.query(`DELETE FROM voice_calibration_replacement_grants`);
    const vNew = await mk(`Legacy Volunteer ${tag}`);
    await A('POST', '/api/voice-calibration/admin/invite', { member_id: vNew, group: 'hi', profile_note: '40s' });
    const pid = (await q(`SELECT id FROM voice_calibration_participants WHERE patient_id=$1`, [vNew]))[0].id;
    for (let i = 0; i < 14; i++) await pool.query(`INSERT INTO voice_calibration_takes (participant_id, slot_code, take_no, replacement_authorised) VALUES ($1, $2, 1, '{"why":"legacy","by":1}')`, [pid, `legacy-${i}`]);
    const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    await pool.query(schema); await pool.query(schema);
    const mig = await q(`SELECT grant_no, why FROM voice_calibration_replacement_grants ORDER BY grant_no`);
    ck('legacy grants join the ledger when the schema runs at boot: numbered 1..12, never past the cap, idempotent when it runs again', mig.length === 12 && mig[0].grant_no === 1 && mig[11].grant_no === 12 && mig.every(x => x.why === 'legacy'), mig.length);
  } catch (e) { ck('the suite ran to the end', false, e.stack); }
  finally {
    for (const t of TABLES) await pool.query(`DELETE FROM ${t}`).catch(() => {});
    server.close(); R2.server?.close?.(); await pool.end().catch(() => {});
  }
  console.log(`\nVoice calibration 3a review fixes: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
