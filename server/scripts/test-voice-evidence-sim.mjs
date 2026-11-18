/**
 * scripts/test-voice-evidence-sim.mjs — Fixes-2s: the voice evidence robot,
 * run for real (browser, app build, server, Postgres) against this computer
 * with CANNED providers (scripts/sim/voice-evidence-providers.cjs). Every
 * result here is SIMULATED; it proves the robot's behaviour, not recognition.
 *
 * Scenarios:
 *   A  normal: the voice account already has food and a weight; another
 *      account's try lands during the run. Expect COMPLETE; previews checked;
 *      only PASS saved and read back; Retry identical; clean-up leaves the day
 *      exactly as before; switch verified off; only this run's tries reported.
 *   B  wrong previews (roti and dal added): nothing saved; still COMPLETE.
 *   C  the switch held by another account: BLOCKED; nothing changed.
 *   D  turning the switch off fails: FAILED, with the manual instructions.
 *   E  a re-run changes an original answer: FAILED.
 *   F  every preview also adds 1000 ml water nobody said (Fixes-2t): nothing saved, water unchanged.
 *   G  the preview never appears after transcription (Fixes-2t): not COMPLETE.
 *   H  (Fixes-2u) like the real Voice Robot: no day saved yet, and the pilot's
 *      Whisper re-run of k01 answers with no words. Then a second run.
 *   I  (Fixes-2u) the AI answers S1 in chat with no log card: a recorded outcome.
 *   J  (Fixes-2u) a microphone that delivers nothing: S1's first attempt and both
 *      of S3's. INVALID captures are repeated once, never counted.
 *   K  (Fixes-2v) a TARGETED run, S5 only (ROBOT_SCOPE=S5): its first attempt hears
 *      the background alone (no voice) → INVALID by the voice check; the second
 *      attempt is valid. No Kannada re-run, no real recordings, nothing else run.
 *   L  (Fixes-2v) the admin card picture asked for (ROBOT_ADMIN_SHOT=1) with
 *      invited members whose names must never reach the picture.
 *   M  (Fixes-2w) M1: OCR answers --version but every image read fails (a stand-in
 *      program as ROBOT_OCR_BIN): no picture is published; the run is INCOMPLETE.
 *      M2: the robot is killed (SIGKILL) right after its first picture: the
 *      picture is in the holding folder, never in the upload folder.
 *
 * Changed in Fixes-2u (scenario A): S5 (a voice buried under loud noise) is now
 * refused by the server's speech check before any provider, so it is a refusal
 * (allowed for S5) instead of the canned preview FAIL; the re-run line reads
 * "2 requested · 2 provider responses · 2 with words · 0 empty · 0 errors"
 * instead of "asked 2, answered 2". Both follow from the reviewed 2u changes.
 *
 * Needs: Postgres on 5433 (as the gate), espeak-ng, ffmpeg, the bundled Chromium
 * and client/dist. On demand (≈15 min), not part of the gate:
 *   node scripts/test-voice-evidence-sim.mjs [A B C D E F G H I J]
 */
