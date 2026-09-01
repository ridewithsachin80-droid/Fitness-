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
import puppeteerCore from 'puppeteer-core';
import chromiumPkg from '@sparticuz/chromium';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

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
      setup(b) { b.onResolve({ filter: /api\/client$/ }, () => ({ path: apiStub })); },
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
    if (u.includes('/gaps')) return ok({ members: members.slice(0,5).map(m => ({
      member_id:m.id, name:m.name, phone:m.phone, days_since_log:m.days_since_log,
      gaps:[{key:'dormant',label:m.days_since_log+' days no log',severity:'blocking'},
            {key:'water',label:'Water well under target',severity:'medium'}], show:2 })),
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
    if (u.includes('/me/today')) return ok({ log,
      protocol:{macros:{kcal:1800,protein:120},water_target:3000,
      meal_slots:['Breakfast','Lunch','Snack','Dinner']},
      program:null, workoutSummary:{sets:[],cardio:[]}, mealPlans:[], notifications:[] });
    if (u.includes('/members') || u.includes('/patients')) return ok(members);
    if (u.includes('/logs')) return ok([log]);
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
];

async function overflowTest() {
  console.log('\n[5] horizontal overflow at phone widths (headless Chrome)');

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

  const browser = await puppeteerCore.launch({
    executablePath: await chromium.executablePath(),
    args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
    headless: true,
  });

  try {
    for (const [label, importLine] of OVERFLOW_PAGES) {
      const code = await bundle(`
        import { createRoot } from 'react-dom/client';
        import { MemoryRouter } from 'react-router-dom';
        import { useAuthStore } from './store/authStore';
        ${importLine}
        useAuthStore.setState({ accessToken: 'x',
          user: { id: 3, name: 'Sachin', role: 'admin', phone: '919111111' } });
        createRoot(document.getElementById('root')).render(
          <MemoryRouter initialEntries={['/coach/1']}><P /></MemoryRouter>);`, api);

      for (const width of WIDTHS) {
        const page = await browser.newPage();
        await page.setViewport({ width, height: 800, deviceScaleFactor: 2, isMobile: true });
        await page.setContent(
          `<!doctype html><html><head>
           <meta name="viewport" content="width=device-width,initial-scale=1">
           <style>${css}</style></head><body style="margin:0"><div id="root"></div></body></html>`,
          { waitUntil: 'domcontentloaded' });
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
  }
}

// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    await bootTest();
    await evalSamplesTest();
    await foodsQueueTest();
    await nudgeCardTest();
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
