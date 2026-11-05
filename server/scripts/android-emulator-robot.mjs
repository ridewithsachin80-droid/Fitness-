#!/usr/bin/env node
/**
 * scripts/android-emulator-robot.mjs — Android emulator robot (5 Nov 2026). TEST SITE ONLY, READ-ONLY.
 *
 * Run by .github/workflows/android-emulator-robot.yml (manual start only) inside a real Android emulator on GitHub's
 * machines (Android 14, Google APIs image, Chrome for Android). Playwright drives the phone's own Chrome over adb.
 * Unlike the phone robot (desktop Chrome pretending to be a phone), this is Android itself: its Chrome, its soft
 * keyboard, its status and navigation bars, its dark mode.
 *
 * It signs in as the robot member ("Auto Member"), then in the LIGHT and then the DARK system theme:
 * Today (top and scrolled), the AI composer with the Android keyboard up (is the text box still visible?), Plan,
 * Progress and More. Full-screen Android screenshots and a screen recording per theme go to qa/android-results/.
 *
 * Read-only: it never presses Send or Save and never changes a setting in the app. Nothing it types is sent.
 * The login screen is photographed BEFORE anything is typed, so no phone number or PIN appears in any picture,
 * log or report. It refuses any address other than the test site.
 *
 * It is NOT a physical-phone test: no real microphone, camera, push notification, install or real phone speed.
 *
 *   ROBOT_BASE_URL=https://fitness-test.up.railway.app FITLIFE_ROBOT_MEMBER_PHONE=… FITLIFE_ROBOT_MEMBER_PIN=… \
 *     node scripts/android-emulator-robot.mjs        (with an emulator or phone visible to `adb devices`)
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { _android } = require('playwright-core');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '../../qa/android-results');
fs.mkdirSync(OUT, { recursive: true });
const TEST_SITE = 'https://fitness-test.up.railway.app';
const BASE = (process.env.ROBOT_BASE_URL || '').replace(/\/+$/, '');
const PHONE = (process.env.FITLIFE_ROBOT_MEMBER_PHONE || '').replace(/\D/g, '');
const PIN = process.env.FITLIFE_ROBOT_MEMBER_PIN || '';
const PROFILE = process.env.ANDROID_PROFILE || 'unknown';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const rows = []; let failed = 0; const shots = [];
const row = (name, ok, detail) => { rows.push({ name, ok, detail }); if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const secretFree = (s) => { let t = String(s ?? ''); if (PHONE) t = t.split(PHONE).join('<phone>'); if (PIN) t = t.split(PIN).join('<pin>'); return t; };

function writeReport(head) {
  const lines = [`# Android emulator robot — ${PROFILE}`, '', head, '',
    '| | Check | Detail |', '|---|---|---|', ...rows.map(r => `| ${r.ok ? '✓' : '✗'} | ${r.name} | ${secretFree(r.detail || '').replace(/\|/g, '/')} |`), '',
    `Screenshots (${shots.length}): ${shots.join(', ')}`, '',
    'Emulator, not a physical phone: no real microphone, camera, push notification, install or real phone speed. Read-only: nothing was sent or saved.'];
  fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n') + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
function stop(msg, code = 1) { row('robot finished', false, msg); writeReport(`**Result: FAILED** — ${secretFree(msg)}`); process.exit(code); }

if (BASE !== TEST_SITE) stop(`refusing to run against "${BASE || '(no address)'}": this robot only visits ${TEST_SITE}`, 2);
if (PHONE.length !== 10 || !PIN) stop('BLOCKED: the robot member secrets (FITLIFE_ROBOT_MEMBER_PHONE / _PIN) are missing or not 10 digits. Nothing was tested.', 3);

const adbList = spawnSync('adb', ['devices'], { encoding: 'utf8' });   // also starts adb's server, which Playwright needs
if (adbList.error || !/\tdevice\b/.test(adbList.stdout || '')) stop(`no Android device or emulator visible to adb (${adbList.error ? 'adb not found' : (adbList.stdout || '').replace(/\s+/g, ' ').trim().slice(0, 120)})`);
const [device] = await _android.devices().catch(e => stop(`adb could not list devices: ${String(e.message || e).split('\n')[0].slice(0, 200)}`));
if (!device) stop('no Android device or emulator found by adb');
const sh = async (cmd) => String(await device.shell(cmd)).trim();
const androidVersion = await sh('getprop ro.build.version.release');
const chromeVersion = ((await sh('dumpsys package com.android.chrome')).match(/versionName=(\S+)/) || [])[1] || 'not installed';
const screenSize = await sh('wm size');
const density = await sh('wm density');
console.log(`Android ${androidVersion}, model ${device.model()}, Chrome ${chromeVersion}, ${screenSize}, ${density}`);
if (chromeVersion === 'not installed') stop('Chrome is not installed on this emulator image');

let n = 0;
async function shot(name) {
  await clearSystemDialogs();
  const f = `${String(++n).padStart(2, '0')}-${name}.png`;
  await device.screenshot({ path: path.join(OUT, f) }); shots.push(f); return f;
}
/** Android's own screen recording (max 180 s each). Stopped with SIGINT so the file is finished properly. */
function startRecording(name) {
  const p = spawn('adb', ['shell', 'screenrecord', '--time-limit', '175', '--bit-rate', '4000000', `/sdcard/${name}.mp4`], { stdio: 'ignore' });
  return async () => { await sh('pkill -INT screenrecord').catch(() => {}); await wait(2500); p.kill();
    await new Promise(r => spawn('adb', ['pull', `/sdcard/${name}.mp4`, path.join(OUT, `${name}.mp4`)], { stdio: 'ignore' }).on('exit', r)); };
}
const keyboardShown = async () => /mInputShown=true/.test(await sh('dumpsys input_method'));

