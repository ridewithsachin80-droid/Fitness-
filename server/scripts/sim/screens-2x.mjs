#!/usr/bin/env node
/**
 * scripts/sim/screens-2x.mjs — Fixes-2x screen check for the voice calibration kit (SIMULATION ONLY,
 * never the site). Starts the real server on this computer with canned providers
 * (sim/voice-evidence-providers.cjs) and in-memory storage (sim/calibration-storage.cjs), and, at
 * 360 and 390 px in the light AND dark themes:
 *   1. a volunteer who has not agreed yet: the card on Today and the agreement screen;
 *   2. a volunteer who has agreed: records a no-speech clip through the (fake) microphone, sends it,
 *      sees it ticked; records it AGAIN, which must ask for a reason, and both takes are kept;
 *      the Kannada lines are open (wording confirmed), the English lines locked;
 *   3. the administrator's panel with every section open;
 *   4. (once) the app's Part C mode with a FAKE on-device recogniser that always hears words:
 *      not armed → the on-device words are used, nothing calibration-related is sent;
 *      a natural try → on-device words used, reported as "browser/on-device (no upload)";
 *      a controlled try → the recording is uploaded instead (a server recording), with the label shown;
 *      the app opened at the PRODUCTION address → it never asks about calibration at all.
 * Measures text contrast in each theme and checks the page never scrolls sideways.
 *
 *   node scripts/sim/screens-2x.mjs <output folder>
 */
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { browserExecutable } from '../lib/browser-executable.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRV = path.join(HERE, '../..');
const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs'); const { Client } = require('pg');
const PG = process.env.SIM_PG || 'postgres://postgres@localhost:5433';
const DB = 'fitlife_screens_2x', PORT = 3994, BASE = `http://localhost:${PORT}`;
process.env.DATABASE_URL = `${PG}/${DB}`;   // the kit's module reaches for a pool when loaded
const C = require('../../services/voiceCalibration');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'screens-2x-'));
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'screens-2x-tmp-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = []; let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };

const SILENCE = path.join(TMP, 'silence.wav');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '6', '-c:a', 'pcm_s16le', SILENCE]);

