#!/usr/bin/env node
/**
 * scripts/robot-voice-evidence.mjs — the voice evidence robot (Fixes-2r, corrected in 2s).
 *
 * Collects REAL speech-provider evidence on the TEST SITE for B19 (Kannada pilot
 * re-run) and B18 (everyday Whisper fallback). The decisions (where it may run,
 * what counts as a pass, which evidence is this run's, what clean-up must leave)
 * live in lib/voice-evidence.mjs and are tested by test-voice-evidence-robot.mjs.
 *
 *   Checks before anything changes (any failure → BLOCKED, nothing touched):
 *     the target is exactly https://fitness-test.up.railway.app (or, with
 *     ROBOT_SIMULATION=1, this computer only, labelled SIMULATED everywhere);
 *     the server runs the expected commit; the logins work; the voice account
 *     is the dedicated one (its name, and not a phone robot account); the voice
 *     backup switch is available and not held by another account; the two
 *     approved 19 Oct recordings are there.
 *   Part 1 (B19): as admin, "Whisper · Kannada"; the originals must not change.
 *   Part 2 (B18): the switch on for the voice account only;
 *     2a the REAL approved recordings through the real fallback (no screen);
 *     2b COMPUTER VOICE through the app's microphone and screen. Each preview is
 *        checked item by item (food, count, unit, weight) BEFORE Save; only a
 *        PASS is saved, then read back from the day. Retry must re-send the
 *        identical recording (same SHA-256).
 *   Always (finally): the browser is closed, only this run's entries are
 *   removed and the day verified equal to before, the switch is turned off and
 *   verified off, and only this run's tries are reported.
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
const X = createRequire(import.meta.url)('../services/xlsxLite');
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

// ── Report writing (also used for BLOCKED) ───────────────────────────────────
const cell = v => (v == null || v === '' ? '—' : String(v).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300));
const pct = v => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`);
function writeReport() {
  report.finished = new Date().toISOString();
  const v = L.verdict(report);
  report.verdict = v;
  const sim = SIM ? ' (SIMULATED)' : '';
  const p1 = report.part1, p2 = report.part2;
  const q = (p2.cases || []).reduce((a, c) => (c.quality ? (a[c.quality] = (a[c.quality] || 0) + 1, a) : a), {});
  const md = [
    SIM ? '> **SIMULATED RUN — NOT REAL RESULTS.** Canned stand-ins replaced the speech/AI providers and storage on this computer. Nothing here is evidence about recognition.\n' : '',
    `# Voice evidence robot${sim} — ${report.finished.slice(0, 16).replace('T', ' ')} UTC`, '',
    `${MODE_LINE} · target ${cell(report.target)} · server ${report.server_commit ? report.server_commit.slice(0, 7) : SIM ? 'not checked (simulation)' : 'unconfirmed'}`, '',
    `**Run: ${v.run}**${v.failures.length ? ` — failed: ${v.failures.map(cell).join(' · ')}` : ''}${v.incomplete.length ? ` — incomplete: ${v.incomplete.map(cell).join(' · ')}` : ''}`, '',
    report.blocked ? '' : `**Recognition quality (not an acceptance): ${['PASS', 'FAIL', 'UNVERIFIED'].map(k => `${q[k] || 0} ${k}`).join(' · ')}** — "Run COMPLETE" means the evidence was collected and the site left as found; it does not mean the voice features passed.`, '',
    ...(report.blocked ? [`Nothing was changed on the site. Reason: ${cell(report.blocked)}`] : []),
    ...(p1 ? [`## Part 1${sim} — B19: Whisper · Kannada on the approved 19 Oct recordings (REAL human recordings)`, '',
      `Approved recordings: ${p1.approved_count}. Re-run requested for those only: ${cell(p1.screen_message)}. Other recordings (${p1.unapproved_count ?? '—'}): ${p1.unapproved_touched?.length ? `**re-runs CHANGED: ${p1.unapproved_touched.join(', ')}**` : 're-runs unchanged (none reprocessed)'}. Results Excel export: ${p1.export_ok ? 'available' : 'NOT available'}.`, '',
      '| Line | Said | Original Gemini | Original Whisper | Originals unchanged | Whisper · Kannada now | Script | In English letters | Keyword score | Rule checks |', '|---|---|---|---|---|---|---|---|---|---|',
      ...p1.samples.map(s => `| ${s.phrase_id} | ${cell(s.say)} | ${cell(s.original.gemini)} (${pct(s.original.gemini_score)}) | ${cell(s.original.whisper)} (${pct(s.original.whisper_score)}) | ${s.original_unchanged ? 'yes' : '**NO**'} | ${cell(s.whisper_kn?.text ?? s.whisper_kn?.problem)} | ${cell(s.whisper_kn?.script)} | ${cell(s.whisper_kn?.latin)} | ${pct(s.whisper_kn?.score)} | ${cell((s.whisper_kn?.checks || []).map(k => `${k.label} ${k.result === 'pass' ? '✓' : k.result === 'unverified' ? '?' : '✗'}`).join(', '))} |`), ''] : []),
    ...(p2.collected || p2.cases.length ? [`## Part 2${sim} — B18: everyday fallback (Gemini skipped for the voice test account only)`, '',
      `Switch: turned on for the voice test account; off at the end: **${report.switch_off ? (report.switch_off.verified ? 'verified off' : 'NOT CONFIRMED — see below') : 'not turned on'}**.`, '',
      `### 2a${sim}. REAL approved recordings (human voice), sent as stored, no screen`, '',
      '| Line | Voice language | HTTP | Transcript passed on | Refused (reason) |', '|---|---|---|---|---|',
      ...p2.real.map(r => `| ${r.phrase_id} | ${r.voice_language} | ${r.status} | ${cell(r.transcript)} | ${cell(r.rejected)} |`), '',
      `### 2b${sim}. COMPUTER VOICE (espeak-ng) through the app's microphone and screen`, '',
      '| Case | Voice language | Said | Expected | Server | Preview (structured) | Quality | Saved / read back / nothing saved |', '|---|---|---|---|---|---|---|---|',
      ...p2.cases.map(c => `| ${c.id} | ${c.lang} | ${cell(c.say)} | ${cell(c.plain)} | ${!c.transcribed ? 'NO ANSWER' : c.outcome === 'preview' ? `accepted: "${cell(c.transcript)}"` : c.outcome === 'refused' ? `refused: ${cell(c.rejected)}` : `ERROR (HTTP ${c.status ?? '—'}, not a refusal)`}${c.error ? ` · **stopped: ${cell(c.error)}**` : ''} | ${cell(c.preview_text)}${c.retry ? ` · Retry: ${c.retry.identical ? 'identical recording re-sent (SHA-256 match)' : `NOT identical (${cell(c.retry.detail)})`}` : ''} | **${c.quality || '—'}**${c.quality_reasons?.length ? ': ' + cell(c.quality_reasons.join('; ')) : ''} | ${cell(c.save_note)}${c.readback ? ` · read back: ${c.readback.result}${c.readback.reasons.length ? ' (' + cell(c.readback.reasons.join('; ')) + ')' : ''}` : ''}${c.no_save_verified === true ? ' · day unchanged ✓' : c.no_save_verified === false ? ` · **day CHANGED: ${cell(c.no_save_detail.join('; '))}**` : ''} |`), ''] : []),
    ...(report.cleanup ? [`## Clean-up${sim}`, '', `Removed ${report.cleanup.removed} entr${report.cleanup.removed === 1 ? 'y' : 'ies'} this run created${report.cleanup.weight_restored ? '; weight restored to what it was' : ''}${report.cleanup.other_fields_restored?.length ? `; also restored: ${cell(report.cleanup.other_fields_restored.join('; '))}` : ''}. Compared with before the run: every entry (duplicates counted), weight, water, sleep, activities, ACV, supplements, notes, and the day's workouts. Day equal to before the run: **${report.cleanup.ok ? 'yes' : 'NO — ' + cell(report.cleanup.problems.join('; '))}**. Entries that existed before the run: ${report.cleanup.baseline_items}, untouched.`, ''] : []),
    ...(report.switch_off && !report.switch_off.verified ? ['## ⚠️ Voice backup switch NOT confirmed off', '', `Detail: ${cell(report.switch_off.detail)}. **Turn it off by hand:** Admin → Voice backup test → Turn off. If that is not possible it turns itself off 24 hours after it was set.`, ''] : []),
    ...(report.runs?.length ? [`### What Whisper returned${sim} (this run's tries only; section numbers in the Excel file)`, '',
      '| Try | Voice language | Told | Whisper text (raw) | Language reported | Decision | Sections (log-prob / no-speech / compression) |', '|---|---|---|---|---|---|---|',
      ...report.runs.map(r => `| ${r.id} | ${cell(r.lang_hint)} | ${cell(r.language_sent || 'not set')} | ${cell(r.whisper_text)} | ${cell(r.whisper_language)} | ${r.accepted === true ? 'accepted' : r.accepted === false ? `refused: ${cell(r.reason)}` : `no answer: ${cell(r.error)}`} | ${cell((r.segments || []).map(s => `${s.avg_logprob ?? '∅'}/${s.no_speech_prob ?? '∅'}/${s.compression_ratio ?? '∅'}`).join(' · '))} |`), ''] : []),
    report.notes.length ? `Notes: ${report.notes.map(cell).join(' · ')}` : '', '',
    'Computer voices show how the real providers and FitLife\'s checks behave; they say nothing about how well real members are understood. Two real recordings are far too few to choose an engine. No member names are included; the voice test account is the robot\'s own.',
  ].filter(x => x !== null).join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md + '\n');
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(report, (k, val) => (val instanceof RegExp ? String(val) : val), 1));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  if (GH) {
    if (v.run === 'BLOCKED') console.log(`::error title=Voice evidence robot BLOCKED (nothing tested)::${ghEsc(report.blocked)}`);
    for (const f of v.failures.slice(0, 8)) console.log(`::error title=Voice evidence robot failed::${ghEsc(f)}`);
    if (report.switch_off && !report.switch_off.verified) console.log(`::error title=Voice backup switch may still be ON::${ghEsc('Admin → Voice backup test → Turn off. Otherwise it turns itself off 24 hours after it was set.')}`);
  }
  console.log(`\nVoice evidence robot${sim}: run ${v.run}${v.failures.length ? ' — ' + v.failures.join(' · ') : ''}${v.incomplete.length ? ' — incomplete: ' + v.incomplete.join(' · ') : ''}`);
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
const snapshot = (d) => L.daySnapshot(d);   // every field of the day a Save can reach (Fixes-2t)
const workoutsOf = async () => { const r = await api('member', 'GET', `/api/workouts?date=${DAY}`); if (r.status !== 200) throw new Error(`reading the voice account's workouts replied ${r.status}`); return L.canon(r.data); };

// ── 2. Preflight: nothing changes until all of this holds ───────────────────
let voiceMember, baseline, baselineWorkouts, runsBefore, approved, originals, rerunsBefore;
try {
  await login('admin'); await login('member');
  const members = await api('admin', 'GET', '/api/admin/members');
  const list = Array.isArray(members.data) ? members.data : members.data?.members || [];
  voiceMember = list.find(m => digits(m.phone) === digits(ACC.member.phone));
  if (!voiceMember) block('the voice account was not found among the members.');
  if (String(voiceMember.name).trim() !== ACC.name) block(`the voice account is not the dedicated robot account (its name is not "${ACC.name}").`);
  if (sessions.member.user?.id != null && sessions.member.user.id !== voiceMember.id) block('the voice sign-in does not belong to the expected account.');
  const sw = await api('admin', 'GET', '/api/voice-fallback-test');
  if (sw.status !== 200) block(`the voice backup switch replied ${sw.status}.`);
  if (!sw.data.available) block(`the voice backup switch is off on this server: ${sw.data.message || ''} (set FITLIFE_TEST_SERVER=yes on the TEST service only).`);
  if (sw.data.account && sw.data.account.user_id !== voiceMember.id) block(`the voice backup switch is in use by another account until ${sw.data.account.ends_at}; not replacing someone else's test.`);
  if (sw.data.account) report.notes.push('the switch was already on for the voice account (an earlier run); this run takes it over and turns it off at the end');
  runsBefore = new Set((sw.data.runs || []).map(r => r.id));
  // The tries list must name each try's account (Fixes-2s server); an older server would mix accounts.
  if ((sw.data.runs || []).some(r => !Object.prototype.hasOwnProperty.call(r, 'user_id'))) block('the server\'s tries list has no account id (an older server is running), so this run\'s evidence could not be separated.');
  const res = await api('admin', 'GET', '/api/voice-pilot/results');
  if (res.status !== 200) block(`the voice pilot results replied ${res.status}.`);
  approved = L.approvedSamples(res.data.samples);
  // Fixes-2t: the approved set is validated BEFORE anything changes: exactly the 2 scripted lines of 19 Oct.
  if (approved.length !== 2) block(`expected exactly the 2 approved 19 Oct recordings, found ${approved.length}; nothing was re-run.`);
  rerunsBefore = Object.fromEntries((res.data.samples || []).map(s => [s.id, L.canon(s.reruns || [])]));
  originals = Object.fromEntries(approved.map(s => [s.id, { gemini: s.gemini, gemini_score: s.gemini_score, whisper: s.whisper, whisper_score: s.whisper_score }]));
  report.phrases = Object.fromEntries((res.data.phrases || []).map(p => [p.id, p.say]));
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
async function shot(page, name) {
  const f = `${String(++shotN).padStart(2, '0')}-${name}.png`;
  try {
    // Every screenshot carries the mode, so a detached picture still says what it is.
    await page.evaluate((t, sim) => { const d = document.createElement('div'); d.id = '__robot_banner'; d.textContent = t;
      d.style.cssText = `position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:4px 8px;font:600 11px sans-serif;text-align:center;color:#fff;background:${sim ? '#8a1c1c' : '#1f4d39'}`; document.body.appendChild(d); }, `${MODE_LINE} · ${name}`, SIM);
    await page.screenshot({ path: path.join(OUT, f) });
    await page.evaluate(() => document.getElementById('__robot_banner')?.remove());
    return f;
  } catch { return null; }
}
async function newPage(label) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setUserAgent(UA); await page.setViewport(PHONE); page.setDefaultTimeout(20e3);
  page.on('pageerror', e => pageErrors.push(`${label}: ${e.message.slice(0, 200)}`));
  // The microphone: when a sound file is loaded, the app hears it once, then quiet.
  await page.evaluateOnNewDocument(() => {
    const orig = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (!orig) return;
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (!window.__micB64 || !c?.audio) return orig(c);
      const ctx = new AudioContext(); await ctx.resume().catch(() => {});
      const bytes = Uint8Array.from(atob(window.__micB64), ch => ch.charCodeAt(0));
      const buf = await ctx.decodeAudioData(bytes.buffer);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const dest = ctx.createMediaStreamDestination(); src.connect(dest); src.start(ctx.currentTime + 0.2);
      window.__micPlays = (window.__micPlays || 0) + 1;
      return dest.stream;
    };
  });
  return page;
}
const must = (c, m) => { if (!c) throw new Error(m); };
const waitFor = (page, fn, arg, timeout = 20e3) => page.waitForFunction(fn, { timeout, polling: 250 }, arg);
async function tapText(page, re, sel = 'button,a,[role=button]') {
  const ok = await page.evaluate((s, f, sel) => { const rx = new RegExp(s, f); const el = [...document.querySelectorAll(sel)].find(e => e.offsetParent !== null && (rx.test(e.textContent.trim()) || rx.test(e.getAttribute('aria-label') || ''))); if (el) { el.click(); return true; } return false; }, re.source, re.flags, sel);
  must(ok, `nothing to tap matching ${re}`);
}
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
    if (c.kind === 'noisy') ff(['-i', raw, '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.5:duration=12', '-filter_complex',
      '[0]volume=0.12,adelay=500|500,apad=pad_dur=4.5[v];[v][1]amix=inputs=2:duration=first:normalize=0', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', out]);
    else ff(['-i', raw, '-af', 'adelay=500|500,apad=pad_dur=4.5', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', out]);
  }
  const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim());
  return { b64: fs.readFileSync(out).toString('base64'), secs };
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
    const ids = approved.map(a => a.id), answers = [];
    for (let i = 0; i < 3; i++) {
      const r = await api('admin', 'POST', '/api/voice-pilot/results/rerun', { setting: 'kn', sample_ids: ids });
      if (r.status !== 200) throw new Error(`the scoped re-run replied ${r.status}: ${JSON.stringify(r.data).slice(0, 120)}`);
      answers.push(r.data);
      const stray = (r.data.sample_ids || []).filter(x => !ids.includes(x));
      if (stray.length) throw new Error(`the server re-ran recordings that were not asked for: ${stray.join(', ')}`);
      if (!r.data.more) break;
    }
    const msg = answers.map(d => `asked ${d.asked}, answered ${d.answered}${d.problems?.length ? ` (${d.problems.join('; ')})` : ''}`).join('; ');
    const A = await newPage('admin');
    await uiAdminLogin(A);
    await A.waitForSelector('[data-testid="vp-panel"]', { visible: true, timeout: 30e3 }).catch(() => {});
    await shot(A, 'B19-panel-after-rerun');
    const after = await api('admin', 'GET', '/api/voice-pilot/results');
    const byId = new Map((after.data.samples || []).map(s => [s.id, s]));
    const x = await api('admin', 'GET', '/api/voice-pilot/results.xlsx', null, true);
    let exportOk = false; try { exportOk = x.status === 200 && !!X.unzipStored(x.buf)['xl/worksheets/sheet2.xml']; } catch { exportOk = false; }
    // Every other recording's re-runs must be exactly as before.
    const unapproved = (after.data.samples || []).filter(x => !approved.some(a => a.id === x.id));
    const touched = unapproved.filter(x => L.canon(x.reruns || []) !== (rerunsBefore[x.id] ?? L.canon([]))).map(x => `${x.phrase_id} (id ${x.id})`);
    report.part1 = { approved_count: approved.length, screen_message: msg, export_ok: exportOk, unapproved_count: unapproved.length, unapproved_touched: touched,
      samples: approved.map(a => { const s = byId.get(a.id) || {};
        const now = { gemini: s.gemini, gemini_score: s.gemini_score, whisper: s.whisper, whisper_score: s.whisper_score };
        const kn = (s.reruns || []).find(r => r.engine === 'whisper' && r.setting === 'kn');
        return { phrase_id: a.phrase_id, say: report.phrases[a.phrase_id] || null, original: originals[a.id], original_unchanged: JSON.stringify(now) === JSON.stringify(originals[a.id]),
          whisper_kn: kn ? { text: kn.text, script: kn.script, latin: kn.latin, language: kn.language, score: kn.score, checks: kn.checks, problem: kn.problem || null } : null }; }) };
    console.log(`B19: ${approved.length} approved recording(s); originals unchanged: ${report.part1.samples.every(s => s.original_unchanged)}`);
  } catch (e) { report.errors.push(`Part 1: ${e.message}`); }

  // Part 2 (B18)
  const on = await api('admin', 'PUT', '/api/voice-fallback-test', { user_id: voiceMember.id });
  if (on.status !== 200) throw new Error(`turning the switch on replied ${on.status}`);
  switchOn = true;
  const check = await api('admin', 'GET', '/api/voice-fallback-test');
  if (check.data.account?.user_id !== voiceMember.id) throw new Error('the switch did not show the voice account after turning it on');

  // 2a. The REAL approved recordings, exactly as stored.
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
        transcript: r.data?.transcript ?? null, rejected: r.data?.rejected ?? null, engine: r.data?.engine ?? null });
      await wait(1500);
    }
  }

  // 2b. Computer voice through the screen.
  const M = await newPage('member');
  await uiMemberLogin(M);
  for (const c of L.CASES) {
    const row = { id: c.id, lang: c.lang, say: c.say, plain: c.plain, collected: false, transcribed: false };
    report.part2.cases.push(row);
    const sent = [], answered = [], parsed = [];
    const onReq = r => { if (r.method() === 'POST' && /\/api\/ai-chat\/voice-transcribe$/.test(r.url())) { try { sent.push(L.sha256(JSON.parse(r.postData() || '{}').audio)); } catch { sent.push(null); } } };
    const onResp = async r => {
      if (r.request().method() !== 'POST') return;
      if (/\/api\/ai-chat\/voice-transcribe$/.test(r.url())) answered.push({ status: r.status(), data: await r.json().catch(() => null) });
      if (/\/api\/ai-chat\/parse$/.test(r.url())) parsed.push({ status: r.status(), data: await r.json().catch(() => null) });
    };
    try {
      const a = makeAudio(c);
      const dayAtStart = snapshot(await dayOf());   // for the "nothing was saved" check
      await M.evaluate(() => document.querySelector('[aria-label="Close AI assistant"]')?.click()); await wait(700);
      await M.$eval('[data-testid="ai-type"]', b => b.click());
      await M.waitForSelector('[data-testid="composer-input"]', { visible: true, timeout: 15e3 });
      await M.select('[data-testid="voice-language-ready"]', c.lang);
      await M.evaluate(b64 => { window.__micB64 = b64; }, a.b64);
      const cards = await M.$$eval('[data-testid="ai-card-save"]', b => b.length);
      M.on('request', onReq); M.on('response', onResp);
      await tapText(M, /^Speak your log$/);
      // The app stops by itself 3 s after a voice ends; silence never "starts", so the robot taps stop.
      const stopBy = Date.now() + (a.secs + 6) * 1000;
      while (Date.now() < stopBy && !answered.length) { await wait(500); if (c.kind === 'silence' && Date.now() > stopBy - 5000) await tapText(M, /^Stop recording$/).catch(() => {}); }
      if (!answered.length) await tapText(M, /^Stop recording$/).catch(() => {});
      for (let i = 0; i < 80 && !answered.length; i++) await wait(500);
      must(answered.length, 'the app sent no recording to the server within 40 s');
      const t = answered[0].data || {};
      Object.assign(row, { collected: true, transcribed: true, status: answered[0].status, transcript: t.transcript ?? null, rejected: t.rejected ?? null, audio_sha256: (sent[0] || '').slice(0, 16) });
      // An explicit refusal is a 200 with no words AND a reason; anything else without words is an error, not a refusal.
      row.outcome = answered[0].status !== 200 ? 'error' : t.transcript ? 'preview' : t.rejected ? 'refused' : 'error';
      const verifyNoSave = async () => {
        await M.evaluate(() => document.querySelector('[aria-label="Close AI assistant"]')?.click()); await wait(3000);
        const now = snapshot(await dayOf());
        const detail = [...L.missingEntries(dayAtStart.food_items, now.food_items).map(f => `missing ${f.name}`), ...L.missingEntries(now.food_items, dayAtStart.food_items).map(f => `added ${f.name}`), ...L.changedFields(dayAtStart, now)];
        row.no_save_verified = detail.length === 0; row.no_save_detail = detail;
      };
      if (row.outcome === 'error') { row.save_note = 'nothing to save (provider/HTTP error, not a refusal)'; await shot(M, `${c.id}-error-answer`); await verifyNoSave(); }
      else if (t.transcript) {
        await waitFor(M, n => document.querySelectorAll('[data-testid="ai-card-save"]').length > n, cards, 90e3);
        await waitFor(M, () => { const b = [...document.querySelectorAll('[data-testid="ai-card-save"]')].pop(); return b && !b.disabled; }, null, 30e3);
        const pz = parsed[parsed.length - 1]?.data || {};
        if (!parsed.length) throw new Error('the preview appeared but its data was not captured');
        const items = { foods: (pz.foods || []).map(f => ({ name: f.name, qty_text: f.qty_text, grams: f.grams })), weight_kg: pz.weight_kg ?? null };
        const extra = L.unexpectedChanges(pz);
        row.preview_text = [items.weight_kg != null ? `weight ${items.weight_kg} kg` : null, ...items.foods.map(f => `${f.name} — ${f.qty_text || '?'} (${f.grams ?? '?'} g)`), ...extra.changes].filter(Boolean).join('; ') || '(no items)';
        // Everything Save would apply is judged, not only foods and weight (Fixes-2t).
        const ev = L.evaluatePreview(c.expect, pz);
        row.quality = ev.result; row.quality_reasons = ev.reasons;
        await shot(M, `${c.id}-preview`);
        if (c.save && ev.result === 'PASS') {
          const dayBefore = snapshot(await dayOf()); const before = dayBefore.food_items;
          const n = await M.$$eval('[data-testid="ai-card-save-status"]', s => s.length);
          await M.evaluate(() => [...document.querySelectorAll('[data-testid="ai-card-save"]')].pop().click());
          row.save_confirmed = await waitFor(M, n => { const s = [...document.querySelectorAll('[data-testid="ai-card-save-status"]')]; return s.length > n && /^Saved/.test(s.pop().textContent.trim()); }, n, 45e3).then(() => true, () => false);
          await M.evaluate(() => document.querySelector('[aria-label="Close AI assistant"]')?.click()); await wait(6000);
          const dayAfter = snapshot(await dayOf());
          const created = L.addedItems(before, dayAfter.food_items);
          created.forEach(f => createdKeys.push(L.itemKey(f)));
          row.saved = true;
          // The weight is one value for the whole day: judge only what THIS save changed.
          const wb = dayBefore.weight_kg, wa = dayAfter.weight_kg;
          row.readback = L.evaluateItems(c.expect, { foods: created, weight_kg: wa !== wb ? wa : null });
          // …and nothing else on the day changed: earlier entries intact, no other field touched.
          const lost = L.missingEntries(before, dayAfter.food_items), other = L.changedFields(dayBefore, dayAfter, { except: ['weight_kg'] });
          if (lost.length || other.length) row.readback = { result: 'FAIL', reasons: [...row.readback.reasons, ...lost.map(f => `earlier entry changed or removed: ${f.name}`), ...other.map(x => `also changed: ${x}`)] };
          row.save_note = row.save_confirmed ? `Saved (${created.length} entr${created.length === 1 ? 'y' : 'ies'} created)` : 'NO "Saved" confirmation';
          await shot(M, `${c.id}-day`);
        } else { row.save_note = c.save ? `not saved: preview ${ev.result}` : 'not saved (by design)'; await verifyNoSave(); }
      } else {
        row.quality = c.expect.refused ? 'PASS' : c.refusalAllowed ? (c.id === 'S5' ? 'PASS' : 'UNVERIFIED') : 'FAIL';
        row.quality_reasons = [c.expect.refused ? 'refused as expected' : c.refusalAllowed ? 'refused (allowed; nothing recognised to check)' : 'refused clear speech'];
        row.preview_text = await M.evaluate(() => [...document.querySelectorAll('[data-testid="voice-composer"] [role=status]')].map(e => e.textContent.trim()).filter(Boolean).join(' | '));
        row.save_note = 'nothing to save';
        await shot(M, `${c.id}-refused`);
        if (c.retry) {
          const had = sent.length;
          if (await M.$('[data-testid="voice-retry"]')) {
            await M.$eval('[data-testid="voice-retry"]', b => b.click());
            for (let i = 0; i < 80 && (sent.length === had || answered.length <= had); i++) await wait(500);
          }
          const first = sent[0], again = sent[had];
          row.retry = { identical: !!first && !!again && first === again, detail: !again ? 'Retry sent nothing' : first === again ? 'same SHA-256' : `SHA-256 ${String(first).slice(0, 12)} → ${String(again).slice(0, 12)}`,
            transcript: answered[had]?.data?.transcript ?? null, rejected: answered[had]?.data?.rejected ?? null };
        }
        await M.$eval('[data-testid="voice-discard-take"]', b => b.click()).catch(() => {});
        await verifyNoSave();
      }
    } catch (e) { row.error = e.message; await shot(M, `${c.id}-error`); }
    row.sent_count = sent.length;
    M.off('request', onReq); M.off('response', onResp);
    await M.evaluate(() => { window.__micB64 = null; }).catch(() => {});
    console.log(`  ${c.id} ${c.lang}: ${row.outcome === 'preview' ? `"${row.transcript}"` : row.outcome === 'refused' ? `refused (${row.rejected})` : row.outcome === 'error' ? `ERROR (HTTP ${row.status})` : 'no answer'}${row.error ? ` · ERROR: ${row.error}` : ''} · quality ${row.quality || '—'} · ${row.save_note || ''}`);
    await wait(2000);
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
    if (plan.removed || otherFields.length) {
      // Every field back to what it was before the run; entries only this run's removed (Fixes-2t).
      const body = { weight_kg: plan.weight_kg, activities: plan.activities, acv: plan.acv, food_items: plan.food_items, water_ml: plan.water_ml,
        supplements: plan.supplements, sleep: plan.sleep, notes: plan.notes, base_saved_at: current.saved_at };
      const w = await api('member', 'POST', `/api/logs/${DAY}`, body);
      if (w.status !== 200) throw new Error(`writing the day back replied ${w.status}`);
    }
    const v = L.verifyCleanup(baseline, snapshot(await dayOf()));
    if ((await workoutsOf()) !== baselineWorkouts) { v.ok = false; v.problems.push('the day\'s workouts changed'); }
    report.cleanup = { ...v, removed: plan.removed, weight_restored: weightChanged, other_fields_restored: otherFields.filter(x => !x.startsWith('weight_kg')), baseline_items: baseline.food_items.length };
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
      .map(r => ({ id: r.id, created_at: r.created_at, lang_hint: r.lang_hint, language_sent: r.language_sent, whisper_text: r.whisper_text, whisper_language: r.whisper_language, segments: r.segments, accepted: r.accepted, reason: r.reason, transcript: r.transcript, error: r.error }));
    report.runs_excluded = all.length - report.runs.length;
    // Every recording this run sent as the voice account must appear once: no more (someone else's), no fewer.
    const expected = report.part2.real.length + report.part2.cases.reduce((n, c) => n + (c.sent_count || 0), 0);
    if (report.part2.collected && report.runs.length !== expected) report.part2.scope_problem = `this run's recorded tries: ${report.runs.length}, expected ${expected}`;
    // This run's own workbook: approved samples, this run's tries, the cases. Nothing else.
    const sec = report.runs.flatMap(r => (r.segments || []).map((s, i) => [r.id, i + 1, s.start, s.end, s.text, s.avg_logprob, s.no_speech_prob, s.compression_ratio]));
    fs.writeFileSync(path.join(OUT, `FitLife-Voice-Evidence${SIM ? '-SIMULATED' : ''}.xlsx`), X.workbook([
      { name: SIM ? 'READ ME - SIMULATED' : 'Read me', rows: [['what'], [MODE_LINE], [`target ${BASE}; server ${report.server_commit || '—'}; ${report.started} → ${new Date().toISOString()}`]] },
      { name: 'Pilot re-run', rows: [['line', 'said', 'original_gemini', 'original_gemini_score', 'original_whisper', 'original_whisper_score', 'originals_unchanged', 'whisper_kn_text', 'script', 'latin', 'keyword_score'],
        ...(report.part1?.samples || []).map(s => [s.phrase_id, s.say, s.original?.gemini, s.original?.gemini_score, s.original?.whisper, s.original?.whisper_score, String(s.original_unchanged), s.whisper_kn?.text, s.whisper_kn?.script, s.whisper_kn?.latin, s.whisper_kn?.score])] },
      { name: 'Cases', rows: [['case', 'voice_language', 'said', 'expected', 'transcript', 'refused', 'preview', 'quality', 'reasons', 'saved', 'read_back', 'retry']
        , ...report.part2.cases.map(c => [c.id, c.lang, c.say, c.plain, c.transcript, c.rejected, c.preview_text, c.quality, (c.quality_reasons || []).join('; '), c.save_note, c.readback ? `${c.readback.result} ${c.readback.reasons.join('; ')}` : '', c.retry ? c.retry.detail : ''])] },
      { name: 'Fallback tries', rows: [['try', 'time_utc', 'voice_language', 'told', 'whisper_text_raw', 'language_reported', 'decision', 'reason', 'transcript', 'error'],
        ...report.runs.map(r => [r.id, r.created_at, r.lang_hint, r.language_sent || 'not set', r.whisper_text, r.whisper_language, r.accepted == null ? 'no answer' : r.accepted ? 'accepted' : 'refused', r.reason, r.transcript, r.error])] },
      { name: 'Sections', rows: [['try', 'section', 'start_s', 'end_s', 'text', 'avg_logprob', 'no_speech_prob', 'compression_ratio'], ...sec] },
    ]));
  } catch (e) { report.errors.push(`evidence: ${e.message}`); }
}
process.exit(writeReport().exitCode);
