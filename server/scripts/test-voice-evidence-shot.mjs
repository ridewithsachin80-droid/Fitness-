#!/usr/bin/env node
/**
 * scripts/test-voice-evidence-shot.mjs — Fixes-2v browser regression (run-2 review, finding 1).
 * SIMULATED server on this computer (canned providers); never the site.
 *
 * The run-2 admin screenshot said "names removed" but showed five member names:
 * the card's member list arrives from a second request after the card appears,
 * and the 2u robot cleaned the page once, too early, and checked the page, not
 * the picture. This test rebuilds that situation with real-looking names:
 *   - the member list is held back 3 s by the browser (request interception);
 *   - a recording row is opened, so a member name also shows in the results;
 *   - after cleaning, a "late update" puts a name back and adds a new invitee;
 * and checks the FINISHED PICTURE with OCR (tesseract):
 *   A. the 2u method (clean once when the card appears, then photograph)
 *      leaks names into the picture — proving this test can see the failure;
 *   B. safeShot (quiet page, style mask, watcher, OCR of the picture) → a
 *      picture with no name or name word in it;
 *   C. no name list → no picture;  D. no OCR → no picture;
 *   E. the publication check removes A's picture and keeps B's.
 *
 * Needs Postgres on 5433, Chromium, tesseract, client/dist. On demand:
 *   node scripts/test-voice-evidence-shot.mjs [output folder]
 */
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { browserExecutable } from './lib/browser-executable.mjs';
import * as S from './lib/voice-evidence-shot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRV = path.join(HERE, '..');
const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs'); const { Client } = require('pg');
const PG = process.env.SIM_PG || 'postgres://postgres@localhost:5433';
const DB = 'fitlife_shot_2v', PORT = 3995, BASE = `http://localhost:${PORT}`;
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'shot-2v-'));
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-2v-tmp-'));
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const MEMBERS = ['Lakshmi Narayan', 'Rohit Deshpande', 'Farida Khan', 'Gopal Iyer', 'Meena Pillai'];
const COACH = 'Suresh Hegde', ADMIN = 'Kavitha Rao';
const NAMES = [...MEMBERS, COACH, ADMIN];

const AUDIO = path.join(TMP, 'k01.webm');
execFileSync('espeak-ng', ['-v', 'kn', '-w', path.join(TMP, 'k01.wav'), 'ಎರಡು ಇಡ್ಲಿ']);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(TMP, 'k01.wav'), '-c:a', 'libopus', AUDIO]);

