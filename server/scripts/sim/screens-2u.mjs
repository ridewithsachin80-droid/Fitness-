#!/usr/bin/env node
/**
 * scripts/sim/screens-2u.mjs — Fixes-2u screen check (SIMULATION ONLY, never the site).
 *
 * Starts the real server on this computer with the canned providers
 * (sim/voice-evidence-providers.cjs) and photographs, at 360 and 390 px in the
 * light AND dark themes:
 *   1. the member's voice composer after a silent recording: the new
 *      "Didn't catch any speech…" refusal, with Retry and Discard;
 *   2. the coach's voice-test card with an EMPTY Whisper answer and its kept
 *      attempts ("empty answer (no words)", "Attempts kept: empty → words").
 * Also measures the text contrast of those lines in each theme.
 *
 *   node scripts/sim/screens-2u.mjs <output folder>
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
const DB = 'fitlife_screens_2u', PORT = 3996, BASE = `http://localhost:${PORT}`;
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'screens-2u-'));
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'screens-2u-tmp-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];

const AUDIO = path.join(TMP, 'k01.webm');
execFileSync('espeak-ng', ['-v', 'kn', '-w', path.join(TMP, 'k01.wav'), 'ಎರಡು ಇಡ್ಲಿ ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್']);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(TMP, 'k01.wav'), '-c:a', 'libopus', AUDIO]);
const SILENCE = path.join(TMP, 'silence.wav');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '6', '-c:a', 'pcm_s16le', SILENCE]);

// ── Database ──
const admin = new Client({ connectionString: `${PG}/postgres` }); await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
execFileSync('psql', [`${PG}/${DB}`, '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(SRV, 'db/schema.sql')], { stdio: ['ignore', 'ignore', 'pipe'] });
const c = new Client({ connectionString: `${PG}/${DB}` }); await c.connect();
const user = async (name, role, extra) => (await c.query(`INSERT INTO users (name, phone, email, password, role) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [name, extra.phone || null, extra.email || null, await bcrypt.hash(extra.secret, 8), role])).rows[0].id;
const ids = { admin: await user('Screen Admin', 'admin', { email: 'admin@sim.test', secret: 'Admin#Sim1' }), voice: await user('Voice Robot', 'patient', { phone: '9000000101', secret: '2468' }), pilot: await user('Pilot Member', 'patient', { phone: '9000000102', secret: '1111' }) };
for (const id of [ids.voice, ids.pilot]) await c.query('INSERT INTO patient_profiles (user_id) VALUES ($1)', [id]);
const s1 = (await c.query(`INSERT INTO voice_samples (patient_id, phrase_id, object_key, mime_type, duration_ms, gemini_text, whisper_text, gemini_score, whisper_score, created_at) VALUES ($1,'k01',$2,'audio/webm',3000,'Belagge eradu idli ondu bowl sambar tinde','விளைகே இரடு இட்ளி',1,0,'2026-10-19T05:30:00Z') RETURNING id`, [ids.pilot, `voice-pilot/${ids.pilot}/k01`])).rows[0].id;
await c.query(`INSERT INTO voice_samples (patient_id, phrase_id, object_key, mime_type, duration_ms, gemini_text, whisper_text, gemini_score, whisper_score, created_at) VALUES ($1,'k02',$2,'audio/webm',3000,'Breakfast ge ondu plate uppittu ondu cup coffee.','breakfast 1 cup coffee',1,0.5,'2026-10-19T05:40:00Z')`, [ids.pilot, `voice-pilot/${ids.pilot}/k02`]);
// k01: the 21 Oct empty answer kept, then a later attempt with words.
await c.query(`INSERT INTO voice_sample_reruns (sample_id, engine, setting, text, language, score, created_at) VALUES ($1,'whisper','kn','ಎರಡು ಇಡ್ಲಿ ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್','kannada',0.67,'2026-10-21T14:00:00Z')`, [s1]);
await c.query(`INSERT INTO voice_sample_rerun_attempts (sample_id, engine, setting, text, language, score, outcome, source, attempted_at) VALUES ($1,'whisper','kn','',NULL,0,'empty','kept_from_latest','2026-10-21T08:15:30Z'), ($1,'whisper','kn','ಎರಡು ಇಡ್ಲಿ ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್','kannada',0.67,'transcript','rerun','2026-10-21T14:00:00Z')`, [s1]);
// k02's empty answer (an empty answer is shown as such, never as "no answer").
const s2 = (await c.query(`SELECT id FROM voice_samples WHERE phrase_id='k02'`)).rows[0].id;
await c.query(`INSERT INTO voice_sample_reruns (sample_id, engine, setting, text, language, score, created_at) VALUES ($1,'whisper','kn','',NULL,0,'2026-10-21T08:15:31Z')`, [s2]);

// ── Server ──
const child = spawn(process.execPath, ['-r', path.join(HERE, 'voice-evidence-providers.cjs'), 'index.js'], { cwd: SRV,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: `${PG}/${DB}`, JWT_SECRET: 'sim-secret', JWT_REFRESH_SECRET: 'sim-refresh',
    RAILWAY_GIT_BRANCH: 'test', GEMINI_API_KEY: 'sim', GROQ_API_KEY: 'sim', CLIENT_URL: BASE, SIM_AUDIO_FILE: AUDIO }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  });
  return p;
}
/** Contrast of an element's text against the nearest opaque background (WCAG ratio). */
const contrastOf = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel); if (!el) return null;
  const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fg = rgb(getComputedStyle(el).color); let n = el, bg = null;
  while (n && !bg) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.9)) bg = c; n = n.parentElement; }
  bg = bg || [255, 255, 255];
  const a = lum(fg), b = lum(bg); return Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2));
}, sel);

