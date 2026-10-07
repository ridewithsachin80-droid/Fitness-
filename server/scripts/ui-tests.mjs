/**
 * scripts/ui-tests.mjs — does the client actually render?
 *
 * Every other suite in this repo tests logic. Nothing tested that the app
 * mounts, or that a card the coach relies on puts the right words on screen.
 * Those failures are invisible to a passing gate and completely visible to
 * whoever opens the app.
 *
 * ── WHY THE BUNDLE STEP EXISTS ──────────────────────────────────────────────
 * jsdom cannot execute ES modules, and Vite emits <script type="module">. A
 * naive boot test pointed at dist/ therefore parses the script tag, silently
 * ignores it, and passes while proving nothing at all. Everything here is
 * bundled to a classic IIFE first so the code genuinely runs.
 *
 * A second version of that same trap: bundling JSX with esbuild's default
 * settings uses the CLASSIC transform, so every component throws "React is not
 * defined" — and the app's own ErrorBoundary catches it and renders a recovery
 * screen. `#root` is populated, no error escapes, and the test goes green while
 * displaying a crash page. Hence `jsx: 'automatic'` below, and an explicit
 * assertion that what mounted is not the ErrorBoundary.
 *
 * Needs jsdom and esbuild, both server devDependencies. build.sh installs the
 * server with --omit=dev, so Railway never installs either.
 *
 *   cd server && npm run test:ui
 */

import { createRequire } from 'module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
// puppeteer-core and @sparticuz/chromium are loaded ON DEMAND, not imported.
//
// They are 78MB together, and this repo has no railway.json or nixpacks.toml —
// so whether the deploy runs build.sh (which installs the server with
// --omit=dev) or its own detected build is not something the code can
// guarantee. 78MB of test-only weight that MIGHT ship on every deploy is not a
// trade worth making for one check, so they are no longer dependencies at all.
//
//   cd server && npm run test:ui:install
//
// installs them without touching package.json.
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import http from 'http';

const HERE       = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(HERE, '../..');
const CLIENT_SRC = path.join(ROOT, 'client', 'src');
// The API stubs below import the real constants.js. This used to be a path
// typed out from one machine, so the suite could only run in that one folder.
const CONSTANTS_JS = path.join(CLIENT_SRC, 'constants.js').replace(/\\/g, '/');

let pass = 0, fail = 0;
const ck = (n, c, d) => c
  ? (pass++, console.log('  \u2713 ' + n))
  : (fail++, console.log('  \u2717 ' + n + ' ' + String(d ?? '').slice(0, 200)));

// ── Shims ────────────────────────────────────────────────────────────────────
const TMP = path.join(os.tmpdir(), 'fitlife-ui-tests');
fs.mkdirSync(TMP, { recursive: true });
const PWA_SHIM = path.join(TMP, 'pwa-register.js');
fs.writeFileSync(PWA_SHIM, 'export function registerSW(){return()=>{}}\n');

/**
 * Bundle a snippet as if it lived in client/src, so `react`, `../api/client`
 * and every relative import resolve exactly the way Vite resolves them.
 * @param {string} contents   entry source
 * @param {string|null} apiStub  module to substitute for '../api/client'
 */
async function bundle(contents, apiStub = null) {
  const plugins = [];
  if (apiStub) {
    plugins.push({
      name: 'stub-api',
      setup(b) {
        // Both spellings. Components import '../api/client', but api/logs.js
        // imports './client' from inside that folder — a filter on 'api/client'
        // alone missed it, so every page reaching the API through api/logs got
        // the REAL axios, fetched the test server's HTML shell, and threw on
        // the first .map. It looked like a render bug for three screens.
        b.onResolve({ filter: /(?:^|\/)client$/ }, (args) =>
          (/api\/client$/.test(args.path) || args.importer.includes(`${path.sep}api${path.sep}`))
            ? { path: apiStub } : null);
      },
    });
  }
  const out = await build({
    stdin: { contents, resolveDir: CLIENT_SRC, loader: 'jsx', sourcefile: 'ui-test-entry.jsx' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
    // CSS is irrelevant to whether the app mounts, and with write:false esbuild
    // has nowhere to emit it. Swallow it rather than configure an output path
    // for a file nothing here reads.
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty',
              '.png': 'empty', '.svg': 'empty', '.jpg': 'empty', '.webp': 'empty' },
    alias: { 'virtual:pwa-register': PWA_SHIM },
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.env': JSON.stringify({
        MODE: 'production', DEV: false, PROD: true, BASE_URL: '/', VITE_VAPID_PUBLIC_KEY: '',
      }),
    },
    plugins,
    logLevel: 'silent',
  });
  return out.outputFiles[0].text;
}

/** Run bundled code in a fresh jsdom and hand back the document plus any errors. */
function run(code, before = null) {
  const errors = [];
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://fitness.upscale-app.com/',
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {},
                          addEventListener() {}, removeEventListener() {} });
  w.scrollTo = () => {};
  w.confirm  = () => true;
  w.fetch    = () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
  w.addEventListener('error', e => errors.push(String(e.message)));
  w.__click = (label) => {
    const b = [...w.document.querySelectorAll('button')]
      .find(x => x.textContent.trim().startsWith(label));
    if (!b) throw new Error('no button starting with: ' + label);
    b.click();
  };
  if (before) before(w);               // set window state before the bundle runs
  try { w.eval(code); } catch (e) { errors.push(e.message); }
  return { w, errors, html: () => w.document.getElementById('root').innerHTML };
}

const tick = (ms = 350) => new Promise(r => setTimeout(r, ms));

function stub(name, source) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, source);
  return p;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The app boots
