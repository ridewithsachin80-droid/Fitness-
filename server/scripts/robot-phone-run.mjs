#!/usr/bin/env node
/**
 * scripts/robot-phone-run.mjs — the phone robot (17 Oct 2026).
 *
 * Drives real Chrome, set up as an Android phone (390 px and 360 px, touch,
 * light and dark), against the LIVE TEST SITE and does what the tester would
 * do by hand: signs in, logs food through the AI, logs for yesterday, edits,
 * undoes, goes offline and back, switches accounts, has the coach send a note,
 * and checks every screen for sideways scrolling, hidden items and leftover
 * gold. Each check names the workbook cases it covers (v4 sheets 26–28 and the
 * rewritten cases), so a green run lets the tester skip those rows.
 *
 * It does NOT replace the real phone: the microphone, the camera, installing
 * the app, the keyboard and "does it feel right" stay manual (column Q of the
 * workbook says "Phone only" for those).
 *
 * Accounts: three throwaway test-site accounts, read from environment
 * variables (GitHub secrets on CI). Never real members, never production:
 *   FITLIFE_ROBOT_MEMBER_PHONE,  FITLIFE_ROBOT_MEMBER_PIN   — "Auto Member", assigned to the coach below
 *   FITLIFE_ROBOT_MEMBER2_PHONE, FITLIFE_ROBOT_MEMBER2_PIN  — "Auto Member Two", NOT assigned to that coach
 *   FITLIFE_ROBOT_COACH_EMAIL,   FITLIFE_ROBOT_COACH_PASSWORD — "Auto Coach"
 * Without them the run is skipped with a warning (exit 0), so the push is not
 * marked red before Sachin has created the accounts.
 *
 * Run:  node scripts/robot-phone-run.mjs [--wait-for-deploy]
 *   ROBOT_BASE_URL   defaults to https://fitness-test.up.railway.app (production is refused)
 *   CHROME_EXECUTABLE_PATH  optional; otherwise the bundled CI Chromium is unpacked
 * Results: qa/robot-results/report.md, results.json and screenshots; on GitHub
 * also annotations (one notice with the totals, one error per failed check).
 */
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { browserExecutable } from './lib/browser-executable.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../..');
const OUT = process.env.ROBOT_OUT || path.join(ROOT, 'qa/robot-results');
const BASE = (process.env.ROBOT_BASE_URL || 'https://fitness-test.up.railway.app').replace(/\/$/, '');
const GH = process.env.GITHUB_ACTIONS === 'true';
const env = k => (process.env[k] || '').trim();
const ACC = {
  a: { phone: env('FITLIFE_ROBOT_MEMBER_PHONE'), pin: env('FITLIFE_ROBOT_MEMBER_PIN') },
  b: { phone: env('FITLIFE_ROBOT_MEMBER2_PHONE'), pin: env('FITLIFE_ROBOT_MEMBER2_PIN') },
  coach: { email: env('FITLIFE_ROBOT_COACH_EMAIL'), password: env('FITLIFE_ROBOT_COACH_PASSWORD') },
};
const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const ghEsc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

if (/fitness\.upscale-app\.com/i.test(BASE)) {
  console.error('The robot only runs against the TEST site. Refusing to touch production.');
  process.exit(2);
}
const missing = Object.entries({ FITLIFE_ROBOT_MEMBER_PHONE: ACC.a.phone, FITLIFE_ROBOT_MEMBER_PIN: ACC.a.pin,
  FITLIFE_ROBOT_MEMBER2_PHONE: ACC.b.phone, FITLIFE_ROBOT_MEMBER2_PIN: ACC.b.pin,
  FITLIFE_ROBOT_COACH_EMAIL: ACC.coach.email, FITLIFE_ROBOT_COACH_PASSWORD: ACC.coach.password }).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  const msg = `Phone robot skipped: the robot's test-site accounts are not set up yet (missing: ${missing.join(', ')}).`;
  console.log(msg);
  if (GH) console.log(`::warning title=Phone robot skipped::${ghEsc(msg)}`);
  process.exit(0);
}