import { spawn, spawnSync, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRV = path.join(HERE, '..');
const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs'); const { Client } = require('pg');
const PG = process.env.SIM_PG || 'postgres://postgres@localhost:5433';
const DB = 'fitlife_voice_sim', PORT = 3997, BASE = `http://localhost:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-sim-'));
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 400))); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const AUDIO = path.join(TMP, 'k01.webm');
execFileSync('espeak-ng', ['-v', 'kn', '-w', path.join(TMP, 'k01.wav'), 'ಬೆಳಗ್ಗೆ ಎರಡು ಇಡ್ಲಿ ಮತ್ತು ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್ ತಿಂದೆ']);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(TMP, 'k01.wav'), '-c:a', 'libopus', AUDIO]);

const OLD = [{ id: 'old-1', name: 'Idli', qty_text: '2 idli', grams: 80, meal: 'Breakfast', per_100g: { calories: 130 } }, { id: 'old-2', name: 'Coffee', qty_text: '1 cup', grams: 150, meal: 'Breakfast', per_100g: { calories: 40 } }];
const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

async function freshDb({ occupied = false, noDay = false } = {}) {
  const admin = new Client({ connectionString: `${PG}/postgres` }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  execFileSync('psql', [`${PG}/${DB}`, '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(SRV, 'db/schema.sql')], { stdio: ['ignore', 'ignore', 'pipe'] });
  const c = new Client({ connectionString: `${PG}/${DB}` }); await c.connect();
  const user = async (name, role, extra) => (await c.query(`INSERT INTO users (name, phone, email, password, role) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [name, extra.phone || null, extra.email || null, await bcrypt.hash(extra.secret, 8), role])).rows[0].id;
  const ids = {
    admin: await user('Sudha Acharya', 'admin', { email: 'admin@sim.test', secret: 'Admin#Sim1' }),
    voice: await user('Voice Robot', 'patient', { phone: '9000000101', secret: '2468' }),
    pilot: await user('Pallavi Murthy', 'patient', { phone: '9000000102', secret: '1111' }),
    other: await user('Omkar Tendulkar', 'patient', { phone: '9000000103', secret: '1111' }),
  };
  for (const id of [ids.voice, ids.pilot, ids.other]) await c.query('INSERT INTO patient_profiles (user_id) VALUES ($1)', [id]);
  if (!noDay) await c.query(`INSERT INTO daily_logs (patient_id, log_date, weight_kg, food_items, saved_at) VALUES ($1, $2, 81, $3, NOW() - INTERVAL '1 hour')`, [ids.voice, todayIST(), JSON.stringify(OLD)]);
  for (const [ph, at, g, w, sc] of [['k01', '2026-10-19T05:30:00Z', 'Belagge eradu idli ondu bowl sambar tinde', 'விளைகே இரடு இட்ளி', 0], ['k02', '2026-10-19T05:40:00Z', 'Breakfast ge ondu plate uppittu ondu cup coffee.', 'breakfast 1 cup coffee', 0.5],
    ['f01', '2026-10-19T05:50:00Z', 'my private own words', 'my private own words', 1], ['k03', '2026-10-20T05:00:00Z', 'other day', 'other day', 1]])
    await c.query(`INSERT INTO voice_samples (patient_id, phrase_id, object_key, mime_type, duration_ms, gemini_text, whisper_text, gemini_score, whisper_score, created_at) VALUES ($1,$2,$3,'audio/webm',3000,$4,$5,1,$6,$7)`, [ids.pilot, ph, `voice-pilot/${ids.pilot}/${ph}`, g, w, sc, at]);
  if (occupied) await c.query(`INSERT INTO voice_fallback_test_account (id, user_id, set_by) VALUES (1, $1, $2)`, [ids.other, ids.admin]);
  return { c, ids };
}
async function startServer(flags) {
  const child = spawn(process.execPath, ['-r', path.join(HERE, 'sim/voice-evidence-providers.cjs'), 'index.js'], { cwd: SRV,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: `${PG}/${DB}`, JWT_SECRET: 'sim-secret', JWT_REFRESH_SECRET: 'sim-refresh',
      RAILWAY_GIT_BRANCH: 'test', GEMINI_API_KEY: 'sim', GROQ_API_KEY: 'sim', CLIENT_URL: BASE, SIM_AUDIO_FILE: AUDIO, ...flags }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/health`)).ok) return { child, log: () => log }; } catch {} await wait(500); }
  child.kill(); throw new Error('the simulated server did not start:\n' + log.slice(-800));
}
// Not spawnSync: the scenario must be able to act while the robot runs.
async function robot(extra = {}, whileRunning) {
  const out = fs.mkdtempSync(path.join(TMP, 'out-'));
  const child = spawn(process.execPath, [path.join(HERE, 'robot-voice-evidence.mjs')], {
    // ROBOT_SCOPE 'all' (Fixes-2w): a full run unless the scenario asks for a targeted one; never the repo's REQUEST.md line.
    env: { ...process.env, ROBOT_SIMULATION: '1', ROBOT_BASE_URL: BASE, ROBOT_OUT: out, GITHUB_ACTIONS: '', GITHUB_SHA: '', ROBOT_SCOPE: 'all',
      FITLIFE_ROBOT_ADMIN_EMAIL: 'admin@sim.test', FITLIFE_ROBOT_ADMIN_PASSWORD: 'Admin#Sim1', FITLIFE_ROBOT_VOICE_MEMBER_PHONE: '9000000101', FITLIFE_ROBOT_VOICE_MEMBER_PIN: '2468', ...extra } });
  let text = ''; child.stdout.on('data', d => { text += d; }); child.stderr.on('data', d => { text += d; });
  const killer = setTimeout(() => child.kill(), 900e3);
  if (whileRunning) whileRunning(child);
  const status = await new Promise(r => child.on('close', r)); clearTimeout(killer);
  const r = { status, stdout: text, stderr: '' };
  const res = fs.existsSync(path.join(out, 'results.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')) : null;
  return { code: r.status, out, res, rep: fs.existsSync(path.join(out, 'report.md')) ? fs.readFileSync(path.join(out, 'report.md'), 'utf8') : '', stdout: r.stdout + r.stderr };
}
const dayNow = async (c, id) => (await c.query(`SELECT weight_kg, food_items FROM daily_logs WHERE patient_id=$1 AND log_date=$2`, [id, todayIST()])).rows[0];
// The database stores JSON keys in its own order: compare with keys sorted.
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
// Empty fields left out: saving a day makes the app add food_id: null to older entries (not a change).
const noNulls = (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v != null));
const sameDay = (d) => d && Number(d.weight_kg) === 81 && canon(d.food_items.map(noNulls)) === canon(OLD.map(noNulls));
const noNames = (rep) => !/Pallavi Murthy|Omkar Tendulkar|Voice Robot|Sudha Acharya|Pallavi|Murthy|Omkar|Tendulkar|Sudha|Acharya/.test(rep);
const EMPTY_FLAG = path.join(TMP, 'empty-k01');
const casesOf = (r) => Object.fromEntries((r.res?.part2?.cases || []).map(x => [x.id, x]));
// Every file the robot wrote: no names anywhere (report, results, workbook strings).
const outputsNameFree = (out) => fs.readdirSync(out).filter(f => /\.(md|json|xlsx)$/.test(f)).every(f => noNames(fs.readFileSync(path.join(out, f), 'latin1')));

const want = process.argv.slice(2).length ? process.argv.slice(2) : ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
const pngsIn = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String).filter(f => /\.png$/i.test(f)) : []);
for (const sc of want) {
  const flags = { B: { SIM_WRONG_PREVIEW: '1' }, D: { SIM_FAIL_SWITCH_OFF: '1' }, E: { SIM_TAMPER_ORIGINALS: '1' }, F: { SIM_EXTRA_WATER: '1' }, G: { SIM_PARSE_FAIL_WEIGHT: '1' }, H: { SIM_EMPTY_PILOT_K01_FILE: EMPTY_FLAG }, I: { SIM_CHAT_REPLY: '1' } }[sc] || {};
  const { c, ids } = await freshDb({ occupied: sc === 'C', noDay: sc === 'H' });
  const srv = await startServer(flags);
  try {
    if (sc === 'A') {
      console.log('\n[A] normal run (SIMULATED): pre-existing food kept, only PASS previews saved, scoped evidence');
      // Another account's try during the run must stay out of this run's evidence.
      setTimeout(() => c.query(`INSERT INTO voice_fallback_test_runs (user_id, lang_hint, whisper_text, accepted, transcript) VALUES ($1, 'en-IN', 'someone else', true, 'someone else')`, [ids.other]).catch(() => {}), 20e3);
      const r = await robot();
      const v = r.res?.verdict || {};
      ck('run COMPLETE, exit 0', r.code === 0 && v.run === 'COMPLETE', { code: r.code, v, tail: r.stdout.slice(-600) });
      const p1 = r.res?.part1 || {};
      ck('Part 1: only the 2 approved 19 Oct scripted recordings (not the own-words line, not 20 Oct); originals unchanged; Kannada re-runs present',
        p1.approved_count === 2 && p1.samples?.map(s => s.phrase_id).join() === 'k01,k02' && p1.samples.every(s => s.original_unchanged && s.whisper_kn?.text) && p1.export_ok, p1);
      ck('2a: 4 real-recording tries (2 recordings × Kannada / English)', r.res?.part2?.real?.length === 4, r.res?.part2?.real);
      const cs = Object.fromEntries((r.res?.part2?.cases || []).map(x => [x.id, x]));
      ck('S1–S3: preview PASS, saved, "Saved" confirmed, read back PASS', ['S1', 'S2', 'S3'].every(k => cs[k]?.quality === 'PASS' && cs[k].saved && cs[k].save_confirmed && cs[k].readback?.result === 'PASS'), ['S1', 'S2', 'S3'].map(k => cs[k]));
      ck('S4: refused as expected; Retry re-sent the identical recording (SHA-256 match)', cs.S4?.quality === 'PASS' && cs.S4.retry?.identical === true, cs.S4);
      // Changed in Fixes-2v: S5 recipe v2 (voice 0.45, verifiable). The server may refuse it (no_speech_detected) or pass it
      // on; either way nothing is saved, and its capture is valid only because the VOICE was found in the upload.
      ck('S5 v2: capture valid by the voice check (not just the background); refused or previewed, never saved, day unchanged', cs.S5?.attempts?.[0]?.capture?.voice_check?.valid === true && ['refused', 'preview'].includes(cs.S5.outcome) && !cs.S5.saved && cs.S5.no_save_verified === true, { v: cs.S5?.attempts?.[0]?.capture, o: cs.S5?.outcome, q: cs.S5?.quality });
      ck('S4 (silence) refused by the speech check BEFORE any provider (no Whisper text in its try)', cs.S4?.rejected === 'no_speech_detected' && (r.res?.runs || []).filter(x => x.reason === 'no_speech_detected').every(x => !x.whisper_text && x.config?.provider_called === false), { s4: cs.S4, runs: r.res?.runs?.map(x => [x.id, x.reason, x.whisper_text]) });
      ck('S3: "1 katori dal" shown as "1 bowl" (150 g) passed by the dal portion rule, saved and read back, wording and grams kept in a note', cs.S3?.quality === 'PASS' && /said "1 katori", shown "1 bowl" at 150 g/.test((cs.S3.quality_notes || []).join()) && cs.S3.readback?.result === 'PASS', cs.S3);
      ck('every case: one attempt, capture VALID (the actual upload decoded and matched to its source), page closed', ['S1', 'S2', 'S3', 'S4', 'S5'].every(k => cs[k]?.attempts?.length === 1 && cs[k].attempts[0].capture?.valid === true && cs[k].attempts[0].page_closed && cs[k].attempts[0].recorder_ready && cs[k].attempts[0].stop_ok), ['S1', 'S2', 'S3', 'S4', 'S5'].map(k => [k, cs[k]?.attempts?.map(a => [a.capture?.reasons, a.recorder_ready, a.stop_ok])]));
      ck('clean-up: the day is exactly as before (earlier idli and coffee intact, weight back to 81)', r.res?.cleanup?.ok && sameDay(await dayNow(c, ids.voice)), { cleanup: r.res?.cleanup, day: await dayNow(c, ids.voice) });
      ck('switch verified off', r.res?.switch_off?.verified === true && !(await c.query('SELECT 1 FROM voice_fallback_test_account')).rows.length);
      ck('only this run\'s tries reported; the other account\'s try excluded', r.res?.runs?.length > 0 && !r.res.runs.some(x => x.whisper_text === 'someone else') && r.res.runs_excluded >= 1 && !r.res.part2.scope_problem, { n: r.res?.runs?.length, ex: r.res?.runs_excluded });
      ck('labelled SIMULATED in the report, the Excel name and every screenshot\'s banner; no member names', /^> \*\*SIMULATED RUN/.test(r.rep) && fs.readdirSync(r.out).some(f => /SIMULATED\.xlsx$/.test(f)) && noNames(r.rep) && fs.readdirSync(r.out).filter(f => f.endsWith('.png')).length >= 5, fs.readdirSync(r.out));
      // Fixes-2t: the re-run reached ONLY the approved recordings.
      const rr = (await c.query(`SELECT s.phrase_id FROM voice_sample_reruns x JOIN voice_samples s ON s.id = x.sample_id ORDER BY 1`)).rows.map(x => x.phrase_id);
      ck('the re-run touched only k01 and k02: no re-run row for the own-words f01 or the other-day k03; report says the others were not reprocessed',
        rr.join() === 'k01,k02' && /2 requested · 2 provider responses · 2 with words · 0 empty · 0 errors/.test(r.res?.part1?.screen_message || '') && r.res?.part1?.unapproved_touched?.length === 0 && r.res.part1.unapproved_count === 2, { rr, p1: r.res?.part1 });
      // Changed in Fixes-2v: the admin card picture is left out of the public evidence by default (run-2 review, finding 1).
      const card = fs.readdirSync(r.out).find(f => /B19-voice-test-card\.png$/.test(f));
      ck('the admin card picture is left out by default (said in the report); every picture passed the OCR publication check; no name in any written file',
        !card && /admin card picture left out/.test((r.res?.notes || []).join()) && r.res?.publication?.checked > 0 && !(r.res.publication.removed || []).length && outputsNameFree(r.out), { card, notes: r.res?.notes, pub: r.res?.publication });
      ck('every case passed through all its stages (transcribed; preview or explicit refusal; quality; saved + read back, or day verified unchanged)',
        (r.res?.part2?.cases || []).every(x => x.transcribed && ['preview', 'refused'].includes(x.outcome) && x.quality && (x.saved ? x.save_confirmed && x.readback?.result === 'PASS' : x.no_save_verified === true)), r.res?.part2?.cases?.map(x => [x.id, x.outcome, x.quality, x.saved, x.no_save_verified]));
      ck('the pilot originals in the database are untouched', (await c.query(`SELECT whisper_score FROM voice_samples WHERE phrase_id IN ('k01','k02') ORDER BY phrase_id`)).rows.map(x => Number(x.whisper_score)).join() === '0,0.5');
    }
    if (sc === 'B') {
      console.log('\n[B] wrong previews (SIMULATED): nothing saved, run still COMPLETE');
      const r = await robot();
      const cs = Object.fromEntries((r.res?.part2?.cases || []).map(x => [x.id, x]));
      ck('S1 and S2 previews FAIL (roti and dal added) and are NOT saved; S3 (roti and dal really said) PASS, saved and read back',
        ['S1', 'S2'].every(k => cs[k]?.quality === 'FAIL' && !cs[k].saved && /not saved: preview FAIL/.test(cs[k].save_note)) && cs.S3?.quality === 'PASS' && cs.S3.saved && cs.S3.readback?.result === 'PASS',
        ['S1', 'S2', 'S3'].map(k => [k, cs[k]?.quality, cs[k]?.save_note]));
      ck('the reasons name the unexpected items', /unexpected Roti/.test(cs.S1?.quality_reasons?.join()) && /unexpected Dal/.test(cs.S1?.quality_reasons?.join()), cs.S1?.quality_reasons);
      ck('run COMPLETE (quality failures are reported, not hidden, and not a collection failure); day as before', r.code === 0 && r.res?.verdict?.run === 'COMPLETE' && sameDay(await dayNow(c, ids.voice)), { code: r.code, v: r.res?.verdict });
    }
    if (sc === 'C') {
      console.log('\n[C] switch held by another account (SIMULATED): BLOCKED, nothing changed');
      const r = await robot();
      ck('BLOCKED, exit 3, saying the switch is in use', r.code === 3 && /in use by another account/.test(r.rep), r.rep.slice(0, 500));
      ck('the other account still holds the switch; no tries; no re-runs; the day unchanged',
        (await c.query('SELECT user_id FROM voice_fallback_test_account')).rows[0]?.user_id === ids.other && !(await c.query('SELECT 1 FROM voice_fallback_test_runs')).rows.length
          && !(await c.query('SELECT 1 FROM voice_sample_reruns')).rows.length && sameDay(await dayNow(c, ids.voice)));
      ck('the blocked report names no one', noNames(r.rep));
    }
    if (sc === 'D') {
      console.log('\n[D] turning the switch off fails (SIMULATED): FAILED with manual instructions');
      const r = await robot();
      ck('FAILED, exit 1, "switch NOT confirmed off"', r.code === 1 && r.res?.verdict?.run === 'FAILED' && /NOT confirmed off/.test(r.res.verdict.failures.join()), r.res?.verdict);
      ck('the report says how to turn it off by hand and mentions the 24-hour fallback', /Turn it off by hand/.test(r.rep) && /24 hours/.test(r.rep));
      ck('clean-up still ran: the day is as before', sameDay(await dayNow(c, ids.voice)));
      await c.query('DELETE FROM voice_fallback_test_account');
    }
    if (sc === 'E') {
      console.log('\n[E] a re-run changes an original answer (SIMULATED): FAILED');
      const r = await robot();
      ck('FAILED, exit 1, naming the changed original', r.code === 1 && /original answers of k01 changed/.test(r.res?.verdict?.failures?.join()), r.res?.verdict);
      ck('switch verified off and the day as before, even so', r.res?.switch_off?.verified && sameDay(await dayNow(c, ids.voice)));
    }
    if (sc === 'F') {
      console.log('\n[F] every preview adds 1000 ml water nobody said (SIMULATED): nothing saved, water unchanged');
      const r = await robot();
      const cs = Object.fromEntries((r.res?.part2?.cases || []).map(x => [x.id, x]));
      ck('S1, S2, S3 previews FAIL with "unexpected change: water +1000 ml" and are NOT saved', ['S1', 'S2', 'S3'].every(k => cs[k]?.quality === 'FAIL' && /water \+1000 ml/.test((cs[k].quality_reasons || []).join()) && !cs[k].saved), ['S1', 'S2', 'S3'].map(k => [k, cs[k]?.quality, cs[k]?.quality_reasons]));
      ck('each verified that the day did not change; run COMPLETE (a quality failure, collected)', ['S1', 'S2', 'S3'].every(k => cs[k]?.no_save_verified === true) && r.res?.verdict?.run === 'COMPLETE', r.res?.verdict);
      const d = (await c.query(`SELECT water_ml FROM daily_logs WHERE patient_id=$1 AND log_date=$2`, [ids.voice, todayIST()])).rows[0];
      ck('the voice account\'s water is still 0 and the day as before', Number(d?.water_ml || 0) === 0 && sameDay(await dayNow(c, ids.voice)), d);
    }
    if (sc === 'G') {
      console.log('\n[G] the preview never appears after transcription (SIMULATED): never COMPLETE');
      const r = await robot();
      const cs = Object.fromEntries((r.res?.part2?.cases || []).map(x => [x.id, x]));
      ck('S1 was transcribed, then stopped with an error; no quality, nothing saved', cs.S1?.transcribed === true && !!cs.S1.error && !cs.S1.quality && !cs.S1.saved, cs.S1);
      ck('the run is INCOMPLETE (not COMPLETE), exit 1, naming S1 "after transcription"', r.code === 1 && r.res?.verdict?.run === 'INCOMPLETE' && /S1: .*after transcription/.test(r.res.verdict.incomplete.join()), r.res?.verdict);
      ck('clean-up and switch-off still done; day as before', r.res?.switch_off?.verified && sameDay(await dayNow(c, ids.voice)));
    }
    if (sc === 'H') {
      console.log('\n[H] like the real Voice Robot: no day saved yet; the k01 re-run answers with no words (SIMULATED)');
      fs.writeFileSync(EMPTY_FLAG, '1');
      const r = await robot();
      const cs = casesOf(r), p1 = r.res?.part1 || {};
      ck('first run S1 reproduced: the save writes the app\'s blank sleep template, which is NOT a change (raw values kept, rule explained); read back PASS',
        cs.S1?.readback?.result === 'PASS' && /blank template/.test(cs.S1.normalisation || '') && !(cs.S1.readback.unrelated || []).length, cs.S1);
      ck('the re-run counts: 2 requested · 2 provider responses · 1 with words · 1 empty · 0 errors', /2 requested · 2 provider responses · 1 with words · 1 empty · 0 errors/.test(p1.screen_message || ''), p1.screen_message);
      ck('k01\'s empty answer is shown as an empty answer (evidence), and the run is not INCOMPLETE because of it', p1.samples?.[0]?.whisper_kn?.empty === true && r.res?.verdict?.run === 'COMPLETE', { k01: p1.samples?.[0], v: r.res?.verdict });
      ck('clean-up: the day equal to before (no entries, no weight; sleep as it was)', r.res?.cleanup?.ok === true && !(((await dayNow(c, ids.voice))?.food_items) || []).length, r.res?.cleanup);
      fs.rmSync(EMPTY_FLAG);
      const r2 = await robot();
      const q = r2.res?.part1 || {};
      ck('second run: k01 (empty) is asked again within the approved scope; k02 (an answer with words) is not', /1 requested · 1 provider responses · 1 with words · 0 empty/.test(q.screen_message || '') && (q.not_asked || []).join() === 'k02', q);
      const att = q.samples?.[0]?.attempts || [];
      ck('k01\'s attempt history keeps the first empty answer and the new one, oldest first', att.length >= 2 && att[0].outcome === 'empty' && att[att.length - 1].outcome === 'transcript', att);
      const db = (await c.query(`SELECT a.outcome, a.source, a.config FROM voice_sample_rerun_attempts a JOIN voice_samples s ON s.id = a.sample_id WHERE s.phrase_id = 'k01' ORDER BY a.attempted_at, a.id`)).rows;
      ck('…in the database too, with the exact request (model, language kn, prompt and audio hashes)', db.some(x => x.outcome === 'empty') && db.some(x => x.outcome === 'transcript' && x.config?.language === 'kn' && x.config?.prompt_sha256 && x.config?.audio_sha256), db);
      ck('the pilot originals are untouched', (await c.query(`SELECT whisper_score FROM voice_samples WHERE phrase_id IN ('k01','k02') ORDER BY phrase_id`)).rows.map(x => Number(x.whisper_score)).join() === '0,0.5');
    }
    if (sc === 'I') {
      console.log('\n[I] the AI answers S1 in chat, no log card (SIMULATED): a recorded outcome, never a refusal');
      const r = await robot();
      const cs = casesOf(r);
      ck('S1: outcome chat_reply with the reply recorded; quality FAIL; nothing saved, the day verified unchanged', cs.S1?.outcome === 'chat_reply' && /Nothing new to log/.test(cs.S1.reply || '') && cs.S1.quality === 'FAIL' && !cs.S1.saved && cs.S1.no_save_verified === true, cs.S1);
      ck('the run counts it as collected (COMPLETE), the quality failure reported', r.res?.verdict?.run === 'COMPLETE' && /chat reply, no log card/.test(r.rep), r.res?.verdict);
      ck('day as before; switch verified off', sameDay(await dayNow(c, ids.voice)) && r.res?.switch_off?.verified);
    }
    if (sc === 'J') {
      console.log('\n[J] a microphone that delivers nothing (SIMULATED): INVALID captures repeated once, never counted');
      const r = await robot({ ROBOT_SIM_BREAK_CAPTURE: 'S1:1,S3:1,S3:2' });
      const cs = casesOf(r);
      ck('S1: attempt 1 INVALID (the upload does not follow the source sound), attempt 2 valid and counted (PASS, saved, read back)',
        cs.S1?.attempts?.length === 2 && cs.S1.attempts[0].capture?.valid === false && cs.S1.attempts[1].capture?.valid === true && cs.S1.quality === 'PASS' && cs.S1.readback?.result === 'PASS', cs.S1?.attempts?.map(a => a.capture));
      ck('S3: INVALID on both attempts → no quality, not counted; the run is INCOMPLETE naming S3', cs.S3?.invalid === true && !cs.S3.quality && r.res?.verdict?.run === 'INCOMPLETE' && /S3: capture INVALID/.test(r.res.verdict.incomplete.join()), { s3: cs.S3, v: r.res?.verdict });
      ck('the report\'s quality totals leave the INVALID capture out', /1 INVALID capture\(s\), not counted/.test(r.rep), r.rep.split('\n').find(l => /Recognition quality/.test(l)));
      ck('every recording sent is still accounted for in this run\'s tries (INVALID ones included)', !r.res?.part2?.scope_problem, r.res?.part2?.scope_problem);
      ck('day as before; switch verified off', sameDay(await dayNow(c, ids.voice)) && r.res?.switch_off?.verified);
    }
    if (sc === 'K') {
      console.log('\n[K] a targeted run, S5 only; its first attempt hears the background alone (SIMULATED)');
      const r = await robot({ ROBOT_SCOPE: 'S5', ROBOT_SIM_BREAK_CAPTURE: 'S5:1:noise' });
      const cs = casesOf(r), a = cs.S5?.attempts || [];
      ck('only S5 ran; no Kannada re-run and no real-recording tries; labelled TARGETED', Object.keys(cs).join() === 'S5' && !r.res?.part1 && !(r.res?.part2?.real || []).length && /TARGETED RUN: S5 only/.test(r.rep), { cases: Object.keys(cs), p1: !!r.res?.part1 });
      ck('attempt 1 (background alone): INVALID, and the voice check says why (voice check below 0.7: "does not carry the voice")', a[0]?.simulated_noise_only_microphone && a[0].capture?.valid === false && a[0].capture?.voice_check?.score < 0.7 && /does not carry the voice/.test((a[0].capture?.reasons || []).join()), a[0]?.capture);
      ck('attempt 2: valid, the voice found in the upload; counted', a[1]?.capture?.voice_check?.valid === true && !cs.S5.invalid && cs.S5.quality, a[1]?.capture);
      ck('run COMPLETE; day as before; switch verified off; the pilot re-runs untouched', r.res?.verdict?.run === 'COMPLETE' && sameDay(await dayNow(c, ids.voice)) && r.res?.switch_off?.verified && !(await c.query('SELECT 1 FROM voice_sample_reruns')).rows.length, r.res?.verdict);
    }
    if (sc === 'L') {
      console.log('\n[L] the admin card picture asked for, with invited members (SIMULATED)');
      for (const [i, n] of ['Lakshmi Narayan', 'Rohit Deshpande', 'Farida Khan'].entries()) {
        const id = (await c.query(`INSERT INTO users (name, phone, password, role) VALUES ($1,$2,'x','patient') RETURNING id`, [n, `90000003${i}0`])).rows[0].id;
        await c.query('INSERT INTO patient_profiles (user_id) VALUES ($1)', [id]);
        await c.query('INSERT INTO voice_pilot_members (patient_id, invited_by) VALUES ($1,$2)', [id, ids.admin]);
      }
      const r = await robot({ ROBOT_ADMIN_SHOT: '1', ROBOT_SCOPE: 'S1' });
      const card = fs.readdirSync(r.out).find(f => /B19-voice-test-card\.png$/.test(f));
      const { ocrText, nameHits } = await import('./lib/voice-evidence-shot.mjs');
      const names = ['Lakshmi Narayan', 'Rohit Deshpande', 'Farida Khan', 'Pallavi Murthy', 'Omkar Tendulkar', 'Sudha Acharya'];
      ck('a targeted run skips Part 1, so no admin picture is taken there either', !card, card);
      const r2 = await robot({ ROBOT_ADMIN_SHOT: '1' });
      const card2 = fs.readdirSync(r2.out).find(f => /B19-voice-test-card\.png$/.test(f));
      const notes = (r2.res?.notes || []).join(' ');
      ck('full run with the picture asked for: either a picture whose OCR text holds no name, or no picture with the reason given', card2 ? !nameHits(ocrText(path.join(r2.out, card2)), names).any : /admin card picture not taken/.test(notes), { card2, notes });
      ck('no name in any written file; the publication check removed nothing identifying', outputsNameFree(r2.out) && !(r2.res?.publication?.removed || []).some(x => /OCR read/.test(x.reason)), r2.res?.publication);
    }
    if (sc === 'M') {
      console.log('\n[M1] OCR available, but every image read fails (SIMULATED)');
      const failOcr = path.join(TMP, 'ocr-fails.sh');
      fs.writeFileSync(failOcr, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo stub; exit 0; fi\nexit 2\n'); fs.chmodSync(failOcr, 0o755);
      const tmp1 = fs.mkdtempSync(path.join(TMP, 'tmpdir-'));
      const r = await robot({ ROBOT_SCOPE: 'S1', ROBOT_OCR_BIN: failOcr, TMPDIR: tmp1 });
      const pub = r.res?.publication || {};
      ck('no picture reaches the upload folder; the cleared list is empty', pngsIn(r.out).length === 0 && fs.readFileSync(path.join(r.out, 'cleared-pictures.sha256'), 'utf8') === '', { pngs: pngsIn(r.out), pub });
      ck('every picture taken was removed as "not checked" (OCR could not finish), none cleared', pub.removed?.length > 0 && pub.removed.every(x => x.kind === 'unchecked' && /OCR could not finish/.test(x.reason)) && pub.cleared === 0 && pub.complete === false, pub);
      ck('run INCOMPLETE (not COMPLETE); the report says the pictures were not checked', r.res?.verdict?.run === 'INCOMPLETE' && /not checked: OCR could not finish/.test(r.rep), r.res?.verdict);
      ck('the holding folder is gone after the run; day as before; switch verified off', !fs.readdirSync(tmp1).some(f => f.startsWith('voice-evidence-unchecked-')) && sameDay(await dayNow(c, ids.voice)) && r.res?.switch_off?.verified);
      console.log('\n[M2] the robot killed right after its first picture (SIMULATED)');
      const tmp2 = fs.mkdtempSync(path.join(TMP, 'tmpdir-'));
      let killedWith = 0;
      const r2 = await robot({ ROBOT_SCOPE: 'S1', TMPDIR: tmp2 }, (child) => {
        const t = setInterval(() => { const held = pngsIn(tmp2); if (held.length) { killedWith = held.length; clearInterval(t); child.kill('SIGKILL'); } }, 100);
        child.on('close', () => clearInterval(t));
      });
      ck('the robot was killed with a picture taken (in the holding folder outside the upload folder)', killedWith > 0 && r2.code !== 0 && pngsIn(tmp2).length > 0, { killedWith, code: r2.code });
      ck('…and the upload folder holds no picture and no cleared list', pngsIn(r2.out).length === 0 && !fs.existsSync(path.join(r2.out, 'cleared-pictures.sha256')), pngsIn(r2.out));
      // The killed run may have left a log; restore the switch and day exactly as a real follow-up run would find them.
      await c.query('DELETE FROM voice_fallback_test_account').catch(() => {});
    }
  } catch (e) { ck(`scenario ${sc} completed`, false, e.stack); }
  finally { srv.child.kill(); await c.end(); await wait(800); }
}
console.log(`\nVoice evidence robot (SIMULATED end to end): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
