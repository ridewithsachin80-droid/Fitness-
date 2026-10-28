// scripts/check-live-calibration-panel.mjs — Fixes-3g (28 Oct 2026). Does the LIVE test site show the Voice calibration panel?
//
// Run by the phone-robot workflow after each test deploy (read-only). On 28 Oct the live admin page had no calibration panel,
// although /health showed the right server commit and every live file matched client/dist: client/dist itself was stale.
//   [A] signed out: the app the site serves (index.html → entry → admin bundle) contains the panel and its Wording check;
//   [B] signed in as the robot ADMIN (repository secrets FITLIFE_ROBOT_ADMIN_EMAIL / _PASSWORD): GET /api/voice-calibration/admin
//       answers 200 with available:true, the panel and its Wording check are visible, and the three languages' statuses
//       and script hashes are read off the screen and reported (codes only). Nothing is confirmed, invited or changed: every
//       request other than GET to /api/voice-calibration is BLOCKED and reported.
// Writes qa/robot-results/calibration-panel.md for the robot report. Exit 1 if the panel is missing.
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { browserExecutable } from './lib/browser-executable.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../qa/robot-results');
const BASE = (process.env.ROBOT_BASE_URL || 'https://fitness-test.up.railway.app').replace(/\/$/, '');
const EMAIL = process.env.FITLIFE_ROBOT_ADMIN_EMAIL, PASSWORD = process.env.FITLIFE_ROBOT_ADMIN_PASSWORD;
const WANT = process.env.GITHUB_SHA || '';
if (!/fitness-test\./.test(BASE) && !/localhost|127\.0\.0\.1/.test(BASE)) { console.error('Refusing: test site only.'); process.exit(1); }
const rows = [], notes = [];
let bad = 0;
const row = (name, ok, detail = '') => { rows.push(`| ${ok ? '✅' : '❌'} | ${name} | ${String(detail).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300)} |`); if (!ok) bad++; console.log(`${ok ? '✓' : '✗'} ${name} ${detail}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const MARKS = ['vc-panel', 'vc-words', 'Voice calibration · round 1', '/voice-calibration/admin'];

// The deploy of this commit first (the robot step before this one waits too; this keeps the check honest on its own).
let live = null;
for (let i = 0; i < 60; i++) {
  try { live = (await (await fetch(`${BASE}/health`, { cache: 'no-store' })).json())?.commit || null; } catch { live = null; }
  if (!WANT || (live && WANT.startsWith(live.slice(0, 7))) || (live && live.startsWith(WANT.slice(0, 7)))) break;
  await wait(15000);
}
notes.push(`Server commit: ${live || 'unknown'}${WANT ? ` (this commit ${WANT.slice(0, 7)})` : ''}`);

// [A] the served client, signed out
try {
  const html = await (await fetch(`${BASE}/`, { cache: 'no-store' })).text();
  const entry = (html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1];
  const entryJs = entry ? await (await fetch(`${BASE}/assets/${entry}`, { cache: 'no-store' })).text() : '';
  const admin = (entryJs.match(/AdminDashboard-[A-Za-z0-9_-]+\.js/) || [])[0];
  const adminJs = admin ? await (await fetch(`${BASE}/assets/${admin}`, { cache: 'no-store' })).text() : '';
  const missing = MARKS.filter(m => !adminJs.includes(m));
  row('The served admin bundle contains the Voice calibration panel and its Wording check', !!admin && missing.length === 0, `entry ${entry || '?'}, admin ${admin || '?'} (${adminJs.length} bytes)${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
} catch (e) { row('The served admin bundle contains the Voice calibration panel and its Wording check', false, e.message); }

// [B] signed in as the robot admin
if (!EMAIL || !PASSWORD) {
  row('Signed-in admin page shows the panel', false, 'not run: repository secrets FITLIFE_ROBOT_ADMIN_EMAIL / FITLIFE_ROBOT_ADMIN_PASSWORD are not available to this workflow');
} else {
  const browser = await puppeteer.launch({ executablePath: await browserExecutable(chromium), headless: true,
    args: [...chromium.args.filter(a => !/single-process|no-zygote/.test(a)), '--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.setBypassServiceWorker(true);   // the app's offline worker would hide the API responses from this check
    await page.setRequestInterception(true);
    const blocked = [], api = [];
    page.on('request', (r) => {
      const u = r.url();
      if (/\/api\/voice-calibration\//.test(u) && r.method() !== 'GET') { blocked.push(`${r.method()} ${new URL(u).pathname}`); return r.abort(); }
      r.continue();
    });
    page.on('response', (r) => { const u = r.url(); if (process.env.DEBUG_LIVE && /\/api\//.test(u)) console.log('resp', r.status(), u); if (/\/api\/voice-calibration\/admin$/.test(new URL(u).pathname)) api.push(r); });
    const clickText = (re) => page.evaluate((src) => { const rx = new RegExp(src); const el = [...document.querySelectorAll('button, a, [role=tab]')].find(b => rx.test((b.textContent || '').trim())); if (el) { el.click(); return true; } return false; }, re.source);
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60e3 });
    await page.waitForSelector('input[type=tel], input[type=email]', { timeout: 30e3 });
    await clickText(/Coach \/ Admin/);
    await page.waitForSelector('input[type=email]', { visible: true, timeout: 15e3 });
    await page.type('input[type=email]', EMAIL); await page.type('input[type=password]', PASSWORD);
    await clickText(/^Sign In/);
    await page.waitForFunction(() => /\/admin|\/coach/.test(location.pathname), { timeout: 30e3 });
    if (!/\/admin/.test(new URL(page.url()).pathname)) await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle2', timeout: 60e3 });
    const found = await page.waitForSelector('[data-testid="vc-panel"], [data-testid="vc-panel-error"], [data-testid="vc-panel-off"]', { timeout: 45e3 }).catch(() => null);
    const res = api[api.length - 1];
    let body = null; try { body = res ? await res.json() : null; } catch { body = null; }
    row('GET /api/voice-calibration/admin (signed in) answers 200 with available: true', !!res && res.status() === 200 && body?.available === true, res ? `HTTP ${res.status()}${body ? `, available: ${body.available}` : ''}` : 'no request seen');
    const which = found ? await found.evaluate(el => el.getAttribute('data-testid')) : null;
    row('The admin page shows the Voice calibration panel', which === 'vc-panel', which ? `shown: ${which}${which !== 'vc-panel' ? ` ("${(await found.evaluate(el => el.textContent)).slice(0, 160)}")` : ''}` : 'nothing (no panel, no error card)');
    if (which === 'vc-panel') {
      const words = await page.$('[data-testid="vc-words"]');
      row('…with its "Wording check (before any recording)" section', !!words && /Wording check/.test(await words.evaluate(el => el.textContent)), words ? await words.evaluate(el => (el.querySelector('button')?.textContent || '').trim()) : 'missing');
      if (words) {
        if (!(await page.$('[data-testid="vc-words-kn"]'))) { await words.evaluate(el => el.querySelector('button')?.click()); await wait(600); }
        const langs = await page.evaluate(() => ['kn', 'hi', 'en'].map(l => { const el = document.querySelector(`[data-testid="vc-words-${l}"]`); if (!el) return { l, missing: true };
          const head = el.querySelector('p')?.textContent || ''; const hash = (el.textContent.match(/Script hash ([0-9a-f]{12})/) || [])[1] || null;
          // codes only: the status line says "confirmed by R1 · <date>", "not confirmed, locked" or "check void …"
          return { l, status: head.replace(/^[^:]*:\s*/, '').slice(0, 80), hash }; }));
        const expect = { kn: '02dc7a808038', hi: '21ef021a6c57', en: '9bd51a13bb06' };
        row('…listing Kannada, Hindi and English, each with its status and script hash', langs.every(x => !x.missing && x.hash), langs.map(x => `${x.l}: ${x.missing ? 'missing' : `${x.status} (hash ${x.hash}${x.hash === expect[x.l] ? ', as reviewed' : `, EXPECTED ${expect[x.l]}`})`}`).join('; '));
      }
    }
    row('Read-only: nothing but GET was sent to the calibration API', blocked.length === 0, blocked.length ? `blocked: ${blocked.join(', ')}` : 'none blocked');
  } catch (e) { row('Signed-in admin page shows the panel', false, String(e.message || e).slice(0, 200)); }
  finally { await browser.close(); }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'calibration-panel.md'), [
  `## Live calibration panel check (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`, '',
  `**${bad ? `${bad} problem(s): the calibration panel is not fully available` : 'The calibration panel is live and readable'}.** ${notes.join(' · ')}`, '',
  '| | Check | Detail |', '|---|---|---|', ...rows, '',
  'Read-only: signed in as the robot admin; no wording confirmation, invitation or other change was made (non-GET calibration requests are blocked). Reviewer codes only, no names.',
].join('\n'));
process.exit(bad ? 1 : 0);