// ═══════════════════════════════════════════════════════════════════════════
async function bootTest() {
  console.log('\n[1] the client boots');
  const code = await bundle(`import './main.jsx';`);
  const { errors, html } = run(code);
  await tick(600);
  ck('main.jsx bundles and executes', code.length > 1000);
  ck('it mounts something into #root', html().length > 50, `length ${html().length}`);
  ck('what mounted is the app, not the ErrorBoundary recovery screen',
    !/crashed|Something went wrong/i.test(html()), html().slice(0, 160));
  ck('no uncaught error escaped during boot', errors.length === 0, errors.join(' | '));
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. EvalSamples — the AI eval set browser (Sprint L1)
// ═══════════════════════════════════════════════════════════════════════════
async function evalSamplesTest() {
  console.log('\n[2] EvalSamples (Sprint L1)');
  const api = stub('api-evals.js', `
    const samples = [
      { id:1, patient_id:7, source:'member_parse', message:'2 roti aur dal',
        ai_output:{name:'Roti',grams:200}, corrected:{name:'Roti',grams:60},
        field:'grams', dismissed:false, created_at:new Date(Date.now()-3600e3).toISOString(),
        member_name:'Asha' },
      { id:2, patient_id:7, source:'member_parse', message:'ghee wala paratha',
        ai_output:{name:'Ghee',grams:10}, corrected:null,
        field:'food_name', dismissed:false, created_at:new Date().toISOString(), member_name:'Bujju' },
      { id:3, patient_id:9, source:'coach_parse', message:'set water 4L for asha and bujju',
        ai_output:[{member_name:'Asha'},{member_name:'Bujju'}], corrected:[{member_name:'Asha'}],
        field:'ops', dismissed:false, created_at:new Date(Date.now()-2*86400e3).toISOString(),
        member_name:'Sachin' },
    ];
    export default {
      get: async () => ({ data: { samples, counts: { total:3, active:3, replayable:3 } } }),
      patch: async () => ({ data: { id:1, dismissed:true } }),
    };`);

  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import EvalSamples from './components/EvalSamples.jsx';
    createRoot(document.getElementById('root')).render(<EvalSamples />);`, api);

  const { errors, html } = run(code);
  await tick();
  const h = html();
  ck('renders without throwing', errors.length === 0, errors.join('|'));
  ck('shows the live and replayable counts', /3 live/.test(h) && /3 replayable/.test(h));
  ck('lists every sample', (h.match(/Not a real error/g) || []).length === 3);
  ck('shows the member message verbatim', /2 roti aur dal/.test(h));
  ck('shows the wrong answer and the right one', /Roti · 200g/.test(h) && /Roti · 60g/.test(h));
  ck('a null correction renders as a dash, never the word "null"',
    /—/.test(h) && !/>null</.test(h));
  ck('a coach ops sample pluralises', /2 actions/.test(h) && /1 action</.test(h));
  ck('field badges are human labels, not raw column values',
    /Portion/.test(h) && /Invented item/.test(h) && !/>food_name</.test(h));
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. AdminFoods verification queue (Sprint L3)
// ═══════════════════════════════════════════════════════════════════════════
async function foodsQueueTest() {
  console.log('\n[3] AdminFoods verification queue (Sprint L3)');
  const api = stub('api-foods.js', `
    const foods = [
      { id:1, name:'Mystery Ladoo', category:'other', source:'ai', verified:false,
        per_100g:{calories:400,protein:0,total_carbs:0,fat:0}, members:0, times_logged:0,
        macro_check:{status:'suspect',reason:'400 kcal stated but no macros behind it',delta_pct:null} },
      { id:2, name:'Ragi Mudde', category:'grain', source:'ai', verified:false,
        per_100g:{calories:119,protein:3,total_carbs:25,fat:0.5}, members:3, times_logged:7,
        macro_check:{status:'ok',reason:null,delta_pct:3} },
      { id:3, name:'Vitamin D3 (60000 IU)', category:'supplement', source:'ai', verified:false,
        per_100g:{calories:0,protein:0,total_carbs:0,fat:0}, members:1, times_logged:1,
        macro_check:{status:'unknown',reason:'values look per-unit, not per-100g',delta_pct:null} },
    ];
    export default {
      get: async (url) => String(url).includes('/foods/review')
        ? ({ data: { foods, unverified_total:3, flagged_in_page:1, page_size:3 } })
        : ({ data: { foods: [], total:0, page:1, pages:1 } }),
      patch: async () => ({ data: { verified:true } }),
      post: async () => ({ data: {} }), put: async () => ({ data: {} }),
      delete: async () => ({ data: { deleted:true } }),
    };`);

  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import AdminFoods from './pages/AdminFoods.jsx';
    createRoot(document.getElementById('root')).render(
      <MemoryRouter><AdminFoods /></MemoryRouter>);`, api);

  const { w, errors, html } = run(code);
  await tick();
  ck('renders without throwing', errors.length === 0, errors.join('|'));

  w.__click('Show queue'); await tick();
  ck('the queue opens', /Mystery Ladoo/.test(html()));
  ck('one food at a time, not the whole list', !/Ragi Mudde/.test(html()));
  ck('says where you are in the queue', /1 of 3/.test(html()));
  ck('warns when the numbers contradict themselves', /disagree with each other/.test(html()));
  ck('and gives the reason', /no macros behind it/.test(html()));
  ck('offers Verify, Fix and Delete', /Verify/.test(html()) && />Fix</.test(html()) && /Delete/.test(html()));
  ck('says how many on this page look wrong, out of how many',
    /1 of these 3 look wrong/.test(html()));

  w.__click('Skip for now'); await tick();
  ck('Skip advances', /Ragi Mudde/.test(html()) && /2 of 3/.test(html()));
  ck('a consistent food is marked as matching', /Calories match its macros/.test(html()));
  ck('and shows how many members eat it', /3 members/.test(html()));

  w.__click('Skip for now'); await tick();
  ck('a per-unit food says it cannot be cross-checked', /cross-check/.test(html()));
  ck('Skip is spent on the last card', /Last one in the queue/.test(html()));

  w.__click('\u2713 Verify'); await tick();
  ck('verifying the LAST card does not blank the queue',
    /Mystery Ladoo|Ragi Mudde/.test(html()), html().slice(0, 200));
  ck('and the count drops', /of 2/.test(html()));
  ck('still no errors after interacting', errors.length === 0, errors.join('|'));
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. NudgeEffectiveness (Sprint L2) — the refusal must survive to the screen
// ═══════════════════════════════════════════════════════════════════════════
async function nudgeCardTest() {
  console.log('\n[4] NudgeEffectiveness (Sprint L2)');
  const api = stub('api-nudges.js', `
    const data = {
      window_days:90, min_bucket:20, response_window_hours:48,
      overall:{label:'all nudges',sent:27,responded:12,enough_data:true,rate_pct:44,note:null},
      by_gap:[
        {label:'water',sent:24,responded:12,enough_data:true,rate_pct:50,note:null},
        {label:'dormant',sent:3,responded:2,enough_data:false,rate_pct:null,
         note:'only 3 sent so far — need 20 to say anything'},
      ],
      by_hour:[{label:'18:00',sent:24,responded:12,enough_data:true,rate_pct:50,note:null}],
      by_channel:[
        {label:'whatsapp',sent:24,responded:12,enough_data:true,rate_pct:50,note:null},
        {label:'sms',sent:3,responded:2,enough_data:false,rate_pct:null,note:'only 3 sent so far'},
      ],
    };
    export default { get: async () => ({ data }), post: async () => ({ data:{} }) };`);

  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import NudgeEffectiveness from './components/NudgeEffectiveness.jsx';
    createRoot(document.getElementById('root')).render(<NudgeEffectiveness />);`, api);

  const { w, errors, html } = run(code);
  await tick();
  ck('renders without throwing', errors.length === 0, errors.join('|'));
  ck('collapsed by default — no fetch until asked', !/water/.test(html()));

  w.__click('Show'); await tick();
  const h = html();
  ck('opens', /water/.test(h));
  ck('quotes a rate where there is enough data', /50% of 24/.test(h));
  // The whole point of Sprint L2. 2 of 3 must never reach the screen as 67%.
  ck('quotes NO percentage for a thin bucket', !/67%|66%/.test(h) && /too few to say/.test(h));
  ck('but still shows the raw counts — refusing is not hiding', /2\/3/.test(h));
  ck('and draws no bar for it, which would read as a measurement',
    (h.match(/width:/g) || []).length === 3, String((h.match(/width:/g) || []).length));
  ck('states what "followed by a log" does and does not mean',
    /prove the message caused it/.test(h));
  ck('takes the window from the server rather than hardcoding it', /48h of your message/.test(h));
}


/** Enough data for every page to render its real layout, not an empty state. */
const OVERFLOW_API_STUB = `
const members = Array.from({length: 8}, (_, i) => ({
  id: i+1,
  name: ['Subramanya Prasad','Harsha','Asha','Vishwas','Daya','Bujju','Sachin Kumar','Venkataramana Reddy'][i],
  phone: '919000000'+i, active: true, monitor_id: 3, monitor_name: 'Sachin',
  compliance_pct: 40+i*5, last_log: '2026-08-30', weight_kg: 84+i, start_weight: 92,
  target_weight: 75, unread: i%3, days_since_log: i,
}));
const log = { log_date:'2026-09-01', weight_kg:'84.0', water_ml:1500,
  food_items:[{id:1,name:'Ragi Mudde',grams:200,meal:'Lunch',
    per_100g:{calories:119,protein:3,total_carbs:25,fat:0.5}}],
  activities:{walk:true}, acv:{acv1:true}, supplements:{b12:true},
  sleep:{bedtime:'22:30',waketime:'06:30'} };
const ok = (data) => Promise.resolve({ data });
// Phase 1.3: a Studio draft with long food names, a fixed portion, lab
// cautions and a Fit to target preview, so the widest rows are on screen.
const dpItem = (id, name, grams, compulsory) => ({ id, name, grams, qty_text: grams + ' g', compulsory,
  per_100g: { calories: 265, total_carbs: 6 } });
const dpDay = () => [{ meal: 'Meal 1', time: '12:00', items: [
  dpItem(1, 'Homemade low-fat curd', 200, true),
  dpItem(2, 'Paneer-mushroom-capsicum masala with menthya soppu', 1250.5, false) ] }];
const dietDraft = { id: 41, patient_id: 1, version: 2, status: 'draft', title: 'Low carb vegetarian, 16:8',
  targets: { kcal: 1500, protein: 120, carbs: 80, fat: 78 },
  flags: [{ kind:'lab', text:'Fasting Glucose is high: 132 mg/dL', source:'Lab result', date:'2026-09-12', stale:false }],
  content: { avoid: ['sugar'], cautions: ['See your doctor for a BP check before starting the gym.'], adjustments: [],
    lab_cautions: ['Fasting Glucose is high: 132 mg/dL (12 Sep 2026). Keep sweets, fruit juice and maida out, and keep to the carbs in this plan. Review this result with your doctor.'] },
  checks: [{ level:'error', code:'day_over', text:'Over the 1500 kcal target (allowed 1425 to 1575): Mon 2206, Tue 2317, Wed 2277, Thu 2332, Fri 2317, Sat 2297, Sun 2373 kcal. Use Fit to target, or reduce portions.' }],
  days: [dpDay(), dpDay(), dpDay(), dpDay(), dpDay(), dpDay(), dpDay()], diff: null, compared_to_version: null };
const dietFit = { ok: true, range: { lo: 1425, hi: 1575, carb_cap: 84 },
  unfit: [{ weekday: 6, reason: 'Carbs still come to 112 g (limit 84 g) with the carb foods at their smallest sensible portion. Most of it is Paneer-mushroom-capsicum masala with menthya soppu and Jowar roti: remove or swap one.' }],
  changes: [{ meal: 'Meal 1', name: 'Paneer-mushroom-capsicum masala with menthya soppu', from: 1250.5, to: 505, weekdays: [0,1,2,3,4,5] }],
  totals: [0,1,2,3,4,5,6].map(w => ({ weekday: w, before: { kcal: 2206, carbs: 163 }, after: { kcal: 1498, carbs: 79 }, fits: w !== 6 })) };
// Phase 3: a plate check with long names, every status and two extras.
const plateCheck = { photo_id: 1, meal: 'Pre-workout evening snack', time: '23:59', matches: true, photo_saved: true, photo_url: null,
  planned: [
    { name: 'Paneer-mushroom-capsicum masala with menthya soppu', planned_grams: 1250.5, grams: 900, status: 'less', per_100g: { calories: 265 }, kcal: 2385 },
    { name: 'Curd', planned_grams: 200, grams: 200, status: 'not_seen', per_100g: { calories: 60 }, kcal: 120 } ],
  extras: [{ name: 'Masala peanuts with sev and a squeeze of lemon', grams: 45, per_100g: { calories: 560 }, kcal: 252 },
           { name: 'Gulab jamun', grams: 80, per_100g: { calories: 380 }, kcal: 304 }] };
export default {
  get: async (url) => {
    const u = String(url);
    if (u.includes('/voice-pilot/me')) return ok({ invited: true, consented: true, phrases: [
      { id: 'k19', say: 'Ondu bowl kosambari mattu bisi bele bath', means: 'A bowl of kosambari and bisi bele bath', recorded: true, heard: 'Ondu bowl kosambari mattu bisi bele bath, swalpa majjige kooda kudide nenne raatri ele gante aada mele' },
      { id: 'f01', say: 'Your own words: what did you eat yesterday?', means: 'Say it the way you would tell a friend', free: true, recorded: false }] });
    if (u.includes('/voice-pilot/members')) return ok({ members: [{ patient_id: 1, name: 'Mrs. Venkataramana Reddy Lakshmi', consented_at: 'x', recorded: 18 }], phrases: 22 });
    if (u.includes('/voice-pilot/results')) return ok({ overall: { gemini: 84, whisper: 71, samples: 120 },
      phrases: [{ id: 'k19', say: 'Ondu bowl kosambari mattu bisi bele bath', samples: 6, gemini: 92, whisper: 58 }], samples: [] });
    if (u.includes('/weekly/brief/')) return ok({ questions: [{ key: 'stress', label: 'Stress' }, { key: 'plan', label: 'Sticking to the plan' }],
      brief: { week_end: '2026-10-04', source: 'ai', text: 'Mrs. Venkataramana Reddy logged 5 of 7 days and averaged 1,400 kcal against 1,500; weight down 0.8 kg. Stress was high around a family wedding.\\nTry: ask how the week ahead looks; check protein on wedding days; send the plan PDF again.',
        facts: { week_start: '2026-09-28', week_end: '2026-10-04', days_logged: 5, avg_kcal: 1400, weight_change: -0.8, workout_days: 2,
                 checkin: { answers: { stress: 5, plan: 4 }, note: 'Wedding at home all week, ate out twice and could not track lunch properly at the function hall' } } } });
    if (u.includes('/swaps/member/')) return ok({ swaps: [
      { id: 1, food_name: 'Paneer-mushroom-capsicum masala with menthya soppu', alt_name: 'Soya chunk and capsicum curry with methi', alt_per_100g: { calories: 170 }, status: 'requested', source: 'member', note: 'I do not get paneer here every day, can I have soya instead please?' },
      { id: 2, food_name: 'Curd', alt_name: 'Unsweetened soy yogurt', alt_per_100g: { calories: 54 }, status: 'suggested', source: 'ai' },
      { id: 3, food_name: 'Guava', alt_name: 'Banana', alt_per_100g: { calories: 89 }, status: 'approved', source: 'ai' }] });
    if (u.includes('/diet-plans/me/grocery')) return ok({ plan: { id: 9, version: 2, title: 'Low carb vegetarian with intermittent fasting, 16:8' },
      items: [{ name: 'Paneer-mushroom-capsicum masala with menthya soppu', grams: 8753.5, days: 7 }, { name: 'Curd', grams: 1400, days: 7 }],
      prep: { everyday: ['Curd (Meal 1)'], byDay: [['Paneer-mushroom-capsicum masala with menthya soppu, 1250.5 g (Pre-workout evening snack)'], [], [], [], [], [], []] } });
    if (u.includes('/progress-photos/')) return ok({ week: '2026-10-04', weeks: [
      { week: '2026-10-04', photos: { front: { id: 9, url: null }, side: { id: 10, url: null } } },
      { week: '2026-09-06', photos: { front: { id: 1, url: null }, back: { id: 3, url: null } } }] });
    if (u.includes('/plate/off-plan')) return ok({ items: [{ id: 5, member_id: 1, name: 'Mrs. Venkataramana Reddy Lakshmi', phone: '9876543210', meal: 'Pre-workout evening snack', outcome: 'extra',
      extras: [{ name: 'Masala peanuts with sev and a squeeze of lemon', grams: 45, kcal: 252 }, { name: 'Gulab jamun', grams: 80, kcal: 304 }], extras_kcal: 556,
      differences: ['less Paneer-mushroom-capsicum masala with menthya soppu (900 g of 1250.5 g)', 'Curd skipped'], at: '2026-10-05T10:42:00Z', day_kcal: 12971, target_kcal: 1500, photo_url: null }] });
    if (u.includes('/diet-plans/member/')) return ok({ today: '2026-10-03', in_force: null, upcoming: null, draft: dietDraft, history: [] });
    if (u.includes('/gaps/effectiveness')) return ok({ window_days:90, min_bucket:20,
      response_window_hours:48,
      overall:{label:'all',sent:27,responded:12,enough_data:true,rate_pct:44},
      by_gap:[{label:'water',sent:24,responded:12,enough_data:true,rate_pct:50},
              {label:'dormant',sent:3,responded:2,enough_data:false,rate_pct:null,
               note:'only 3 sent so far'}],
      by_hour:[{label:'18:00',sent:24,responded:12,enough_data:true,rate_pct:50}],
      by_channel:[{label:'whatsapp',sent:24,responded:12,enough_data:true,rate_pct:50}] });
    if (u.includes('/gaps')) return ok({ members: [
      // Dormant only — no chips once the count is lifted into the numeral.
      { member_id:1, name:'Asha', phone:'9190001', days_since_log:95,
        gaps:[{key:'dormant',label:'95 days no log',severity:'blocking'}], show:1 },
      // Never logged — a sentinel, so words rather than a number.
      { member_id:2, name:'Avinash', phone:'9190002', days_since_log:9999,
        gaps:[{key:'dormant',label:'Never logged',severity:'blocking'}], show:1 },
      // Logged today but several things outstanding — chips wrap to two lines.
      { member_id:3, name:'Subramanya Prasad', phone:'9190003', days_since_log:0,
        gaps:[{key:'dinner',label:'Dinner not logged',severity:'medium'},
              {key:'water',label:'Water well under target',severity:'medium'},
              {key:'activity',label:'No activity ticked',severity:'medium'},
              {key:'acv',label:'ACV doses missed',severity:'low'},
              {key:'supplements',label:'Supplements not ticked',severity:'low'}], show:2 },
    ],
      clear:3, next_check:{hour:20,label:'8pm',
      covers:['acv doses missed','supplements not ticked']} });
    if (u.includes('/eval-samples')) return ok({ samples:[{ id:1, patient_id:1,
      source:'member_parse', message:'2 roti aur ek katori dal with ghee',
      ai_output:{name:'Roti',grams:200}, corrected:{name:'Roti',grams:60}, field:'grams',
      dismissed:false, created_at:new Date().toISOString(),
      member_name:'Subramanya Prasad' }],
      counts:{total:1,active:1,replayable:1,controls:0} });
    if (u.includes('/foods/review')) return ok({ foods:[{ id:1,
      name:'Ragi Mudde with Bassaru', category:'grain', source:'ai', verified:false,
      per_100g:{calories:119,protein:3,total_carbs:25,fat:0.5}, members:3, times_logged:7,
      macro_check:{status:'suspect',reason:'400 kcal stated but no macros behind it',
      delta_pct:62} }], unverified_total:1, flagged_in_page:1, page_size:1 });
    if (u.includes('/foods/admin/list')) return ok({ foods:[{id:1,name:'Ragi Mudde',
      category:'grain',source:'nin',verified:true,kcal_per_100g:'119'}],
      total:1, page:1, pages:1 });
    if (u.includes('/admin/overview')) return ok({ stats:{total_members:8,logged_today:5,
      avg_compliance_7d:72,total_weight_lost_kg:31.4,coaches:2},
      alerts:members.slice(0,4).map(m=>({...m, reason:'no log in '+m.days_since_log+' days'})),
      messages:[], today_detail:members.slice(0,4), compliance_7d:members.slice(0,4) });
    if (u.includes('/admin/stats')) return ok({ total_members:8, coaches:2, monitors:2, active:7 });
    if (u.includes('/admin/members')) return ok(members);
    if (u.includes('/admin/coaches') || u.includes('/admin/monitors'))
      return ok([{id:3,name:'Sachin',phone:'919111111',active:true,member_count:8}]);
    if (u.includes('/admin/audit')) return ok([{id:1,actor_name:'Sachin',actor_role:'monitor',
      action:'coach_ai_update',target_name:'Asha',
      detail:'Set water target to 4000 ml for Asha',created_at:new Date().toISOString()}]);
    // Ordering matters: '/members/me/logs' contains BOTH '/members' and
    // '/logs'. Matching '/members' first handed a page expecting log rows an
    // array of members, and it threw on the first .map. Specific paths first.
    if (u.includes('/logs')) return ok([log]);
    if (u.includes('push') || u.includes('subscription')) return ok([]);
    if (u.includes('/me/today')) return ok({ log,
      // Phase 2: prescribed meals with times and long names, plus the approved
      // plan, so the Next up card and Plan > Nutrition are on screen.
      meal_plan: { date: '2026-10-04', meals: [
        { meal: 'Pre-workout evening snack', time: '23:59', items: [
          { name: 'Paneer-mushroom-capsicum masala with menthya soppu', grams: 1250.5, qty_text: '2 large katoris, heaped', per_100g: { calories: 265 } },
          { name: 'Curd', grams: 200, qty_text: '1 katori', per_100g: { calories: 60 } } ] },
        { meal: 'Late dinner', time: null, items: [{ name: 'Jowar roti', grams: 40, qty_text: '1 roti', per_100g: { calories: 260 } }] } ] },
      diet_plan: { id: 9, version: 12, title: 'Low carb vegetarian with intermittent fasting, 16:8', effective_from: '2026-10-03',
        targets: { kcal: 1500, protein: 120, carbs: 80, fat: 78 },
        content: { eating_window: '12:00-20:00', timetable: [{ time: '05:30', what: 'Wake, 500 ml warm water with a pinch of salt and lemon' }],
          avoid: ['sugar', 'maida', 'fried snacks', 'bakery items', 'fruit juice'], cautions: ['See your doctor for a BP check before starting the gym.'],
          lab_cautions: ['Fasting Glucose is high: 132 mg/dL (12 Sep 2026). Keep sweets, fruit juice and maida out, and keep to the carbs in this plan. Review this result with your doctor.'] },
        days: [0,1,2,3,4,5,6].map(() => [{ meal: 'Pre-workout evening snack', time: '23:59', items: [
          { name: 'Paneer-mushroom-capsicum masala with menthya soppu', grams: 1250.5, qty_text: '2 large katoris, heaped', per_100g: { calories: 265 } } ] }]) },
      protocol:{macros:{kcal:1800,protein:120},water_target:3000,
      meal_slots:['Breakfast','Lunch','Snack','Dinner']},
      program:null, workoutSummary:{sets:[],cardio:[]}, mealPlans:[], notifications:[] });
    // A single member's detail page, not the roster. Same prefix, different
    // shape — the roster array reached a screen expecting { member, logs, … }.
    const seg = u.split('?')[0].split('/').filter(Boolean);
    const isDetail = (u.includes('/members/') || u.includes('/patients/'))
      && seg.length && String(Number(seg[seg.length - 1])) === seg[seg.length - 1];
    if (isDetail) return ok({
      member: members[0], profile: { water_target: 3000, macros: { kcal: 1800, protein: 120 },
        meal_slots: ['Breakfast','Lunch','Snack','Dinner'], start_weight: 92, target_weight: 75,
        height_cm: 172, protocol_activities: [], protocol_acv: [], protocol_supplements: [] },
      logs: [log], labs: [], notes: [], program: null, days: [],
      sessions: [], mealPlans: [], trial: null, adherence: null,
    });
    if (u.includes('/members') || u.includes('/patients')) return ok(members);
    return ok([]);
  },
  post: async (url) => (String(url).includes('/fit') ? ok({ applied: false, fit: dietFit })
    : String(url).includes('/plate/check') ? ok(plateCheck) : ok({})), put: async () => ok({}),
  patch: async () => ok({}), delete: async () => ok({}),
};
`;

// ═══════════════════════════════════════════════════════════════════════════
// 5. Horizontal overflow — real layout, real browser
// ═══════════════════════════════════════════════════════════════════════════
/**
 * jsdom computes no layout, so nothing above can see a page scrolling sideways.
 * This renders each page in headless Chrome at 320/360/390px and fails if the
 * document is wider than the viewport.
 *
 * The browser binary ships INSIDE @sparticuz/chromium rather than being
 * downloaded on first run — the reason this check sat unwritten for weeks was
 * that Chrome's CDN is not reachable from every environment, and a test that
 * cannot start is a test nobody runs.
 *
 * On failure it names the DEEPEST offending elements. A wide child makes every
 * ancestor wide too, and listing all of them buries the one line to fix.
 */
const WIDTHS = [320, 360, 390];

const OVERFLOW_PAGES = [
  ['PatientList',    "import P from './pages/PatientList.jsx';"],
  ['AdminDashboard', "import P from './pages/AdminDashboard.jsx';"],
  ['AdminFoods',     "import P from './pages/AdminFoods.jsx';"],
  ['Monitor',        "import P from './pages/Monitor.jsx';"],
  ['Settings',       "import P from './pages/Settings.jsx';"],
  ['Progress',       "import P from './pages/Progress.jsx';"],
  ['Plan',           "import P from './pages/Plan.jsx';"],
  ['DailyLog',       "import P from './pages/DailyLog.jsx';"],
  // Phase 2: Plan > Nutrition with an approved plan (the Plan entry above only
  // shows the Today view), and the Log as planned sheet open over Next up.
  ['Plan+Nutrition', `import Pl from './pages/Plan.jsx';
     const P = () => { setTimeout(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Nutrition')?.click(), 300); return <Pl />; };`],
  ['NextUp+Sheet', `import NU from './components/today/NextUp.jsx'; import LS from './components/sheets/LogPlannedSheet.jsx';
     import { planMeals } from './lib/day';
     const mp = [{ meal: 'Pre-workout evening snack', time: '23:59', items: [
       { name: 'Paneer-mushroom-capsicum masala with menthya soppu', grams: 1250.5, qty_text: '2 large katoris, heaped', per_100g: { calories: 265 } },
       { name: 'Curd', grams: 200, qty_text: '1 katori', per_100g: { calories: 60 } } ] }];
     const P = () => (<div className="p-4"><NU mealPlans={mp} food={[]} terms={{ kcal: 'kcal' }} onLog={() => {}} onOther={() => {}} />
       <LS meal={planMeals({ mealPlans: mp, food: [], nowMin: 0 }).next} onClose={() => {}} m={{ log: { food: [] }, terms: { kcal: 'kcal' }, update: () => {} }} /></div>);`],
  // Phase 3: the plate result sheet (real canvas downscale in Chrome) and the
  // coach's Off plan today tab, both with the longest names.
  ['PlateSheet', `import PS from './components/sheets/PlatePhotoSheet.jsx';
     const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
     const job = { meal: { meal: 'Pre-workout evening snack', time: '23:59' }, file: new File([png], 'p.png', { type: 'image/png' }), at: 1 };
     // The sheet renders in a portal, so give the root something of its own.
     const P = () => <div className="p-4"><p>Today</p><PS job={job} onClose={() => {}} onRetake={() => {}} m={{ log: { food: [] }, terms: { kcal: 'kcal' }, update: () => {} }} /></div>;`],
  ['OffPlanTab', `import TF from './components/coach/TriageFeed.jsx';
     const P = () => { setTimeout(() => document.querySelector('[data-testid="triage-tab-offplan"]')?.click(), 400); return <div className="p-4"><TF /></div>; };`],
  // Phase 4: the progress photo sheet and the two-week compare.
  ['ProgressSheet', `import PS from './components/progress/ProgressPhotoSheet.jsx';
     const P = () => <div className="p-4"><p>Today</p><PS open onClose={() => {}} /></div>;`],
  ['ProgressCompare', `import PC from './components/progress/ProgressPhotos.jsx';
     const P = () => <div className="p-4"><PC /></div>;`],
  // Phase 5: the grocery list sheet.
  ['GrocerySheet', `import GS from './components/plan/GrocerySheet.jsx';
     const P = () => <div className="p-4"><p>Plan</p><GS open onClose={() => {}} /></div>;`],
  // Phase 6: the coach's swaps panel with long names.
  ['SwapsPanel', `import SP from './components/coach/SwapsPanel.jsx';
     const P = () => <div className="p-4"><SP memberId={1} memberName="Mrs. Venkataramana Reddy" /></div>;`],
  // Phase 7: the check-in sheet and the coach's weekly brief.
  ['CheckinSheet', `import CS from './components/checkin/CheckinSheet.jsx';
     const Q = [['energy','Energy','Drained','Great'],['hunger','Hunger','Starving','Never hungry'],['sleep','Sleep','Poor','Deep'],['stress','Stress','Calm','Very high'],['plan','Sticking to the plan','Struggled','Easy']].map(([key,label,low,high]) => ({ key, label, low, high }));
     const P = () => <div className="p-4"><p>Today</p><CS open onClose={() => {}} data={{ questions: Q, checkin: null }} /></div>;`],
  ['WeeklyBrief', `import WB from './components/coach/WeeklyBrief.jsx';
     const P = () => <div className="p-4"><WB memberId={1} /></div>;`],
  // Phase 8: the voice pilot sheet and the coach's results panel.
  ['VoicePilotSheet', `import VS from './components/voicepilot/VoicePilotSheet.jsx';
     const P = () => <div className="p-4"><p>Today</p><VS open onClose={() => {}} /></div>;`],
  ['VoicePilotPanel', `import VP from './components/voicepilot/VoicePilotPanel.jsx';
     const P = () => <div className="p-4"><VP /></div>;`],
  // The Studio with a draft open and the Fit to target preview showing: the
  // item row gained a third control in Phase 1.3 and is the tightest row here.
  ['DietStudio+Fit', `import S from './components/coach/DietPlanStudio.jsx';
     const P = () => { setTimeout(() => document.querySelector('[data-testid="plan-fit"]')?.click(), 250);
       return <div className="p-4"><S memberId={1} memberName="Mrs. Venkataramana Reddy" /></div>; };`],
];

// ═══════════════════════════════════════════════════════════════════════════
// 5. The primitive kit (Sprint 0) — every building block mounts and behaves
// ═══════════════════════════════════════════════════════════════════════════
async function primitivesTest() {
  console.log('\n[5] primitive kit — components/primitives');
  const code = await bundle(`
    import { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { Icon, ICON_NAMES, Eyebrow, Pressable, HeroNumber, Segmented, Sheet, Stagger, EmptyState, Skeleton, SkeletonText, SkeletonCard } from './components/primitives/index.js';
    // The same names must also be reachable through the legacy barrel.
    import { Sheet as SheetViaUI, HeroNumber as HeroViaUI } from './components/UI.jsx';
    window.__sameExports = SheetViaUI === Sheet && HeroViaUI === HeroNumber;
    window.__iconCount = ICON_NAMES.length;

    function Kit() {
      const [tab, setTab] = useState('7');
      const [open, setOpen] = useState(false);
      const [w, setW] = useState(82.4);
      window.__setWeight = setW;
      return (
        <div>
          <Eyebrow tone="gold">Eyebrow text</Eyebrow>
          <HeroNumber value={w} unit="kg" delta={-0.3} label="vs yesterday" />
          <HeroNumber value={1240} of={1800} unit="kcal" size="md" />
          <HeroNumber value="—" unit="kg" placeholder />
          <Segmented value={tab} onChange={setTab} options={[{ id: '7', label: 'Seven' }, { id: '30', label: 'Thirty' }, { id: '90', label: 'Ninety', count: 3 }]} />
          <span id="tab">{tab}</span>
          <Pressable variant="primary" onPress={() => setOpen(true)}>Open sheet</Pressable>
          <Pressable variant="primary" disabled onPress={() => { window.__disabledFired = true; }}>Disabled one</Pressable>
          <Sheet open={open} onClose={() => setOpen(false)} eyebrow="Morning" title="Weight sheet" footer={<Pressable variant="gold-text" onPress={() => setOpen(false)}>Done</Pressable>}>
            <input id="sheet-input" placeholder="kg" />
          </Sheet>
          <Stagger className="rows">{['a','b','c'].map(k => <div key={k} className="row">{k}</div>)}</Stagger>
          <EmptyState icon="food" title="Nothing logged yet" body="Tell me about breakfast." action={{ label: 'Log with AI', onPress: () => { window.__emptyAction = true; } }} />
          <SkeletonText lines={4} /><SkeletonCard /><Skeleton className="h-4" />
          <div id="icons">{ICON_NAMES.map(n => <Icon key={n} name={n} />)}</div>
          <div id="badicon"><Icon name="no-such-icon" /></div>
        </div>
      );
    }
    createRoot(document.getElementById('root')).render(<Kit />);`);

  const { w, errors, html } = run(code);
  await tick();
  const d = w.document;
  let h = html();
  ck('the kit mounts without throwing', errors.length === 0, errors.join('|'));
  ck('components/UI.jsx re-exports the same components (one implementation)', w.__sameExports === true);
  ck('Eyebrow renders uppercase-tracked label text', /Eyebrow text/.test(h) && /uppercase/.test(h));
  ck('HeroNumber shows the value, unit and delta', /82\.4/.test(h) && />kg</.test(h) && /↓ 0\.3/.test(h) && /vs yesterday/.test(h));
  ck('HeroNumber "of" renders 1,240 / 1,800', /1,240/.test(h) && /\/ 1,800/.test(h));
  ck('HeroNumber placeholder renders the dash in the quiet colour', /text-lo[^"]*text-\[44px\]|text-\[44px\][^"]*text-lo/.test(h) && /—/.test(h));

  // count-up: after a value change the number ends on the new value
  w.__setWeight(81.9);
  await tick(900);
  h = html();
  ck('HeroNumber settles on the new value after a change (count-up finished)', /81\.9/.test(h) && !/82\.4/.test(h), h.match(/8[12]\.\d/g));

  const tabs = [...d.querySelectorAll('[role=tab]')];
  ck('Segmented renders one tab per option with aria-selected on the active one',
     tabs.length === 3 && tabs[0].getAttribute('aria-selected') === 'true');
  ck('Segmented shows an option count badge', /Ninety/.test(h) && />3</.test(h));
  tabs[1].click(); await tick(100);
  ck('tapping a tab changes the value and moves aria-selected',
     d.getElementById('tab').textContent === '30' && tabs[1].getAttribute('aria-selected') === 'true');
  tabs[1].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await tick(100);
  ck('arrow keys move the selection', d.getElementById('tab').textContent === '90');

  ck('sheet is not in the DOM while closed', !d.querySelector('[role=dialog]'));
  w.__click('Open sheet'); await tick(200);
  const dialog = d.querySelector('[role=dialog]');
  ck('opening the sheet portals a dialog to body with its title and eyebrow',
     !!dialog && dialog.parentElement.parentElement === d.body && /Weight sheet/.test(dialog.innerHTML) && /Morning/.test(dialog.innerHTML));
  ck('sheet locks page scroll while open', d.body.style.overflow === 'hidden');
  ck('sheet moves focus inside itself (first input)', d.activeElement && d.activeElement.id === 'sheet-input', d.activeElement && d.activeElement.id);
  ck('sheet has a footer', /Done/.test(dialog.innerHTML));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(500);
  ck('Escape closes the sheet and unlocks scroll', !d.querySelector('[role=dialog]') && d.body.style.overflow === '');
  w.__click('Open sheet'); await tick(200);
  d.querySelector('[data-sheet-close]').click(); await tick(500);
  ck('the close button closes it too', !d.querySelector('[role=dialog]'));

  ck('Stagger wraps each child (3 rows → 3 wrappers)', d.querySelectorAll('.rows > div').length === 3 && d.querySelectorAll('.row').length === 3);
  ck('EmptyState renders title, body and the action', /Nothing logged yet/.test(h) && /Tell me about breakfast/.test(h) && /Log with AI/.test(h));
  w.__click('Log with AI'); ck('EmptyState action fires', w.__emptyAction === true);
  w.__click('Disabled one'); ck('a disabled Pressable does not fire', w.__disabledFired !== true);
  ck('SkeletonText draws the requested number of lines', d.querySelectorAll('.animate-pulse').length >= 4 + 4 + 1);
  ck('every icon in ICON_NAMES renders an svg', d.querySelectorAll('#icons svg').length === w.__iconCount && w.__iconCount >= 40, [d.querySelectorAll('#icons svg').length, w.__iconCount]);
  ck('an unknown icon name renders nothing (no empty square)', d.getElementById('badicon').children.length === 0);
  ck('no console-visible error from any primitive', errors.length === 0, errors.join('|'));
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Today — the member home (Sprint 3)
// ═══════════════════════════════════════════════════════════════════════════
//
// Mounts the REAL pages/Today.jsx (via pages/DailyLog.jsx, the route App.jsx
// uses) with the API stubbed at the axios boundary. Every request the page
// tree makes is routed here; anything unexpected returns {} and is recorded so
// a new fetch cannot silently pass as "worked".
//
// Dates: constants.today() is IST-anchored, so the stub computes the same
// string with the same helper rather than assuming UTC.
const TODAY_API_STUB = `
    import { today, istDaysAgo } from '${CONSTANTS_JS}';
    const T = today(), Y = istDaysAgo(1);
    window.__calls = []; window.__posts = []; window.__todayStr = T;
    const log = {
      weight_kg: '82.4',
      activities: { walk: false, sun: true },
      acv: { acv1: true },
      supplements: { b12: false, d3: true },
      food_items: [
        { id: 1, name: 'Idli', grams: 120, meal: 'Breakfast', per_100g: { calories: 130, protein: 3.5, total_carbs: 28, fat: 0.8, vit_b12: 0.1, calcium: 12, iron: 1.1, fiber: 1.2 } },
        { id: 2, name: 'Sambar', grams: 200, meal: 'Breakfast', per_100g: { calories: 60, protein: 2.8, total_carbs: 9, fat: 1.5, vit_a: 120, vit_c: 8, calcium: 30 } },
        { id: 3, name: 'Paneer bhurji', grams: 150, meal: 'Lunch', per_100g: { calories: 260, protein: 18, total_carbs: 5, fat: 20 } },
      ],
      water_ml: 1500,
      sleep: { bedtime: '22:30', waketime: '06:15' },
      notes: '',
      protocol: {
        activities: ['walk', 'sun'], acv: ['acv1'], supplements: ['b12', 'd3'],
        item_overrides: { sun: { label: 'Morning sun', sub: '15 min before 9am' } },
        macros: { kcal: 1800, pro: 120, carb: 150, fat: 60 },
        water_target: 3000,
        start_weight: 88,
        meal_plan: [],
      },
    };
    const routes = [
      [new RegExp('^/logs/' + T + '$'),           () => log],
      [new RegExp('^/logs/' + Y + '$'),           () => ({ weight_kg: '82.7' })],
      [/^\\/logs\\/range\\//,                      () => [{ log_date: T }, { log_date: Y }, { log_date: istDaysAgo(2) }]],
      [/^\\/members\\/me\\/today$/,                () => ({ meal_plan: { meals: [{ meal: 'Dinner', items: [{ name: 'Dal', grams: 200, per_100g: { calories: 110 } }, { name: 'Rice', grams: 150, per_100g: { calories: 130 } }] }] },
                                                          program: { program: { name: 'Foundation' }, days: [{ day_label: 'Push · ' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(T + 'T12:00:00').getDay()], exercises: [{ exercise_name: 'Bench press' }, { exercise_name: 'Shoulder press' }] }] } })],
      [/^\\/members\\/me\\/read$/,                   () => (window.__readPayload ?? { date: T, read: null })],
      [/^\\/members\\/me$/,                        () => ({ height_cm: '172', gender: 'male', dob: '1985-03-10', member_since: istDaysAgo(37) + 'T09:00:00.000Z', coach_notes: [{ id: 41, note: 'Great week — add a walk after dinner.', note_date: T, monitor_name: 'Sachin', read_at: null, flagged: false }] })],
      [/^\\/workouts$/,                            () => ({ exercises: [], session: null, cardio: [] })],
      [/^\\/workouts\\/summary$/,                  () => ({ sessions: [] })],
    ];
    const get = async (url, opts) => {
      window.__calls.push(url);
      const hit = routes.find(([re]) => re.test(url));
      return { data: hit ? hit[1](opts) : {} };
    };
    const post = async (url, body) => {
      window.__posts.push({ url, body });
      if (url === '/ai-chat/parse') {
        // What the server's parser returns for "drank 500ml water, took b12, weight 82.0"
        return { data: { reply: 'Got it — water, B12 and your weight.', weight_kg: 82.0, water_ml_add: 500,
          supplements: [{ id: 'b12', label: 'B12' }], activities: [], acv: [], foods: [], corrections: [], workouts: [] } };
      }
      return { data: { ok: true, ...(body || {}) } };
    };
    export default { get, post, put: post, patch: post, delete: async () => ({ data: {} }) };`;

async function todayTest() {
  console.log('\n[6] Today — member home (Sprint 3)');
  const api = stub('api-today.js', TODAY_API_STUB);

  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import DailyLog from './pages/DailyLog.jsx';
    import { useAuthStore } from './store/authStore.js';
    import { useLogStore } from './store/logStore.js';
    import { useAIChat } from './components/AIChatLog.jsx';
    useAuthStore.setState({ user: { id: 214, name: 'Asha Rao', role: 'patient' }, isRestoring: false });
    window.__logStore = useLogStore; window.__aiChat = useAIChat;
    createRoot(document.getElementById('root')).render(<MemoryRouter><DailyLog /></MemoryRouter>);`, api);

  const { w, errors, html } = run(code);
  await tick(900);
  const d = w.document;
  const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  let h = html();

  ck('Today mounts through the DailyLog route without throwing', errors.length === 0, errors.join('|'));
  ck('greeting names the member (first name only)', /Good (morning|afternoon|evening), Asha/.test(h) && !/Asha Rao/.test(h));
  ck('the hero number is today\'s weight, in kg, with the delta vs yesterday',
     q('hero-weight') && /82\.4/.test(q('hero-weight').textContent) && /↓ 0\.3/.test(q('hero-weight').textContent), q('hero-weight')?.textContent);
  ck('Today\'s read is present and mentions the day (tap opens the AI chat)', !!q('ai-read') && q('ai-read').textContent.length > 30);
  // Sprint 10: with no cached read the LOCAL read stands in, so Today is never blank.
  ck('with /members/me/read empty, the locally computed read is shown', w.__calls.some(u => /me\/read/.test(u)) && !/Good morning, Asha\. Yesterday/.test(q('ai-read').textContent), q('ai-read').textContent.slice(0, 80));
  // ── Sprint 5b: Today's Plan replaces coach card + tiles + deficit chip + dots card
  const plan = q('todays-plan');
  ck('Today\'s Plan renders one section with Move, Eat and Recover rows', !!plan && ['plan-move', 'plan-eat', 'plan-recover'].every(id => plan.querySelector(`[data-testid="${id}"]`)));
  ck('the old cards are gone: no day strip, no coach card, no deficit chip, no dots card', !q('day-strip') && !q('coach-card') && !q('balance-chip'));
  ck('Move: the coach\'s program day with exercise count and Start workout', /Push ·/.test(q('plan-move').textContent) && /2 exercises/.test(q('plan-move').textContent) && /Start workout/.test(q('plan-move').textContent), q('plan-move').textContent);
  ck('Eat: 666 / 1,800 kcal and 37 / 120 g protein', /666/.test(q('plan-eat').textContent) && /1,800/.test(q('plan-eat').textContent) && /37/.test(q('plan-eat').textContent) && /120 g protein/.test(q('plan-eat').textContent), q('plan-eat').textContent);
  ck('Eat: the pending Dinner plan and the deficit fold in as sub-lines', /\d of \d meals? logged/.test(q('plan-eat').textContent) && !/meal plans? pending/.test(q('plan-eat').textContent) && /1,373 kcal under target/.test(q('plan-balance').textContent), q('plan-eat').textContent);
  ck('Eat: View meal plan is the action while a plan is pending', /View meal plan/.test(q('plan-eat').textContent));
  ck('Eat: nutrients N/31 inline', /\/31 nutrients/.test(q('chip-nutrition').textContent));
  ck('Recover: 1.5 / 3.0 L and 7h 45m inline', /1\.5/.test(q('chip-water').textContent) && /3\.0 L/.test(q('chip-water').textContent) && /7h 45m/.test(q('chip-sleep').textContent));
  const dots = q('protocol-dots');
  ck('Recover: the protocol dots — one per item, "3 of 5" — live inside the row', !!dots && dots.querySelectorAll('span.block.w-2\\.5').length === 5 && /3 of 5/.test(dots.textContent), dots?.textContent);
  // Time-gated in IST: the workout is the action from 06:00 IST; before that the protocol count is.
  const istH = parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }), 10) % 24;
  ck('the read carries ONE action, derived from the day (food logged, workout planned → Start today\'s workout from 06:00 IST)', q('read-action') && (istH >= 6 ? /Start today/.test(q('read-action').textContent) : /Tick the protocol/.test(q('read-action').textContent)), [istH, q('read-action')?.textContent]);
  ck('the header shows the date and Week N (joined 6 weeks ago in the fixture)', /Week 6/.test(q('date-line').textContent), q('date-line').textContent);

  const tl = q('timeline');
  ck('timeline lists weight, both meals, water and sleep in day order',
     !!tl && ['row-weight', 'row-meal', 'row-water', 'row-sleep'].every(id => tl.querySelector(`[data-testid="${id}"]`)) && tl.querySelectorAll('[data-testid="row-meal"]').length === 2);
  const mealTitles = [...tl.querySelectorAll('[data-testid="row-meal"]')].map(r => r.textContent);
  ck('meals are grouped by slot with their own kcal (Breakfast 276, Lunch 390)', /Breakfast/.test(mealTitles[0]) && /276/.test(mealTitles[0]) && /Lunch/.test(mealTitles[1]) && /390/.test(mealTitles[1]), mealTitles);
  ck('no workout row when nothing was logged (the coach plan is not a log)', !tl.querySelector('[data-testid="row-workout"]'));
  ck('unread coach message shows with Reply and Got it', d.querySelectorAll('[data-testid="coach-note"]').length === 1 && /add a walk after dinner/.test(h) && /Reply/.test(h));
  ck('no legacy inline drawer ids remain on the page', !d.getElementById('section-water') && !d.getElementById('section-protocol') && !d.getElementById('section-hero'));
  ck('the streak is one line in the header, not a card', q('streak-badge') && /3-day streak/.test(q('streak-badge').textContent) && !/14-day/.test(html()), q('streak-badge')?.textContent);
  ck('notes are collapsed to a row until tapped', !!q('notes-row') && !q('notes'));
  q('notes-row').click(); await tick(100);
  ck('tapping the row opens the textarea', !!q('notes'));

  // ── Sheets open from their chips and save through the store ─────────────
  q('chip-water').click(); await tick(300);
  let dlg = d.querySelector('[role=dialog]');
  ck('water chip opens the water sheet', !!dlg && /Target 3\.0 L/.test(dlg.textContent));
  dlg.querySelector('[data-testid="water-add-500"]').click(); await tick(100);
  ck('+500 updates the store (1500 → 2000) and the sheet total (2.00)',
     w.__logStore.getState().log.water === 2000 && /2\.00/.test(d.querySelector('[data-testid="water-total"]').textContent));
  ck('the chip behind the sheet updates too (2.0 L)', /2\.0/.test(q('chip-water').textContent));
  w.__click('Done'); await tick(500);
  ck('Done closes the sheet', !d.querySelector('[role=dialog]'));

  q('hero-weight').click(); await tick(300);
  dlg = d.querySelector('[role=dialog]');
  ck('tapping the hero weight opens the weight sheet with the current value', !!dlg && dlg.querySelector('[data-testid="weight-input"]')?.value === '82.4');
  const wi = dlg.querySelector('[data-testid="weight-input"]');
  const setVal = (el, v) => { const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  setVal(wi, '350'); await tick(100);
  ck('an implausible weight shows the warning and is still stored (member decides)', /looks unusual/.test(dlg.textContent) && w.__logStore.getState().log.weight === '350');
  setVal(wi, '82.1'); await tick(100);
  ck('a plausible weight clears the warning', !/looks unusual/.test(dlg.textContent) && w.__logStore.getState().log.weight === '82.1');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(500);
  ck('hero shows the new weight after the sheet closes', /82\.1/.test(q('hero-weight').textContent), q('hero-weight').textContent);

  q('protocol-dots').click(); await tick(300);
  dlg = d.querySelector('[role=dialog]');
  ck('protocol dots open the protocol sheet with all chips', !!dlg && dlg.querySelectorAll('[data-testid^="chip-"]').length === 5, dlg ? dlg.querySelectorAll('[data-testid^="chip-"]').length : 'no dialog: ' + h.slice(0, 0));
  dlg.querySelector('[data-testid="chip-b12"]').click(); await tick(100);
  ck('ticking B12 writes to the store and the title becomes 4 of 5', w.__logStore.getState().log.supplements.b12 === true && /4 of 5 done/.test(dlg.textContent), [w.__logStore.getState().log.supplements, dlg.textContent.slice(0, 80)]);
  dlg.querySelector('[data-testid="chip-walk"]').click(); await tick(100);
  ck('tapping an AUTO chip explains instead of ticking', w.__logStore.getState().log.activities.walk === false && /Ticks automatically/.test(dlg.textContent));
  w.__click('Done'); await tick(500);
  ck('dots now read 4 of 5', /4 of 5/.test(q('protocol-dots').textContent));

  q('chip-sleep').click(); await tick(300);
  dlg = d.querySelector('[role=dialog]');
  setVal(dlg.querySelector('[data-testid="sleep-wake"]'), '05:00'); await tick(100);
  ck('changing wake time recomputes duration (22:30→05:00 = 6h 30m) and stores it',
     /6h 30m/.test(dlg.querySelector('[data-testid="sleep-duration"]').textContent) && w.__logStore.getState().log.sleep.waketime === '05:00');
  w.__click('Done'); await tick(500);

  q('plan-eat-action').click(); await tick(400);
  dlg = d.querySelector('[role=dialog]');
  ck('the Eat action opens the food sheet with the real FoodLog and macro bars', !!dlg && !!dlg.querySelector('#section-food') && /Protein|protein/.test(dlg.textContent));
  w.__click('Done'); await tick(500);

  q('chip-nutrition').click(); await tick(300);
  dlg = d.querySelector('[role=dialog]');
  ck('nutrition sheet shows the 31-target panel when food has per_100g data', !!dlg && /of 31 targets met/.test(dlg.textContent) && /Vitamins|vitamins/i.test(dlg.textContent));
  w.__click('Done'); await tick(500);

  // ── save path: nothing has been POSTed yet — edits are debounced ────────
  ck('no POST fired yet — edits are debounced, not saved per keystroke', w.__posts.filter(p => /^\/logs\//.test(p.url)).length === 0);

  // ── AI read → chat; timeline empty state; date navigation ───────────────
  q('ai-read').click(); await tick(50);
  ck('tapping the read opens the AI chat', w.__aiChat.getState().open === true);
  w.__aiChat.getState().closeChat(); await tick(50);

  const beforeCalls = w.__calls.length;
  q('date-nav').querySelector('[aria-label="Previous day"]').click(); await tick(700);
  ck('‹ loads yesterday (label changes, "Editing past entry", a new /logs fetch)',
     !/^Today$/.test(q('date-label').textContent) && /Editing past entry/.test(q('date-nav').textContent) && w.__calls.length > beforeCalls, q('date-label').textContent);
  ck('yesterday has only a weight, so the timeline shows the weight row and nothing else',
     q('timeline') && q('timeline').querySelectorAll('button').length === 1 && /82\.7/.test(q('timeline').textContent), q('timeline')?.textContent);
  ck('no streak badge on a past day', !q('streak-badge'));
  w.__click('Jump to today'); await tick(700);
  ck('Jump to today returns to today', q('date-label').textContent === 'Today');


  // ── Sprint 4: the AI is on the page ─────────────────────────────────────
  ck('the AI thread renders on the page (no full-screen overlay)', !!q('ai-thread') && !d.querySelector('.fixed.inset-0.z-\\[70\\]'));
  ck('suggestion chips show while the conversation is empty', !!q('ai-suggestions') && q('ai-suggestions').querySelectorAll('button').length >= 3);
  // Sprint 5b.3: the bar is summoned, not permanent. (Earlier steps opened the
  // chat via the read and openChat(); put it away to start from the resting state.)
  w.__aiChat.getState().closeComposer(); await tick(200);
  ck('the composer is NOT on the page until asked for', !q('composer') && w.__aiChat.getState().composerOpen === false);
  ck('with the bar away the page bottom padding is small (no dead space above the nav)', /pb-6/.test(d.querySelector('main').className) && !/pb-32/.test(d.querySelector('main').className));
  ck('the thread header offers a "Tell me" button while the bar is away', !!q('thread-open-composer'));
  const orb = q('ai-orb');
  orb.click(); await tick(300);
  let composer = q('composer');
  ck('tapping the ✨ orb summons the composer: portaled to <body>, position fixed, above the nav', !!composer && composer.parentElement === d.body && /fixed/.test(composer.className) && /bottom/.test(composer.getAttribute('style') || ''), composer && composer.getAttribute('style'));
  ck('the "Tell me" button disappears while the bar is up; the orb reads as pressed', !q('thread-open-composer') && orb.getAttribute('aria-pressed') === 'true');
  orb.click(); await tick(300);
  ck('tapping the orb again puts the bar away', !q('composer') && w.__aiChat.getState().composerOpen === false);
  q('thread-open-composer').click(); await tick(300);
  ck('"Tell me" in the thread summons it too', !!q('composer'));
  q('composer-close').click(); await tick(300);
  ck('the ⌄ Close button on the bar puts it away', !q('composer'));
  orb.click(); await tick(300);
  composer = q('composer');
  const composerInput = composer && composer.querySelector('[data-testid="composer-input"]');
  ck('the composer has the text field, mic, camera and lab-report controls', !!composerInput && !!composer.querySelector('[aria-label="Log food from a photo"]') && !!composer.querySelector('[aria-label="Upload a lab report"]'), composer && composer.innerHTML.length);

  // The flush on ‹ was this device's first save of the day, and the fixture
  // member is 5.9 kg under her start weight — so the milestone celebration is
  // up. Assert it, dismiss it, then carry on.
  const milestone = q('milestone');
  ck('the first save of the day raised the "5 kg lost" milestone', !!milestone && /5 kg lost/.test(milestone.textContent), milestone && milestone.textContent.slice(0, 60));
  if (milestone) { w.__click("Let's keep going."); await tick(200); }
  ck('dismissing the milestone removes it', !q('milestone'));
  const sheetDlg = () => [...d.querySelectorAll('[role=dialog]')].find(x => x.getAttribute('aria-label') !== 'Milestone') || null;

  // openChat() while a sheet is open: the sheet closes and the composer takes focus
  q('chip-water').click(); await tick(300);
  ck('(setup) water sheet is open', !!sheetDlg());
  w.__aiChat.getState().openChat(); await tick(700);
  ck('openChat() closes the sheet so the composer is reachable', !sheetDlg(), 'focusRequest=' + w.__aiChat.getState().focusRequest);
  ck('openChat() focuses the composer input', d.activeElement === composerInput, d.activeElement && (d.activeElement.tagName + ' ' + (d.activeElement.getAttribute('data-testid') || d.activeElement.placeholder || '')));
  ck('a second openChat() bumps the focus counter (a counter, not a boolean)', (() => { const before = w.__aiChat.getState().focusRequest; w.__aiChat.getState().openChat(); return w.__aiChat.getState().focusRequest === before + 1; })());

  // Send → preview → Apply, through the stubbed parser
  const beforeApplied = w.__aiChat.getState().lastAppliedAt;
  ck('the composer is a multi-line textarea, not a single-line input (a dictated day stays readable)', composerInput.tagName === 'TEXTAREA' && composerInput.getAttribute('rows') === '1' && /maxHeight|max-height/.test(composerInput.getAttribute('style') || ''));
  composerInput.focus(); await tick(50);
  ck('focusing the composer slides the bottom nav away (keyboard + composer + thread share the screen)', w.__aiChat.getState().composerFocused === true && d.querySelector('[data-testid="member-nav"]').dataset.composing === '1');
  composerInput.blur(); await tick(50);
  ck('blur brings the nav back', w.__aiChat.getState().composerFocused === false && d.querySelector('[data-testid="member-nav"]').dataset.composing === '0');
  // A way out without sending: × discards the draft; Escape steps away and keeps it.
  ck('no clear button while the box is empty', !q('composer-clear'));
  setVal(composerInput, 'half typed thou'); await tick(50);
  ck('typing shows the × clear button', !!q('composer-clear'));
  composerInput.focus(); await tick(30);
  composerInput.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(50);
  ck('Escape blurs the composer but keeps the draft', composerInput.value === 'half typed thou' && w.__aiChat.getState().composerFocused === false && d.activeElement !== composerInput);
  q('composer-clear').click(); await tick(50);
  ck('× clears the draft, hides itself and sends nothing', composerInput.value === '' && !q('composer-clear') && !w.__posts.some(p => p.url === '/ai-chat/parse'));
  composerInput.focus(); composerInput.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(300);
  ck('Escape on an EMPTY box puts the bar away', !q('composer'));
  q('ai-orb').click(); await tick(300);
  const composerInput2 = q('composer').querySelector('[data-testid="composer-input"]');
  setVal(composerInput2, 'drank 500ml water, took b12, weight 82.0'); await tick(50);
  composerInput2.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(600);
  ck('Enter sends: the member bubble and the AI reply appear in the thread', /drank 500ml water/.test(q('ai-messages').textContent) && /Got it — water, B12/.test(q('ai-messages').textContent), q('ai-messages').textContent.slice(0, 160));
  ck('the request carried the message to /ai-chat/parse', w.__posts.some(p => p.url === '/ai-chat/parse' && /500ml/.test(p.body.message || JSON.stringify(p.body))));
  ck('the preview offers an Apply button for the 3 parsed items', /Apply 3 items/.test(q('ai-messages').textContent), q('ai-messages').textContent.match(/Apply[^<]{0,30}/));
  const waterBefore = w.__logStore.getState().log.water;
  w.__click('Apply 3 items to today'); await tick(700);
  const st = w.__logStore.getState().log;
  ck('Apply writes weight 82.0, +500 ml and the B12 tick into the store', st.weight === '82' && st.water === waterBefore + 500 && st.supplements.b12 === true, [st.weight, st.water, st.supplements]);
  ck('the thread shows "Applied & saved" with Edit and Undo', /Applied/.test(q('ai-messages').textContent) && /Undo/.test(q('ai-messages').textContent) && /Edit/.test(q('ai-messages').textContent));
  ck('Apply stamps lastAppliedAt (the workout-refresh signal replaces "overlay closed")', w.__aiChat.getState().lastAppliedAt != null && w.__aiChat.getState().lastAppliedAt !== beforeApplied);
  ck('the hero, chips and dots reflect the applied day without a reload', /(^|\D)82(\D|$)/.test(q('hero-weight').textContent) && !/82\.1/.test(q('hero-weight').textContent) && /2\.0/.test(q('chip-water').textContent) && /4 of 5/.test(q('protocol-dots').textContent), [q('hero-weight').textContent, q('chip-water').textContent, q('protocol-dots').textContent]);

  // The debounce itself: one more edit, then wait past 4s and the ONE save fires.
  q('chip-water').click(); await tick(300);
  d.querySelector('[data-testid="water-add-250"]').click(); await tick(100);
  w.__click('Done'); await tick(4500);
  const saves = w.__posts.filter(p => /^\/logs\/\d{4}-\d{2}-\d{2}$/.test(p.url));
  // Two saves, and the ORDER matters:
  //  1. pressing ‹ earlier flushed the pending edits (water 2000, B12, wake 05:00)
  //     to TODAY before the store switched to yesterday — this is the fix for the
  //     lost-tick bug; without it the first POST would carry yesterday's data.
  //  2. jumping back to today reloaded the log from the server (1500 in the
  //     fixture), then +250 → 1750, debounced 4s → one POST.
  ck('pressing ‹ flushed the pending edits to TODAY first (water 2000, B12 ticked, wake 05:00)',
     saves.length >= 1 && saves[0].url.endsWith(w.__todayStr) && saves[0].body.water_ml === 2000 && saves[0].body.supplements?.b12 === true && saves[0].body.sleep?.waketime === '05:00',
     saves.map(p => [p.url, p.body && p.body.water_ml, p.body && p.body.supplements && p.body.supplements.b12, p.body && p.body.sleep && p.body.sleep.waketime]));
  // Apply saved once (saveLog inside applyAll), then +250 debounced → the last POST carries 2250.
  ck('after 4s of quiet the final POST carries the applied day plus the new edit (1500 + 500 + 250)',
     saves.length >= 2 && saves[saves.length - 1].body.water_ml === 2250 && saves[saves.length - 1].body.weight_kg == 82,
     saves.map(p => [p.url, p.body && p.body.water_ml, p.body && p.body.weight_kg]));
  ck('the header shows the auto-saved confirmation', /auto-saved/.test(html()), (q('save-status') || {}).textContent);

  ck('nothing in the page tree hit an unrouted endpoint that matters', !w.__calls.some(u => /^\/logs\/undefined|NaN/.test(u)), w.__calls.filter(u => /undefined|NaN/.test(u)));
  ck('no error escaped during the whole flow', errors.length === 0, errors.join(' | '));
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Today in a REAL browser — phone widths, sheets open, screenshots
// ═══════════════════════════════════════════════════════════════════════════
//
// jsdom proves the wiring; it cannot prove layout. Here the same Today page,
// same API stub, renders in headless Chrome at 320/360/390px with the built
// stylesheet: the page must not scroll sideways, and neither may it with the
// food sheet (the widest content) open. Screenshots land in
// /tmp/fitlife-shots/ so a human can look at what shipped.
async function todayVisualTest() {
  console.log('\n[8] Today at phone widths (headless Chrome) + screenshots');
  let puppeteerCore, chromiumPkg;
  try {
    puppeteerCore = (await import('puppeteer-core')).default;
    chromiumPkg   = (await import('@sparticuz/chromium')).default;
  } catch {
    console.log('  – browser not installed, visual check NOT RUN (cd server && npm run test:ui:install)');
    return;
  }
  const chromium = chromiumPkg.default || chromiumPkg;
  const distDir = path.join(ROOT, 'client', 'dist', 'assets');
  const cssFile = fs.existsSync(distDir) ? fs.readdirSync(distDir).find(f => f.endsWith('.css')) : null;
  if (!cssFile) throw new Error('No built stylesheet — run: cd client && npm run build');
  const css = fs.readFileSync(path.join(distDir, cssFile), 'utf8');
  const api = stub('api-today-visual.js', TODAY_API_STUB);
  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import DailyLog from './pages/DailyLog.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 214, name: 'Asha Rao', role: 'patient' }, isRestoring: false });
    createRoot(document.getElementById('root')).render(<MemoryRouter><DailyLog /></MemoryRouter>);`, api);

  const shell = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${css}</style></head><body style="margin:0;background:#121316"><div id="root"></div></body></html>`;
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(shell); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}/`;
  const browser = await puppeteerCore.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'], headless: true });
  const shotDir = '/tmp/fitlife-shots'; fs.mkdirSync(shotDir, { recursive: true });
  // A docked composer covers whatever scrolls under it, exactly like a phone.
  // Bring the target into the middle of the viewport before tapping, as a thumb would.
  const tapVisible = async (page, sel) => {
    await page.$eval(sel, el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await new Promise(r => setTimeout(r, 250));
    await page.tap(sel);
  };

  const measure = (page, vw) => page.evaluate((vw) => {
    const scrollW = document.documentElement.scrollWidth;
    const offenders = [];
    if (scrollW > vw + 1) for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if ((r.width === 0 && r.height === 0) || r.right <= vw + 1) continue;
      if ([...el.children].some(c => c.getBoundingClientRect().right > vw + 1)) continue;
      offenders.push(`<${el.tagName.toLowerCase()} class="${String(el.className || '').slice(0, 80)}"> right=${Math.round(r.right)}`);
    }
    const dialog = document.querySelector('[role=dialog]');
    const dialogW = dialog ? Math.round(dialog.getBoundingClientRect().width) : null;
    return { scrollW, offenders: offenders.slice(0, 4), mounted: document.getElementById('root').innerHTML.length, dialogW };
  }, vw);

  try {
    for (const width of [320, 360, 390]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ content: code });
      await new Promise(r => setTimeout(r, 1200));
      let m = await measure(page, width);
      ck(`Today @${width}px mounts`, m.mounted > 50, m.mounted);
      ck(`Today @${width}px does not scroll sideways`, m.scrollW <= width + 1, `scrollWidth ${m.scrollW} · ${m.offenders.join(' · ')}`);
      if (width === 360) await page.screenshot({ path: path.join(shotDir, 'today-360.png'), fullPage: true });

      // Sprint 5b.3: the bar is summoned by the orb. Tap it first.
      await page.tap('[data-testid="ai-orb"]'); await new Promise(r => setTimeout(r, 500));
      // Sprint 4: the composer is fixed above the nav. Scrolled to the very end,
      // the last card (notes) must still clear the composer — otherwise the
      // bottom of the page is permanently unreachable.
      // html has scroll-behavior:smooth — scroll instantly, then let layout settle before measuring.
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await new Promise(r => setTimeout(r, 400));
      const dock = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="composer"]');
        const n = document.querySelector('[data-testid="notes-row"]') || document.querySelector('[data-testid="notes"]');
        const nav = document.querySelector('nav') || document.querySelector('[class*="fixed bottom"]');
        const cr = c && c.getBoundingClientRect(), nr = n && n.getBoundingClientRect(), vr = nav && nav.getBoundingClientRect();
        return { composerTop: cr && Math.round(cr.top), composerBottom: cr && Math.round(cr.bottom), notesBottom: nr && Math.round(nr.bottom),
                 navTop: vr && Math.round(vr.top), vh: window.innerHeight, composerVisible: !!cr && cr.height > 30 && cr.bottom <= window.innerHeight };
      });
      await new Promise(r => setTimeout(r, 300));
      ck(`composer @${width}px is docked inside the viewport, above the bottom nav`, dock.composerVisible && (dock.navTop == null || dock.composerBottom <= dock.navTop + 2), dock);
      ck(`scrolled to the end @${width}px, the notes card clears the composer (page bottom is reachable)`, dock.notesBottom != null && dock.notesBottom <= dock.composerTop, JSON.stringify(dock));
      if (width === 360) await page.screenshot({ path: path.join(shotDir, 'today-360-bottom.png') });

      // Sprint 5b.1: a long dictated day must be fully visible while typing.
      await page.focus('[data-testid="composer-input"]');
      await page.type('[data-testid="composer-input"]', '2 idli and sambar for breakfast, 100g whey protein 1 scoop after the walk, chicken curry with 2 chapati for lunch, drank 2 litres water so far', { delay: 0 });
      await new Promise(r => setTimeout(r, 300));
      const grown = await page.evaluate(() => {
        const t = document.querySelector('[data-testid="composer-input"]');
        const nav = document.querySelector('[data-testid="member-nav"]');
        return { h: t.clientHeight, sh: t.scrollHeight, lines: Math.round(t.clientHeight / 22), navHidden: nav.dataset.composing === '1', navRight: nav.getBoundingClientRect().top >= window.innerHeight - 2 };
      });
      // Fits entirely, or has reached the 5-line cap and scrolls inside (never a clipped single line).
      ck(`composer @${width}px grows to fit the text (${Math.min(grown.lines, 5)} lines shown${grown.h < grown.sh - 2 ? ', capped and scrolling' : ''})`, grown.lines >= 3 && (grown.h >= grown.sh - 2 || grown.h >= 5 * 22 + 16 - 4), JSON.stringify(grown));
      ck(`while typing @${width}px the bottom nav is off-screen`, grown.navHidden && grown.navRight, JSON.stringify(grown));
      if (width === 360) await page.screenshot({ path: path.join(shotDir, 'today-360-composing.png') });
      await page.evaluate(() => { const t = document.querySelector('[data-testid="composer-input"]'); t.blur(); });
      await page.evaluate(() => { const t = document.querySelector('[data-testid="composer-input"]'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); });
      await new Promise(r => setTimeout(r, 300));
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await new Promise(r => setTimeout(r, 300));

      await tapVisible(page, '[data-testid="plan-eat-action"]'); await new Promise(r => setTimeout(r, 900));
      m = await measure(page, width);
      ck(`Today @${width}px with the food sheet open still does not scroll sideways`, m.scrollW <= width + 1, `scrollWidth ${m.scrollW} · ${m.offenders.join(' · ')}`);
      ck(`the food sheet @${width}px fills the viewport width`, m.dialogW != null && m.dialogW >= width - 2 && m.dialogW <= width, JSON.stringify(m));
      if (width === 360) await page.screenshot({ path: path.join(shotDir, 'today-360-food-sheet.png') });
      await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 600));

      await tapVisible(page, '[data-testid="protocol-dots"]'); await new Promise(r => setTimeout(r, 900));
      m = await measure(page, width);
      ck(`protocol sheet @${width}px: no sideways scroll`, m.scrollW <= width + 1 && m.dialogW != null, `scrollWidth ${m.scrollW}`);
      if (width === 360) await page.screenshot({ path: path.join(shotDir, 'today-360-protocol-sheet.png') });
      await page.keyboard.press('Escape');
      // The sheet slides out over ~300 ms. A fixed 600 ms wait failed on a busy
      // machine (three times on 5 Oct, always at 390 px, never reproducible):
      // wait up to 3 s for it to go, so a slow runner is not a red gate.
      // A sheet that never closes still fails.
      let closed = false;
      for (let t = 0; t < 15 && !closed; t++) { await new Promise(r => setTimeout(r, 200)); closed = (await measure(page, width)).dialogW === null; }
      ck(`Escape closes the sheet in a real browser @${width}px`, closed);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. Progress (Sprint 5) — hero weight, range, journey, heat grid
