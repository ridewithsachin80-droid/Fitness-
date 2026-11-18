/**
 * scripts/test-ux-3j.mjs — Fixes-3j (5 Nov 2026): Phase 1 of the UX fix plan (claude/FitLife-UX-Fix-Plan-2026-11-05.md).
 * REAL Postgres + the REAL patients route for [1]; the REAL client modules for the rest (helpers bundled with esbuild,
 * components mounted in jsdom).
 *   [1] finding 1: GET /api/patients/me gives the latest weight that EXISTS (the newest day often has none yet);
 *   [2] finding 1: the Profile goal sentence never says "goal reached" without a known weight;
 *   [3] finding 7: a weight more than 2 kg from the day before gets a gentle "please check" (never blocks);
 *   [4] finding 2: offline, the AI box says it is the connection; no answer says so; other messages unchanged;
 *   [5] finding 16: the install card is an ordinary card in the page (never fixed over "Type to log"), with a 44×44 px
 *       close, and not on a phone's first day;
 *   [6] finding 9: a member who has just finished onboarding gets no "A fresh look" card; an earlier member still does;
 *   [7] finding 10: the notification switch reads the phone's real permission.
 */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) { console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1); }
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SRC = path.join(ROOT, 'client/src');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-ux-3j-'));
// Any real HTTP client in the bundle is replaced by this, so a missed stub fails loudly instead of calling out.
fs.writeFileSync(path.join(TMP, 'no-axios.js'), "const no = () => { throw new Error('test-ux-3j: a real HTTP request was attempted'); }; const ax = { create: () => ax, get: no, post: no, put: no, patch: no, delete: no, request: no, interceptors: { request: { use() {} }, response: { use() {} } }, defaults: { headers: { common: {} } } }; export default ax; export const isAxiosError = () => false;");
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 400))); };
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

/** Bundle a small entry that imports real client modules, as an IIFE that sets window.T. */
async function bundle(contents, apiStub = 'export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }) };') {
  const apiFile = path.join(TMP, `api-${Math.random().toString(36).slice(2)}.js`); fs.writeFileSync(apiFile, apiStub);
  const out = await build({ stdin: { resolveDir: SRC, loader: 'jsx', contents }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true}' },
    // QA re-check: catch EVERY import of the API client (api/logs.js imports it as './client'), so no test request can
    // ever leave this computer; an unmatched import now fails the bundle instead of reaching a real site.
    plugins: [{ name: 'stub-api', setup(b) {
      b.onResolve({ filter: /(?:^|\/)client(\.js)?$/ }, a => (/api\/client(\.js)?$/.test(a.path) || (/^\.\/client(\.js)?$/.test(a.path) && /[\\/]api$/.test(a.resolveDir))) ? { path: apiFile } : null);
      b.onResolve({ filter: /^axios$/ }, () => ({ path: path.join(TMP, 'no-axios.js') }));
    } }], logLevel: 'silent' });
  return out.outputFiles[0].text;
}
const dom = (url = 'http://localhost/') => new JSDOM('<html><body><div id="root"></div></body></html>', { url, runScripts: 'outside-only', pretendToBeVisual: true });