await sh('cmd uimode night no');
// Keep the emulator's screen on and unlocked: a dozing or locked screen still gives screenshots but ignores taps.
await sh('svc power stayon true; settings put system screen_off_timeout 1800000; input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard; input keyevent 82').catch(() => {});
await sh('am force-stop com.android.chrome');
/** The address shown in Chrome's own address bar on the SCREEN (Android's UI dump), to prove the robot's tab is the visible one. */
const shownUrl = async () => { const x = await sh('uiautomator dump /sdcard/fitlife-ui.xml >/dev/null 2>&1; cat /sdcard/fitlife-ui.xml').catch(() => '');
  const m = x.match(/resource-id="com\.android\.chrome:id\/url_bar"[^>]*/) || x.match(/text="([^"]*)"[^>]*resource-id="com\.android\.chrome:id\/url_bar"/);
  const t = m ? (m[0].match(/text="([^"]*)"/) || [])[1] : null; if (t != null) return t;
  // Say what IS on the screen: each node's class, id and text (the dump is taken before anything is typed).
  const nodes = [...x.matchAll(/<node [^>]*>/g)].map(n => { const g = (k) => (n[0].match(new RegExp(k + '="([^"]*)"')) || [])[1] || '';
    return [g('class').split('.').pop(), g('resource-id').split('/').pop(), g('text').slice(0, 40), g('content-desc').slice(0, 40), g('bounds')].filter(Boolean).join(' '); });
  return `(no address bar; ${nodes.length} nodes: ${nodes.join(' | ').slice(0, 900)})`; };
/** Android and Chrome put their own pop-ups over the page on a fresh emulator ("Pixel Launcher isn't responding",
 *  "Chrome notifications make things easier"). They swallow taps and spoil screenshots, so before every screenshot and
 *  every real tap the robot closes them with their harmless button ("Wait", "No thanks"…) and records what it closed. */
