/** Regression for the deployed "logged 151 kcal" reply above an unsaved
 * 176 kcal review. Uses actual React components, stores and food arithmetic;
 * all requests and photos are synthetic. No database or external API calls. */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-preview-status-'));
let passed = 0, failed = 0, dom;
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
function check(name, ok) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  ok ? passed++ : failed++;
}
async function until(fn, label) {
  for (let i = 0; i < 120; i++) { if (fn()) return; await tick(); }
  throw new Error('Timed out: ' + label);
}
const apiFile = path.join(TMP, 'api.js');
fs.writeFileSync(apiFile, `
  const call = async (method, url, body) => {
    window.calls.push({ method, url, body });
    if (url === '/ai-chat/parse' || url === '/ai-chat/photo') return { data: window.answer };
    return { data: method === 'get' ? [] : { ok: true } };
  };
  export default Object.fromEntries(['get','post','put','patch','delete']
    .map(method => [method, (url,body) => call(method,url,body)]));
`);

try {
  const result = await build({
    stdin: { resolveDir: path.join(ROOT, 'client/src'), loader: 'jsx', contents: `
      import {createRoot} from 'react-dom/client';
      import AIChatLog from './components/AIChatLog';
      import {useAuthStore} from './store/authStore';
      import {useLogStore} from './store/logStore';
      import {useAIChat} from './store/aiChatStore';
      import {today,emptyLog} from './constants';
      import {aiReplyText,aiContextText,hasLoggingPreview} from './utils/aiReplyText';
      useAuthStore.setState({user:{id:214,name:'Fixture Member',role:'patient'},isRestoring:false});
      useLogStore.setState({date:today(),log:emptyLog(),protocol:{activities:[],acv:[],supplements:[]},loading:false,error:null});
      window.chat=useAIChat;window.log=useLogStore;window.replyText=aiReplyText;window.contextText=aiContextText;
      window.hasPreview=hasLoggingPreview;window.root=createRoot(document.getElementById('root'));
      window.root.render(<AIChatLog overlay/>);
      useAIChat.getState().ensureFreshDay(today());useAIChat.getState().openChat('text');
    ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true}' },
    plugins: [{ name: 'synthetic-api', setup(b) {
      b.onResolve({ filter: /(?:^|\/)client$/ }, args => /api\/client$/.test(args.path)
        || args.importer.includes(`${path.sep}api${path.sep}`) ? { path: apiFile } : null);
    } }], logLevel: 'silent',
  });
  dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
    url: 'https://fitlife-preview-status.invalid/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, d = w.document;
  w.calls = [];
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.scrollTo = () => {};
  w.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  w.Image = class { width = 800; height = 600; set src(value) { w.setTimeout(() => this.onload?.(), 0); } };
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,UEhPVE8=';
  const errors = [];
  w.addEventListener('error', e => errors.push(e.message));
  w.eval(result.outputFiles[0].text);
  const q = id => d.querySelector(`[data-testid="${id}"]`);
  const reply = () => [...d.querySelectorAll('[data-testid="ai-reply-text"]')].map(el => el.textContent).join('\n');
  const food = (name, calories) => ({ name, grams: 100, meal: 'Breakfast',
    per_100g: { calories, protein: 4, carbs: 25, fat: 2, fiber: 1 },
    macros: { cal: calories, pro: 4, carb: 24, fat: 2 }, source: 'database' });
  const mealAnswer = text => ({ reply: text, foods: [food('Idlis', 134), food('Sambar', 42)],
    totals: { cal: 151 }, activities: [], acv: [], supplements: [], workouts: [], corrections: [] });
  const setValue = async (node, value) => {
    const proto = node.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
    node.dispatchEvent(new w.Event('input', { bubbles: true }));
    await tick();
  };
  const send = async text => {
    await setValue(q('composer-input'), text);
    d.querySelector('[aria-label="Send"]').click();
    await until(() => w.chat.getState().messages.at(-1)?.role === 'ai', 'AI response');
    await tick();
  };
  const noWrites = () => !w.calls.some(c => c.method !== 'get'
    && !['/ai-chat/parse', '/ai-chat/photo'].includes(c.url));
  await until(() => q('composer-input'), 'composer');

  w.answer = mealAnswer('Got it — logged 2 idlis and sambar for breakfast, about 151 kcal total.');
  await send('2 idlis and sambar for breakfast');
  check('text logging says the review has not been saved', reply().includes('These entries haven’t been saved yet.'));
  check('model completion and 151 kcal claim are absent from the displayed reply', !/logged|151\s*kcal/i.test(reply()));
  check('canonical food totals display 176 kcal independently of model totals', q('ai-food-review').querySelector('.ai-food-total').textContent.includes('176 kcal'));
  check('the two food entries still require an explicit Save action', [...d.querySelectorAll('button')].some(b => b.textContent.includes('Save 2 items to today')));
  check('receiving a text preview never writes a log', noWrites() && w.log.getState().log.food.length === 0);

  await setValue(d.querySelector('[aria-label="Idlis grams"]'), '150');
  check('100 to 150 grams scales the canonical item from 134 to 201 kcal', d.querySelector('.chat-food-calories').textContent === '201 kcal');
  check('the corrected review totals update to 243 kcal without competing model prose', d.querySelector('.ai-food-total').textContent.includes('243 kcal') && !reply().includes('151'));
  q('chat-edit-macros').click();
  await until(() => q('macro-editor'), 'macro editor');
  const beforeCancel = JSON.stringify(w.chat.getState().messages.at(-1).parsed.foods);
  await setValue(q('macro-in-protein'), '50');
  q('macro-cancel').click();
  await until(() => !q('macro-editor'), 'cancel macro edit');
  check('Cancel restores the prior preview and its 201 kcal item', JSON.stringify(w.chat.getState().messages.at(-1).parsed.foods) === beforeCancel && d.querySelector('.chat-food-calories').textContent === '201 kcal');
  check('quantity editing and macro Cancel produce no member-data writes', noWrites());

  w.answer = {...mealAnswer('Saved the food.'), advice: {basis:'saved_snapshot',question:'How much protein?',text:'Your saved entries contain 20g protein.'}};
  await send('I ate idlis and sambar. How much protein?');
  check('mixed answer appears separately from canonical unsaved status', q('ai-mixed-answer')?.textContent.includes('20g protein') && reply().includes('These entries haven’t been saved yet.'));
  check('mixed answer labels its saved snapshot and excludes the review', q('ai-mixed-answer')?.textContent.includes('this review is excluded'));
  check('mixed answer does not leak into logging context as saved review', !w.contextText(w.chat.getState().messages.at(-1)).includes('20g protein'));
  check('mixed request does not write member data', noWrites());

  const advice = 'You logged water earlier. For a balanced breakfast, add a source of protein and fruit.';
  w.answer = { reply: advice, foods: [], activities: [], acv: [], supplements: [], workouts: [], corrections: [] };
  await send('How can I balance breakfast?');
  check('genuine Q&A without proposed log entries keeps its complete answer', reply().endsWith(advice));
  const history = w.calls.filter(c => c.url === '/ai-chat/parse').at(-1).body.context.recent;
  check('follow-up context never tells the model its unsaved preview was already logged', !history.some(m => m.role === 'ai' && /logged 2 idlis|151 kcal/.test(m.text)));

  w.chat.getState().setMessages([]);
  await tick();
  w.answer = mealAnswer('Saved your meal. Total: 151 kcal.');
  const camera = q('ai-camera-input');
  camera.click();
  Object.defineProperty(camera, 'files', { value: [new w.File(['fixture'], 'fixture.jpg', { type: 'image/jpeg' })], configurable: true });
  camera.dispatchEvent(new w.Event('change', { bubbles: true }));
  await until(() => q('ai-food-review'), 'photo review');
  check('photo review has the same explicit unsaved wording', reply().includes('These entries haven’t been saved yet.') && !reply().includes('Saved your meal'));
  check('photo nutrition comes from canonical reviewed rows, not model prose', d.querySelector('.ai-food-total').textContent.includes('176 kcal') && !reply().includes('151'));
  check('analysing a photo never writes a log', noWrites() && w.log.getState().log.food.length === 0);
  d.querySelector('[aria-label="Include Idlis"]').click(); await tick();
  d.querySelector('[aria-label="Include Sambar"]').click(); await tick();
  check('excluding every food keeps the review controls available', !!q('ai-food-review') && !!d.querySelector('[aria-label="Include Idlis"]'));
  check('an empty selection offers no Save action or completion claim', ![...d.querySelectorAll('button')].some(b => /Save \d+ items? to today/.test(b.textContent)) && reply().includes('These entries haven’t been saved yet.'));
  d.querySelector('[aria-label="Include Idlis"]').click(); await tick();
  check('a member can reinclude an excluded item without starting over', [...d.querySelectorAll('button')].some(b => b.textContent.includes('Save 1 item to today')));
  d.querySelector('[aria-label="Include Sambar"]').click(); await tick();
  await setValue(d.querySelector('[aria-label="Idlis grams"]'), '150');
  w.answer = { reply: advice, foods: [], activities: [], acv: [], supplements: [], workouts: [], corrections: [] };
  await send('What was in that photo?');
  const photoHistory = w.calls.filter(c => c.url === '/ai-chat/parse').at(-1).body.context.recent;
  check('photo follow-up context includes current reviewed food names and quantities', photoHistory.some(m => m.role === 'ai' && m.text.includes('Unsaved preview:') && m.text.includes('Idlis 150g Breakfast') && m.text.includes('Sambar 100g Breakfast')));
  check('photo follow-up context excludes the model completion claim and stale calories', !photoHistory.some(m => m.role === 'ai' && /Saved your meal|151 kcal/.test(m.text)));

  w.chat.getState().setMessages([]);
  await tick();
  w.answer = { ...mealAnswer('Meal, water and notes saved — 151 kcal.'), water_ml_add: 500, notes: 'Energy was good' };
  await send('2 idlis and sambar, 500 ml water, and my energy was good');
  check('mixed daily updates keep food, water and notes in the review', [...d.querySelectorAll('button')].some(b => b.textContent.includes('Save 4 items to today')));
  check('mixed updates have one unsaved status and still require confirmation', reply().includes('These entries haven’t been saved yet.') && !reply().includes('151') && noWrites());

  const mixedPreview = w.chat.getState().messages.at(-1);
  w.chat.getState().setMessages([]); await tick();
  w.answer = { reply: 'Saved your note.', notes: 'Energy was good', foods: [], activities: [], acv: [], supplements: [], workouts: [], corrections: [] };
  await send('My energy was good');
  await setValue(d.querySelector('[aria-label="Review daily note"]'), '');
  check('clearing a notes-only preview never restores the model saved claim', reply().includes('These entries haven’t been saved yet.') && !reply().includes('Saved your note'));
  check('clearing the note keeps its editor open and disables an empty save', !!d.querySelector('[aria-label="Review daily note"]') && ![...d.querySelectorAll('button')].some(b => /Save \d+ items? to today/.test(b.textContent)));
  await setValue(d.querySelector('[aria-label="Review daily note"]'), 'Energy improved');
  check('an edited note remains reviewable and can be saved deliberately', [...d.querySelectorAll('button')].some(b => b.textContent.includes('Save 1 item to today')));
  w.chat.getState().setMessages([]); await tick();
  w.answer = { reply: 'Workout saved.', foods: [], activities: [], acv: [], supplements: [], workouts: [{ name: 'Walk', sets: [], duration_min: 20 }], corrections: [] };
  await send('I walked for 20 minutes');
  check('the workout footer never claims a pending session is saved', !q('ai-thread').textContent.includes("Saved to today's session") && reply().includes('These entries haven’t been saved yet.'));
  check('all editing and workout previews remain free of member-data writes', noWrites());

  const fields = {
    weight_kg: 82.4, water_ml_add: 500, sleep: { bedtime: '22:00', waketime: '06:00' },
    notes: 'Energy was good', activities: [{ id: 'walk', on: false }], acv: [{ id: 'acv', on: false }],
    supplements: [{ id: 'vitamin', on: false }], workouts: [{ name: 'Squat', on: false }],
    corrections: [{ name: 'Idlis', grams: 150, on: false }], bodyMetrics: [{ name: 'Fat', value: 20 }],
  };
  for (const [key, value] of Object.entries(fields)) {
    check(`${key}: structured entries, including excluded ones, cannot inherit a model save claim`,
      w.replyText({ text: 'Successfully saved and logged.', parsed: { [key]: value } }).includes('These entries haven’t been saved yet.'));
  }
  const pending = mixedPreview;
  w.chat.getState().setMessages([{ ...pending, text: 'Previously cached: saved 151 kcal.', applied: true, queued: true }]);
  await tick();
  check('applied-but-queued cards defer to the real status instead of model save claims', reply() === 'Your reviewed entries.' && !reply().includes('saved 151'));
  w.chat.getState().setMessages([{ ...pending, text: 'Old cached preview: logged 151 kcal.', applied: false }]);
  await tick();
  check('already-open unsaved conversation cards are protected without another API call', reply().includes('These entries haven’t been saved yet.') && !reply().includes('151'));
  check('lab previews also avoid model completion claims before confirmation', w.replyText({ text: 'Results saved.', lab: { results: [{ value: 5 }] } }).includes('These entries haven’t been saved yet.'));
  check('Hindi and Kannada model completion claims cannot bypass preview status',
    ['आपका खाना सेव कर दिया, 151 कैलोरी।', 'ನಿಮ್ಮ ಊಟವನ್ನು ಉಳಿಸಲಾಗಿದೆ, 151 ಕ್ಯಾಲೊರಿ.']
      .every(text => w.replyText({ text, parsed: { foods: [{}] } }).includes('These entries haven’t been saved yet.')));
  check('Kannada informational answers without proposed entries remain intact',
    w.replyText({ text: 'ಪ್ರೋಟೀನ್ ಇರುವ ಆಹಾರ ಸೇರಿಸಿ.', parsed: { foods: [] } }) === 'ಪ್ರೋಟೀನ್ ಇರುವ ಆಹಾರ ಸೇರಿಸಿ.');
  check('error and informational replies remain unchanged', w.replyText({ text: 'Try your connection again.', error: true }) === 'Try your connection again.');
  check('null and zero default fields cannot hide a genuine no-action answer',
    w.replyText({ text: advice, parsed: { foods: [], weight_kg: 0, water_ml_add: 0, sleep: {}, notes: '', notesOn: false } }) === advice);
  check('scale and lab follow-up context retains exact values, units and exclusions',
    w.contextText({ parsed: { bodyMetrics: [{ name: 'Body fat', value: 20.5, unit: '%' }], bodyMetricsOn: false },
      lab: { results: [{ test_name: 'HDL', value: 45, unit: 'mg/dL', on: false }] } }).includes('Body fat 20.5% (excluded); HDL 45 mg/dL (excluded)'));
  check('workout follow-up context retains the reviewed reps and weight',
    w.contextText({ parsed: { workouts: [{ name: 'Squat', sets: [{ reps: 8, weight_kg: 40 }], on: false }] } }).includes('Squat 8 reps at 40kg (excluded)'));
  check('the regression completes without uncaught render errors', errors.length === 0);
} catch (error) {
  check('preview regression completes', false);
  console.error(error.stack);
} finally {
  dom?.window.root?.unmount();
  dom?.window.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\ntest-ai-preview-status: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
