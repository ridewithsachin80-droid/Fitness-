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
// Browser packages are locked server devDependencies, loaded only for browser checks.
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import http from 'http';
import { browserExecutable } from './lib/browser-executable.mjs';
import { readBuiltCss } from './lib/built-css.mjs';

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
  // JSDOM has no layout. Give connected, CSS-visible controls a rectangle so
  // production modal eligibility can run; actual geometry/inert/focus behavior
  // is verified separately by test-modal-accessibility in Chromium.
  w.HTMLElement.prototype.getClientRects = function () {
    if (!this.isConnected || this.closest('[hidden]')) return [];
    for (let el = this; el; el = el.parentElement) {
      const style = w.getComputedStyle(el);
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return [];
    }
    return [new w.DOMRect(0, 0, 1, 1)];
  };
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

const waitFor = async (fn, label) => { for (let i=0;i<80;i++) { if(fn()) return; await tick(50); } throw new Error('Timed out: '+label); };
const PREM_API = TODAY_API_STUB.replace("if (url === '/ai-chat/parse') {", `
      if (url === '/ai-chat/photo') return {data: {reply:'I found oats. Check the estimated portion.', foods:[{name:'Oats',grams:100,meal:'Breakfast',qty_text:'1 bowl',per_100g:{calories:374,protein:13.2,total_carbs:60,fat:7.8},macros:{cal:374,pro:13.2,carb:60,fat:7.8}}]}};
      if (/^\\/logs\\//.test(url) && window.__failSave) throw new Error('Fixture save failure');
      if (url === '/ai-chat/parse') {`).replace("reply: 'Got it — water, B12 and your weight.'", "notes:'Felt energetic today.', reply: 'Got it — water, B12 and your weight.'");
const ENTRY = `
 import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
 import Today from './pages/Today'; import {useAuthStore} from './store/authStore';
 import {useLogStore} from './store/logStore'; import {useAIChat} from './store/aiChatStore';
 import {useSettingsStore, applyTheme} from './store/settingsStore';
 useAuthStore.setState({user:{id:214,name:'Asha Rao',role:'patient'},isRestoring:false});
 window.__logStore=useLogStore; window.__aiChat=useAIChat; window.__settings=useSettingsStore;
 applyTheme(); const root=createRoot(document.getElementById('root')); window.__testRoot=root; root.render(<MemoryRouter><Today/></MemoryRouter>);`;
