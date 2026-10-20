#!/usr/bin/env node
/**
 * scripts/robot-voice-evidence.mjs — the voice evidence robot (Fixes-2r, 20 Oct 2026).
 *
 * Collects REAL speech-provider evidence on the TEST SITE for B19 (Kannada pilot
 * re-run) and B18 (everyday Whisper fallback), the two tests the 2o–2q reviews
 * asked for. Unlike every other suite, nothing here is simulated: the test
 * server calls the real Gemini / Whisper.
 *
 *   Part 1 (B19): as admin, "Whisper · Kannada" on the stored pilot recordings.
 *     The originals are compared before and after (they must not change); the
 *     new answers are read back from the results and the Excel file.
 *   Part 2 (B18): as admin, the "Voice backup test" switch is turned on for the
 *     robot's own member ("Auto Member"), so that account skips Gemini:
 *       2a. the REAL 19 Oct pilot recordings (human voice), sent exactly as stored
 *           to the same endpoint the app uses, as that member (no screen);
 *       2b. COMPUTER-GENERATED speech (espeak-ng) played into the app's
 *           microphone, through the real voice screen: preview → Save → the
 *           day, and Retry after a refusal.
 *     The switch is always turned off at the end. Recorded tries are KEPT.
 *
 * What it is not: computer speech says nothing about how well Whisper hears
 * real members. Two real recordings are not enough to choose an engine.
 *
 * Accounts (GitHub secrets): FITLIFE_ROBOT_ADMIN_EMAIL / _PASSWORD (an admin on
 * the TEST site), FITLIFE_ROBOT_MEMBER_PHONE / _PIN ("Auto Member").
 * Without them the run is BLOCKED (exit 3): nothing was tested.
 *
 * Run: node scripts/robot-voice-evidence.mjs     (ROBOT_BASE_URL, default fitness-test)
 * Needs espeak-ng and ffmpeg. Results: qa/voice-evidence-results/report.md,
 * results.json, the two Excel files, screenshots.
 */
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { browserExecutable } from './lib/browser-executable.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../..');
const require = createRequire(import.meta.url);
const X = require('../services/xlsxLite');
const OUT = process.env.ROBOT_OUT || path.join(ROOT, 'qa/voice-evidence-results');
const BASE = (process.env.ROBOT_BASE_URL || 'https://fitness-test.up.railway.app').replace(/\/$/, '');
const GH = process.env.GITHUB_ACTIONS === 'true';
const env = k => (process.env[k] || '').trim();
const ACC = {
  admin: { email: env('FITLIFE_ROBOT_ADMIN_EMAIL'), password: env('FITLIFE_ROBOT_ADMIN_PASSWORD') },
  member: { phone: env('FITLIFE_ROBOT_MEMBER_PHONE'), pin: env('FITLIFE_ROBOT_MEMBER_PIN') },
};
const ghEsc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
fs.mkdirSync(path.join(OUT, 'audio'), { recursive: true });

function blocked(msg, code = 3) {
  console.log(msg);
  fs.writeFileSync(path.join(OUT, 'report.md'), `# Voice evidence robot — BLOCKED\n\n**Nothing was tested.** ${msg}\n`);
  if (GH) console.log(`::error title=Voice evidence robot BLOCKED (not tested)::${ghEsc(msg)}`);
  process.exit(code);
}
if (/fitness\.upscale-app\.com/i.test(BASE)) blocked('The voice evidence robot only runs against the TEST site. Refusing to touch production.', 2);
const missing = Object.entries({ FITLIFE_ROBOT_ADMIN_EMAIL: ACC.admin.email, FITLIFE_ROBOT_ADMIN_PASSWORD: ACC.admin.password,
  FITLIFE_ROBOT_MEMBER_PHONE: ACC.member.phone, FITLIFE_ROBOT_MEMBER_PIN: ACC.member.pin }).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) blocked(`The robot's test-site logins are missing: ${missing.join(', ')}. Add them under GitHub → Settings → Secrets and variables → Actions.`);

