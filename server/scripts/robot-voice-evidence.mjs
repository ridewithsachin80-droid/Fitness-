#!/usr/bin/env node
/**
 * scripts/robot-voice-evidence.mjs — the voice evidence robot (Fixes-2r, corrected in 2s, 2t and 2u).
 *
 * Collects REAL speech-provider evidence on the TEST SITE for B19 (Kannada pilot
 * re-run) and B18 (everyday Whisper fallback). The decisions (where it may run,
 * what counts as a pass, which evidence is this run's, what clean-up must leave)
 * live in lib/voice-evidence.mjs and are tested by test-voice-evidence-robot.mjs.
 *
 *   Checks before anything changes (any failure → BLOCKED, nothing touched):
 *     the target is exactly https://fitness-test.up.railway.app (or, with
 *     ROBOT_SIMULATION=1, this computer only, labelled SIMULATED everywhere);
 *     the server runs the expected commit and can check recordings for speech
 *     (Fixes-2u); the logins work; the voice account is the dedicated one (its
 *     name, and not a phone robot account); the voice backup switch is available
 *     and not held by another account; the two approved 19 Oct recordings are there.
 *   Part 1 (B19): Whisper with Kannada on the approved recordings ONLY (scoped
 *     request); an EMPTY earlier answer is asked again (Fixes-2u); the originals
 *     must not change; every attempt is listed.
 *   Part 2 (B18): the switch on for the voice account only;
 *     2a the REAL approved recordings through the real fallback (no screen);
 *     2b COMPUTER VOICE through the app's microphone and screen. Fixes-2u: every
 *        case runs in a brand-new page (fresh app, conversation, recorder); the
 *        robot proves the recorder started, that Stop ended the recording, and
 *        that the ACTUAL uploaded recording carries the intended sound (decoded
 *        and compared with the source). A capture that fails is INVALID, gets one
 *        repeat, and never counts. Each preview is checked item by item BEFORE
 *        Save; only a PASS is saved, then read back. A chat-only reply is
 *        recorded as such, with the day verified unchanged. Retry must re-send
 *        the identical recording (same SHA-256).
 *   Always (finally): the browser is closed, only this run's entries are
 *   removed and the day verified equal to before, the switch is turned off and
 *   verified off, and only this run's tries are reported. Screenshots of admin
 *   pages are cropped to the voice-test card and anonymised; every output is
 *   checked for member and coach names before it is written.
 *
 * Accounts (GitHub secrets): FITLIFE_ROBOT_ADMIN_EMAIL / _PASSWORD (an admin on
 * the TEST site); FITLIFE_ROBOT_VOICE_MEMBER_PHONE / _PIN (a member used ONLY by
 * this robot, named ROBOT_VOICE_MEMBER_NAME, default "Voice Robot").
 */
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { browserExecutable } from './lib/browser-executable.mjs';
import * as L from './lib/voice-evidence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../..');
const req = createRequire(import.meta.url);
const X = req('../services/xlsxLite');
const SP = req('../services/speechPresence');
const OUT = process.env.ROBOT_OUT || path.join(ROOT, 'qa/voice-evidence-results');
const GH = process.env.GITHUB_ACTIONS === 'true';
const SIM = process.env.ROBOT_SIMULATION === '1';
const env = k => (process.env[k] || '').trim();
const ghEsc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const ACC = {
  admin: { email: env('FITLIFE_ROBOT_ADMIN_EMAIL'), password: env('FITLIFE_ROBOT_ADMIN_PASSWORD') },
  member: { phone: env('FITLIFE_ROBOT_VOICE_MEMBER_PHONE'), pin: env('FITLIFE_ROBOT_VOICE_MEMBER_PIN') },
  name: env('ROBOT_VOICE_MEMBER_NAME') || 'Voice Robot',
  phoneRobotPhones: [env('FITLIFE_ROBOT_MEMBER_PHONE'), env('FITLIFE_ROBOT_MEMBER2_PHONE')].filter(Boolean),
};
fs.mkdirSync(path.join(OUT, 'audio'), { recursive: true });

const MODE_LINE = SIM ? 'SIMULATED — canned providers on this computer; NOT real results' : 'REAL providers on the test site';
const report = { mode: SIM ? 'simulation' : 'real', started: new Date().toISOString(), errors: [], notes: [], part1: null, part2: { collected: false, real: [], cases: [] } };
const digits = s => String(s || '').replace(/\D/g, '').slice(-10);
// SIMULATION ONLY: a broken microphone for chosen attempts ("S5:1" = S5's first attempt;
// "S5:1,S5:2" = both), to prove that an INVALID capture is caught. Refused on real runs.
const BREAK = new Set(SIM ? env('ROBOT_SIM_BREAK_CAPTURE').split(',').map(x => x.trim()).filter(Boolean) : []);
if (!SIM && env('ROBOT_SIM_BREAK_CAPTURE')) { console.error('ROBOT_SIM_BREAK_CAPTURE is for simulation only.'); process.exit(3); }

// ── Names never leave the robot (Fixes-2u) ──────────────────────────────────
// Every member, coach and administrator name the admin can see is held in memory
// only, used to anonymise screenshots and to check each output before it is written.
let knownNames = [];
const redactText = (t) => L.redactNames(t, knownNames);

