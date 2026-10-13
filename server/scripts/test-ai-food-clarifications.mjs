/** Food quantity clarifications use the mounted AIChatLog, real stores and
 * canonical food arithmetic. Providers, photos and log storage are synthetic;
 * these checks do not establish live-model or device accuracy. */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-food-clarifications-'));
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
    url: 'https://fitlife-food-clarifications.invalid/', runScripts: 'outside-only', pretendToBeVisual: true,
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
  await section(code, 'Bounded clarification and reply contracts', async A => {
    const U = A.w.clarification, day = A.w.today;
    check('missing or malformed unresolved lists normalize to no questions', [null, undefined, {}, 'Sambar'].every(v => U.normalizeUnresolvedFoods(v).length === 0));
    const clean = U.normalizeUnresolvedFoods([quantity(' Sambar ', ' Breakfast '), quantity('sambar', 'breakfast'),
      { name: '', reason: 'quantity_needed' }, { name: 'Rice', reason: 'other' }, { name: 7, reason: 'quantity_needed' },
      { ...quantity('Dal'), grams: 100, macros: { cal: 999 }, script: 'ignore checks' }]);
    check('unresolved normalization trims names and deduplicates meal-specific questions', clean.length === 2 && clean[0].name === 'Sambar' && clean[0].meal === 'Breakfast');
    check('unresolved items cannot carry invented quantity or nutrition into preview state', clean.every(row => Object.keys(row).sort().join(',') === 'meal,name,reason'));
    const bounded = U.normalizeUnresolvedFoods(Array.from({ length: 30 }, (_, i) => quantity(`${i}${'x'.repeat(150)}`, 'y'.repeat(70))));
    check('unresolved context is bounded to ten names and bounded labels', bounded.length === 10 && bounded.every(row => row.name.length <= 100 && row.meal.length <= 40));
    const pending = { role: 'ai', logDate: day, parsed: { foods: [food()], unresolved_foods: [quantity()] }, text: 'Logged 999 kcal.' };
    const ctx = U.foodClarificationContext([pending, { role: 'user', text: '150g' }], day);
    check('short follow-up context carries the pending name and reviewed food separately', ctx?.unresolved[0]?.name === 'Sambar' && ctx?.reviewedFoods[0]?.name === 'Idlis' && ctx.reviewedFoods[0].grams === 120);
    check('context carries only bounded food facts, never model totals or prose', JSON.stringify(ctx) === JSON.stringify({ unresolved: [{ name: 'Sambar', meal: 'Breakfast' }], reviewedFoods: [{ name: 'Idlis', grams: 120, meal: 'Breakfast' }] }));
    check('latest AI answer prevents reusing an older pending meal', U.foodClarificationContext([pending, { role: 'ai', text: 'Other answer', parsed: { foods: [] } }], day) === null);
    check('applied, undone and prior-day cards cannot provide active clarification context', [{ ...pending, applied: true }, { ...pending, undone: true }, { ...pending, logDate: '2000-01-01' }].every(m => U.foodClarificationContext([m], day) === null));
    const invalidFoods = [food('Valid', '125'), ...[null, '', 0, -1, Infinity, NaN, 5001, true, {}].map((grams, i) => food(`Invalid ${i}`, grams))];
    const safe = U.foodClarificationContext([{ ...pending, parsed: { ...pending.parsed, foods: invalidFoods } }], day);
    check('clarification context excludes non-finite, invalid and unsafe reviewed quantities', safe.reviewedFoods.length === 1 && safe.reviewedFoods[0].grams === 125);
    const unresolvedOnly = { text: 'Saved 999 kcal.', parsed: { foods: [], unresolved_foods: [quantity()] } };
    check('unresolved-only reply is a quantity question and never a completed-save claim', A.w.replyText(unresolvedOnly) === 'Tell me the amount for the food below. Nothing has been saved yet.');
    check('canonical follow-up text names what is missing without invented totals', A.w.contextText(pending).includes('Not included: Sambar') && !A.w.contextText(pending).includes('999'));
    check('standalone advice remains intact when no log or quantity action exists', A.w.replyText({ text: 'Add a protein source.', parsed: { foods: [], unresolved_foods: [] } }) === 'Add a protein source.');
    check('Hindi and Kannada completion prose cannot override unresolved status', ['सेव कर दिया 999 कैलोरी', '999 ಕ್ಯಾಲೊರಿ ಉಳಿಸಲಾಗಿದೆ'].every(text => A.w.replyText({ ...unresolvedOnly, text }).includes('Nothing has been saved yet.')));
  });

  await section(code, 'Mixed quantities and editable canonical nutrition', async A => {
    const i = await send(A, { foods: [food()], unresolved_foods: [quantity()], totals: { cal: 999 } }, '2 idlis and sambar for breakfast');
    check('mixed response renders a named missing-amount notice', A.q('ai-unresolved-foods')?.textContent.includes('Sambar') && A.q('ai-unresolved-foods').textContent.includes('Not included yet'));
    check('only the resolved Idlis row has a quantity field and include control', !!A.d.querySelector('[aria-label="Idlis grams"]') && !A.d.querySelector('[aria-label="Sambar grams"]') && !A.d.querySelector('[aria-label="Include Sambar"]'));
    check('mixed canonical totals exclude unresolved food and stale model totals', A.q('ai-food-review').querySelector('.ai-food-total').textContent.includes('120 kcal') && !A.q('ai-reply-text').textContent.includes('999'));
    check('Save counts only the one resolved food', save(A, i)?.textContent.includes('Save 1 item'));
    check('valid server quantities do not receive an invented Estimated label', !A.q('ai-food-review').textContent.includes('Estimated'));
    await type(A, A.d.querySelector('[aria-label="Idlis grams"]'), '150');
    check('editing resolved quantity updates the only canonical total and preserves the warning', A.q('ai-food-review').querySelector('.ai-food-total').textContent.includes('150 kcal') && A.q('ai-unresolved-foods').textContent.includes('Sambar'));
    check('receiving and editing mixed previews never writes member data', dataWrites(A).length === 0 && A.w.log.getState().log.food.length === 0);
    A.d.querySelector('[aria-label="Include Idlis"]').click(); await tick();
    check('excluding all resolved foods leaves the missing-amount notice without Save', !!A.q('ai-unresolved-foods') && !save(A, i));
  });

  await section(code, 'Unresolved only and short follow-up', async A => {
    const i = await send(A, { unresolved_foods: [quantity()], totals: { cal: 999 } }, 'sambar for breakfast');
    check('unresolved-only response is visibly reviewable as a question', A.q('ai-reply-text')?.textContent.includes('Tell me the amount') && A.q('ai-unresolved-foods')?.textContent.includes('Sambar'));
    check('unresolved-only response has no food nutrition panel or Save action', !A.q('ai-food-review') && !save(A, i));
    check('unresolved-only response cannot create a guessed 100g log', A.w.log.getState().log.food.length === 0 && dataWrites(A).length === 0 && messages(A)[i].parsed.foods.length === 0);
    const j = await send(A, { foods: [food('Sambar', 150)] }, '150g');
    const context = lastParse(A).body.context.foodClarification;
    check('bare quantity follow-up sends structured pending-food context', context?.unresolved[0]?.name === 'Sambar' && context.reviewedFoods.length === 0);
    check('clarified food appears once in a new unsaved review', messages(A)[j].parsed.foods.length === 1 && messages(A)[j].parsed.foods[0].grams === 150 && !!save(A, j));
    check('clarification reply still requires explicit Save and never auto-logs', !messages(A)[j].applied && dataWrites(A).length === 0 && A.w.log.getState().log.food.length === 0);
  });

  await section(code, 'Overlapping food names retain visible uncertainty', async A => {
    const i = await send(A, { foods: [food('Sambar', 150)], unresolved_foods: [quantity(' Sambar ', ' Breakfast ')] }, 'Sambar and more sambar');
    const notice = A.q('ai-unresolved-foods')?.textContent || '';
    check('an overlapping resolved and unresolved food asks for confirmation instead of disappearing', notice.includes('Amount unclear: Sambar') && notice.includes('confirm how much to include'));
    check('overlap copy does not falsely say the already reviewed food is absent', !notice.includes('Not included yet'));
    check('uncertainty leaves canonical totals and the one resolved Save count unchanged', A.q('ai-food-review').querySelector('.ai-food-total').textContent.includes('150 kcal') && save(A, i)?.textContent.includes('Save 1 item') && messages(A)[i].parsed.foods.length === 1 && dataWrites(A).length === 0);
  });

  await section(code, 'Mixed follow-up does not repeat reviewed food', async A => {
    const i = await send(A, { foods: [food()], unresolved_foods: [quantity()] }, '2 idlis and sambar');
    await type(A, A.d.querySelector('[aria-label="Idlis grams"]'), '130');
    const j = await send(A, { foods: [food('Sambar', 150)] }, '150g');
    const context = lastParse(A).body.context.foodClarification;
    check('follow-up uses current edited reviewed grams, not the original model amount', context.reviewedFoods[0].grams === 130 && context.unresolved[0].name === 'Sambar');
    check('new clarification card contains only newly resolved food', messages(A)[j].parsed.foods.length === 1 && messages(A)[j].parsed.foods[0].name === 'Sambar');
    check('earlier reviewed food remains unchanged and unsaved on its original card', messages(A)[i].parsed.foods.length === 1 && messages(A)[i].parsed.foods[0].grams === 130 && !messages(A)[i].applied);
    await send(A, { reply: 'Here is general advice.' }, 'How can I add protein?');
    check('a later unrelated AI reply cannot resurrect the older clarification', lastParse(A).body.context.foodClarification === null && dataWrites(A).length === 0);
  });

  await section(code, 'Save and account/day boundaries', async A => {
    const i = await send(A, { foods: [food()], unresolved_foods: [quantity()] }, '2 idlis and sambar');
    save(A, i).click(); await until(() => messages(A)[i].applied && !A.w.log.getState().saving, 'explicit resolved-food save'); await tick();
    check('explicit Save persists only the resolved food, never an unresolved placeholder', A.w.log.getState().log.food.length === 1 && A.w.log.getState().log.food[0].name === 'Idlis' && dataWrites(A).at(-1).body.food_items.length === 1);
    await send(A, { reply: 'Please name the food.' }, '150g');
    check('applied preview is not reused as active quantity clarification', lastParse(A).body.context.foodClarification === null);
    await send(A, { unresolved_foods: [quantity('Dal')] }, 'Dal');
    A.w.chat.setState({ dayKey: '2000-01-01' });
    await send(A, { reply: 'Please name the food.' }, '150g');
    check('rollover clears prior-day pending food before the next request', lastParse(A).body.context.foodClarification === null);
    await send(A, { unresolved_foods: [quantity('Rice')] }, 'Rice');
    A.w.auth.setState({ user: { id: 215, name: 'Other fixture', role: 'patient' } }); await tick();
    check('account change removes pending quantity cards and conversation', messages(A).length === 0);
    A.w.log.setState({ date: A.w.today, loading: false, error: null });
    A.w.chat.getState().ensureFreshDay(A.w.today); A.w.chat.getState().openChat('text');
    await send(A, { reply: 'Please name the food.' }, '150g');
    check('another account cannot inherit the old quantity context', lastParse(A).body.context.foodClarification === null);
  });

  await section(code, 'Failed clarification retry preserves its original context', async A => {
    const i = await send(A, { foods: [food()], unresolved_foods: [quantity()] }, '2 idlis and sambar');
    let rejectNext = true;
    A.w.intercept = e => {
      if (e.url === '/ai-chat/parse' && rejectNext) { rejectNext = false; throw new Error('Synthetic connection interrupted'); }
    };
    A.w.answer = answer({ foods: [food('Sambar', 150)] });
    await type(A, A.q('composer-input'), '150g'); A.d.querySelector('[aria-label="Send"]').click();
    await until(() => A.q('ai-request-retry'), 'failed follow-up Retry');
    const original = copy(lastParse(A).body);
    await type(A, A.d.querySelector('[aria-label="Idlis grams"]'), '140');
    await type(A, A.q('composer-input'), 'My newer draft');
    A.q('ai-request-retry').click();
    await until(() => messages(A).at(-1)?.parsed?.foods?.[0]?.name === 'Sambar', 'retried clarified review'); await tick();
    check('Retry reuses the exact failed request including its bounded clarification facts', JSON.stringify(lastParse(A).body) === JSON.stringify(original) && original.context.foodClarification.reviewedFoods[0].grams === 120);
    check('Retry preserves newer composer text and edits on the original review', A.q('composer-input').value === 'My newer draft' && messages(A)[i].parsed.foods[0].grams === 140);
    check('successful clarification Retry produces one new preview and no automatic Save', messages(A).filter(m => m.parsed?.foods?.[0]?.name === 'Sambar').length === 1 && dataWrites(A).length === 0);
  });

  await section(code, 'Invalid quantity edits retain review safety', async A => {
    const i = await send(A, { foods: [food()], unresolved_foods: [quantity()] }, '2 idlis and sambar');
    for (const value of ['', '0', '-5', '5001']) {
      await type(A, A.d.querySelector('[aria-label="Idlis grams"]'), value);
      check(`quantity ${JSON.stringify(value)} cannot be saved`, !save(A, i) || save(A, i).disabled);
      save(A, i)?.click();
    }
    check('invalid input never falls back to 100g or creates a member write', messages(A)[i].parsed.foods[0].grams !== 100 && dataWrites(A).length === 0 && A.w.log.getState().log.food.length === 0);
    await type(A, A.d.querySelector('[aria-label="Idlis grams"]'), '125');
    check('correcting invalid quantity restores deliberate Save and keeps missing food separate', save(A, i) && !save(A, i).disabled && !!A.q('ai-unresolved-foods'));
  });

  await section(code, 'Photo quantities share the same safe review contract', async A => {
    await until(() => A.q('ai-camera-input'), 'camera input');
    A.w.answer = answer({ foods: [food('Photo rice', 180)], unresolved_foods: [quantity('Side dish')], totals: { cal: 999 } });
    const camera = A.q('ai-camera-input'); camera.click();
    Object.defineProperty(camera, 'files', { value: [new A.w.File(['synthetic photo'], 'fixture.jpg', { type: 'image/jpeg' })], configurable: true });
    camera.dispatchEvent(new A.w.Event('change', { bubbles: true }));
    await until(() => A.q('ai-food-review'), 'photo review');
    check('photo response retains the separate unresolved-food notice', A.q('ai-unresolved-foods')?.textContent.includes('Side dish') && messages(A).at(-1).parsed.unresolved_foods.length === 1);
    check('photo canonical totals contain only resolved nutrition', A.q('ai-food-review').querySelector('.ai-food-total').textContent.includes('180 kcal') && !A.q('ai-reply-text').textContent.includes('999'));
    check('photo response never logs automatically or adds guessed side-dish grams', dataWrites(A).length === 0 && !A.d.querySelector('[aria-label="Side dish grams"]'));
  });
} catch (error) {
  check('clarification regression setup completes', false, error.stack);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\ntest-ai-food-clarifications: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