// ── Wait until the test site serves this commit's compiled app ───────────────
async function liveBundle() {
  const html = await (await fetch(`${BASE}/?robot=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } })).text();
  return (html.match(/\/assets\/index-[\w-]+\.js/) || [])[0] || null;
}
if (process.argv.includes('--wait-for-deploy')) {
  const want = (fs.readFileSync(path.join(ROOT, 'client/dist/index.html'), 'utf8').match(/\/assets\/index-[\w-]+\.js/) || [])[0];
  const until = Date.now() + 15 * 60e3;
  let live = null;
  while (Date.now() < until) {
    live = await liveBundle().catch(() => null);
    if (live && live === want) break;
    console.log(`waiting for the deploy: live ${live || '—'}, this commit ${want}`);
    await new Promise(r => setTimeout(r, 20e3));
  }
  if (live !== want) {
    const msg = `The test site never served this commit's app (live ${live}, expected ${want}). Was client/dist committed with the change?`;
    console.log(msg); if (GH) console.log(`::error title=Phone robot: deploy not live::${ghEsc(msg)}`);
    process.exit(1);
  }
  console.log(`test site is serving ${want}`);
}

// ── Results ──────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const pageErrors = [];
let shotN = 0;
async function shot(page, name) {
  const file = `${String(++shotN).padStart(2, '0')}-${name}.png`;
  try { await page.screenshot({ path: path.join(OUT, file) }); return file; } catch { return null; }
}
async function check(id, title, cases, fn, { soft = false, page = null } = {}) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, title, cases, result: 'pass', detail: detail || '', ms: Date.now() - t0 });
    console.log(`  ✓ ${id} ${title}${detail ? ' — ' + detail : ''}`);
  } catch (e) {
    const file = page ? await shot(page, `${id}-fail`) : null;
    results.push({ id, title, cases, result: soft ? 'warn' : 'fail', detail: e.message, shot: file, ms: Date.now() - t0 });
    console.log(`  ${soft ? '⚠' : '✗'} ${id} ${title} — ${e.message}`);
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

// ── Browser helpers ──────────────────────────────────────────────────────────
const wait = ms => new Promise(r => setTimeout(r, ms));
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

const browser = await puppeteer.launch({
  executablePath: await browserExecutable(chromium),
  // --single-process (in the bundled flags) cannot hold separate sign-ins side by side.
  args: [...chromium.args.filter(a => !/single-process|no-zygote/.test(a)), '--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  headless: true,
});

async function newPage(label) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setUserAgent(UA);
  await page.setViewport(PHONE);
  page.on('pageerror', e => pageErrors.push(`${label}: ${e.message.slice(0, 200)}`));
  page.setDefaultTimeout(20e3);
  return page;
}
const tid = (page, id) => page.$(`[data-testid="${id}"]`);
const textOf = (page, id) => page.$eval(`[data-testid="${id}"]`, el => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const bodyText = page => page.evaluate(() => document.body.innerText);
async function tap(page, id) {
  const el = await page.waitForSelector(`[data-testid="${id}"]`, { visible: true });
  // Like a person: bring it to the middle of the screen first. The logging bar
  // and the tabs are fixed at the bottom and would otherwise take the tap.
  await el.evaluate(e => e.scrollIntoView({ block: 'center', inline: 'center' })); await wait(250);
  try { await el.click(); } catch { await el.evaluate(e => e.click()); }
}
async function tapText(page, re, sel = 'button,a,[role=button]') {
  const ok = await page.evaluate((src, flags, sel) => {
    const rx = new RegExp(src, flags);
    const el = [...document.querySelectorAll(sel)].find(e => e.offsetParent !== null && (rx.test(e.textContent.trim()) || rx.test(e.getAttribute('aria-label') || '')));
    if (el) { el.click(); return true; } return false;
  }, re.source, re.flags, sel);
  must(ok, `nothing to tap matching ${re}`);
}
async function setInput(page, selector, value) {
  await page.waitForSelector(selector, { visible: true });
  await page.evaluate((s, v) => {
    const el = document.querySelector(s);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
}
const waitFor = (page, fn, arg, timeout = 20e3) => page.waitForFunction(fn, { timeout, polling: 250 }, arg);
const waitText = (page, re, timeout = 20e3) => waitFor(page, ([s, f]) => new RegExp(s, f).test(document.body.innerText), [re.source, re.flags], timeout);
const settle = () => wait(6000); // the day auto-saves about 4 s after a change

async function gotoPath(page, p) {
  await page.evaluate(u => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }, p);
  await wait(1500);
}
async function reload(page) {
  await page.reload({ waitUntil: 'networkidle2' }).catch(() => {});
  await page.waitForSelector('[data-testid="daily-essentials"], [data-testid="member-main"]', { timeout: 30e3 }).catch(() => {});
  await wait(1200);
}

async function memberLogin(page, acc) {
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type=tel]', { timeout: 30e3 });
  await page.type('input[type=tel]', acc.phone);
  await page.type('input[type=password]', acc.pin);
  await tapText(page, /^Log In/);
  await waitFor(page, () => document.querySelector('[data-testid="daily-essentials"], [data-testid="onb-next"], [data-testid="onb-primary"]'), null, 30e3);
  await finishOnboarding(page);
  await page.waitForSelector('[data-testid="daily-essentials"]', { timeout: 30e3 });
  await wait(800);
}
async function finishOnboarding(page) {
  for (let i = 0; i < 8; i++) {
    if (await tid(page, 'daily-essentials')) return;
    const modes = await tid(page, 'onb-modes');
    if (modes) await page.evaluate(() => [...document.querySelectorAll('[data-testid="onb-modes"] button')].find(b => /Adult/.test(b.textContent))?.click());
    const goals = await tid(page, 'onb-goals');
    if (goals) await page.evaluate(() => { const g = document.querySelector('[data-testid="onb-goals"] button[aria-pressed="true"]'); if (!g) document.querySelector('[data-testid="onb-goals"] button')?.click(); });
    await wait(300);
    const next = await page.$('[data-testid="onb-next"]:not([disabled])') || await page.$('[data-testid="onb-primary"]:not([disabled])');
    if (next) await next.click();
    await wait(1200);
  }
}
async function coachLogin(page) {
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type=tel]', { timeout: 30e3 });
  await tapText(page, /Coach \/ Admin/);
  await page.waitForSelector('input[type=email]', { visible: true });
  await page.type('input[type=email]', acc_coach().email);
  await page.type('input[type=password]', acc_coach().password);
  await tapText(page, /^Sign In/);
  await waitFor(page, () => /\/coach|\/admin/.test(location.pathname), null, 30e3);
  await wait(2000);
}
const acc_coach = () => ACC.coach;

/** The ring's number = kcal eaten on the day on screen. */
async function kcal(page) {
  const t = await page.$eval('[data-testid="plan-eat"] .member-ring-content strong', el => el.textContent).catch(() => null);
  must(t != null, 'the food ring is not on screen');
  return Number(t.replace(/[^\d]/g, ''));
}
async function openAI(page) {
  await tap(page, 'ai-type');
  await page.waitForSelector('[data-testid="composer-input"]', { visible: true, timeout: 15e3 });
  await wait(500);
}
async function closeAI(page) {
  await page.evaluate(() => document.querySelector('[aria-label="Close AI assistant"]')?.click());
  await wait(900);
}
/** Send one message; resolves with the new review card's Save button text. */
async function sendForReview(page, message) {
  const before = await page.$$eval('[data-testid="ai-card-save"]', b => b.length);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.click('[data-testid="composer-input"]');
    await page.type('[data-testid="composer-input"]', message);
    await page.keyboard.press('Enter');
    try {
      await waitFor(page, n => document.querySelectorAll('[data-testid="ai-card-save"]').length > n, before, 90e3);
      await waitFor(page, () => { const b = [...document.querySelectorAll('[data-testid="ai-card-save"]')].pop(); return b && !b.disabled; }, null, 30e3);
      return page.$$eval('[data-testid="ai-card-save"]', b => b.pop().textContent.replace(/\s+/g, ' ').trim());
    } catch (e) {
      if (attempt === 2) throw new Error(`no review card for "${message}" after 90 s (AI busy or down?)`);
      await wait(20e3); // "AI is busy" — one more try, as the tester would
    }
  }
}
async function saveLastCard(page) {
  const n = await page.$$eval('[data-testid="ai-card-save-status"]', s => s.length);
  await page.evaluate(() => [...document.querySelectorAll('[data-testid="ai-card-save"]')].pop().click());
  await waitFor(page, n => { const s = [...document.querySelectorAll('[data-testid="ai-card-save-status"]')]; return s.length > n && /^Saved/.test(s.pop().textContent.trim()); }, n, 45e3);
}
/** Delete every food on the day on screen whose name matches re (robot clean-up). */
async function deleteFoods(page, re) {
  await tap(page, 'plan-eat');
  await wait(1200);
  for (let i = 0; i < 12; i++) {
    const gone = await page.evaluate((s, f) => {
      const rx = new RegExp(s, f);
      const btn = [...document.querySelectorAll('button[aria-label="Remove item"]')].find(b => rx.test(b.closest('div')?.parentElement?.textContent || ''));
      if (!btn) return true; btn.click(); return false;
    }, re.source, re.flags);
    if (gone) break;
    await wait(700);
  }
  await page.keyboard.press('Escape'); await wait(800);
  await settle();
}
async function sheetSet(page, chip, steps) { await tap(page, chip); await wait(900); await steps(); await tapText(page, /^Done$/); await wait(600); }

