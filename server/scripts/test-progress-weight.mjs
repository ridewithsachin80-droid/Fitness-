/** Mount the real Progress page with synthetic read-only API responses.
 * Empty recent days (including an undone weight) must not hide prior weigh-ins.
 * This checks displayed calculations and range behavior, not chart geometry. */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-progress-weight-'));
let pass = 0, fail = 0;
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ': ' + String(detail)}`);
  ok ? pass++ : fail++;
};
async function until(fn, label) {
  for (let i = 0; i < 120; i++) { if (fn()) return; await tick(); }
  throw new Error('Timed out: ' + label);
}
const apiFile = path.join(TMP, 'api.js');
fs.writeFileSync(apiFile, `import {istDaysAgo} from '${path.join(ROOT, 'client/src/constants.js')}';
const call=async(method,url)=>{
  window.calls.push({method,url});
  if(method!=='get')throw new Error('Progress must not write member data');
  if(url.startsWith('/logs/range/'))return{data:window.rows.map(row=>({
    log_date:istDaysAgo(row.days),weight_kg:row.weight,compliance_pct:80,
    food_items:[],activities:{},acv:{},supplements:{},sleep:{}}))};
  if(url==='/members/me')return{data:{start_weight:'85',target_weight:'65',height_cm:'172',labs:[]}};
  if(url==='/members/me/weekly-report')return{data:{latest:null,history:[]}};
  return{data:[]};
};
export default Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,url=>call(method,url)]));`);

async function bundle() {
  return (await build({
    stdin: { resolveDir: path.join(ROOT, 'client/src'), loader: 'jsx', contents: `
      import {createRoot} from 'react-dom/client';
      import {MemoryRouter} from 'react-router-dom';
      import Progress from './pages/Progress';
      import {useAuthStore} from './store/authStore';
      useAuthStore.setState({user:{id:214,name:'Progress fixture',role:'patient'},isRestoring:false});
      window.root=createRoot(document.getElementById('root'));
      window.root.render(<MemoryRouter><Progress/></MemoryRouter>);
    ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true}' },
    plugins: [{ name: 'isolated-progress-api', setup(b) {
      b.onResolve({ filter: /(?:^|\/)client$/ }, args => /api\/client$/.test(args.path)
        || args.importer.includes(`${path.sep}api${path.sep}`) ? { path: apiFile } : null);
    } }], logLevel: 'silent',
  })).outputFiles[0].text;
}

async function mount(code, rows) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://fitlife-progress-weight.invalid/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, errors = [];
  w.rows = rows; w.calls = [];
  w.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.scrollTo = () => {};
  w.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  w.addEventListener('error', event => errors.push(event.message));
  w.eval(code);
  const q = id => w.document.querySelector(`[data-testid="${id}"]`);
  await until(() => q('progress-hero'), 'Progress hero');
  return { w, errors, q, hero: () => q('progress-hero').textContent,
    number: () => q('progress-hero').querySelector('.tabular-nums')?.textContent,
    async range(value) {
      [...w.document.querySelectorAll('[role="tab"]')].find(el => el.textContent === value + 'd').click();
      await until(() => w.document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === value + 'd', 'range change');
    },
    close() { w.root.unmount(); w.close(); },
  };
}
async function section(code, name, rows, run) {
  console.log('\n' + name);
  let A;
  try {
    A = await mount(code, rows); await run(A);
    check(name + ': no uncaught render errors or member writes', !A.errors.length && A.w.calls.every(call => call.method === 'get'), A.errors);
  } catch (error) { check(name + ' completes', false, error.stack); }
  finally { A?.close(); }
}

try {
  const code = await bundle();
  await section(code, 'Today cleared after Undo', [
    { days: 0, weight: null }, { days: 3, weight: 77 }, { days: 1, weight: '75.0' },
  ], async A => {
    check('a newer empty daily log keeps the latest numeric-string weigh-in', A.number() === '75' && !A.hero().includes('No weight logged yet'), A.hero());
    check('journey uses that weigh-in: 50% and 10kg lost', /50% there/.test(A.q('journey').textContent) && /10 kg lost/.test(A.q('journey').textContent), A.q('journey').textContent);
    check('BMI still uses the latest weigh-in', /25\.4BMI/.test(A.w.document.body.textContent), A.w.document.body.textContent.slice(0, 500));
    check('the populated trend agrees with the latest hero and 30-day change', /↓ 2 kg/.test(A.hero()) && !/weigh-in|Log your weight/.test(A.q('weight-chart').textContent));
  });

  for (const weight of [0, '0', '', 'unknown', '75kg', 'Infinity', -1, true, {}]) {
    await section(code, 'Invalid recent weight ' + JSON.stringify(weight), [
      { days: 2, weight: '75' }, { days: 0, weight },
    ], async A => {
      check('invalid recent value cannot replace older 75kg', A.number() === '75' && A.hero().includes('latest weigh-in'), A.hero());
      check('invalid value is excluded from chart points too', A.q('weight-chart').textContent.includes('One more weigh-in'), A.q('weight-chart').textContent);
    });
  }

  await section(code, 'No valid weigh-ins', [
    { days: 0, weight: null }, { days: 1, weight: '' }, { days: 2, weight: 0 },
    { days: 3, weight: '0' }, { days: 4, weight: 'unknown' }, { days: 5, weight: 'Infinity' },
  ], async A => {
    check('all-missing/invalid history keeps the honest empty hero', A.number() === '—' && A.hero().includes('No weight logged yet'), A.hero());
    check('all-invalid history renders the empty trend and no journey percentage', A.q('weight-chart').textContent.includes('Log your weight on two days') && !A.q('journey').textContent.includes('% there'));
    check('no numeric NaN or Infinity leaks into the progress display', !/NaN|Infinity/.test(A.q('progress-hero').textContent + A.q('journey').textContent));
  });

  await section(code, 'Existing chronological and window behavior', [
    { days: 1, weight: '75.5' }, { days: 60, weight: '80.0' },
    { days: 0, weight: null }, { days: 20, weight: '78.0' },
  ], async A => {
    check('unsorted numeric DB strings resolve by date, not response order', A.number() === '75.5' && /↓ 2\.5 kg/.test(A.hero()), A.hero());
    await A.range('7');
    check('7-day single point keeps the global latest weight without a delta', A.number() === '75.5' && A.hero().includes('latest weigh-in') && !/↓|↑/.test(A.hero()), A.hero());
    await A.range('90');
    check('90-day delta expands while the latest weigh-in stays unchanged', A.number() === '75.5' && /↓ 4\.5 kg/.test(A.hero()) && /over 90 days/.test(A.hero()), A.hero());
  });

  await section(code, 'Latest weigh-in outside selected window', [
    { days: 45, weight: '75.0' }, { days: 60, weight: '78.0' }, { days: 0, weight: null },
  ], async A => {
    check('30-day empty window does not erase a known weight in the fetched history', A.number() === '75' && A.hero().includes('latest weigh-in') && A.q('weight-chart').textContent.includes('last 30 days'));
    await A.range('90');
    check('widening to90 exposes the historical delta without changing the hero', A.number() === '75' && /↓ 3 kg/.test(A.hero()), A.hero());
  });
} catch (error) { check('Progress regression setup completes', false, error.stack); }
finally { fs.rmSync(TMP, { recursive: true, force: true }); }
console.log(`\ntest-progress-weight: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