for (const theme of ['light', 'dark']) for (const width of [360, 390]) {
  // 1. The member's refusal.
  const m = await page(width, theme);
  await m.goto(BASE, { waitUntil: 'networkidle2' });
  await m.waitForSelector('input[type=tel]'); await m.type('input[type=tel]', '9000000101'); await m.type('input[type=password]', '2468'); await tap(m, /^Log In/);
  await m.waitForFunction(() => document.querySelector('[data-testid="daily-essentials"], [data-testid="onb-next"], [data-testid="onb-primary"]'), { timeout: 30e3 });
  for (let i = 0; i < 8 && !(await m.$('[data-testid="daily-essentials"]')); i++) {
    await m.evaluate(() => { [...document.querySelectorAll('[data-testid="onb-modes"] button')].find(b => /Adult/.test(b.textContent))?.click(); if (document.querySelector('[data-testid="onb-goals"]') && !document.querySelector('[data-testid="onb-goals"] button[aria-pressed="true"]')) document.querySelector('[data-testid="onb-goals"] button')?.click(); });
    await wait(300); const next = await m.$('[data-testid="onb-next"]:not([disabled])') || await m.$('[data-testid="onb-primary"]:not([disabled])'); if (next) await next.click(); await wait(1200);
  }
  await m.waitForSelector('[data-testid="daily-essentials"]', { timeout: 30e3 });
  await m.evaluate(() => [...document.querySelectorAll('button')].find(b => /^Got it$/.test(b.textContent.trim()))?.click());
  await m.$eval('[data-testid="ai-type"]', b => b.click());
  await m.waitForSelector('[data-testid="composer-input"]', { visible: true });
  await m.select('[data-testid="voice-language-ready"]', 'en-IN');
  await m.evaluate(b64 => { window.__micB64 = b64; }, fs.readFileSync(SILENCE).toString('base64'));
  await tap(m, /^Speak your log$/); await wait(7000); await tap(m, /^Stop recording$/);
  const shown = await m.waitForFunction(() => /Didn't catch any speech/.test(document.body.innerText), { timeout: 40e3 }).then(() => true, () => false);
  const statusSel = '[data-testid="voice-composer"] [role=status]';
  const contrast = await m.evaluate((sel) => { const el = [...document.querySelectorAll(sel)].find(e => /Didn't catch/.test(e.textContent)); if (el) el.setAttribute('data-shot', 'msg'); return !!el; }, statusSel).then(ok => ok ? contrastOf(m, '[data-shot="msg"]') : null);
  const sideways = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const f1 = `member-refusal-${theme}-${width}.png`; await m.screenshot({ path: path.join(OUT, f1) });
  results.push({ screen: 'member refusal', theme, width, shown, contrast, sideways_scroll: sideways, file: f1 });
  await m.browserContext().close();

  // 2. The coach's voice-test card.
  const a = await page(width, theme);
  await a.goto(BASE, { waitUntil: 'networkidle2' });
  await a.waitForSelector('input[type=tel]'); await tap(a, /Coach \/ Admin/);
  await a.waitForSelector('input[type=email]', { visible: true }); await a.type('input[type=email]', 'admin@sim.test'); await a.type('input[type=password]', 'Admin#Sim1'); await tap(a, /^Sign In/);
  await a.waitForSelector('[data-testid="vp-panel"]', { visible: true, timeout: 30e3 });
  if (await a.$('[data-testid="vp-toggle"][aria-expanded="false"]')) await a.$eval('[data-testid="vp-toggle"]', b => b.click());
  await a.waitForSelector('[data-testid="vp-row"]', { timeout: 20e3 });
  // Open both lines (k01: attempts kept; k02: the empty answer).
  const rows = await a.$$('[data-testid="vp-row"]'); for (const r of rows.slice(0, 2)) { await r.click(); await wait(500); }
  const emptyShown = await a.$('[data-testid="vp-rerun-empty"]') != null || await a.$('[data-testid="vp-empty-whisper"]') != null;
  const attemptsText = await a.$eval('[data-testid="vp-rerun-attempts"]', e => e.textContent).catch(() => null);
  const c1 = await a.$('[data-testid="vp-rerun-empty"]') ? await contrastOf(a, '[data-testid="vp-rerun-empty"]') : null;
  const c2 = attemptsText ? await contrastOf(a, '[data-testid="vp-rerun-attempts"]') : null;
  const sideways2 = await a.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  // Scroll the card's opened results into view and photograph the card.
  await a.evaluate(() => document.querySelector('[data-testid="vp-rerun-attempts"]')?.scrollIntoView({ block: 'center' }));
  const f2 = `coach-voice-card-${theme}-${width}.png`; await (await a.$('[data-testid="vp-panel"]')).screenshot({ path: path.join(OUT, f2) });
  results.push({ screen: 'coach voice-test card', theme, width, empty_answer_shown: emptyShown, attempts: attemptsText, contrast_empty: c1, contrast_attempts: c2, sideways_scroll: sideways2, file: f2 });
  await a.browserContext().close();
}
await browser.close(); child.kill(); await c.end();
fs.writeFileSync(path.join(OUT, 'screens-2u.json'), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