const dismissed = [];
async function clearSystemDialogs() {
  for (let i = 0; i < 4; i++) {
    const x = await sh('uiautomator dump /sdcard/fitlife-ui.xml >/dev/null 2>&1; cat /sdcard/fitlife-ui.xml').catch(() => '');
    // ONLY Android's and Chrome's own native dialogs, by their resource id. Buttons inside the web page (FitLife's own
    // "Not now" etc.) have no resource id and are never pressed: run 41990534873 pressed FitLife's "Not now" this way.
    const [SW, SH] = ((await sh('wm size')).match(/(\d+)x(\d+)/) || []).slice(1).map(Number);
    const SYSTEM = /resource-id="(android:id\/aerr_wait|com\.android\.chrome:id\/negative_button|android:id\/button2|com\.android\.permissioncontroller:id\/permission_deny(_and_dont_ask_again)?_button)"/;
    const btn = [...x.matchAll(/<node [^>]*>/g)].map(n => n[0]).find(n => SYSTEM.test(n) && (() => {
      const q = n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/); return q && +q[3] <= SW && +q[4] <= SH && +q[1] >= 0 && +q[2] >= 0; })());
    if (!btn) return;
    const b = btn.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/); if (!b) return;
    const title = (x.match(/resource-id="android:id\/alertTitle"[^>]*/) || x.match(/text="(Chrome notifications[^"]*)"/) || [''])[0];
    dismissed.push(`${(btn.match(/text="([^"]*)"/) || [])[1] || 'button'} (${(btn.match(/resource-id="([^"]*)"/) || [])[1]}) on "${((title.match(/text="([^"]*)"/) || [])[1] || '').slice(0, 60)}"`);
    await sh(`input tap ${Math.round((+b[1] + +b[3]) / 2)} ${Math.round((+b[2] + +b[4]) / 2)}`); await wait(1200);
  }
}
const focus = async () => ((await sh('dumpsys window | grep -E "mCurrentFocus|mFocusedApp" | head -2')).replace(/\s+/g, ' ').slice(0, 220));
const awake = async () => ((await sh('dumpsys power | grep -E "mWakefulness=|mHoldingDisplaySuspendBlocker"')).replace(/\s+/g, ' ').slice(0, 160));
// hasTouch: lets Playwright send touch taps (Chrome itself is unchanged). The first tab can take a moment to attach.
// hasTouch: lets Playwright send touch taps (Chrome itself is unchanged). The first tab can take a moment to attach.
let context, page;
async function openChrome() {
  if (context) await context.close().catch(() => {});
  await sh('pm grant com.android.chrome android.permission.POST_NOTIFICATIONS').catch(() => {});   // no "Chrome notifications…" prompt
  context = await device.launchBrowser({ hasTouch: true });
  // Use the tab Chrome opened itself when there is one (a second tab would sit behind it); wait for it before making one.
  page = context.pages()[0] || await context.waitForEvent('page', { timeout: 10e3 }).catch(() => null);
  for (let i = 0; !page && i < 5; i++) { page = await context.newPage().catch(() => null) || context.pages()[0]; if (!page) await wait(3000); }
  if (!page) stop('Chrome opened, but no tab could be attached (5 tries)');
  await page.bringToFront().catch(() => {});
  page.setDefaultTimeout(30e3);
  await wait(1500); await clearSystemDialogs();
  console.log(`Chrome tabs attached: ${context.pages().length}`);
}
await openChrome();

/** A REAL Android tap (adb "input tap"), so the phone behaves as under a finger: the soft keyboard opens for a text box.
 *  (Playwright's own taps are synthetic and do not open the keyboard.) Where the web page sits on the screen is MEASURED
 *  just before each tap: an invisible full-screen layer is added, one real tap lands on it, the layer reports where the
 *  touch arrived in page pixels and is removed (the tap goes nowhere else). Chrome's toolbar can move, so this is redone
 *  every time. */