// ═══════════════════════════════════════════════════════════════════════════
async function progressTest() {
  console.log('\n[10] Progress — weight hero, 7/30/90 window, 30-day grid');
  const api = stub('api-progress.js', `
    import { today, istDaysAgo } from '${CONSTANTS_JS}';
    window.__calls = [];
    // 20 logged days out of the last 30: weight drifting 84.0 → 82.4, compliance
    // alternating, food on the last 3 days. Day -3, -5 and -9 are missing on purpose.
    const skip = new Set([3, 5, 9, 12, 15, 17, 19, 22, 25, 27]);
    if (window.__streak2) skip.add(2);          // logged today and yesterday only: a 2-day streak
    const logs = [];
    for (let i = 29; i >= 0; i--) {
      if (skip.has(i)) continue;
      logs.push({
        log_date: istDaysAgo(i),
        weight_kg: (82.4 + i * 0.055).toFixed(1),
        compliance_pct: i % 3 === 0 ? 90 : i % 3 === 1 ? 60 : 30,
        food_items: i < 3 ? [{ name: 'Idli', grams: 120, per_100g: { calories: 130, protein: 3.5, total_carbs: 28, fat: 0.8 } }] : [],
      });
    }
    // the 90-day request also gets one old point so 90d differs from 30d
    const routes = [
      [/^\\/logs\\/range\\//, () => [{ log_date: istDaysAgo(60), weight_kg: '86.0', compliance_pct: 80, food_items: [] }, ...logs]],
      [/^\\/members\\/me$/, () => ({ start_weight: '88', target_weight: '78', height_cm: '172', labs: [
        { test_name: 'Muscle Mass %', unit: '%', value: '70.20', test_date: istDaysAgo(40) },
        { test_name: 'BMR', unit: 'Cal', value: '1716.00', test_date: istDaysAgo(40) }] })],
      [/^\\/members\\/me\\/weekly-report$/, () => ({ report: null, history: [] })],
      [/^\\/workouts\\/summary$/, () => ({ sessions: [] })],
      [/^\\/workouts\\/logged-exercises$/, () => []],
      [/^\\/workouts\\/muscle-coverage/, () => ({ coverage: [], weeks: [] })],
    ];
    const get = async (url, opts) => { window.__calls.push(url); const hit = routes.find(([re]) => re.test(url)); return { data: hit ? hit[1](opts) : {} }; };
    const post = async (url, body) => ({ data: { ok: true } });
    export default { get, post, put: post, patch: post, delete: post };`);

  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import Progress from './pages/Progress.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 214, name: 'Asha Rao', role: 'patient' }, isRestoring: false });
    createRoot(document.getElementById('root')).render(<MemoryRouter><Progress /></MemoryRouter>);`, api);

  const { w, errors, html } = run(code);
  await tick(900);
  const d = w.document;
  const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  const h = html();
  ck('Progress mounts without throwing', errors.length === 0, errors.join('|'));
  ck('hero shows the latest weight in kg with the change over the default 30-day window',
     q('progress-hero') && /82\.4/.test(q('progress-hero').textContent) && /↓/.test(q('progress-hero').textContent) && /over 30 days/.test(q('progress-hero').textContent), q('progress-hero')?.textContent);
  ck('journey line: start 88 → goal 78, 56% there, 5.6 kg lost',
     q('journey') && /88 kg/.test(q('journey').textContent) && /78 kg/.test(q('journey').textContent) && /56% there/.test(q('journey').textContent) && /5\.6 kg lost/.test(q('journey').textContent), q('journey')?.textContent);
  // Recharts measures a 0px container in jsdom and draws nothing; the real
  // browser check below proves the SVG. Here: the chart slot exists and is
  // not the "log two weigh-ins" fallback.
  ck('the weight chart slot renders (not the empty-state text) when there are two+ weigh-ins',
     q('weight-chart') && !/weigh-in/.test(q('weight-chart').textContent));

  // Phase 8: the page also has Body / Nutrition / Training / Reports tabs; the
  // range control is the three tabs named 7d, 30d, 90d.
  const allTabs = [...d.querySelectorAll('[role=tab]')];
  const tabs = allTabs.filter(t => /^(7|30|90)d$/.test(t.textContent.trim()));
  const groupTab = (name) => allTabs.find(t => t.textContent.trim() === name);
  ck('7 / 30 / 90 segmented control is present', tabs.length === 3 && tabs.map(t => t.textContent.trim()).join(',') === '7d,30d,90d');
  ck('Phase 8: Body, Nutrition, Training and Reports tabs, Body open first',
     ['Body', 'Nutrition', 'Training', 'Reports'].every(n => groupTab(n)) && groupTab('Body').getAttribute('aria-selected') === 'true'
     && !!q('journey') && !q('heat-grid'), allTabs.map(t => t.textContent.trim()));
  tabs[2].click(); await tick(200);
  ck('90d widens the window: the change now includes the 86.0 point (↓ 3.6 kg over 90 days)',
     /over 90 days/.test(q('progress-hero').textContent) && /3\.6/.test(q('progress-hero').textContent), q('progress-hero').textContent);
  tabs[0].click(); await tick(200);
  ck('7d narrows it (change over 7 days is small)', /over 7 days/.test(q('progress-hero').textContent) && /0\.[0-9]/.test(q('progress-hero').textContent), q('progress-hero').textContent);

  // The 30-day grid lives under Reports.
  groupTab('Reports').click(); await tick(200);
  ck('Reports holds the 30-day grid; the weight hero stays above every tab', !!q('heat-grid') && !!q('progress-hero'));
  const grid = q('heat-grid');
  const cells = grid ? [...grid.querySelectorAll('[data-testid="heat-cell"]')] : [];
  ck('30-day grid has exactly 30 day cells in 7 weekday columns', cells.length === 30 && /grid-cols-7/.test(grid.innerHTML));
  const missing = cells.filter(c => /not logged/.test(c.getAttribute('aria-label')));
  ck('the 10 unlogged days read as "not logged"', missing.length === 10, missing.length);
  missing[0].click(); await tick(100);
  ck('tapping an unlogged cell opens nothing', !d.querySelector('.fixed.inset-0'));
  const logged = cells.find(c => /: 90%/.test(c.getAttribute('aria-label')));
  logged.click(); await tick(200);
  ck('tapping a logged cell opens that day\'s full log', d.querySelector('.fixed.inset-0') != null && /Compliance|compliance/.test(html()));
  ck('no purple/blue header leftovers on the page', !/#0d0b18|text-blue-200/.test(h));
  const pageSrc = fs.readFileSync(path.join(ROOT, 'client/src/pages/Progress.jsx'), 'utf8');
  ck('Training holds the training trends; Nutrition the nutrition trend and a way to the diet plan',
     /tab === 'training' && \(<>[\s\S]*?Training Trends[\s\S]*?<StrengthProgress \/>[\s\S]*?<MuscleCoverage \/>/.test(pageSrc)
     && /tab === 'nutrition' && \(<>[\s\S]*?Nutrition Trend[\s\S]*?progress-to-plan/.test(pageSrc));
  ck('each section appears exactly once on the page', ['<ProgressPhotos />', '<WeeklyReportCard />', 'Log History', 'Your Journey', 'Latest Lab Values', '<StrengthProgress />'].every(x => pageSrc.split(x).length === 2));
  groupTab('Training').click(); await tick(200);
  ck('switching to Training shows Training and hides the Reports grid', groupTab('Training').getAttribute('aria-selected') === 'true' && !q('heat-grid'));
  ck('nutrition trend gets its macros from lib/day (no hand-copied reduce)', !/const macros = items\.reduce/.test(fs.readFileSync(path.join(ROOT, 'client/src/pages/Progress.jsx'), 'utf8')));
  ck('no error escaped', errors.length === 0, errors.join('|'));

  // ── 7 Oct review (from Sachin's Android screenshots) ──────────────────────
  {
    const skipSet = new Set([3, 5, 9, 12, 15, 17, 19, 22, 25, 27]); const vals = [];
    for (let i = 29; i >= 0; i--) if (!skipSet.has(i)) vals.push(i % 3 === 0 ? 90 : i % 3 === 1 ? 60 : 30);
    const want = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    const withOld = Math.round((vals.reduce((a, b) => a + b, 0) + 80) / (vals.length + 1));
    groupTab('Reports').click(); await tick(200);
    const shown = (d.body.textContent.match(/(\d+)% average/) || [])[1];
    ck('"30-day" compliance is the 30 days the grid shows: the 60-day-old log is not in it', want !== withOld && Number(shown) === want, { shown, want, withOld });
    ck('a 3-day streak says "Keep going"', /3 days/.test(d.body.textContent) && /Keep going/.test(d.body.textContent));
    groupTab('Body').click(); await tick(200);
    const bt = d.body.textContent;
    ck('lab values: "Muscle Mass %" does not get a second %, and 70.20 / 1716.00 read 70.2 / 1716', /Muscle Mass %70\.2(?!0)/.test(bt) && !/Muscle Mass %\s*%/.test(bt) && /BMR\s*Cal\s*1716(?!\.)/.test(bt), bt.slice(bt.indexOf('Muscle Mass'), bt.indexOf('Muscle Mass') + 60));
    groupTab('Nutrition').click(); await tick(200);
    const sw = [...(q('macro-legend')?.querySelectorAll('span[style]') || [])].map(x => x.style.background || x.style.backgroundColor);
    ck('nutrition chart: Protein, Carbs and Fat each have their own colour (carbs and fat were both yellow)', sw.length === 3 && new Set(sw).size === 3 && /Protein/.test(q('macro-legend').textContent) && /Fat/.test(q('macro-legend').textContent), sw);
    ck('and the chart says what it covers: "Your last N logged days", not "7-Day"', /^Your last \d+ logged days$/.test(q('nutrition-trend-span')?.textContent || '') && !/7-Day/.test(d.body.textContent), q('nutrition-trend-span')?.textContent);
    ck('chart pop-ups are dark, not the library\'s white box', /const TIP = \{[\s\S]*?background: '#1A1C20'/.test(pageSrc) && !/border: '1px solid #e7e5e4'/.test(pageSrc));

    const S2 = run(code, (win) => { win.__streak2 = true; }); await tick(900);
    const tab2 = [...S2.w.document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === 'Reports');
    tab2.click(); await tick(200);
    const t2 = S2.w.document.body.textContent;
    ck('a 2-day streak says "Good start", never "Start today"', S2.errors.length === 0 && /2 days/.test(t2) && /Good start/.test(t2) && !/Start today/.test(t2), S2.errors.join('|'));
  }

  // One real-browser screenshot at 360 so a human can look at it.
  try {
    const puppeteerCore = (await import('puppeteer-core')).default;
    const chromiumPkg = (await import('@sparticuz/chromium')).default; const chromium = chromiumPkg.default || chromiumPkg;
    const distDir = path.join(ROOT, 'client', 'dist', 'assets');
    const css = fs.readFileSync(path.join(distDir, fs.readdirSync(distDir).find(f => f.endsWith('.css'))), 'utf8');
    const shell = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;background:#121316"><div id="root"></div></body></html>`;
    const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(shell); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const browser = await puppeteerCore.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'], headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ content: code });
      await new Promise(r => setTimeout(r, 1500));
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, chart: !!document.querySelector('[data-testid="weight-chart"] svg'), gold: /goldFill/.test(document.querySelector('[data-testid="weight-chart"]')?.innerHTML || '') }));
      ck('Progress @360px in real Chrome: no sideways scroll, the gold area chart drew', m.sw <= 361 && m.chart && m.gold, JSON.stringify(m));
      fs.mkdirSync('/tmp/fitlife-shots', { recursive: true });
      await page.screenshot({ path: '/tmp/fitlife-shots/progress-360.png', fullPage: true });
    } finally { await browser.close(); await new Promise(r => server.close(r)); }
  } catch (e) {
    console.log('  – browser not installed, Progress screenshot NOT taken (' + String(e.message).slice(0, 60) + ')');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. Plan (Sprint 6) — the four views, and the new nav
// ═══════════════════════════════════════════════════════════════════════════
async function planTest() {
  console.log('\n[11] Plan — Today / Week / Nutrition / Recovery + nav');
  const api = stub('api-plan.js', `
    window.__calls = [];
    const wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const todayWd = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Kolkata' });
    const payload = {
      profile: { name: 'Asha Rao', monitor_name: 'Sachin', macros: { kcal: 1800, pro: 120, carb: 150, fat: 60 }, water_target: 3000,
                 activities: ['walk', 'sun'], acv: ['acv1'], supplements: ['b12', 'd3'], fasting_start: '20:00', fasting_end: '12:00',
                 item_overrides: { sun: { label: 'Morning sun', sub: '15 min before 9am' } } },
      meal_plan: { date: 'x', meals: [
        { meal: 'Lunch',  items: [{ name: 'Dal', grams: 200, per_100g: { calories: 110 } }, { name: 'Rice', grams: 150, per_100g: { calories: 130 } }] },
        { meal: 'Dinner', items: [{ name: 'Paneer', grams: 150, per_100g: { calories: 260 } }] },
      ] },
      program: { program: { id: 7, name: 'Foundation' }, days: [
        { id: 1, day_label: 'Push · ' + todayWd, exercises: [{ id: 11, exercise_name: 'Bench press', muscle_group: 'chest', target_sets: 3, target_reps: 10 }, { id: 12, exercise_name: 'Shoulder press', muscle_group: 'shoulders', target_sets: 3, target_reps: 12 }] },
        { id: 2, day_label: 'Pull · ' + wd[(wd.indexOf(todayWd) + 2) % 7], exercises: [{ id: 21, exercise_name: 'Row' }] },
        { id: 3, day_label: 'Legs · ' + wd[(wd.indexOf(todayWd) + 4) % 7], exercises: [{ id: 31, exercise_name: 'Squat' }, { id: 32, exercise_name: 'Lunge' }, { id: 33, exercise_name: 'Calf raise' }] },
      ] },
    };
    const get = async (url) => { window.__calls.push(url); return { data: /\\/members\\/me\\/today$/.test(url) ? payload : {} }; };
    export default { get, post: async () => ({ data: {} }), put: async () => ({ data: {} }), patch: async () => ({ data: {} }), delete: async () => ({ data: {} }) };`);

  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
    import Plan from './pages/Plan.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 214, name: 'Asha Rao', role: 'patient' }, isRestoring: false });
    function Where() { const l = useLocation(); return <div data-testid="elsewhere">{l.pathname + l.search}</div>; }
    createRoot(document.getElementById('root')).render(
      <MemoryRouter initialEntries={['/plan']}>
        <Routes>
          <Route path="/plan" element={<Plan />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>);`, api);

  const { w, errors, html } = run(code);
  await tick(600);
  const d = w.document;
  const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('Plan mounts from one request to /members/me/today', errors.length === 0 && w.__calls.filter(u => /me\/today/.test(u)).length === 1, [errors.join('|'), w.__calls]);
  ck('header: program name and "Set by Sachin · weekday schedule"', /Foundation/.test(html()) && /Set by Sachin/.test(html()) && /weekday schedule/.test(html()));

  // nav
  const navLabels = [...d.querySelectorAll('[data-testid="member-nav"] button')].map(b => b.textContent.trim()).filter(Boolean);
  ck('nav is Today · Plan · Progress · Profile — Settings is no longer a tab', navLabels.join(',') === 'Today,Plan,Progress,Profile', navLabels);
  ck('Plan is the active tab', /text-gold/.test([...d.querySelectorAll('[data-testid="member-nav"] button')].find(b => /Plan/.test(b.textContent)).className));

  // Today view
  ck('Today view: this weekday\'s program day with sets × reps', q('plan-today-workout') && /Bench press/.test(q('plan-today-workout').textContent) && /3 × 10/.test(q('plan-today-workout').textContent), q('plan-today-workout')?.textContent);
  ck('Today view: meal plan lines with per-meal kcal (Lunch ~415, Dinner ~390)', q('plan-today-meals') && /Lunch/.test(q('plan-today-meals').textContent) && /~415/.test(q('plan-today-meals').textContent) && /~390/.test(q('plan-today-meals').textContent), q('plan-today-meals')?.textContent);
  ck('Today view: water 3.0 L, sleep target, supplements (B12 · D3) from the same protocol list Today uses', q('plan-today-recover') && /3\.0 L/.test(q('plan-today-recover').textContent) && /10:00 PM/.test(q('plan-today-recover').textContent) && /B12/.test(q('plan-today-recover').textContent));
  q('plan-today-recover').querySelector('button').click(); await tick(100);
  ck('a Recover line deep-links to Today with the sheet to open (/?open=water)', !!q('elsewhere') && q('elsewhere').textContent === '/?open=water', q('elsewhere')?.textContent);

  // Re-mount for the other views (the deep link navigated away)
  const { w: w2 } = run(code); await tick(600);
  const d2 = w2.document; const q2 = (id) => d2.querySelector(`[data-testid="${id}"]`);
  const tabs = [...d2.querySelectorAll('[role=tab]')];
  tabs[1].click(); await tick(150);
  const dayRows = [...d2.querySelectorAll('[data-testid="plan-week-day"]')];
  ck('Week view: seven rows Mon…Sun, three program days, four Rest', dayRows.length === 7 && dayRows.filter(r => /Rest/.test(r.textContent)).length === 4, dayRows.map(r => r.textContent.slice(0, 20)));
  ck('Week view: today is highlighted and shows its exercises', dayRows.some(r => r.dataset.today === '1' && /Push/.test(r.textContent) && /Bench press/.test(r.textContent)));
  tabs[2].click(); await tick(150);
  ck('Nutrition view: 1,800 kcal, protein/carbs/fat tiles, eating window 12:00 PM → 8:00 PM', /1,800/.test(q2('plan-main').textContent) && q2('plan-macros') && /120/.test(q2('plan-macros').textContent) && /12:00 PM → 8:00 PM/.test(q2('plan-main').textContent), q2('plan-main')?.textContent.slice(0, 200));
  ck('Nutrition view: both prescribed meals with grams', d2.querySelectorAll('[data-testid="plan-meal"]').length === 2 && /200 g/.test(q2('plan-main').textContent));
  tabs[3].click(); await tick(150);
  ck('Recovery view: sleep, water, rest days, and the 5 protocol items with the coach\'s override label', q2('plan-recovery') && /Rest days/.test(q2('plan-recovery').textContent) && q2('plan-protocol') && q2('plan-protocol').querySelectorAll('div.flex').length === 5 && /Morning sun/.test(q2('plan-protocol').textContent), q2('plan-protocol')?.textContent.slice(0, 120));
  ck('no error escaped', errors.length === 0, errors.join('|'));

  // Screenshot at 360 for a human.
  try {
    const puppeteerCore = (await import('puppeteer-core')).default;
    const chromiumPkg = (await import('@sparticuz/chromium')).default; const chromium = chromiumPkg.default || chromiumPkg;
    const distDir = path.join(ROOT, 'client', 'dist', 'assets');
    const css = fs.readFileSync(path.join(distDir, fs.readdirSync(distDir).find(f => f.endsWith('.css'))), 'utf8');
    const shell = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;background:#121316"><div id="root"></div></body></html>`;
    const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(shell); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const browser = await puppeteerCore.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'], headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ content: code });
      await new Promise(r => setTimeout(r, 1200));
      fs.mkdirSync('/tmp/fitlife-shots', { recursive: true });
      await page.screenshot({ path: '/tmp/fitlife-shots/plan-360-today.png', fullPage: true });
      await page.tap('[role=tab]:nth-of-type(2)'); await new Promise(r => setTimeout(r, 500));
      await page.screenshot({ path: '/tmp/fitlife-shots/plan-360-week.png', fullPage: true });
      const m = await page.evaluate(() => document.documentElement.scrollWidth);
      ck('Plan @360px in real Chrome: no sideways scroll on the Week view', m <= 361, m);
    } finally { await browser.close(); await new Promise(r => server.close(r)); }
  } catch (e) { console.log('  – browser not installed, Plan screenshots NOT taken'); }
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. Onboarding (Sprint 7) — several goals, in order
// ═══════════════════════════════════════════════════════════════════════════
async function onboardingTest() {
  console.log('\n[12] Onboarding — mode, goals (many, ordered), numbers, ready');
  const api = stub('api-onb.js', `
    window.__puts = [];
    const put = async (url, body) => { window.__puts.push({ url, body }); return { data: { onboarding_done: true, goal: body.goals?.[0] || null, goals: body.goals || [] } }; };
    export default { get: async () => ({ data: {} }), post: put, put, patch: put, delete: put };`);
  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import Onboarding from './components/Onboarding.jsx';
    import { useSettingsStore } from './store/settingsStore.js';
    import { useAIChat } from './components/AIChatLog.jsx';
    window.__settings = useSettingsStore; window.__aiChat = useAIChat; window.__done = 0;
    createRoot(document.getElementById('root')).render(<MemoryRouter><Onboarding onDone={() => { window.__done++; }} /></MemoryRouter>);`, api);
  const { w, errors, html } = run(code);
  await tick(200);
  const d = w.document;
  const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('onboarding mounts', errors.length === 0, errors.join('|'));
  ck('step 1 asks who is using FitLife with three modes; Next is disabled until one is picked', q('onb-modes').querySelectorAll('button').length === 3 && q('onb-next').disabled);
  q('onb-modes').querySelectorAll('button')[1].click(); await tick(50);
  ck('picking Adult enables Next', !q('onb-next').disabled);
  q('onb-next').click(); await tick(100);
  ck('step 2 lists the seven goals; Next disabled with none picked', q('onb-goals') && q('onb-goals').querySelectorAll('button').length === 7 && q('onb-next').disabled);
  q('goal-sleep').click(); q('goal-lose').click(); q('goal-energy').click(); await tick(50);
  const num = (id) => q(id).querySelector('[data-testid="goal-order"]')?.textContent;
  ck('goals are MULTI-select and numbered in the order tapped (sleep 1, lose 2, energy 3)', num('goal-sleep') === '1' && num('goal-lose') === '2' && num('goal-energy') === '3' && !num('goal-gain'), [num('goal-sleep'), num('goal-lose'), num('goal-energy')]);
  ck('the main goal is called out as the first picked', /Main goal:/.test(q('onb-primary').textContent) && /Sleep better/.test(q('onb-primary').textContent));
  q('goal-sleep').click(); await tick(50);
  ck('tapping a picked goal removes it and the numbers close up (lose 1, energy 2)', num('goal-lose') === '1' && num('goal-energy') === '2' && !num('goal-sleep') && /Lose weight/.test(q('onb-primary').textContent));
  q('goal-sleep').click(); await tick(50);
  q('onb-next').click(); await tick(100);
  ck('step 3: weights, both optional, Next enabled empty', q('onb-weights') && !q('onb-next').disabled);
  const setVal = (el, v) => { const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set; setter.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  setVal(q('onb-start'), '500'); await tick(50);
  ck('an implausible weight blocks Next with a message', q('onb-next').disabled && /between 20 and 300/.test(html()));
  setVal(q('onb-start'), '82.5'); setVal(q('onb-target'), '75'); await tick(50);
  q('onb-next').click(); await tick(100);
  ck('step 4 names the main goal in the headline and the others after', /Let\u2019s lose weight/.test(html()) && /Also: more energy, sleep better/.test(html()), html().match(/Let.{0,40}/)?.[0]);
  ck('avatar picker is on the last screen (not a step of its own)', q('onb-avatars') && q('onb-avatars').querySelectorAll('button').length === 12);
  q('onb-avatars').querySelectorAll('button')[4].click(); await tick(30);
  q('onb-send-sample').click(); await tick(200);
  const put = w.__puts.find(p => /onboarding/.test(p.url));
  ck('finishing saves { age_mode, goals in order, weights, avatar } through PUT /members/me/onboarding', put && put.body.age_mode === 'adult' && JSON.stringify(put.body.goals) === JSON.stringify(['lose', 'energy', 'sleep']) && put.body.start_weight === 82.5 && put.body.target_weight === 75 && put.body.avatar_idx === 4, put && put.body);
  ck('the store is marked onboarded with the mode and the avatar', w.__settings.getState().ageMode === 'adult' && w.__settings.getState().avatarIdx === 4 && w.__done === 1, [w.__settings.getState().ageMode, w.__settings.getState().avatarIdx, w.__done]);
  ck('"Try this message" opens the composer with the sample message waiting (not sent)', w.__aiChat.getState().composerOpen === true && /weight 82\.5, morning walk done/.test(w.__aiChat.getState().prefillText));
  ck('no legacy single-goal field is sent (the server derives it)', put && put.body.goal === undefined);
  ck('no error escaped', errors.length === 0, errors.join('|'));
}

// ═══════════════════════════════════════════════════════════════════════════
// 13. My Health (Profile) + Login (Sprint 7b)
// ═══════════════════════════════════════════════════════════════════════════
async function profileTest() {
  console.log('\n[13] My Health — goal, plan, insights, account; Login — remembered member');
  const api = stub('api-profile.js', `
    import { istDaysAgo } from '${CONSTANTS_JS}';
    window.__calls = [];
    const me = { id: 214, name: 'Asha Rao', phone: '9876543210', member_since: istDaysAgo(44) + 'T09:00:00.000Z',
      dob: '1985-03-10', gender: 'female', height_cm: '160', start_weight: '88', target_weight: '78', current_weight: '82.4',
      goal: 'lose', goals: ['lose', 'sleep', 'energy'], conditions: ['hypothyroid'], diet_notes: 'No fried food on weekdays.',
      water_target: 3000, monitor_name: 'Sachin', total_logs: 41, avg_compliance: 71, labs: [], coach_notes: [],
      macros: { kcal: 1600, pro: 110, carb: 140, fat: 55 }, fasting: null,
      today_energy: { date: istDaysAgo(0), is_today: true, food_items: [], activities: {}, workout_kcal: 0 } };
    const routes = [
      [/^\\/members\\/me$/, () => me],
      [/^\\/members\\/me\\/labs$/, () => ({ labs: [] })],
      [/^\\/members\\/me\\/lab-analysis$/, () => ({ intervals: [], flags: [] })],
      [/^\\/members\\/me\\/adaptive$/, () => ({ ready: false })],
      [/^\\/members\\/population\\/prior$/, () => ({})],
      [/^\\/ai-chat\\/portions$/, () => ({ portions: [] })],
    ];
    const get = async (url) => { window.__calls.push(url); const hit = routes.find(([re]) => re.test(url)); return { data: hit ? hit[1]() : {} }; };
    export default { get, post: async () => ({ data: {} }), put: async () => ({ data: {} }), patch: async (url, body) => ({ data: body }), delete: async () => ({ data: {} }) };`);

  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
    import Profile from './pages/Profile.jsx';
    import { useAuthStore } from './store/authStore.js';
    import { useSettingsStore } from './store/settingsStore.js';
    useAuthStore.setState({ user: { id: 214, name: 'Asha Rao', role: 'patient' }, isRestoring: false, logout: () => { window.__loggedOut = true; } });
    useSettingsStore.setState({ avatarIdx: 4 });
    function Where() { const l = useLocation(); return <div data-testid="elsewhere">{l.pathname}</div>; }
    createRoot(document.getElementById('root')).render(
      <MemoryRouter initialEntries={['/profile']}><Routes><Route path="/profile" element={<Profile />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);`, api);
  const { w, errors, html } = run(code);
  await tick(700);
  const d = w.document;
  const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('Profile mounts', errors.length === 0, errors.join('|'));
  ck('identity: avatar from the device, name, Week 7, coach', /🦁/.test(html()) && /Asha Rao/.test(html()) && /Week 7/.test(q('profile-meta').textContent) && /Coach Sachin/.test(q('profile-meta').textContent), q('profile-meta')?.textContent);
  ck('goal headline from the primary goal and the weights: "Lose 10 kg · 4.4 kg to go"', q('profile-goal') && /Lose 10 kg · 4\.4 kg to go/.test(q('profile-goal').textContent), q('profile-goal')?.textContent.slice(0, 80));
  ck('secondary goals shown as chips (Sleep better, More energy)', q('profile-goals') && /Sleep better/.test(q('profile-goals').textContent) && /More energy/.test(q('profile-goals').textContent) && !/Lose weight/.test(q('profile-goals').textContent));
  ck('journey line: start 88 → goal 78, 56% there', /56% there/.test(q('profile-goal').textContent) && /88 kg/.test(q('profile-goal').textContent) && /78 kg/.test(q('profile-goal').textContent));
  ck('"Connected devices" is listed once (its own section), not again under Account', (d.body.textContent.match(/Connected devices/g) || []).length === 1, (d.body.textContent.match(/Connected devices/g) || []).length);
  ck('sections in order: My plan → Health insights → Devices → Account', ['section-plan', 'section-insights', 'section-devices', 'section-account'].map(id => q(id)).every(Boolean) &&
     q('section-plan').compareDocumentPosition(q('section-insights')) & 4 && q('section-insights').compareDocumentPosition(q('section-devices')) & 4 && q('section-devices').compareDocumentPosition(q('section-account')) & 4);
  ck('My plan shows the macro targets, water target and diet notes', /1600|1,600/.test(q('section-plan').textContent) && /3\.0|3000/.test(q('section-plan').textContent) && /No fried food/.test(q('section-plan').textContent));
  ck('Health insights: BMI, TDEE, conditions, labs, metabolism, portions — one line each, closed', ['ins-tdee', 'ins-bmi', 'ins-conditions', 'ins-labs', 'ins-metabolism', 'ins-portions'].every(id => q(id) && q(id).dataset.open === '0'));
  ck('BMI summary line is right for 82.4 kg / 160 cm (32.2)', /32\.2/.test(q('ins-bmi').textContent), q('ins-bmi').textContent);
  ck('conditions summary counts them', /1 noted/.test(q('ins-conditions').textContent));
  q('ins-bmi').querySelector('button').click(); await tick(100);
  ck('opening BMI reveals the full card', q('ins-bmi').dataset.open === '1' && /Body Mass Index/.test(q('ins-bmi').textContent) && /Obese/.test(q('ins-bmi').textContent) && /18.5/.test(q('ins-bmi').textContent), [q('ins-bmi').dataset.open, q('ins-bmi').textContent.length, q('ins-bmi').textContent.slice(0, 100)]);
  ck('the gear at the top and the Account row both go to Settings', q('profile-settings') && q('account-settings'));
  q('account-signout').click(); await tick(50);
  ck('Sign out calls the auth store logout', w.__loggedOut === true);
  q('profile-settings').click(); await tick(100);
  ck('the gear navigates to /settings', q('elsewhere') && q('elsewhere').textContent === '/settings');
  ck('no error escaped', errors.length === 0, errors.join('|'));

  // ── Login with a remembered member ─────────────────────────────────────
  const loginCode = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    localStorage.setItem('fl-last-member', JSON.stringify({ name: 'Asha Rao', phone: '9876543210' }));
    import Login from './pages/Login.jsx';
    import { useSettingsStore } from './store/settingsStore.js';
    useSettingsStore.setState({ avatarIdx: 4 });
    createRoot(document.getElementById('root')).render(<MemoryRouter><Login /></MemoryRouter>);`, api);
  const L = run(loginCode); await tick(300);
  const ld = L.w.document; const lq = (id) => ld.querySelector(`[data-testid="${id}"]`);
  ck('Login mounts', L.errors.length === 0, L.errors.join('|'));
  ck('remembered member card: avatar, "Welcome back", first name, phone prefilled', lq('remembered-card') && /🦁/.test(lq('remembered-card').textContent) && /Welcome back/.test(lq('remembered-card').textContent) && /Asha/.test(lq('remembered-card').textContent) && lq('login-phone').value === '9876543210', lq('remembered-card')?.textContent);
  ck('phone and PIN fields are large (56px) and the PIN is spaced, one field (PINs can be longer than 4)', /min-height: 56px/.test(lq('login-phone').getAttribute('style')) && /min-height: 56px/.test(lq('login-pin').getAttribute('style')) && /letter-spacing/.test(lq('login-pin').getAttribute('style')) && lq('login-pin').tagName === 'INPUT');
  ck('Log In is disabled until a PIN is typed', lq('login-submit').disabled);
  const setV = (el, v) => { const setter = Object.getOwnPropertyDescriptor(L.w.HTMLInputElement.prototype, 'value').set; setter.call(el, v); el.dispatchEvent(new L.w.Event('input', { bubbles: true })); };
  setV(lq('login-pin'), '123456'); await tick(50);
  ck('a six-digit PIN is accepted by the form (no four-box limit)', !lq('login-submit').disabled && lq('login-pin').value === '123456');
}

// ═══════════════════════════════════════════════════════════════════════════
// 14. Coach home — Needs attention (Sprint 8)
// ═══════════════════════════════════════════════════════════════════════════
async function triageTest() {
  console.log('\n[14] Coach home — Needs attention feed');
  const api = stub('api-triage.js', `
    window.__calls = []; window.__opened = [];
    const triage = { today: '2026-09-08', counts: { total: 4, on_track: 1, watch: 0, attention: 2, high: 1 }, members: [
      { id: 1, name: 'Quiet Five', phone: '9000009002', priority: 'high', reasons: ['Quiet 5 days'], wins: [], action: { key: 'nudge', label: 'Send a nudge' }, week: [1,1,0,0,0,0,0], logged_days: 2, streak: 0, days_since_log: 5, unread: 0 },
      { id: 2, name: 'Daya Sleepy', phone: '9000009005', priority: 'attention', reasons: ['Sleep down 3 h', '1 unread message'], wins: [], action: { key: 'reply', label: 'Reply' }, week: [1,1,1,1,1,1,1], logged_days: 7, streak: 8, days_since_log: 0, unread: 1 },
      { id: 3, name: 'Vishwas Gain', phone: '9000009004', priority: 'attention', reasons: ['Weight up 1.8 kg / 2 wk'], wins: [], action: { key: 'review', label: 'Review meals' }, week: [1,0,1,0,1,0,1], logged_days: 4, streak: 1, days_since_log: 0, unread: 0 },
      { id: 4, name: 'Asha Star', phone: '9000009003', priority: 'ok', reasons: [], wins: ['8-day streak', 'Down 1.1 kg / 2 wk'], action: { key: 'praise', label: 'Send praise' }, week: [1,1,1,1,1,1,1], logged_days: 7, streak: 8, days_since_log: 0, unread: 0 },
    ] };
    const get = async (url) => { window.__calls.push(url); if (/\\/members\\/triage$/.test(url)) return { data: triage }; if (/\\/members\\/gaps$/.test(url)) return { data: { members: [], clear: 0 } }; if (/\\/members\\/morning-nudges/.test(url)) return { data: { members: [] } }; if (/^\\/members$/.test(url)) return { data: [] }; return { data: {} }; };
    export default { get, post: async () => ({ data: {} }), put: async () => ({ data: {} }), patch: async () => ({ data: {} }), delete: async () => ({ data: {} }) };`);
  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
    import MemberList from './pages/PatientList.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 300, name: 'Sachin', role: 'monitor' }, isRestoring: false });
    window.open = (url) => { window.__opened.push(url); return null; };
    function Where() { const l = useLocation(); return <div data-testid="elsewhere">{l.pathname}</div>; }
    createRoot(document.getElementById('root')).render(
      <MemoryRouter initialEntries={['/coach']}><Routes><Route path="/coach" element={<MemberList />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);`, api);
  const { w, errors, html } = run(code);
  await tick(700);
  const d = w.document;
  const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('coach home mounts and asks for /members/triage once', errors.length === 0 && w.__calls.filter(u => /triage/.test(u)).length === 1, [errors.join('|'), w.__calls]);
  ck('the feed is the first thing on the screen (above "Needs a nudge")', q('triage') && html().indexOf('data-testid="triage"') < html().indexOf('Needs a nudge'));
  ck('header counts: 4 members · 1 on track · 2 need attention · 1 high', /4/.test(q('triage-counts').textContent) && /1.*on track/.test(q('triage-counts').textContent) && /2.*need attention/.test(q('triage-counts').textContent) && /1.*high/.test(q('triage-counts').textContent), q('triage-counts').textContent);
  const rows = [...d.querySelectorAll('[data-testid="triage-row"]')];
  ck('three rows need attention, worst first; the on-track member is folded away', rows.length === 3 && rows[0].dataset.priority === 'high' && !/Asha Star/.test(q('triage').textContent), rows.map(r => r.dataset.priority));
  ck('a combined reason line: "Sleep down 3 h + 1 unread message"', rows.some(r => /Sleep down 3 h \+ 1 unread message/.test(r.querySelector('[data-testid="triage-line"]').textContent)));
  ck('each row has a 7-dot week strip', rows.every(r => r.querySelectorAll('span.w-1\\.5').length === 7));
  rows[0].querySelector('[data-testid="triage-action"]').click(); await tick(50);
  ck('"Send a nudge" opens WhatsApp with a draft naming the member and the quiet days (nothing sent by the app)', w.__opened.length === 1 && /wa\.me\/919000009002/.test(w.__opened[0]) && /Quiet/.test(decodeURIComponent(w.__opened[0])) && /5 days/.test(decodeURIComponent(w.__opened[0])), w.__opened);
  q('triage-toggle-ok').click(); await tick(50);
  const okRow = [...d.querySelectorAll('[data-testid="triage-row"]')].find(r => /Asha Star/.test(r.textContent));
  ck('"1 on track · tap to see" reveals the star with her wins', okRow && /8-day streak · Down 1.1 kg/.test(okRow.textContent) && /Send praise/.test(okRow.textContent));
  okRow.querySelector('[data-testid="triage-action"]').click(); await tick(50);
  ck('"Send praise" drafts a WhatsApp with the win', w.__opened.length === 2 && /streak/.test(decodeURIComponent(w.__opened[1])));
  const daya = [...d.querySelectorAll('[data-testid="triage-row"]')].find(r => /Daya/.test(r.textContent));
  daya.querySelector('[data-testid="triage-action"]').click(); await tick(100);
  ck('"Reply" opens the member page', q('elsewhere') && q('elsewhere').textContent === '/coach/2', q('elsewhere')?.textContent);
  ck('no error escaped', errors.length === 0, errors.join('|'));
}

