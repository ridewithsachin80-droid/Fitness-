#!/usr/bin/env node
/**
 * scripts/sim/screens-3i.mjs — Fixes-3i screen check (SIMULATION ONLY, never the site). The admin's Wording check after the
 * Kannada lines changed (k02 uppittu, k04 battalu), at 360 and 390 px in the light AND dark themes:
 *   1. Kannada "not confirmed, locked" with the NEW lines and the NEW hash (4087ba15e0a6); Hindi and English hashes unchanged;
 *   2. a Kannada check recorded against the OLD hash (02dc7a808038…) shows "check void (lines changed), locked" with a Confirm.
 * Starts the real server on this computer with canned providers and in-memory storage. Every picture is stamped SIMULATED.
 * Measures text contrast in each theme and checks the page never scrolls sideways.
 *
 *   node scripts/sim/screens-3i.mjs <output folder>
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
const DB = 'fitlife_screens_3i', PORT = 3995, BASE = `http://localhost:${PORT}`;
process.env.DATABASE_URL = `${PG}/${DB}`;
const C = require('../../services/voiceCalibration');
const OLD_KN = '02dc7a808038d6ae886bc38086a0f8751fba4edabe34d754a2227ce1839b9250';
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'screens-3i-'));
fs.mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'screens-3i-tmp-'));
const SILENCE = path.join(TMP, 'silence.wav');   // the canned providers need an audio file to start; nothing is recorded
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '2', '-c:a', 'pcm_s16le', SILENCE]);
const results = []; let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 400))); };

const admin = new Client({ connectionString: `${PG}/postgres` }); await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
execFileSync('psql', [`${PG}/${DB}`, '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(SRV, 'db/schema.sql')], { stdio: ['ignore', 'ignore', 'pipe'] });
const c = new Client({ connectionString: `${PG}/${DB}` }); await c.connect();
const adminId = (await c.query(`INSERT INTO users (name, email, password, role) VALUES ('Screen Admin','admin@sim.test',$1,'admin') RETURNING id`, [await bcrypt.hash('Admin#Sim3i', 8)])).rows[0].id;
await c.query(`INSERT INTO voice_calibration_reviewers (code, name, role, langs, created_by) VALUES ('R1','Kannada Reviewer Example','both','kn',$1)`, [adminId]);

const child = spawn(process.execPath, ['-r', path.join(HERE, 'voice-evidence-providers.cjs'), '-r', path.join(HERE, 'calibration-storage.cjs'), 'index.js'], { cwd: SRV,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: `${PG}/${DB}`, JWT_SECRET: 'sim-secret', JWT_REFRESH_SECRET: 'sim-refresh',
    RAILWAY_GIT_BRANCH: 'test', GEMINI_API_KEY: 'sim', GROQ_API_KEY: 'sim', CLIENT_URL: BASE, SIM_AUDIO_FILE: SILENCE }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {} await wait(500); }

const browser = await puppeteer.launch({ executablePath: await browserExecutable(chromium), headless: true,
  args: [...chromium.args.filter(a => !/single-process|no-zygote/.test(a)), '--no-sandbox', '--disable-dev-shm-usage'] });
const tap = (page, re, sel = 'button,a,[role=button]') => page.evaluate((s, f, sel) => { const rx = new RegExp(s, f); const el = [...document.querySelectorAll(sel)].find(e => e.offsetParent !== null && (rx.test(e.textContent.trim()) || rx.test(e.getAttribute('aria-label') || ''))); if (el) el.click(); return !!el; }, re.source, re.flags, sel);
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
const cropStamp = (el, on) => el.evaluate((e, on) => { e.querySelector(':scope > [data-crop-stamp]')?.remove(); if (!on) return;
  const d = document.createElement('div'); d.setAttribute('data-crop-stamp', ''); d.textContent = 'SIMULATED · local test server · synthetic data';
  d.setAttribute('style', 'display:block;background:#7a0019;color:#fff;font:700 11px/1.6 system-ui,sans-serif;text-align:center;letter-spacing:.04em;padding:2px 4px;margin:0 0 4px 0');
  e.prepend(d); }, on);
const shot = async (el, file) => { const f = `SIMULATED-${file}`; await cropStamp(el, true); try { await el.screenshot({ path: path.join(OUT, f), captureBeyondViewport: true }); } finally { await cropStamp(el, false); } return f; };

try {
  for (const state of ['new', 'void']) {
    if (state === 'void') await c.query(`INSERT INTO voice_calibration_wording (lang, script_sha256, confirmed_by, recorded_by) VALUES ('kn',$1,'R1',$2)`, [OLD_KN, adminId]);
    for (const theme of ['light', 'dark']) for (const width of [360, 390]) {
      console.log(`\n[${state}, ${theme}, ${width} px]`);
      const ctx = await browser.createBrowserContext(); const p = await ctx.newPage();
      await p.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
      await p.goto(BASE, { waitUntil: 'networkidle2' });
      await p.waitForSelector('input[type=tel]'); await tap(p, /Coach \/ Admin/);
      await p.waitForSelector('input[type=email]', { visible: true }); await p.type('input[type=email]', 'admin@sim.test'); await p.type('input[type=password]', 'Admin#Sim3i'); await tap(p, /^Sign In/);
      await p.waitForSelector('[data-testid="vc-panel"]', { visible: true, timeout: 30e3 });
      await p.$eval('[data-testid="vc-words"] > button', b => b.click());
      await p.waitForSelector('[data-testid="vc-words-kn"]', { visible: true, timeout: 10e3 });
      const kn = await p.$eval('[data-testid="vc-words-kn"]', e => e.textContent);
      const all = await p.$eval('[data-testid="vc-words"]', e => e.textContent);
      ck('Kannada shows the new k02 (uppittu) and k04 (battalu) lines', /k02\s*Breakfast-ge ondu plate uppittu, ondu cup coffee/.test(kn) && /k04\s*Lunch-ge eradu chapati, ondu battalu dal mattu mosaru/.test(kn) && /1 plate uppittu/.test(kn) && /1 battalu dal/.test(kn), kn.slice(0, 300));
      ck('…with the NEW hash 4087ba15e0a6; Hindi 21ef021a6c57 and English 9bd51a13bb06 unchanged', /Script hash 4087ba15e0a6/.test(kn) && /Script hash 21ef021a6c57/.test(all) && /Script hash 9bd51a13bb06/.test(all) && !/02dc7a808038/.test(all));
      ck(state === 'new' ? '…status "not confirmed, locked", 0/3 confirmed' : '…a check recorded against the OLD hash reads "check void (lines changed), locked", still 0/3',
        (state === 'new' ? /Kannada: not confirmed, locked/.test(kn) : /Kannada: check void \(lines changed\), locked/.test(kn)) && /0\/3 confirmed/.test(all), kn.slice(0, 120));
      const cLine = await contrastOf(p, '[data-testid="vc-words-kn"] li'); const cHead = await contrastOf(p, '[data-testid="vc-words-kn"] p');
      ck(`text contrast ≥ 4.5 (line ${cLine}, status ${cHead})`, cLine >= 4.5 && cHead >= 4.5);
      const side = await sideways(p); ck('no sideways scroll', !side);
      const f = await shot(await p.$('[data-testid="vc-words-kn"]'), `wording-kn-${state}-${theme}-${width}.png`);
      results.push({ state, theme, width, contrast_line: cLine, contrast_status: cHead, sideways_scroll: side, file: f });
      await ctx.close();
    }
  }
} catch (e) { ck('the run finished', false, String(e.stack || e).slice(0, 400) + '\n' + log.slice(-600)); }
finally { await browser.close(); child.kill(); await c.end(); }
fs.writeFileSync(path.join(OUT, 'SIMULATED-screens-3i.json'), JSON.stringify(results, null, 2));
console.log(`\nScreens 3i (SIMULATED): ${pass} passed, ${fail} failed → ${OUT}`);
process.exit(fail ? 1 : 0);
