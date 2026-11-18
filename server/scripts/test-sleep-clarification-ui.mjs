/** Duration-only sleep clarifications use the mounted AIChatLog, real stores and
 * canonical food arithmetic. Providers, photos and log storage are synthetic;
 * these checks do not establish live-model or device accuracy. */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-sleep-clarification-'));
let passed = 0, failed = 0;
const copy = value => JSON.parse(JSON.stringify(value));
const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
function check(name, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail ? ': ' + String(detail).slice(0, 250) : ''}`);
  ok ? passed++ : failed++;
}
async function until(fn, label) {
  for (let i = 0; i < 160; i++) { if (fn()) return; await tick(); }
  throw new Error('Timed out: ' + label);
}
const apiFile = path.join(TMP, 'api.js');
fs.writeFileSync(apiFile, `const call=async(method,url,body,opts)=>window.__api({method,url,body,opts});
export default Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(url,body,opts)=>call(method,url,body,opts)]));`);
async function bundle() {
  return (await build({
    stdin: { resolveDir: path.join(ROOT, 'client/src'), loader: 'jsx', contents: `
      import {createRoot} from 'react-dom/client';
      import AIChatLog from './components/AIChatLog';
      import {useAuthStore} from './store/authStore';
      import {useLogStore} from './store/logStore';
      import {useAIChat} from './store/aiChatStore';
      import {today,emptyLog} from './constants';
      import * as clarification from './utils/unresolvedFoods';
      import {aiReplyText,aiContextText,hasLoggingPreview} from './utils/aiReplyText';
      useAuthStore.setState({user:{id:214,name:'Quantity Fixture',role:'patient'},isRestoring:false});
      useLogStore.setState({date:today(),log:emptyLog(),protocol:{activities:[],acv:[],supplements:[]},loading:false,error:null});
      window.chat=useAIChat;window.log=useLogStore;window.auth=useAuthStore;window.today=today();
      window.clarification=clarification;window.replyText=aiReplyText;window.contextText=aiContextText;window.hasPreview=hasLoggingPreview;
      window.root=createRoot(document.getElementById('root'));window.root.render(<AIChatLog overlay/>);
      useAIChat.getState().ensureFreshDay(today());useAIChat.getState().openChat('text');
    ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true}' },
    plugins: [{ name: 'synthetic-api', setup(b) {
      b.onResolve({ filter: /(?:^|\/)client$/ }, args => /api\/client$/.test(args.path)
        || args.importer.includes(`${path.sep}api${path.sep}`) ? { path: apiFile } : null);
    } }], logLevel: 'silent',
  })).outputFiles[0].text;
}
function mount(code) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://fitlife-sleep-clarification.invalid/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, errors = [];
  w.calls = []; w.saved = {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; w.confirm = () => true;
  w.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  w.Image = class { width = 800; height = 600; set src(value) { w.setTimeout(() => this.onload?.(), 0); } };
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,UEhPVE8=';
  w.__api = async e => {
    w.calls.push({ ...e, body: e.body === undefined ? undefined : copy(e.body) });
    if (w.intercept) { const value = await w.intercept(e); if (value !== undefined) return value; }
    if (e.url === '/ai-chat/parse' || e.url === '/ai-chat/photo') return { data: copy(w.answer) };
    if (/^\/logs\/\d{4}-\d{2}-\d{2}$/.test(e.url)) {
      if (e.method === 'get') return { data: copy(w.saved[e.url] || {}) };
      w.saved[e.url] = { ...copy(e.body), saved_at: new Date().toISOString() };
      return { data: copy(w.saved[e.url]) };
    }
    return { data: e.method === 'get' ? [] : { ok: true } };
  };
  w.addEventListener('error', e => errors.push(e.message)); w.eval(code);
  return { w, d: w.document, errors, q: id => w.document.querySelector(`[data-testid="${id}"]`),
    close() { w.root?.unmount(); w.close(); } };
}
const quantity = (name = 'Sambar', meal = 'Breakfast') => ({ name, meal, reason: 'quantity_needed' });
const food = (name = 'Idlis', grams = 120) => ({ name, grams, meal: 'Breakfast',
  per_100g: { calories: 100, protein: 10, total_carbs: 10, fat: 2 },
  macros: { cal: grams, pro: grams / 10, carb: grams / 10, fat: grams / 50 }, source: 'database' });
const answer = patch => ({ reply: 'Everything logged, 999 kcal.', foods: [], unresolved_foods: [],
  activities: [], acv: [], supplements: [], workouts: [], corrections: [], ...patch });