// ═══════════════════════════════════════════════════════════════════════════
// 15. Coach member page — brief + segmented tabs (Sprint 9)
// ═══════════════════════════════════════════════════════════════════════════
async function memberBriefTest() {
  console.log('\n[15] Coach member page — brief and tabs');
  const api = stub('api-brief.js', `
    window.__calls = [];
    const brief = { id: 214, name: 'Asha Rao', priority: 'attention', streak: 8, brief: [
      'Today: weight 82.4 kg · 2 meals · 666 kcal · 37 g protein · water 1.5 L · protocol 3 ticked.',
      'Weight down 1.1 kg over 2 weeks · 8-day logging streak.',
      'Needs attention: sleep down 1.4 h.' ] };
    const get = async (url) => { window.__calls.push(url); if (/\\/members\\/214\\/brief$/.test(url)) return { data: brief }; if (/\\/members\\/999\\/brief$/.test(url)) throw new Error('500'); return { data: {} }; };
    export default { get, post: async () => ({ data: {} }), put: async () => ({ data: {} }), patch: async () => ({ data: {} }), delete: async () => ({ data: {} }) };`);
  const code = await bundle(`
    import { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import MemberBrief from './components/coach/MemberBrief.jsx';
    import { Segmented } from './components/primitives/index.js';
    function Harness() {
      const [k, setK] = useState(0); const [tab, setTab] = useState('today');
      window.__bump = () => setK(x => x + 1);
      return (<div>
        <MemberBrief memberId={214} refreshKey={k} />
        <MemberBrief memberId={999} />
        <Segmented name="coach-tabs" value={tab} onChange={setTab} options={[{ id: 'today', label: 'Today' }, { id: 'nutrition', label: 'Nutrition' }, { id: 'training', label: 'Training' }, { id: 'labs', label: 'Labs' }]} />
        <span id="tab">{tab}</span>
      </div>);
    }
    createRoot(document.getElementById('root')).render(<Harness />);`, api);
  const { w, errors } = run(code); await tick(300);
  const d = w.document;
  const briefs = [...d.querySelectorAll('[data-testid="member-brief"]')];
  ck('the brief mounts from GET /members/:id/brief with three lines and the priority', errors.length === 0 && briefs.length === 1 && briefs[0].querySelectorAll('[data-testid="brief-lines"] li').length === 3 && /Needs attention/.test(briefs[0].querySelector('[data-testid="brief-priority"]').textContent), [errors.join('|'), briefs.length]);
  ck('lines read today → trend → call', /^Today: weight 82\.4 kg/.test(briefs[0].querySelectorAll('li')[0].textContent) && /Weight down 1\.1 kg/.test(briefs[0].querySelectorAll('li')[1].textContent) && /sleep down 1\.4 h/.test(briefs[0].querySelectorAll('li')[2].textContent));
  ck('a failed brief renders nothing — the member page still works without it', briefs.length === 1 && w.__calls.filter(u => /999/.test(u)).length === 1);
  const before = w.__calls.filter(u => /214\/brief/.test(u)).length;
  w.__bump(); await tick(200);
  ck('a refreshKey bump re-reads the brief', w.__calls.filter(u => /214\/brief/.test(u)).length === before + 1);
  const tabs = [...d.querySelectorAll('[role=tab]')];
  tabs[2].click(); await tick(50);
  ck('the coach tabs are a segmented control (Today · Nutrition · Training · Labs), no emoji', tabs.length === 4 && tabs.map(t => t.textContent.trim()).join(',') === 'Today,Nutrition,Training,Labs' && d.getElementById('tab').textContent === 'training');
}

// ═══════════════════════════════════════════════════════════════════════════
// 16. Member page 9b — action sheet, read-only timeline, admin shortcut
// ═══════════════════════════════════════════════════════════════════════════
async function memberPage9bTest() {
  console.log('\n[16] Member page — action sheet, timeline, Full log; admin Coach view');
  const api = stub('api-9b.js', `
    import { istDaysAgo } from '${CONSTANTS_JS}';
    window.__calls = []; window.__posts = [];
    const T = istDaysAgo(0), Y = istDaysAgo(1);
    const member = { profile: { id: 12, name: 'Daya Kumar', phone: '9000000012', height_cm: 168, start_weight: 86, target_weight: 76, current_weight: 81.2, meal_slots: ['Breakfast', 'Lunch', 'Dinner'], macros: { kcal: 1700, pro: 115 }, water_target: 3000, activities: [], acv: [], supplements: [], conditions: [], has_pin: true },
      logs: [ { log_date: T, weight_kg: '81.2', food_items: [{ name: 'Idli', grams: 120, meal: 'Breakfast', per_100g: { calories: 130, protein: 3.5 } }, { name: 'Dal', grams: 200, meal: 'Lunch', per_100g: { calories: 110 } }], water_ml: 1250, activities: {}, acv: {}, supplements: {}, sleep: { bedtime: '23:00', waketime: '06:30' }, compliance_pct: 40, notes: 'felt tired' },
              { log_date: Y, weight_kg: '81.6', food_items: [], water_ml: 2600, activities: {}, acv: {}, supplements: {}, sleep: {}, compliance_pct: 85, notes: '' } ],
      labs: [], notes: [] };
    const get = async (url) => { window.__calls.push(url); if (/\\/members\\/12$/.test(url)) return { data: member }; if (/\\/members\\/12\\/brief$/.test(url)) return { data: { priority: 'ok', brief: ['a', 'b', 'c'] } }; if (/\\/workouts\\/summary/.test(url)) return { data: { sessions: [] } }; if (/\\/workouts/.test(url)) return { data: { exercises: [], cardio: [], session: null } }; if (/\\/logs\\/range/.test(url)) return { data: member.logs }; return { data: {} }; };
    const post = async (url, body) => { window.__posts.push({ url, body }); return { data: { id: 77, ...body, monitor_name: 'Sachin' } }; };
    export default { get, post, put: post, patch: post, delete: post };`);
  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter, Routes, Route } from 'react-router-dom';
    import Monitor from './pages/Monitor.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 300, name: 'Sachin', role: 'admin' }, isRestoring: false });
    window.open = (url) => { (window.__opened ||= []).push(url); return null; };
    createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/coach/12']}><Routes><Route path="/coach/:memberId" element={<Monitor />} /></Routes></MemoryRouter>);`, api);
  const { w, errors, html } = run(code); await tick(900);
  const d = w.document; const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('member page mounts', errors.length === 0, errors.join('|'));
  const tl = q('coach-timeline');
  ck('the member\'s timeline shows on the coach page, read-only: weight, Breakfast, Lunch, water, sleep — no chevrons, no buttons',
     !!tl && ['row-weight', 'row-meal', 'row-water', 'row-sleep'].every(id => tl.querySelector(`[data-testid="${id}"]`)) && tl.querySelectorAll('[data-testid="row-meal"]').length === 2 && tl.querySelectorAll('button').length === 0, tl && tl.textContent.slice(0, 160));
  ck('timeline uses the MEMBER\'s meal slots (Breakfast before Lunch) and the weight delta vs the previous log (↓ 0.4)', /Breakfast[\s\S]*Lunch/.test(tl.textContent) && /↓ 0\.4/.test(tl.textContent), tl.textContent.slice(0, 120));
  ck('the full coach detail is collapsed under "Full log" with the compliance summary', q('full-log') && q('full-log').dataset.open === '0' && /40%/.test(q('full-log').textContent));
  q('full-log').querySelector('button').click(); await tick(100);
  ck('opening Full log reveals the detail (the member\'s note appears)', q('full-log').dataset.open === '1' && /felt tired/.test(q('full-log').textContent));

  // action sheet
  ck('no sheet at rest', !d.querySelector('[role=dialog]'));
  q('open-note').click(); await tick(300);
  let dlg = d.querySelector('[role=dialog]');
  ck('"Add Note" opens the action sheet on the Note tab, with Note · Message · Push tabs for an admin', !!dlg && /Add a note/.test(dlg.textContent) && [...dlg.querySelectorAll('[role=tab]')].map(t => t.textContent.trim()).join(',') === 'Note,Message,Push', dlg && [...dlg.querySelectorAll('[role=tab]')].map(t => t.textContent.trim()));
  const setV = (el, v) => { const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  ck('Save is disabled until there is text', q('note-save').disabled);
  setV(q('note-text'), 'Asked her to add a walk after dinner'); q('note-flagged').click(); await tick(50);
  q('note-save').click(); await tick(700);
  const notePost = w.__posts.find(p => /\/members\/12\/notes$/.test(p.url));
  ck('saving POSTs the note with the flag, closes the sheet, and the note appears on the page', notePost && notePost.body.flagged === true && /walk after dinner/.test(notePost.body.note) && !d.querySelector('[role=dialog]') && /walk after dinner/.test(html()), [notePost && JSON.stringify(notePost.body), !!d.querySelector('[role=dialog]'), /walk after dinner/.test(html())]);
  q('open-message').click(); await tick(300);
  dlg = d.querySelector('[role=dialog]');
  ck('"Message" opens the same sheet on the Message tab with WhatsApp/SMS from the coach\'s own phone', !!dlg && /Send a message/.test(dlg.textContent) && /WhatsApp/.test(dlg.textContent));
  dlg.querySelectorAll('[role=tab]')[2].click(); await tick(100);
  ck('Push tab: title and body, sends via POST /admin/push for this member', !!q('push-title') && !!q('push-body'));
  setV(q('push-body'), 'Please log lunch'); q('push-send').click(); await tick(200);
  const push = w.__posts.find(p => /\/admin\/push$/.test(p.url));
  ck('push POST carries patient_id 12 and the text', push && push.body.patient_id === 12 && /log lunch/.test(push.body.body) && !!q('push-done'), push && push.body);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(700);
  ck('Escape closes the sheet', !d.querySelector('[role=dialog]'));

  // a coach (not admin) gets no Push tab
  const code2 = await bundle(`
    import { createRoot } from 'react-dom/client';
    import MemberActionSheet from './components/coach/MemberActionSheet.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 301, name: 'Veeru', role: 'monitor' }, isRestoring: false });
    createRoot(document.getElementById('root')).render(<MemberActionSheet open onClose={() => {}} member={{ id: 12, name: 'Daya Kumar', phone: '9000000012' }} initialTab="message" />);`, api);
  const R = run(code2); await tick(300);
  ck('a coach sees Note · Message only (push is admin-only on the server too)', [...R.w.document.querySelectorAll('[role=tab]')].map(t => t.textContent.trim()).join(',') === 'Note,Message');
  ck('no error escaped', errors.length === 0 && R.errors.length === 0, [errors.join('|'), R.errors.join('|')]);
}