let srv;
try {
  // ── [1] the real route ──
  console.log('\n[1] Profile weight: the latest day that HAS a weight');
  const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
  const pool = require('../db/pool');
  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use((q, _r, n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
  app.use('/api/patients', require('../routes/patients'));
  srv = app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const port = srv.address().port;
  const phone = '6' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const member = (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ('UX Weight Member',$1,'x','patient',true) RETURNING id`, [phone])).rows[0].id;
  await pool.query(`INSERT INTO patient_profiles (user_id, height_cm, start_weight, target_weight, goal) VALUES ($1,162,79,70,'lose')`, [member]);
  const me = async () => (await (await fetch(`http://127.0.0.1:${port}/api/patients/me`, { headers: { Authorization: 'Bearer ' + jwt.sign({ id: member, role: 'patient', name: 'T' }, process.env.JWT_SECRET, { expiresIn: 600 }) } })).json());
  await pool.query(`INSERT INTO daily_logs (patient_id, log_date, weight_kg) VALUES ($1, CURRENT_DATE - 2, 78.0), ($1, CURRENT_DATE - 1, 77.6)`, [member]);
  let r = await me();
  ck('positive control: newest day has a weight (77.6) → current_weight 77.6', Number(r.current_weight) === 77.6, r.current_weight);
  await pool.query(`INSERT INTO daily_logs (patient_id, log_date, water_ml) VALUES ($1, CURRENT_DATE, 750)`, [member]);
  r = await me();
  ck('today has food/water but NO weight → current_weight is still 77.6 (3i: null, so Profile said "goal reached")', Number(r.current_weight) === 77.6, r.current_weight);
  await pool.query(`DELETE FROM daily_logs WHERE patient_id=$1`, [member]);
  r = await me();
  ck('no weight ever logged → current_weight null (nothing invented)', r.current_weight == null, r.current_weight);
  await pool.query(`DELETE FROM users WHERE id=$1`, [member]);

  // ── [2]–[4] real client helpers ──
  const helpers = await bundle(`
    import { goalHeadline } from './utils/goalHeadline';
    import { weightJumpNote } from './utils/weightCheck';
    import { requestFailureMessage } from './utils/aiRequestRecovery';
    window.T = { goalHeadline, weightJumpNote, requestFailureMessage };`);
  const D = dom(); D.window.eval(helpers); const T = D.window.T;

  console.log('\n[2] the goal sentence');
  const G = (cur, goalId = 'lose', s = 79, t = 70) => T.goalHeadline({ goalId, goalLabel: 'Lose weight', startWeight: s, targetWeight: t, currentWeight: cur });
  ck('weight unknown → "Lose 9 kg" (3i said "Lose 9 kg · goal reached")', G(null) === 'Lose 9 kg' && G(undefined) === 'Lose 9 kg' && G('') === 'Lose 9 kg', [G(null), G('')]);
  ck('77.6 kg → "Lose 9 kg · 7.6 kg to go"', G(77.6) === 'Lose 9 kg · 7.6 kg to go', G(77.6));
  ck('at or below the target → "goal reached" (70 and 69.4)', G(70) === 'Lose 9 kg · goal reached' && G(69.4) === 'Lose 9 kg · goal reached', [G(70), G(69.4)]);
  ck('values as text from the database ("77.6", "79.0") read the same', T.goalHeadline({ goalId: 'lose', startWeight: '79.0', targetWeight: '70.0', currentWeight: '77.6' }) === 'Lose 9 kg · 7.6 kg to go');
  ck('gain: unknown → "Gain 5 kg"; 52 of 55 → "3 kg to go"; reached → "Gain 5 kg"', G(null, 'gain', 50, 55) === 'Gain 5 kg' && G(52, 'gain', 50, 55) === 'Gain 5 kg · 3 kg to go' && G(56, 'gain', 50, 55) === 'Gain 5 kg', [G(null, 'gain', 50, 55), G(52, 'gain', 50, 55)]);
  ck('other goals keep their label; no goal → nothing', T.goalHeadline({ goalId: 'energy', goalLabel: 'More energy' }) === 'More energy' && T.goalHeadline({}) === null);

  console.log('\n[3] a big weight jump gets a gentle check');
  ck('82.5 after 77.6 → "That\'s 4.9 kg more than the day before (77.6)…"', /That's 4\.9 kg more than the day before \(77\.6\)/.test(T.weightJumpNote(82.5, 77.6)) && /you can still save it/.test(T.weightJumpNote(82.5, 77.6)), T.weightJumpNote(82.5, 77.6));
  ck('75.0 after 77.6 → "2.6 kg less"', /2\.6 kg less/.test(T.weightJumpNote('75.0', 77.6)), T.weightJumpNote('75.0', 77.6));
  ck('negative controls: 78.5 after 77.6 (0.9 kg), exactly 2 kg, no earlier weight, unreadable → no note', ['', '', '', ''].every((x, i) => [T.weightJumpNote(78.5, 77.6), T.weightJumpNote(79.6, 77.6), T.weightJumpNote(82.5, null), T.weightJumpNote('abc', 77.6)][i] === x));

  console.log('\n[4] the AI box when the connection is the problem');
  const net = Object.assign(new Error('Network Error'), { request: {} });
  ck('phone offline → "You\'re offline. Your message is kept here — tap Retry…" and points to the Today tiles', /^You're offline\. Your message is kept here — tap Retry/.test(T.requestFailureMessage(net, 'text', false)) && /Today tiles/.test(T.requestFailureMessage(net, 'text', false)), T.requestFailureMessage(net, 'text', false));
  ck('phone offline, photo → "You\'re offline. Your photo is kept here…"', /^You're offline\. Your photo is kept here/.test(T.requestFailureMessage(net, 'photo', false)));
  ck('online but no answer at all → "No answer from FitLife — check your internet…"', /^No answer from FitLife — check your internet/.test(T.requestFailureMessage(net, 'text', true)), T.requestFailureMessage(net, 'text', true));
  ck('unchanged: 401, 429, timeout and a server error keep their 3i wording', /sign in again/.test(T.requestFailureMessage({ response: { status: 401 } }, 'text', true))
    && /busy right now/.test(T.requestFailureMessage({ response: { status: 429 } }, 'text', true)) && /took too long/.test(T.requestFailureMessage({ code: 'ECONNABORTED' }, 'text', true))
    && /could not be processed/.test(T.requestFailureMessage({ response: { status: 500 } }, 'text', true)));
  // QA review of 3j: a REAL axios timeout also carries error.request (no response); it must still say "took too long".
  const realTimeout = Object.assign(new Error('timeout of 200ms exceeded'), { code: 'ECONNABORTED', request: {} });
  ck('a real timeout (code ECONNABORTED WITH error.request, as axios makes it) → "That took too long…", not "No answer"', /^That took too long/.test(T.requestFailureMessage(realTimeout, 'text', true)), T.requestFailureMessage(realTimeout, 'text', true));
  ck('…and ETIMEDOUT with a request too', /^That took too long/.test(T.requestFailureMessage(Object.assign(new Error('x'), { code: 'ETIMEDOUT', request: {} }), 'text', true)));

  // ── [5]–[6] real components in jsdom ──
  const comps = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { act } from 'react';
    import InstallPrompt, { seenForADay } from './components/InstallPrompt';
    import WhatsNew, { markWhatsNewSeen } from './components/member/WhatsNew';
    import { useSettingsStore } from './store/settingsStore';
    import Settings, { pushBlockedOnThisPhone } from './pages/Settings';
    import WeightSheet from './components/sheets/WeightSheet';
    import { captureInstallOffer } from './utils/installOffer';
    import { MemoryRouter } from 'react-router-dom';
    window.T = { seenForADay, markWhatsNewSeen, pushBlockedOnThisPhone, captureInstallOffer,
      mount: (which, props) => { const root = createRoot(document.getElementById('root'));
        root.render(which === 'install' ? <InstallPrompt /> : which === 'weight' ? <WeightSheet open onClose={() => {}} m={props} />
          : which === 'settings' ? <MemoryRouter initialEntries={['/settings']}><Settings /></MemoryRouter> : <WhatsNew />); return root; },
      onboarded: (v) => useSettingsStore.setState({ onboardingDone: v }) };`);
  const DAY = 24 * 3600 * 1000;
  const installPage = async (firstSeenAgo, { offerBeforeMount = false } = {}) => {
    const d = dom(); const w = d.window;
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    if (firstSeenAgo != null) w.localStorage.setItem('fitlife.firstSeenAt', String(Date.now() - firstSeenAgo));
    w.eval(comps);
    const offer = () => { const ev = new w.Event('beforeinstallprompt', { cancelable: true }); ev.prompt = () => {}; ev.userChoice = Promise.resolve({ outcome: 'dismissed' }); w.dispatchEvent(ev); };
    // As main.jsx does: catch the offer from the app's first moment. QA review of 3j: Chrome sends it ONCE per page load,
    // often while Today still shows its loading placeholder, i.e. before the card is mounted.
    w.T.captureInstallOffer(w);
    if (offerBeforeMount) offer();
    w.T.mount('install'); await tick(60);
    if (!offerBeforeMount) offer();
    await tick(60);
    return { w, card: w.document.querySelector('[data-testid="install-card"]'), x: w.document.querySelector('[data-testid="install-dismiss"]') };
  };
  console.log('\n[5] the install card');
  let P = await installPage(2 * DAY);
  ck('after a day on this phone, Chrome\'s install offer shows the card', !!P.card, P.w.document.body.innerHTML.slice(0, 200));
  ck('…as an ordinary card in the page: no "fixed", no "bottom-24", no "z-50" (3i floated it over "Type to log")', P.card && !/\bfixed\b|bottom-24|z-50/.test(P.card.className), P.card?.className);
  ck('…its close × is at least 44×44 px', P.x && parseInt(P.x.style.minWidth) >= 44 && parseInt(P.x.style.minHeight) >= 44, P.x?.getAttribute('style'));
  P.x?.click(); await tick(40);
  ck('…closing it hides it and remembers that on this phone', !P.w.document.querySelector('[data-testid="install-card"]') && !!P.w.localStorage.getItem('installDismissedAt'));
  P = await installPage(2 * DAY, { offerBeforeMount: true });
  ck('the offer arrives BEFORE the card mounts (Today still loading) → the card still shows (3j draft: lost for the session)', !!P.card);
  P = await installPage(null);
  ck('a phone\'s FIRST visit: no card, even when Chrome offers installation (and the first visit is noted)', !P.card && !!P.w.localStorage.getItem('fitlife.firstSeenAt'));
  P = await installPage(3 * 3600 * 1000);
  ck('still the first day (3 h in): no card', !P.card);

  console.log('\n[6] "A fresh look" is for earlier members only');
  const wn = async (justOnboarded) => { const d = dom(); const w = d.window; w.eval(comps); w.T.onboarded(true); if (justOnboarded) w.T.markWhatsNewSeen(); w.T.mount('whatsnew'); await tick(40); return !!w.document.querySelector('[data-testid="whats-new"]'); };
  ck('positive control: an onboarded member who has not seen it → the card shows', await wn(false));
  ck('a member who has just finished onboarding (markWhatsNewSeen, called by Onboarding) → no card', !(await wn(true)));
  ck('Onboarding.jsx calls markWhatsNewSeen() when setup finishes', /markWhatsNewSeen\(\);[^\n]*\n\s*finishOnboarding\(ageMode\)/.test(fs.readFileSync(path.join(SRC, 'components/Onboarding.jsx'), 'utf8')));

  console.log('\n[3b] the weight sheet works the note out from the day it shows');
  const sheet = async (m) => { const d = dom(); const w = d.window; w.eval(comps); w.T.mount('weight', { log: { weight: '' }, update() {}, validateWeight() {}, weightWarning: '', weightDelta: null, yesterdayWeight: null, ...m }); await tick(60);
    return w.document.querySelector('[data-testid="weight-warning"]')?.textContent || ''; };
  ck('a SAVED 82.5 with the day before 77.6 → the note shows when the sheet opens (3j draft: only after a keystroke)', /4\.9 kg more than the day before \(77\.6\)/.test(await sheet({ log: { weight: '82.5' }, yesterdayWeight: 77.6 })));
  ck('the day before not known (another day, or not loaded yet) → no note (nothing carried over)', (await sheet({ log: { weight: '82.5' }, yesterdayWeight: null })) === '');
  ck('the out-of-range warning (30–250 kg) still takes precedence', /looks unusual/.test(await sheet({ log: { weight: '300' }, yesterdayWeight: 77.6, weightWarning: '300 kg looks unusual — are you sure? (Expected 30–250 kg)' })));
  ck('useTodayModel clears a warning when the day changes', /useEffect\(\(\) => \{ setWeightWarning\(''\); \}, \[date\]\)/.test(fs.readFileSync(path.join(SRC, 'hooks/useTodayModel.js'), 'utf8')));

  console.log('\n[7] the notification switch reads the phone\'s permission');
  const perm = (p) => { const d = dom(); const w = d.window; if (p !== undefined) w.Notification = { permission: p }; w.eval(comps); return w.T.pushBlockedOnThisPhone(); };
  ck('denied → blocked; granted / default / no Notification support → not blocked', perm('denied') === true && perm('granted') === false && perm('default') === false && perm(undefined) === false);
  const settingsSrc = fs.readFileSync(path.join(SRC, 'pages/Settings.jsx'), 'utf8');
  // The REAL Settings page in jsdom (QA review of 3j: the switch must follow the permission when the member answers the
  // prompt INSIDE FitLife, not only on the next render).
  {
    const comps2 = await bundle(`
      import { createRoot } from 'react-dom/client';
      import Settings from './pages/Settings';
      import { MemoryRouter } from 'react-router-dom';
      window.mountSettings = () => createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/settings']}><Settings /></MemoryRouter>);`,
      `const reply = async (method, url) => { (window.__apiCalls = window.__apiCalls || []).push(method + ' ' + url); if (/members\\/me\\/notifications/.test(url)) return { data: { push: true, whatsapp: true, sms: false } };
         if (/subscriptions/.test(url)) return { data: [] }; return { data: {} }; };
       export default Object.fromEntries(['get','post','put','patch','delete'].map(m => [m, (u, b) => reply(m, u, b)]));`);
    const d = dom('http://localhost/settings'); const w = d.window;
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    // jsdom has no push support: stand-ins so the real PushStatus offers "Turn on notifications", as a phone browser does.
    Object.defineProperty(w.navigator, 'serviceWorker', { value: { ready: new Promise(() => {}), register: async () => ({}) }, configurable: true });
    w.PushManager = function PushManager() {};
    let answer = 'denied';
    w.Notification = { permission: 'default', requestPermission: async () => { w.Notification.permission = answer; return answer; } };
    w.eval(comps2); w.mountSettings(); await tick(250);
    const sw = () => w.document.querySelector('[data-testid="notif-switch-push"]');
    ck('positive control: permission "default" → the App-notifications switch shows the saved choice (ON) and is usable', sw()?.getAttribute('aria-checked') === 'true' && !sw()?.disabled, sw()?.outerHTML?.slice(0, 160));
    const turnOn = [...w.document.querySelectorAll('button')].find(b => /Turn on notifications/.test(b.textContent));
    turnOn?.click(); await tick(150);
    ck('the member taps "Turn on notifications" and BLOCKS in the prompt → the switch turns OFF, disabled, "Blocked on this device" (3j draft: stayed ON)',
      !!turnOn && sw()?.getAttribute('aria-checked') === 'false' && sw()?.disabled === true && /Blocked on this device/.test(w.document.querySelector('[data-testid="push-blocked-note"]')?.textContent || ''), sw()?.outerHTML?.slice(0, 200));
    ck('…and the switch is described by that note for screen readers', sw()?.getAttribute('aria-describedby') === 'notif-sub-push' && !!w.document.getElementById('notif-sub-push'));
    // QA re-check, the reverse path: the member allows notifications in the phone's settings and comes back to FitLife.
    w.Notification.permission = 'granted';
    Object.defineProperty(w.document, 'visibilityState', { value: 'visible', configurable: true });
    w.document.dispatchEvent(new w.Event('visibilitychange')); await tick(150);
    ck('allowed in the phone\'s settings, back in FitLife → switch ON and usable, and NO "blocked" card under it (3j draft: blocked card stayed)',
      sw()?.getAttribute('aria-checked') === 'true' && sw()?.disabled === false && !/Notifications are blocked/.test(w.document.body.textContent) && !w.document.querySelector('[data-testid="push-blocked-note"]'),
      { checked: sw()?.getAttribute('aria-checked'), blockedCard: /Notifications are blocked/.test(w.document.body.textContent) });
    ck('the real Settings page talked ONLY to the test stand-in (it loaded the notification choices through it); a real HTTP client would throw',
      (w.__apiCalls || []).some(c => /members\/me\/notifications/.test(c)), w.__apiCalls);
  }
  ck('Settings shows the push switch OFF and disabled while blocked, and keeps the saved choice', /const on = !!notif\[key\] && !blocked/.test(settingsSrc) && /aria-checked=\{on\}/.test(settingsSrc) && /disabled=\{notifBusy \|\| blocked\}/.test(settingsSrc));
} catch (e) { ck('the suite ran to the end', false, e.stack); }
finally { srv?.close(); try { await require('../db/pool').end(); } catch {} fs.rmSync(TMP, { recursive: true, force: true }); }
console.log(`\nUX fixes 3j (Phase 1): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
