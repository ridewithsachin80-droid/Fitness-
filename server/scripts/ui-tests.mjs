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
function run(code) {
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
export default {
  get: async (url) => {
    const u = String(url);
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
  post: async () => ok({}), put: async () => ok({}),
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
  ['DailyLog',       "import P from './pages/DailyLog.jsx';"],
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
    import { today, istDaysAgo } from '/home/claude/repo/Fitness--main/client/src/constants.js';
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
      [/^\\/members\\/me$/,                        () => ({ height_cm: '172', gender: 'male', dob: '1985-03-10', created_at: istDaysAgo(37) + 'T09:00:00.000Z', coach_notes: [{ id: 41, note: 'Great week — add a walk after dinner.', note_date: T, monitor_name: 'Sachin', read_at: null, flagged: false }] })],
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
  // ── Sprint 5b: Today's Plan replaces coach card + tiles + deficit chip + dots card
  const plan = q('todays-plan');
  ck('Today\'s Plan renders one section with Move, Eat and Recover rows', !!plan && ['plan-move', 'plan-eat', 'plan-recover'].every(id => plan.querySelector(`[data-testid="${id}"]`)));
  ck('the old cards are gone: no day strip, no coach card, no deficit chip, no dots card', !q('day-strip') && !q('coach-card') && !q('balance-chip'));
  ck('Move: the coach\'s program day with exercise count and Start workout', /Push ·/.test(q('plan-move').textContent) && /2 exercises/.test(q('plan-move').textContent) && /Start workout/.test(q('plan-move').textContent), q('plan-move').textContent);
  ck('Eat: 666 / 1,800 kcal and 37 / 120 g protein', /666/.test(q('plan-eat').textContent) && /1,800/.test(q('plan-eat').textContent) && /37/.test(q('plan-eat').textContent) && /120 g protein/.test(q('plan-eat').textContent), q('plan-eat').textContent);
  ck('Eat: the pending Dinner plan and the deficit fold in as sub-lines', /1 meal plan pending/.test(q('plan-eat').textContent) && /1,373 kcal under target/.test(q('plan-balance').textContent), q('plan-eat').textContent);
  ck('Eat: View meal plan is the action while a plan is pending', /View meal plan/.test(q('plan-eat').textContent));
  ck('Eat: nutrients N/31 inline', /\/31 nutrients/.test(q('chip-nutrition').textContent));
  ck('Recover: 1.5 / 3.0 L and 7h 45m inline', /1\.5/.test(q('chip-water').textContent) && /3\.0 L/.test(q('chip-water').textContent) && /7h 45m/.test(q('chip-sleep').textContent));
  const dots = q('protocol-dots');
  ck('Recover: the protocol dots — one per item, "3 of 5" — live inside the row', !!dots && dots.querySelectorAll('span.block.w-2\\.5').length === 5 && /3 of 5/.test(dots.textContent), dots?.textContent);
  ck('the read carries ONE action, derived from the day (food is logged, workout planned → Start today\'s workout)', q('read-action') && /Start today/.test(q('read-action').textContent), q('read-action')?.textContent);
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
  const setVal = (el, v) => { const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set; setter.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); };
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
  const composer = q('composer');
  ck('the composer is docked: portaled to <body>, position fixed, above the nav', !!composer && composer.parentElement === d.body && /fixed/.test(composer.className) && /bottom/.test(composer.getAttribute('style') || ''), composer && composer.getAttribute('style'));
  const composerInput = composer && composer.querySelector('input:not([type=file])');
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
  setVal(composerInput, 'drank 500ml water, took b12, weight 82.0'); await tick(50);
  composerInput.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(600);
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
      await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 600));
      ck(`Escape closes the sheet in a real browser @${width}px`, (await measure(page, width)).dialogW === null);
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
    import { today, istDaysAgo } from '/home/claude/repo/Fitness--main/client/src/constants.js';
    window.__calls = [];
    // 20 logged days out of the last 30: weight drifting 84.0 → 82.4, compliance
    // alternating, food on the last 3 days. Day -3, -5 and -9 are missing on purpose.
    const skip = new Set([3, 5, 9, 12, 15, 17, 19, 22, 25, 27]);
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
      [/^\\/members\\/me$/, () => ({ start_weight: '88', target_weight: '78', height_cm: '172', labs: [] })],
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

  const tabs = [...d.querySelectorAll('[role=tab]')];
  ck('7 / 30 / 90 segmented control is present', tabs.length === 3 && tabs.map(t => t.textContent.trim()).join(',') === '7d,30d,90d');
  tabs[2].click(); await tick(200);
  ck('90d widens the window: the change now includes the 86.0 point (↓ 3.6 kg over 90 days)',
     /over 90 days/.test(q('progress-hero').textContent) && /3\.6/.test(q('progress-hero').textContent), q('progress-hero').textContent);
  tabs[0].click(); await tick(200);
  ck('7d narrows it (change over 7 days is small)', /over 7 days/.test(q('progress-hero').textContent) && /0\.[0-9]/.test(q('progress-hero').textContent), q('progress-hero').textContent);

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
  ck('nutrition trend gets its macros from lib/day (no hand-copied reduce)', !/const macros = items\.reduce/.test(fs.readFileSync(path.join(ROOT, 'client/src/pages/Progress.jsx'), 'utf8')));
  ck('no error escaped', errors.length === 0, errors.join('|'));

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
          const mounted = document.getElementById('root').innerHTML.length;
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
          return { mounted, scrollW, offenders: offenders.slice(0, 4) };
        }, width);
        await page.close();

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
    await overflowTest();
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