// ═══════════════════════════════════════════════════════════════════════════
// 17. The cached read (Sprint 10) — same words as WhatsApp/push
// ═══════════════════════════════════════════════════════════════════════════
async function cachedReadTest() {
  console.log('\n[17] Cached read on Today');
  const api = stub('api-read.js', `
    import { today, istDaysAgo } from '${CONSTANTS_JS}';
    const T = today();
    window.__calls = [];
    const log = { weight_kg: '82.4', activities: {}, acv: {}, supplements: {}, food_items: [], water_ml: 0, sleep: {}, notes: '',
      protocol: { activities: [], acv: [], supplements: [], macros: { kcal: 1800 }, water_target: 3000 } };
    const CACHED = 'Yesterday: 1,650 kcal · 82.7 kg. Push · Mon today — weigh in when you are up.';
    const get = async (url) => {
      window.__calls.push(url);
      if (new RegExp('^/logs/' + T + '$').test(url)) return { data: log };
      if (/^\\/members\\/me\\/read$/.test(url)) return { data: { date: T, read: { kind: 'morning', text: CACHED, facts: {} } } };
      if (/^\\/members\\/me$/.test(url)) return { data: {} };
      if (/^\\/logs\\/range/.test(url)) return { data: [] };
      if (/^\\/members\\/me\\/today$/.test(url)) return { data: {} };
      if (/^\\/workouts/.test(url)) return { data: { exercises: [], cardio: [], session: null } };
      return { data: {} };
    };
    export default { get, post: async () => ({ data: {} }), put: async () => ({ data: {} }), patch: async () => ({ data: {} }), delete: async () => ({ data: {} }) };`);
  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import DailyLog from './pages/DailyLog.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 214, name: 'Asha Rao', role: 'patient' }, isRestoring: false });
    createRoot(document.getElementById('root')).render(<MemoryRouter><DailyLog /></MemoryRouter>);`, api);
  const { w, errors } = run(code); await tick(900);
  const d = w.document; const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('Today asks for the cached read once', errors.length === 0 && w.__calls.filter(u => /me\/read/.test(u)).length === 1, [errors.join('|'), w.__calls.filter(u => /me\/read/.test(u))]);
  ck('the cached sentence is what Today shows — the same words the member got by WhatsApp', /Yesterday: 1,650 kcal · 82\.7 kg/.test(q('ai-read').textContent), q('ai-read').textContent.slice(0, 120));
  // The action is time-gated in IST: before 09:00 a member who already logged
  // their weight has nothing outstanding, so no button is the right answer.
  const istH2 = parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }), 10) % 24;
  ck('the read carries its one action once the day is under way (none before 09:00 for a member who already weighed in)',
     istH2 >= 9 ? !!q('read-action') : !q('read-action'), [istH2, q('read-action')?.textContent]);
  ck('the local read did not also render', !/Fresh day|Nothing logged today/.test(q('ai-read').textContent));
  // going back a day re-asks for that day's read
  const before = w.__calls.filter(u => /me\/read/.test(u)).length;
  q('date-nav').querySelector('[aria-label="Previous day"]').click(); await tick(800);
  ck('changing the day re-reads for that date', w.__calls.filter(u => /me\/read/.test(u)).length === before + 1, w.__calls.filter(u => /me\/read/.test(u)));
}

// ═══════════════════════════════════════════════════════════════════════════
// 18. Meal idea + weekly review sections (Sprint 11)
// ═══════════════════════════════════════════════════════════════════════════
async function sprint11Test() {
  console.log('\n[18] Meal idea sheet + weekly review sections');
  const api = stub('api-s11.js', `
    import { today } from '${CONSTANTS_JS}';
    const T = today();
    window.__calls = [];
    const log = { weight_kg: '82.4', activities: {}, acv: {}, supplements: {},
      food_items: [{ name: 'Idli', grams: 240, meal: 'Breakfast', per_100g: { calories: 130, protein: 3.5, total_carbs: 28, fat: 0.8 } }],
      water_ml: 1000, sleep: {}, notes: '',
      protocol: { activities: [], acv: [], supplements: [], macros: { kcal: 1800, pro: 120 }, water_target: 3000 } };
    const recent = [
      { food_id: 1, name: 'Idli',             per_100g: { calories: 130, protein: 3.5 }, last_g: 120, count: 9 },
      { food_id: 2, name: 'Paneer (Low Fat)', per_100g: { calories: 204, protein: 18  }, last_g: 150, count: 5 },
    ];
    const weekly = { latest: { week_start: '2026-08-31', week_end: '2026-09-06', created_at: new Date().toISOString(), coach_note: 'Strong week.',
        data: { daysLogged: 7, prevDaysLogged: 4, weekDelta: -0.6, workoutDays: 3, avgKcal: 1650, kcalTarget: 1800, avgPro: 105, proTarget: 120, weighInCount: 7, latestWeight: 82.4 } },
      sections: { wins: ['Logged every day this week.', 'Down 0.6 kg this week.'], opportunities: ['Protein averaged 105 g against 120 g.'],
        pattern: 'Weight moved in the weeks you trained. That is the lever.', next: ['Train 4× next week.'] }, history: [] };
    const get = async (url) => {
      window.__calls.push(url);
      if (new RegExp('^/logs/' + T + '$').test(url)) return { data: log };
      if (/^\\/logs\\/recent-foods$/.test(url)) return { data: recent };
      if (/^\\/members\\/me\\/weekly-report$/.test(url)) return { data: weekly };
      if (/^\\/logs\\/range/.test(url)) return { data: [] };
      return { data: {} };
    };
    export default { get, post: async () => ({ data: {} }), put: async () => ({ data: {} }), patch: async () => ({ data: {} }), delete: async () => ({ data: {} }) };`);

  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import DailyLog from './pages/DailyLog.jsx';
    import { useAuthStore } from './store/authStore.js';
    import { useLogStore } from './store/logStore.js';
    useAuthStore.setState({ user: { id: 214, name: 'Asha Rao', role: 'patient' }, isRestoring: false });
    window.__logStore = useLogStore;
    createRoot(document.getElementById('root')).render(<MemoryRouter><DailyLog /></MemoryRouter>);`, api);
  const { w, errors, html } = run(code); await tick(900);
  const d = w.document; const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('Today mounts', errors.length === 0, errors.join('|'));
  ck('the Eat row offers "What to eat"', !!q('chip-mealidea') && /What to eat/.test(q('chip-mealidea').textContent));
  q('chip-mealidea').click(); await tick(500);
  const dlg = d.querySelector('[role=dialog]');
  ck('it opens the meal-idea sheet and asks for the member\'s usual foods', !!dlg && w.__calls.some(u => /recent-foods/.test(u)));
  // 312 kcal in, 8.4 g protein → 1,488 kcal and ~112 g protein left
  ck('the headline names the protein gap', /g protein left/.test(dlg.textContent), dlg.textContent.slice(0, 100));
  const items = [...dlg.querySelectorAll('[data-testid="idea-item"]')];
  ck('it suggests the protein-dense food first, at the member\'s usual grams', items.length >= 1 && /Paneer/.test(items[0].textContent) && /150 g/.test(items[0].textContent), items.map(i => i.textContent));
  const before = (w.__logStore.getState().log.food || []).length;
  q('idea-add').click(); await tick(200);
  const after = w.__logStore.getState().log.food || [];
  ck('"Add to today" writes the items into the day\'s food log with their per-100g data',
     after.length === before + items.length && after[after.length - 1].per_100g?.calories > 0, after.map(f => f.name + ' ' + f.grams));
  ck('the button confirms rather than adding twice', /Added/.test(q('idea-add').textContent));
  q('idea-add').click(); await tick(300);
  ck('a second tap closes instead of duplicating', (w.__logStore.getState().log.food || []).length === after.length);

  // ── weekly review sections on Progress ────────────────────────────────
  const progressCode = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import WeeklyReportCard from './components/WeeklyReportCard.jsx';
    createRoot(document.getElementById('root')).render(<MemoryRouter><WeeklyReportCard /></MemoryRouter>);`, api);
  const P = run(progressCode); await tick(400);
  const pd = P.w.document; const pq = (id) => pd.querySelector(`[data-testid="${id}"]`);
  ck('the weekly card renders Wins · Opportunities · Pattern · Next week', !!pq('week-sections') && !!pq('week-wins') && !!pq('week-opportunities') && !!pq('week-pattern') && !!pq('week-next'));
  ck('wins carry the numbers that prove them', /Logged every day this week/.test(pq('week-wins').textContent) && /Down 0\.6 kg/.test(pq('week-wins').textContent));
  ck('the coach\'s note still sits above the sections', pd.body.innerHTML.indexOf('Strong week.') < pd.body.innerHTML.indexOf('data-testid="week-sections"'));
  ck('next week is one concrete ask', /Train 4× next week/.test(pq('week-next').textContent));
  ck('no error escaped', errors.length === 0 && P.errors.length === 0, [errors.join('|'), P.errors.join('|')]);
}

// ═══════════════════════════════════════════════════════════════════════════
// 19. Workout companion + health markers (Sprint 11b)
// ═══════════════════════════════════════════════════════════════════════════
async function sprint11bTest() {
  console.log('\n[19] Workout companion (suggested load) + health markers (↓ from)');
  const api = stub('api-s11b.js', `
    import { today, istDaysAgo } from '${CONSTANTS_JS}';
    const T = today(), Y = istDaysAgo(3);
    window.__calls = []; window.__posts = [];
    const workout = { exercises: [{ exercise_id: 7, exercise_name: 'Bench press', sets: [{ reps: '', weight_kg: '' }] }], cardio: [], session: null,
      program_day: { exercises: [{ exercise_id: 7, exercise_name: 'Bench press', target_sets: 3, target_reps_min: 8, target_reps_max: 12 }] } };
    const history = [ { session_date: Y, set_number: 1, reps: 12, weight_kg: '40' }, { session_date: Y, set_number: 2, reps: 12, weight_kg: '40' } ];
    const analysis = { comparisons: [
      { test_name: 'HbA1c', unit: '%', from: 6.1, to: 5.8, direction: 'improved', from_state: 'high', to_state: 'borderline', interval_days: 90, from_date: '2026-06-01', to_date: '2026-09-01' },
      { test_name: 'LDL',   unit: 'mg/dL', from: 110, to: 128, direction: 'worsened', interval_days: 90, from_date: '2026-06-01', to_date: '2026-09-01' },
      { test_name: 'TSH',   unit: 'mIU/L', from: 2.1, to: 2.2, direction: 'stable', interval_days: 90, from_date: '2026-06-01', to_date: '2026-09-01' },
    ], out_of_range: [] };
    const get = async (url) => {
      window.__calls.push(url);
      if (/^\\/workouts\\/history\\/7$/.test(url)) return { data: history };
      if (/^\\/workouts$/.test(url)) return { data: workout };
      if (/^\\/programs\\/active/.test(url)) return { data: { program: { id: 1, name: 'Foundation' }, days: [{ id: 1, day_label: 'Push', exercises: [{ exercise_id: 7, exercise_name: 'Bench press', target_sets: 3, target_reps_min: 8, target_reps_max: 12 }] }] } };
      if (/^\\/members\\/me\\/lab-analysis$/.test(url)) return { data: analysis };
      if (/^\\/members\\/me\\/labs$/.test(url)) return { data: { labs: [] } };
      return { data: {} };
    };
    export default { get, post: async (u, b) => { window.__posts.push({ u, b }); return { data: {} }; }, put: async () => ({ data: {} }), patch: async () => ({ data: {} }), delete: async () => ({ data: {} }) };`);

  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import WorkoutLog from './components/WorkoutLog.jsx';
    import LabResults from './components/LabResults.jsx';
    import { today } from './constants.js';
    createRoot(document.getElementById('root')).render(<MemoryRouter><div><WorkoutLog date={today()} /><LabResults /></div></MemoryRouter>);`, api);
  const { w, errors, html } = run(code); await tick(900);
  const d = w.document; const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('workout log and labs mount', errors.length === 0, errors.join('|'));
  ck('the companion shows last time AND a suggestion from the coach\'s 8–12 range: 40 × 12 → Try 42.5 kg × 8',
     /Last time: 40 kg × 12/.test(html()) && q('load-suggestion') && /Try 42\.5 kg × 8/.test(q('load-suggestion').textContent), q('load-suggestion')?.textContent);
  ck('the reason is plain English', /You hit 12 at 40 kg/.test(q('load-suggestion').textContent), q('load-suggestion').textContent);
  q('use-suggestion').click(); await tick(100);
  const inputs = [...d.querySelectorAll('input[type=number]')];
  const vals = inputs.map(i => i.value);
  ck('"Use" prefills the empty set with 42.5 kg × 8 (the member can still edit)', vals.includes('42.5') && vals.includes('8'), vals);

  ck('labs: the summary line counts markers by direction', q('lab-summary') && /1 marker improved · 1 marker worse · 1 steady/.test(q('lab-summary').textContent), q('lab-summary')?.textContent.slice(0, 80));
  const markers = [...d.querySelectorAll('[data-testid="lab-marker"]')];
  ck('each marker reads latest ↓/↑ from previous (HbA1c 5.8 ↓ from 6.1; LDL 128 ↑ from 110)',
     markers.length === 3 && /HbA1c/.test(markers[0].textContent) && /5\.8/.test(markers[0].textContent) && /↓ from 6\.1/.test(markers[0].textContent) && /↑ from 110/.test(markers[1].textContent), markers.map(m => m.textContent));
  ck('the full comparison cards are behind View all', !q('lab-details') && !!q('lab-view-all'));
  q('lab-view-all').click(); await tick(100);
  ck('View all reveals them (with the interval and state change)', !!q('lab-details') && /90 days/.test(q('lab-details').textContent) && /high → borderline/.test(q('lab-details').textContent));
  ck('no error escaped', errors.length === 0, errors.join('|'));
}

// ═══════════════════════════════════════════════════════════════════════════
// 20. Settings groups + recovery card (Sprint 11c)
// ═══════════════════════════════════════════════════════════════════════════
async function sprint11cTest() {
  console.log('\n[20] Settings groups + recovery card');
  const api = stub('api-s11c.js', `
    import { today, istDaysAgo } from '${CONSTANTS_JS}';
    const T = today();
    window.__calls = []; window.__trackerDays ||= [];
    const log = { weight_kg: '82.4', activities: {}, acv: {}, supplements: {}, food_items: [], water_ml: 0, sleep: {}, notes: '',
      protocol: { activities: [], acv: [], supplements: [], macros: { kcal: 1800 }, water_target: 3000 } };
    const get = async (url) => {
      window.__calls.push(url);
      if (new RegExp('^/logs/' + T + '$').test(url)) return { data: log };
      if (/^\\/trackers\\/data/.test(url)) return { data: { data: window.__trackerDays } };
      if (/^\\/notifications\\/subscriptions/.test(url)) return { data: [] };
      if (/^\\/notifications\\/log/.test(url)) return { data: [] };
      if (/^\\/trackers\\/status/.test(url)) return { data: { connections: [] } };
      if (/^\\/push\\/subscriptions/.test(url)) return { data: [] };
      if (/^\\/reminders\\/my-schedule/.test(url)) return { data: { schedules: [] } };
      if (/^\\/members\\/me\\/notification-preferences/.test(url)) return { data: {} };
      if (/^\\/logs\\/range/.test(url)) return { data: [] };
      return { data: {} };
    };
    export default { get, post: async () => ({ data: {} }), put: async () => ({ data: {} }), patch: async () => ({ data: {} }), delete: async () => ({ data: {} }) };`);

  // Settings: five groups in order, every card still present
  const settingsCode = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import Settings from './pages/Settings.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 214, name: 'Asha Rao', role: 'patient' }, isRestoring: false });
    createRoot(document.getElementById('root')).render(<MemoryRouter><Settings /></MemoryRouter>);`, api);
  const S = run(settingsCode); await tick(500);
  const sd = S.w.document;
  const groups = [...sd.querySelectorAll('[data-testid="settings-group"]')].map(g => g.textContent.trim());
  ck('Settings mounts', S.errors.length === 0, S.errors.join('|'));
  ck('five groups in a fixed order: Account · Preferences · Integrations · Notifications · Safety', groups.join(',') === 'Account,Preferences,Integrations,Notifications,Safety', groups);
  const sh = sd.body.innerHTML;
  const order = ['Account', 'Change PIN', 'Preferences', 'Appearance', 'My avatar', 'Meal slots', 'Integrations', 'Connected Device', 'Notifications', 'Push Notifications', 'Safety', 'Safety contacts', 'Sign Out'];
  const idx = order.map(t => sh.indexOf(t));
  ck('every card is still there, under its group, in order', idx.every(i => i > -1) && idx.every((v, i, a) => i === 0 || v > a[i - 1]), order.map((t, i) => t + ':' + idx[i]));

  // Recovery: nothing without a tracker; the card with one
  const todayCode = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import DailyLog from './pages/DailyLog.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 214, name: 'Asha Rao', role: 'patient' }, isRestoring: false });
    createRoot(document.getElementById('root')).render(<MemoryRouter><DailyLog /></MemoryRouter>);`, api);
  const A = run(todayCode); await tick(900);
  ck('a member with no tracker sees no recovery card (nothing estimated)', A.errors.length === 0 && !A.w.document.querySelector('[data-testid="recovery-card"]') && A.w.__calls.some(u => /trackers\/data/.test(u)), A.errors.join('|'));

  const B = run(todayCode, (w) => {
    const T = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const d = (i) => new Date(Date.now() + 5.5 * 3600000 - i * 86400000).toISOString().slice(0, 10);
    w.__trackerDays = [0, 1, 2, 3, 4, 5, 6].map(i => ({ date: d(i), sources: [{ provider: 'whoop' }],
      recovery: { score: i === 0 ? 30 : 72, hrv_rmssd_milli: 58, resting_heart_rate: i === 0 ? 62 : 55 }, sleep: { minutes: i === 0 ? 330 : 450 }, activity: { steps: 4200 } }));
  });
  await tick(900);
  const bd = B.w.document; const bq = (id) => bd.querySelector(`[data-testid="${id}"]`);
  ck('with a synced tracker the recovery card renders: sleep, HRV, resting HR, steps, score', !!bq('recovery-card') && ['rec-sleep', 'rec-hrv', 'rec-rhr', 'rec-steps', 'rec-score'].every(id => bq(id)), B.errors.join('|'));
  ck('numbers are the device\'s (5h 30m, 58 ms, 62 bpm, 4,200, 30/100) with the provider named', /5h 30m/.test(bq('rec-sleep').textContent) && /62/.test(bq('rec-rhr').textContent) && /4,200/.test(bq('rec-steps').textContent) && /30/.test(bq('rec-score').textContent) && /whoop/.test(bq('recovery-card').textContent), bq('recovery-card').textContent.slice(0, 160));
  ck('deltas compare to the week (resting HR ↑ 7 vs week)', /↑ 7bpm vs week|↑ 7 vs week/.test(bq('rec-rhr').textContent.replace('bpm vs', 'bpm vs')) || /↑ 7/.test(bq('rec-rhr').textContent), bq('rec-rhr').textContent);
  ck('one insight, the most important: low recovery → go easy', bq('rec-insight') && /Recovery is low \(30\)/.test(bq('rec-insight').textContent), bq('rec-insight')?.textContent);
  ck('the hero and Today\'s plan do not depend on it', !!bq('hero-weight') && !!bq('todays-plan'));
}

// ═══════════════════════════════════════════════════════════════════════════
// 21. House circuits card (Sprint 11d)
// ═══════════════════════════════════════════════════════════════════════════
async function circuitsCardTest() {
  console.log('\n[21] House circuits card (coach Settings)');
  const api = stub('api-circ.js', `
    window.__calls = []; window.__puts = []; window.__dels = [];
    let list = [{ id: 1, name: 'Push', exercises: [{ name: 'Bench press', sets: 4, reps_min: 8, reps_max: 12, muscle_group: 'chest' }, { name: 'Plank', sets: null, reps_min: null, reps_max: null, muscle_group: null }] }];
    const get = async (url) => { window.__calls.push(url); if (/^\\/ai-chat\\/circuits$/.test(url)) return { data: { circuits: list } }; if (/subscriptions|notifications\\/log/.test(url)) return { data: [] }; return { data: {} }; };
    const put = async (url, body) => { window.__puts.push({ url, body }); const name = decodeURIComponent(url.split('/').pop()); list = [...list.filter(c => c.name.toLowerCase() !== name.toLowerCase()), { id: 9, name, exercises: [{ name: 'Squat', sets: 4, reps_min: 6, reps_max: 10, muscle_group: 'legs' }] }]; return { data: {} }; };
    const del = async (url) => { window.__dels.push(url); const name = decodeURIComponent(url.split('/').pop()); list = list.filter(c => c.name.toLowerCase() !== name.toLowerCase()); return { data: { deleted: 1 } }; };
    export default { get, post: async () => ({ data: {} }), put, patch: put, delete: del };`);
  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import Settings from './pages/Settings.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 300, name: 'Sachin', role: 'monitor' }, isRestoring: false });
    createRoot(document.getElementById('root')).render(<MemoryRouter><Settings /></MemoryRouter>);`, api);
  const { w, errors } = run(code); await tick(500);
  const d = w.document; const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('a coach\'s Settings shows My circuits with the saved circuit rendered "Bench press 4×8–12 · Plank"', errors.length === 0 && q('circuit-list') && /Bench press 4×8–12 · Plank/.test(q('circuit-list').textContent), [errors.join('|'), q('circuit-list')?.textContent]);
  q('circuit-add').click(); await tick(50);
  const setV = (el, v) => { const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  q('circuit-save').click(); await tick(50);
  ck('saving without a name is refused with a message', /Give the circuit a name/.test(d.body.innerHTML) && w.__puts.length === 0);
  setV(q('circuit-name'), 'Legs'); setV(q('circuit-text'), 'Squat 4x6-10 legs\nRDL 3x8-12 legs'); q('circuit-save').click(); await tick(300);
  ck('save PUTs the text to /ai-chat/circuits/Legs and the list refreshes with it', w.__puts.length === 1 && /circuits\/Legs$/.test(w.__puts[0].url) && /Squat 4x6-10 legs/.test(w.__puts[0].body.text) && /Squat 4×6–10/.test(q('circuit-list').textContent), [w.__puts, q('circuit-list')?.textContent]);
  w.confirm = () => true;
  [...d.querySelectorAll('[data-testid="circuit-delete"]')].find(b => /Push/.test(b.getAttribute('aria-label'))).click(); await tick(300);
  ck('Delete removes that circuit only', w.__dels.length === 1 && /circuits\/Push$/.test(w.__dels[0]) && !/Bench press/.test(q('circuit-list').textContent) && /Squat/.test(q('circuit-list').textContent));

  // a member never sees it
  const memberCode = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import Settings from './pages/Settings.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 214, name: 'Asha Rao', role: 'patient' }, isRestoring: false });
    createRoot(document.getElementById('root')).render(<MemoryRouter><Settings /></MemoryRouter>);`, api);
  const M = run(memberCode); await tick(400);
  ck('a member\'s Settings has no circuits card', !M.w.document.querySelector('[data-testid="circuit-add"]') && !/My circuits/.test(M.w.document.body.innerHTML));
}

// ═══════════════════════════════════════════════════════════════════════════
// 22. Diet Plan Studio, Phase 1.3 — must-fix totals, Fit to target, lab
//     cautions, fixed portions, and the coach chat's "Review in Nutrition"
// ═══════════════════════════════════════════════════════════════════════════
async function dietStudio13Test() {
  console.log('\n[22] Diet Plan Studio (Phase 1.3)');
  const api = stub('api-studio13.js', `
    window.__calls = []; window.__posts = []; window.__patches = [];
    const item = (id, name, grams, kcal, compulsory) => ({ id, name, grams, qty_text: grams + ' g', compulsory: !!compulsory, per_100g: { calories: kcal, total_carbs: 5 } });
    const day = () => [{ meal: 'Meal 1', time: '12:00', items: [item(1, 'Curd', 200, 60, true), item(2, 'Paneer bhurji', 300, 265, false)] }];
    const draft = () => ({ id: 41, patient_id: 12, version: 2, status: 'draft', title: 'Low carb vegetarian', targets: { kcal: 1500, protein: 120, carbs: 80, fat: 78 },
      flags: [{ kind: 'lab', test: 'Fasting Glucose', status: 'high', text: 'Fasting Glucose is high: 132 mg/dL', source: 'Lab result', date: '2026-09-12', stale: false }],
      content: { avoid: ['sugar'], cautions: ['Drink more water.'], adjustments: [],
                 lab_cautions: ['Fasting Glucose is high: 132 mg/dL (12 Sep 2026). Keep sweets, fruit juice and maida out.'] },
      checks: window.__fitted ? [] : [{ level: 'error', code: 'day_over', text: 'Over the 1500 kcal target (allowed 1425 to 1575): Mon 2206 kcal. Use Fit to target, or reduce portions.' }],
      days: [day(), day(), day(), day(), day(), day(), day()], diff: null, compared_to_version: null });
    const fit = { ok: true, range: { lo: 1425, hi: 1575, carb_cap: 84 }, unfit: [{ weekday: 6, reason: 'The compulsory items alone are 1718 kcal. Reduce one, or raise the target.' }],
      changes: [{ meal: 'Meal 1', name: 'Paneer bhurji', from: 300, to: 190, weekdays: [0, 1, 2, 3, 4, 5] }],
      totals: [0, 1, 2, 3, 4, 5, 6].map(w => ({ weekday: w, before: { kcal: 2206, carbs: 120 }, after: { kcal: w === 6 ? 2206 : 1498, carbs: 79 }, fits: w !== 6 })) };
    const member = { profile: { id: 12, name: 'Daya Kumar', phone: '9000000012', protocol: { activities: [], acv: [], supplements: [], macros: {}, water_target: 3000 } }, logs: [], labs: [], notes: [] };
    const get = async (url) => { window.__calls.push(url);
      if (/\\/diet-plans\\/member\\/12$/.test(url)) return { data: { today: '2026-10-03', in_force: null, upcoming: null, draft: draft(), history: [] } };
      if (/\\/members\\/12$/.test(url)) return { data: member };
      if (/\\/members\\/12\\/brief$/.test(url)) return { data: { priority: 'ok', brief: ['a', 'b', 'c'] } };
      if (/\\/workouts\\/summary/.test(url)) return { data: { sessions: [] } };
      if (/\\/workouts/.test(url)) return { data: { exercises: [], cardio: [], session: null } };
      if (/\\/members$/.test(url)) return { data: [{ id: 12, name: 'Daya Kumar' }] };
      return { data: {} }; };
    const post = async (url, body) => { window.__posts.push({ url, body });
      if (/\\/diet-plans\\/41\\/fit$/.test(url)) { if (body && body.apply) { window.__fitted = true; return { data: { applied: true, fit, plan: draft() } }; } return { data: { applied: false, fit } }; }
      if (/coach-parse$/.test(url)) return { data: { reply: 'Preparing a draft diet plan for review.', actions: [{ member_id: 12, member_name: 'Daya Kumar', resolved: true, is_all: false,
        ops: { diet_plan: { brief: 'Low carb veg, 1500 kcal' } }, changes: [{ icon: '📋', text: 'Draft a diet plan in the Studio: "Low carb veg, 1500 kcal". Not sent to the member: you review and approve it in Nutrition.' }] }] } };
      if (/coach-apply$/.test(url)) return { data: { results: [{ member_name: 'Daya Kumar', ok: true, detail: 'diet plan draft ready (version 2, not sent), 1 must-fix check to clear', studio: { member_id: 12, plan_id: 41 } }] } };
      return { data: {} }; };
    const patch = async (url, body) => { window.__patches.push({ url, body }); return { data: { plan: draft() } }; };
    export default { get, post, put: post, patch, delete: post };`);

  // ── The Studio on its own ───────────────────────────────────────────────────
  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import DietPlanStudio from './components/coach/DietPlanStudio.jsx';
    createRoot(document.getElementById('root')).render(<DietPlanStudio memberId={12} memberName="Daya Kumar" />);`, api);
  const { w, errors } = run(code); await tick(500);
  const d = w.document; const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('the draft renders', errors.length === 0 && !!q('diet-draft'), errors.join('|'));
  ck('the over-target day shows as "Must fix", in the error style', /Must fix: Over the 1500 kcal target/.test(q('plan-checks').textContent) && !!q('plan-checks').querySelector('.text-red-300'), q('plan-checks')?.textContent);
  ck('Approve is disabled while a must-fix error stands', q('plan-approve').disabled === true);
  ck('there is no "approve anyway" tick box for an error', !d.querySelector('input[type=checkbox]'));
  ck('lab cautions show in their own section, marked as added by the app', !!q('plan-lab-cautions') && /Fasting Glucose is high: 132 mg\/dL \(12 Sep 2026\)/.test(q('plan-lab-cautions').textContent) && /redraft cannot remove/.test(q('plan-lab-cautions').textContent), q('plan-lab-cautions')?.textContent);
  const fixedBtn = [...d.querySelectorAll('button[aria-pressed]')];
  ck('a compulsory item reads "Fixed", the others offer "Fix portion"', fixedBtn.length === 2 && /^Fixed/.test(fixedBtn[0].textContent) && fixedBtn[0].getAttribute('aria-pressed') === 'true' && /^Fix portion/.test(fixedBtn[1].textContent) && /fix this portion/.test(fixedBtn[1].getAttribute('aria-label')), fixedBtn.map(b => b.textContent));
  ck('"Fit to target" is offered, and no preview yet', !!q('plan-fit') && !q('plan-fit-preview'));

  q('plan-fit').click(); await tick(300);
  const firstFit = w.__posts.find(p => /\/fit$/.test(p.url));
  ck('the first tap asks for a preview only (no apply)', !!firstFit && firstFit.body.apply !== true && w.__posts.filter(p => /\/fit$/.test(p.url)).length === 1, w.__posts);
  const pv = q('plan-fit-preview');
  ck('the preview says nothing is saved yet', !!pv && /nothing saved yet/i.test(pv.textContent));
  ck('and lists each change with from and to grams and its days', /Paneer bhurji 300 g to 190 g/.test(pv.textContent) && /Mon, Tue, Wed, Thu, Fri, Sat/.test(pv.textContent), pv?.textContent.slice(0, 300));
  ck('and each day before and after', /Mon: 2206 to 1498 kcal/.test(pv.textContent));
  ck('a day that cannot be fitted is marked and says why', /Sun: 2206 to 2206 kcal.*still outside/.test(pv.textContent) && /Sun: The compulsory items alone are 1718 kcal/.test(pv.textContent), pv?.textContent.slice(-400));
  ck('nothing was edited by looking at the preview', w.__patches.length === 0);
  ck('Approve is still disabled during the preview', q('plan-approve').disabled === true);

  q('plan-fit-apply').click(); await tick(500);
  const applied = w.__posts.filter(p => /\/fit$/.test(p.url));
  ck('"Save these portions" sends apply: true', applied.length === 2 && applied[1].body.apply === true, applied);
  ck('the screen re-reads the plan from the server; the error and the preview are gone', !q('plan-fit-preview') && !q('plan-checks') && w.__calls.filter(u => /diet-plans\/member\/12$/.test(u)).length === 2);
  ck('and Approve is enabled', q('plan-approve').disabled === false);

  [...d.querySelectorAll('button[aria-pressed]')][1].click(); await tick(300);
  ck('"Fix portion" PATCHes compulsory: true for that item', w.__patches.length === 1 && w.__patches[0].body.edits[0].name === 'Paneer bhurji' && w.__patches[0].body.edits[0].compulsory === true, w.__patches);

  // ── The member page: ?tab=nutrition, and the chat's review button ───────────
  const page = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
    import Monitor from './pages/Monitor.jsx';
    import MemberList from './pages/PatientList.jsx';
    import { useAuthStore } from './store/authStore.js';
    import { useCoachAI } from './components/CoachAIChat.jsx';
    useAuthStore.setState({ user: { id: 300, name: 'Sachin', role: 'monitor' }, isRestoring: false });
    window.__openChat = () => useCoachAI.getState().openChat();
    window.__chatOpen = () => useCoachAI.getState().open;
    function Where() { const l = useLocation(); window.__where = l.pathname + l.search; return null; }
    createRoot(document.getElementById('root')).render(
      <MemoryRouter initialEntries={[window.__start || '/coach']}>
        <Where />
        <Routes><Route path="/coach" element={<MemberList />} /><Route path="/coach/:memberId" element={<Monitor />} /></Routes>
      </MemoryRouter>);`, api);

  const P = run(page, (win) => { win.__start = '/coach/12?tab=nutrition&draft=41'; }); await tick(900);
  const pq = (id) => P.w.document.querySelector(`[data-testid="${id}"]`);
  ck('/coach/12?tab=nutrition opens the member page on the Nutrition tab with the draft', P.errors.length === 0 && !!pq('diet-draft'), P.errors.join('|'));
  const plain = run(page, (win) => { win.__start = '/coach/12'; }); await tick(900);
  ck('without ?tab the page still opens on Today (no Studio)', plain.errors.length === 0 && !plain.w.document.querySelector('[data-testid="diet-draft"]'));

  // jsdom has no scrollIntoView; the chat scrolls to its newest message.
  const L = run(page, (win) => { win.Element.prototype.scrollIntoView = () => {}; }); await tick(700);
  const ld = L.w.document;
  L.w.__openChat(); await tick(300);
  const inputEl = [...ld.querySelectorAll('input')].find(i => /Ask or instruct/.test(i.getAttribute('placeholder') || ''));
  Object.getOwnPropertyDescriptor(L.w.HTMLInputElement.prototype, 'value').set.call(inputEl, 'Draft a diet plan for Daya: low carb veg, 1500 kcal');
  inputEl.dispatchEvent(new L.w.Event('input', { bubbles: true })); await tick(50);
  inputEl.dispatchEvent(new L.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(500);
  ck('the chat previews the draft as an action, saying it is not sent', /Draft a diet plan in the Studio/.test(ld.body.textContent) && /Not sent to the member/.test(ld.body.textContent), L.errors.join('|'));
  ck('nothing is applied before the coach taps Apply', !L.w.__posts.some(p => /coach-apply$/.test(p.url)) && !ld.querySelector('[data-testid="review-draft"]'));
  L.w.__click('Apply changes'); await tick(500);
  const sent = L.w.__posts.find(p => /coach-apply$/.test(p.url));
  ck('Apply sends the diet_plan brief to coach-apply', !!sent && sent.body.actions[0].ops.diet_plan.brief === 'Low carb veg, 1500 kcal', sent?.body);
  const review = ld.querySelector('[data-testid="review-draft"]');
  ck('the result says the draft is ready and not sent, with a "Review in Nutrition" button', !!review && /Review in Nutrition/.test(review.textContent) && /not sent/.test(ld.body.textContent));
  review.click(); await tick(900);
  ck('the button goes to that member\'s Nutrition tab', L.w.__where === '/coach/12?tab=nutrition&draft=41', L.w.__where);
  ck('closes the chat, and the draft is on screen', L.w.__chatOpen() === false && !!ld.querySelector('[data-testid="diet-draft"]') && L.errors.length === 0, L.errors.join('|'));
}