function photoShim(w) {
 w.Image = class {width=800;height=600;set src(v){setTimeout(()=>this.onload?.(),0)}};
 w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});
 w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,QUJD';
}
function entryShim(w) {
 photoShim(w);
 w.__micRequests=0;w.__stoppedTracks=0;w.__recorderStarts=0;w.__pickerClicks=0;
 const stream=()=>({getTracks:()=>[{stop(){w.__stoppedTracks++}}]});
 Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia(){
   w.__micRequests++;
   if(w.__denyMic)return Promise.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'}));
   if(w.__deferMic)return new Promise(resolve=>{w.__grantMic=()=>resolve(stream())});
   return Promise.resolve(stream());
 }}});
 w.MediaRecorder=class {static isTypeSupported(){return true} state='inactive'; start(){this.state='recording';w.__recorderStarts++} stop(){this.state='inactive';this.onstop?.()}};
 const click=w.HTMLInputElement.prototype.click;
 w.HTMLInputElement.prototype.click=function(){if(this.type==='file'){w.__pickerClicks++;w.__lastPicker=this;}return click.call(this)};
}
async function premiumFlow() {
 const code=await bundle(ENTRY,stub('premium-api.js',PREM_API));
 const {w,errors}=run(code,entryShim),d=w.document;
 const q=id=>d.querySelector(`[data-testid="${id}"]`);
 const setVal=(el,v)=>{ const proto=el.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:el.tagName==='SELECT'?w.HTMLSelectElement.prototype:w.HTMLInputElement.prototype;
   Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new w.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true})); };
 await waitFor(()=>q('plan-eat')?.textContent.includes('666'),'loaded today');
 ck('home starts with all secondary sections collapsed', ['home-plan-details','home-log-details','home-insight-details'].every(id=>q(id)?.dataset.open==='0')&&!q('ai-orb'));
 ck('weight is visible inside the daily summary without opening a section',q('hero-weight').closest('[data-testid="daily-essentials"]')&&q('hero-weight').textContent.includes('82.4'));
 q('hero-weight').click();await tick(160);
 ck('summary weight opens the existing weight sheet',!!q('weight-input'));
 setVal(q('weight-input'),'81.8');await tick(70);
 ck('editing summary weight updates the original log and visible value',w.__logStore.getState().log.weight==='81.8'&&q('hero-weight').textContent.includes('81.8'));
 setVal(q('weight-input'),'');await tick(50);
 ck('missing weight has a direct Add weight action',q('hero-weight').textContent.includes('Add weight'));
 setVal(q('weight-input'),'82.4');w.__click('Done');await tick(400);
 q('home-plan-details').querySelector('button').click();await tick(60);
 ck('plan tools retain micronutrients and meal ideas without duplicate weight',!q('home-plan-details').querySelector('[data-testid="hero-weight"]')&&!!q('chip-nutrition')&&!!q('chip-mealidea'));
 q('home-log-details').querySelector('button').click();q('home-insight-details').querySelector('button').click();await tick(100);
 ck('entries, notes and coach messages remain available on demand',!!q('logged-section')&&!!d.querySelector('#section-notes')&&!!q('coach-note'));
 q('home-log-details').querySelector('button').click();q('home-insight-details').querySelector('button').click();await tick(50);
 ck('existing log values load into the redesigned home', /666/.test(q('plan-eat').textContent) && /1,800/.test(q('plan-eat').textContent) && /1.50/.test(q('chip-water').textContent));
 await waitFor(()=>q('plan-move')?.textContent.includes('Push'),'program loaded');
 ck('daily overview retains workout, sleep, checklist and full plan', /Push/.test(q('plan-move').textContent)&&/7h 45m/.test(q('chip-sleep').textContent)&&/3 of 5/.test(q('plan-recover').textContent)&&d.body.textContent.includes('View your complete plan'), [q('plan-move').textContent,q('chip-sleep').textContent,q('plan-recover').textContent]);
 ck('three member navigation destinations', d.querySelectorAll('.member-nav-links button').length===3);
 ck('AI workspace is closed on initial load', !q('composer')&&!q('ai-thread'));
 q('theme-toggle').click();await tick(30);
 ck('dark theme updates document and persists', d.documentElement.dataset.theme==='dark'&&JSON.parse(w.localStorage.getItem('fitlife-settings-v2')).state.theme==='dark');
 q('theme-toggle').click();await tick(30);
 ck('light theme switches back',d.documentElement.dataset.theme==='light');
 q('chip-water').click(); await tick(150);q('water-add-500').click();await tick(50);
 ck('existing manual water sheet writes to the same log',w.__logStore.getState().log.water===2000);
 w.__click('Done');await tick(400);
 q('plan-recover').click();await tick(180);q('chip-b12').click();await tick(50);
 ck('supplement checklist is preserved',w.__logStore.getState().log.supplements.b12===true);
 w.__click('Done');await tick(400);
 q('ai-type').click();
 ck('Type focuses the text box in the original tap',d.activeElement===q('composer-input'));
 const requestsBeforeSuggestion=w.__posts.length;
 q('ai-suggestions').querySelector('button').click();await tick(40);
 ck('an example fills an editable draft without logging sample data',q('composer-input').value.length>0&&w.__posts.length===requestsBeforeSuggestion&&d.activeElement===q('composer-input'));
 q('composer-clear')?.click();await tick(40);
 d.querySelector('[aria-label="Close AI assistant"]').click();await tick(50);
 q('ai-speak').focus();q('ai-speak').click();
 ck('Speak requests the microphone in the original tap',w.__micRequests===1&&!!q('composer'));
 await tick(80);
 ck('Speak begins one recording without a second tap',w.__recorderStarts===1&&d.body.textContent.includes('Listening…'));
 w.__aiChat.getState().openChat('voice');await tick(50);
 ck('repeated Speak does not stop or duplicate recording',w.__micRequests===1&&w.__recorderStarts===1&&d.body.textContent.includes('Listening…'));
 d.querySelector('[aria-label="Close AI assistant"]').click();await tick(50);
 ck('closing the assistant releases the microphone',w.__stoppedTracks===1);
 ck('closing AI restores focus to the launcher',d.activeElement===q('ai-speak'));
 w.__denyMic=true;q('ai-speak').click();await tick(80);
 ck('denied microphone shows recovery and leaves typing usable',d.body.textContent.includes('Microphone blocked')&&!q('composer-input').disabled);
 d.querySelector('[aria-label="Close AI assistant"]').click();await tick(50);
 w.__denyMic=false;w.__deferMic=true;q('ai-speak').click();await tick(30);
 const starts=w.__recorderStarts;d.querySelector('[aria-label="Close AI assistant"]').click();await tick(30);
 w.__grantMic();await tick(50);
 ck('late permission grant cannot record after closing AI',w.__recorderStarts===starts&&w.__stoppedTracks===2&&!q('composer'));
 w.__deferMic=false;
 q('ai-snap').click();
 ck('Snap requests rear camera capture in the original tap',w.__pickerClicks===1&&w.__lastPicker===q('ai-camera-input')&&w.__lastPicker.getAttribute('capture')==='environment'&&!!q('composer')&&q('ai-snap').textContent==='Snap');
 await tick(80);
 ck('an empty voice take does not clutter the next photo session',!d.body.textContent.includes('Heard this — check and send'));
 ck('photo launch opens the AI dialog without another choose-photo screen',!!d.querySelector('.member-assistant-overlay[role=dialog]')&&d.body.style.overflow==='hidden'&&!d.body.textContent.includes('Choose meal photo'));
 d.querySelector('[aria-label="More attachments"]').click();await tick(30);
 d.querySelector('[aria-label="Choose photo from gallery"]').click();
 ck('gallery remains a separate picker without a camera capture hint',w.__lastPicker===q('ai-gallery-input')&&!w.__lastPicker.hasAttribute('capture'));
 const gallery=q('ai-gallery-input');
 Object.defineProperty(gallery,'files',{value:[],configurable:true});gallery.dispatchEvent(new w.Event('change',{bubbles:true}));await tick(30);
 ck('cancelling a photo picker never calls AI',!w.__posts.some(p=>p.url==='/ai-chat/photo'));
 d.querySelector('[aria-label="Open camera"]').click();
 ck('camera button inside AI uses the same rear camera input',w.__lastPicker===q('ai-camera-input')&&w.__lastPicker.getAttribute('capture')==='environment');
 const upload=q('ai-camera-input');
 Object.defineProperty(upload,'files',{value:[new w.File(['meal'],'meal.jpg',{type:'image/jpeg'})], configurable:true});
 upload.dispatchEvent(new w.Event('change',{bubbles:true}));
 await waitFor(()=>q('ai-food-review'),'photo analysis');
 ck('photo automatically invokes the real API boundary',w.__posts.some(p=>p.url==='/ai-chat/photo'&&p.body.image==='QUJD'));
 ck('estimated food appears without manual entry',q('ai-food-review').textContent.includes('Oats')&&q('ai-food-review').textContent.includes('374 kcal'));
 ck('a photo preview alone never writes food',w.__logStore.getState().log.food.length===3);
 const grams=d.querySelector('[aria-label="Oats grams"]');setVal(grams,'125.5');await tick(70);
 ck('decimal quantities recalculate immediately',/469 kcal/.test(q('ai-food-review').textContent));
 setVal(grams,'');await tick(50);
 ck('empty quantity blocks saving and explains why',[...d.querySelectorAll('button')].find(b=>/Save 1 item/.test(b.textContent))?.disabled&&/Enter a quantity/.test(q('ai-food-review').textContent));
 setVal(grams,'150');setVal(d.querySelector('[aria-label="Oats meal"]'),'Lunch');await tick(50);
 q('chat-edit-macros').click();await tick(200);
 setVal(q('macro-in-protein'),'24');setVal(q('macro-in-carbs'),'55');setVal(q('macro-in-fat'),'8');await tick(50);
 q('macro-remember').click();q('macro-save').click();await tick(400);
 ck('member macro edits replace AI values and recalculate portion',/582 kcal/.test(q('ai-food-review').textContent)&&/P 36/.test(q('ai-food-review').textContent));
 let save=[...d.querySelectorAll('button')].find(b=>/Save 1 item/.test(b.textContent));save.click();save.click();
 await waitFor(()=>d.querySelector('[data-testid="ai-card-daily-status"]')?.textContent.trim()==='Daily log: Saved','confirmed daily save receipt');
 const saved=w.__logStore.getState().log.food;
 ck('double tap saves exactly one food entry',saved.length===4);
 ck('saved food contains edited grams, meal and member label',saved[3].grams===150&&saved[3].meal==='Lunch'&&saved[3].per_100g.protein===24&&saved[3].label===true);
 ck('save posts full log through existing endpoint',w.__posts.some(p=>p.url==='/logs/'+w.__todayStr&&p.body.food_items?.some(f=>f.name==='Oats')));
 const input=q('composer-input'); setVal(input,'water 500 ml, weight 82, B12 and felt energetic');await tick(40);
 input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await waitFor(()=>d.body.textContent.includes('Save 4 items'),'text parse');
 w.__failSave=true;w.__click('Save 4 items');await waitFor(()=>q('ai-card-retry'),'failed save');
 ck('failed save is visible instead of claiming success',/Save failed/.test([...d.querySelectorAll('[data-testid="ai-card-daily-status"]')].at(-1)?.textContent || ''));
 const water=w.__logStore.getState().log.water;
 w.__failSave=false;q('ai-card-retry').click();await tick(250);
 ck('retry persists without applying water or notes twice',w.__logStore.getState().log.water===water&&w.__logStore.getState().log.notes==='Felt energetic today.'&&!q('ai-card-retry')&&[...d.querySelectorAll('[data-testid="ai-card-daily-status"]')].at(-1)?.textContent.trim()==='Daily log: Saved');
 d.querySelector('[aria-label="Close AI assistant"]').click();await tick(80);
 ck('closing AI restores the home',!q('composer'));
 if(q('milestone')){
   ck('a pending milestone retains modal scroll isolation',d.body.style.overflow==='hidden');
   q('milestone').querySelector('button').click();await tick(80);
 }
 ck('dismissing the final dialog restores body scrolling',d.body.style.overflow==='');
 w.__aiChat.getState().openChat();await tick(160);
 ck('reopening keeps the conversation',!!q('ai-food-review'));
 w.__aiChat.setState({dayKey:'2000-01-01'});w.__aiChat.getState().ensureFreshDay(w.__todayStr);await tick(100);
 ck('a day change clears stale reviews while preserving the requested workspace',w.__aiChat.getState().composerOpen&&w.__aiChat.getState().messages.length===0);
 // Selected-day persistence: regressions that would make members lose trust.
 d.querySelector('[aria-label="Close AI assistant"]').click();await tick(40);
 d.querySelector('[aria-label="Previous day"]').click();await tick(180);
 const pastDate=w.__logStore.getState().date;
 q('hero-weight').click();await tick(160);setVal(q('weight-input'),'82.6');await tick(70);
 w.__click('Done');await tick(1800);
 ck('past-day edits autosave to that date',w.__posts.some(p=>p.url==='/logs/'+pastDate&&p.body.weight_kg===82.6)&&!w.__logStore.getState().dirty);
 q('hero-weight').click();await tick(160);setVal(q('weight-input'),'82.5');await tick(60);w.__click('Done');await tick(60);
 w.__failSave=true;d.querySelector('[aria-label="Previous day"]').click();await tick(160);
 ck('a failed save blocks changing date and preserves the edit',w.__logStore.getState().date===pastDate&&w.__logStore.getState().dirty&&w.__logStore.getState().log.weight==='82.5');
 ck('failed autosave never displays a success message',!!d.querySelector('[role="alert"]')&&!d.body.textContent.includes('auto-saved ✓'));
 w.__failSave=false;w.__click('Try saving again');await tick(180);
 ck('manual retry saves the same entry without changing its date',!w.__logStore.getState().dirty&&w.__logStore.getState().date===pastDate);
 d.querySelector('[aria-label="Previous day"]').click();await tick(160);
 ck('weight comparison requests the day before the selected entry',w.__calls.some(p=>p==='/logs/'+new Date(new Date(w.__logStore.getState().date+'T12:00:00Z').getTime()-86400000).toISOString().slice(0,10)));
 w.__logStore.setState({protocol:null,log:{...w.__logStore.getState().log,food:[],weight:'',water:0,sleep:{}}});await tick(80);
 ck('empty day offers clear logging actions without a made-up calorie target',q('plan-eat').textContent.includes('kcal logged')&&!q('plan-eat').textContent.includes('1,800')&&q('hero-weight').textContent.includes('Add weight'));
 ck('no uncaught render errors',errors.length===0,errors);
 w.__testRoot.unmount();w.close();return code;
}
async function navigationFlow() {
 const entry=ENTRY.replace("import {MemoryRouter} from 'react-router-dom';", "import {BrowserRouter,Routes,Route} from 'react-router-dom'; import MemberMore from './pages/MemberMore';")
  .replace('<MemoryRouter><Today/></MemoryRouter>', '<BrowserRouter><Routes><Route path="/" element={<Today/>}/><Route path="/more" element={<MemberMore/>}/></Routes></BrowserRouter>');
 const {w,errors}=run(await bundle(entry,stub('premium-navigation-api.js',PREM_API)),w=>w.history.replaceState({},'', '/more'));
 const d=w.document,q=id=>d.querySelector(`[data-testid="${id}"]`);
 const link=label=>[...d.querySelectorAll('a')].find(el=>el.textContent.includes(label));
 await waitFor(()=>link('Food & saved meals'),'More directory');
 ck('More retains all eleven feature destinations',d.querySelectorAll('.member-more-link').length===11&&link('Profile & health')?.getAttribute('href')==='/profile'&&link('Preferences')?.getAttribute('href')==='/settings');
 link('Food & saved meals').click();await waitFor(()=>q('plan-eat')&&d.querySelector('[role="dialog"]'),'food deep link');
 ck('More opens the existing food sheet directly',d.querySelector('[role="dialog"]').textContent.includes('Add food item'));
 w.__click('Done');await tick(300);w.__click('More');await waitFor(()=>link('Coach & check-ins'),'return to More');
 link('Coach & check-ins').click();await waitFor(()=>q('home-insight-details')?.dataset.open==='1','coach disclosure');
 ck('More opens coach tools while keeping other sections collapsed',q('home-plan-details').dataset.open==='0'&&q('home-log-details').dataset.open==='0'&&!!q('ai-read'));
 w.__click('More');await waitFor(()=>link('Your daily entries'),'return to More');
 link('Your daily entries').click();await waitFor(()=>q('home-log-details')?.dataset.open==='1','entries disclosure');
 ck('More opens the daily entries and correction tools',!!q('logged-section')&&q('home-insight-details').dataset.open==='0');
 ck('navigation has no uncaught exceptions',errors.length===0,errors);w.__testRoot.unmount();w.close();
}
async function premiumVisual(code) {
 const puppeteer=(await import('puppeteer-core')).default,chromium=(await import('@sparticuz/chromium')).default;
 const css = readBuiltCss(path.join(ROOT, 'client', 'dist'));
 const shell='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div></body></html>';
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(shell)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({executablePath:await browserExecutable(chromium),args:[...chromium.args,'--no-sandbox','--disable-dev-shm-usage'],headless:true});
 const out=process.env.UI_SHOTS||path.join(ROOT,'design-previews');fs.mkdirSync(out,{recursive:true});
 try {for(const width of (process.env.UI_WIDTHS ? process.env.UI_WIDTHS.split(',').map(Number) : [320,390,1280])) {for(const theme of ['light','dark']) {
  const page=await browser.newPage();await page.setViewport({width,height:width>600?960:900,deviceScaleFactor:1.5});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // A sheet exists in the DOM before its entrance spring is on screen. The
  // locator waits for a visible, stable box and scrolls it into view, then
  // performs a real pointer click; it does not invoke the React handler.
  const clickStable=async selector=>{
    try {await page.locator(selector).setTimeout(8000).click();}
    catch(error){
      console.error('Interaction bounds',await page.evaluate(selector=>{
        const el=document.querySelector(selector),rect=el?.getBoundingClientRect();
        const panel=el?.closest('[role="dialog"]');
        return{selector,viewport:{width:innerWidth,height:innerHeight},rect:rect?.toJSON(),
          panel:panel?.getBoundingClientRect().toJSON(),transform:panel&&getComputedStyle(panel).transform,
          topElement:rect&&document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.outerHTML.slice(0,300)};
      },selector));
      await page.screenshot({path:path.join(out,`interaction-failure-${theme}-${width}.png`),fullPage:false});
      throw error;
    }
  };
  await page.goto('http://127.0.0.1:'+server.address().port);await page.addScriptTag({content:code});
  await page.waitForFunction(()=>document.querySelector('[data-testid="plan-eat"]')?.textContent.includes('666'));
  await page.evaluate(t=>window.__settings.getState().setTheme(t),theme);
  await new Promise(r=>setTimeout(r,400));
  const measure=()=>page.evaluate(()=>({vw:innerWidth,sw:document.documentElement.scrollWidth,bg:getComputedStyle(document.querySelector('.member-home')).backgroundColor}));
  let m=await measure();ck(`home ${theme} ${width}px has no horizontal overflow`,m.sw<=m.vw+1,m);
  ck(`weight ${theme} ${width}px is visible in the summary`,await page.$eval('[data-testid="hero-weight"]',el=>el.getBoundingClientRect().height>=44&&!!el.closest('[data-testid="daily-essentials"]')));
  ck(`theme ${theme} paints the expected background`,m.bg===(theme==='light'?'rgb(248, 249, 246)':'rgb(20, 24, 23)'),m);
  if(width===390||width===1280) {
    if(width===390) {
      await page.setViewport({width,height:844,deviceScaleFactor:2});
      await page.screenshot({path:path.join(out,`home-${theme}-${width}-viewport.png`),fullPage:false});
    }
    const fullHeight=await page.evaluate(()=>document.documentElement.scrollHeight);
    await page.setViewport({width,height:fullHeight,deviceScaleFactor:1.5});await new Promise(r=>setTimeout(r,150));
    await page.screenshot({path:path.join(out,`home-${theme}-${width}.png`),fullPage:true});
    await page.setViewport({width,height:width>600?960:900,deviceScaleFactor:1.5});
  }
  await page.click('[data-testid="ai-type"]');
  ck(`Type ${theme} ${width}px focuses immediately`,await page.evaluate(()=>document.activeElement===document.querySelector('[data-testid="composer-input"]')));
  await page.click('[aria-label="Close AI assistant"]');await page.waitForSelector('.member-assistant-overlay',{hidden:true});
  const [chooser]=await Promise.all([page.waitForFileChooser(),page.click('[data-testid="ai-snap"]')]);
  ck(`Snap ${theme} ${width}px opens capture input with rear camera hint`,!!chooser&&await page.$eval('[data-testid="ai-camera-input"]',el=>el.getAttribute('capture')==='environment'));await chooser.cancel();
  await page.click('[aria-label="More attachments"]');
  const [galleryChooser]=await Promise.all([page.waitForFileChooser(),page.click('[aria-label="Choose photo from gallery"]')]);
  ck(`Gallery ${theme} ${width}px remains independently available`,!!galleryChooser&&await page.$eval('[data-testid="ai-gallery-input"]',el=>!el.hasAttribute('capture')));await galleryChooser.cancel();
  await page.waitForSelector('.member-assistant-overlay');
  await page.evaluate(()=>{
    const foods=[{name:'Oats',grams:150,meal:'Breakfast',qty_text:'1 bowl · estimated',per_100g:{calories:374,protein:13.2,total_carbs:60,fat:7.8},macros:{cal:561,pro:19.8,carb:90,fat:11.7},on:true}];
    window.__aiChat.setState({messages:[{role:'ai',text:'I found oats in your meal. Review the portion and nutrition below.',parsed:{foods,activities:[],acv:[],supplements:[],workouts:[],corrections:[]}}]});
  });await page.waitForSelector('[data-testid="ai-food-review"]');
  await new Promise(r=>setTimeout(r,400));
  await page.evaluate(()=>{ const el=document.querySelector('.member-assistant-scroll');el.scrollTo({top:el.scrollHeight,behavior:'instant'}); });
  m=await measure();ck(`AI food review ${theme} ${width}px has no overflow`,m.sw<=m.vw+1,m);
  if(width===390)await page.screenshot({path:path.join(out,`ai-review-${theme}.png`),fullPage:false});
  await page.click('[data-testid="chat-edit-macros"]');await page.waitForSelector('[data-testid="macro-editor"]');
  m=await measure();ck(`macro sheet ${theme} ${width}px has no overflow`,m.sw<=m.vw+1,m);
  if(width===320) {
    await page.evaluate(()=>{document.documentElement.style.fontSize='20px'});
    m=await measure();ck(`enlarged-text AI ${theme} 320px has no horizontal overflow`,m.sw<=m.vw+1,m);
  }
  await clickStable('[data-testid="macro-cancel"]');
  await page.waitForSelector('[data-testid="macro-editor"]',{hidden:true});
  await clickStable('[data-testid="ai-card-save"]');
  await page.waitForFunction(()=>document.querySelector('[data-testid="ai-card-daily-status"]')?.textContent.trim()==='Daily log: Saved');
  m=await measure();ck(`save receipt ${theme} ${width}px has no horizontal overflow`,m.sw<=m.vw+1,m);
  ck(`receipt actions ${theme} ${width}px retain 44px touch height`,await page.evaluate(()=>['ai-card-edit','ai-card-undo'].every(id=>document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().height>=44)));
  if(width===390)await page.screenshot({path:path.join(out,`ai-receipt-${theme}.png`),fullPage:false});
  ck(`browser renders ${theme} ${width}px without exceptions`,errors.length===0,errors);await page.close();
 }}} finally {await browser.close();await new Promise(r=>server.close(r));}
}
export async function assertPremiumFlow() {
 const before=fail; const code=await premiumFlow(); await navigationFlow(); if(fail>before)throw new Error('Premium flow assertions failed');return code;
}
export async function assertPremiumVisual() {
 const code=await bundle(ENTRY,stub('premium-visual-api.js',PREM_API)); const before=fail;
 await premiumVisual(code);if(fail>before)throw new Error('Premium visual assertions failed');
}
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
 try {const code=await premiumFlow();await navigationFlow();if(process.env.UI_BROWSER!=='0')await premiumVisual(code);
 console.log(`\nPremium UI: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
 } catch(e){console.error(e);process.exit(1)}
}
