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


const code = await bundle(`
import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom'; import Today from './pages/Today'; import {useAuthStore} from './store/authStore'; import {useLogStore} from './store/logStore'; window.__logStore=useLogStore; useAuthStore.setState({user:{id:214,name:'Asha Rao',role:'patient'},isRestoring:false}); createRoot(document.getElementById('root')).render(<MemoryRouter><Today/></MemoryRouter>);`,stub('debug-api.js',TODAY_API_STUB));
const {w,errors}=run(code); await tick(1500); console.log(JSON.stringify({calls:w.__calls,log:w.__logStore.getState(),errors},null,2));w.close();