// ═══════════════════════════════════════════════════════════════════════════
// 23. Phase 2 — the member side of the diet plan: Next up, Log as planned,
//     Plan › Nutrition
// ═══════════════════════════════════════════════════════════════════════════
async function memberPlanTest() {
  console.log('\n[23] Member diet plan (Phase 2)');
  const code = await bundle(`
    import { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import NextUp from './components/today/NextUp.jsx';
    import LogPlannedSheet from './components/sheets/LogPlannedSheet.jsx';
    const per = (k) => ({ calories: k });
    const mealPlans = [
      // Out of order on purpose: the card must still pick the earliest.
      { meal: 'Meal 2', time: '23:58', items: [{ name: 'Guava', grams: 150, qty_text: '1 medium', per_100g: per(68) }] },
      { meal: 'Meal 1', time: '00:01', items: [{ name: 'Curd', grams: 200, qty_text: '1 katori', per_100g: per(60) }, { name: 'Moong dal', grams: 100, qty_text: '100 g', per_100g: per(105) }] },
    ];
    window.__updates = []; window.__other = 0;
    function Harness() {
      const [food, setFood] = useState(window.__startFood || []);
      const [meal, setMeal] = useState(null);
      const m = { log: { food }, terms: { kcal: 'kcal' }, update: (field, v) => { window.__updates.push({ field, v }); setFood(v); } };
      return (<div>
        <NextUp mealPlans={mealPlans} food={food} terms={m.terms} onLog={setMeal} onOther={() => { window.__other++; }} />
        <LogPlannedSheet meal={meal} onClose={() => setMeal(null)} m={m} />
      </div>);
    }
    createRoot(document.getElementById('root')).render(<Harness />);`);
  const { w, errors } = run(code); await tick(300);
  const d = w.document; const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  const setV = (el, v) => { Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  ck('the Next up card renders', errors.length === 0 && !!q('next-up'), errors.join('|'));
  ck('it shows the EARLIEST unlogged meal, with its time in 12-hour form', /12:01 AM\s*Meal 1/.test(q('next-up').textContent), q('next-up')?.textContent.slice(0, 120));
  ck('its foods with the household measure and calories, and the meal total', /Curd/.test(q('next-up').textContent) && /1 katori · 120/.test(q('next-up').textContent) && /225 kcal/.test(q('next-up').textContent), q('next-up')?.textContent);
  ck('the following meal is named underneath', /Then: 11:58 PM Meal 2 · 102 kcal/.test(q('next-up-then').textContent), q('next-up-then')?.textContent);
  ck('nothing is logged just by showing the card; no sheet is open', w.__updates.length === 0 && !d.querySelector('[role=dialog]'));
  q('next-up-other').click(); await tick(50);
  ck('"I ate something else" hands over to the chat and logs nothing', w.__other === 1 && w.__updates.length === 0);

  q('next-up-log').click(); await tick(400);
  const dlg = d.querySelector('[role=dialog]');
  ck('"Log as planned" opens a sheet for that meal', !!dlg && /Meal 1/.test(dlg.textContent) && /Log as planned/.test(dlg.textContent), dlg?.textContent.slice(0, 80));
  const grams = [...dlg.querySelectorAll('input[type=number]')], ticks = [...dlg.querySelectorAll('input[type=checkbox]')];
  ck('every item is ticked at its planned grams', grams.map(i => i.value).join() === '200,100' && ticks.every(t => t.checked));
  ck('the button says what it will log: 2 items, 225 kcal', /Log 2 items · 225 kcal/.test(q('planned-save').textContent), q('planned-save')?.textContent);
  ck('opening the sheet has still logged nothing', w.__updates.length === 0);
  setV(grams[1], '50'); await tick(50);
  ticks[0].click(); await tick(50);
  ck('changing grams and unticking are spelled out before saving', /Different from the plan: Curd skipped, Moong dal 50 g \(plan 100 g\)/.test(q('planned-changes').textContent), q('planned-changes')?.textContent);
  ck('and the button follows: 1 item, 53 kcal', /Log 1 item · 53 kcal/.test(q('planned-save').textContent), q('planned-save')?.textContent);
  q('planned-save').click(); await tick(500);
  const up = w.__updates[0];
  ck('saving writes ONE food-log update: Moong dal 50 g under Meal 1, with its nutrition', w.__updates.length === 1 && up.field === 'food' && up.v.length === 1 && up.v[0].name === 'Moong dal' && up.v[0].grams === 50 && up.v[0].meal === 'Meal 1' && up.v[0].per_100g.calories === 105, up);
  ck('the sheet closes', !d.querySelector('[role=dialog]'));
  ck('and the card moves on to the next meal', /11:58 PM\s*Meal 2/.test(q('next-up').textContent) && !q('next-up-then'), q('next-up')?.textContent.slice(0, 80));

  const done = run(code, (win) => { win.__startFood = [{ name: 'Curd', grams: 200, meal: 'Meal 1' }, { name: 'Guava', grams: 150, meal: 'Meal 2' }]; }); await tick(300);
  ck('with every meal logged the card is gone', done.errors.length === 0 && !done.w.document.querySelector('[data-testid="next-up"]'));

  // ── Plan › Nutrition with an approved plan ──────────────────────────────────
  const api = stub('api-plan2.js', `
    const wd = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const todayWd = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Kolkata' });
    const ti = wd.indexOf(todayWd);
    const item = (name, grams) => ({ name, grams, qty_text: grams + ' g', per_100g: { calories: 100 } });
    const days = wd.map((d, i) => [{ meal: 'Meal 1', time: '12:00', items: [item('Curd', 200), item('Dish for ' + d, 150)] }, { meal: 'Meal 2', time: '16:00', items: [item('Guava', 150)] }]);
    const payload = {
      profile: { name: 'Padmini', monitor_name: 'Sachin', macro_kcal: 1500, macro_pro: 120, macro_carb: 80, macro_fat: 78, water_target: 3000 },
      meal_plan: { date: 'x', meals: [{ meal: 'Meal 1', time: '12:00', items: [item('Curd', 200), item('Today only khichdi', 250)] }, { meal: 'Meal 2', time: '16:00', items: [item('Guava', 150)] }] },
      program: { program: null, days: [] },
      diet_plan: window.__noPlan ? null : { id: 9, version: 2, title: 'Low carb vegetarian', effective_from: '2026-10-03',
        targets: { kcal: 1500, protein: 120, carbs: 80, fat: 78 },
        content: { eating_window: '12:00-20:00', timetable: [{ time: '06:00', what: 'Wake, 500 ml water' }], avoid: ['sugar', 'maida'],
                   cautions: ['See your doctor for a BP check.'], lab_cautions: ['Fasting Glucose is high: 132 mg/dL (12 Sep 2026). Keep sweets out.'] },
        days },
    };
    window.__ti = ti; window.__wd = wd;
    const get = async (url) => ({ data: /\\/members\\/me\\/today$/.test(url) ? payload : {} });
    export default { get, post: async () => ({ data: {} }), put: async () => ({ data: {} }), patch: async () => ({ data: {} }), delete: async () => ({ data: {} }) };`);
  const planCode = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
    import Plan from './pages/Plan.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 214, name: 'Padmini', role: 'patient' }, isRestoring: false });
    function Where() { const l = useLocation(); return <div data-testid="elsewhere">{l.pathname + l.search}</div>; }
    createRoot(document.getElementById('root')).render(
      <MemoryRouter initialEntries={['/plan']}><Routes><Route path="/plan" element={<Plan />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);`, api);
  const P = run(planCode); await tick(600);
  const pd = P.w.document; const pq = (id) => pd.querySelector(`[data-testid="${id}"]`);
  P.w.__click('Nutrition'); await tick(200);
  const diet = pq('plan-diet');
  ck('Nutrition shows the approved diet plan: name, version and start date', P.errors.length === 0 && !!diet && /Low carb vegetarian/.test(diet.textContent) && /v2/.test(diet.textContent) && /3 Oct/.test(diet.textContent), [P.errors.join('|'), diet?.textContent.slice(0, 120)]);
  ck('the plan\'s four targets', /1,500/.test(pq('plan-diet-targets').textContent) && /120/.test(pq('plan-diet-targets').textContent) && /80/.test(pq('plan-diet-targets').textContent) && /78/.test(pq('plan-diet-targets').textContent), pq('plan-diet-targets')?.textContent);
  ck('the eating window', /Eating window 12:00-20:00/.test(diet.textContent));
  const chips = [...pd.querySelectorAll('[data-testid="plan-diet-day"]')];
  ck('seven weekday chips, today selected', chips.length === 7 && chips[P.w.__ti].getAttribute('aria-selected') === 'true' && chips.filter(c => c.getAttribute('aria-selected') === 'true').length === 1);
  const mealsText = () => [...pd.querySelectorAll('[data-testid="plan-diet-meal"]')].map(m => m.textContent).join(' | ');
  ck('today shows today\'s actual prescribed meals (a coach\'s one-day change included), with times', /12:00 PM\s*Meal 1/.test(mealsText()) && /Today only khichdi/.test(mealsText()) && /4:00 PM\s*Meal 2/.test(mealsText()), mealsText());
  const other = (P.w.__ti + 1) % 7;
  chips[other].click(); await tick(150);
  ck('another weekday shows the plan\'s menu for that day', new RegExp('Dish for ' + P.w.__wd[other]).test(mealsText()) && !/Today only khichdi/.test(mealsText()), mealsText());
  ck('the "log today\'s meals" button is only offered on today', !pq('plan-diet-log'));
  chips[P.w.__ti].click(); await tick(150);
  ck('avoid list and cautions, lab cautions included', /sugar, maida/.test(pq('plan-diet-avoid').textContent) && /Fasting Glucose is high/.test(pq('plan-diet-cautions').textContent) && /BP check/.test(pq('plan-diet-cautions').textContent));
  ck('the old "meals prescribed" list is not shown as well', !pq('plan-meal') && !pq('plan-macros'));
  pq('plan-diet-log').click(); await tick(200);
  ck('"Log today\'s meals" goes to Today', pq('elsewhere') && pq('elsewhere').textContent === '/');

  const N = run(planCode, (win) => { win.__noPlan = true; }); await tick(600);
  N.w.__click('Nutrition'); await tick(200);
  const nd = N.w.document;
  ck('with no approved plan the Nutrition view is exactly the old one', N.errors.length === 0 && !nd.querySelector('[data-testid="plan-diet"]') && !!nd.querySelector('[data-testid="plan-macros"]') && nd.querySelectorAll('[data-testid="plan-meal"]').length === 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// 24. The production security policy (helmet) against the BUILT client
// ═══════════════════════════════════════════════════════════════════════════
// The live login page logged "Refused to execute inline script" (login:48):
// helmet's default policy in production allows scripts from the site itself
// only, so the inline 10-second boot watchdog in index.html never ran, and
// its Reload button's onclick never fired. jsdom has no security policy, so
// only a real browser against the real headers can catch this.
async function cspTest() {
  console.log('\n[24] security policy: the built app under production headers (headless Chrome)');
  let puppeteerCore, chromiumPkg;
  try {
    puppeteerCore = (await import('puppeteer-core')).default;
    chromiumPkg   = (await import('@sparticuz/chromium')).default;
  } catch {
    console.log('  – browser not installed, security-policy check NOT RUN');
    return;
  }
  const chromium = chromiumPkg.default || chromiumPkg;
  const dist = path.join(ROOT, 'client', 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('No client build at client/dist. Run: cd client && npm run build');
  const require_ = createRequire(path.join(ROOT, 'server', 'package.json'));
  const express = require_('express'), helmet = require_('helmet');
  const app = express();
  // Exactly what server/index.js sends in production.
  app.use(helmet(require_('./services/securityPolicy.js').helmetOptions({ NODE_ENV: 'production' })));
  app.use(express.static(dist));
  app.use((req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteerCore.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'], headless: true });
  try {
    const page = await browser.newPage();
    // Block the service worker: a stale one from another run must not answer.
    await page.evaluateOnNewDocument(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI || 'inline'} ${e.lineNumber || ''}`));
    });
    const consoleCsp = [];
    page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) consoleCsp.push(m.text().slice(0, 160)); });
    await page.goto(origin + '/login', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    const v = await page.evaluate(() => window.__csp);
    ck('the login page loads with no security-policy violations', v.length === 0 && consoleCsp.length === 0, [...v, ...consoleCsp].join(' | '));
    const wd = await page.evaluate(() => ({ recover: typeof window.__fitlifeRecover, booted: !!window.__fitlifeBooted, btn: !!document.querySelector('#boot-fallback button') }));
    ck('the boot watchdog ran: its recovery function exists', wd.recover === 'function', wd);
    ck('and the app mounted (it marks itself booted)', wd.booted === true, wd);
    const clicked = await page.evaluate(() => {
      let called = 0; window.__fitlifeRecover = () => { called++; };
      document.getElementById('boot-fallback').style.display = 'block';
      document.querySelector('#boot-fallback button').click();
      return called;
    });
    ck('the "Reload app" button calls the recovery (no blocked onclick)', clicked === 1, clicked);

    // Phase 3 photos. A blob: image (the member's own plate preview) must load,
    // and the policy must allow the R2 photo host (signed links). Before the
    // fix the coach's Off plan card showed a broken image.
    const imgs = await page.evaluate(async () => {
      window.__csp = [];
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
      const blobUrl = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
      const load = (src) => new Promise(r => { const i = new Image(); i.onload = () => r('loaded'); i.onerror = () => r('error'); i.src = src; setTimeout(() => r('timeout'), 3000); });
      const blob = await load(blobUrl);
      const r2 = new Image(); r2.src = 'https://742fca821afd3f30f29c218d3789f863.r2.cloudflarestorage.com/fitlife-test/meals/x.jpg';
      const evil = new Image(); evil.src = 'https://example.com/tracker.gif';
      await new Promise(r => setTimeout(r, 800));
      return { blob, violations: window.__csp.slice() };
    });
    ck('the member\'s own photo preview (blob:) loads under the policy', imgs.blob === 'loaded', imgs);
    ck('images from the R2 photo host are allowed', !imgs.violations.some(v => /r2\.cloudflarestorage\.com/.test(v)), imgs.violations);
    ck('images from any other site are still blocked', imgs.violations.some(v => /img-src .*example\.com/.test(v)), imgs.violations);
    const hdr = (await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' }).catch(() => null))?.headers()?.['content-security-policy'] || '';
    ck('scripts are still the site\'s own files only', /script-src 'self'(;|$)/.test(hdr) && !/script-src[^;]*unsafe-inline/.test(hdr), hdr);
    ck('voice recordings can play: audio from blob: (own take) and the R2 host (coach)', /media-src 'self' blob: https:\/\/\*\.r2\.cloudflarestorage\.com/.test(hdr), hdr);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 25. Phase 3 — plate photo: the camera button, the result sheet, the coach's
//     Off plan today tab
// ═══════════════════════════════════════════════════════════════════════════
async function platePhotoTest() {
  console.log('\n[25] Plate photo (Phase 3)');
  const api = stub('api-plate.js', `
    window.__posts = [];
    const per = (k) => ({ calories: k });
    const matched = { photo_id: 77, meal: 'Meal 2', time: '16:00', matches: true, photo_saved: true, photo_url: null,
      planned: [
        { name: 'Whey protein', planned_grams: 30, grams: 30, status: 'as_planned', per_100g: per(400), kcal: 120 },
        { name: 'Guava', planned_grams: 150, grams: 100, status: 'less', per_100g: per(68), kcal: 68 },
        { name: 'Buttermilk', planned_grams: 200, grams: 200, status: 'not_seen', per_100g: per(40), kcal: 80 } ],
      extras: [{ name: 'Banana chips', grams: 30, per_100g: per(520), kcal: 156 }] };
    const mismatch = { ...matched, photo_id: 78, matches: false, planned: matched.planned.map(p => ({ ...p, status: 'not_seen' })),
      extras: [{ name: 'Idli', grams: 120, per_100g: per(130), kcal: 156 }, { name: 'Sambar', grams: 150, per_100g: per(65), kcal: 98 }] };
    const post = async (url, body) => {
      window.__posts.push({ url, body });
      if (/\\/plate\\/check$/.test(url)) {
        if (window.__plateMode === 'down') { const e = new Error('x'); e.response = { status: 502, data: { error: 'I could not read that photo just now. Try again, or log the meal as planned.' } }; throw e; }
        return { data: window.__plateMode === 'mismatch' ? mismatch : matched };
      }
      return { data: { ok: true } };
    };
    const get = async (url) => {
      if (/\\/plate\\/storage-check$/.test(url)) return { data: window.__storageMode === 'bad' ? { ok: false, step: 'upload', bucket: 'fitlife-test', error: 'Storage upload failed (403)' } : { ok: true, bucket: 'fitlife-test' } };
      if (/\\/members\\/triage$/.test(url)) return { data: { members: [], counts: { total: 2, on_track: 2 } } };
      if (/\\/plate\\/off-plan$/.test(url)) return { data: { items: [{ id: 5, member_id: 12, name: 'Padmini', phone: '9876543210', meal: 'Meal 2', outcome: 'extra',
        extras: [{ name: 'banana chips', grams: 30, kcal: 156 }], extras_kcal: 156, differences: ['Buttermilk skipped'], at: '2026-10-05T10:42:00Z',
        day_kcal: 971, target_kcal: 1500, photo_url: null }] } };
      return { data: {} };
    };
    export default { get, post, put: post, patch: post, delete: post };`);
  // jsdom has no canvas and never loads images: stand-ins so the real
  // downscaleImage runs end to end.
  const prep = (mode) => (win) => {
    win.__plateMode = mode;
    win.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,QUJD';
    win.Image = class { set src(v) { this._s = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._s; } get width() { return 4000; } get height() { return 3000; } };
  };
  const code = await bundle(`
    import { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import NextUp from './components/today/NextUp.jsx';
    import PlatePhotoSheet from './components/sheets/PlatePhotoSheet.jsx';
    const per = (k) => ({ calories: k });
    const mealPlans = [{ meal: 'Meal 2', time: '23:58', items: [{ name: 'Whey protein', grams: 30, per_100g: per(400) }, { name: 'Guava', grams: 150, per_100g: per(68) }, { name: 'Buttermilk', grams: 200, per_100g: per(40) }] }];
    window.__updates = [];
    function H() {
      const [food, setFood] = useState([]);
      const [job, setJob] = useState(null);
      const m = { log: { food }, terms: { kcal: 'kcal' }, update: (f, v) => { window.__updates.push({ f, v }); setFood(v); } };
      window.__snap = (file) => setJob({ meal: { meal: 'Meal 2', time: '23:58' }, file, at: Date.now() });
      return (<div><NextUp mealPlans={mealPlans} food={food} terms={m.terms} onLog={() => {}} onOther={() => {}} onSnap={(meal, f) => setJob({ meal, file: f, at: Date.now() })} />
        <PlatePhotoSheet job={job} onClose={() => setJob(null)} onRetake={(meal, f) => setJob({ meal, file: f, at: Date.now() })} m={m} /></div>);
    }
    createRoot(document.getElementById('root')).render(<H />);`, api);

  // ── Matched ─────────────────────────────────────────────────────────────────
  const { w, errors } = run(code, prep('matched')); await tick(300);
  const d = w.document; const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  const snap = q('next-up-snap');
  const fileIn = snap?.querySelector('input[type=file]');
  ck('Next up offers "Snap your plate", a real camera input inside the tap target', errors.length === 0 && !!snap && /Snap your plate/.test(snap.textContent) && fileIn?.getAttribute('capture') === 'environment' && fileIn.getAttribute('accept') === 'image/*', errors.join('|'));
  const file = new w.File([new Uint8Array([1, 2, 3])], 'plate.jpg', { type: 'image/jpeg' });
  Object.defineProperty(fileIn, 'files', { value: [file], configurable: true });
  fileIn.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(600);
  const check = w.__posts.find(p => /\/plate\/check$/.test(p.url));
  ck('choosing a photo sends it, downscaled, with the meal it is for', !!check && check.body.meal === 'Meal 2' && check.body.image === 'QUJD' && check.body.mimeType === 'image/jpeg', check?.body);
  ck('nothing is logged just by checking', w.__updates.length === 0);
  const res = q('plate-result');
  ck('the result shows each planned item and the extra', !!res && d.querySelectorAll('[data-testid="plate-planned"]').length === 3 && d.querySelectorAll('[data-testid="plate-extra"]').length === 1, d.body.textContent.slice(0, 200));
  ck('as planned, less, and "did you have it?"', /As planned · about 30 g/.test(res.textContent) && /About 100 g · plan says 150 g/.test(res.textContent) && /Not in the photo. Did you have it\?/.test(res.textContent));
  const boxes = [...res.querySelectorAll('input[type=checkbox]')];
  ck('items in the photo start ticked; the one not seen starts unticked', boxes.map(b => b.checked).join() === 'true,true,false,true', boxes.map(b => b.checked));
  ck('extras over 100 kcal: "Your coach will see the extras"', !!q('plate-coach-note'));
  ck('the button logs what is ticked: 120 + 68 + 156 = 344 kcal', /Log this · 344 kcal/.test(q('plate-save').textContent), q('plate-save')?.textContent);
  const gramsBox = res.querySelectorAll('input[type=number]')[1];
  Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(gramsBox, '120');
  gramsBox.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(50);
  ck('typing grams keeps the same box (the keyboard stays open)', gramsBox.isConnected && gramsBox.value === '120');
  boxes[2].click(); await tick(50);
  ck('ticking "had buttermilk" adds it: now 120 + 82 + 80 + 156 = 438 kcal', /Log this · 438 kcal/.test(q('plate-save').textContent), q('plate-save')?.textContent);
  q('plate-save').click(); await tick(700);
  const up = w.__updates[0]?.v || [];
  ck('saving logs four foods under Meal 2, with the changed grams', w.__updates.length === 1 && up.length === 4 && up.every(r => r.meal === 'Meal 2') && up.find(r => r.name === 'Guava').grams === 120, up);
  ck('the "kind" bookkeeping does not leak into the food log', up.every(r => r.kind === undefined));
  const conf = w.__posts.find(p => /\/plate\/77\/confirm$/.test(p.url));
  ck('and tells the server what was logged, as the meal, with kinds', conf?.body.as === 'meal' && conf.body.items.length === 4 && conf.body.items.filter(i => i.kind === 'extra').length === 1, conf?.body);
  ck('the sheet closes', !q('plate-result') && !d.querySelector('[role=dialog]'));

  // ── Not this meal ───────────────────────────────────────────────────────────
  const X = run(code, prep('mismatch')); await tick(300);
  X.w.__snap(new X.w.File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })); await tick(600);
  const xq = (id) => X.w.document.querySelector(`[data-testid="${id}"]`);
  ck('a different plate says so, naming the planned meal', !!xq('plate-mismatch') && /doesn.t look like Meal 2/.test(xq('plate-mismatch').textContent) && /whey protein, guava, buttermilk/.test(xq('plate-mismatch').textContent));
  ck('it offers: extra snack (254 kcal), instead of the meal, or retake', /Log as an extra snack · 254 kcal/.test(xq('plate-as-extra').textContent) && !!xq('plate-as-swap') && /Retake photo/.test(xq('plate-mismatch').textContent));
  xq('plate-as-extra').click(); await tick(300);
  const xu = X.w.__updates[0]?.v || [];
  ck('as an extra snack: idli and sambar logged under Snack', xu.length === 2 && xu.every(r => r.meal === 'Snack'), xu);
  ck('and confirmed as "extra"', X.w.__posts.some(p => /\/plate\/78\/confirm$/.test(p.url) && p.body.as === 'extra'));

  const S = run(code, prep('mismatch')); await tick(300);
  S.w.__snap(new S.w.File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })); await tick(600);
  S.w.document.querySelector('[data-testid="plate-as-swap"]').click(); await tick(300);
  ck('"instead of the plan": logged under Meal 2 and confirmed as "swap"', (S.w.__updates[0]?.v || []).every(r => r.meal === 'Meal 2') && S.w.__posts.some(p => /confirm$/.test(p.url) && p.body.as === 'swap'));

  // ── The check failing ───────────────────────────────────────────────────────
  const E = run(code, prep('down')); await tick(300);
  E.w.__snap(new E.w.File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' })); await tick(600);
  const err = E.w.document.querySelector('[data-testid="plate-error"]');
  ck('the check failing says so plainly and offers a retake; nothing logged', !!err && /log the meal as planned/.test(err.textContent) && /Retake photo/.test(err.textContent) && E.w.__updates.length === 0);

  // ── Coach: Off plan today ──────────────────────────────────────────────────
  const feed = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import TriageFeed from './components/coach/TriageFeed.jsx';
    createRoot(document.getElementById('root')).render(<MemoryRouter><TriageFeed /></MemoryRouter>);`, api);
  const F = run(feed); await tick(500);
  const fq = (id) => F.w.document.querySelector(`[data-testid="${id}"]`);
  ck('the coach\'s feed has an "Off plan today · 1" tab', F.errors.length === 0 && /Off plan today · 1/.test(fq('triage-tab-offplan')?.textContent || ''), F.errors.join('|'));
  ck('the All tab is shown first, as before', fq('triage-tab-all').getAttribute('aria-selected') === 'true' && !fq('offplan-feed'));
  fq('triage-tab-offplan').click(); await tick(150);
  const card = fq('offplan-card');
  ck('the card: member, meal, the extra with its calories, what was skipped, the day so far', !!card && /Padmini/.test(card.textContent) && /Meal 2/.test(card.textContent) && /Extra: banana chips, about 30 g · 156 kcal/.test(card.textContent) && /Buttermilk skipped/.test(card.textContent) && /Day so far 971 of 1,500 kcal/.test(card.textContent), card?.textContent);
  fq('offplan-seen').click(); await tick(150);
  ck('"Seen" removes it and tells the server', !fq('offplan-card') && !!fq('offplan-empty') && F.w.__posts.some(p => /\/plate\/5\/seen$/.test(p.url)));

  // ── Admin: photo storage check ─────────────────────────────────────────────
  const sc = await bundle(`
    import { createRoot } from 'react-dom/client';
    import StorageCheck from './components/admin/StorageCheck.jsx';
    createRoot(document.getElementById('root')).render(<StorageCheck />);`, api);
  for (const mode of ['ok', 'bad']) {
    const T = run(sc, (win) => { win.__storageMode = mode; }); await tick(200);
    const tq = (id) => T.w.document.querySelector(`[data-testid="${id}"]`);
    ck(`storage check (${mode}): nothing runs until the admin taps`, T.errors.length === 0 && !tq('storage-check-result'));
    tq('storage-check-run').click(); await tick(200);
    const out = tq('storage-check-result')?.textContent || '';
    ck(mode === 'ok' ? 'a working bucket says so, by name' : 'a refused upload says what usually causes it, with the error',
       mode === 'ok' ? /Working\. Uploaded, read back and deleted a test file in "fitlife-test"/.test(out) : /wrong key/.test(out) && /403/.test(out), out);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 26. Coach chat: attaching a file waits for the coach's note
// ═══════════════════════════════════════════════════════════════════════════
async function coachDocAttachTest() {
  console.log('\n[26] Coach chat: attach, then send with or without a note');
  const api = stub('api-coachdoc.js', `
    window.__posts = [];
    const post = async (url, body, cfg) => { window.__posts.push({ url, body, cfg });
      if (/coach-doc$/.test(url)) return { data: { reply: 'Read the plan for Raghavendra.', actions: [] } };
      return { data: { reply: 'ok', actions: [] } }; };
    const get = async (url) => (/\\/members$/.test(url) ? { data: [{ id: 49, name: 'Raghavendra' }] } : { data: {} });
    export default { get, post, put: post, patch: post, delete: post };`);
  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import CoachAIChat, { useCoachAI } from './components/CoachAIChat.jsx';
    window.__open = () => useCoachAI.getState().openChat();
    createRoot(document.getElementById('root')).render(<MemoryRouter><CoachAIChat contextMember={{ id: 49, name: 'Raghavendra' }} /></MemoryRouter>);`, api);
  const pre = (win) => { win.Element.prototype.scrollIntoView = () => {}; };
  for (const note of ['', 'use only the weekday meals, 1500 kcal']) {
    const { w, errors } = run(code, pre); await tick(300);
    w.__open(); await tick(300);
    const d = w.document;
    const fileIn = [...d.querySelectorAll('input[type=file]')].find(i => /pdf/.test(i.getAttribute('accept') || ''));
    const f = new w.File([new Uint8Array([37, 80, 68, 70])], 'Raghavendra-Member-Plan.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileIn, 'files', { value: [f], configurable: true });
    fileIn.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(200);
    const chip = d.querySelector('[data-testid="pending-file"]');
    ck(`(${note ? 'with a note' : 'no note'}) attaching shows the file and sends NOTHING yet`, errors.length === 0 && !!chip && /Raghavendra-Member-Plan\.pdf/.test(chip.textContent) && !w.__posts.some(p => /coach-doc/.test(p.url)), errors.join('|'));
    const input = [...d.querySelectorAll('input')].find(i => /Add a note/.test(i.getAttribute('placeholder') || ''));
    ck('the box invites a note, or just sending', !!input);
    if (note) {
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(input, note);
      input.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(50);
    }
    const sendBtn = d.querySelector('button[aria-label="Send the file"]');
    ck('Send is enabled with just the file attached', !!sendBtn && sendBtn.disabled === false);
    sendBtn.click(); await tick(400);
    const p = w.__posts.find(x => /coach-doc/.test(x.url));
    ck(note ? 'sending posts the file WITH the note as its instruction' : 'sending with no note posts the file to be read as is',
       !!p && p.body.fileName === 'Raghavendra-Member-Plan.pdf' && p.body.member_name === 'Raghavendra' && (note ? p.body.instruction === note : p.body.instruction === null), p?.body && { ...p.body, file: '…' });
    ck('with a long time limit (a plan can take a minute to read)', p?.cfg?.timeout >= 120000, p?.cfg);
    ck('the chip clears and the reply shows', !d.querySelector('[data-testid="pending-file"]') && /Read the plan for Raghavendra/.test(d.body.textContent));
  }
  const { w } = run(code, pre); await tick(300); w.__open(); await tick(300);
  const fileIn = [...w.document.querySelectorAll('input[type=file]')].find(i => /pdf/.test(i.getAttribute('accept') || ''));
  Object.defineProperty(fileIn, 'files', { value: [new w.File([new Uint8Array([1])], 'x.pdf', { type: 'application/pdf' })], configurable: true });
  fileIn.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(150);
  w.document.querySelector('[aria-label="Remove the attached file"]').click(); await tick(100);
  ck('× removes the attached file, nothing sent', !w.document.querySelector('[data-testid="pending-file"]') && !w.__posts.length);
}

