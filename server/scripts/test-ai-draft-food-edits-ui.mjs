/** Unsaved draft-food edits use the mounted AIChatLog, real stores and
 * canonical food arithmetic. Providers, photos and log storage are synthetic;
 * these checks do not establish live-model or device accuracy. */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-draft-food-edits-'));
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

      import {aiReplyText,aiContextText,hasLoggingPreview} from './utils/aiReplyText';
      useAuthStore.setState({user:{id:214,name:'Quantity Fixture',role:'patient'},isRestoring:false});
      useLogStore.setState({date:today(),log:emptyLog(),protocol:{activities:[],acv:[],supplements:[]},loading:false,error:null});
      window.chat=useAIChat;window.log=useLogStore;window.auth=useAuthStore;window.today=today();
      window.replyText=aiReplyText;window.contextText=aiContextText;window.hasPreview=hasLoggingPreview;
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
    url: 'https://fitlife-draft-food-edits.invalid/', runScripts: 'outside-only', pretendToBeVisual: true,
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


const foodCards = A => messages(A).filter(m => m.parsed?.foods?.length);
const editButton = (A, name) => A.d.querySelector(`[aria-label="Edit ${name} with AI"]`);
const row = (A, index = 0, foodIndex = 0) => foodCards(A)[index]?.parsed.foods[foodIndex];
const responseFor = (A, patch = {}, index = 0) => {
  const context = lastParse(A).body.context.draftFoods;
  const target = context?.target || context?.foods?.[index];
  if (!target) throw new Error('No bounded draft context');
  return answer({ draft_edit: { status: 'edit', reviewId: target.reviewId, foodId: target.foodId, ...patch } });
};
async function startDelayed(A, text) {
  let resolve; const pending = new Promise(done => { resolve = done; });
  const before = A.w.calls.filter(c => c.url === '/ai-chat/parse').length;
  A.w.intercept = e => e.url === '/ai-chat/parse' ? pending : undefined;
  await type(A, A.q('composer-input'), text); A.d.querySelector('[aria-label="Send"]').click();
  await until(() => A.w.calls.filter(c => c.url === '/ai-chat/parse').length === before + 1, 'deferred parse starts');
  return async result => { A.w.intercept = null; resolve({ data: result }); await tick(100); };
}
async function edit(A, patch, text = 'make it 250 grams') {
  const release = await startDelayed(A, text);
  await release(responseFor(A, patch));
  return lastParse(A).body.context.draftFoods;
}
function unchangedDaily(A) { return A.w.log.getState().log.food.length === 0 && dataWrites(A).length === 0; }