// ── Database ──
const admin = new Client({ connectionString: `${PG}/postgres` }); await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
execFileSync('psql', [`${PG}/${DB}`, '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(SRV, 'db/schema.sql')], { stdio: ['ignore', 'ignore', 'pipe'] });
const c = new Client({ connectionString: `${PG}/${DB}` }); await c.connect();
const user = async (name, role, extra) => (await c.query(`INSERT INTO users (name, phone, email, password, role) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [name, extra.phone || null, extra.email || null, await bcrypt.hash(extra.secret, 8), role])).rows[0].id;
const ids = { admin: await user('Screen Admin', 'admin', { email: 'admin@sim.test', secret: 'Admin#Sim1' }),
  fresh: await user('Lalitha Ramesh', 'patient', { phone: '9000000201', secret: '1357' }), vol: await user('Girish Bhat', 'patient', { phone: '9000000202', secret: '2468' }),
  hi: await user('Sunita Yadav', 'patient', { phone: '9000000203', secret: '1111' }), test: await user('Voice Test', 'patient', { phone: '9000000204', secret: '2222' }) };
for (const id of [ids.fresh, ids.vol, ids.hi, ids.test]) await c.query('INSERT INTO patient_profiles (user_id) VALUES ($1)', [id]);
const part = async (pid, code, grp, consented) => (await c.query(`INSERT INTO voice_calibration_participants (patient_id, code, grp, profile_note, invited_by, consented_at, consent_version, phone_type, browser)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [pid, code, grp, '40s', ids.admin, consented ? new Date() : null, consented ? C.CONSENT_VERSION : null, consented ? 'android_budget' : null, consented ? 'chrome' : null])).rows[0].id;
const pFresh = await part(ids.fresh, 'P1', 'kn', false), pVol = await part(ids.vol, 'P2', 'kn', true); await part(ids.hi, 'P3', 'hi', true);
await c.query(`INSERT INTO voice_calibration_wording (lang, script_sha256, confirmed_by, recorded_by) VALUES ('kn',$1,'Fluent Kannada speaker',$2)`, [C.scriptSha('kn'), ids.admin]);
// A take with transcripts, for the admin's list (no audio: its link is the canned sound).
await c.query(`INSERT INTO voice_calibration_takes (participant_id, slot_code, take_no, object_key, mime_type, duration_ms, audio_sha256, speech_status, detector_version, voiced_frames, longest_run_frames, f0_spread_raw, hop_ms, voiced_ms, longest_run_ms,
  gemini_text, gemini_provenance, whisper_text, whisper_review, whisper_provenance) VALUES ($1,'k01-q',1,'voice-calibration/x/k01-q','audio/webm',3100,$2,'speech','speech-v1',120,30,41.2,20,2400,600,
  'Belagge 2 idli mattu 1 bowl sambar','{"model_used":"gemini-2.5-flash-lite"}','ಬೆಳಗ್ಗೆ ಎರಡು ಇಡ್ಲಿ','{"accepted":true}','{"language_sent":"kn"}')`, [pVol, 'a'.repeat(64)]);
await c.query(`INSERT INTO voice_calibration_partc (trial_no, captures, updated_at) VALUES (1, $1, NOW())`, [JSON.stringify([{ at: new Date().toISOString(), answered_by: 'gemini/gemini-2.5-flash-lite', transcript: '2 idli, 1 bowl sambar, weight 82.5 kg', trail: [{ engine: 'gemini', model: 'gemini-2.5-flash-lite', outcome: 'answer' }] }])]);
void pFresh;

// ── Server ──
const child = spawn(process.execPath, ['-r', path.join(HERE, 'voice-evidence-providers.cjs'), '-r', path.join(HERE, 'calibration-storage.cjs'), 'index.js'], { cwd: SRV,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: `${PG}/${DB}`, JWT_SECRET: 'sim-secret', JWT_REFRESH_SECRET: 'sim-refresh',
    RAILWAY_GIT_BRANCH: 'test', GEMINI_API_KEY: 'sim', GROQ_API_KEY: 'sim', CLIENT_URL: BASE, SIM_AUDIO_FILE: SILENCE }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {} await wait(500); }

// ── Browser ──
const browser = await puppeteer.launch({ executablePath: await browserExecutable(chromium), headless: true,
  args: [...chromium.args.filter(a => !/single-process|no-zygote/.test(a)), '--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const tap = (page, re, sel = 'button,a,[role=button]') => page.evaluate((s, f, sel) => { const rx = new RegExp(s, f); const el = [...document.querySelectorAll(sel)].find(e => e.offsetParent !== null && (rx.test(e.textContent.trim()) || rx.test(e.getAttribute('aria-label') || ''))); if (el) el.click(); return !!el; }, re.source, re.flags, sel);
async function page(width, theme) {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage();
  await p.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await p.evaluateOnNewDocument(() => {
    const orig = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices); if (!orig) return;
    navigator.mediaDevices.getUserMedia = async (cn) => {
      if (!window.__micB64 || !cn?.audio) return orig(cn);
      const ctx = new AudioContext(); await ctx.resume().catch(() => {});
      const buf = await ctx.decodeAudioData(Uint8Array.from(atob(window.__micB64), ch => ch.charCodeAt(0)).buffer);
      const src = ctx.createBufferSource(); src.buffer = buf; const dest = ctx.createMediaStreamDestination(); src.connect(dest); src.start(ctx.currentTime + 0.2); return dest.stream;
    };
    window.confirm = () => true;
  });
  return p;
}
const contrastOf = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel); if (!el) return null;
  const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fg = rgb(getComputedStyle(el).color); let n = el, bg = null;
  while (n && !bg) { const cc = rgb(getComputedStyle(n).backgroundColor); if (cc.length >= 3 && (cc.length < 4 || cc[3] > 0.9)) bg = cc; n = n.parentElement; }
  bg = bg || [255, 255, 255];
  const a = lum(fg), b = lum(bg); return Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2));
}, sel);
const sideways = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
async function memberLogin(m, phone, pin) {
  await m.goto(BASE, { waitUntil: 'networkidle2' });
  await m.waitForSelector('input[type=tel]'); await m.type('input[type=tel]', phone); await m.type('input[type=password]', pin); await tap(m, /^Log In/);
  await m.waitForFunction(() => document.querySelector('[data-testid="daily-essentials"], [data-testid="onb-next"], [data-testid="onb-primary"]'), { timeout: 30e3 });
  for (let i = 0; i < 8 && !(await m.$('[data-testid="daily-essentials"]')); i++) {
    await m.evaluate(() => { [...document.querySelectorAll('[data-testid="onb-modes"] button')].find(b => /Adult/.test(b.textContent))?.click(); if (document.querySelector('[data-testid="onb-goals"]') && !document.querySelector('[data-testid="onb-goals"] button[aria-pressed="true"]')) document.querySelector('[data-testid="onb-goals"] button')?.click(); });
    await wait(300); const next = await m.$('[data-testid="onb-next"]:not([disabled])') || await m.$('[data-testid="onb-primary"]:not([disabled])'); if (next) await next.click(); await wait(1200);
  }
  await m.waitForSelector('[data-testid="daily-essentials"]', { timeout: 30e3 });
  await m.evaluate(() => [...document.querySelectorAll('button')].find(b => /^Got it$/.test(b.textContent.trim()))?.click());
  // The card lives in "Check-ins & recovery", folded by default (as the Kannada voice test card).
  await m.evaluate(() => { const box = document.querySelector('[data-testid="home-insight-details"]'); const b = box?.querySelector('button[aria-expanded="false"]') || box?.querySelector('button'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); });
  await wait(600);
}
const controlSlots = ['x01-q', 'x01-n', 'x02-q', 'x02-n'];
let k = 0;
for (const theme of ['light', 'dark']) for (const width of [360, 390]) {
  console.log(`\n[${theme}, ${width} px]`);
  // 1. Not agreed yet.
  const f = await page(width, theme);
  await memberLogin(f, '9000000201', '1357');
  const card = await f.waitForSelector('[data-testid="vc-card"]', { timeout: 20e3 }).then(() => true, () => false);
  await f.evaluate(() => document.querySelector('[data-testid="vc-card"]')?.scrollIntoView({ block: 'center' }));
  const fc = `member-card-${theme}-${width}.png`; await f.screenshot({ path: path.join(OUT, fc) });
  await f.$eval('[data-testid="vc-card"]', b => b.click());
  await f.waitForSelector('[data-testid="vc-consent"]', { visible: true, timeout: 15e3 });
  const consentContrast = await contrastOf(f, '[data-testid="vc-consent"] li');
  const fa = `member-agree-${theme}-${width}.png`; await f.screenshot({ path: path.join(OUT, fa) });
  ck('volunteer not agreed yet: the card on Today and the agreement screen (phone and browser asked)', card && !!(await f.$('[data-testid="vc-phone"]')) && !!(await f.$('[data-testid="vc-browser"]')));
  results.push({ screen: 'volunteer card + agreement', theme, width, contrast_consent: consentContrast, sideways_scroll: await sideways(f), files: [fc, fa] });
  await f.browserContext().close();

  // 2. Agreed: record a no-speech clip, then record it again (a reason is required; both kept).
  const m = await page(width, theme);
  await memberLogin(m, '9000000202', '2468');
  await m.waitForSelector('[data-testid="vc-card"]', { timeout: 20e3 }); await m.$eval('[data-testid="vc-card"]', b => b.click());
  await m.waitForSelector('[data-testid="vc-slots"]', { visible: true, timeout: 15e3 });
  const slot = controlSlots[k++];
  const enLocked = await m.$eval('[data-testid="vc-slot-e01-q"]', b => b.disabled);
  const knOpen = await m.$eval('[data-testid="vc-slot-k01-q"]', b => !b.disabled);
  await m.evaluate(b64 => { window.__micB64 = b64; }, fs.readFileSync(SILENCE).toString('base64'));
  await m.$eval(`[data-testid="vc-slot-${slot}"]`, b => { b.scrollIntoView({ block: 'center' }); b.click(); });
  await m.waitForSelector(`[data-testid="vc-rec-${slot}"] [data-testid="vc-record"]`, { visible: true });
  await m.$eval(`[data-testid="vc-rec-${slot}"] [data-testid="vc-record"]`, b => b.click()); await wait(6500);
  await m.$eval(`[data-testid="vc-rec-${slot}"] [data-testid="vc-record"]`, b => b.click());
  await m.waitForSelector(`[data-testid="vc-rec-${slot}"] [data-testid="vc-send"]`, { visible: true, timeout: 10e3 });
  await m.$eval(`[data-testid="vc-rec-${slot}"] [data-testid="vc-send"]`, b => b.click());
  await m.waitForFunction(() => !document.querySelector('[data-testid^="vc-rec-"]'), { timeout: 60e3 }).catch(() => {});
  const first = (await c.query(`SELECT COUNT(*)::int n FROM voice_calibration_takes WHERE participant_id=$1 AND slot_code=$2`, [pVol, slot])).rows[0].n;
  await m.$eval(`[data-testid="vc-slot-${slot}"]`, b => { b.scrollIntoView({ block: 'center' }); b.click(); });
  const reasonShown = await m.waitForSelector(`[data-testid="vc-rec-${slot}"] [data-testid="vc-reason"]`, { visible: true, timeout: 10e3 }).then(() => true, () => false);
  const fr = `member-retake-reason-${theme}-${width}.png`; await m.screenshot({ path: path.join(OUT, fr) });
  await m.select(`[data-testid="vc-rec-${slot}"] select`, 'cut_off');
  await m.$eval(`[data-testid="vc-rec-${slot}"] [data-testid="vc-record"]`, b => b.click()); await wait(6500);
  await m.$eval(`[data-testid="vc-rec-${slot}"] [data-testid="vc-record"]`, b => b.click());
  await m.waitForSelector(`[data-testid="vc-rec-${slot}"] [data-testid="vc-send"]`, { visible: true, timeout: 10e3 });
  await m.$eval(`[data-testid="vc-rec-${slot}"] [data-testid="vc-send"]`, b => b.click());
  await m.waitForFunction(() => !document.querySelector('[data-testid^="vc-rec-"]'), { timeout: 60e3 }).catch(() => {});
  const rows = (await c.query(`SELECT take_no, superseded_at, retake_reason, speech_status, gemini_provenance, whisper_text FROM voice_calibration_takes WHERE participant_id=$1 AND slot_code=$2 ORDER BY take_no`, [pVol, slot])).rows;
  const keptText = await m.$eval(`[data-testid="vc-slot-${slot}"]`, b => b.textContent);
  ck(`recorded ${slot} through the microphone and sent it (take 1: silence, refused by the live check, both engines asked)`, first === 1 && rows[0]?.speech_status === 'no_speech' && rows[0]?.gemini_provenance && rows[0]?.whisper_text != null, rows[0]);
  ck('recording it again asked for a reason; take 2 kept beside take 1 ("Recorded 2 times (all kept)")', reasonShown && rows.length === 2 && rows[0].superseded_at && rows[1].retake_reason === 'cut_off' && /Recorded 2 times/.test(keptText), { reasonShown, keptText });
  const placeShown = await m.evaluate(() => /in the quiet room/.test(document.querySelector('[data-testid="vc-slot-x01-q"]')?.textContent || '') && /everyday noise on/.test(document.querySelector('[data-testid="vc-slot-x01-n"]')?.textContent || ''));
  ck('wording gate on screen: Kannada lines open (confirmed), English lines locked; each no-speech clip says which place', knOpen && enLocked && placeShown);
  const lockedContrast = await m.evaluate(() => { const el = document.querySelector('[data-testid="vc-slot-e01-q"] .text-mid'); if (el) el.setAttribute('data-shot', 'locked'); return !!el; }) ? await contrastOf(m, '[data-shot="locked"]') : null;
  await m.$eval('[data-testid="vc-group-q"]', e => e.scrollIntoView({ block: 'start' }));
  const fs1 = `member-slots-${theme}-${width}.png`; await m.screenshot({ path: path.join(OUT, fs1) });
  results.push({ screen: 'volunteer slots + record + retake', theme, width, contrast_locked_note: lockedContrast, sideways_scroll: await sideways(m), files: [fr, fs1] });
  await m.browserContext().close();

  // 3. The administrator's panel.
  const a = await page(width, theme);
  await a.goto(BASE, { waitUntil: 'networkidle2' });
  await a.waitForSelector('input[type=tel]'); await tap(a, /Coach \/ Admin/);
  await a.waitForSelector('input[type=email]', { visible: true }); await a.type('input[type=email]', 'admin@sim.test'); await a.type('input[type=password]', 'Admin#Sim1'); await tap(a, /^Sign In/);
  await a.waitForSelector('[data-testid="vc-panel"]', { visible: true, timeout: 30e3 });
  for (const s of ['vc-words', 'vc-takes', 'vc-partc']) { await a.$eval(`[data-testid="${s}"] > button`, b => b.click()); await wait(500); }
  await a.waitForSelector('[data-testid="vc-take"]', { timeout: 10e3 }).catch(() => {});
  const takesShown = (await a.$$('[data-testid="vc-take"]')).length;
  const panelText = await a.$eval('[data-testid="vc-panel"]', e => e.innerText);
  const cMid = await contrastOf(a, '[data-testid="vc-panel"] p.text-mid');
  const cLo = await a.evaluate(() => { const el = document.querySelector('[data-testid="vc-panel"] .text-lo'); if (el) el.setAttribute('data-shot', 'lo'); return !!el; }) ? await contrastOf(a, '[data-shot="lo"]') : null;
  ck('admin panel: volunteers, wording (Kannada confirmed, Hindi and English locked), takes with the listener\'s labels, the 32 Part C tries, the download',
    /3 of 6 volunteers/.test(panelText) && /Kannada: confirmed by Fluent Kannada speaker/.test(panelText) && /Hindi: not confirmed, locked/.test(panelText) && takesShown >= 3 && /Heard:.*Speech.*No speech.*Unsure/s.test(panelText)
    && /Said as written\?/.test(panelText) && /Actual path: gemini\/gemini-2.5-flash-lite/.test(panelText) && /\b32\b/.test(panelText) && !!(await a.$('[data-testid="vc-download"]')) && !!(await a.$('[data-testid="vc-preview-eval"]')), { takesShown });
  const fp = `admin-panel-${theme}-${width}.png`; await (await a.$('[data-testid="vc-panel"]')).screenshot({ path: path.join(OUT, fp), captureBeyondViewport: true });
  results.push({ screen: 'admin calibration panel', theme, width, contrast_mid: cMid, contrast_lo: cLo, sideways_scroll: await sideways(a), file: fp });
  await a.browserContext().close();
}