const messages = A => A.w.chat.getState().messages;
const card = (A, i) => A.d.querySelector(`[data-testid="ai-review-card"][data-review-index="${i}"]`);
const save = (A, i) => card(A, i)?.querySelector('[data-testid="ai-card-save"]');
const lastParse = A => A.w.calls.filter(c => c.url === '/ai-chat/parse').at(-1);
const dataWrites = A => A.w.calls.filter(c => c.method !== 'get' && !['/ai-chat/parse', '/ai-chat/photo'].includes(c.url));
async function type(A, node, value) {
  if (!node) throw new Error('Missing editable field');
  const proto = node.tagName === 'TEXTAREA' ? A.w.HTMLTextAreaElement.prototype : A.w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
  node.dispatchEvent(new A.w.Event('input', { bubbles: true })); await tick();
}
async function send(A, patch, text) {
  await until(() => A.q('composer-input'), 'composer');
  A.w.answer = answer(patch); const previous = messages(A).at(-1);
  await type(A, A.q('composer-input'), text); A.d.querySelector('[aria-label="Send"]').click();
  await until(() => messages(A).at(-1) !== previous && messages(A).at(-1)?.role === 'ai', 'AI reply');
  await tick(); return messages(A).length - 1;
}
async function section(code, name, run) {
  console.log('\n' + name); const A = mount(code);
  try { await run(A); check(name + ' has no uncaught render errors', A.errors.length === 0, A.errors); }
  catch (error) { check(name + ' completes', false, error.stack); }
  finally { A.close(); }
}

try {
  const code = await bundle();
  const issue = { reason: 'times_needed', duration_minutes: 480 };
  await section(code, 'Mixed-entry sleep clarification, explicit save and follow-up', async A => {
    const i = await send(A, { sleep: null, unresolved_sleep: issue, weight_kg: 82.5, water_ml_add: 500 }, 'I drank500mlwater, slept8h and weigh82.5kg');
    const parsed = messages(A)[i].parsed;
    check('actual chat stores the bounded unresolved sleep issue', parsed.unresolved_sleep?.duration_minutes === 480 && parsed.sleep === null && !parsed.sleepOn);
    check('actual mixed review visibly asks bedtime and wake time', /8 h.*go to bed and wake up/.test(card(A, i).querySelector('[data-testid="ai-sleep-clarification"]')?.textContent));
    check('only the two valid entries appear in Save count', /Save 2 items/.test(save(A, i)?.textContent));
    check('mixed preview does not automatically write member data', dataWrites(A).length === 0);
    check('provider claim is not presented as completed sleep logging', !card(A, i).textContent.includes('Everything logged'));
    save(A, i).click();
    await until(() => A.w.calls.some(c => c.method === 'post' && /^\/logs\//.test(c.url)), 'explicit daily save');
    const write = A.w.calls.find(c => c.method === 'post' && /^\/logs\//.test(c.url));
    check('explicit Save persists supported entries', Number(write.body.weight_kg) === 82.5 && write.body.water_ml === 500);
    check('explicit Save does not invent sleep times or persist duration hint', !write.body.sleep?.bedtime && !write.body.sleep?.waketime && !JSON.stringify(write.body).includes('duration_minutes'));
    await until(() => !A.w.chat.getState().messages.some(m => m.saveReceipt?.running), 'save receipt settled');
    const j = await send(A, { sleep: { bedtime: '23:00', waketime: '07:00' }, unresolved_sleep: null }, '11pm to7am');
    check('follow-up request carries the pending sleep question even after other entries saved', lastParse(A).body.context.recent.some(r => /Sleep not included.*bedtime and wake time needed/.test(r.text)));
    check('follow-up clock times create one sleep review without repeating water or weight', /Save 1 item/.test(save(A, j)?.textContent) && messages(A)[j].parsed.sleep?.bedtime === '23:00' && !messages(A)[j].parsed.weightOn && !messages(A)[j].parsed.waterOn);
    check('resolved follow-up has no new sleep clarification notice', !card(A, j).querySelector('[data-testid="ai-sleep-clarification"]'));
  });
  await section(code, 'Duration-only question stays outside Save', async A => {
    const i = await send(A, { sleep: null, unresolved_sleep: issue }, 'slept8h');
    check('duration-only message renders its bedtime/wake question', !!card(A, i).querySelector('[data-testid="ai-sleep-clarification"]'));
    check('duration-only message has no Save button', !save(A, i));
    check('duration-only message cannot claim successful persistence', /Nothing has been saved/.test(card(A, i).querySelector('[data-testid="ai-reply-text"]')?.textContent));
    check('duration-only message writes no member data', dataWrites(A).length === 0);
  });
} catch (error) { check('sleep clarification suite completes', false, error.stack); }
finally { fs.rmSync(TMP, { recursive: true, force: true }); }
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
