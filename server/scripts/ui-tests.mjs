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

// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    await bootTest();
    await evalSamplesTest();
    await foodsQueueTest();
    await nudgeCardTest();
  } catch (err) {
    // A crash here is a failure, not a skip. A UI suite that exits quietly
    // because a dependency is missing is worse than not having one.
    console.error('\nui-tests could not run:', err.message);
    if (/Cannot find package|Could not resolve/.test(err.message)) {
      console.error('\n  Client dependencies are not installed:\n    npm install   (from the repo root)\n');
    }
    process.exit(1);
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ui-tests: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