// ── 4. The app's Part C mode, with a fake on-device recogniser ──
console.log('\n[Part C mode in the app: on-device words, controlled upload, production address]');
const FAKE_SR = (text) => { window.__srText = text; class FakeSR { constructor() { this.lang = ''; this._end = []; } start() { setTimeout(() => { const r = [Object.assign([{ transcript: window.__srText }], { isFinal: true })]; this.onresult?.({ results: r, resultIndex: 0 }); }, 700); }
  stop() { setTimeout(() => { this.onend?.(); this._end.forEach(f => f()); }, 50); } abort() { this.stop(); } addEventListener(t, f) { if (t === 'end') this._end.push(f); } removeEventListener() {} }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR; };
const SPEECH_WAV = path.join(TMP, 'speech.wav');
execFileSync('espeak-ng', ['-v', 'en', '-w', SPEECH_WAV, 'two idli one bowl sambar']);
async function testAccountComposer(base, withFake = true) {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (withFake) await p.evaluateOnNewDocument(FAKE_SR, 'two idli one bowl sambar');
  await p.evaluateOnNewDocument(() => {
    const orig = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices); if (!orig) return;
    navigator.mediaDevices.getUserMedia = async (cn) => { if (!window.__micB64 || !cn?.audio) return orig(cn);
      const ctx = new AudioContext(); await ctx.resume().catch(() => {}); const buf = await ctx.decodeAudioData(Uint8Array.from(atob(window.__micB64), ch => ch.charCodeAt(0)).buffer);
      const src = ctx.createBufferSource(); src.buffer = buf; const dest = ctx.createMediaStreamDestination(); src.connect(dest); src.start(ctx.currentTime + 0.2); return dest.stream; };
  });
  const seen = []; p.on('request', r => { if (/\/api\//.test(r.url())) seen.push(r.url().replace(/^https?:\/\/[^/]+/, '')); });
  await p.goto(base, { waitUntil: 'networkidle2' });
  await p.waitForSelector('input[type=tel]'); await p.type('input[type=tel]', '9000000204'); await p.type('input[type=password]', '2222'); await tap(p, /^Log In/);
  await p.waitForFunction(() => document.querySelector('[data-testid="daily-essentials"], [data-testid="onb-next"], [data-testid="onb-primary"]'), { timeout: 30e3 });
  for (let i = 0; i < 8 && !(await p.$('[data-testid="daily-essentials"]')); i++) {
    await p.evaluate(() => { [...document.querySelectorAll('[data-testid="onb-modes"] button')].find(b => /Adult/.test(b.textContent))?.click(); if (document.querySelector('[data-testid="onb-goals"]') && !document.querySelector('[data-testid="onb-goals"] button[aria-pressed="true"]')) document.querySelector('[data-testid="onb-goals"] button')?.click(); });
    await wait(300); const next = await p.$('[data-testid="onb-next"]:not([disabled])') || await p.$('[data-testid="onb-primary"]:not([disabled])'); if (next) await next.click(); await wait(1200);
  }
  await p.waitForSelector('[data-testid="daily-essentials"]', { timeout: 30e3 });
  await p.evaluate(() => [...document.querySelectorAll('button')].find(b => /^Got it$/.test(b.textContent.trim()))?.click());
  await p.$eval('[data-testid="ai-type"]', b => b.click());
  await p.waitForSelector('[data-testid="composer-input"]', { visible: true });
  await p.select('[data-testid="voice-language-ready"]', 'en-IN').catch(() => {});
  await wait(800);
  return { p, seen };
}
async function speak(p, shot) {
  await p.evaluate(b64 => { window.__micB64 = b64; }, fs.readFileSync(SPEECH_WAV).toString('base64'));
  await tap(p, /^Speak your log$/); await wait(1500);
  const banner = await p.$eval('[data-testid="voice-calibration-banner"]', e => e.textContent).catch(() => '');
  if (shot) await p.screenshot({ path: path.join(OUT, shot) });
  await wait(1500); await tap(p, /^Stop recording$/); await wait(6000);
  return banner;
}
// Arm and finish directly in the database (the admin routes are covered by test-voice-calibration).
const arm = async (trial, route) => { await c.query(`DELETE FROM voice_calibration_partc_armed`); await c.query(`INSERT INTO voice_calibration_partc_armed (id, trial_no, route, user_id, armed_by) VALUES (1,$1,$2,$3,$4)`, [trial, route, ids.test, ids.admin]); };
const caps = async (trial) => ((await c.query(`SELECT captures FROM voice_calibration_partc WHERE trial_no=$1`, [trial])).rows[0]?.captures || []);
{
  await c.query(`DELETE FROM voice_calibration_partc_armed`);
  let { p, seen } = await testAccountComposer(BASE);
  const bannerNone = await speak(p);
  const noneUpload = seen.some(u => /voice-transcribe/.test(u)), noneDevice = seen.some(u => /device-event/.test(u));
  ck('not armed: no label; the on-device words are used (no upload), and nothing calibration-related is sent', !bannerNone && !noneUpload && !noneDevice && seen.some(u => /voice-calibration\/partc\/me/.test(u)), seen.filter(u => /voice|calibration/.test(u)));
  await p.browserContext().close();

  await arm(33, 'natural');
  ({ p, seen } = await testAccountComposer(BASE));
  const bannerN = await speak(p, 'member-composer-natural-try.png'); await wait(500);
  let cs = await caps(33);
  ck('natural try: the label says so; on-device words used with NO upload, recorded as "browser/on-device (no upload)"', /try 33/.test(bannerN) && /as it happens/.test(bannerN) && !seen.some(u => /voice-transcribe/.test(u))
    && cs.some(x => x.kind === 'on-device dictation' && x.actual_path === 'browser/on-device (no upload)'), { bannerN, cs: cs.map(x => x.kind) });
  await p.browserContext().close();

  await arm(1, 'controlled');
  ({ p, seen } = await testAccountComposer(BASE));
  const bannerC = await speak(p, 'member-composer-controlled-try.png'); await wait(500);
  cs = await caps(1);
  ck('controlled try: the label says the recording goes to the server; the on-device words are NOT used; the recording is uploaded and recorded as a server recording', /try 1/.test(bannerC) && /goes to the server/.test(bannerC)
    && seen.some(u => /voice-transcribe/.test(u)) && cs.some(x => x.kind === 'server recording' && x.upload === true), { bannerC, cs: cs.map(x => [x.kind, x.actual_path]) });
  await p.browserContext().close();
  await c.query(`DELETE FROM voice_calibration_partc_armed`);
}
// The production address (mapped to this computer): the app never asks.
{
  const prodBrowser = await puppeteer.launch({ executablePath: await browserExecutable(chromium), headless: true,
    args: [...chromium.args.filter(a => !/single-process|no-zygote/.test(a)), '--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--host-resolver-rules=MAP fitness.upscale-app.com 127.0.0.1`] });
  const ctx = await prodBrowser.createBrowserContext(); const p = await ctx.newPage();
  const seen = []; p.on('request', r => { if (/\/api\//.test(r.url())) seen.push(r.url()); });
  // The page keeps the production address; its requests (which the app's security policy upgrades to https)
  // are answered by this computer's server, so the app runs exactly as served, under that hostname.
  await p.setRequestInterception(true);
  p.on('request', async (r) => {
    const u = new URL(r.url());
    if (u.hostname !== 'fitness.upscale-app.com') return r.continue();
    try {
      const resp = await fetch(`${BASE}${u.pathname}${u.search}`, { method: r.method(), headers: { ...r.headers(), host: 'fitness.upscale-app.com' }, body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postData() });
      const headers = Object.fromEntries([...resp.headers.entries()].filter(([k]) => !['content-encoding', 'content-length', 'strict-transport-security', 'transfer-encoding'].includes(k)));
      await r.respond({ status: resp.status, headers, body: Buffer.from(await resp.arrayBuffer()) });
    } catch (e) { r.abort().catch(() => {}); }
  });
  await arm(1, 'controlled');
  await p.goto(`https://fitness.upscale-app.com/`, { waitUntil: 'networkidle2' }).catch(() => {});
  const loaded = await p.waitForSelector('input[type=tel]', { timeout: 15e3 }).then(() => true, () => false);
  if (loaded) { await p.type('input[type=tel]', '9000000204'); await p.type('input[type=password]', '2222'); await tap(p, /^Log In/); await wait(4000);
    await p.evaluate(() => [...document.querySelectorAll('button')].find(b => /^Got it$/.test(b.textContent.trim()))?.click());
    await p.$eval('[data-testid="ai-type"]', b => b.click()).catch(() => {}); await wait(2000); }
  ck('the app opened at the production address never asks about calibration (no /voice-calibration request), even with a try armed for the account', loaded && seen.length > 0 && !seen.some(u => /voice-calibration/.test(u)), { loaded, n: seen.length, cal: seen.filter(u => /calibration/.test(u)) });
  await prodBrowser.close();
  await c.query(`DELETE FROM voice_calibration_partc_armed`);
}

await browser.close(); child.kill(); await c.end();
for (const r of results) {
  const cs = Object.entries(r).filter(([kk]) => kk.startsWith('contrast')).map(([, v]) => v).filter(v => v != null);
  ck(`${r.screen}, ${r.theme} ${r.width}px: no sideways scroll; text contrast ≥ 4.5 (${cs.join(', ')})`, !r.sideways_scroll && cs.length > 0 && cs.every(v => v >= 4.5), r);
}
fs.writeFileSync(path.join(OUT, 'screens-2x.json'), JSON.stringify(results, null, 1));
if (fail) console.log(log.slice(-1500));
console.log(`\nCalibration screens (SIMULATED): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