// ── Screen checks (layout, reach, gold) ──────────────────────────────────────
const noSidewaysScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** Elements on screen painted in the old gold. Warning amber (the theme's own --fit-warn) is allowed. */
const goldOnScreen = page => page.evaluate(() => {
  const warn = getComputedStyle(document.documentElement).getPropertyValue('--fit-warn').trim().split(/[\s,]+/).map(Number);
  const isWarn = (r, g, b) => warn.length >= 3 && Math.abs(r - warn[0]) + Math.abs(g - warn[1]) + Math.abs(b - warn[2]) < 12;
  const AMBER = [[251, 191, 36], [245, 158, 11], [252, 211, 77], [217, 119, 6]];
  const gold = c => {
    const m = c && c.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/); if (!m) return false;
    if (m[4] !== undefined && Number(m[4]) < 0.25) return false;
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    if (isWarn(r, g, b) || AMBER.some(a => Math.abs(a[0] - r) + Math.abs(a[1] - g) + Math.abs(a[2] - b) < 12)) return false;
    const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return false;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4; h = (h * 60 + 360) % 360;
    return h >= 37 && h <= 52 && s >= 0.35 && l >= 0.3 && l <= 0.85;
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    if (/^(IMG|PICTURE|VIDEO|CANVAS)$/.test(el.tagName)) continue; // photos and emoji are not brand colour
    for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'fill', 'stroke']) {
      if (prop === 'color' && !el.childNodes.length) continue;
      if (prop === 'borderTopColor' && parseFloat(cs.borderTopWidth) === 0) continue;
      if (gold(cs[prop])) { out.push(`${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(' ')[0]} ${prop} ${cs[prop]} "${(el.textContent || '').trim().slice(0, 30)}"`); break; }
    }
    if (out.length >= 6) break;
  }
  return out;
});
/** The last tappable thing on the page can actually be tapped (not hidden under the bars). */
const lastItemReachable = page => page.evaluate(async () => {
  window.scrollTo(0, document.documentElement.scrollHeight); await new Promise(r => setTimeout(r, 600));
  const main = document.querySelector('main') || document.body;
  const items = [...main.querySelectorAll('button, a, [role=button]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const last = items.pop(); if (!last) return 'no tappable item';
  const r = last.getBoundingClientRect();
  if (r.bottom > innerHeight) return `"${last.textContent.trim().slice(0, 40)}" stays below the screen even when scrolled to the end`;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit && (hit === last || last.contains(hit)) ? '' : `"${last.textContent.trim().slice(0, 40)}" is covered by ${hit?.tagName.toLowerCase()}.${String(hit?.className || '').split(' ')[0]}`;
});
async function setTheme(page, theme) {
  await page.evaluate(t => {
    const s = JSON.parse(localStorage.getItem('fitlife-settings-v2') || '{"state":{},"version":0}');
    s.state = { ...(s.state || {}), theme: t }; localStorage.setItem('fitlife-settings-v2', JSON.stringify(s));
  }, theme);
  await reload(page);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\nPhone robot → ${BASE}  (${new Date().toISOString()})\n`);
const live = await liveBundle().catch(() => null);
const marker = `Robot ${STAMP}`;
const A = await newPage('member A');
let todayBefore = null;

await check('R01', 'Member signs in; Today opens with four tabs', ['LOG-001', 'RDS-001', 'SMK-004'], async () => {
  await memberLogin(A, ACC.a);
  const tabs = await A.$$eval('nav a, nav button', els => els.map(e => e.textContent.trim()).filter(Boolean));
  must(['Today', 'Plan', 'Progress', 'More'].every(t => tabs.some(x => x.startsWith(t))), `tabs: ${tabs.join(' · ')}`);
  return `bundle ${live || '?'}`;
}, { page: A });
if (!(await tid(A, 'daily-essentials'))) {
  await finish('Could not sign in as the robot member — every other check needs that.');
}

await check('R02', '"What\'s new" shows once and "Got it" hides it', ['RDS-010'], async () => {
  if (!(await tid(A, 'whats-new'))) return 'not shown (already dismissed on this browser)';
  await tap(A, 'whats-new-ok'); await reload(A);
  must(!(await tid(A, 'whats-new')), 'the card came back after reload');
}, { page: A, soft: true });

await check('R03', 'Weight and sleep save and survive a reload', ['RPR-004', 'SHT-001', 'SHT-008', 'TOD-004'], async () => {
  await sheetSet(A, 'hero-weight', () => setInput(A, '[data-testid="weight-input"]', '70.4'));
  await sheetSet(A, 'chip-sleep', async () => {
    await setInput(A, '[data-testid="sleep-bed"]', '23:00'); await setInput(A, '[data-testid="sleep-wake"]', '06:30');
    must(/7h 30m/.test(await textOf(A, 'sleep-duration')), `sleep sheet says "${await textOf(A, 'sleep-duration')}"`);
  });
  await settle(); await reload(A);
  must(/70\.4 kg/.test(await textOf(A, 'hero-weight')), `weight tile: "${await textOf(A, 'hero-weight')}"`);
  must(/7h ?30m/.test(await textOf(A, 'chip-sleep')), `sleep tile: "${await textOf(A, 'chip-sleep')}"`);
}, { page: A });

await check('R04', 'Water offline, back online: saved exactly once', ['RPR-006', 'OFF-002', 'OFF-003', 'TOD-003', 'RDS-021'], async () => {
  const read = async () => { await tap(A, 'chip-water'); await wait(800); const t = await textOf(A, 'water-total'); await A.keyboard.press('Escape'); await wait(600); return parseFloat(t); };
  const before = await read();
  await A.setOfflineMode(true);
  await sheetSet(A, 'chip-water', () => tap(A, 'water-add-250'));
  await waitText(A, /on this phone|will sync|waiting to sync|offline/i, 15e3).catch(() => { throw new Error('no "saved on this phone" / offline message while offline'); });
  await A.setOfflineMode(false);
  await wait(15e3); await reload(A);
  const after = await read();
  must(Math.abs(after - before - 0.25) < 0.001, `water ${before} L → ${after} L (expected +0.25 once)`);
  await sheetSet(A, 'chip-water', () => tapText(A, /Remove 250ml/)); await settle(); await reload(A);
  const back = await read();
  must(Math.abs(back - before) < 0.001, `clean-up: water ${back} L, expected ${before} L`);
  return `${before} → ${after} → ${back} L`;
}, { page: A });

await check('R05', 'Typed meal: review, Save, totals, reload', ['RPR-001', 'AIC-001', 'SMK-005', 'TOD-022'], async () => {
  todayBefore = await kcal(A);
  await openAI(A);
  const label = await sendForReview(A, '1 banana for snack');
  must(/to today's log/.test(label), `Save button reads "${label}"`);
  await saveLastCard(A); await closeAI(A); await wait(1500);
  const after = await kcal(A);
  must(after > todayBefore, `ring ${todayBefore} → ${after} kcal`);
  await settle(); await reload(A);
  const again = await kcal(A);
  must(again === after, `after reload ${again} kcal, expected ${after}`);
  return `${todayBefore} → ${after} kcal; "${label}"`;
}, { page: A });

await check('R06', 'Undo on the card removes only that card\'s food', ['RPR-003', 'AIC-010', 'AIC-011'], async () => {
  const start = await kcal(A);
  await openAI(A);
  await sendForReview(A, '1 dosa'); await saveLastCard(A);
  await A.evaluate(() => [...document.querySelectorAll('[data-testid="ai-card-undo"]')].pop().click());
  await waitText(A, /reverted/i, 30e3); // "Daily and workout changes from this review were reverted."
  await closeAI(A); await wait(1500);
  const end = await kcal(A);
  must(end === start, `ring ${start} → ${end} kcal after Undo (the banana from R05 must stay)`);
}, { page: A });

await check('R07', 'Meal for yesterday lands on yesterday; today unchanged', ['RPR-002', 'AIC-029', 'TOD-017', 'RDS-018'], async () => {
  const today = await kcal(A);
  await tapText(A, /^Previous day$/); await waitText(A, /Editing past entry/);
  const yBefore = await kcal(A);
  must(await tid(A, 'ai-type'), 'Speak · Snap · Type is missing on yesterday');
  await openAI(A);
  const label = await sendForReview(A, '1 idli');
  must(/yesterday's log/.test(label), `Save button reads "${label}"`);
  await saveLastCard(A); await closeAI(A); await wait(1500);
  const yAfter = await kcal(A);
  must(yAfter > yBefore, `yesterday ${yBefore} → ${yAfter} kcal`);
  await tapText(A, /^Jump to today$/); await wait(1500);
  const t2 = await kcal(A);
  must(t2 === today, `today changed ${today} → ${t2} kcal`);
  await tapText(A, /^Previous day$/); await wait(1200);
  await deleteFoods(A, /idli/i);
  await tapText(A, /^Jump to today$/); await wait(1200);
  return `yesterday ${yBefore} → ${yAfter}; today stayed ${today}`;
}, { page: A });

await check('R08', 'Food without an amount is not saved; FitLife asks', ['RDS-020'], async () => {
  await openAI(A);
  await A.type('[data-testid="composer-input"]', 'dal for lunch'); await A.keyboard.press('Enter');
  await waitText(A, /tell me the amount|how much|how many|quantity|katori|bowl/i, 90e3);
  await closeAI(A);
}, { page: A, soft: true });

await check('R09', 'Clean-up: robot food removed from today', [], async () => {
  await deleteFoods(A, /banana|dosa|idli|dal/i);
  const k = await kcal(A);
  must(todayBefore == null || k === todayBefore, `today is ${k} kcal, started at ${todayBefore}`);
}, { page: A, soft: true });

// Screens: two widths × two themes.
for (const theme of ['light', 'dark']) {
  await setTheme(A, theme);
  for (const width of [390, 360]) {
    await A.setViewport({ ...PHONE, width });
    for (const [name, go] of [['today', '/'], ['plan', '/plan'], ['progress', '/progress'], ['more', '/more'], ['settings', '/settings']]) {
      await check(`S-${theme}-${width}-${name}`, `${name} at ${width} px, ${theme}: no sideways scroll, no gold`, ['UI-001', 'UI-002', 'UI-009', 'RDS-008', 'RPR-012'], async () => {
        await gotoPath(A, go); await A.evaluate(() => window.scrollTo(0, 0)); await wait(800);
        must(await A.evaluate(t => document.documentElement.dataset.theme === t, theme), `data-theme is ${await A.evaluate(() => document.documentElement.dataset.theme)}`);
        must(await noSidewaysScroll(A), `page is wider than ${width} px`);
        const gold = await goldOnScreen(A);
        must(!gold.length, `gold on screen: ${gold.join(' | ')}`);
        if (width === 390) await shot(A, `${theme}-${name}`);
      }, { page: A });
    }
    await check(`S-${theme}-${width}-reach`, `last item on Today and More can be tapped (${width} px, ${theme})`, ['RPR-013', 'UI-001'], async () => {
      for (const go of ['/', '/more']) { await gotoPath(A, go); const why = await lastItemReachable(A); must(!why, `${go}: ${why}`); }
    }, { page: A });
  }
  await A.setViewport(PHONE);
  await check(`S-${theme}-sheets`, `AI panel and food sheet (${theme}): fit, no gold`, ['TOD-023', 'RDS-016', 'RDS-008'], async () => {
    await gotoPath(A, '/'); await openAI(A);
    must(await noSidewaysScroll(A), 'AI panel is wider than the screen');
    let gold = await goldOnScreen(A); must(!gold.length, `AI panel: ${gold.join(' | ')}`);
    await shot(A, `${theme}-ai`); await closeAI(A);
    await tap(A, 'plan-eat'); await wait(1200);
    gold = await goldOnScreen(A); must(!gold.length, `food sheet: ${gold.join(' | ')}`);
    await shot(A, `${theme}-food`); await A.keyboard.press('Escape'); await wait(600);
  }, { page: A });
}

await check('R10', 'Theme choice in Settings switches at once and is kept', ['RDS-006', 'SET-006'], async () => {
  await gotoPath(A, '/settings');
  for (const t of ['dark', 'light']) {
    await tap(A, `theme-${t}`); await wait(500);
    must(await A.evaluate(x => document.documentElement.dataset.theme === x, t), `did not switch to ${t}`);
    await reload(A); await gotoPath(A, '/settings');
    must(await A.evaluate(x => document.documentElement.dataset.theme === x, t), `${t} not kept after reopening`);
  }
  await tap(A, 'theme-system'); await wait(500);
}, { page: A });

await check('R11', 'More: seven rows, each opens', ['RDS-015'], async () => {
  await gotoPath(A, '/more');
  const want = ['Food & saved meals', 'Nutrition details', 'Meal ideas', 'Coach & check-ins', 'Profile & health', 'Connected devices', 'Settings'];
  const txt = await bodyText(A);
  const absent = want.filter(w => !txt.includes(w)); must(!absent.length, `missing: ${absent.join(', ')}`);
  for (const w of ['Profile & health', 'Connected devices', 'Settings']) {
    await gotoPath(A, '/more'); await tapText(A, new RegExp('^' + w.replace(/&/g, '&')));
    await wait(1500); must(!/Something went wrong|couldn.t load/i.test(await bodyText(A)), `${w} shows an error`);
  }
}, { page: A });

await check('R12', 'Plan and Progress tabs load', ['PLN-001', 'PRG-003'], async () => {
  await gotoPath(A, '/plan'); await wait(1500);
  for (const t of ['Week', 'Nutrition', 'Recovery', 'Today']) { await tapText(A, new RegExp(`^${t}$`)).catch(() => {}); await wait(700); }
  must(!/Something went wrong/i.test(await bodyText(A)), 'Plan shows an error');
  await gotoPath(A, '/progress'); await wait(2000);
  must(!/Something went wrong/i.test(await bodyText(A)), 'Progress shows an error');
}, { page: A });

// ── Coach → member, and another member sees nothing ──────────────────────────
const C = await newPage('coach');
const noteText = `${marker}: keep up the protein, Auto Member!`;
await check('R13', 'Coach signs in; home and the member page load', ['SMK-006', 'SMK-007', 'COH-015'], async () => {
  await coachLogin(C);
  await waitText(C, /Auto Member/, 30e3);
  must(!/Auto Member Two/.test(await bodyText(C)), 'the coach can see Auto Member Two, who is not assigned to them');
  await tapText(C, /^Auto Member$|Auto Member(?! Two)/, 'a,button,[role=button],li,div[class*="cursor-pointer"]');
  await waitFor(C, () => /\/coach\/\d+/.test(location.pathname), null, 20e3);
  for (const t of ['Nutrition', 'Training', 'Labs', 'Today']) { await tapText(C, new RegExp(`^${t}$`)).catch(() => {}); await wait(900); }
  must(!/Something went wrong/i.test(await bodyText(C)), 'the member page shows an error');
}, { page: C });

await check('R14', 'Coach note reaches the member in the coach line', ['RPR-005', 'CMP-005', 'TOD-014', 'RDS-011'], async () => {
  await tap(C, 'open-note');
  await C.waitForSelector('[data-testid="note-text"]', { visible: true });
  await C.type('[data-testid="note-text"]', noteText);
  await tap(C, 'note-save'); await wait(2500);
  await gotoPath(A, '/'); await reload(A);
  await waitFor(A, t => (document.querySelector('[data-testid="coach-line"]')?.textContent || '').includes(t), noteText, 30e3)
    .catch(() => { throw new Error('the note is not in the member\'s coach line'); });
}, { page: A });

const B = await newPage('member B');
await check('R15', 'Another member sees none of it', ['RPR-005', 'SEC-001', 'COH-015'], async () => {
  await memberLogin(B, ACC.b);
  await sheetSet(B, 'hero-weight', () => setInput(B, '[data-testid="weight-input"]', '64.2')); await settle();
  const txt = await bodyText(B);
  must(!txt.includes(marker), 'Member Two can see the coach\'s note to Auto Member');
  must(!/70\.4 kg/.test(txt), 'Member Two sees Auto Member\'s weight');
}, { page: B });

await check('R16', 'Sign out on a shared phone, next member sees only their own day', ['RPR-007', 'LOG-013', 'SEC-006'], async () => {
  await gotoPath(A, '/profile'); await wait(1500);
  await tap(A, 'account-signout');
  await A.waitForSelector('input[type=tel]', { timeout: 20e3 });
  must(await A.$eval('input[type=password]', el => el.value === ''), 'the PIN box is not empty after sign-out');
  await memberLogin(A, ACC.b); // the same browser, now Member Two
  const txt = await bodyText(A);
  must(!txt.includes(marker), 'after switching, Member Two sees Auto Member\'s coach note');
  must(!/70\.4 kg/.test(txt), 'after switching, Member Two sees Auto Member\'s weight');
  must(/64\.2 kg/.test(await textOf(A, 'hero-weight')), `Member Two's own weight is not shown: "${await textOf(A, 'hero-weight')}"`);
}, { page: A });

await check('R17', 'Clean-up: the coach deletes the robot note', [], async () => {
  await C.evaluate(t => {
    const row = [...document.querySelectorAll('*')].reverse().find(e => e.children.length < 12 && e.textContent.includes(t) && e.querySelector('button'));
    [...(row?.querySelectorAll('button') || [])].find(b => /🗑|Delete/.test(b.textContent + (b.getAttribute('aria-label') || '')))?.click();
  }, marker);
  await wait(800); await tapText(C, /^Delete$/).catch(() => {}); await wait(1500);
  await C.reload({ waitUntil: 'networkidle2' }); await wait(2000);
  must(!(await bodyText(C)).includes(marker), 'the robot note is still on the member page');
}, { page: C, soft: true });

await check('R18', 'No script errors on any page', ['UI-001'], async () => {
  must(!pageErrors.length, pageErrors.slice(0, 4).join(' | '));
});

await finish();

async function finish(fatal = null) {
  await browser.close().catch(() => {});
  const n = k => results.filter(r => r.result === k).length;
  const covered = [...new Set(results.filter(r => r.result === 'pass').flatMap(r => r.cases))].sort();
  const lines = [
    `# Phone robot — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '', `Site: ${BASE} · app ${live || '?'} · commit ${process.env.GITHUB_SHA?.slice(0, 7) || 'local'}`,
    '', `**${n('pass')} passed · ${n('fail')} failed · ${n('warn')} warnings**${fatal ? ` · stopped early: ${fatal}` : ''}`,
    '', '| Check | What | Workbook cases | Result | Detail |', '|---|---|---|---|---|',
    ...results.map(r => `| ${r.id} | ${r.title} | ${r.cases.join(', ')} | ${{ pass: '✅', fail: '❌', warn: '⚠️' }[r.result]} | ${String(r.detail).replace(/\|/g, '/').slice(0, 300)}${r.shot ? ` (${r.shot})` : ''} |`),
    '', `Workbook cases covered by passing checks (${covered.length}): ${covered.join(', ')}`,
    '', 'Not covered (real phone only): microphone, camera, installing the app and its icon, keyboard over inputs, push notifications, how it feels.',
  ];
  fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ base: BASE, live, results, pageErrors, covered }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  if (GH) {
    for (const r of results.filter(r => r.result === 'fail').slice(0, 9)) console.log(`::error title=Robot ${r.id} failed::${ghEsc(`${r.title} — ${r.detail} [${r.cases.join(', ')}]`)}`);
    console.log(`::notice title=Phone robot::${ghEsc(`${n('pass')} passed, ${n('fail')} failed, ${n('warn')} warnings on ${live || BASE}. Cases covered: ${covered.length}.${fatal ? ' Stopped early: ' + fatal : ''}`)}`);
  }
  console.log(`\n${fatal ? '✗ ' + fatal + '\n' : ''}Robot: ${n('pass')} passed, ${n('fail')} failed, ${n('warn')} warnings → ${path.relative(ROOT, OUT)}/report.md`);
  process.exit(fatal || n('fail') ? 1 : 0);
}
