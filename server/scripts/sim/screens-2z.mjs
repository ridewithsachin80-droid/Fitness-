#!/usr/bin/env node
/**
 * scripts/sim/screens-2z.mjs — Fixes-2z screen check (SIMULATION ONLY, never the site; screens-2y.mjs is kept unchanged and is
 * run as well). Every screenshot is stamped "SIMULATED" and its file name starts with SIMULATED-. New screens in 2z, at 360 and
 * 390 px in the light AND dark themes:
 *   1. the administrator's take list: a no-speech control whose frozen label says speech was heard (an excluded clip) offers
 *      "Not usable: ask for a replacement"; tapping it records the request, and the take stays in the record;
 *   2. a frozen take whose words say the same count twice shows the line as "needs a hand check" with the reason;
 *   3. the listener's reference editor has a grams box on count items (a weight said with the count);
 *   4. the volunteer's list says "Your coach asked you to record this one again", and the reason is already chosen.
 * Starts the real server on this computer with canned providers and in-memory storage. No microphone, no recording.
 * Measures text contrast in each theme and checks the page never scrolls sideways.
 *
 *   node scripts/sim/screens-2z.mjs <output folder>
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
const DB = 'fitlife_screens_2z', PORT = 3994, BASE = `http://localhost:${PORT}`;
process.env.DATABASE_URL = `${PG}/${DB}`;
const C = require('../../services/voiceCalibration');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'screens-2z-'));
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'screens-2z-tmp-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = []; let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 400))); };
const SILENCE = path.join(TMP, 'silence.wav');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '2', '-c:a', 'pcm_s16le', SILENCE]);

// ── Database ──
const admin = new Client({ connectionString: `${PG}/postgres` }); await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
execFileSync('psql', [`${PG}/${DB}`, '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(SRV, 'db/schema.sql')], { stdio: ['ignore', 'ignore', 'pipe'] });
const c = new Client({ connectionString: `${PG}/${DB}` }); await c.connect();
const user = async (name, role, extra) => (await c.query(`INSERT INTO users (name, phone, email, password, role) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [name, extra.phone || null, extra.email || null, await bcrypt.hash(extra.secret, 8), role])).rows[0].id;
const ids = { admin: await user('Screen Admin', 'admin', { email: 'admin@sim.test', secret: 'Admin#Sim1' }), vol: await user('Girish Bhat', 'patient', { phone: '9000000202', secret: '2468' }) };
await c.query('INSERT INTO patient_profiles (user_id) VALUES ($1)', [ids.vol]);
const pVol = (await c.query(`INSERT INTO voice_calibration_participants (patient_id, code, grp, profile_note, invited_by, consented_at, consent_version, phone_type, browser, device)
  VALUES ($1,'P1','kn','40s',$2,NOW(),$3,'android_budget','chrome',$4) RETURNING id`, [ids.vol, ids.admin, C.CONSENT_VERSION, JSON.stringify({ make: 'Redmi', model: '12C', os: 'android', os_version: '13', browser_version: '129', browser: 'chrome' })])).rows[0].id;
await c.query(`INSERT INTO voice_calibration_reviewers (code, name, role, langs, created_by) VALUES ('R1','Kannada Reviewer Example','both','kn',$1)`, [ids.admin]);
await c.query(`INSERT INTO voice_calibration_wording (lang, script_sha256, confirmed_by, recorded_by) VALUES ('kn',$1,'R1',$2)`, [C.scriptSha('kn'), ids.admin]);
const take = async (slot, o) => (await c.query(`INSERT INTO voice_calibration_takes (participant_id, slot_code, take_no, object_key, mime_type, duration_ms, audio_sha256, speech_status, detector_version, voiced_frames, longest_run_frames, f0_spread_raw, hop_ms, voiced_ms, longest_run_ms,
  gemini_text, gemini_provenance, whisper_text, whisper_review, whisper_provenance, heard, spoken_as_script, reference_mode, reference_text, reference_version, reference_sha, reference_frozen_at, listener_code, reference_history)
  VALUES ($1,$2,1,$3,'audio/webm',3000,$4,$5,'speech-v1',$6,$7,$8,20,$9,$10,$11,'{"model_used":"gemini-2.5-flash-lite"}',$12,'{"accepted":true}','{"language_sent":"kn"}',$13,$14,$15,$16,$17,$18,$19,$20,'[]') RETURNING id`,
  [pVol, slot, `voice-calibration/x/${slot}`, slot.padEnd(64, 'a').slice(0, 64), o.status, o.vf, o.lr, o.f0, o.vf * 20, o.lr * 20, o.g, o.w, o.ref?.heard ?? null, o.ref?.spoken_as_script ?? null, o.ref?.mode ?? null, o.ref?.text ?? null,
    o.ref ? 1 : 0, o.ref ? C.referenceSha(o.ref) : null, o.ref ? new Date() : null, o.ref ? 'R1' : null])).rows[0].id;
// 1. A no-speech control in which the listener heard a TV voice: excluded (a protocol deviation), measured by the live check.
const excludedId = await take('x02-n', { status: 'no_speech', vf: 3, lr: 2, f0: 4, g: '', w: '', ref: { heard: 'speech', spoken_as_script: null, mode: null, items: null, text: 'TV voice in the background' } });
// 2. A frozen speech take whose Gemini words say the same count twice.
await take('k01-n', { status: 'speech', vf: 120, lr: 30, f0: 40, g: 'Belagge 2 idli and 2 idli mattu 1 bowl sambar thinde', w: 'Belagge eradu idli mattu ondu bowl sambar thinde', ref: { heard: 'speech', spoken_as_script: true, mode: 'as_script', items: null, text: null } });
// 3. An unfrozen speech take: the listener's form (with a grams box once items are listed).
await take('k01-q', { status: 'speech', vf: 110, lr: 30, f0: 38, g: 'Belagge 2 idli, 100 grams, 1 bowl sambar', w: 'x', ref: null });

// ── Server ──
const child = spawn(process.execPath, ['-r', path.join(HERE, 'voice-evidence-providers.cjs'), '-r', path.join(HERE, 'calibration-storage.cjs'), 'index.js'], { cwd: SRV,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: `${PG}/${DB}`, JWT_SECRET: 'sim-secret', JWT_REFRESH_SECRET: 'sim-refresh',
    RAILWAY_GIT_BRANCH: 'test', GEMINI_API_KEY: 'sim', GROQ_API_KEY: 'sim', CLIENT_URL: BASE, SIM_AUDIO_FILE: SILENCE }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {} await wait(500); }

// ── Browser ──
const browser = await puppeteer.launch({ executablePath: await browserExecutable(chromium), headless: true,
  args: [...chromium.args.filter(a => !/single-process|no-zygote/.test(a)), '--no-sandbox', '--disable-dev-shm-usage'] });
const tap = (page, re, sel = 'button,a,[role=button]') => page.evaluate((s, f, sel) => { const rx = new RegExp(s, f); const el = [...document.querySelectorAll(sel)].find(e => e.offsetParent !== null && (rx.test(e.textContent.trim()) || rx.test(e.getAttribute('aria-label') || ''))); if (el) el.click(); return !!el; }, re.source, re.flags, sel);
async function page(width, theme) {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage();
  await p.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await p.evaluateOnNewDocument(() => { window.confirm = () => true; });
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
const stamp = (p) => p.evaluate(() => { if (document.getElementById('sim-stamp')) return; const d = document.createElement('div'); d.id = 'sim-stamp';
  d.textContent = 'SIMULATED · local test server · synthetic data'; d.setAttribute('style', 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#7a0019;color:#fff;font:700 11px/1.6 system-ui,sans-serif;text-align:center;letter-spacing:.04em;pointer-events:none');
  document.body.appendChild(d); });
const shot = async (p, file, el) => { await stamp(p); const f = `SIMULATED-${file}`; if (el) await el.screenshot({ path: path.join(OUT, f), captureBeyondViewport: true }); else await p.screenshot({ path: path.join(OUT, f) }); return f; };
const mark = (p, sel, name) => p.evaluate((sel, name) => { const el = document.querySelector(sel); if (el) el.setAttribute('data-shot', name); return !!el; }, sel, name);

for (const theme of ['light', 'dark']) for (const width of [360, 390]) {
  console.log(`\n[${theme}, ${width} px]`);
  await c.query(`UPDATE voice_calibration_takes SET replacement_authorised = NULL WHERE id=$1`, [excludedId]);
  // ── Admin ──
  const a = await page(width, theme);
  await a.goto(BASE, { waitUntil: 'networkidle2' });
  await a.waitForSelector('input[type=tel]'); await tap(a, /Coach \/ Admin/);
  await a.waitForSelector('input[type=email]', { visible: true }); await a.type('input[type=email]', 'admin@sim.test'); await a.type('input[type=password]', 'Admin#Sim1'); await tap(a, /^Sign In/);
  await a.waitForSelector('[data-testid="vc-panel"]', { visible: true, timeout: 30e3 });
  await a.$eval('[data-testid="vc-takes"] > button', b => b.click());
  await a.waitForSelector('[data-testid="vc-take"]', { timeout: 10e3 }).catch(() => {});
  const cardOf = (slot) => a.$$eval('[data-testid="vc-take"]', (els, slot) => { const e = els.find(x => x.textContent.includes(slot)); if (!e) return null; e.setAttribute('data-shot-card', slot); return { text: e.innerText, ask: !!e.querySelector('[data-testid="vc-ask-replacement"]'), asked: !!e.querySelector('[data-testid="vc-replacement-asked"]') }; }, slot);
  const before = await cardOf('x02-n');
  const ctlCard = await a.$('[data-shot-card="x02-n"]'); await ctlCard.evaluate(e => e.scrollIntoView({ block: 'center' }));
  const f1 = await shot(a, `admin-excluded-control-${theme}-${width}.png`, ctlCard);
  await a.$eval('[data-shot-card="x02-n"] [data-testid="vc-ask-replacement"]', b => b.click());
  await a.waitForSelector('[data-shot-card="x02-n"] [data-testid="vc-replacement-asked"]', { timeout: 10e3 }).catch(() => {});
  const after = await cardOf('x02-n');
  const row = (await c.query(`SELECT replacement_authorised, superseded_at FROM voice_calibration_takes WHERE id=$1`, [excludedId])).rows[0];
  const f2 = await shot(a, `admin-replacement-asked-${theme}-${width}.png`, await a.$('[data-shot-card="x02-n"]'));
  ck('an excluded control (speech heard in a no-speech clip) offers "Not usable: ask for a replacement"; tapping it records the request and the take stays',
    before?.ask && !before.asked && after?.asked && /Replacement asked for \(protocol deviation\); this take stays in the record/.test(after.text) && row.replacement_authorised?.why === 'protocol deviation' && !row.superseded_at, { before, after });
  await mark(a, '[data-shot-card="x02-n"] [data-testid="vc-replacement-asked"]', 'asked');
  const cAsked = await contrastOf(a, '[data-shot="asked"]');
  const rep = await cardOf('k01-n');
  ck('a frozen take whose words say the same count twice: "needs a hand check", with the reason shown (said more than once)', !!rep && /needs a hand check/.test(rep.text) && /said more than once/.test(rep.text) && !rep.ask, rep?.text?.slice(0, 400));
  await mark(a, '[data-shot-card="k01-n"] [data-testid="vc-score-gemini"] p', 'rep');
  const cRep = await contrastOf(a, '[data-shot="rep"]');
  const repCard = await a.$('[data-shot-card="k01-n"]'); await repCard.evaluate(e => e.scrollIntoView({ block: 'center' }));
  const f3 = await shot(a, `admin-repeated-count-${theme}-${width}.png`, repCard);
  // The reference editor: Heard speech → said as written: No → List the items → each count has a grams box.
  await cardOf('k01-q');
  const pick = (testid, re) => a.evaluate((testid, s) => { const b = [...document.querySelectorAll(`[data-shot-card="k01-q"] [data-testid="${testid}"] button`)].find(x => new RegExp(s).test(x.textContent.trim())); b?.click(); return !!b; }, testid, re);
  await pick('vc-heard', '^Speech$'); await wait(200); await pick('vc-as-written', '^No$'); await wait(300);
  const grams = await a.$$eval('[data-shot-card="k01-q"] [data-testid="vc-ref-item"]', els => els.map(e => !!e.querySelector('input[aria-label="Grams said with it (if any)"]')));
  const foodW = await a.$$eval('[data-shot-card="k01-q"] [data-testid="vc-ref-item"] select[aria-label="Food"]', els => els.map(e => Math.round(e.getBoundingClientRect().width)));
  const editor = await a.$('[data-shot-card="k01-q"]'); await editor.evaluate(e => e.scrollIntoView({ block: 'start' }));
  const f4 = await shot(a, `admin-reference-grams-${theme}-${width}.png`, editor);
  ck('the listener\'s reference editor has a grams box on each count item ("2 idli", "1 bowl sambar"), and the food picker stays readable (at least 120 px wide)', grams.length === 2 && grams.every(Boolean) && foodW.length === 2 && foodW.every(w => w >= 120), { grams, foodW });
  results.push({ screen: 'admin: excluded control, replacement, repeated count, grams box', theme, width, contrast_asked: cAsked, contrast_repeated: cRep, sideways_scroll: await sideways(a), files: [f1, f2, f3, f4] });
  await a.browserContext().close();

  // ── Volunteer ──
  const m = await page(width, theme);
  await m.goto(BASE, { waitUntil: 'networkidle2' });
  await m.waitForSelector('input[type=tel]'); await m.type('input[type=tel]', '9000000202'); await m.type('input[type=password]', '2468'); await tap(m, /^Log In/);
  await m.waitForFunction(() => document.querySelector('[data-testid="daily-essentials"], [data-testid="onb-next"], [data-testid="onb-primary"]'), { timeout: 30e3 });
  for (let i = 0; i < 8 && !(await m.$('[data-testid="daily-essentials"]')); i++) {
    await m.evaluate(() => { [...document.querySelectorAll('[data-testid="onb-modes"] button')].find(b => /Adult/.test(b.textContent))?.click(); if (document.querySelector('[data-testid="onb-goals"]') && !document.querySelector('[data-testid="onb-goals"] button[aria-pressed="true"]')) document.querySelector('[data-testid="onb-goals"] button')?.click(); });
    await wait(300); const next = await m.$('[data-testid="onb-next"]:not([disabled])') || await m.$('[data-testid="onb-primary"]:not([disabled])'); if (next) await next.click(); await wait(1200);
  }
  await m.waitForSelector('[data-testid="daily-essentials"]', { timeout: 30e3 });
  await m.evaluate(() => [...document.querySelectorAll('button')].find(b => /^Got it$/.test(b.textContent.trim()))?.click());
  await m.evaluate(() => { const box = document.querySelector('[data-testid="home-insight-details"]'); const b = box?.querySelector('button[aria-expanded="false"]') || box?.querySelector('button'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); });
  await wait(600);
  await m.waitForSelector('[data-testid="vc-card"]', { timeout: 20e3 }); await m.$eval('[data-testid="vc-card"]', b => b.click());
  await m.waitForSelector('[data-testid="vc-slots"]', { visible: true, timeout: 15e3 });
  const note = await m.$eval('[data-testid="vc-slot-x02-n"]', b => ({ text: b.textContent, note: !!b.querySelector('[data-testid="vc-replace-note"]') }));
  const others = await m.$$eval('[data-testid="vc-replace-note"]', els => els.length);
  await m.$eval('[data-testid="vc-slot-x02-n"]', b => b.scrollIntoView({ block: 'center' }));
  const cNote = await contrastOf(m, '[data-testid="vc-slot-x02-n"] [data-testid="vc-replace-note"]');
  const f5 = await shot(m, `member-replacement-note-${theme}-${width}.png`);
  await m.$eval('[data-testid="vc-slot-x02-n"]', b => b.click());
  await m.waitForSelector('[data-testid="vc-rec-x02-n"] [data-testid="vc-reason"]', { visible: true, timeout: 10e3 }).catch(() => {});
  const reason = await m.$eval('[data-testid="vc-rec-x02-n"] select', s => ({ value: s.value, label: s.options[s.selectedIndex]?.text })).catch(() => null);
  const f6 = await shot(m, `member-replacement-reason-${theme}-${width}.png`);
  ck('the volunteer\'s list says "Your coach asked you to record this one again" on that clip only, and the reason is already chosen', note.note && /Your coach asked you to record this one again/.test(note.text) && others === 1
    && reason?.value === 'replacement' && reason.label === 'My coach asked me to record it again', { note, others, reason });
  results.push({ screen: 'volunteer: replacement asked', theme, width, contrast_note: cNote, sideways_scroll: await sideways(m), files: [f5, f6] });
  await m.browserContext().close();
}
// The volunteer cannot pick "replacement" on a clip nobody asked about (the option is not offered).
{
  const m = await page(390, 'light');
  await m.goto(BASE, { waitUntil: 'networkidle2' });
  await m.waitForSelector('input[type=tel]'); await m.type('input[type=tel]', '9000000202'); await m.type('input[type=password]', '2468'); await tap(m, /^Log In/);
  await m.waitForSelector('[data-testid="daily-essentials"]', { timeout: 30e3 });
  await m.evaluate(() => [...document.querySelectorAll('button')].find(b => /^Got it$/.test(b.textContent.trim()))?.click());
  await m.evaluate(() => { const box = document.querySelector('[data-testid="home-insight-details"]'); const b = box?.querySelector('button[aria-expanded="false"]') || box?.querySelector('button'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); });
  await wait(600);
  await m.waitForSelector('[data-testid="vc-card"]', { timeout: 20e3 }); await m.$eval('[data-testid="vc-card"]', b => b.click());
  await m.waitForSelector('[data-testid="vc-slots"]', { visible: true, timeout: 15e3 });
  await m.$eval('[data-testid="vc-slot-k01-n"]', b => { b.scrollIntoView({ block: 'center' }); b.click(); });
  await m.waitForSelector('[data-testid="vc-rec-k01-n"] select', { visible: true, timeout: 10e3 }).catch(() => {});
  const opts = await m.$eval('[data-testid="vc-rec-k01-n"] select', s => [...s.options].map(o => o.value)).catch(() => null);
  ck('on a clip nobody asked about, "replacement" is not offered as a reason', Array.isArray(opts) && opts.length > 1 && !opts.includes('replacement'), opts);
  await m.browserContext().close();
}

await browser.close(); child.kill(); await c.end();
for (const r of results) {
  const cs = Object.entries(r).filter(([kk]) => kk.startsWith('contrast')).map(([, v]) => v).filter(v => v != null);
  ck(`${r.screen}, ${r.theme} ${r.width}px: no sideways scroll; text contrast ≥ 4.5 (${cs.join(', ')})`, !r.sideways_scroll && cs.length > 0 && cs.every(v => v >= 4.5), r);
}
fs.writeFileSync(path.join(OUT, 'screens-2z.json'), JSON.stringify(results, null, 1));
if (fail) console.log(log.slice(-1500));
console.log(`\nCalibration screens 2z (SIMULATED): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