try {
  const code = await bundle();
  await section(code, 'Single unsaved food updates its original review', async A => {
    const i = await send(A, { foods: [food('Rice', 150)] }, 'rice 150 grams');
    const original = messages(A)[i], id = original.draftReviewId, foodId = original.parsed.foods[0].draftFoodId;
    const context = await edit(A, { grams: 250 });
    check('fresh food and review have stable opaque editing identities', !!id && !!foodId);
    check('single-food request supplies the reviewed name and actual amount', context.foods.length === 1 && context.foods[0].name === 'Rice' && context.foods[0].grams === 150);
    check('request context exposes only bounded identities and food facts', Object.keys(context.foods[0]).sort().join(',') === 'foodId,grams,meal,name,reviewId');
    check('edit changes grams on the original review instead of adding another food card', foodCards(A).length === 1 && messages(A)[i].draftReviewId === id && row(A).grams === 250);
    check('edited row retains its stable identity and original nutrition density', row(A).draftFoodId === foodId && row(A).per_100g.protein === 10 && row(A).macros.pro === 25 && row(A).macros.cal === 250);
    check('the visible quantity and canonical total agree after editing', A.d.querySelector('[aria-label="Rice grams"]').value === '250' && A.q('ai-food-review').querySelector('.ai-food-total').textContent.includes('250 kcal'));
    check('successful edit still offers deliberate Save on the original card', !!save(A, i) && !messages(A)[i].applied);
    check('editing does not write daily logs or any member destination', unchangedDaily(A));
    check('canonical edit status explains that nothing has been saved', /nothing (?:has been |is )?saved|not saved/i.test(messages(A).at(-1).text || ''));
    await edit(A, { meal: 'Dinner' }, 'move this to dinner');
    check('meal-only edit changes the original meal and preserves grams and totals', row(A).meal === 'Dinner' && row(A).grams === 250 && row(A).macros.cal === 250 && foodCards(A).length === 1);
    check('repeated edits remain unsaved without persistent writes', unchangedDaily(A));
  });

  await section(code, 'Multiple foods require selection and focus the composer', async A => {
    const i = await send(A, { foods: [food('Rice', 150), food('Dal', 100)] }, 'rice 150g and dal 100g');
    const release = await startDelayed(A, 'make it 250 grams');
    const context = lastParse(A).body.context.draftFoods;
    check('multiple-food request contains both candidates without guessing a target', context.foods.length === 2 && context.target === null);
    await release(answer({ draft_edit: { status: 'clarify', reason: 'choose_food' }, reply: 'Choose the food you want to edit.' }));
    check('ambiguous edit leaves all existing portions untouched', row(A, 0, 0).grams === 150 && row(A, 0, 1).grams === 100 && foodCards(A).length === 1);
    check('both included unsaved rows expose the Edit with AI action', !!editButton(A, 'Rice') && !!editButton(A, 'Dal'));
    editButton(A, 'Dal').click(); await tick();
    check('selecting a food focuses the existing composer immediately', A.d.activeElement === A.q('composer-input'));
    check('selected-food pill identifies the chosen row and can be cancelled', A.q('draft-food-target')?.textContent.includes('Dal') && !!A.d.querySelector('[aria-label="Cancel food edit"]'));
    const selected = await edit(A, { grams: 220, meal: 'Dinner' }, '220 grams for dinner');
    const dal = selected.foods.find(f => f.name === 'Dal');
    check('explicit request target identifies the selected food and its review', selected.target?.foodId === dal.foodId && selected.target?.reviewId === dal.reviewId);
    check('selected edit changes only Dal and retains Rice', row(A, 0, 0).grams === 150 && row(A, 0, 1).grams === 220 && row(A, 0, 1).meal === 'Dinner');
    check('selection edit creates no duplicate card and no member write', foodCards(A).length === 1 && unchangedDaily(A) && !!save(A, i));
    editButton(A, 'Rice').click(); await tick();
    A.d.querySelector('[aria-label="Cancel food edit"]').click(); await tick();
    check('cancel removes selected-food mode without changing either row', !A.q('draft-food-target') && row(A, 0, 0).grams === 150 && row(A, 0, 1).grams === 220);
  });

  await section(code, 'Older unsaved review across the thread remains directly selectable', async A => {
    await send(A, { foods: [food('Rice', 150)] }, 'rice 150g');
    await send(A, { foods: [food('Curd', 120)] }, 'also curd 120g');
    editButton(A, 'Rice').click(); await tick();
    const context = await edit(A, { grams: 180 });
    check('context includes candidates across both unsaved review cards', context.foods.length === 2 && new Set(context.foods.map(f => f.reviewId)).size === 2);
    check('explicit older-card edit updates Rice without touching newer Curd', foodCards(A).length === 2 && row(A, 0).grams === 180 && row(A, 1).grams === 120);
    check('thread-wide edit remains a preview without persistence', unchangedDaily(A));
  });

  await section(code, 'Foods beyond the bounded context remain selectable', async A => {
    const foods = Array.from({ length: 26 }, (_, n) => food(`Food ${n + 1}`, 100 + n));
    await send(A, { foods }, 'review 26 separate foods');
    check('all 26 eligible rows keep their Edit with AI action', A.d.querySelectorAll('[data-testid="ai-food-edit"]').length === 26);
    check('the last food remains directly selectable beyond the context limit', !!editButton(A, 'Food 26'));
    editButton(A, 'Food 26').click(); await tick();
    const context = await edit(A, { grams: 275 });
    check('selected out-of-window food enters a request with at most 25 candidates', context.foods.length <= 25 && context.foods.some(f => f.name === 'Food 26' && f.foodId === context.target?.foodId));
    check('the 26th row changes while all other food quantities stay untouched', row(A, 0, 25).grams === 275 && foodCards(A)[0].parsed.foods.slice(0, 25).every((f, n) => f.grams === 100 + n));
    check('bounded-context edit neither duplicates the review nor writes a log', foodCards(A).length === 1 && unchangedDaily(A));
  });

  await section(code, 'Retry retains a newer selected food and typed draft', async A => {
    await send(A, { foods: [food('Rice', 150), food('Dal', 100)] }, 'rice and dal');
    editButton(A, 'Rice').click(); await tick();
    A.w.intercept = e => { if (e.url === '/ai-chat/parse') throw new Error('Synthetic interrupted edit'); };
    await type(A, A.q('composer-input'), 'make it 250 grams'); A.d.querySelector('[aria-label="Send"]').click();
    await until(() => A.q('ai-request-retry'), 'failed edit Retry');
    const oldPayload = copy(lastParse(A).body), target = oldPayload.context.draftFoods.target;
    editButton(A, 'Dal').click(); await tick(); await type(A, A.q('composer-input'), 'move this to dinner');
    A.w.intercept = null; A.w.answer = answer({ draft_edit: { status: 'edit', ...target, grams: 250 } });
    A.q('ai-request-retry').click();
    await until(() => row(A, 0, 0).grams === 250, 'retried original food edit'); await tick();
    check('Retry reuses its original exact bounded request including the Rice target', JSON.stringify(lastParse(A).body) === JSON.stringify(oldPayload));
    check('retry updates Rice without changing the newly selected Dal', row(A, 0, 0).grams === 250 && row(A, 0, 1).grams === 100);
    check('retry completion preserves the newer Dal selection and typed composer draft', A.q('draft-food-target')?.textContent.includes('Dal') && A.q('composer-input').value === 'move this to dinner');
    check('retry leaves one unsaved review and writes no member data', foodCards(A).length === 1 && unchangedDaily(A));
  });

  await section(code, 'Retry cannot overwrite an edited original review', async A => {
    await send(A, { foods: [food('Rice', 150)] }, 'rice 150g');
    editButton(A, 'Rice').click(); await tick();
    A.w.intercept = e => { if (e.url === '/ai-chat/parse') throw new Error('Synthetic interrupted edit'); };
    await type(A, A.q('composer-input'), 'make it 250 grams'); A.d.querySelector('[aria-label="Send"]').click();
    await until(() => A.q('ai-request-retry'), 'failed edit Retry');
    const original = copy(lastParse(A).body), target = original.context.draftFoods.target;
    await type(A, A.d.querySelector('[aria-label="Rice grams"]'), '170');
    A.w.intercept = null; A.w.answer = answer({ draft_edit: { status: 'edit', ...target, grams: 250 } });
    A.q('ai-request-retry').click();
    await until(() => messages(A).at(-1)?.draftEditStatus === 'unchanged', 'stale Retry refusal');
    check('retry keeps the old context rather than rebasing over newer manual edits', JSON.stringify(lastParse(A).body) === JSON.stringify(original));
    check('stale retry preserves the manually changed amount and original review count', row(A).grams === 170 && foodCards(A).length === 1);
    check('stale retry cannot produce a member data write', unchangedDaily(A));
  });

  await section(code, 'Photo edits preserve nutrition density and provenance', async A => {
    await until(() => A.q('ai-camera-input'), 'camera');
    const photo = { ...food('Photo rice', 180), source: 'ai', estimate: true, qty_text: 'Estimated: one bowl',
      per_100g: { calories: 128, protein: 2.5, total_carbs: 28, net_carbs: 26, fibre: 2, fat: 0.3 },
      macros: { cal: 230, pro: 4.5, carb: 46.8, fat: 0.5 }, warning: 'Photo estimate' };
    A.w.answer = answer({ foods: [photo] });
    const camera = A.q('ai-camera-input'); camera.click();
    Object.defineProperty(camera, 'files', { value: [new A.w.File(['synthetic photo'], 'fixture.jpg', { type: 'image/jpeg' })], configurable: true });
    camera.dispatchEvent(new A.w.Event('change', { bubbles: true }));
    await until(() => A.q('ai-food-review'), 'photo review');
    const original = copy(row(A)); const sourceText = A.q('food-source').textContent;
    editButton(A, 'Photo rice').click(); await tick();
    await edit(A, { grams: 250 });
    check('AI edit keeps photo evaluation provenance and original model amount', foodCards(A)[0].evalSource === 'photo' && row(A).ai_grams === 180);
    check('portion edit preserves authoritative per-100g nutrition including stored calories and fibre', JSON.stringify(row(A).per_100g) === JSON.stringify(original.per_100g));
    check('photo row recalculates calories and net carbs only from preserved nutrition density', row(A).macros.cal === 320 && row(A).macros.carb === 65 && row(A).macros.pro === 6.3 && row(A).macros.fat === 0.8);
    check('photo source label and estimate warning survive editing', row(A).source === original.source && row(A).warning === original.warning && A.q('food-source').textContent === sourceText);
    check('photo edit retains one unsaved card and has no member write', foodCards(A).length === 1 && unchangedDaily(A));
  });

  await section(code, 'Explicit edit mode rejects accidental additions', async A => {
    await send(A, { foods: [food('Rice', 150)] }, 'rice 150g');
    editButton(A, 'Rice').click(); await tick();
    const release = await startDelayed(A, 'make it 250 grams');
    await release(answer({ foods: [food('Invented duplicate rice', 250)], water_ml_add: 500, reply: 'Saved 999 kcal.' }));
    check('provider non-edit output cannot append foods when a specific draft is selected', foodCards(A).length === 1 && row(A).name === 'Rice' && row(A).grams === 150);
    check('provider non-edit output cannot add a water review in selected-food mode', !messages(A).some(m => m.parsed?.water_ml_add));
    check('accidental additions and false save prose never write a member log', unchangedDaily(A) && !/Saved 999 kcal/.test(A.d.body.textContent));
  });

  await section(code, 'Safety guidance takes precedence over selected edit mode', async A => {
    await send(A, { foods: [food('Rice', 150)] }, 'rice 150g');
    editButton(A, 'Rice').click(); await tick();
    const release = await startDelayed(A, 'I need urgent help');
    const target = lastParse(A).body.context.draftFoods.target;
    const guidance = 'Urgent guidance: contact local emergency services now.';
    await release(answer({ safety: 'emergency', question: true, reply: guidance,
      draft_edit: { status: 'edit', ...target, grams: 250 }, foods: [food('Unsafe extra food', 200)],
      water_ml_add: 500, workouts: [{ name: 'Unsafe extra workout' }], action: 'coach_message' }));
    const last = messages(A).at(-1);
    check('selected food mode displays the exact server safety guidance', last.role === 'ai' && last.text === guidance && A.d.body.textContent.includes(guidance));
    check('safety response is text only and cannot render food, water or workout actions', !last.parsed && !last.draftEditStatus && foodCards(A).length === 1);
    check('safety response ignores even a valid-looking edit and additional action payload', row(A).grams === 150 && unchangedDaily(A));
  });

  await section(code, 'Unrelated additions continue to create ordinary previews', async A => {
    await send(A, { foods: [food('Rice', 150)] }, 'rice 150g');
    const i = await send(A, { foods: [food('Curd', 120)], water_ml_add: 300 }, 'also curd 120 grams and water 300ml');
    check('normal add response keeps first review and creates a new food review', foodCards(A).length === 2 && row(A, 0).grams === 150 && row(A, 1).name === 'Curd');
    check('normal mixed logging retains water and explicit Save', messages(A)[i].parsed.water_ml_add === 300 && messages(A)[i].parsed.waterOn && !!save(A, i));
    check('normal additions remain unsaved until the member chooses Save', unchangedDaily(A));
  });

  for (const field of ['grams', 'meal', 'include', 'macros']) {
    await section(code, `Delayed edit after manual ${field} change`, async A => {
      await send(A, { foods: [food('Rice', 150)] }, 'rice 150g');
      const release = await startDelayed(A, 'make it 250 grams');
      const result = responseFor(A, { grams: 250 });
      if (field === 'grams') await type(A, A.d.querySelector('[aria-label="Rice grams"]'), '170');
      if (field === 'meal') {
        const node = A.d.querySelector('[aria-label="Rice meal"]'); node.value = 'Dinner';
        node.dispatchEvent(new A.w.Event('change', { bubbles: true })); await tick();
      }
      if (field === 'include') { A.d.querySelector('[aria-label="Include Rice"]').click(); await tick(); }
      if (field === 'macros') {
        A.q('chat-edit-macros').click(); await until(() => A.q('macro-in-protein'), 'macro editor');
        await type(A, A.q('macro-in-protein'), '20');
        if (A.q('macro-remember').checked) A.q('macro-remember').click();
        A.q('macro-save').click(); await tick();
      }
      const manual = copy(row(A)); await release(result);
      check('late model output does not replace newer manual review state', JSON.stringify(row(A)) === JSON.stringify(manual));
      check('stale edit creates neither a duplicate review nor member writes', foodCards(A).length === 1 && unchangedDaily(A));
    });
  }

  await section(code, 'Save-start makes a pending edit stale', async A => {
    const i = await send(A, { foods: [food('Rice', 150)] }, 'rice 150g');
    let resolveParse, resolveSave;
    const parsePromise = new Promise(done => { resolveParse = done; });
    const savePromise = new Promise(done => { resolveSave = done; });
    A.w.intercept = e => e.url === '/ai-chat/parse' ? parsePromise : /^\/logs\//.test(e.url) && e.method !== 'get' ? savePromise : undefined;
    await type(A, A.q('composer-input'), 'make it 250 grams'); A.d.querySelector('[aria-label="Send"]').click();
    await until(() => lastParse(A)?.body.message === 'make it 250 grams', 'pending edit');
    const result = responseFor(A, { grams: 250 }); save(A, i).click();
    await until(() => dataWrites(A).some(c => /^\/logs\//.test(c.url)), 'explicit save begins');
    check('Save locks the original review while persistence is still pending', messages(A)[i].applied && messages(A)[i].saveReceipt?.running);
    resolveParse({ data: result }); await tick(100);
    check('late edit cannot change the original portion after Save starts', messages(A)[i].parsed.foods[0].grams === 150 && A.w.log.getState().log.food[0].grams === 150);
    check('pending edit did not introduce a second write or food review', foodCards(A).length === 1 && dataWrites(A).filter(c => /^\/logs\//.test(c.url)).length === 1);
    const savedBody = copy(dataWrites(A).find(c => /^\/logs\//.test(c.url)).body);
    resolveSave({ data: { ...savedBody, saved_at: new Date().toISOString() } });
    await until(() => !messages(A)[i].saveReceipt.running, 'save completion'); A.w.intercept = null;
    check('completed saved row no longer exposes unsaved Edit with AI', !editButton(A, 'Rice'));
  });

  for (const boundary of ['account', 'session', 'day', 'reset']) {
    await section(code, `Delayed edit across ${boundary} boundary`, async A => {
      await send(A, { foods: [food('Rice', 150)] }, 'rice 150g');
      const release = await startDelayed(A, 'make it 250 grams');
      const result = responseFor(A, { grams: 250 });
      if (boundary === 'account') A.w.auth.setState({ user: { id: 215, name: 'Other fixture', role: 'patient' } });
      if (boundary === 'session') A.w.auth.setState({ sessionVersion: Number(A.w.auth.getState().sessionVersion || 0) + 1 });
      if (boundary === 'day') A.w.log.setState({ date: '2000-01-01' });
      if (boundary === 'reset') A.w.chat.getState().resetChat();
      await tick(); const snapshot = copy(messages(A)); await release(result);
      check('late edit is discarded without resurrecting or changing old conversation', JSON.stringify(messages(A)) === JSON.stringify(snapshot));
      check('stale scope cannot write member data or transplant the edited amount', unchangedDaily(A) && !foodCards(A).some(m => m.parsed.foods.some(f => f.grams === 250)));
    });
  }
} catch (error) {
  check('draft food edit regression setup completes', false, error.stack);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\ntest-ai-draft-food-edits-ui: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