// ── Report writing (also used for BLOCKED) ───────────────────────────────────
const cell = v => (v == null || v === '' ? '—' : String(v).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300));
const pct = v => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`);
const said = t => (t == null ? null : /\S/.test(String(t)) ? t : 'empty answer (no words)');
const capLine = a => !a.capture ? (a.invalid_reason ? `INVALID: ${a.invalid_reason}` : 'capture not checked')
  : `${a.capture.valid ? 'valid' : '**INVALID**'}: ${a.capture.reasons.join('; ')}${a.captured ? ` · captured ${a.captured.duration_ms} ms, voiced ${a.captured.voiced_ms} ms, sha ${a.captured.sha256}` : ''}`;
function writeReport() {
  report.finished = new Date().toISOString();
  const v = L.verdict(report);
  report.verdict = v;
  const sim = SIM ? ' (SIMULATED)' : '';
  const p1 = report.part1, p2 = report.part2;
  // INVALID captures have no quality and are not counted (Fixes-2u).
  const q = (p2.cases || []).reduce((a, c) => (c.quality && !c.invalid ? (a[c.quality] = (a[c.quality] || 0) + 1, a) : a), {});
  const invalidN = (p2.cases || []).filter(c => c.invalid).length;
  const md = [
    SIM ? '> **SIMULATED RUN — NOT REAL RESULTS.** Canned stand-ins replaced the speech/AI providers and storage on this computer. Nothing here is evidence about recognition.\n' : '',
    `# Voice evidence robot${sim} — ${report.finished.slice(0, 16).replace('T', ' ')} UTC`, '',
    `${MODE_LINE} · target ${cell(report.target)} · server ${report.server_commit ? report.server_commit.slice(0, 7) : SIM ? 'not checked (simulation)' : 'unconfirmed'} · speech check on the server: ${report.speech_check === true ? 'available' : report.speech_check === false ? 'NOT available' : '—'}`, '',
    `**Run: ${v.run}**${v.failures.length ? ` — failed: ${v.failures.map(cell).join(' · ')}` : ''}${v.incomplete.length ? ` — incomplete: ${v.incomplete.map(cell).join(' · ')}` : ''}`, '',
    report.blocked ? '' : `**Recognition quality (not an acceptance): ${['PASS', 'FAIL', 'UNVERIFIED'].map(k => `${q[k] || 0} ${k}`).join(' · ')}${invalidN ? ` · ${invalidN} INVALID capture(s), not counted` : ''}** — "Run COMPLETE" means the evidence was collected and the site left as found; it does not mean the voice features passed.`, '',
    ...(report.blocked ? [`Nothing was changed on the site. Reason: ${cell(report.blocked)}`] : []),
    ...(p1 ? [`## Part 1${sim} — B19: Whisper · Kannada on the approved 19 Oct recordings (REAL human recordings)`, '',
      `Approved recordings: ${p1.approved_count}. Re-run requested for those only: ${cell(p1.screen_message)}. ${p1.not_asked?.length ? `Not asked again (already an answer with words): ${p1.not_asked.join(', ')}. ` : ''}Other recordings (${p1.unapproved_count ?? '—'}): ${p1.unapproved_touched?.length ? `**re-runs CHANGED: ${p1.unapproved_touched.join(', ')}**` : 're-runs unchanged (none reprocessed)'}. Results Excel export: ${p1.export_ok ? 'available' : 'NOT available'}.`, '',
      '| Line | Said | Original Gemini | Original Whisper | Originals unchanged | Whisper · Kannada now | Script | In English letters | Keyword score | Rule checks | Every attempt (oldest first) |', '|---|---|---|---|---|---|---|---|---|---|---|',
      ...p1.samples.map(s => `| ${s.phrase_id} | ${cell(s.say)} | ${cell(s.original.gemini)} (${pct(s.original.gemini_score)}) | ${cell(s.original.whisper)} (${pct(s.original.whisper_score)}) | ${s.original_unchanged ? 'yes' : '**NO**'} | ${cell(said(s.whisper_kn?.text) ?? s.whisper_kn?.problem)} | ${cell(s.whisper_kn?.script)} | ${cell(s.whisper_kn?.latin)} | ${pct(s.whisper_kn?.score)} | ${cell((s.whisper_kn?.checks || []).map(k => `${k.label} ${k.result === 'pass' ? '✓' : k.result === 'unverified' ? '?' : '✗'}`).join(', '))} | ${cell((s.attempts || []).map(a => `${a.outcome === 'transcript' ? `"${a.text}"` : a.outcome === 'empty' ? 'empty' : `no answer (${a.error || ''})`} ${String(a.at || '').slice(0, 16).replace('T', ' ')}${a.source === 'kept_from_latest' ? ' [earlier answer kept]' : ''}`).join(' → '))} |`), ''] : []),
    ...(p2.collected || p2.cases.length ? [`## Part 2${sim} — B18: everyday fallback (Gemini skipped for the voice test account only)`, '',
      `Switch: turned on for the voice test account; off at the end: **${report.switch_off ? (report.switch_off.verified ? 'verified off' : 'NOT CONFIRMED — see below') : 'not turned on'}**.`, '',
      `### 2a${sim}. REAL approved recordings (human voice), sent as stored, no screen`, '',
      '| Line | Voice language | HTTP | Server speech check | Transcript passed on | Refused (reason) |', '|---|---|---|---|---|---|',
      ...p2.real.map(r => `| ${r.phrase_id} | ${r.voice_language} | ${r.status} | ${cell(r.speech ? `${r.speech.status}${r.speech.voiced_ms != null ? ` (voiced ${r.speech.voiced_ms} ms)` : ''}` : null)} | ${cell(r.transcript)} | ${cell(r.rejected)} |`), '',
      `### 2b${sim}. COMPUTER VOICE (espeak-ng) through the app's microphone and screen — each case in a fresh page`, '',
      '| Case | Voice language | Said | Expected | Capture (actual upload vs source) | Server | Preview / reply | Quality | Saved / read back / nothing saved |', '|---|---|---|---|---|---|---|---|---|',
      ...p2.cases.map(c => `| ${c.id} | ${c.lang} | ${cell(c.say)} | ${cell(c.plain)} | ${cell((c.attempts || []).map(a => `attempt ${a.n}: ${capLine(a)}`).join(' · '))} | ${c.invalid ? '—' : !c.transcribed ? 'NO ANSWER' : c.outcome === 'preview' || c.outcome === 'chat_reply' ? `accepted: "${cell(c.transcript)}"` : c.outcome === 'refused' ? `refused: ${cell(c.rejected)}` : `ERROR (HTTP ${c.status ?? '—'}, not a refusal)`}${c.speech ? ` · speech check: ${c.speech.status}` : ''}${c.error ? ` · **stopped: ${cell(c.error)}**` : ''} | ${c.outcome === 'chat_reply' ? `chat reply, no log card: "${cell(c.reply)}"` : cell(c.preview_text)}${c.retry ? ` · Retry: ${c.retry.identical ? 'identical recording re-sent (SHA-256 match)' : `NOT identical (${cell(c.retry.detail)})`}` : ''} | **${c.invalid ? 'INVALID (not counted)' : c.quality || '—'}**${c.quality_reasons?.length ? ': ' + cell(c.quality_reasons.join('; ')) : ''}${c.quality_notes?.length ? ` · note: ${cell(c.quality_notes.join('; '))}` : ''} | ${cell(c.save_note)}${c.readback ? ` · read back: ${c.readback.result}${c.readback.reasons.length ? ' (' + cell(c.readback.reasons.join('; ')) + ')' : ''}` : ''}${c.no_save_verified === true ? ' · day unchanged ✓' : c.no_save_verified === false ? ` · **day CHANGED: ${cell(c.no_save_detail.join('; '))}**` : ''}${c.normalisation ? ` · ${cell(c.normalisation)}` : ''} |`), ''] : []),
    ...(report.cleanup ? [`## Clean-up${sim}`, '', `Removed ${report.cleanup.removed} entr${report.cleanup.removed === 1 ? 'y' : 'ies'} this run created${report.cleanup.weight_restored ? '; weight restored to what it was' : ''}${report.cleanup.other_fields_restored?.length ? `; also restored: ${cell(report.cleanup.other_fields_restored.join('; '))}` : ''}. Compared with before the run: every entry (duplicates counted), weight, water, sleep, activities, ACV, supplements, notes, and the day's workouts. Day equal to before the run: **${report.cleanup.ok ? 'yes' : 'NO — ' + cell(report.cleanup.problems.join('; '))}**. Entries that existed before the run: ${report.cleanup.baseline_items}, untouched.${report.cleanup.normalisation ? ` ${cell(report.cleanup.normalisation)}.` : ''}`, ''] : []),
    ...(report.switch_off && !report.switch_off.verified ? ['## ⚠️ Voice backup switch NOT confirmed off', '', `Detail: ${cell(report.switch_off.detail)}. **Turn it off by hand:** Admin → Voice backup test → Turn off. If that is not possible it turns itself off 24 hours after it was set.`, ''] : []),
    ...(report.runs?.length ? [`### What Whisper returned${sim} (this run's tries only; section numbers in the Excel file)`, '',
      '| Try | Voice language | Told | Speech check | Whisper called | Whisper text (raw) | Language reported | Decision | Sections (log-prob / no-speech / compression) |', '|---|---|---|---|---|---|---|---|---|',
      ...report.runs.map(r => `| ${r.id} | ${cell(r.lang_hint)} | ${cell(r.language_sent || 'not set')} | ${cell(r.speech?.status)} | ${r.config ? (r.config.provider_called === false ? 'no' : 'yes') : '—'} | ${cell(r.whisper_text)} | ${cell(r.whisper_language)} | ${r.accepted === true ? 'accepted' : r.accepted === false ? `refused: ${cell(r.reason)}` : `no answer: ${cell(r.error)}`} | ${cell((r.segments || []).map(s => `${s.avg_logprob ?? '∅'}/${s.no_speech_prob ?? '∅'}/${s.compression_ratio ?? '∅'}`).join(' · '))} |`), ''] : []),
    report.notes.length ? `Notes: ${report.notes.map(cell).join(' · ')}` : '', '',
    'Computer voices show how the real providers and FitLife\'s checks behave; they say nothing about how well real members are understood, and an injected computer recording is not a physical phone microphone. Two real recordings are far too few to choose an engine. No member names are included; the voice test account is the robot\'s own; human recordings are never saved by the robot.',
  ].filter(x => x !== null).join('\n');
  const mdOut = redactText(md), jsonOut = redactText(JSON.stringify(report, (k, val) => (val instanceof RegExp ? String(val) : val), 1));
  if (mdOut.hits || jsonOut.hits) console.log(`::warning::identifying text found and replaced in the report (${mdOut.hits + jsonOut.hits})`);
  fs.writeFileSync(path.join(OUT, 'report.md'), mdOut.text + '\n');
  fs.writeFileSync(path.join(OUT, 'results.json'), jsonOut.text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, mdOut.text + '\n');
  if (GH) {
    if (v.run === 'BLOCKED') console.log(`::error title=Voice evidence robot BLOCKED (nothing tested)::${ghEsc(report.blocked)}`);
    for (const f of v.failures.slice(0, 8)) console.log(`::error title=Voice evidence robot failed::${ghEsc(redactText(f).text)}`);
    if (report.switch_off && !report.switch_off.verified) console.log(`::error title=Voice backup switch may still be ON::${ghEsc('Admin → Voice backup test → Turn off. Otherwise it turns itself off 24 hours after it was set.')}`);
  }
  console.log(redactText(`\nVoice evidence robot${sim}: run ${v.run}${v.failures.length ? ' — ' + v.failures.join(' · ') : ''}${v.incomplete.length ? ' — incomplete: ' + v.incomplete.join(' · ') : ''}`).text);
  return v;
}
function block(reason) { report.blocked = reason; process.exit(writeReport().exitCode); }