// ═══════════════════════════════════════════════════════════════════════════
// 27. Food log: no item is ever hidden while still counted
// ═══════════════════════════════════════════════════════════════════════════
async function foodLogGroupsTest() {
  console.log('\n[27] Food log shows every item it counts');
  const code = await bundle(`
    import { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import FoodLog from './components/FoodLog.jsx';
    const per = (k) => ({ calories: k, protein: 0, total_carbs: 0, fat: 0 });
    // Live test, 5 Oct: plate-photo extras went under "Snack", which this
    // member has no slot for: 713 kcal in the day total, no rows to delete.
    const start = [
      { id: 'a', name: 'Idli', grams: 100, meal: 'Breakfast', per_100g: per(130) },
      { id: 'b', name: 'Black sesame seeds', grams: 50, meal: 'Snack', per_100g: per(574) },
      { id: 'c', name: 'Guava', grams: 100, meal: 'Meal 2', per_100g: per(68) },
      { id: 'd', name: 'Curd', grams: 100, meal: 'lunch', per_100g: per(60) },
      { id: 'e', name: 'Banana', grams: 100, meal: '', per_100g: per(89) },
    ];
    window.__items = start;
    function H() { const [items, set] = useState(start); window.__items = items; return <FoodLog items={items} onChange={set} calorieTarget={1500} />; }
    createRoot(document.getElementById('root')).render(<H />);`);
  const { w, errors } = run(code); await tick(300);
  const d = w.document;
  const txt = () => d.body.textContent;
  const removes = () => [...d.querySelectorAll('button[aria-label="Remove item"]')];
  ck('every item has a row, whatever slot it was logged under', errors.length === 0 && removes().length === 5 && ['Idli', 'Black sesame seeds', 'Guava', 'Curd', 'Banana'].every(n => txt().includes(n)), errors.join('|'));
  ck('slots the member does not have get their own group (Snack, Meal 2, Other)', /Snack/.test(txt()) && /Meal 2/.test(txt()) && /Other/.test(txt()));
  ck('"lunch" in any case files under Lunch, not a second Lunch group', (txt().match(/Lunch/g) || []).length === 1, (txt().match(/Lunch/g) || []).length);
  ck('the day total is the sum of the rows shown: 130 + 287 + 68 + 60 + 89 = 634', /634 kcal/.test(txt()), txt().match(/\d+ kcal/g));
  for (const b of removes()) { if (b.closest('[class*="space-y"]')?.textContent.includes('Black sesame seeds') && b.parentElement.parentElement.textContent.includes('Black sesame seeds')) { b.click(); break; } }
  await tick(150);
  ck('an item under Snack can be deleted, and the total drops with it (347)', !w.__items.some(i => i.id === 'b') && /347 kcal/.test(txt()), [w.__items.map(i => i.id), txt().match(/\d+ kcal/g)]);
}

// ═══════════════════════════════════════════════════════════════════════════
// 28. Phase 4 — progress photos: the Sunday card, this week's sheet, compare
// ═══════════════════════════════════════════════════════════════════════════
async function progressPhotosTest() {
  console.log('\n[28] Progress photos (Phase 4)');
  const api = stub('api-pp.js', `
    window.__calls = []; window.__posts = []; window.__deletes = [];
    const u = (w, p) => 'https://r2.example/progress/' + w + '/' + p + '.jpg?X-Amz-Signature=x';
    const weeks = () => window.__ppWeeks || [];
    const get = async (url) => { window.__calls.push(url);
      if (/\\/progress-photos\\/(me|member\\/\\d+)$/.test(url)) return { data: { week: '2026-10-04', weeks: weeks() } };
      return { data: {} }; };
    const post = async (url, body) => { window.__posts.push({ url, body });
      const list = weeks(); let w = list.find(x => x.week === '2026-10-04');
      if (!w) { w = { week: '2026-10-04', photos: {} }; list.unshift(w); window.__ppWeeks = list; }
      w.photos[body.pose] = { id: 100 + Object.keys(w.photos).length, url: u('2026-10-04', body.pose) };
      return { data: { id: 1, week: '2026-10-04', pose: body.pose } }; };
    const del = async (url) => { window.__deletes.push(url); const id = +url.split('/').pop();
      for (const w of weeks()) for (const k of Object.keys(w.photos)) if (w.photos[k].id === id) delete w.photos[k];
      return { data: { ok: true } }; };
    export default { get, post, put: post, patch: post, delete: del };`);
  const prep = (weeks) => (win) => {
    win.__ppWeeks = weeks;
    win.confirm = () => true;
    win.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,UFA=';
    win.Image = class { set src(v) { this._s = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._s; } get width() { return 3000; } get height() { return 4000; } };
  };
  const card = await bundle(`
    import { createRoot } from 'react-dom/client';
    import ProgressPhotoCard, { isSundayIST } from './components/progress/ProgressPhotoCard.jsx';
    window.__isSun = isSundayIST;
    // 4 Oct 2026 is a Sunday; 05:00 IST on Monday 5 Oct is still Sunday 23:30 UTC.
    createRoot(document.getElementById('root')).render(<ProgressPhotoCard now={new Date(window.__now || '2026-10-04T06:00:00Z')} />);`, api);

  const S = run(card, (w) => { prep([{ week: '2026-10-04', photos: { front: { id: 1, url: 'x' } } }])(w); }); await tick(300);
  const sq = (id) => S.w.document.querySelector(`[data-testid="${id}"]`);
  ck('Sundays are worked out in India time (Sunday 23:30 UTC is already Monday in India)', S.w.__isSun(new Date('2026-10-04T06:00:00Z')) === true && S.w.__isSun(new Date('2026-10-04T19:00:00Z')) === false);
  ck('on Sunday with 1 of 3 taken, the card says so', S.errors.length === 0 && /Progress photos · 1 of 3 done/.test(sq('pp-card')?.textContent || ''), S.errors.join('|'));
  const M = run(card, (w) => { prep([])(w); w.__now = '2026-10-05T06:00:00Z'; }); await tick(300);
  ck('on a weekday there is no card, and nothing is even loaded', !M.w.document.querySelector('[data-testid="pp-card"]') && M.w.__calls.length === 0);
  const D = run(card, (w) => prep([{ week: '2026-10-04', photos: { front: { id: 1 }, side: { id: 2 }, back: { id: 3 } } }])(w)); await tick(300);
  ck('with all three in, the card goes away', !D.w.document.querySelector('[data-testid="pp-card"]'));

  // ── This week's sheet ───────────────────────────────────────────────────────
  sq('pp-card').click(); await tick(400);
  const d = S.w.document; const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('the sheet shows three tiles and the count', !!q('pp-tiles') && ['front', 'side', 'back'].every(p => q(`pp-tile-${p}`)) && /This week: 1 of 3/.test(d.body.textContent));
  ck('an empty pose shows the outline guide and "Add"; a taken one shows the photo and "Retake"', !!q('pp-tile-side').querySelector('svg') && /Add/.test(q('pp-tile-side').textContent) && !!q('pp-tile-front').querySelector('img') && /Retake/.test(q('pp-tile-front').textContent));
  ck('it says who sees them and for how long', /Only you and your coach see these, and they are deleted after 12 months/.test(d.body.textContent));
  const fileIn = q('pp-tile-side').querySelector('input[type=file]');
  ck('camera or gallery: no forced camera', fileIn && !fileIn.hasAttribute('capture') && fileIn.getAttribute('accept') === 'image/*');
  Object.defineProperty(fileIn, 'files', { value: [new S.w.File([new Uint8Array([1, 2])], 's.jpg', { type: 'image/jpeg' })], configurable: true });
  fileIn.dispatchEvent(new S.w.Event('change', { bubbles: true })); await tick(500);
  const up = S.w.__posts[0];
  ck('adding a side photo uploads it, downscaled, as "side"', up?.url === '/progress-photos' && up.body.pose === 'side' && up.body.image === 'UFA=', up);
  ck('and the tile now shows it, 2 of 3', !!q('pp-tile-side').querySelector('img') && /This week: 2 of 3/.test(d.body.textContent));
  q('pp-delete-front').click(); await tick(400);
  ck('Delete asks, then removes that photo', S.w.__deletes[0] === '/progress-photos/1' && !q('pp-tile-front').querySelector('img'), S.w.__deletes);

  // ── Compare ─────────────────────────────────────────────────────────────────
  const cmp = await bundle(`
    import { createRoot } from 'react-dom/client';
    import ProgressPhotos from './components/progress/ProgressPhotos.jsx';
    createRoot(document.getElementById('root')).render(<ProgressPhotos memberId={window.__coach ? 12 : null} />);`, api);
  const weeks = [
    { week: '2026-10-04', photos: { front: { id: 9, url: 'https://r2.example/new-front.jpg' }, side: { id: 10, url: 'https://r2.example/new-side.jpg' } } },
    { week: '2026-09-27', photos: { front: { id: 7, url: 'https://r2.example/mid-front.jpg' } } },
    { week: '2026-09-06', photos: { front: { id: 1, url: 'https://r2.example/first-front.jpg' }, side: { id: 2, url: 'https://r2.example/first-side.jpg' } } }];
  const P = run(cmp, prep(weeks)); await tick(400);
  const pq = (id) => P.w.document.querySelector(`[data-testid="${id}"]`);
  const src = (side) => pq(`pp-side-${side}`)?.querySelector('img')?.getAttribute('src');
  ck('the compare starts on the first week against the latest, front', P.errors.length === 0 && src('a') === 'https://r2.example/first-front.jpg' && src('b') === 'https://r2.example/new-front.jpg', [src('a'), src('b')]);
  [...P.w.document.querySelectorAll('[role=tab]')].find(b => b.textContent === 'Side').click(); await tick(100);
  ck('switching to Side shows both side photos', src('a') === 'https://r2.example/first-side.jpg' && src('b') === 'https://r2.example/new-side.jpg');
  const selA = P.w.document.querySelector('select[aria-label="Earlier week"]');
  selA.value = '2026-09-27'; selA.dispatchEvent(new P.w.Event('change', { bubbles: true })); await tick(100);
  ck('a week with no side photo says so instead of showing nothing', /No side photo that week/.test(pq('pp-side-a').textContent));
  ck('the member gets a "This week" button; the read-out says who sees them', !!pq('pp-open') && /Private to you and your coach/.test(pq('pp-compare').textContent));
  const C = run(cmp, (w) => { prep(weeks)(w); w.__coach = true; }); await tick(400);
  ck('the coach\'s view reads that member\'s photos and has no upload button', C.w.__calls.some(u => u === '/progress-photos/member/12') && !C.w.document.querySelector('[data-testid="pp-open"]') && /Private to the member and you/.test(C.w.document.body.textContent));
  const E = run(cmp, prep([])); await tick(300);
  ck('no photos yet: a plain line, not an empty box', /No photos yet/.test(E.w.document.querySelector('[data-testid="pp-empty"]')?.textContent || ''));
}

// ═══════════════════════════════════════════════════════════════════════════
// 29. Phase 5 — plan as PDF, grocery list
// ═══════════════════════════════════════════════════════════════════════════
async function planPdfTest() {
  console.log('\n[29] Plan as PDF and grocery list (Phase 5)');
  const api = stub('api-pdf.js', `
    window.__gets = [];
    const item = (name, grams) => ({ name, grams, qty_text: grams + ' g', per_100g: { calories: 100 } });
    const payload = { profile: { name: 'Padmini', macro_kcal: 1500 }, program: { program: null, days: [] },
      meal_plan: { date: 'x', meals: [{ meal: 'Meal 1', time: '12:00', items: [item('Curd', 200)] }] },
      diet_plan: { id: 9, version: 2, title: 'Low carb vegetarian', effective_from: '2026-10-03', targets: { kcal: 1500, protein: 110, carbs: 80, fat: 78 },
        content: { avoid: [], cautions: [], lab_cautions: [] }, days: [0,1,2,3,4,5,6].map(() => [{ meal: 'Meal 1', time: '12:00', items: [item('Curd', 200)] }]) } };
    const grocery = { plan: { id: 9, version: 2, title: 'Low carb vegetarian' },
      items: [{ name: 'Curd', grams: 1400, days: 7 }, { name: 'Rajma', grams: 150, days: 1 }],
      prep: { everyday: ['Curd (Meal 1)'], byDay: [['Rajma, 150 g (Meal 1)'], [], [], [], [], [], []] } };
    const get = async (url, cfg) => { window.__gets.push({ url, cfg });
      if (/\\/members\\/me\\/today$/.test(url)) return { data: payload };
      if (/\\/diet-plans\\/me\\/grocery$/.test(url)) return { data: grocery };
      if (/pdf$/.test(url)) return { data: new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), headers: { 'content-disposition': 'attachment; filename="FitLife-Diet-Plan-Padmini-v2.pdf"' } };
      return { data: {} }; };
    export default { get, post: async () => ({ data: {} }), put: async () => ({ data: {} }), patch: async () => ({ data: {} }), delete: async () => ({ data: {} }) };`);
  const code = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter, Routes, Route } from 'react-router-dom';
    import Plan from './pages/Plan.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 214, name: 'Padmini', role: 'patient' }, isRestoring: false });
    createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/plan']}><Routes><Route path="/plan" element={<Plan />} /></Routes></MemoryRouter>);`, api);
  const prep = (share) => (win) => {
    win.__downloads = []; win.__shared = [];
    win.URL.createObjectURL = () => 'blob:pdf'; win.URL.revokeObjectURL = () => {};
    win.HTMLAnchorElement.prototype.click = function () { win.__downloads.push(this.download); };
    if (share) { win.navigator.canShare = () => true; win.navigator.share = async (d) => { win.__shared.push(d); }; }
  };
  const { w, errors } = run(code, prep(false)); await tick(600);
  w.__click('Nutrition'); await tick(200);
  const d = w.document; const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('Plan › Nutrition offers "Plan as PDF" and "Grocery list"', errors.length === 0 && !!q('plan-pdf') && !!q('plan-grocery'), errors.join('|'));
  q('plan-pdf').click(); await tick(300);
  const pdfGet = w.__gets.find(g => /\/diet-plans\/me\/pdf$/.test(g.url));
  ck('the PDF is fetched with the login, as a file', !!pdfGet && pdfGet.cfg?.responseType === 'blob');
  ck('on a computer it downloads, with the server\'s file name', w.__downloads[0] === 'FitLife-Diet-Plan-Padmini-v2.pdf', w.__downloads);
  const S = run(code, prep(true)); await tick(600);
  S.w.__click('Nutrition'); await tick(200);
  S.w.document.querySelector('[data-testid="plan-pdf"]').click(); await tick(300);
  ck('on a phone it opens the share sheet with the PDF (WhatsApp, Drive…)', S.w.__shared.length === 1 && S.w.__shared[0].files?.[0]?.name === 'FitLife-Diet-Plan-Padmini-v2.pdf' && !S.w.__downloads.length, S.w.__shared);

  q('plan-grocery').click(); await tick(400);
  const list = q('grocery-list');
  ck('the grocery list shows the week\'s amounts', !!list && /Curd/.test(list.textContent) && /1\.4 kg/.test(list.textContent) && /150 g/.test(list.textContent) && /2 to buy/.test(list.textContent));
  ck('with the note about cooked weight, and the prep list', /as eaten \(cooked weight\)/.test(list.textContent) && /Monday: Rajma, 150 g/.test(q('prep-list').textContent));
  list.querySelector('input[type=checkbox]').click(); await tick(100);
  ck('ticking an item crosses it off and is remembered for this plan version', /1 to buy/.test(q('grocery-list').textContent) && JSON.parse(w.localStorage.getItem('fitlife-grocery-9-v2') || '{}').Curd === true);
  let copied = '';
  w.navigator.clipboard = { writeText: async (t) => { copied = t; } };
  q('grocery-share').click(); await tick(200);
  ck('"Share the list" copies a plain list where the phone cannot share', /Grocery list — Low carb vegetarian/.test(copied) && /- Curd: 1\.4 kg/.test(copied) && /Copied/.test(q('grocery-note')?.textContent || ''), copied);
}

// ═══════════════════════════════════════════════════════════════════════════
// 30. Phase 6 — swaps: the member picks or asks; the coach approves
// ═══════════════════════════════════════════════════════════════════════════
async function swapsTest() {
  console.log('\n[30] Swaps (Phase 6)');
  const api = stub('api-swaps.js', `
    window.__posts = [];
    let rows = [
      { id: 1, food_name: 'Guava', alt_name: 'Papaya', alt_per_100g: { calories: 43 }, status: 'requested', source: 'member', note: 'guava not in season' },
      { id: 2, food_name: 'Paneer', alt_name: 'Tofu', alt_per_100g: { calories: 76 }, status: 'suggested', source: 'ai' },
      { id: 3, food_name: 'Guava', alt_name: 'Banana', alt_per_100g: { calories: 89 }, status: 'approved', source: 'ai' } ];
    const get = async (url) => {
      if (/\\/swaps\\/me$/.test(url)) return { data: { approved: { guava: [{ id: 3, name: 'Banana', per_100g: { calories: 89 } }] }, requests: [] } };
      if (/\\/swaps\\/member\\/12$/.test(url)) return { data: { swaps: rows } };
      return { data: {} }; };
    const post = async (url, body) => { window.__posts.push({ url, body });
      if (/\\/swaps\\/request$/.test(url)) return { data: { status: 'requested', message: 'Sent to your coach. Until they say yes, keep to the plan.' } };
      const m = /\\/swaps\\/(\\d+)\\/decide$/.exec(url);
      if (m) { rows = rows.map(r => r.id === +m[1] ? { ...r, status: body.approve ? 'approved' : 'declined' } : r); return { data: { swaps: rows } }; }
      return { data: { swaps: rows } }; };
    export default { get, post, put: post, patch: post, delete: post };`);
  const code = await bundle(`
    import { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import LogPlannedSheet from './components/sheets/LogPlannedSheet.jsx';
    const meal = { meal: 'Meal 2', time: '16:00', items: [{ name: 'Guava', grams: 150, per_100g: { calories: 68 } }, { name: 'Almonds', grams: 20, per_100g: { calories: 579 } }] };
    meal.pending = meal.items;
    window.__updates = [];
    function H() { const [food, setFood] = useState([]); const [open, setOpen] = useState(true);
      return <LogPlannedSheet meal={open ? meal : null} onClose={() => setOpen(false)} m={{ log: { food }, terms: { kcal: 'kcal' }, update: (f, v) => { window.__updates.push(v); setFood(v); } }} />; }
    createRoot(document.getElementById('root')).render(<H />);`, api);
  const { w, errors } = run(code); await tick(500);
  const d = w.document; const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  const toggles = [...d.querySelectorAll('[data-testid="swap-toggle"]')];
  ck('only a food with approved swaps offers "Swap"; every food offers "Ask for a swap"', errors.length === 0 && toggles.length === 1 && /Swap \(1\)/.test(toggles[0].textContent) && d.querySelectorAll('[data-testid="swap-ask"]').length === 2, errors.join('|'));
  toggles[0].click(); await tick(100);
  const opt = q('swap-option');
  ck('the swap shows the grams that keep the calories: Banana · 115 g', !!opt && /Banana · 115 g/.test(opt.textContent), opt?.textContent);
  opt.click(); await tick(100);
  const grams = [...d.querySelectorAll('input[type=number]')][0];
  ck('picking it changes the row to Banana, 115 g, "instead of Guava · same kcal"', /Banana/.test(d.body.textContent) && /instead of Guava · same kcal/.test(d.body.textContent) && grams.value === '115');
  ck('and the change line says so before saving', /Banana 115 g instead of Guava/.test(q('planned-changes')?.textContent || ''), q('planned-changes')?.textContent);
  q('planned-save').click(); await tick(500);
  const up = w.__updates[0] || [];
  ck('saving logs Banana 115 g under Meal 2, and the almonds as planned', up.length === 2 && up.find(r => r.name === 'Banana')?.grams === 115 && up.find(r => r.name === 'Banana').meal === 'Meal 2' && up.find(r => r.name === 'Almonds')?.grams === 20, up);

  const A = run(code); await tick(500);
  const ad = A.w.document;
  [...ad.querySelectorAll('[data-testid="swap-ask"]')][1].click(); await tick(100);
  const box = ad.querySelector('[data-testid="swap-ask-form"] input');
  Object.getOwnPropertyDescriptor(A.w.HTMLInputElement.prototype, 'value').set.call(box, 'Cashews');
  box.dispatchEvent(new A.w.Event('input', { bubbles: true })); await tick(50);
  ad.querySelector('[data-testid="swap-ask-send"]').click(); await tick(200);
  const req = A.w.__posts.find(p => /\/swaps\/request$/.test(p.url));
  ck('"Ask for a swap" sends the food and what they would like instead', req?.body.food_name === 'Almonds' && req.body.alt_name === 'Cashews', req?.body);
  ck('and says: sent to your coach, keep to the plan until then', /keep to the plan/.test(ad.querySelector('[data-testid="swap-ask-note"]')?.textContent || ''));

  // ── Coach ───────────────────────────────────────────────────────────────────
  const panel = await bundle(`
    import { createRoot } from 'react-dom/client';
    import SwapsPanel from './components/coach/SwapsPanel.jsx';
    createRoot(document.getElementById('root')).render(<SwapsPanel memberId={12} memberName="Padmini Ravi" />);`, api);
  const P = run(panel); await tick(400);
  const pq = (id) => P.w.document.querySelector(`[data-testid="${id}"]`);
  ck('the coach sees the request first, with the member\'s note', P.errors.length === 0 && /Swaps · 1 asked/.test(pq('swaps-panel').textContent) && /Guava →\s*Papaya/.test(pq('swap-request').textContent) && /Padmini asked: "guava not in season"/.test(pq('swap-request').textContent));
  ck('the AI\'s suggestion waits for approval; the approved one is listed', /Paneer →\s*Tofu/.test(pq('swap-suggested').textContent) && /Guava → Banana/.test(pq('swaps-approved').textContent));
  pq('swap-request').querySelector('[data-testid="swap-approve"]').click(); await tick(200);
  ck('Approve sends the decision and moves it to Approved', P.w.__posts.some(p => /\/swaps\/1\/decide$/.test(p.url) && p.body.approve === true) && /Guava → Papaya/.test(pq('swaps-approved').textContent) && !pq('swap-request'));
  pq('swap-suggested').querySelector('[data-testid="swap-decline"]').click(); await tick(200);
  ck('Decline removes the suggestion', P.w.__posts.some(p => /\/swaps\/2\/decide$/.test(p.url) && p.body.approve === false) && !pq('swap-suggested'));
  pq('swaps-suggest').click(); await tick(200);
  ck('"Suggest more swaps (AI)" asks the server for this member', P.w.__posts.some(p => p.url === '/swaps/member/12/suggest'));
}

// ═══════════════════════════════════════════════════════════════════════════
// 31. Phase 7 — weekly check-in, and the coach's weekly brief
// ═══════════════════════════════════════════════════════════════════════════
async function weeklyTest() {
  console.log('\n[31] Weekly check-in and coach brief (Phase 7)');
  const api = stub('api-weekly.js', `
    window.__posts = []; window.__gets = [];
    const Q = [{ key: 'energy', label: 'Energy', low: 'Drained', high: 'Great' }, { key: 'hunger', label: 'Hunger', low: 'Starving', high: 'Never hungry' },
      { key: 'sleep', label: 'Sleep', low: 'Poor', high: 'Deep' }, { key: 'stress', label: 'Stress', low: 'Calm', high: 'Very high' },
      { key: 'plan', label: 'Sticking to the plan', low: 'Struggled', high: 'Easy' }];
    let done = null;
    const brief = (src) => ({ brief: { week_end: '2026-10-04', source: src, text: 'Logged 5 of 7 days; stress was high (5/5) around a wedding.\\nTry: ask how the week ahead looks.',
      facts: { week_start: '2026-09-28', week_end: '2026-10-04', days_logged: 5, avg_kcal: 1400, weight_change: -0.8, workout_days: 2,
               checkin: { answers: { energy: 3, hunger: 2, sleep: 3, stress: 5, plan: 4 }, note: 'Wedding at home' } } }, questions: Q });
    const get = async (url) => { window.__gets.push(url);
      if (/\\/weekly\\/checkin$/.test(url)) return { data: { open: window.__open !== false, week_end: '2026-10-04', questions: Q, checkin: done } };
      if (/\\/weekly\\/brief\\/12$/.test(url)) return { data: brief('ai') };
      return { data: {} }; };
    const post = async (url, body) => { window.__posts.push({ url, body });
      if (/\\/weekly\\/checkin$/.test(url)) { done = body; return { data: { ok: true } }; }
      if (/\\/weekly\\/brief\\/12$/.test(url)) return { data: brief('template') };
      return { data: {} }; };
    export default { get, post, put: post, patch: post, delete: post };`);
  const card = await bundle(`
    import { createRoot } from 'react-dom/client';
    import CheckinCard from './components/checkin/CheckinCard.jsx';
    createRoot(document.getElementById('root')).render(<CheckinCard />);`, api);
  const { w, errors } = run(card); await tick(300);
  const d = w.document; const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('on Sunday/Monday with no check-in, the card shows', errors.length === 0 && /How was your week\?/.test(q('checkin-card')?.textContent || ''), errors.join('|'));
  const C = run(card, (win) => { win.__open = false; }); await tick(300);
  ck('closed days: no card', !C.w.document.querySelector('[data-testid="checkin-card"]'));
  q('checkin-card').click(); await tick(400);
  const groups = [...d.querySelectorAll('[role=radiogroup]')];
  ck('five questions, each 1 to 5 with words for each end', groups.length === 5 && groups.every(g => g.querySelectorAll('[role=radio]').length === 5) && /1 Calm · 5 Very high/.test(d.body.textContent));
  ck('send is not possible until all five are answered', q('checkin-save').disabled === true && /0 of 5 answered/.test(q('checkin-save').textContent));
  groups.forEach((g, i) => g.querySelectorAll('[role=radio]')[[2, 1, 2, 4, 3][i]].click()); await tick(100);
  const note = q('checkin-note');
  Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(note, 'Wedding at home');
  note.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(50);
  ck('the chosen answer is marked', groups[3].querySelectorAll('[role=radio]')[4].getAttribute('aria-checked') === 'true' && q('checkin-save').disabled === false);
  q('checkin-save').click(); await tick(500);
  const sent = w.__posts.find(p => /\/weekly\/checkin$/.test(p.url));
  ck('it sends the five answers and the note', JSON.stringify(sent?.body.answers) === '{"energy":3,"hunger":2,"sleep":3,"stress":5,"plan":4}' && sent.body.note === 'Wedding at home', sent?.body);
  ck('and the card goes away', !q('checkin-card'));

  const br = await bundle(`
    import { createRoot } from 'react-dom/client';
    import WeeklyBrief from './components/coach/WeeklyBrief.jsx';
    createRoot(document.getElementById('root')).render(<WeeklyBrief memberId={12} />);`, api);
  const B = run(br); await tick(400);
  const bq = (id) => B.w.document.querySelector(`[data-testid="${id}"]`);
  ck('the coach sees the week, the brief and that only they see it', B.errors.length === 0 && /Week brief · .*28 Sep.*4 Oct/.test(bq('weekly-brief').textContent) && /stress was high/.test(bq('brief-text').textContent) && /Only you see this/.test(bq('weekly-brief').textContent), B.errors.join('|'));
  ck('the numbers under it: days, kcal, weight, workouts', /5\/7/.test(bq('brief-facts').textContent) && /1400/.test(bq('brief-facts').textContent) && /-0.8 kg/.test(bq('brief-facts').textContent));
  const stress = [...bq('brief-checkin').querySelectorAll('span')].find(x => /Stress 5\/5/.test(x.textContent));
  ck('the check-in answers, a worrying one marked, and the note', !!stress && /amber/.test(stress.className) && /Wedding at home/.test(bq('brief-checkin').textContent));
  bq('brief-refresh').click(); await tick(300);
  ck('Refresh writes it again; a brief without the AI says so', B.w.__posts.some(p => /\/weekly\/brief\/12$/.test(p.url)) && /The AI was unavailable/.test(bq('weekly-brief').textContent));
}