// ── Wait until the test server runs this commit (when started by a push) ──────
let serverCommit = null;
if (process.env.GITHUB_SHA) {
  const sha = process.env.GITHUB_SHA, until = Date.now() + 15 * 60e3;
  while (Date.now() < until) {
    serverCommit = await fetch(`${BASE}/health?voice=${Date.now()}`).then(r => r.json()).then(j => j?.commit ?? null).catch(() => undefined);
    if (serverCommit === sha || serverCommit === null) break;
    console.log(`waiting for the server deploy: running ${serverCommit ? serverCommit.slice(0, 7) : '—'}, this commit ${sha.slice(0, 7)}`);
    await new Promise(r => setTimeout(r, 20e3));
  }
  if (serverCommit && serverCommit !== sha) blocked(`The test server still runs ${serverCommit.slice(0, 7)}, not ${sha.slice(0, 7)}.`, 1);
}

// ── Computer-generated speech (espeak-ng), padded like a person pausing ──────
// 0.5 s before, 4.5 s after: the app stops by itself after 3 s of quiet.
const SYNTH = [
  { id: 'S1', lang: 'en-IN', voice: 'en-us', text: 'Two idli, one bowl sambar, weight eighty two point five kilograms.', expect: 'Preview with 2 idli, 1 bowl sambar and 82.5 kg; Save; the day shows them.', save: true },
  { id: 'S2', lang: 'kn-IN', voice: 'kn', text: 'ಬೆಳಗ್ಗೆ ಎರಡು ಇಡ್ಲಿ ಮತ್ತು ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್ ತಿಂದೆ', expect: 'Preview with idli and sambar (quantities checked), or Retry / type.', save: true },
  { id: 'S3', lang: 'hi-IN', voice: 'hi', text: 'दो रोटी और एक कटोरी दाल खाई', expect: 'Preview with 2 roti and 1 katori dal.', save: true },
  { id: 'S4', lang: 'en-IN', kind: 'silence', text: '(6 seconds of silence)', expect: '"Couldn\'t make out the words" with Retry; nothing to save. Then Retry sends the same recording again.', retry: true },
  { id: 'S5', lang: 'en-IN', voice: 'en-us', kind: 'noisy', text: 'Two idli, weight eighty two point five kilograms. (quiet, under loud noise)', say: 'Two idli, weight eighty two point five kilograms.', expect: 'A correct preview, or Retry / type. Never a preview with a wrong weight.', save: false },
];
function makeAudio(c) {
  const raw = path.join(OUT, 'audio', `${c.id}-raw.wav`), out = path.join(OUT, 'audio', `${c.id}.wav`);
  const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
  if (c.kind === 'silence') ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '6', '-c:a', 'pcm_s16le', out]);
  else {
    execFileSync('espeak-ng', ['-v', c.voice, '-s', '140', '-w', raw, c.say || c.text]);
    if (c.kind === 'noisy') ff(['-i', raw, '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.5:duration=12', '-filter_complex',
      '[0]volume=0.12,adelay=500|500,apad=pad_dur=4.5[v];[v][1]amix=inputs=2:duration=first:normalize=0', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', out]);
    else ff(['-i', raw, '-af', 'adelay=500|500,apad=pad_dur=4.5', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', out]);
  }
  const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim());
  return { file: out, b64: fs.readFileSync(out).toString('base64'), secs };
}

// ── Browser: a phone, with a microphone that plays a given sound file ────────
const wait = ms => new Promise(r => setTimeout(r, ms));
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const browser = await puppeteer.launch({
  executablePath: await browserExecutable(chromium),
  args: [...chromium.args.filter(a => !/single-process|no-zygote/.test(a)), '--no-sandbox', '--disable-dev-shm-usage',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  headless: true,
});
const pageErrors = [];
let shotN = 0;
async function shot(page, name) { const f = `${String(++shotN).padStart(2, '0')}-${name}.png`; try { await page.screenshot({ path: path.join(OUT, f) }); return f; } catch { return null; } }
async function newPage(label) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setUserAgent(UA); await page.setViewport(PHONE); page.setDefaultTimeout(20e3);
  page.on('pageerror', e => pageErrors.push(`${label}: ${e.message.slice(0, 200)}`));
  // The microphone: when the app asks for it and a sound file is loaded, the app
  // gets that sound (once, then quiet) instead of the fake device's beep.
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
/** The Authorization header the app itself sends, once it has made an API call. */
function authOf(page) {
  return new Promise(resolve => {
    const on = r => { const a = r.headers().authorization; if (/\/api\//.test(r.url()) && a) { page.off('request', on); resolve(a); } };
    page.on('request', on); setTimeout(() => { page.off('request', on); resolve(null); }, 30e3);
  });
}
async function adminLogin(page) {
  const auth = authOf(page);
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type=tel]', { timeout: 30e3 });
  await tapText(page, /Coach \/ Admin/);
  await page.waitForSelector('input[type=email]', { visible: true });
  await page.type('input[type=email]', ACC.admin.email);
  await page.type('input[type=password]', ACC.admin.password);
  await tapText(page, /^Sign In/);
  await waitFor(page, () => /\/coach|\/admin/.test(location.pathname), null, 30e3);
  const a = await auth; must(a, 'signed in, but the app made no API call to read the session from');
  return a;
}
async function memberLogin(page) {
  const auth = authOf(page);
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type=tel]', { timeout: 30e3 });
  await page.type('input[type=tel]', ACC.member.phone);
  await page.type('input[type=password]', ACC.member.pin);
  await tapText(page, /^Log In/);
  await waitFor(page, () => document.querySelector('[data-testid="daily-essentials"], [data-testid="onb-next"], [data-testid="onb-primary"]'), null, 30e3);
  // First sign-in on an account: walk through onboarding, as the phone robot does.
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
  const a = await auth; must(a, 'signed in, but the app made no API call to read the session from');
  return a;
}
const api = async (auth, method, url, body, raw = false) => {
  const r = await fetch(BASE + url, { method, headers: { Authorization: auth, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
  return { status: r.status, data };
};
async function kcal(page) {
  const t = await page.$eval('[data-testid="plan-eat"] .member-ring-content strong', el => el.textContent).catch(() => null);
  return t == null ? null : Number(t.replace(/[^\d]/g, ''));
}

const report = { started: new Date().toISOString(), base: BASE, serverCommit, part1: null, part2: { real: [], synthetic: [], runs: [], switch: null }, problems: [] };
const problem = (where, e) => { const m = `${where}: ${e?.message || e}`; report.problems.push(m); console.log('  ✗ ' + m); };
const short = (v, n = 400) => (v == null ? null : String(v).slice(0, n));

const A = await newPage('admin');
let adminAuth = null, switchOn = false, runsBefore = new Set();
try {
  adminAuth = await adminLogin(A);
  console.log('admin signed in');

  // ── Part 1 (B19): Whisper · Kannada on the stored pilot recordings ─────────
  try {
    const before = await api(adminAuth, 'GET', '/api/voice-pilot/results');
    must(before.status === 200, `results replied ${before.status}`);
    const orig = (r) => ({ gemini: r.gemini, gemini_score: r.gemini_score, whisper: r.whisper, whisper_score: r.whisper_score, whisper_setting: r.whisper_setting ?? null, whisper_language: r.whisper_language ?? null });
    const snap = Object.fromEntries((before.data.samples || []).map(s => [s.id, orig(s)]));
    // Tap "Whisper · Kannada" on the admin dashboard, as Sachin would.
    await A.waitForSelector('[data-testid="vp-rerun-kn"]', { visible: true, timeout: 30e3 });
    const asked = [];
    for (let i = 0; i < 6; i++) {
      const resp = A.waitForResponse(r => /\/api\/voice-pilot\/results\/rerun$/.test(r.url()) && r.request().method() === 'POST', { timeout: 200e3 });
      await A.$eval('[data-testid="vp-rerun-kn"]', b => { b.scrollIntoView({ block: 'center' }); b.click(); });
      const r = await resp; const d = await r.json().catch(() => ({}));
      asked.push({ status: r.status(), ...d });
      if (!d.more) break;
      await wait(1500);
    }
    await wait(1500);
    const msg = await A.$eval('[data-testid="vp-rerun-result"]', e => e.textContent.trim()).catch(() => null);
    await shot(A, 'B19-after-rerun');
    const after = await api(adminAuth, 'GET', '/api/voice-pilot/results');
    const x = await api(adminAuth, 'GET', '/api/voice-pilot/results.xlsx', null, true);
    if (x.status === 200) fs.writeFileSync(path.join(OUT, 'FitLife-Voice-Pilot-results.xlsx'), x.buf);
    let rerunSheetRows = null;
    try { const files = X.unzipStored(x.buf); const s2 = files['xl/worksheets/sheet2.xml']?.toString('utf8') || ''; rerunSheetRows = (s2.match(/<row /g) || []).length - 1; } catch { rerunSheetRows = null; }
    const samples = (after.data.samples || []).map(s => {
      const kn = (s.reruns || []).find(r => r.engine === 'whisper' && r.setting === 'kn');
      const unchanged = JSON.stringify(orig(s)) === JSON.stringify(snap[s.id]);
      return { id: s.id, phrase_id: s.phrase_id, say: (after.data.phrases || []).find(p => p.id === s.phrase_id)?.say || null,
        original: orig(s), original_unchanged: unchanged,
        whisper_kn: kn ? { text: kn.text, script: kn.script, latin: kn.latin, language: kn.language, score: kn.score, checks: kn.checks, error: kn.problem || null } : null };
    });
    report.part1 = { asked, screen_message: msg, samples, excel_saved: x.status === 200, rerun_sheet_rows: rerunSheetRows };
    console.log(`B19: ${samples.length} recording(s); originals unchanged: ${samples.every(s => s.original_unchanged)}; message: ${msg}`);
  } catch (e) { problem('Part 1 (Kannada re-run)', e); }

  // ── Part 2 (B18): the everyday fallback, through the backup switch ─────────
  const st = await api(adminAuth, 'GET', '/api/voice-fallback-test');
  report.part2.switch = { available: st.data?.available ?? null, message: st.data?.message || null };
  runsBefore = new Set((st.data?.runs || []).map(r => r.id));
  if (st.status !== 200 || !st.data?.available) {
    problem('Part 2 (everyday fallback)', `the switch is not available on this server (${st.status}: ${st.data?.message || JSON.stringify(st.data).slice(0, 120)}). Set FITLIFE_TEST_SERVER=yes on the TEST service only.`);
  } else {
    const members = await api(adminAuth, 'GET', '/api/admin/members');
    const list = Array.isArray(members.data) ? members.data : members.data?.members || [];
    const digits = ACC.member.phone.replace(/\D/g, '').slice(-10);
    const me = list.find(m => String(m.phone || '').replace(/\D/g, '').endsWith(digits));
    must(me, 'Auto Member was not found in the admin member list');
    const on = await api(adminAuth, 'PUT', '/api/voice-fallback-test', { user_id: me.id });
    must(on.status === 200, `turning the switch on replied ${on.status}: ${JSON.stringify(on.data).slice(0, 160)}`);
    switchOn = true;
    report.part2.switch.account = on.data.account?.name; report.part2.switch.ends_at = on.data.account?.ends_at;
    await shot(A, 'B18-switch-on');
    console.log(`B18: switch on for ${on.data.account?.name}`);

    const M = await newPage('member');
    const memberAuth = await memberLogin(M).catch(async e => { await shot(M, 'member-login-failed'); throw e; });

    // 2a. The REAL 19 Oct recordings (human voice), exactly as stored.
    try {
      const res = await api(adminAuth, 'GET', '/api/voice-pilot/results');   // fresh signed links (5 minutes)
      for (const s of (res.data.samples || []).filter(s => s.audio_url)) {
        const audio = await fetch(s.audio_url);
        if (!audio.ok) { problem(`real recording ${s.phrase_id}`, `could not fetch the stored recording (${audio.status})`); continue; }
        const ct = (audio.headers.get('content-type') || '').split(';')[0].trim(); const type = /^audio\//.test(ct) ? ct : 'audio/webm';   // stored with the recording's own type
        const b64 = Buffer.from(await audio.arrayBuffer()).toString('base64');
        for (const langHint of ['kn-IN', 'en-IN']) {
          const t0 = Date.now();
          const r = await api(memberAuth, 'POST', '/api/ai-chat/voice-transcribe', { audio: b64, mimeType: type, langHint });
          report.part2.real.push({ source: `REAL 19 Oct recording ${s.phrase_id}`, say: (res.data.phrases || []).find(p => p.id === s.phrase_id)?.say || null,
            original_gemini: s.gemini, voice_language: langHint, bytes: Math.round(b64.length * 0.75), type, status: r.status, ms: Date.now() - t0,
            transcript: r.data?.transcript ?? null, rejected: r.data?.rejected ?? null, message: r.data?.message ?? null, engine: r.data?.engine ?? null });
          await wait(1500);
        }
      }
      console.log(`B18 real recordings: ${report.part2.real.length} tries`);
    } catch (e) { problem('Part 2a (real recordings)', e); }

    // 2b. Computer-generated speech through the real voice screen.
    const foodWords = /idli|sambar|roti|rotti|chapati|dal|daal/i;
    const startKcal = await kcal(M);
    for (const c of SYNTH) {
      const row = { id: c.id, source: 'COMPUTER VOICE (espeak-ng)', voice_language: c.lang, said: c.text, expected: c.expect };
      report.part2.synthetic.push(row);
      try {
        const a = makeAudio(c); row.seconds = +a.secs.toFixed(1);
        await M.evaluate(() => document.querySelector('[aria-label="Close AI assistant"]')?.click()); await wait(700);
        await M.$eval('[data-testid="ai-type"]', b => b.click());
        await M.waitForSelector('[data-testid="composer-input"]', { visible: true, timeout: 15e3 });
        await M.select('[data-testid="voice-language-ready"]', c.lang).catch(() => {});
        await M.evaluate(b64 => { window.__micB64 = b64; }, a.b64);
        const cards = await M.$$eval('[data-testid="ai-card-save"]', b => b.length);
        const transcribed = [];
        const parsed = [];
        const onResp = async r => {
          if (r.request().method() !== 'POST') return;
          if (/\/api\/ai-chat\/voice-transcribe$/.test(r.url())) transcribed.push({ status: r.status(), data: await r.json().catch(() => null) });
          // What the preview is built from: the parse of the transcript.
          if (/\/api\/ai-chat\/parse$/.test(r.url())) parsed.push({ status: r.status(), sent: (() => { try { return JSON.parse(r.request().postData() || '{}').message; } catch { return null; } })(), data: await r.json().catch(() => null) });
        };
        M.on('response', onResp);
        await tapText(M, /^Speak your log$/);
        // The app stops by itself after 3 s of quiet once it has heard a voice;
        // pure silence never "starts", so like a person the robot taps stop.
        const stopBy = Date.now() + (a.secs + 6) * 1000;
        while (Date.now() < stopBy && !transcribed.length) {
          await wait(500);
          if (c.kind === 'silence' && Date.now() > stopBy - 5000) await tapText(M, /^Stop recording$/).catch(() => {});
        }
        if (!transcribed.length) await tapText(M, /^Stop recording$/).catch(() => {});
        await waitFor(M, () => true, null, 1000).catch(() => {});
        for (let i = 0; i < 80 && !transcribed.length; i++) await wait(500);
        must(transcribed.length, 'the app sent no recording to the server within 40 s');
        const t = transcribed[0].data || {};
        Object.assign(row, { status: transcribed[0].status, transcript: t.transcript ?? null, rejected: t.rejected ?? null, server_message: t.message ?? null, engine: t.engine ?? null });
        await wait(1500);
        if (t.transcript) {
          // Accepted → the app sends it on by itself; the review card appears.
          await waitFor(M, n => document.querySelectorAll('[data-testid="ai-card-save"]').length > n, cards, 90e3);
          await waitFor(M, () => { const b = [...document.querySelectorAll('[data-testid="ai-card-save"]')].pop(); return b && !b.disabled; }, null, 30e3);
          const pz = parsed[parsed.length - 1]?.data || {};
          row.sent_to_ai = parsed[parsed.length - 1]?.sent ?? null;
          row.preview = [pz.weight_kg != null ? `weight ${pz.weight_kg} kg` : null,
            ...(pz.foods || []).map(f => `${f.name} — ${f.qty_text || '?'} (${f.grams ?? '?'} g, ${f.meal || '?'})`),
            pz.water_ml_add ? `water +${pz.water_ml_add} ml` : null].filter(Boolean).join('; ') || `(no items) ${String(pz.reply || '').slice(0, 160)}`;
          await shot(M, `${c.id}-preview`);
          if (c.save) {
            const n = await M.$$eval('[data-testid="ai-card-save-status"]', s => s.length);
            await M.evaluate(() => [...document.querySelectorAll('[data-testid="ai-card-save"]')].pop().click());
            await waitFor(M, n => { const s = [...document.querySelectorAll('[data-testid="ai-card-save-status"]')]; return s.length > n && /^Saved/.test(s.pop().textContent.trim()); }, n, 45e3)
              .then(() => { row.saved = 'Saved'; }, () => { row.saved = 'no "Saved" confirmation within 45 s'; });
            await M.evaluate(() => document.querySelector('[aria-label="Close AI assistant"]')?.click()); await wait(1500);
            row.day_kcal_after_save = await kcal(M);
            row.day_text = await M.evaluate(() => (document.querySelector('[data-testid="plan-eat"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200));
            await shot(M, `${c.id}-day`);
          } else row.saved = 'not saved (by design for this case)';
        } else {
          // Refused → the recording is kept for Retry.
          row.screen_message = await M.evaluate(() => [...document.querySelectorAll('[data-testid="voice-composer"] [role=status]')].map(e => e.textContent.trim()).filter(Boolean).join(' | '));
          row.retry_button = !!(await M.$('[data-testid="voice-retry"]'));
          await shot(M, `${c.id}-refused`);
          if (c.retry && row.retry_button) {
            const before = transcribed.length, plays = await M.evaluate(() => window.__micPlays || 0);
            await M.$eval('[data-testid="voice-retry"]', b => b.click());
            for (let i = 0; i < 80 && transcribed.length === before; i++) await wait(500);
            const r2 = transcribed[before]?.data || null;
            row.retry = { sent_again: transcribed.length > before, microphone_used_again: (await M.evaluate(() => window.__micPlays || 0)) > plays, transcript: r2?.transcript ?? null, rejected: r2?.rejected ?? null };
          }
          await M.$eval('[data-testid="voice-discard-take"]', b => b.click()).catch(() => {});
        }
        M.off('response', onResp);
        await M.evaluate(() => { window.__micB64 = null; });
        console.log(`  ${c.id} ${c.lang}: ${row.transcript ? `"${row.transcript}"` : `refused (${row.rejected || row.status})`}${row.saved ? ' · ' + row.saved : ''}`);
      } catch (e) { row.error = e.message; problem(`synthetic ${c.id}`, e); await shot(M, `${c.id}-error`); }
      await wait(2000);
    }

    // Clean-up: remove the robot's food from today (as the phone robot does).
    try {
      await M.evaluate(() => document.querySelector('[aria-label="Close AI assistant"]')?.click()); await wait(800);
      await M.$eval('[data-testid="plan-eat"]', b => b.click()); await wait(1500);
      for (let i = 0; i < 15; i++) {
        const gone = await M.evaluate((s, f) => { const rx = new RegExp(s, f); const btn = [...document.querySelectorAll('button[aria-label="Remove item"]')].find(b => rx.test(b.closest('div')?.parentElement?.textContent || '')); if (!btn) return true; btn.click(); return false; }, foodWords.source, foodWords.flags);
        if (gone) break; await wait(700);
      }
      await M.keyboard.press('Escape'); await wait(6000);
      report.part2.cleanup = { day_kcal_start: startKcal, day_kcal_end: await kcal(M) };
    } catch (e) { problem('clean-up', e); }
  }
} catch (e) {
  problem('run', e); await shot(A, 'run-error');
} finally {
  if (switchOn && adminAuth) {
    const off = await api(adminAuth, 'DELETE', '/api/voice-fallback-test').catch(e => ({ status: e.message }));
    report.part2.switch = { ...(report.part2.switch || {}), turned_off: off.status === 200 ? 'yes' : `FAILED (${off.status}) — turn it off by hand` };
  }
  if (adminAuth) {
    const st = await api(adminAuth, 'GET', '/api/voice-fallback-test').catch(() => null);
    report.part2.runs = (st?.data?.runs || []).filter(r => !runsBefore.has(r.id)).slice(0, 30);
    const x = await api(adminAuth, 'GET', '/api/voice-fallback-test/runs.xlsx', null, true).catch(() => null);
    if (x?.status === 200) fs.writeFileSync(path.join(OUT, 'FitLife-Voice-Fallback-Test.xlsx'), x.buf);
  }
  await browser.close().catch(() => {});
}

// ── Report ───────────────────────────────────────────────────────────────────
report.finished = new Date().toISOString(); report.page_errors = pageErrors;
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(report, null, 1));
const pct = v => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`);
const cell = v => (v == null || v === '' ? '—' : String(v).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300));
const p1 = report.part1, p2 = report.part2;
const md = [
  `# Voice evidence robot — ${report.finished.slice(0, 16).replace('T', ' ')} UTC`, '',
  `Site: ${BASE} · server ${serverCommit ? serverCommit.slice(0, 7) : 'commit not reported'} · **REAL speech providers** (nothing simulated).`, '',
  `**${report.problems.length ? `${report.problems.length} problem(s)` : 'Completed'}**${report.problems.length ? ': ' + report.problems.map(cell).join(' · ') : ''}`, '',
  '## Part 1 — B19: Whisper · Kannada re-run of the stored pilot recordings (REAL human recordings)', '',
  p1 ? `Screen said: "${cell(p1.screen_message)}". Requests: ${p1.asked.map(a => `${a.status} asked ${a.asked ?? '?'} answered ${a.answered ?? '?'}${a.more ? ' (more)' : ''}`).join('; ')}. Excel saved: ${p1.excel_saved ? 'yes' : 'no'}; Re-runs sheet rows: ${p1.rerun_sheet_rows ?? '?'}.` : 'Not run.', '',
  ...(p1 ? ['| Line | Said | Original Gemini (score) | Original Whisper (score) | Originals unchanged | Whisper · Kannada now | Script | In English letters | Score | Rule checks |', '|---|---|---|---|---|---|---|---|---|---|',
    ...p1.samples.map(s => `| ${s.phrase_id} | ${cell(s.say)} | ${cell(s.original.gemini)} (${pct(s.original.gemini_score)}) | ${cell(s.original.whisper)} (${pct(s.original.whisper_score)}) | ${s.original_unchanged ? 'yes' : '**NO**'} | ${cell(s.whisper_kn?.text ?? s.whisper_kn?.error)} | ${cell(s.whisper_kn?.script)} | ${cell(s.whisper_kn?.latin)} | ${pct(s.whisper_kn?.score)} | ${cell((s.whisper_kn?.checks || []).map(k => `${k.label} ${k.result === 'pass' ? '✓' : k.result === 'unverified' ? '?' : '✗'}`).join(', '))} |`)] : []), '',
  '## Part 2 — B18: everyday voice fallback (Gemini skipped for "Auto Member" only, real Whisper)', '',
  `Switch: available ${cell(p2.switch?.available)}; on for ${cell(p2.switch?.account)}; turned off at the end: ${cell(p2.switch?.turned_off)}.`, '',
  '### 2a. REAL 19 Oct recordings (human voice), sent as stored, no screen', '',
  '| Recording | Said | Voice language | HTTP | Transcript passed on | Refused (reason) |', '|---|---|---|---|---|---|',
  ...p2.real.map(r => `| ${cell(r.source)} | ${cell(r.say)} | ${r.voice_language} | ${r.status} | ${cell(r.transcript)} | ${cell(r.rejected)} |`), '',
  '### 2b. COMPUTER VOICE (espeak-ng) through the real voice screen: microphone → preview → Save → day', '',
  '| Case | Voice language | Said | Expected | Server | Screen | Saved / day |', '|---|---|---|---|---|---|---|',
  ...p2.synthetic.map(r => `| ${r.id} | ${r.voice_language} | ${cell(r.said)} | ${cell(r.expected)} | ${r.error ? 'ERROR ' + cell(r.error) : r.transcript ? `accepted: "${cell(r.transcript)}"` : `refused: ${cell(r.rejected)} (${r.status})`} | ${cell(r.preview || r.screen_message)}${r.retry ? ` · Retry: sent again ${r.retry.sent_again ? 'yes' : 'NO'}, microphone used again ${r.retry.microphone_used_again ? 'YES' : 'no'}, ${r.retry.transcript ? `"${cell(r.retry.transcript)}"` : `refused ${cell(r.retry.rejected)}`}` : ''} | ${cell(r.saved)}${r.day_kcal_after_save != null ? `; day ${r.day_kcal_after_save} kcal` : ''} |`), '',
  p2.cleanup ? `Clean-up: day ${p2.cleanup.day_kcal_start} kcal at the start, ${p2.cleanup.day_kcal_end} kcal after removing the robot's food. (A weight saved by S1 stays on the robot account.)` : '', '',
  '### What Whisper actually returned (recorded tries, newest first; section numbers in the Excel file)', '',
  '| Try | Voice language | Told | Whisper text (raw) | Language reported | Decision | Sections (log-prob / no-speech / compression) |', '|---|---|---|---|---|---|---|',
  ...p2.runs.map(r => `| ${r.id} | ${cell(r.lang_hint)} | ${cell(r.language_sent || 'not set')} | ${cell(r.whisper_text)} | ${cell(r.whisper_language)} | ${r.accepted === true ? 'accepted' : r.accepted === false ? `refused: ${cell(r.reason)}` : `no answer: ${cell(r.error)}`} | ${cell((r.segments || []).map(s => `${s.avg_logprob ?? '∅'}/${s.no_speech_prob ?? '∅'}/${s.compression_ratio ?? '∅'}`).join(' · '))} |`), '',
  '**Read with care:** computer voices show how the real providers and FitLife\'s checks behave; they say nothing about how well real members are understood. Two real recordings are far too few to choose an engine.', '',
  '<details><summary>Raw results (JSON)</summary>', '', '```json', JSON.stringify(report).slice(0, 30000), '```', '</details>',
].join('\n');
fs.writeFileSync(path.join(OUT, 'report.md'), md + '\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
console.log(`\nVoice evidence robot: ${report.problems.length ? report.problems.length + ' problem(s)' : 'completed'} → ${path.relative(ROOT, OUT)}/report.md`);
process.exit(report.problems.length ? 1 : 0);