async function contentOrigin() {
  const [W, H] = ((await sh('wm size')).match(/(\d+)x(\d+)/) || []).slice(1).map(Number);
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'fitlife-robot-calibrate';
    d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent;touch-action:none';
    const got = (e) => { const p = e.touches?.[0] || e; if (!window.__fitlifeTouch) window.__fitlifeTouch = { x: p.clientX, y: p.clientY, type: e.type }; e.preventDefault?.(); e.stopPropagation(); };
    for (const t of ['pointerdown', 'touchstart', 'mousedown']) d.addEventListener(t, got, { capture: true, passive: false });
    window.__fitlifeTouch = null; document.body.appendChild(d); });
  const px = Math.round(W / 2), py = Math.round(H / 2);
  await sh(`input tap ${px} ${py}`); await wait(600);
  const t = await page.evaluate(() => { document.getElementById('fitlife-robot-calibrate')?.remove(); return window.__fitlifeTouch; });
  if (!t) return null;
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  return { left: Math.round(px - t.x * dpr), top: Math.round(py - t.y * dpr), dpr, how: 'measured' };
}
async function realTap(locator, what) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await clearSystemDialogs();
  await wait(400);
  const o = await contentOrigin();
  if (!o) throw new Error(`${what}: the calibration tap did not reach the page (focus: ${await focus()}; power: ${await awake()})`);
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${what}: not on screen`);
  const x = Math.round(o.left + (box.x + box.width / 2) * o.dpr), y = Math.round(o.top + (box.y + box.height / 2) * o.dpr);
  await sh(`input tap ${x} ${y}`);
  return `page origin ${o.left},${o.top} (measured); tapped ${x},${y}`;
}
/** What the robot could see when something failed (test ids on screen, the address), for the log. Never typed values. */
async function whatIsOnScreen() {
  return page.evaluate(() => `${location.pathname} · visible: ${[...document.querySelectorAll('[data-testid]')].filter(e => e.offsetParent !== null).map(e => e.dataset.testid).slice(0, 25).join(', ')} · dialogs open: ${document.querySelectorAll('[role=dialog]').length}`).catch(e => `(page unreadable: ${e.message})`);
}

const tid = (id) => page.locator(`[data-testid="${id}"]`);
async function tapNav(label) {
  const el = page.locator('nav a, nav button').filter({ hasText: new RegExp('^\\s*' + label) }).first();
  await el.tap(); await wait(2500);
}
async function sideways() { return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); }

async function signIn(photo = true) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.locator('input[type=tel], [data-testid="daily-essentials"]').first().waitFor();
  if (await tid('daily-essentials').count()) { row('Still signed in after Chrome restarted', true); return; }
  await wait(1500);
  if (photo) {
    const f = await shot('light-login-before-typing');
    const onScreen = await shownUrl();
    const title = await page.title();
    row('Login screen opens in Android Chrome', true, `${f} (photographed before anything was typed)`);
    row("The robot's tab is the one on the screen", /fitness-test/.test(onScreen) || new RegExp(`WebView ${title.replace(/[^\w ]/g, '.')}\\b`).test(onScreen),
      `on screen: ${/fitness-test/.test(onScreen) ? `address bar "${onScreen}"` : `web page titled "${title}" ${new RegExp('WebView ' + title).test(onScreen) ? 'found' : 'NOT found'} in Android's screen dump`}; robot's tab: ${page.url()}; tabs: ${context.pages().length}`);
  }
  if (photo) {
    const how = await realTap(page.locator('input[type=tel]'), 'phone box').catch(e => e.message); await wait(1500);
    row('A real tap on the phone box raises the Android keyboard', await keyboardShown(), `dumpsys input_method mInputShown; ${how}`);
  }
  await page.locator('input[type=tel]').fill(PHONE);
  await page.locator('input[type=password]').fill(PIN);
  await page.locator('button').filter({ hasText: /^Log In/ }).first().tap();
  for (let i = 0; i < 40; i++) {
    if (await tid('daily-essentials').count()) break;
    if (await page.locator('[data-testid="onb-next"], [data-testid="onb-primary"], [data-testid="onb-modes"]').count()) {
      await page.evaluate(() => {
        [...document.querySelectorAll('[data-testid="onb-modes"] button')].find(b => /Adult/.test(b.textContent))?.click();
        if (!document.querySelector('[data-testid="onb-goals"] button[aria-pressed="true"]')) document.querySelector('[data-testid="onb-goals"] button')?.click();
        (document.querySelector('[data-testid="onb-next"]:not([disabled])') || document.querySelector('[data-testid="onb-primary"]:not([disabled])'))?.click();
      });
    }
    await wait(1000);
  }
  if (!(await tid('daily-essentials').count())) stop('sign-in did not reach Today (no Daily essentials after 40 s)');
  row('Robot member signs in and Today opens', true);
  await wait(2000);
}

