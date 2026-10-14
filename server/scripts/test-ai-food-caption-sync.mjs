/** Quantity-caption synchronization uses the mounted AIChatLog, real stores and
 * canonical food arithmetic. Providers, photos and log storage are synthetic;
 * these checks do not establish live-model or device accuracy. */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-caption-sync-'));
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
      import * as reviews from './utils/aiFoodReview';
      import * as portions from './utils/householdPortions';
      window.captionHelpers={...reviews,...portions};

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
    url: 'https://fitlife-caption-sync.invalid/', runScripts: 'outside-only', pretendToBeVisual: true,
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


const caption = (A, i = 1) => card(A, i)?.querySelector('[data-testid="ai-food-review"] .ai-food-review label > span > span')?.textContent;
const dailyWrites = A => dataWrites(A).filter(c => /^\/logs\/\d{4}-\d{2}-\d{2}$/.test(c.url));
try {
  const code = await bundle();
  await section(code, 'Canonical captions follow grams without changing nutrition', async A => {
    const h=A.w.captionHelpers;
    const original={...food('Cooked white rice',175),on:true,qty_text:'175 g',source:'member',label:true,
      per_100g:{calories:165,protein:3,total_carbs:28,net_carbs:25,fibre:3,fat:1}};
    const first=h.withFoodGrams({name:'Sambar',qty_text:'Estimated: 1 bowl',per_100g:original.per_100g},200);
    check('initial nutrition calculation keeps the supplied description unchanged',first.qty_text==='Estimated: 1 bowl');
    const updated=h.withFoodGrams(original,'125');
    check('manual grams replace the old gram caption with the visible amount',updated.grams===125&&updated.qty_text==='125 g');
    check('calories and net-carb macros use unchanged stored nutrition density',updated.macros.cal===206&&updated.macros.carb===31.3&&updated.per_100g===original.per_100g);
    check('manual edit preserves member label and nutrition provenance',updated.source==='member'&&updated.label===true);
    const blank=h.withFoodGrams(updated,'');
    check('clearing grams clears the caption and blocks Save',blank.qty_text===''&&blank.grams===''&&!!h.foodReviewError([blank]));
    const restored=h.withFoodGrams(blank,'150');
    check('retyping grams restores one current caption and correct macros',restored.qty_text==='150 g'&&restored.macros.cal===248&&restored.macros.carb===37.5);
    const contextual=h.withFoodGrams({...original,qty_text:'2 bowls',grams:300,ai_grams:300,portion_phrase:'bowl cooked white rice'},400);
    check('household description remains alongside the new gram amount',contextual.qty_text==='2 bowls · 400 g');
    check('preserved household count keeps learning one bowl instead of the whole meal',h.portionCorrections([contextual])[0]?.quantity===2);
    const repeated=h.withFoodGrams(h.withFoodGrams(contextual,''),480);
    check('clear and retype preserve useful household context without old grams',repeated.qty_text==='2 bowls · 480 g'&&!repeated.qty_text.includes('400'));
    check('clear and retype preserve the original count used for portion memory',h.portionCorrections([repeated])[0]?.quantity===2);
    const selected=h.withPortion({...original,grams:300,qty_text:'2 bowls'}, {unit:'bowl',quantity:2,grams_per_unit:150,phrase:'bowl cooked white rice',basis:'remembered'},2);
    const selectedEdit=h.withFoodGrams({...selected,remember_portion:true},450);
    check('structured household quantity and caption move together',selectedEdit.portion.quantity===3&&selectedEdit.qty_text==='3 bowl · 450 g');
    check('structured portion retains its known unit basis and opt-in memory',selectedEdit.portion.grams_per_unit===150&&selectedEdit.portion.basis==='remembered'&&selectedEdit.remember_portion);
    check('structured portion memory uses the updated count and total grams',h.portionCorrections([selectedEdit])[0]?.quantity===3&&h.portionCorrections([selectedEdit])[0]?.grams===450);
    const free=h.withFoodGrams({...original,qty_text:'About 175 g in a plate'},125);
    check('free-form captions cannot retain a competing old gram claim',free.qty_text==='125 g');
    for(const value of ['0','5001']) {
      const bad=h.withFoodGrams(original,value);
      check(`invalid quantity ${value} remains visible and blocked`,bad.qty_text===`${value} g`&&!!h.foodReviewError([bad]));
    }
    check('quantity synchronization leaves the original object untouched',original.grams===175&&original.qty_text==='175 g');
  });

  await section(code, 'Saved AI-edited food reopens with a synchronized manual caption', async A => {
    const rice={...food('Cooked white rice',100),qty_text:'100 g',source:'member',label:true,
      per_100g:{calories:165,protein:3,total_carbs:28,net_carbs:25,fibre:3,fat:1},macros:{cal:165,pro:3,carb:25,fat:1}};
    const i=await send(A,{foods:[rice]},'Cooked white rice 100 grams');
    await edit(A,{grams:175});
    check('AI edit begins with a current175g caption on the original card',row(A).grams===175&&caption(A,i)==='175 g');
    save(A,i).click();await until(()=>messages(A)[i].applied&&messages(A)[i].saveReceipt?.daily.state==='saved'&&!messages(A)[i].saveReceipt.running,'initial Save');
    check('first explicit Save persists one175g entry',A.w.log.getState().log.food.length===1&&A.w.log.getState().log.food[0].grams===175);
    card(A,i).querySelector('[data-testid="ai-card-edit"]').click();
    await until(()=>messages(A)[i].editing&&messages(A)[i].saveReceipt.rolledBack&&!messages(A)[i].saveReceipt.running,'receipt Edit rollback');
    check('receipt Edit removes its saved entry and reopens the same review',A.w.log.getState().log.food.length===0&&foodCards(A).length===1&&!!save(A,i));
    const before=dailyWrites(A).length,per=copy(row(A).per_100g);
    await type(A,A.d.querySelector('[aria-label="Cooked white rice grams"]'),'125');
    check('manual input shows125g and caption125g rather than old175g',A.d.querySelector('[aria-label="Cooked white rice grams"]').value==='125'&&caption(A,i)==='125 g');
    check('reopened food shows206kcal calculated from preserved label nutrition',row(A).macros.cal===206&&A.q('ai-food-review').querySelector('.ai-food-total').textContent.includes('206 kcal')&&JSON.stringify(row(A).per_100g)===JSON.stringify(per));
    check('manual reopened edit preserves provenance and does not auto-save',row(A).source==='member'&&row(A).label&&dailyWrites(A).length===before&&A.w.log.getState().log.food.length===0);
    save(A,i).click();await until(()=>messages(A)[i].applied&&messages(A)[i].saveReceipt?.daily.state==='saved'&&!messages(A)[i].saveReceipt.running,'corrected Save');
    const latest=dailyWrites(A).at(-1).body.food_items;
    check('corrected Save writes exactly one125g entry and keeps chat caption synchronized',latest.length===1&&latest[0].grams===125&&caption(A,i)==='125 g',JSON.stringify(latest));
    check('corrected saved entry retains original member nutrition and label',messages(A)[i].parsed.foods[0].source==='member'&&latest[0]?.label&&JSON.stringify(latest[0]?.per_100g)===JSON.stringify(per),JSON.stringify(latest));
  });

  await section(code, 'Household controls stay aligned after manual grams', async A => {
    const i=await send(A,{foods:[{...food('Rice',300),qty_text:'2 bowls',portion_phrase:'bowl rice'}]},'2 bowls of rice');
    const unit=A.d.querySelector('[aria-label="Rice portion unit"]');unit.value='estimate';unit.dispatchEvent(new A.w.Event('change',{bubbles:true}));await tick();
    await type(A,A.d.querySelector('[aria-label="Rice grams"]'),'450');
    check('household count field and caption both show three bowls',A.d.querySelector('[aria-label="Rice portion count"]').value==='3'&&caption(A,i)==='3 bowl · 450 g');
    check('household unit weight remains150g and total stays450g',A.d.querySelector('[aria-label="Rice grams per portion"]').value==='150'&&row(A).grams===450);
    const currentUnit=A.d.querySelector('[aria-label="Rice portion unit"]');currentUnit.value='';currentUnit.dispatchEvent(new A.w.Event('change',{bubbles:true}));await tick();
    await type(A,A.d.querySelector('[aria-label="Rice grams"]'),'200');
    check('returning to grams cannot resurrect the discarded household caption',caption(A,i)==='200 g'&&!row(A).portion&&!row(A).portion_phrase&&!A.d.querySelector('[aria-label="Rice portion count"]'));
    check('household edits stay in the preview without persistence',unchangedDaily(A));
  });

  await section(code, 'Edited macros remain authoritative after quantity changes', async A => {
    const i=await send(A,{foods:[{...food('Oats',175),qty_text:'175 g'}]},'oats 175g');
    A.q('chat-edit-macros').click();await until(()=>A.q('macro-in-protein'),'macro editor');
    await type(A,A.q('macro-in-protein'),'24');if(A.q('macro-remember').checked)A.q('macro-remember').click();
    A.q('macro-save').click();await until(()=>!A.q('macro-editor'),'macro editor closes');
    const label=copy(row(A).per_100g);await type(A,A.d.querySelector('[aria-label="Oats grams"]'),'125');
    check('quantity edit keeps the member-edited density and label source',row(A).per_100g.protein===24&&JSON.stringify(row(A).per_100g)===JSON.stringify(label)&&row(A).source==='member'&&row(A).label);
    check('quantity caption and protein total both reflect125g',caption(A,i)==='125 g'&&row(A).macros.pro===30);
    check('macros and quantity review create no member write without Save',unchangedDaily(A));
  });
} catch(error) {check('caption sync setup completes',false,error.stack);}
finally {fs.rmSync(TMP,{recursive:true,force:true});}
console.log(`\ntest-ai-food-caption-sync: ${passed} passed, ${failed} failed`);
process.exitCode=failed?1:0;