// ── 1. Target and deployment ────────────────────────────────────────────────
const target = L.checkTarget(process.env.ROBOT_BASE_URL || L.TEST_ORIGIN, { simulation: SIM });
report.target = target.origin || process.env.ROBOT_BASE_URL;
if (!target.ok) block(target.reason);
const BASE = target.origin;
const missing = Object.entries({ FITLIFE_ROBOT_ADMIN_EMAIL: ACC.admin.email, FITLIFE_ROBOT_ADMIN_PASSWORD: ACC.admin.password,
  FITLIFE_ROBOT_VOICE_MEMBER_PHONE: ACC.member.phone, FITLIFE_ROBOT_VOICE_MEMBER_PIN: ACC.member.pin }).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) block(`the robot's test-site logins are missing: ${missing.join(', ')} (GitHub → Settings → Secrets and variables → Actions).`);
if (ACC.phoneRobotPhones.some(p => digits(p) === digits(ACC.member.phone))) block('the voice account is one of the phone robot\'s accounts; it must be a separate member used only by this robot.');
if (!SIM) {
  const dep = await L.checkDeployment({ origin: BASE, expect: env('ROBOT_EXPECT_COMMIT') || env('GITHUB_SHA'), log: console.log,
    waitMs: Number(env('ROBOT_DEPLOY_WAIT_MS')) || 15 * 60e3 });
  if (!dep.ok) block(dep.reason);
  report.server_commit = dep.commit;
}
// Fixes-2u: the server must be able to check recordings for speech (the silence refusal).
try {
  const h = await (await fetch(`${BASE}/health?speech=${Date.now()}`)).json();
  report.speech_check = h.speech_check === true;
  if (h.speech_check !== true) block('the server cannot check recordings for speech (no ffmpeg on the server, or an older server), so the Fixes-2u silence refusal would not be tested.');
} catch (e) { block(`health check failed: ${e.message}`); }

