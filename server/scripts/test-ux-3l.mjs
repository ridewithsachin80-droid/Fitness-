/**
 * scripts/test-ux-3l.mjs — Fixes-3l (18 Nov 2026): Phase 2b of the UX fix plan (claude/FitLife-UX-Fix-Plan-2026-11-05.md).
 * REAL Postgres + the REAL patients route for [1]; the REAL client modules for the rest (bundled with esbuild, mounted in
 * jsdom; any real HTTP client in the bundle throws, so nothing can leave this computer).
 *   [1] 8b: GET /api/patients/me gives the DAY of the current weight;
 *   [2] 8b/14: the day names ("today", "yesterday", "4 Nov") and the span wording ("since 30 Oct" vs "over 30 days");
 *   [3] 6: onboarding shows weights already on the record (read-only, "Set by your coach"), and never sends them again;
 *   [4] 15: the weight sheet has no example number in the box, and says yesterday's weight;
 *   [5] 14: apple cider vinegar written out on member screens; one age picker; plain footer;
 *   [6] 13 + 3k A4: the coach's streak uses the theme's warn colour; a day with no log is marked differently.
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
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-ux-3l-'));
fs.writeFileSync(path.join(TMP, 'no-axios.js'), "const no = () => { throw new Error('test-ux-3l: a real HTTP request was attempted'); }; const ax = { create: () => ax, get: no, post: no, put: no, patch: no, delete: no, request: no, interceptors: { request: { use() {} }, response: { use() {} } }, defaults: { headers: { common: {} } } }; export default ax; export const isAxiosError = () => false;");
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 400))); };
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

async function bundle(contents, apiStub = 'export default { get: async () => ({ data: {} }), post: async () => ({ data: {} }), put: async () => ({ data: {} }) };') {
  const apiFile = path.join(TMP, `api-${Math.random().toString(36).slice(2)}.js`); fs.writeFileSync(apiFile, apiStub);
  const out = await build({ stdin: { resolveDir: SRC, loader: 'jsx', contents }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true}' },
    plugins: [{ name: 'stub-api', setup(b) {
      b.onResolve({ filter: /(?:^|\/)client(\.js)?$/ }, a => (/api\/client(\.js)?$/.test(a.path) || (/^\.\/client(\.js)?$/.test(a.path) && /[\\/]api$/.test(a.resolveDir))) ? { path: apiFile } : null);
      b.onResolve({ filter: /^axios$/ }, () => ({ path: path.join(TMP, 'no-axios.js') }));
    } }], logLevel: 'silent' });
  return out.outputFiles[0].text;
}
const dom = () => { const d = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  d.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }); return d; };

let srv;
try {
  console.log('\n[1] Profile: the day of the current weight (real route, real Postgres)');
  {
    const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
    const pool = require('../db/pool');
    const app = express(); app.use(express.json()); app.use(cookieParser());
    app.use((q, _r, n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
    app.use('/api/patients', require('../routes/patients'));
    srv = app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
    const port = srv.address().port;
    const phone = '6' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    const member = (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ('UX3l Member',$1,'x','patient',true) RETURNING id`, [phone])).rows[0].id;
    try {
      await pool.query(`INSERT INTO patient_profiles (user_id, height_cm, start_weight, target_weight) VALUES ($1,162,79,70)`, [member]);
      const me = async () => (await (await fetch(`http://127.0.0.1:${port}/api/patients/me`, { headers: { Authorization: 'Bearer ' + jwt.sign({ id: member, role: 'patient', name: 'T' }, process.env.JWT_SECRET, { expiresIn: 600 }) } })).json());
      const day = async (n) => (await pool.query(`SELECT to_char(CURRENT_DATE - $1::int, 'YYYY-MM-DD') AS d`, [n])).rows[0].d;
      let r = await me();
      ck('no weight ever logged → no date (nothing invented)', r.current_weight == null && r.current_weight_date == null, [r.current_weight, r.current_weight_date]);
      await pool.query(`INSERT INTO daily_logs (patient_id, log_date, weight_kg) VALUES ($1, CURRENT_DATE - 12, 78.4), ($1, CURRENT_DATE - 9, 77.6)`, [member]);
      await pool.query(`INSERT INTO daily_logs (patient_id, log_date, water_ml) VALUES ($1, CURRENT_DATE, 750)`, [member]);
      r = await me();
      ck(`the date is the day of the weight shown (77.6, 9 days ago: ${await day(9)}), not today's log without one`, Number(r.current_weight) === 77.6 && r.current_weight_date === await day(9), [r.current_weight, r.current_weight_date]);
    } finally { await pool.query(`DELETE FROM users WHERE id=$1`, [member]); }
  }

  console.log('\n[2] day names and spans');
  {
    const w = dom().window;
    w.eval(await bundle(`import { dayLabel, daysBetween, spanLabel } from './utils/dayLabel'; window.T = { dayLabel, daysBetween, spanLabel };`));
    const { dayLabel, daysBetween, spanLabel } = w.T;
    ck('dayLabel: today, yesterday, "4 Nov", other year "28 Dec 2025", rubbish → ""',
      dayLabel('2026-11-18', '2026-11-18') === 'today' && dayLabel('2026-11-17', '2026-11-18') === 'yesterday' && dayLabel('2026-11-04', '2026-11-18') === '4 Nov'
        && dayLabel('2025-12-28', '2026-01-05') === '28 Dec 2025' && dayLabel('2026-11-04T00:00', '2026-11-18') === '' && dayLabel(null, '2026-11-18') === '',
      [dayLabel('2026-11-04', '2026-11-18'), dayLabel('2025-12-28', '2026-01-05')]);
    ck('daysBetween counts calendar days across months and a year end (no time zone involved)', daysBetween('2026-10-30', '2026-11-04') === 5 && daysBetween('2025-12-30', '2026-01-02') === 3 && daysBetween('x', '2026-01-02') === null);
    ck('the review\'s case: a 30-day window with weights only from 30 Oct says "since 30 Oct", not "over 30 days"', spanLabel('2026-10-05', '2026-10-30', '2026-11-04', 30) === 'since 30 Oct', spanLabel('2026-10-05', '2026-10-30', '2026-11-04', 30));
    ck('data from the start of the window (or the next day) → "over 30 days"; one day → "over 1 day"; no data → "over 7 days"',
      spanLabel('2026-10-05', '2026-10-05', '2026-11-04', 30) === 'over 30 days' && spanLabel('2026-10-05', '2026-10-06', '2026-11-04', 30) === 'over 30 days'
        && spanLabel('2026-11-03', '2026-11-03', '2026-11-04', 1) === 'over 1 day' && spanLabel('2026-10-28', undefined, '2026-11-04', 7) === 'over 7 days');
    ck('boundary: the first weight two days into the window → "since <day>" (one day in still counts as the whole window)', spanLabel('2026-10-05', '2026-10-07', '2026-11-04', 30) === 'since 7 Oct', spanLabel('2026-10-05', '2026-10-07', '2026-11-04', 30));
    ck('QA review: the only weight is today\'s → "today", never "since today"; yesterday → "since yesterday"', spanLabel('2026-10-28', '2026-11-04', '2026-11-04', 7) === 'today' && spanLabel('2026-10-28', '2026-11-03', '2026-11-04', 7) === 'since yesterday',
      [spanLabel('2026-10-28', '2026-11-04', '2026-11-04', 7), spanLabel('2026-10-28', '2026-11-03', '2026-11-04', 7)]);
    const prog = read('pages/Progress.jsx');
    ck('Progress uses it for both the weight change and the 30-day checklist average', /deltaLabel = spanLabel\(rangeFrom, firstInRange/.test(prog) && /avg30Span = spanLabel\(from30/.test(prog) && /\{avg30Span\}/.test(prog) && !/<\/strong> over 30 days/.test(prog));
    const prof = read('pages/Profile.jsx');
    ck('Profile shows the day under "Current weight" (only when there is a weight)', /note=\{p\.current_weight != null \? dayLabel\(p\.current_weight_date, today\(\)\) : ''\}/.test(prof) && /data-testid=\{testId\}/.test(prof));
  }

  console.log('\n[3] onboarding: weights already on the record');
  {
    const code = (row, failGet = false, late = false) => bundle(`
      import { createRoot } from 'react-dom/client';
      import { MemoryRouter } from 'react-router-dom';
      import Onboarding from './components/Onboarding.jsx';
      createRoot(document.getElementById('root')).render(<MemoryRouter><Onboarding onDone={() => {}} /></MemoryRouter>);`,
      `window.__puts = []; const put = async (url, body) => { window.__puts.push({ url, body }); return { data: { onboarding_done: true } }; };
       window.__arrived = new Promise(r => { window.__go = r; });
       export default { get: async (url) => { ${failGet ? "throw new Error('offline');" : ''} if (${late} && /onboarding/.test(url)) await window.__arrived; return { data: /onboarding/.test(url) ? ${JSON.stringify(row)} : {} }; }, post: put, put, patch: put, delete: put };`);
    const walk = async (row, failGet, late) => {
      const w = dom().window; w.eval(await code(row, failGet, late)); await tick(120);
      const d = w.document, q = (id) => d.querySelector(`[data-testid="${id}"]`);
      q('onb-modes').querySelectorAll('button')[1].click(); await tick(40); q('onb-next').click(); await tick(60);
      q('goal-lose').click(); await tick(30); q('onb-next').click(); await tick(80);
      return { w, d, q };
    };
    let { d, q, w } = await walk({ onboarding_done: false, start_weight: 79, target_weight: 70 });
    ck('…read out to a screen reader as one item ("Start weight: 79 kg, set by your coach")', /79 kg, set by your coach/.test(q('onb-start-set')?.getAttribute('aria-label') || '') && q('onb-start-set')?.getAttribute('role') === 'group', q('onb-start-set')?.getAttribute('aria-label'));
    ck('coach set both → shown read-only (79 and 70 kg), "Set by your coach", no boxes to type into', q('onb-start-set')?.textContent.includes('79') && q('onb-target-set')?.textContent.includes('70')
      && !q('onb-start') && !q('onb-target') && (d.body.textContent.match(/Set by your coach/g) || []).length === 2 && /Already set/.test(q('onb-weights').parentElement.textContent), d.body.textContent.slice(0, 200));
    q('onb-next').click(); await tick(60); q('onb-send-sample')?.click(); await tick(150);
    let put = w.__puts.find(p => /onboarding/.test(p.url));
    ck('…finishing does not send them again (the server would ignore them anyway)', put && put.body.start_weight === null && put.body.target_weight === null, put && put.body);
    ({ d, q, w } = await walk({ onboarding_done: false, start_weight: 79, target_weight: null }));
    ck('only the start set → start read-only, target still a box; the line says one is set', q('onb-start-set') && !q('onb-start') && q('onb-target') && !q('onb-target-set')
      && /One is already set; the other is optional/.test(q('onb-weights').parentElement.textContent), q('onb-weights')?.parentElement.textContent.slice(0, 160));
    const setVal = (el, v) => { Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); };
    setVal(q('onb-target'), '72'); await tick(40); q('onb-next').click(); await tick(60); q('onb-send-sample')?.click(); await tick(150);
    put = w.__puts.find(p => /onboarding/.test(p.url));
    ck('…the typed target is sent, the start is not', put && put.body.start_weight === null && put.body.target_weight === 72, put && put.body);
    ({ d, q } = await walk({ onboarding_done: true, start_weight: 80, target_weight: 74 }));
    ck('set on an earlier setup (not by the coach) → "Already set", not "Set by your coach"', q('onb-start-set') && /Already set/.test(q('onb-start-set').textContent) && !/Set by your coach/.test(d.body.textContent));
    ({ d, q } = await walk({}, true));
    ck('the record cannot be read (offline) → both boxes, exactly as before', q('onb-start') && q('onb-target') && !q('onb-start-set') && /Both optional/.test(q('onb-weights').parentElement.textContent));
    // QA review of 3l: the record arrives late, after the member has half-typed a start weight ("7" is not a valid weight).
    ({ d, q, w } = await walk({ onboarding_done: false, start_weight: 79, target_weight: null }, false, true));
    ck('late record: before it arrives, both boxes are there', q('onb-start') && q('onb-target') && !q('onb-start-set'));
    setVal(q('onb-start'), '7'); await tick(40);
    ck('…a half-typed "7" blocks Next while it is the member\'s own box', q('onb-next').disabled === true, q('onb-next').disabled);
    w.__go(); await tick(120);
    ck('…the record arrives (start 79 set) → the box becomes read-only and Next works again', q('onb-start-set') && !q('onb-start') && q('onb-next').disabled === false, [!!q('onb-start-set'), q('onb-next')?.disabled]);
    q('onb-next').click(); await tick(60); q('onb-send-sample')?.click(); await tick(150);
    put = w.__puts.find(p => /onboarding/.test(p.url));
    ck('…and the half-typed "7" is not sent (start goes as null)', put && put.body.start_weight === null, put && put.body);
  }

  console.log('\n[4] the weight sheet');
  {
    const w = dom().window;
    w.eval(await bundle(`
      import { createRoot } from 'react-dom/client';
      import WeightSheet from './components/sheets/WeightSheet.jsx';
      let root; window.T = (m) => { root = root || createRoot(document.getElementById('root')); root.render(<WeightSheet open onClose={() => {}} m={m} />); };`));
    const base = { update() {}, weightWarning: '', validateWeight() {}, weightDelta: 0 };
    w.T({ ...base, log: { weight: '' }, yesterdayWeight: 77.6 }); await tick(120);
    const input = w.document.querySelector('[data-testid="weight-input"]');
    ck('no example number in the box (it looked like a weight)', input && input.getAttribute('placeholder') === '' && !/e\.g\. 92\.5/.test(w.document.body.innerHTML), input?.getAttribute('placeholder'));
    ck('…and yesterday\'s weight is said below it', /Yesterday 77\.6 kg/.test(w.document.querySelector('[data-testid="weight-yesterday"]')?.textContent || ''));
    w.T({ ...base, log: { weight: '' }, yesterdayWeight: null }); await tick(80);
    ck('no weight yesterday → no hint (nothing invented)', !w.document.querySelector('[data-testid="weight-yesterday"]'));
    w.T({ ...base, log: { weight: '77.2' }, yesterdayWeight: 77.6 }); await tick(80);
    ck('a weight already typed today → no hint', !w.document.querySelector('[data-testid="weight-yesterday"]'));
    w.T({ ...base, log: { weight: '' }, yesterdayWeight: 77.6, isToday: false }); await tick(80);
    ck('looking at an earlier day → "The day before 77.6 kg", not "Yesterday"', /^The day before 77\.6 kg$/.test(w.document.querySelector('[data-testid="weight-yesterday"]')?.textContent || ''), w.document.querySelector('[data-testid="weight-yesterday"]')?.textContent);
  }

  console.log('\n[5] words on member screens');
  {
    const w = dom().window;
    w.eval(await bundle(`import { pendingLabels } from './lib/day'; import { ACV_ITEMS } from './constants'; window.T = { pendingLabels, ACV_ITEMS };`));
    const p = w.T.pendingLabels({ activeActivities: [], activeACV: w.T.ACV_ITEMS.slice(0, 2), activeSupplements: [], log: {} });
    ck('"Still pending": "2 apple cider vinegar doses", not "ACV"', p.includes('2 apple cider vinegar doses') && !p.some(l => /ACV/.test(l)), p);
    const files = { 'components/AIChatLog.jsx': /apple cider vinegar dose/, 'components/today/ProtocolDots.jsx': /apple cider vinegar and/, 'components/sheets/ProtocolSheet.jsx': /Apple cider vinegar · \{acvDone\}/,
      'pages/Progress.jsx': /🍶 Apple cider vinegar/, 'utils/personalMessage.js': /apple cider vinegar doses are still open/ };
    const missing = Object.entries(files).filter(([f, re]) => !re.test(read(f))).map(([f]) => f);
    ck('written out in the AI reply, the checklist line, the checklist sheet, the day log and the coach\'s message to the member', !missing.length, missing);
    const more = { 'pages/Plan.jsx': /acv: 'Apple cider vinegar'/, 'components/DaySummary.jsx': /<Protocol label="Apple cider vinegar"/, 'components/AIChatLog.jsx': /title="Apple cider vinegar"/ };
    const missing2 = Object.entries(more).filter(([f, re]) => !re.test(read(f))).map(([f]) => f);
    ck('QA review: also on Plan\'s routine note, the day summary and the AI reply\'s group heading', !missing2.length && !/title="ACV"/.test(read('components/AIChatLog.jsx')) && !/label="ACV"/.test(read('components/DaySummary.jsx')), missing2);
    const srvTxt = fs.readFileSync(path.join(ROOT, 'server/services/cronService.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'server/routes/reminders.js'), 'utf8');
    ck('QA review: the reminder notifications say "Apple cider vinegar time!" and "Take your apple cider vinegar now" (and the coach\'s test push)', !/ACV Time!/.test(srvTxt) && (srvTxt.match(/Apple cider vinegar time!/g) || []).length >= 2 && /Take your apple cider vinegar now/.test(srvTxt) && !/Take your ACV now/.test(srvTxt));
    const { mergeOfflineDay } = require('../services/dayMerge');
    const kept = mergeOfflineDay({ acv: { a1: true } }, { acv: { a1: false } }, []).kept_server;
    ck('QA review: the offline-merge notice says "apple cider vinegar" ("Your offline apple cider vinegar was not saved…")', kept.includes('apple cider vinegar') && !kept.includes('ACV'), kept);
    ck('no member sentence says "ACV dose", "Why ACV?" (button), "ACV and" or "🍶 ACV" any more', !/ACV dose/.test(read('components/AIChatLog.jsx') + read('lib/day/pending.js')) && !/'Why ACV\?'/.test(read('components/sheets/ProtocolSheet.jsx'))
      && !/, ACV and/.test(read('components/today/ProtocolDots.jsx')) && !/🍶 ACV</.test(read('pages/Progress.jsx')));
    const set = read('pages/Settings.jsx');
    ck('one age picker: Settings uses onboarding\'s list (no "Child (5–17)"); the footer just says FitLife', /import \{ AGE_MODES \} from '\.\.\/components\/Onboarding'/.test(set) && !/Child \(5–17\)/.test(set) && !/Enhanced UX/.test(set) && /\{m\.sub\}/.test(set)
      && /aria-pressed=\{ageMode === m\.id\}/.test(set) && /data-testid=\{`settings-age-\$\{m\.id\}`\}/.test(set));
    const w2 = dom().window;
    w2.eval(await bundle(`import { AGE_MODES } from './components/Onboarding'; window.T = AGE_MODES;`));
    ck('…and that list is Child · Under 18, Adult · 18–59, Senior · 60+', w2.T.map(m => `${m.label} ${m.sub}`).join('|') === 'Child Under 18|Adult 18–59|Senior 60+', w2.T.map(m => m.label + ' ' + m.sub));
  }

  console.log('\n[5b] tiles at 360 px');
  {
    const css = read('components/member/member.css');
    ck('below 380 px a tile\'s value is 15 px with an 8 px gap (at 360 px "Log weight" and "0.00 / 3.0 L" wrapped; screens measure the fit)', /@media\(max-width:380px\)\{\.member-metric\{gap:8px\}\.member-metric strong\{font-size:15px\}\}/.test(css));
    const big = css.lastIndexOf('[data-fontsize=large] .member-metric strong{font-size:16px}'), anyLarge = css.lastIndexOf('[data-fontsize=large]');
    ck('QA review: with large text (senior mode) the tile value is 16 px below 380 px, and that rule is the last large-text rule so it wins', big > 0 && big >= anyLarge - 40 && /@media\(max-width:380px\)\{\[data-fontsize=large\] \.member-metric strong\{font-size:16px\}\}\s*$/.test(css));
  }

  console.log('\n[6] colours');
  {
    const mon = read('pages/Monitor.jsx');
    ck('coach streak: no leftover amber rgba(251,191,36…); the theme\'s warn colour instead', !/251,\s*191,\s*36/.test(mon) && /d\.pct >= 50 \? 'rgb\(var\(--fit-warn\) \/ 0\.45\)'/.test(mon));
    const prog = read('pages/Progress.jsx');
    ck('calendar: a day with no log has a dashed outline (a logged 0% day has none), and the legend shows it', /pct == null \? 'bg-white\/\[0\.04\] text-lo border border-dashed border-lo'/.test(prog) && /: 'bg-white\/\[0\.06\] text-lo';/.test(prog) && /border-dashed border-lo" \/>Not logged/.test(prog)
      && !/border-white\/\[0\.28\]/.test(prog), 'QA review: the outline uses the theme\'s text-lo colour (white at 28% was too faint on the light theme)');
  }
} catch (e) { ck('the suite ran to the end', false, e.stack); }
finally {
  srv?.close();
  try { await require('../db/pool').end(); } catch {}
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\nUX fixes 3l (Phase 2b): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
