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
await sh('am force-stop com.android.chrome');
const context = await device.launchBrowser();
const page = await context.newPage();
page.setDefaultTimeout(30e3);

const tid = (id) => page.locator(`[data-testid="${id}"]`);
async function tapNav(label) {
  const el = page.locator('nav a, nav button').filter({ hasText: new RegExp('^\\s*' + label) }).first();
  await el.tap(); await wait(2500);
}
async function sideways() { return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); }

async function signIn() {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.locator('input[type=tel]').waitFor();
  await wait(1500);
  const f = await shot('light-login-before-typing');
  row('Login screen opens in Android Chrome', true, `${f} (photographed before anything was typed)`);
  await page.locator('input[type=tel]').tap(); await wait(1200);
  row('Tapping the phone box raises the Android keyboard', await keyboardShown(), 'dumpsys input_method mInputShown');
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
    await tid('ai-type').tap();
    await tid('composer-input').waitFor({ state: 'visible', timeout: 15e3 });
    await tid('composer-input').tap(); await wait(1800);
    const kb = await keyboardShown();
    const geo = await page.evaluate(() => { const r = document.querySelector('[data-testid="composer-input"]').getBoundingClientRect(); const v = window.visualViewport;
      return { inputBottom: Math.round(r.bottom), inputTop: Math.round(r.top), visibleBottom: Math.round(v.offsetTop + v.height), innerHeight: window.innerHeight }; });
    f = await shot(`${theme}-composer-keyboard-up`);
    row(`${theme}: AI composer — Android keyboard up`, kb, `${f}; mInputShown=${kb}`);
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
  await sh('cmd uimode night yes'); await wait(1500);
  await page.reload({ waitUntil: 'load' }); await tid('daily-essentials').waitFor(); await wait(2000);
  await tour('dark');
} catch (e) { row('robot finished', false, secretFree(String(e.message || e).slice(0, 300))); }
finally {
  await sh('cmd uimode night no').catch(() => {});
  await context.close().catch(() => {});
  await device.close().catch(() => {});
}
const head = `**Result: ${failed ? `${failed} check(s) FAILED` : 'all checks passed'}** · ${PROFILE} · Android ${androidVersion} · Chrome ${chromeVersion} · ${screenSize} · ${density} · ${BASE} · ${new Date().toISOString()}`;
writeReport(head);
console.log(`\n${head}`);
process.exit(failed ? 1 : 0);