const admin = new Client({ connectionString: `${PG}/postgres` }); await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
execFileSync('psql', [`${PG}/${DB}`, '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(SRV, 'db/schema.sql')], { stdio: ['ignore', 'ignore', 'pipe'] });
const c = new Client({ connectionString: `${PG}/${DB}` }); await c.connect();
const user = async (name, role, extra) => (await c.query(`INSERT INTO users (name, phone, email, password, role) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [name, extra.phone || null, extra.email || null, await bcrypt.hash(extra.secret, 8), role])).rows[0].id;
const adminId = await user(ADMIN, 'admin', { email: 'admin@sim.test', secret: 'Admin#Sim1' });
await user(COACH, 'monitor', { email: 'coach@sim.test', secret: 'Coach#Sim1' });
const ids = [];
for (const [i, n] of MEMBERS.entries()) { const id = await user(n, 'patient', { phone: `90000002${i}0`, secret: '1111' }); ids.push(id); await c.query('INSERT INTO patient_profiles (user_id) VALUES ($1)', [id]); await c.query('INSERT INTO voice_pilot_members (patient_id, invited_by) VALUES ($1,$2)', [id, adminId]); }
await c.query(`INSERT INTO voice_samples (patient_id, phrase_id, object_key, mime_type, duration_ms, gemini_text, whisper_text, gemini_score, whisper_score, created_at) VALUES ($1,'k01',$2,'audio/webm',3000,'eradu idli','eradu idli',1,1,'2026-10-19T05:30:00Z')`, [ids[0], `voice-pilot/${ids[0]}/k01`]);

const child = spawn(process.execPath, ['-r', path.join(HERE, 'sim/voice-evidence-providers.cjs'), 'index.js'], { cwd: SRV,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: `${PG}/${DB}`, JWT_SECRET: 'sim-secret', JWT_REFRESH_SECRET: 'sim-refresh',
    RAILWAY_GIT_BRANCH: 'test', GEMINI_API_KEY: 'sim', GROQ_API_KEY: 'sim', CLIENT_URL: BASE, SIM_AUDIO_FILE: AUDIO }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {} await wait(500); }

const browser = await puppeteer.launch({ executablePath: await browserExecutable(chromium), headless: true, args: [...chromium.args.filter(a => !/single-process|no-zygote/.test(a)), '--no-sandbox', '--disable-dev-shm-usage'] });
const tap = (page, re) => page.evaluate((s, f) => { const rx = new RegExp(s, f); const el = [...document.querySelectorAll('button,a,[role=button]')].find(e => e.offsetParent !== null && rx.test(e.textContent.trim())); if (el) el.click(); return !!el; }, re.source, re.flags);
/** The admin dashboard, with the voice-test member list held back 3 s (as a slow phone network would). */
async function adminPage() {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.setRequestInterception(true);
  p.on('request', (r) => { if (/\/api\/voice-pilot\/members(\?|$)/.test(r.url())) setTimeout(() => r.continue().catch(() => {}), 3000); else r.continue().catch(() => {}); });
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[type=tel]', { timeout: 30e3 }); await tap(p, /Coach \/ Admin/);
  await p.waitForSelector('input[type=email]', { visible: true }); await p.type('input[type=email]', 'admin@sim.test'); await p.type('input[type=password]', 'Admin#Sim1'); await tap(p, /^Sign In/);
  await p.waitForSelector('[data-testid="vp-panel"]', { visible: true, timeout: 30e3 });
  return p;
}
const lateUpdate = async (p) => p.evaluate((names) => {
  // A re-render arriving after cleaning: a masked name put back, and a new invitee row.
  const span = document.querySelector('[data-testid="vp-members"] li > span'); if (span) span.textContent = names[2];
  const ul = document.querySelector('[data-testid="vp-members"]');
  if (ul) { const li = document.createElement('li'); li.className = ul.firstElementChild?.className || ''; const s = document.createElement('span'); s.textContent = names[3]; li.appendChild(s); ul.appendChild(li); }
  const free = document.createElement('p'); free.textContent = `Last invited by ${names[5]}`; document.querySelector('[data-testid="vp-panel"]').appendChild(free);
}, NAMES);

try {
  console.log('\n[A] the 2u method, with the member list arriving late (negative control)');
  let p = await adminPage();
  // 2u: replace names once the moment the card appears, then photograph the card.
  await p.evaluate((names) => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode());) for (const x of names) n.nodeValue = n.nodeValue.split(x).join('[M]'); }, NAMES);
  await p.waitForSelector('[data-testid="vp-members"] li', { timeout: 30e3 }); await wait(500);   // the held-back list lands AFTER the cleaning, as it did on the test site
  const leak = path.join(OUT, 'A-2u-method.png'); await (await p.$('[data-testid="vp-panel"]')).screenshot({ path: leak });
  const hA = S.nameHits(S.ocrText(leak), NAMES);
  ck('the 2u method lets real names into the picture (OCR reads them): this test reproduces the run-2 leak', hA.any, hA);
  await p.browserContext().close();

  console.log('\n[B] safeShot: quiet page, style mask, watcher, OCR of the finished picture');
  p = await adminPage();
  await p.waitForSelector('[data-testid="vp-row"]', { timeout: 20e3 }); await (await p.$('[data-testid="vp-row"]')).click();   // a recording row open: its member's name shows too
  const out = path.join(OUT, 'B-safe.png');
  const r = await S.safeShot(p, { selector: '[data-testid="vp-panel"]', names: NAMES, file: out, label: 'SIMULATED · voice-test card', sim: true, afterSanitise: lateUpdate });
  ck('the picture is taken', r.taken === true, r);
  const textB = r.taken ? S.ocrText(out) : '';
  ck('OCR of the finished picture finds no name and no 4+ letter name word', r.taken && !S.nameHits(textB, NAMES).any, S.nameHits(textB, NAMES));
  ck('the picture still shows the card (OCR reads its heading), so it is evidence, not a blank', /voice test/i.test(textB), textB.slice(0, 200));
  ck('the late update was caught by the watcher: no name left in the page text either', !(await S.namesLeftInPage(p, '[data-testid="vp-panel"]', NAMES)).any);
  await p.browserContext().close();

  console.log('\n[B2] a name drawn as pixels (no page text a mask or text check can see): only OCR of the picture can catch it');
  p = await adminPage();
  const out2 = path.join(OUT, 'B2.png');
  const r3 = await S.safeShot(p, { selector: '[data-testid="vp-panel"]', names: NAMES, file: out2, label: 'SIMULATED · voice-test card', sim: true,
    afterSanitise: (pg) => pg.evaluate((n) => { const cv = document.createElement('canvas'); cv.width = 700; cv.height = 90; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 700, 90); x.fillStyle = '#000'; x.font = 'bold 44px sans-serif'; x.fillText(n, 10, 60); cv.style.width = '350px'; document.querySelector('[data-testid="vp-panel"]').prepend(cv); }, NAMES[1]) });
  ck('the page-text check passes (the name is pixels), but OCR of the finished picture reads it → picture discarded, not written', !r3.taken && /OCR read identifying text/.test(r3.reason || '') && !fs.existsSync(out2) && !fs.existsSync(`${out2}.unchecked.png`), r3);
  await p.browserContext().close();

  console.log('\n[C, D] no name list, or no OCR → no picture');
  p = await adminPage();
  let r2 = await S.safeShot(p, { selector: '[data-testid="vp-panel"]', names: [], file: path.join(OUT, 'C.png'), label: 'x', sim: true });
  ck('no name list → not taken, said why', !r2.taken && /no list of names/.test(r2.reason) && !fs.existsSync(path.join(OUT, 'C.png')), r2);
  r2 = await S.safeShot(p, { selector: '[data-testid="vp-panel"]', names: NAMES, file: path.join(OUT, 'D.png'), label: 'x', sim: true, ocrBin: '/nonexistent/tesseract' });
  ck('no OCR → not taken, said why', !r2.taken && /no OCR/.test(r2.reason) && !fs.existsSync(path.join(OUT, 'D.png')), r2);
  await p.browserContext().close();

  console.log('\n[E] the publication check on a folder holding both pictures');
  const pub = path.join(TMP, 'pub'); fs.mkdirSync(pub); fs.copyFileSync(leak, path.join(pub, 'A.png')); if (fs.existsSync(out)) fs.copyFileSync(out, path.join(pub, 'B.png'));
  const pc = S.publicationCheck(pub, NAMES);
  ck('the leaking picture is removed and the clean one kept', !fs.existsSync(path.join(pub, 'A.png')) && fs.existsSync(path.join(pub, 'B.png')) && pc.removed.length === 1, pc);
} catch (e) { ck('the regression ran to the end', false, e.stack); }
finally { await browser.close(); child.kill(); await c.end(); }
// The negative-control picture shows names: it never leaves this computer.
fs.rmSync(path.join(OUT, 'A-2u-method.png'), { force: true });
console.log(`\nScreenshot sanitisation (SIMULATED, browser + OCR): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