async function tour(theme) {
  const stopRec = startRecording(`${theme}-tour`);
  try {
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(800);
    const actual = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    row(`${theme}: the page sees the Android system theme`, actual === theme, `prefers-color-scheme: ${actual}`);
    let f = await shot(`${theme}-today-top`);
    row(`${theme}: Today`, !(await sideways()), `${f}; no sideways scroll`);
    await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.8))); await wait(1000);
    f = await shot(`${theme}-today-scrolled`);
    row(`${theme}: Today, scrolled`, true, f);
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(600);

    // The AI composer with the real Android keyboard: is the text box still visible above it?
    await tid('ai-type').waitFor({ state: 'visible', timeout: 15e3 }).catch(async () => { throw new Error(`the "Type to log" button is not visible: ${await whatIsOnScreen()}`); });
    await tid('ai-type').tap();
    await tid('composer-input').waitFor({ state: 'visible', timeout: 15e3 });
    const how = await realTap(tid('composer-input'), 'composer text box'); await wait(2000);
    const kb = await keyboardShown();
    const geo = await page.evaluate(() => { const r = document.querySelector('[data-testid="composer-input"]').getBoundingClientRect(); const v = window.visualViewport;
      return { inputBottom: Math.round(r.bottom), inputTop: Math.round(r.top), visibleBottom: Math.round(v.offsetTop + v.height), innerHeight: window.innerHeight }; });
    f = await shot(`${theme}-composer-keyboard-up`);
    row(`${theme}: AI composer — a real tap raises the Android keyboard`, kb, `${f}; mInputShown=${kb}; ${how}`);
    row(`${theme}: AI composer — the text box stays visible above the keyboard`, geo.inputTop >= 0 && geo.inputBottom <= geo.visibleBottom + 1,
      `box ${geo.inputTop}–${geo.inputBottom} px, visible area ends at ${geo.visibleBottom} px (window ${geo.innerHeight} px)`);
    await page.locator('[data-testid="composer-input"]').fill('2 idli aur 1 bowl sambar'); await wait(800);
    f = await shot(`${theme}-composer-typed-not-sent`);
    row(`${theme}: typing into the composer (NOT sent)`, true, f);
    await page.locator('[data-testid="composer-input"]').fill(''); await wait(300);
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => document.querySelector('[aria-label="Close AI assistant"]')?.click()); await wait(1500);
    await sh('input keyevent 111').catch(() => {});   // ESCAPE: make sure the keyboard is down

    for (const [label, file] of [['Plan', 'plan'], ['Progress', 'progress'], ['More', 'more'], ['Today', 'today-again']]) {
      try {
        await tapNav(label);
        f = await shot(`${theme}-${file}`);
        row(`${theme}: ${label} tab opens`, !(await sideways()), `${f}; no sideways scroll`);
      } catch (e) { row(`${theme}: ${label} tab opens`, false, String(e.message || e).slice(0, 160)); }
    }
  } finally { await stopRec(); }
}

try {
  await signIn();
  await tour('light');
  // Chrome reads the system theme when it starts, so switch Android to dark and restart Chrome (the sign-in is kept).
  await sh('cmd uimode night yes'); await wait(2000);
  await openChrome();
  await signIn(false);
  await tid('daily-essentials').waitFor(); await wait(2000);
  await tour('dark');
} catch (e) { row('robot finished', false, secretFree(`${String(e.message || e).split('\n')[0].slice(0, 240)} — on screen: ${await whatIsOnScreen()}`)); }
finally {
  await sh('cmd uimode night no').catch(() => {});
  await context.close().catch(() => {});
  await device.close().catch(() => {});
}
row('System pop-ups closed by the robot (not FitLife)', true, dismissed.length ? dismissed.join('; ') : 'none');
const head = `**Result: ${failed ? `${failed} check(s) FAILED` : 'all checks passed'}** · ${PROFILE} · Android ${androidVersion} · Chrome ${chromeVersion} · ${screenSize} · ${density} · ${BASE} · ${new Date().toISOString()}`;
writeReport(head);
console.log(`\n${head}`);
process.exit(failed ? 1 : 0);