// ═══════════════════════════════════════════════════════════════════════════
// 32. Phase 8 — Kannada voice pilot: the member records, the coach compares
// ═══════════════════════════════════════════════════════════════════════════
async function voicePilotTest() {
  console.log('\n[32] Kannada voice pilot (Phase 8)');
  const api = stub('api-vp.js', `
    window.__posts = []; window.__dels = [];
    let consented = !!window.__consented;
    const phrases = () => [
      { id: 'k01', say: 'Belagge eradu idli mattu ondu bowl sambar thinde', means: 'This morning I ate two idli and a bowl of sambar', recorded: !!window.__k01, heard: window.__k01 || null },
      { id: 'f01', say: 'Your own words: what did you eat yesterday?', means: 'Say it the way you would tell a friend', free: true, recorded: false } ];
    const get = async (url, cfg) => {
      if (/\\/voice-pilot\\/me$/.test(url)) return { data: window.__invited === false ? { invited: false } : { invited: true, consented, phrases: phrases() } };
      if (/\\/voice-pilot\\/members$/.test(url)) return { data: { members: [{ patient_id: 12, name: 'Padmini', active: true, consented_at: 'x', recorded: 1 },
        ...(window.__partial ? [{ patient_id: 16, name: 'Mrs. Padmini', active: false, recorded: 0 }] : [])], phrases: 22 } };
      // The first real run: one engine gave no answer for some recordings.
      if (/\\/voice-pilot\\/results$/.test(url) && window.__partial) return { data: { overall: { gemini: 57, whisper: 69, samples: 7, scored: 7, gemini_answered: 5, whisper_answered: 7 },
        phrases: [{ id: 'k01', say: 'Belagge eradu idli mattu ondu bowl sambar thinde', samples: 1, gemini: null, whisper: 100, gemini_answered: 0, whisper_answered: 1 },
                  { id: 'k02', say: 'Breakfast-ge ondu plate upma, ondu cup coffee', samples: 2, gemini: 50, whisper: 50, gemini_answered: 1, whisper_answered: 2 }],
        samples: [{ id: 1, phrase_id: 'k01', name: 'Padmini', gemini: null, gemini_problem: '429: Quota exceeded', whisper: 'Vedete eradu idli', whisper_problem: null, audio_url: 'https://x.r2.cloudflarestorage.com/a.webm' }] } };
      if (/\\/voice-pilot\\/results$/.test(url)) return { data: { overall: { gemini: 100, whisper: 67, samples: 1 },
        phrases: [{ id: 'k01', say: 'Belagge eradu idli mattu ondu bowl sambar thinde', samples: 1, gemini: 100, whisper: 67 }],
        samples: [{ id: 1, phrase_id: 'k01', name: 'Padmini', gemini: 'Belagge eradu idli', whisper: 'Belage eradu idly', audio_url: 'https://x.r2.cloudflarestorage.com/a.webm' }] } };
      if (/\\/admin\\/members$/.test(url)) return { data: [{ id: 12, name: 'Padmini', active: true }, { id: 13, name: 'Ravi', active: true }, { id: 15, name: 'Old Account', active: false }] };
      if (/^\\/members$/.test(url)) { window.__coachList = true; return { data: [{ id: 12, name: 'Padmini' }, { id: 14, name: 'Coach Member' }] }; }
      if (/results\\.csv$/.test(url)) { window.__csvCfg = cfg; return { data: new Blob(['member,line_id'], { type: 'text/csv' }), headers: { 'content-disposition': 'attachment; filename="FitLife-Voice-Pilot-2026-10-07.csv"' } }; }
      return { data: {} }; };
    const post = async (url, body) => { window.__posts.push({ url, body });
      if (/consent$/.test(url)) consented = true;
      if (/sample$/.test(url)) { window.__k01 = 'Belagge eradu idli mattu ondu bowl sambar thinde'; return { data: { ok: true, heard: window.__k01 } }; }
      return { data: { ok: true } }; };
    const del = async (url) => { window.__dels.push(url); return { data: { ok: true } }; };
    export default { get, post, put: post, patch: post, delete: del };`);
  const prep = (opts = {}) => (win) => {
    Object.assign(win, opts);
    win.confirm = () => true;
    win.URL.createObjectURL = () => 'blob:take'; win.URL.revokeObjectURL = () => {};
    win.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() { win.__trackStopped = true; } }] }) };
    win.MediaRecorder = class { constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm;codecs=opus'; }
      start() { this.state = 'recording'; } stop() { this.state = 'inactive'; this.ondataavailable({ data: new win.Blob(['voice'], { type: 'audio/webm' }) }); this.onstop(); } };
  };
  const card = await bundle(`
    import { createRoot } from 'react-dom/client';
    import VoicePilotCard from './components/voicepilot/VoicePilotCard.jsx';
    createRoot(document.getElementById('root')).render(<VoicePilotCard />);`, api);
  const N = run(card, prep({ __invited: false })); await tick(300);
  ck('a member who was not invited sees nothing', N.errors.length === 0 && !N.w.document.querySelector('[data-testid="vp-card"]'));
  const { w, errors } = run(card, prep()); await tick(300);
  const d = w.document; const q = (id) => d.querySelector(`[data-testid="${id}"]`);
  ck('an invited member sees the card', errors.length === 0 && /Kannada voice test/.test(q('vp-card')?.textContent || ''), errors.join('|'));
  q('vp-card').click(); await tick(400);
  ck('first they read what is recorded, who hears it, 90 days, nothing logged, stop any time', !!q('vp-consent') && /Only your coach hears the recordings/.test(q('vp-consent').textContent)
     && /deleted after 90 days/.test(q('vp-consent').textContent) && /Nothing you record is added to your food log/.test(q('vp-consent').textContent) && /stop at any time/.test(q('vp-consent').textContent));
  q('vp-agree').click(); await tick(300);
  ck('agreeing is sent, then the lines show with what they mean', w.__posts.some(p => /consent$/.test(p.url)) && !!q('vp-phrases') && /This morning I ate two idli/.test(q('vp-phrases').textContent));
  q('vp-phrase-k01').click(); await tick(100);
  q('vp-rec-k01').querySelector('[data-testid="vp-record"]').click(); await tick(100);
  ck('Record starts, and the button becomes Stop', /Stop/.test(q('vp-rec-k01').querySelector('[data-testid="vp-record"]').textContent));
  q('vp-rec-k01').querySelector('[data-testid="vp-record"]').click(); await tick(200);
  ck('stopping lets them play the take back before sending, and releases the microphone', !!q('vp-playback') && w.__trackStopped === true);
  q('vp-send').click(); await tick(500);
  const sent = w.__posts.find(p => /\/voice-pilot\/sample$/.test(p.url));
  ck('Send uploads that line\'s recording, as audio with its type', sent?.body.phrase_id === 'k01' && sent.body.mimeType === 'audio/webm' && typeof sent.body.audio === 'string' && sent.body.audio.length > 0, sent?.body && { ...sent.body, audio: '…' });
  ck('the line is ticked, with what was heard', /Heard: “Belagge eradu idli/.test(q('vp-phrases').textContent));
  q('vp-withdraw').click(); await tick(300);
  ck('"Stop and delete my recordings" asks, then sends it', w.__posts.some(p => /withdraw$/.test(p.url)));

  const panel = await bundle(`
    import { createRoot } from 'react-dom/client';
    import VoicePilotPanel from './components/voicepilot/VoicePilotPanel.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 1, name: 'Admin', role: 'admin' }, isRestoring: false });
    createRoot(document.getElementById('root')).render(<VoicePilotPanel />);`, api);
  const P = run(panel, prep()); await tick(400);
  const pq = (id) => P.w.document.querySelector(`[data-testid="${id}"]`);
  ck('the coach sees both engines\' overall scores', P.errors.length === 0 && /Gemini 100% · Whisper 67% · 1 recording$/.test((pq('vp-overall')?.textContent || '').trim()), P.errors.join('|'));
  ck('who is in the test and how far they got; the invite list leaves them out', /Padmini/.test(pq('vp-members').textContent) && /1 recorded/.test(pq('vp-members').textContent)
     && ![...P.w.document.querySelectorAll('select option')].some(o => o.textContent === 'Padmini'));
  const sel = P.w.document.querySelector('select'); sel.value = '13'; sel.dispatchEvent(new P.w.Event('change', { bubbles: true })); await tick(50);
  pq('vp-invite').click(); await tick(200);
  ck('Invite sends that member', P.w.__posts.some(p => /\/voice-pilot\/invite$/.test(p.url) && p.body.member_id === 13));
  pq('vp-row').click(); await tick(100);
  const s = pq('vp-sample');
  ck('a line opens to each recording: player, Gemini and Whisper side by side', !!s && !!s.querySelector('audio') && /Gemini: Belagge eradu idli/.test(s.textContent) && /Whisper: Belage eradu idly/.test(s.textContent));
  ck('"Download results" says what is in the file: codes, no names, no audio; check own words', /M1, M2…, no names, no audio/.test(pq('vp-panel').textContent) && /own words/.test(pq('vp-panel').textContent));
  P.w.__downloads = []; P.w.HTMLAnchorElement.prototype.click = function () { P.w.__downloads.push(this.download); };
  pq('vp-download').click(); await tick(300);
  ck('it fetches the CSV with the login, as a file, and saves it with the server\'s name', P.w.__csvCfg?.responseType === 'blob' && P.w.__downloads[0] === 'FitLife-Voice-Pilot-2026-10-07.csv', [P.w.__csvCfg, P.w.__downloads]);

  // 7 Oct: the first real run showed "Gemini 80%" when Gemini had answered 5 of 7.
  const PP = run(panel, (win) => { prep()(win); win.__partial = true; }); await tick(400);
  const ppq = (id) => PP.w.document.querySelector(`[data-testid="${id}"]`);
  ck('the headline counts no-answers as misses and says how many were answered', PP.errors.length === 0 && /Gemini 57% \(answered 5 of 7\) · Whisper 69% · 7 recordings$/.test((ppq('vp-overall')?.textContent || '').trim()), [PP.errors.join('|'), ppq('vp-overall')?.textContent]);
  const prow = [...PP.w.document.querySelectorAll('[data-testid="vp-row"]')];
  ck('a line an engine never answered reads "no answer"; a partly answered one says "1 of 2"', /no answer/.test(prow[0].children[1].textContent) && /100%/.test(prow[0].children[2].textContent) && /50%\s*1 of 2/.test(prow[1].children[1].textContent) && !/of 2/.test(prow[1].children[2].textContent), prow.map(x => x.textContent));
  prow[0].click(); await tick(100);
  ck('opened, the recording says why: "no answer — 429: Quota exceeded"', /Gemini: no answer — 429: Quota exceeded/.test(ppq('vp-sample').textContent) && /Whisper: Vedete eradu idli/.test(ppq('vp-sample').textContent), ppq('vp-sample')?.textContent);
  ck('a switched-off account is not offered in the invite list, and one already listed reads "account off"', ![...PP.w.document.querySelectorAll('select option')].some(o => o.textContent === 'Old Account')
     && [...PP.w.document.querySelectorAll('select option')].some(o => o.textContent === 'Ravi') && /Mrs\. Padmini\s*account off/.test(ppq('vp-members').textContent), ppq('vp-members')?.textContent);

  // On the coach's home: folded, and the invite list is the coach's own members.
  const coachPanel = await bundle(`
    import { createRoot } from 'react-dom/client';
    import VoicePilotPanel from './components/voicepilot/VoicePilotPanel.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 300, name: 'Sachin', role: 'monitor' }, isRestoring: false });
    createRoot(document.getElementById('root')).render(<VoicePilotPanel collapsible />);`, api);
  const CP = run(coachPanel, prep()); await tick(400);
  const cq = (id) => CP.w.document.querySelector(`[data-testid="${id}"]`);
  ck('for a coach it starts folded, with the scores still on the header', CP.errors.length === 0 && !!cq('vp-toggle') && !cq('vp-invite') && /Gemini 100%/.test(cq('vp-overall')?.textContent || ''), CP.errors.join('|'));
  cq('vp-toggle').click(); await tick(100);
  ck('opened: Download results is there, and the invite list is the coach\'s own members', !!cq('vp-download') && CP.w.__coachList === true && [...CP.w.document.querySelectorAll('select option')].some(o => o.textContent === 'Coach Member'));
}

// ═══════════════════════════════════════════════════════════════════════════
// 33. Review of 7 Oct — what Sachin's Android screenshots showed
// ═══════════════════════════════════════════════════════════════════════════
async function reviewFixesTest() {
  console.log('\n[33] Review fixes (7 Oct, from the Android screenshots)');
  const api = stub('api-review.js', `
    window.__posts = [];
    const get = async (url) => {
      if (/\\/adherence$/.test(url)) return { data: { enough: true, logged_days: 30, verdict: null,
        note: 'No meaningful difference in how well they sustain either split.',
        groups: [{ label: 'Lower carb', mean_carb_pct: 25, days: 15, on_target_pct: 0, mean_kcal: 809 }, { label: 'Higher carb', mean_carb_pct: 34, days: 15, on_target_pct: 13, mean_kcal: 809 }] } };
      if (/\\/trial$/.test(url)) return { data: { trial: null } };
      if (/\\/workouts\\/summary/.test(url)) return { data: { sessions: window.__sessions || [] } };
      if (/subscriptions/.test(url)) return { data: [] };
      return { data: [] }; };
    const post = async (url, body) => { window.__posts.push({ url, body }); return { data: { ok: true } }; };
    export default { get, post, put: post, patch: post, delete: post };`);

  // 1. "Hi Mrs.," — one name rule everywhere a coach writes to a member.
  const msg = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { combinedGapMessage } from './utils/personalMessage.js';
    import MemberActionSheet from './components/coach/MemberActionSheet.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 1, name: 'Sachin', role: 'admin' }, isRestoring: false });
    window.__m = [combinedGapMessage({ name: 'Mrs. Padmini' }, []), combinedGapMessage({ name: 'T V Sharada' }, ['dormant'], 20), combinedGapMessage({ name: '' }, [])];
    createRoot(document.getElementById('root')).render(<MemberActionSheet open onClose={() => {}} member={{ id: 5, name: 'Mrs. Padmini', phone: '9845028460' }} initialTab="push" />);`, api);
  const M = run(msg); await tick(400);
  ck('the WhatsApp message greets Mrs. Padmini as Padmini, not "Mrs."', /^Hi Padmini, /.test(M.w.__m[0]) && !/Hi Mrs/.test(M.w.__m[0]), M.w.__m[0]);
  ck('T V Sharada is Sharada; no name at all is "there"', /^Hi Sharada, /.test(M.w.__m[1]) && /^Hi there, /.test(M.w.__m[2]), M.w.__m);
  const ta = M.w.document.querySelector('textarea');
  ck('the push message starts "Hi Padmini, " and the sheet is headed with her name', M.errors.length === 0 && ta?.value === 'Hi Padmini, ' && /Padmini/.test(M.w.document.body.textContent) && !/Mrs\.(?! Padmini)/.test(M.w.document.body.textContent), [M.errors.join('|'), ta?.value]);
  const srcOf = (f) => fs.readFileSync(path.join(CLIENT_SRC, f), 'utf8');
  ck('no screen takes "the first word" of a name any more', ['components/coach/MemberActionSheet.jsx', 'components/coach/SwapsPanel.jsx', 'utils/personalMessage.js', 'pages/Progress.jsx', 'pages/Login.jsx']
     .every(f => !/\.split\((' '|" "|\/\\s\+\/)\)\[0\]/.test(srcOf(f)) && /personName/.test(srcOf(f))));

  // 2. Raw "’" shown as text. In screen markup a \u code is NOT turned
  // into the character (only inside {'…'} or {`…`} is). Read every screen with
  // a real parser, so this cannot come back anywhere.
  {
    const req = createRequire(import.meta.url);
    const { parse } = req('@babel/parser');
    const bad = [];
    const walk = (node, file) => {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'JSXText' && /\\u[0-9a-fA-F]{4}/.test(node.value)) bad.push(`${file}:${node.loc.start.line} text`);
      if (node.type === 'JSXAttribute' && node.value?.type === 'StringLiteral' && /\\u[0-9a-fA-F]{4}/.test(node.value.extra?.raw || '')) bad.push(`${file}:${node.loc.start.line} ${node.name.name}=`);
      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'extra') continue;
        const v = node[k];
        if (Array.isArray(v)) v.forEach(x => walk(x, file)); else if (v && typeof v === 'object') walk(v, file);
      }
    };
    let files = 0;
    const all = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? all(path.join(dir, e.name)) : /\.jsx$/.test(e.name) ? [path.join(dir, e.name)] : []);
    for (const f of all(CLIENT_SRC)) { files++; walk(parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] }).program, path.relative(CLIENT_SRC, f)); }
    ck(`no screen shows a raw \\u code as text (${files} screens read with a parser)`, files > 80 && bad.length === 0, bad);
    const probe = []; const keep = bad.length;
    walk(parse(`const A = () => <p title="Who\\u2019s">isn\\u2019t {'fine\\u2019'}</p>;`, { sourceType: 'module', plugins: ['jsx'] }).program, 'probe');
    ck('and that check does catch one when it is there (text and attribute, not the {\'…\'} form)', bad.length - keep === 2, bad.slice(keep));
  }

  // 3. The chat input bar was see-through on Android.
  {
    const css = fs.readFileSync(path.join(CLIENT_SRC, 'index.css'), 'utf8');
    const m = css.match(/\.glass-solid\s*\{[^}]*background:\s*rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/);
    ck('the chat bar has a near-solid background of its own, declared after .glass', !!m && Number(m[1]) >= 0.9 && css.indexOf('.glass-solid') > css.indexOf('.glass {'), m?.[0]);
    ck('and the chat bar uses it', /className="glass glass-solid [^"]*" data-testid="composer-bar"/.test(srcOf('components/AIChatLog.jsx')));
    try {
      const puppeteerCore = (await import('puppeteer-core')).default;
      const chromiumPkg = (await import('@sparticuz/chromium')).default; const chromium = chromiumPkg.default || chromiumPkg;
      const distDir = path.join(ROOT, 'client', 'dist', 'assets');
      const built = fs.readFileSync(path.join(distDir, fs.readdirSync(distDir).find(f => f.endsWith('.css'))), 'utf8');
      const browser = await puppeteerCore.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'], headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(`<!doctype html><html><head><style>${built}</style></head><body style="background:#121316"><p style="color:#fff">text under the bar</p><div class="fade-up" style="position:fixed;left:0;right:0;top:0"><div id="bar" class="glass glass-solid">bar</div><div id="plain" class="glass">plain</div></div></body></html>`);
        const bg = await page.evaluate(() => ({ bar: getComputedStyle(document.getElementById('bar')).backgroundColor, plain: getComputedStyle(document.getElementById('plain')).backgroundColor }));
        const alpha = (c) => { const x = c.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number); return x.length === 4 ? x[3] : 1; };
        ck('in real Chrome, with the built stylesheet: the bar is at least 90% solid; plain glass is under 10%', alpha(bg.bar) >= 0.9 && alpha(bg.plain) < 0.1, bg);
      } finally { await browser.close(); }
    } catch (e) { console.log('  – browser not installed, the chat bar was NOT checked in Chrome (' + String(e.message).slice(0, 60) + ')'); }
  }

  // 5. Macro Lab said the same sentence twice.
  const ml = await bundle(`
    import { createRoot } from 'react-dom/client';
    import MacroLab from './components/MacroLab.jsx';
    createRoot(document.getElementById('root')).render(<MacroLab memberId={5} />);`, api);
  const L = run(ml); await tick(500);
  const said = (L.w.document.body.textContent.match(/No meaningful difference in how well they sustain either split\./g) || []).length;
  ck('Macro Lab: "No meaningful difference…" is said once', L.errors.length === 0 && said === 1, [L.errors.join('|'), said]);

  // 6, 20. Settings as a coach: no member-only cards; a phone the browser allows but FitLife could not register says so.
  const st = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom';
    import Settings from './pages/Settings.jsx';
    import { useAuthStore } from './store/authStore.js';
    useAuthStore.setState({ user: { id: 300, name: 'Sachin', role: window.__role || 'monitor' }, isRestoring: false });
    createRoot(document.getElementById('root')).render(<MemoryRouter><Settings /></MemoryRouter>);`, api);
  const allowPush = (win) => {
    win.Notification = { permission: 'granted', requestPermission: async () => 'granted' };
    win.PushManager = function PushManager() {};
    Object.defineProperty(win.navigator, 'serviceWorker', { configurable: true, value: { ready: new Promise(() => {}) } });
  };
  const C = run(st, allowPush); await tick(600);
  const ct = C.w.document.body.textContent;
  ck('a coach\'s Settings has no "Who is using this app?", "My avatar" or "Meal slots"', C.errors.length === 0 && !/Who is using this app\?/.test(ct) && !/My avatar/.test(ct) && !/Meal slots/.test(ct) && /Appearance/.test(ct) && /Push Notifications/.test(ct), C.errors.join('|'));
  ck('allowed by the browser but not registered: it says so, with "Try again", not "Notifications are on"', !!C.w.document.querySelector('[data-testid="push-not-registered"]') && /this phone is not registered/.test(ct) && /Try again/.test(ct) && !/Notifications are on for this device/.test(ct), ct.slice(ct.indexOf('Push Notifications'), ct.indexOf('Push Notifications') + 200));
  const Mb = run(st, (win) => { win.__role = 'patient'; }); await tick(600);
  ck('a member still has all three', /Who is using this app\?/.test(Mb.w.document.body.textContent) && /My avatar/.test(Mb.w.document.body.textContent) && /Meal slots/.test(Mb.w.document.body.textContent));

  // 11. The printed report on a phone.
  ck('the print report tells the phone its width (it was drawn desktop-wide and shrunk)', /<meta name="viewport" content="width=device-width,initial-scale=1">\s*\n\s*<title>FitLife Report/.test(srcOf('pages/Monitor.jsx')) && /@media screen and \(max-width:640px\)/.test(srcOf('pages/Monitor.jsx')));

  // 13. Section icons: a title whose icon is not in the set shows a dash.
  {
    const ui = srcOf('components/UI.jsx');
    const set = ui.slice(ui.indexOf('const GLYPH = {'), ui.indexOf('function SectionGlyph'));
    const have = new Set([...set.matchAll(/^\s*'([^']+)':/gm)].map(x => x[1]));
    const missing = [];
    const all = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? all(path.join(dir, e.name)) : /\.jsx$/.test(e.name) ? [path.join(dir, e.name)] : []);
    let titles = 0;
    for (const f of all(CLIENT_SRC)) for (const mm of fs.readFileSync(f, 'utf8').matchAll(/<SectionTitle[^>]*?icon="([^"]+)"/g)) { titles++; if (!have.has(mm[1])) missing.push(`${path.relative(CLIENT_SRC, f)} ${mm[1]}`); }
    ck(`every section title's icon is in the icon set (${titles} titles; 13 were showing a dash)`, titles > 40 && missing.length === 0, missing);
  }
  const icons = await bundle(`
    import { createRoot } from 'react-dom/client';
    import { SectionTitle } from './components/UI.jsx';
    createRoot(document.getElementById('root')).render(<div>{['📅', '💧', '👤', '🔐', '🎨', '😊', '🛡️', '🧠'].map(i => <SectionTitle key={i} icon={i}>x</SectionTitle>)}<SectionTitle icon="🦄">unknown</SectionTitle></div>);`);
  const I = run(icons); await tick(200);
  ck('the new icons draw (8 checked), and an unknown one still falls back to the dash', I.errors.length === 0 && I.w.document.querySelectorAll('svg').length === 8 && I.w.document.querySelectorAll('span.h-px').length === 1, [I.errors.join('|'), I.w.document.querySelectorAll('svg').length]);

  // 18. Training summary: no heading over a blank when nothing was lifted.
  const ts = await bundle(`
    import { createRoot } from 'react-dom/client';
    import TrainingSummary from './components/TrainingSummary.jsx';
    createRoot(document.getElementById('root')).render(<TrainingSummary bodyWeightKg={80} />);`, api);
  const walk = (date) => ({ date, session_date: date, volume_kg: 0, set_count: 0, cardio: [{ type: 'walking', duration_min: 30, distance_km: 2.5 }], cardio_min: 30, kcal: 102 });
  const T0 = run(ts, (win) => { win.__sessions = [walk('2026-09-09'), walk('2026-09-10')]; }); await tick(500);
  const T1 = run(ts, (win) => { win.__sessions = [walk('2026-09-09'), { ...walk('2026-09-10'), volume_kg: 1200, set_count: 6 }]; }); await tick(500);
  ck('walking only: sessions are listed with no "Volume per session" block', T0.errors.length === 0 && /Recent sessions/.test(T0.w.document.body.textContent) && !/Volume per session/.test(T0.w.document.body.textContent), [T0.errors.join('|'), T0.w.document.body.textContent.slice(0, 200)]);
  ck('with weights lifted it is there', /Volume per session/.test(T1.w.document.body.textContent), T1.w.document.body.textContent.slice(0, 200));

  // 16. Coach member list: "No weight" on its own line.
  ck('coach list: "No weight" is a line of its own above the % pill', /<div className="text-xs text-ghost">No weight<\/div>/.test(srcOf('pages/PatientList.jsx')));
}

async function overflowTest() {
  console.log('\n[9] horizontal overflow at phone widths (headless Chrome)');

  let puppeteerCore, chromiumPkg;
  try {
    puppeteerCore = (await import('puppeteer-core')).default;
    chromiumPkg   = (await import('@sparticuz/chromium')).default;
  } catch {
    // Announced, never silent. The count of assertions this suite reports drops
    // when the browser is absent, so a green tick can never stand in for a
    // check that did not run.
    console.log('  – browser not installed, overflow check NOT RUN');
    console.log('    cd server && npm run test:ui:install');
    return;
  }
  const chromium = chromiumPkg.default || chromiumPkg;
  const api = stub('api-overflow.js', OVERFLOW_API_STUB);
  // The COMPILED stylesheet, not src/index.css.
  //
  // src/index.css is the Tailwind SOURCE — three @tailwind directives and some
  // custom rules. Injecting it gives the page the design tokens and none of the
  // utility classes, so every flex row, width and padding in the app is absent
  // and nothing can overflow. The check passed on a page with no layout at all:
  // a vacuous pass of exactly the kind this repo keeps producing.
  //
  // Reading from dist/ means the suite tests what a member actually downloads.
  const distDir = path.join(ROOT, 'client', 'dist', 'assets');
  const cssFile = fs.existsSync(distDir)
    ? fs.readdirSync(distDir).find(f => f.endsWith('.css'))
    : null;
  if (!cssFile) {
    throw new Error(
      'No built stylesheet found at client/dist/assets/*.css.\n' +
      '  Run the client build first:  cd client && npm run build\n' +
      '  Without it this check renders an unstyled page and proves nothing.');
  }
  const css = fs.readFileSync(path.join(distDir, cssFile), 'utf8');

  // Served over http rather than page.setContent(). setContent leaves the page
  // on an opaque origin, where localStorage and IndexedDB throw SecurityError —
  // so DailyLog, the screen a member opens every day, could not mount and was
  // silently absent from this check. A real origin is also closer to how the
  // app actually runs.
  const shell = (css) => `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${css}</style></head><body style="margin:0"><div id="root"></div></body></html>`;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(shell(css));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}/`;

  const browser = await puppeteerCore.launch({
    executablePath: await chromium.executablePath(),
    args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
    headless: true,
  });

  try {
    for (const [label, importLine] of OVERFLOW_PAGES) {
      const code = await bundle(`
        import { createRoot } from 'react-dom/client';
        import { MemoryRouter, Routes, Route } from 'react-router-dom';
        import { useAuthStore } from './store/authStore';
        ${importLine}
        useAuthStore.setState({ accessToken: 'x',
          user: { id: 3, name: 'Sachin', role: 'admin', phone: '919111111' } });
        // A real Route, not just a Router. Without one useParams() is empty, so
        // the coach's member page requested /members/undefined, got the roster
        // back and threw — which read as a render bug rather than a missing
        // route in the harness.
        createRoot(document.getElementById('root')).render(
          <MemoryRouter initialEntries={['/coach/1']}>
            <Routes><Route path="/coach/:memberId" element={<P />} /></Routes>
          </MemoryRouter>);`, api);

      for (const width of WIDTHS) {
        const page = await browser.newPage();
        await page.setViewport({ width, height: 800, deviceScaleFactor: 2, isMobile: true });
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        try { await page.addScriptTag({ content: code }); } catch { /* reported below */ }
        await new Promise(r => setTimeout(r, 700));

        const res = await page.evaluate((vw) => {
          // A sheet renders in a portal outside #root; it counts as mounted too.
          const mounted = document.getElementById('root').innerHTML.length
            + [...document.querySelectorAll('[role=dialog]')].reduce((a, d) => a + d.innerHTML.length, 0);
          const plateResult = !!document.querySelector('[data-testid="plate-result"]');
          const scrollW = document.documentElement.scrollWidth;
          const offenders = [];
          if (scrollW > vw + 1) {
            for (const el of document.querySelectorAll('body *')) {
              const r = el.getBoundingClientRect();
              if ((r.width === 0 && r.height === 0) || r.right <= vw + 1) continue;
              if ([...el.children].some(c => c.getBoundingClientRect().right > vw + 1)) continue;
              const cls = el.className && el.className.baseVal !== undefined
                ? el.className.baseVal : String(el.className || '');
              offenders.push(`<${el.tagName.toLowerCase()} class="${cls.slice(0, 90)}"> right=${Math.round(r.right)}`);
            }
          }
          return { mounted, plateResult, scrollW, offenders: offenders.slice(0, 4) };
        }, width);
        if (process.env.UI_SHOTS) await page.screenshot({ path: `${process.env.UI_SHOTS}/${label.replace(/\W/g, '')}-${width}.png`, fullPage: true });
        await page.close();
        // The plate sheet does a real canvas downscale here, then shows the check.
        if (label === 'PlateSheet') ck(`PlateSheet @${width}px shows the check result (real canvas downscale)`, res.plateResult);

        // A page that did not mount has not been checked. Saying "no overflow"
        // about a blank screen is the vacuous pass this repo keeps finding.
        ck(`${label} @${width}px mounts`, res.mounted > 50, `root length ${res.mounted}`);
        ck(`${label} @${width}px does not scroll sideways`,
           res.scrollW <= width + 1,
           `scrollWidth ${res.scrollW} (+${res.scrollW - width}px) · ${res.offenders.join(' · ')}`);
      }
    }
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    await bootTest();
    await evalSamplesTest();
    await foodsQueueTest();
    await nudgeCardTest();
    await primitivesTest();
    await todayTest();
    await todayVisualTest();
    await progressTest();
    await planTest();
    await onboardingTest();
    await profileTest();
    await triageTest();
    await memberBriefTest();
    await memberPage9bTest();
    await cachedReadTest();
    await sprint11Test();
    await sprint11bTest();
    await sprint11cTest();
    await circuitsCardTest();
    await dietStudio13Test();
    await memberPlanTest();
    await platePhotoTest();
    await coachDocAttachTest();
    await foodLogGroupsTest();
    await progressPhotosTest();
    await planPdfTest();
    await swapsTest();
    await weeklyTest();
    await voicePilotTest();
    await reviewFixesTest();
    await overflowTest();
    await cspTest();
  } catch (err) {
    // A crash here is a failure, not a skip. A UI suite that exits quietly
    // because a dependency is missing is worse than not having one.
    console.error('\nui-tests could not run:', err.message);
    if (/Cannot find package|Could not resolve/.test(err.message)) {
      console.error('\n  Missing dependency. From the repo root: npm install\n' +
                    '  and in server/: npm install  (esbuild, jsdom, puppeteer-core,\n' +
                    '  @sparticuz/chromium — all devDependencies; build.sh installs\n' +
                    '  the server with --omit=dev so Railway never sees them)\n');
      console.error('\n  Client dependencies are not installed:\n    npm install   (from the repo root)\n');
    }
    process.exit(1);
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ui-tests: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