// ── API sessions (fresh token when older than 10 minutes, or on a 401) ──────
const sessions = {};
async function login(kind) {
  const r = kind === 'admin'
    ? await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ACC.admin.email, password: ACC.admin.password }) })
    : await fetch(`${BASE}/api/auth/pin-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: digits(ACC.member.phone), pin: ACC.member.pin }) });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200 || !j.accessToken) throw new Error(`${kind === 'admin' ? 'admin' : 'voice account'} sign-in replied ${r.status}${j.error ? `: ${j.error}` : ''}`);
  sessions[kind] = { auth: `Bearer ${j.accessToken}`, at: Date.now(), user: j.user };
  return sessions[kind];
}
async function api(kind, method, url, body, raw = false) {
  if (!sessions[kind] || Date.now() - sessions[kind].at > 10 * 60e3) await login(kind);
  const go = () => fetch(BASE + url, { method, headers: { Authorization: sessions[kind].auth, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let r = await go();
  if (r.status === 401) { await login(kind); r = await go(); }
  if (raw) return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
  return { status: r.status, data };
}
const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const DAY = todayIST();
const dayOf = async () => { const r = await api('member', 'GET', `/api/logs/${DAY}`); if (r.status !== 200) throw new Error(`reading the voice account's day replied ${r.status}`); return r.data || {}; };
const snapshot = (d) => L.daySnapshot(d);   // every field of the day a Save can reach (Fixes-2t); blank sleep template = empty (Fixes-2u)
const workoutsOf = async () => { const r = await api('member', 'GET', `/api/workouts?date=${DAY}`); if (r.status !== 200) throw new Error(`reading the voice account's workouts replied ${r.status}`); return L.canon(r.data); };

// ── 2. Preflight: nothing changes until all of this holds ───────────────────
let voiceMember, baseline, baselineWorkouts, runsBefore, approved, originals, rerunsBefore, portions = [];
try {
  await login('admin'); await login('member');
  const members = await api('admin', 'GET', '/api/admin/members');
  const list = Array.isArray(members.data) ? members.data : members.data?.members || [];
  voiceMember = list.find(m => digits(m.phone) === digits(ACC.member.phone));
  if (!voiceMember) block('the voice account was not found among the members.');
  if (String(voiceMember.name).trim() !== ACC.name) block(`the voice account is not the dedicated robot account (its name is not "${ACC.name}").`);
  if (sessions.member.user?.id != null && sessions.member.user.id !== voiceMember.id) block('the voice sign-in does not belong to the expected account.');
  // Names to keep out of every output (held in memory only; never written).
  const coaches = await api('admin', 'GET', '/api/admin/coaches').catch(() => ({ data: [] }));
  const clist = Array.isArray(coaches.data) ? coaches.data : coaches.data?.coaches || [];
  knownNames = L.nameList([...list.map(m => m.name), ...list.map(m => m.monitor_name), ...clist.map(m => m.name), sessions.admin.user?.name], ACC.name);
  const sw = await api('admin', 'GET', '/api/voice-fallback-test');
  if (sw.status !== 200) block(`the voice backup switch replied ${sw.status}.`);
  if (!sw.data.available) block(`the voice backup switch is off on this server: ${sw.data.message || ''} (set FITLIFE_TEST_SERVER=yes on the TEST service only).`);
  if (sw.data.account && sw.data.account.user_id !== voiceMember.id) block(`the voice backup switch is in use by another account until ${sw.data.account.ends_at}; not replacing someone else's test.`);
  if (sw.data.account) report.notes.push('the switch was already on for the voice account (an earlier run); this run takes it over and turns it off at the end');
  runsBefore = new Set((sw.data.runs || []).map(r => r.id));
  // The tries list must name each try's account (Fixes-2s server); an older server would mix accounts.
  if ((sw.data.runs || []).some(r => !Object.prototype.hasOwnProperty.call(r, 'user_id'))) block('the server\'s tries list has no account id (an older server is running), so this run\'s evidence could not be separated.');
  report.preflight = { user_id_in_tries: true, tries_before: (sw.data.runs || []).length, dedicated_account: true, switch_free: !sw.data.account || sw.data.account.user_id === voiceMember.id };
  const res = await api('admin', 'GET', '/api/voice-pilot/results');
  if (res.status !== 200) block(`the voice pilot results replied ${res.status}.`);
  approved = L.approvedSamples(res.data.samples);
  // Fixes-2t: the approved set is validated BEFORE anything changes: exactly the 2 scripted lines of 19 Oct.
  if (approved.length !== 2) block(`expected exactly the 2 approved 19 Oct recordings, found ${approved.length}; nothing was re-run.`);
  rerunsBefore = Object.fromEntries((res.data.samples || []).map(s => [s.id, L.canon((s.reruns || []).map(({ attempts, ...x }) => x))]));
  originals = Object.fromEntries(approved.map(s => [s.id, { gemini: s.gemini, gemini_score: s.gemini_score, whisper: s.whisper, whisper_score: s.whisper_score }]));
  report.phrases = Object.fromEntries((res.data.phrases || []).map(p => [p.id, p.say]));
  // Fixes-2u: the member's own learned portions come before the dal 150 g default.
  const po = await api('member', 'GET', '/api/ai-chat/portions');
  portions = po.status === 200 ? (po.data.portions || []) : [];
  report.portions = portions.map(p => ({ phrase: p.phrase, grams: p.grams }));
  baseline = snapshot(await dayOf());
  baselineWorkouts = await workoutsOf();
} catch (e) { block(`preflight: ${e.message}`); }
const runStart = new Date().toISOString();

// ── 3. Browser ──────────────────────────────────────────────────────────────
const wait = ms => new Promise(r => setTimeout(r, ms));
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
let browser = null, shotN = 0;
const pageErrors = [];
/** Replace every known name on the page (text, inputs, labels) with "Member n". Returns how many were found. */
async function anonymise(page) {
  return page.evaluate((names) => {
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pairs = names.map((n, i) => [new RegExp(`\\b${esc(n)}\\b`, /\s/.test(n) ? 'gi' : 'g'), `[M${i + 1}]`]);   // a label no name can contain
    let hits = 0;
    const fix = (t) => { let o = String(t); for (const [rx, a] of pairs) o = o.replace(rx, () => { hits++; return a; }); return o; };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) { const t = fix(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; }
    for (const el of document.querySelectorAll('input, textarea')) { const t = fix(el.value); if (t !== el.value) el.value = t; }
    for (const el of document.querySelectorAll('[aria-label],[title],[placeholder],[alt]')) for (const a of ['aria-label', 'title', 'placeholder', 'alt']) { const v = el.getAttribute(a); if (v) { const t = fix(v); if (t !== v) el.setAttribute(a, t); } }
    return hits;
  }, knownNames);
}
/** Names (or their words of 4+ letters) still visible in the area to be photographed. */
async function namesLeft(page, selector) {
  return page.evaluate((names, sel) => {
    const root = sel ? document.querySelector(sel) : document.body; if (!root) return [];
    const text = root.innerText || '';
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return names.filter(n => new RegExp(`\\b${esc(n)}\\b`, /\s/.test(n) ? 'i' : '').test(text) || n.split(/\s+/).some(w => w.length >= 4 && new RegExp(`\\b${esc(w)}\\b`).test(text))).length;
  }, knownNames, selector || null);
}
/**
 * A screenshot that carries its mode, with names removed first (Fixes-2u). With
 * a selector, only that element is photographed (admin pages: the voice-test card).
 * If any name could not be removed, the picture is NOT taken.
 */
async function shot(page, name, { selector } = {}) {
  const f = `${String(++shotN).padStart(2, '0')}-${name}.png`;
  try {
    await anonymise(page);
    if (await namesLeft(page, selector)) { report.notes.push(`screenshot "${name}" not taken: identifying text could not be removed`); return null; }
    const label = `${MODE_LINE} · ${name}${selector ? ' · cropped, names removed' : ''}`;
    if (selector) {
      const el = await page.$(selector); if (!el) { report.notes.push(`screenshot "${name}" not taken: ${selector} not found`); return null; }
      await page.evaluate((s, t, sim) => { const d = document.createElement('div'); d.id = '__robot_banner'; d.textContent = t;
        d.style.cssText = `padding:4px 8px;font:600 11px sans-serif;text-align:center;color:#fff;background:${sim ? '#8a1c1c' : '#1f4d39'}`; document.querySelector(s).prepend(d); }, selector, label, SIM);
      await el.screenshot({ path: path.join(OUT, f) });
    } else {
      await page.evaluate((t, sim) => { const d = document.createElement('div'); d.id = '__robot_banner'; d.textContent = t;
        d.style.cssText = `position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:4px 8px;font:600 11px sans-serif;text-align:center;color:#fff;background:${sim ? '#8a1c1c' : '#1f4d39'}`; document.body.appendChild(d); }, label, SIM);
      await page.screenshot({ path: path.join(OUT, f) });
    }
    await page.evaluate(() => document.getElementById('__robot_banner')?.remove());
    return f;
  } catch { return null; }
}
async function setupPage(page, label) {
  await page.setUserAgent(UA); await page.setViewport(PHONE); page.setDefaultTimeout(20e3);
  page.on('pageerror', e => pageErrors.push(`${label}: ${e.message.slice(0, 200)}`));
  // The microphone: when a sound file is loaded, the app hears it once, then quiet.
  // Fixes-2u: everything it creates is kept so it can be released after each case.
  await page.evaluateOnNewDocument(() => {
    const orig = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    window.__micRelease = async () => {
      for (const x of window.__micParts || []) {
        try { x.src.stop(); } catch { /* not started */ }
        try { x.stream.getTracks().forEach(t => t.stop()); } catch { /* gone */ }
        try { await x.ctx.close(); } catch { /* closed */ }
      }
      window.__micParts = []; return true;
    };
    if (!orig) return;
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (!window.__micB64 || !c?.audio) return orig(c);
      const ctx = new AudioContext(); await ctx.resume().catch(() => {});
      const bytes = Uint8Array.from(atob(window.__micB64), ch => ch.charCodeAt(0));
      const buf = await ctx.decodeAudioData(bytes.buffer);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const dest = ctx.createMediaStreamDestination();
      // __micBroken: SIMULATION ONLY. The sound is played into a muted path, so the app records
      // and uploads SILENCE instead of the intended speech (the first run's suspected S5 failure).
      if (window.__micBroken) { const g = ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(dest); } else src.connect(dest);
      src.start(ctx.currentTime + 0.2);
      window.__micParts = [...(window.__micParts || []), { ctx, src, stream: dest.stream }];
      window.__micPlays = (window.__micPlays || 0) + 1;
      return dest.stream;
    };
  });
  return page;
}
async function newPage(label) {
  const ctx = await browser.createBrowserContext();
  return setupPage(await ctx.newPage(), label);
}
const must = (c, m) => { if (!c) throw new Error(m); };
const waitFor = (page, fn, arg, timeout = 20e3) => page.waitForFunction(fn, { timeout, polling: 250 }, arg);
async function tapText(page, re, sel = 'button,a,[role=button]') {
  const ok = await page.evaluate((s, f, sel) => { const rx = new RegExp(s, f); const el = [...document.querySelectorAll(sel)].find(e => e.offsetParent !== null && (rx.test(e.textContent.trim()) || rx.test(e.getAttribute('aria-label') || ''))); if (el) { el.click(); return true; } return false; }, re.source, re.flags, sel);
  must(ok, `nothing to tap matching ${re}`);
}
const visible = (page, re) => page.evaluate((s, f) => { const rx = new RegExp(s, f); return [...document.querySelectorAll('button,[role=button]')].some(e => e.offsetParent !== null && (rx.test(e.getAttribute('aria-label') || '') || rx.test(e.textContent.trim()))); }, re.source, re.flags);
async function uiAdminLogin(page) {
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type=tel]', { timeout: 30e3 });
  await tapText(page, /Coach \/ Admin/);
  await page.waitForSelector('input[type=email]', { visible: true });
  await page.type('input[type=email]', ACC.admin.email); await page.type('input[type=password]', ACC.admin.password);
  await tapText(page, /^Sign In/);
  await waitFor(page, () => /\/coach|\/admin/.test(location.pathname), null, 30e3);
}
async function uiMemberLogin(page) {
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type=tel]', { timeout: 30e3 });
  await page.type('input[type=tel]', digits(ACC.member.phone)); await page.type('input[type=password]', ACC.member.pin);
  await tapText(page, /^Log In/);
  await waitFor(page, () => document.querySelector('[data-testid="daily-essentials"], [data-testid="onb-next"], [data-testid="onb-primary"]'), null, 30e3);
  for (let i = 0; i < 8 && !(await page.$('[data-testid="daily-essentials"]')); i++) {
    await page.evaluate(() => {
      [...document.querySelectorAll('[data-testid="onb-modes"] button')].find(b => /Adult/.test(b.textContent))?.click();
      if (document.querySelector('[data-testid="onb-goals"]') && !document.querySelector('[data-testid="onb-goals"] button[aria-pressed="true"]')) document.querySelector('[data-testid="onb-goals"] button')?.click();
    });
    await wait(300);
    const next = await page.$('[data-testid="onb-next"]:not([disabled])') || await page.$('[data-testid="onb-primary"]:not([disabled])');
    if (next) await next.click(); await wait(1200);
  }
  await page.waitForSelector('[data-testid="daily-essentials"]', { timeout: 30e3 });
}
function makeAudio(c) {
  const raw = path.join(OUT, 'audio', `${c.id}-raw.wav`), out = path.join(OUT, 'audio', `${c.id}.wav`);
  const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
  if (c.kind === 'silence') ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '6', '-c:a', 'pcm_s16le', out]);
  else {
    execFileSync('espeak-ng', ['-v', c.voice, '-s', '140', '-w', raw, c.say]);
    if (c.kind === 'noisy') ff(['-i', raw, '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.5:duration=12:seed=7', '-filter_complex',
      '[0]volume=0.12,adelay=500|500,apad=pad_dur=4.5[v];[v][1]amix=inputs=2:duration=first:normalize=0', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', out]);
    else ff(['-i', raw, '-af', 'adelay=500|500,apad=pad_dur=4.5', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', out]);
  }
  const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim());
  return { b64: fs.readFileSync(out).toString('base64'), secs, file: out };
}
/** Decode any recording to 16 kHz mono and measure it: envelope, speech, duration. */
async function measure(buf) {
  const pcm = await SP.decode(buf);
  const sp = SP.analyse(pcm);
  return { env: L.envelopeDb(pcm), duration_ms: sp.duration_ms, voiced_ms: sp.voiced_ms, speech: sp };
}

// ── 4. The run ──────────────────────────────────────────────────────────────
let switchOn = false;
const createdKeys = [];
try {
  browser = await puppeteer.launch({ executablePath: await browserExecutable(chromium), headless: true,
    args: [...chromium.args.filter(a => !/single-process|no-zygote/.test(a)), '--no-sandbox', '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  // Part 1 (B19)
  try {
    // Fixes-2t: not the dashboard button (it re-runs every recording); a request naming ONLY the approved ones.
    // Fixes-2u: the server asks again where the earlier answer was EMPTY; one with words is not re-asked.
    const ids = approved.map(a => a.id), answers = [];
    for (let i = 0; i < 3; i++) {
      const r = await api('admin', 'POST', '/api/voice-pilot/results/rerun', { setting: 'kn', sample_ids: ids });
      if (r.status !== 200) throw new Error(`the scoped re-run replied ${r.status}: ${JSON.stringify(r.data).slice(0, 120)}`);
      answers.push(r.data);
      const stray = (r.data.sample_ids || []).filter(x => !ids.includes(x));
      if (stray.length) throw new Error(`the server re-ran recordings that were not asked for: ${stray.join(', ')}`);
      if (!r.data.more) break;
    }
    const sum = (k) => answers.reduce((n, d) => n + (Number(d[k]) || 0), 0);
    const counts = { requested: sum('asked'), responses: sum('responses'), with_words: sum('answered'), empty: sum('empty'), errors: sum('errors') };
    const askedIds = new Set(answers.flatMap(d => d.sample_ids || []));
    const msg = `${counts.requested} requested · ${counts.responses} provider responses · ${counts.with_words} with words · ${counts.empty} empty · ${counts.errors} errors${answers.some(d => d.problems?.length) ? ` (${[...new Set(answers.flatMap(d => d.problems || []))].join('; ')})` : ''}`;
    const A = await newPage('admin');
    await uiAdminLogin(A);
    await A.waitForSelector('[data-testid="vp-panel"]', { visible: true, timeout: 30e3 }).catch(() => {});
    await shot(A, 'B19-voice-test-card', { selector: '[data-testid="vp-panel"]' });
    await A.close().catch(() => {});
    const after = await api('admin', 'GET', '/api/voice-pilot/results');
    const byId = new Map((after.data.samples || []).map(s => [s.id, s]));
    const x = await api('admin', 'GET', '/api/voice-pilot/results.xlsx', null, true);
    let exportOk = false; try { exportOk = x.status === 200 && !!X.unzipStored(x.buf)['xl/worksheets/sheet2.xml']; } catch { exportOk = false; }
    // Every other recording's re-runs must be exactly as before.
    const unapproved = (after.data.samples || []).filter(x => !approved.some(a => a.id === x.id));
    const touched = unapproved.filter(x => L.canon((x.reruns || []).map(({ attempts, ...y }) => y)) !== (rerunsBefore[x.id] ?? L.canon([]))).map(x => `${x.phrase_id} (id ${x.id})`);
    report.part1 = { approved_count: approved.length, screen_message: msg, counts, export_ok: exportOk, unapproved_count: unapproved.length, unapproved_touched: touched,
      not_asked: approved.filter(a => !askedIds.has(a.id)).map(a => a.phrase_id),
      samples: approved.map(a => { const s = byId.get(a.id) || {};
        const now = { gemini: s.gemini, gemini_score: s.gemini_score, whisper: s.whisper, whisper_score: s.whisper_score };
        const kn = (s.reruns || []).find(r => r.engine === 'whisper' && r.setting === 'kn');
        return { phrase_id: a.phrase_id, say: report.phrases[a.phrase_id] || null, original: originals[a.id], original_unchanged: JSON.stringify(now) === JSON.stringify(originals[a.id]),
          asked_this_run: askedIds.has(a.id),
          whisper_kn: kn ? { text: kn.text, empty: kn.empty === true, script: kn.script, latin: kn.latin, language: kn.language, score: kn.score, checks: kn.checks, problem: kn.problem || null } : null,
          attempts: (kn?.attempts || []).map(t => ({ outcome: t.outcome, source: t.source, text: t.text, error: t.error, at: t.at, config: t.config ? { model: t.config.model, language: t.config.language, prompt_sha256: t.config.prompt_sha256, audio_sha256: t.config.audio_sha256 } : null })) }; }) };
    console.log(`B19: ${approved.length} approved recording(s); ${msg}; originals unchanged: ${report.part1.samples.every(s => s.original_unchanged)}`);
  } catch (e) { report.errors.push(`Part 1: ${e.message}`); }

  // Part 2 (B18)
  const on = await api('admin', 'PUT', '/api/voice-fallback-test', { user_id: voiceMember.id });
  if (on.status !== 200) throw new Error(`turning the switch on replied ${on.status}`);
  switchOn = true;
  const check = await api('admin', 'GET', '/api/voice-fallback-test');
  if (check.data.account?.user_id !== voiceMember.id) throw new Error('the switch did not show the voice account after turning it on');

  // 2a. The REAL approved recordings, exactly as stored. (Never saved by the robot; only their hash is kept.)
  const fresh = await api('admin', 'GET', '/api/voice-pilot/results');
  const freshById = new Map((fresh.data.samples || []).map(s => [s.id, s]));
  for (const a of approved) {
    const s = freshById.get(a.id);
    if (!s?.audio_url) { report.errors.push(`2a: no stored audio for ${a.phrase_id}`); continue; }
    const audio = await fetch(s.audio_url);
    if (!audio.ok) { report.errors.push(`2a: the stored recording ${a.phrase_id} could not be fetched (${audio.status})`); continue; }
    const ct = (audio.headers.get('content-type') || '').split(';')[0].trim(); const type = /^audio\//.test(ct) ? ct : 'audio/webm';
    const b64 = Buffer.from(await audio.arrayBuffer()).toString('base64');
    for (const langHint of ['kn-IN', 'en-IN']) {
      const r = await api('member', 'POST', '/api/ai-chat/voice-transcribe', { audio: b64, mimeType: type, langHint });
      report.part2.real.push({ phrase_id: a.phrase_id, voice_language: langHint, status: r.status, audio_sha256: L.sha256(b64).slice(0, 16),
        transcript: r.data?.transcript ?? null, rejected: r.data?.rejected ?? null, engine: r.data?.engine ?? null, speech: r.data?.speech ?? null });
      await wait(1500);
    }
  }

  // 2b. Computer voice through the screen. Every attempt in a brand-new page of ONE member
  // browser context (the sign-in cookie), so no recorder, conversation or old card carries over.
  const memberCtx = await browser.createBrowserContext();
  let signedIn = false;
  async function freshMemberPage(label) {
    const page = await setupPage(await memberCtx.newPage(), label);
    if (!signedIn) { await uiMemberLogin(page); signedIn = true; return page; }
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    if (!(await page.waitForSelector('[data-testid="daily-essentials"]', { timeout: 30e3 }).then(() => true, () => false))) await uiMemberLogin(page);
    return page;
  }

  async function runAttempt(c, src, n) {
    const at = { n, valid: false };
    const uploads = [], answered = [], parsed = [];
    let M = null;
    const onReq = (r) => {
      if (r.method() !== 'POST' || !/\/api\/ai-chat\/voice-transcribe$/.test(r.url())) return;
      uploads.push((async () => { let body = r.postData(); if (!body && r.hasPostData?.()) body = await r.fetchPostData().catch(() => null); try { return JSON.parse(body || '{}').audio || null; } catch { return null; } })());
    };
    const onResp = async (r) => {
      if (r.request().method() !== 'POST') return;
      if (/\/api\/ai-chat\/voice-transcribe$/.test(r.url())) answered.push({ status: r.status(), data: await r.json().catch(() => null) });
      if (/\/api\/ai-chat\/parse$/.test(r.url())) parsed.push({ status: r.status(), data: await r.json().catch(() => null) });
    };
    let dayAtStart = null;
    const verifyNoSave = async () => {
      await M.evaluate(() => document.querySelector('[aria-label="Close AI assistant"]')?.click()).catch(() => {}); await wait(3000);
      const now = snapshot(await dayOf());
      const detail = [...L.missingEntries(dayAtStart.food_items, now.food_items).map(f => `missing ${f.name}`), ...L.missingEntries(now.food_items, dayAtStart.food_items).map(f => `added ${f.name}`), ...L.changedFields(dayAtStart, now)];
      at.no_save_verified = detail.length === 0; at.no_save_detail = detail;
      const norm = L.sleepNormalisation(dayAtStart, now); if (norm) at.normalisation = norm;
    };
    try {
      M = await freshMemberPage(`${c.id}-attempt${n}`);
      dayAtStart = snapshot(await dayOf());
      await M.$eval('[data-testid="ai-type"]', b => b.click());
      await M.waitForSelector('[data-testid="composer-input"]', { visible: true, timeout: 15e3 });
      await M.select('[data-testid="voice-language-ready"]', c.lang);
      const broken = BREAK.has(`${c.id}:${n}`);
      await M.evaluate((b64, br) => { window.__micB64 = b64; window.__micBroken = br; window.__micPlays = 0; }, src.b64, broken);
      if (broken) at.simulated_broken_microphone = true;
      M.on('request', onReq); M.on('response', onResp);
      must(await visible(M, /^Speak your log$/), 'the record button was not ready');
      await tapText(M, /^Speak your log$/);
      // The recorder is ready only when the app shows recording AND the microphone stream was taken.
      at.recorder_ready = await waitFor(M, () => (window.__micPlays || 0) >= 1 && [...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === 'Stop recording'), null, 10e3).then(() => true, () => false);
      if (!at.recorder_ready) { at.invalid_reason = 'the recorder did not start (no recording state, or the microphone was never asked for)'; return at; }
      // The app stops by itself 3 s after a voice ends; silence never "starts", so the robot taps Stop after the sound.
      const t0 = Date.now(), soundEnd = t0 + (src.secs + 0.5) * 1000, hardStop = t0 + (src.secs + 6) * 1000;
      while (Date.now() < hardStop && !uploads.length) { await wait(250); if (c.kind === 'silence' && Date.now() > soundEnd && await visible(M, /^Stop recording$/)) { await tapText(M, /^Stop recording$/).catch(() => {}); at.stop_tapped = true; } }
      if (!uploads.length && await visible(M, /^Stop recording$/)) { await tapText(M, /^Stop recording$/).catch(() => {}); at.stop_tapped = true; }
      // Stop must actually end the recording: the recording state goes and the upload is sent.
      at.stop_ok = await (async () => { for (let i = 0; i < 40; i++) { if (uploads.length && !(await visible(M, /^Stop recording$/))) return true; await wait(250); } return false; })();
      if (!at.stop_ok) { at.invalid_reason = 'Stop did not end the recording (no upload, or still recording)'; return at; }
      // The ACTUAL uploaded recording, decoded and compared with the source sound.
      const b64 = await uploads[0];
      if (!b64) { at.invalid_reason = 'the uploaded recording could not be read'; return at; }
      const cbuf = Buffer.from(b64, 'base64');
      const cap = await measure(cbuf).catch(e => ({ error: e.message }));
      if (cap.error) { at.invalid_reason = `the uploaded recording could not be decoded (${cap.error})`; return at; }
      at.captured = { sha256: L.sha256(b64).slice(0, 16), bytes: cbuf.length, duration_ms: cap.duration_ms, voiced_ms: cap.voiced_ms };
      fs.writeFileSync(path.join(OUT, 'audio', `${c.id}-captured-attempt${n}.webm`), cbuf);   // computer voice only
      at.capture = L.captureCheck({ source: src.measured, captured: cap, kind: c.kind });
      if (at.capture.valid && cap.duration_ms > src.measured.duration_ms + 8000) at.capture = { ...at.capture, valid: false, reasons: [...at.capture.reasons, `the recording ran ${cap.duration_ms} ms for a ${src.measured.duration_ms} ms sound (Stop did not take)`] };
      // The server's answer is recorded even for an INVALID capture (it is a real try).
      for (let i = 0; i < 80 && !answered.length; i++) await wait(500);
      if (answered.length) { const t = answered[0].data || {}; Object.assign(at, { transcribed: true, status: answered[0].status, transcript: t.transcript ?? null, rejected: t.rejected ?? null, speech: t.speech ?? null }); }
      if (!at.capture.valid) { at.invalid_reason = at.capture.reasons.join('; '); await shot(M, `${c.id}-attempt${n}-INVALID-capture`); await verifyNoSave(); return at; }
      at.valid = true;
      must(answered.length, 'the app sent the recording but the server gave no answer within 40 s');
      const t = answered[0].data || {};
      // An explicit refusal is a 200 with no words AND a reason; anything else without words is an error, not a refusal.
      at.outcome = answered[0].status !== 200 ? 'error' : t.transcript ? 'preview' : t.rejected ? 'refused' : 'error';
      if (at.outcome === 'error') { at.save_note = 'nothing to save (provider/HTTP error, not a refusal)'; await shot(M, `${c.id}-error-answer`); await verifyNoSave(); return at; }
      if (at.outcome === 'preview') {
        // The parse decides: a NEW log card in this fresh page, or a chat-only reply (Fixes-2u).
        for (let i = 0; i < 120 && !parsed.length; i++) await wait(500);
        must(parsed.length, 'the transcript was accepted but the AI gave no answer within 60 s');
        if (parsed[0].status !== 200) throw new Error(`the AI answer failed (HTTP ${parsed[0].status})`);
        const pz = parsed[0].data || {};
        const card = await waitFor(M, () => { const b = [...document.querySelectorAll('[data-testid="ai-card-save"]')].pop(); return b && !b.disabled; }, null, 20e3).then(() => true, () => false);
        if (!card) {
          at.outcome = 'chat_reply';
          at.reply = String(pz.reply || pz.advice || pz.question || pz.mixed_question || '').slice(0, 400);
          const j = L.judgeChatReply(c); at.quality = j.result; at.quality_reasons = j.reasons;
          at.parse = { foods: (pz.foods || []).length, changes: L.unexpectedChanges(pz).changes };
          at.save_note = 'nothing saved (a chat reply, no log card)';
          await shot(M, `${c.id}-chat-reply`);
          await verifyNoSave();
          return at;
        }
        const items = { foods: (pz.foods || []).map(f => ({ name: f.name, qty_text: f.qty_text, grams: f.grams })), weight_kg: pz.weight_kg ?? null };
        const extra = L.unexpectedChanges(pz);
        at.preview_text = [items.weight_kg != null ? `weight ${items.weight_kg} kg` : null, ...items.foods.map(f => `${f.name} — ${f.qty_text || '?'} (${f.grams ?? '?'} g)`), ...extra.changes].filter(Boolean).join('; ') || '(no items)';
        // Everything Save would apply is judged, not only foods and weight (Fixes-2t); the dal portion rule with the member's own portions (Fixes-2u).
        const ev = L.evaluatePreview(c.expect, pz, { portions });
        at.quality = ev.result; at.quality_reasons = ev.reasons; at.quality_notes = ev.notes;
        await shot(M, `${c.id}-preview`);
        if (c.save && ev.result === 'PASS') {
          const dayBefore = snapshot(await dayOf()); const before = dayBefore.food_items;
          const k = await M.$$eval('[data-testid="ai-card-save-status"]', s => s.length);
          await M.evaluate(() => [...document.querySelectorAll('[data-testid="ai-card-save"]')].pop().click());
          at.save_confirmed = await waitFor(M, k => { const s = [...document.querySelectorAll('[data-testid="ai-card-save-status"]')]; return s.length > k && /^Saved/.test(s.pop().textContent.trim()); }, k, 45e3).then(() => true, () => false);
          await M.evaluate(() => document.querySelector('[aria-label="Close AI assistant"]')?.click()); await wait(6000);
          const dayAfter = snapshot(await dayOf());
          const created = L.addedItems(before, dayAfter.food_items);
          created.forEach(f => createdKeys.push(L.itemKey(f)));
          at.saved = true;
          // The weight is one value for the whole day: judge only what THIS save changed. The two kinds of failure apart (Fixes-2u).
          const wb = dayBefore.weight_kg, wa = dayAfter.weight_kg;
          at.readback = L.readbackResult(c.expect, { created, weight_kg: wa !== wb ? wa : null, lost: L.missingEntries(before, dayAfter.food_items), unrelated: L.changedFields(dayBefore, dayAfter, { except: ['weight_kg'] }) }, { portions });
          const norm = L.sleepNormalisation(dayBefore, dayAfter); if (norm) at.normalisation = norm;
          at.save_note = at.save_confirmed ? `Saved (${created.length} entr${created.length === 1 ? 'y' : 'ies'} created)` : 'NO "Saved" confirmation';
          await shot(M, `${c.id}-day`);
        } else { at.save_note = c.save ? `not saved: preview ${ev.result}` : 'not saved (by design)'; await verifyNoSave(); }
        return at;
      }
      // refused
      const j = L.judgeRefusal(c); at.quality = j.result; at.quality_reasons = j.reasons;
      at.preview_text = await M.evaluate(() => [...document.querySelectorAll('[data-testid="voice-composer"] [role=status]')].map(e => e.textContent.trim()).filter(Boolean).join(' | '));
      at.save_note = 'nothing to save';
      await shot(M, `${c.id}-refused`);
      if (c.retry) {
        const had = uploads.length;
        if (await M.$('[data-testid="voice-retry"]')) {
          await M.$eval('[data-testid="voice-retry"]', b => b.click());
          for (let i = 0; i < 80 && (uploads.length === had || answered.length <= had); i++) await wait(500);
        }
        const first = L.sha256(b64), again = uploads[had] ? L.sha256(await uploads[had]) : null;
        at.retry = { identical: !!again && first === again, detail: !again ? 'Retry sent nothing' : first === again ? 'same SHA-256' : `SHA-256 ${first.slice(0, 12)} → ${String(again).slice(0, 12)}`,
          transcript: answered[had]?.data?.transcript ?? null, rejected: answered[had]?.data?.rejected ?? null };
      }
      await M.$eval('[data-testid="voice-discard-take"]', b => b.click()).catch(() => {});
      await verifyNoSave();
      return at;
    } catch (e) { at.error = e.message; if (M) await shot(M, `${c.id}-attempt${n}-error`); if (M && dayAtStart) await verifyNoSave().catch(() => {}); return at; }
    finally {
      at.sent_count = uploads.length;
      if (M) { M.off('request', onReq); M.off('response', onResp); await M.evaluate(() => window.__micRelease?.()).catch(() => {}); await M.close().catch(() => {}); at.page_closed = true; }
    }
  }

  const COPY = ['transcribed', 'status', 'transcript', 'rejected', 'speech', 'outcome', 'reply', 'parse', 'preview_text', 'quality', 'quality_reasons', 'quality_notes', 'saved', 'save_confirmed', 'readback', 'save_note', 'no_save_verified', 'no_save_detail', 'retry', 'error', 'normalisation'];
  for (const c of L.CASES) {
    const row = { id: c.id, lang: c.lang, say: c.say, plain: c.plain, collected: false, transcribed: false, attempts: [] };
    report.part2.cases.push(row);
    try {
      const a = makeAudio(c);
      const src = { ...a, measured: await measure(fs.readFileSync(a.file)) };
      // One repeat when a capture is INVALID; an invalid capture never counts.
      for (let n = 1; n <= 2; n++) {
        const at = await runAttempt(c, src, n);
        row.attempts.push(at);
        if (at.valid || at.error) { for (const k of COPY) if (at[k] !== undefined) row[k] = at[k]; row.collected = !!at.transcribed; break; }
      }
      const last = row.attempts[row.attempts.length - 1];
      if (!last.valid && !last.error) { row.invalid = true; row.invalid_reasons = row.attempts.map(x => `attempt ${x.n}: ${x.invalid_reason}`); }
    } catch (e) { row.error = e.message; }
    row.sent_count = row.attempts.reduce((n, x) => n + (x.sent_count || 0), 0);
    console.log(`  ${c.id} ${c.lang}: ${row.invalid ? `INVALID capture (${row.invalid_reasons.join(' · ')})` : row.outcome === 'preview' ? `"${row.transcript}"` : row.outcome === 'chat_reply' ? `"${row.transcript}" → chat reply` : row.outcome === 'refused' ? `refused (${row.rejected})` : row.outcome === 'error' ? `ERROR (HTTP ${row.status})` : 'no answer'}${row.error ? ` · ERROR: ${row.error}` : ''} · quality ${row.invalid ? 'not counted' : row.quality || '—'} · ${row.save_note || ''} · attempts ${row.attempts.length}`);
    await wait(1500);
  }
  report.part2.collected = true;
} catch (e) {
  report.errors.push(`run: ${e.message}`);
} finally {
  // The browser first, so no open page can save the day over the clean-up.
  if (browser) await browser.close().catch(() => {});
  report.page_errors = pageErrors;
  // Clean-up: only this run's entries; the day must equal the baseline.
  try {
    const current = await dayOf();
    const plan = L.planCleanup(baseline, current, createdKeys);
    const otherFields = L.changedFields(baseline, snapshot(current));
    const weightChanged = otherFields.some(x => x.startsWith('weight_kg'));
    const sleepRawChanged = L.canon(snapshot(current).sleep_raw ?? null) !== L.canon(baseline.sleep_raw ?? null);
    if (plan.removed || otherFields.length || sleepRawChanged) {
      // Every field back to what it was before the run; entries only this run's removed (Fixes-2t); sleep exactly as it was (Fixes-2u).
      const body = { weight_kg: plan.weight_kg, activities: plan.activities, acv: plan.acv, food_items: plan.food_items, water_ml: plan.water_ml,
        supplements: plan.supplements, sleep: plan.sleep, notes: plan.notes, base_saved_at: current.saved_at };
      const w = await api('member', 'POST', `/api/logs/${DAY}`, body);
      if (w.status !== 200) throw new Error(`writing the day back replied ${w.status}`);
    }
    const afterDay = snapshot(await dayOf());
    const v = L.verifyCleanup(baseline, afterDay);
    if ((await workoutsOf()) !== baselineWorkouts) { v.ok = false; v.problems.push('the day\'s workouts changed'); }
    report.cleanup = { ...v, removed: plan.removed, weight_restored: weightChanged, other_fields_restored: otherFields.filter(x => !x.startsWith('weight_kg')), baseline_items: baseline.food_items.length,
      normalisation: L.sleepNormalisation(baseline, afterDay), sleep_raw_before: baseline.sleep_raw ?? null, sleep_raw_after: afterDay.sleep_raw ?? null };
  } catch (e) { report.cleanup = { ok: false, problems: [e.message], removed: 0, baseline_items: baseline?.food_items?.length ?? 0 }; }
  // The switch: off, and verified off, with a few tries.
  if (switchOn) {
    let detail = 'not attempted';
    for (let i = 1; i <= 3; i++) {
      try {
        const d = await api('admin', 'DELETE', '/api/voice-fallback-test');
        const g = await api('admin', 'GET', '/api/voice-fallback-test');
        if (g.status === 200 && (!g.data.account || g.data.account.user_id !== voiceMember.id)) { report.switch_off = { verified: true, detail: `off (attempt ${i})` }; break; }
        detail = `attempt ${i}: turn-off replied ${d.status}, switch still shows the voice account`;
      } catch (e) { detail = `attempt ${i}: ${e.message}`; }
      await wait(3000 * i);
    }
    if (!report.switch_off) report.switch_off = { verified: false, detail };
  }
  // Evidence: only this account's tries during this run.
  try {
    const g = await api('admin', 'GET', '/api/voice-fallback-test');
    const all = g.data.runs || [];
    report.runs = L.scopeRuns(all, { userId: voiceMember.id, since: runStart, before: runsBefore })
      .map(r => ({ id: r.id, created_at: r.created_at, lang_hint: r.lang_hint, language_sent: r.language_sent, whisper_text: r.whisper_text, whisper_language: r.whisper_language, segments: r.segments, accepted: r.accepted, reason: r.reason, transcript: r.transcript, error: r.error, speech: r.speech || null, config: r.config || null }));
    report.runs_excluded = all.length - report.runs.length;
    // Every recording this run sent as the voice account must appear once: no more (someone else's), no fewer.
    const expected = report.part2.real.length + report.part2.cases.reduce((n, c) => n + (c.sent_count || 0), 0);
    if (report.part2.collected && report.runs.length !== expected) report.part2.scope_problem = `this run's recorded tries: ${report.runs.length}, expected ${expected}`;
    // This run's own workbook: approved samples, this run's tries, the cases. Nothing else. Names checked first.
    const R = (rows) => rows.map(r => r.map(v => (typeof v === 'string' ? redactText(v).text : v)));
    const sec = report.runs.flatMap(r => (r.segments || []).map((s, i) => [r.id, i + 1, s.start, s.end, s.text, s.avg_logprob, s.no_speech_prob, s.compression_ratio]));
    fs.writeFileSync(path.join(OUT, `FitLife-Voice-Evidence${SIM ? '-SIMULATED' : ''}.xlsx`), X.workbook([
      { name: SIM ? 'READ ME - SIMULATED' : 'Read me', rows: [['what'], [MODE_LINE], [`target ${BASE}; server ${report.server_commit || '—'}; ${report.started} → ${new Date().toISOString()}`],
        ['Human recordings are not included (hashes only). Computer-voice captures are in the audio folder. INVALID captures are not counted.']] },
      { name: 'Pilot re-run', rows: R([['line', 'said', 'original_gemini', 'original_gemini_score', 'original_whisper', 'original_whisper_score', 'originals_unchanged', 'asked_this_run', 'whisper_kn_text', 'empty_answer', 'script', 'latin', 'keyword_score'],
        ...(report.part1?.samples || []).map(s => [s.phrase_id, s.say, s.original?.gemini, s.original?.gemini_score, s.original?.whisper, s.original?.whisper_score, String(s.original_unchanged), String(!!s.asked_this_run), s.whisper_kn?.text, String(!!s.whisper_kn?.empty), s.whisper_kn?.script, s.whisper_kn?.latin, s.whisper_kn?.score])]) },
      { name: 'Pilot attempts', rows: R([['line', 'outcome', 'recorded_as', 'text', 'error', 'model', 'language_sent', 'prompt_sha256', 'audio_sha256', 'attempted_at'],
        ...(report.part1?.samples || []).flatMap(s => (s.attempts || []).map(a => [s.phrase_id, a.outcome, a.source === 'kept_from_latest' ? 'earlier answer kept' : 'attempt', a.text, a.error, a.config?.model, a.config ? (a.config.language || 'not set') : '', a.config?.prompt_sha256, a.config?.audio_sha256, a.at]))]) },
      { name: 'Cases', rows: R([['case', 'voice_language', 'said', 'expected', 'attempts', 'capture', 'capture_r', 'capture_lag_ms', 'captured_ms', 'captured_sha256', 'server_speech_check', 'outcome', 'transcript', 'refused', 'preview_or_reply', 'quality', 'reasons', 'notes', 'saved', 'read_back', 'retry']
        , ...report.part2.cases.map(c => { const a = c.attempts?.[c.attempts.length - 1] || {}; return [c.id, c.lang, c.say, c.plain, (c.attempts || []).length, c.invalid ? 'INVALID' : a.capture?.valid ? 'valid' : a.invalid_reason ? 'INVALID' : '', a.capture?.correlation, a.capture?.lag_ms, a.captured?.duration_ms, a.captured?.sha256,
          c.speech?.status, c.invalid ? 'not counted' : c.outcome, c.transcript, c.rejected, c.outcome === 'chat_reply' ? `chat reply: ${c.reply}` : c.preview_text, c.invalid ? 'INVALID' : c.quality, (c.quality_reasons || []).join('; '), (c.quality_notes || []).join('; '), c.save_note,
          c.readback ? `${c.readback.result} ${c.readback.reasons.join('; ')}` : '', c.retry ? c.retry.detail : '']; })]) },
      { name: 'Fallback tries', rows: R([['try', 'time_utc', 'voice_language', 'told', 'speech_check', 'speech_voiced_ms', 'whisper_called', 'prompt_sha256', 'audio_sha256', 'whisper_text_raw', 'language_reported', 'decision', 'reason', 'transcript', 'error'],
        ...report.runs.map(r => [r.id, r.created_at, r.lang_hint, r.language_sent || 'not set', r.speech?.status, r.speech?.voiced_ms, r.config ? (r.config.provider_called === false ? 'no' : 'yes') : '', r.config?.prompt_sha256, r.config?.audio_sha256,
          r.whisper_text, r.whisper_language, r.accepted == null ? 'no answer' : r.accepted ? 'accepted' : 'refused', r.reason, r.transcript, r.error])]) },
      { name: 'Sections', rows: R([['try', 'section', 'start_s', 'end_s', 'text', 'avg_logprob', 'no_speech_prob', 'compression_ratio'], ...sec]) },
    ]));
  } catch (e) { report.errors.push(`evidence: ${e.message}`); }
}
process.exit(writeReport().exitCode);
