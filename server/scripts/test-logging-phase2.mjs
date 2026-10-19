/** Phase 2 logging regression: executes actual stores, hooks and components.
 * Synthetic API and browser media fixtures never access member data or hardware.
 * Run after the client build. Chromium checks test layout, not device accuracy.
 */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserExecutable } from './lib/browser-executable.mjs';
import { readBuiltCss } from './lib/built-css.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'client/src');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlife-phase2-'));
let pass = 0, fail = 0;
const checks = [];
function ck(name, ok, detail = '') {
  checks.push({ name, status: ok ? 'Pass' : 'Fail', detail: ok ? '' : String(detail) });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 250)}`);
  if (ok) pass++; else fail++;
}
const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, ms = 2500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await tick(); }
  throw new Error('Timed out: ' + label);
}
const API = path.join(TMP, 'api.js');
fs.writeFileSync(API, `
  const call = async (method, url, body, opts) => {
    const entry={method,url,body,opts}; window.__calls.push(entry);
    if(window.__apiHandler) return window.__apiHandler(entry);
    return {data: method==='get' ? [] : {ok:true}};
  };
  export default Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(url,body,opts)=>call(method,url,body,opts)]));
`);
async function bundle(source) {
  const result = await build({ stdin: { contents: source, resolveDir: SRC, loader: 'jsx', sourcefile: 'phase2-test-entry.jsx' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
    loader: { '.js':'jsx', '.jsx':'jsx', '.css':'empty', '.svg':'empty', '.png':'empty', '.jpg':'empty', '.webp':'empty' },
    define: { 'process.env.NODE_ENV':'"production"', 'import.meta.env': JSON.stringify({MODE:'production', DEV:false, PROD:true, BASE_URL:'/'}) },
    plugins: [{name:'fixture-api', setup(b) { b.onResolve({filter:/(?:^|\/)client$/}, args =>
      (/api\/client$/.test(args.path) || args.importer.includes(`${path.sep}api${path.sep}`)) ? {path:API} : null); }}], logLevel:'silent' });
  return result.outputFiles[0].text;
}
const INIT = `
 import {createRoot} from 'react-dom/client';
 import {useAuthStore} from './store/authStore';
 import {useSettingsStore} from './store/settingsStore';
 import {useAIChat} from './store/aiChatStore';
 import {useLogStore} from './store/logStore';
 import {today,emptyLog} from './constants';
 useAuthStore.setState({user:{id:214,name:'Fixture Member',role:'patient'},isRestoring:false});
 useLogStore.setState({date:today(),log:emptyLog(),protocol:{activities:[],acv:[],supplements:[]},loading:false,error:null});
 window.__auth=useAuthStore;window.__settings=useSettingsStore;window.__chat=useAIChat;window.__log=useLogStore;window.__today=today();
 window.__root=createRoot(document.getElementById('root'));
`;
const CHAT = INIT + `
 import AIChatLog from './components/AIChatLog';
 window.__root.render(<AIChatLog overlay/>);
 // The real launcher establishes today's context before invoking browser input.
 useAIChat.getState().ensureFreshDay(today());useAIChat.getState().openChat('text');
`;
const VOICE = INIT + `
 import {useVoiceInput} from './hooks/useVoiceInput'; import {useState} from 'react';
 function Probe(){const [context,setContext]=useState('first');window.__setVoiceContext=setContext;window.__voice=useVoiceInput({contextKey:context,lang:useSettingsStore(s=>s.voiceLang),onInterim:t=>window.__interim.push(t),onFinal:t=>window.__final.push(t)});return <div>Voice hook fixture</div>}
 window.__root.render(<Probe/>);
`;
const COMPOSER = INIT + `
 import {useVoiceComposer} from './components/VoiceComposer';
 function Probe(){const vc=useVoiceComposer({onSend:t=>window.__sent.push(t),autoSend:false});window.__composer=vc;return <div style={{width:'100%',padding:16,boxSizing:'border-box'}}>{vc.card}{vc.micButton}</div>}
 window.__root.render(<Probe/>);
`;
const SETTINGS = INIT + `
 import {MemoryRouter} from 'react-router-dom'; import Settings from './pages/Settings';
 window.__root.render(<MemoryRouter><Settings/></MemoryRouter>);
`;
const FOOD = INIT + `
 import FoodLog from './components/FoodLog';
 window.__foodChanges=[];window.__root.render(<FoodLog items={[]} onChange={items=>window.__foodChanges.push(items)}/>);
`;
const WORKOUT = INIT + `
 import WorkoutLog from './components/WorkoutLog';
 window.__root.render(<WorkoutLog date={today()}/>);
`;
const COACH = INIT + `
 import {useState} from 'react';
 import {MemoryRouter} from 'react-router-dom';
 import CoachAIChat, {useCoachAI} from './components/CoachAIChat';
 useAuthStore.setState({user:{id:987,name:'Fixture Coach',role:'monitor'}});
 window.__coach=useCoachAI;
 function CoachProbe(){const [member,setMember]=useState({id:214,name:'Member A'});window.__setContextMember=setMember;return <MemoryRouter><CoachAIChat contextMember={member}/></MemoryRouter>}
 window.__root.render(<CoachProbe/>);
 useCoachAI.getState().openChat();
`;

function fixture(w, { recorder = true, denied = false } = {}) {
  w.__calls=[];w.__final=[];w.__interim=[];w.__sent=[];w.__micRequests=0;w.__stoppedTracks=0;w.__recorderStarts=0;w.__pickerClicks=0;w.__audioBytes=2048;
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
  w.scrollTo=()=>{};w.confirm=()=>true;
  w.fetch=async()=>({ok:false,status:401,json:async()=>({})});
  w.Image=class{width=800;height=600;set src(v){w.setTimeout(()=>this.onload?.(),0)}};
  w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});
  w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,UEhPVE9fRklYVFVSRQ==';
  const click=w.HTMLInputElement.prototype.click;
  w.HTMLInputElement.prototype.click=function(){if(this.type==='file'){w.__pickerClicks++;w.__lastPicker=this;}return click.call(this)};
  if(recorder){
    Object.defineProperty(w.navigator,'mediaDevices',{configurable:true,value:{getUserMedia(){
      w.__micRequests++;if(denied)return Promise.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'}));
      const stream={getTracks:()=>[{stop(){w.__stoppedTracks++}}]};
      if(w.__deferPermission)return new Promise(resolve=>{w.__grantPermission=()=>resolve(stream)});
      return Promise.resolve(stream);
    }}});
    w.MediaRecorder=class {static isTypeSupported(){return true}state='inactive';
      start(){this.state='recording';w.__recorderStarts++}
      stop(){this.state='inactive';w.setTimeout(()=>{this.ondataavailable?.({data:new w.Blob(['a'.repeat(w.__audioBytes)],{type:'audio/webm'})});this.onstop?.()},0)}
    };
  }
}
function mount(code, opts={}, setup) {
  const errors=[];
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://fitlife-phase2.invalid/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;fixture(w,opts);if(setup)setup(w);
  w.addEventListener('error',e=>errors.push(String(e.message)));
  w.eval(code);
  return {w,errors,q:id=>w.document.querySelector(`[data-testid="${id}"]`),close(){w.__root?.unmount();w.close()}};
}
async function type(w,node,value){if(!node)throw new Error('Missing input');const proto=node.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(node,value);node.dispatchEvent(new w.Event('input',{bubbles:true}));await tick();}
async function send(A,text){await type(A.w,A.q('composer-input'),text);A.w.document.querySelector('button[aria-label="Send"]').click();await tick();}
const requests=(A,url)=>A.w.__calls.filter(x=>x.url===url);
const parsed = (reply='Fixture preview') => ({data:{reply,weight_kg:82.5,foods:[],activities:[],acv:[],supplements:[],workouts:[],corrections:[]}});
const networkError=()=>Object.assign(new Error('offline'),{response:{data:{error:'PRIVATE_PROVIDER_DETAIL_DO_NOT_RENDER'}}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
async function section(label,fn){console.log('\n'+label);try{await fn()}catch(e){ck(label+' completes',false,e.stack)}}

async function languageCases(code) {
  const A=mount(code);await until(()=>A.w.__settings,'settings store');
  try{
    for(const lang of ['en-IN','hi-IN','kn-IN']){
      A.w.__settings.getState().setVoiceLang(lang);await tick();
      ck(`${lang}: setting accepts the supported language`,A.w.__settings.getState().voiceLang===lang);
      const stored=A.w.localStorage.getItem('fitlife-settings-v2');
      ck(`${lang}: language is written to persisted settings`,JSON.parse(stored).state.voiceLang===lang);
      const B=mount(code,{},w=>w.localStorage.setItem('fitlife-settings-v2',stored));await tick();
      ck(`${lang}: a fresh app rehydrates the same language`,B.w.__settings.getState().voiceLang===lang);B.close();
    }
    A.w.__settings.getState().setVoiceLang('xx-IN');await tick();
    ck('invalid language setter falls back to English',A.w.__settings.getState().voiceLang==='en-IN');
    const bad=JSON.stringify({state:{voiceLang:'xx-IN'},version:0});
    const B=mount(code,{},w=>w.localStorage.setItem('fitlife-settings-v2',bad));await tick();
    ck('invalid persisted language rehydrates as English',B.w.__settings.getState().voiceLang==='en-IN');B.close();
    ck('settings page renders the shared language choice',!!A.q('settings-voice-language'));
    const select=A.q('settings-voice-language');
    ck('settings offers English, Hindi and Kannada exactly once',select && ['en-IN','hi-IN','kn-IN'].every(l=>[...select.options].filter(o=>o.value===l).length===1));
    if(select){select.value='kn-IN';select.dispatchEvent(new A.w.Event('change',{bubbles:true}));await tick();ck('choosing Kannada in Settings updates the store',A.w.__settings.getState().voiceLang==='kn-IN')}
    ck('Settings mounts without runtime errors',A.errors.length===0,A.errors);
  }finally{A.close()}
}

async function textCases(code){
 const A=mount(code);await until(()=>A.q('composer-input'),'chat input');
 try{
  let gate=deferred();A.w.__apiHandler=e=>e.url==='/ai-chat/parse'?gate.promise:Promise.resolve({data:[]});
  await send(A,'Weight 82.5 kg');
  ck('text send starts one parse request',requests(A,'/ai-chat/parse').length===1);
  const original=JSON.stringify(requests(A,'/ai-chat/parse')[0].body);
  await type(A.w,A.q('composer-input'),'Drank 500 ml water');
  gate.reject(networkError());await until(()=>A.q('ai-request-retry'),'text recovery');
  ck('failed text exposes Retry and Edit',!!A.q('ai-request-retry')&&!!A.q('ai-request-edit'));
  ck('provider detail is not exposed to the member',!A.w.document.body.textContent.includes('PRIVATE_PROVIDER_DETAIL'));
  ck('failed request keeps the newer composer draft',A.q('composer-input').value==='Drank 500 ml water');
  gate=deferred();const retry=A.q('ai-request-retry');retry.click();retry.click();await tick();
  ck('double Retry starts only one additional request',requests(A,'/ai-chat/parse').length===2);
  ck('Retry resends the original message and context unchanged',JSON.stringify(requests(A,'/ai-chat/parse')[1].body)===original);
  gate.resolve(parsed());await until(()=>A.w.__chat.getState().messages.some(m=>m.parsed),'parsed review');
  ck('Retry success preserves the newer composer draft',A.q('composer-input').value==='Drank 500 ml water');
  ck('Retry success produces one review card',A.w.__chat.getState().messages.filter(m=>m.parsed).length===1);
  ck('Retry does not duplicate the original user bubble',A.w.__chat.getState().messages.filter(m=>m.role==='user').length===1);
  ck('successful retry removes the failed-request action',!A.q('ai-request-retry'));
  ck('parsed result is not automatically saved',A.w.__calls.every(e=>e.method==='get'||!/^\/logs\//.test(e.url))&&A.w.__log.getState().log.weight==='');
  ck('review includes an explicit Save action',[...A.w.document.querySelectorAll('button')].some(b=>/^Save 1 item/.test(b.textContent.trim())));
  ck('text recovery mounts without runtime errors',A.errors.length===0,A.errors);
 }finally{A.close()}
 const B=mount(code);await until(()=>B.q('composer-input'),'edit chat');
 try{
  B.w.__apiHandler=e=>e.url==='/ai-chat/parse'?Promise.reject(networkError()):Promise.resolve({data:[]});
  await send(B,'Weight 285 kg');await until(()=>B.q('ai-request-edit'),'edit action');
  await type(B.w,B.q('composer-input'),'A separate newer message');B.q('ai-request-edit').click();await tick();
  ck('Edit opens the failed message inline',B.q('ai-request-edit-input')?.value==='Weight 285 kg');
  await type(B.w,B.q('ai-request-edit-input'),'Weight 82.5 kg');
  B.q('ai-request-edit-cancel').click();await tick();
  ck('Cancel editing leaves the newer composer draft intact',B.q('composer-input').value==='A separate newer message');
  B.q('ai-request-edit').click();await tick();await type(B.w,B.q('ai-request-edit-input'),'Weight 82.5 kg');
  let gate=deferred();B.w.__apiHandler=e=>e.url==='/ai-chat/parse'?gate.promise:Promise.resolve({data:[]});
  const editSend=B.q('ai-request-edit-send');editSend.click();editSend.click();await tick();
  ck('edited retry sends the corrected message only once',requests(B,'/ai-chat/parse').length===2&&requests(B,'/ai-chat/parse')[1].body.message==='Weight 82.5 kg');
  gate.resolve(parsed('Edited preview'));await until(()=>B.w.__chat.getState().messages.some(m=>m.parsed),'edited review');
  ck('edited retry also leaves the composer draft intact',B.q('composer-input').value==='A separate newer message');
 }finally{B.close()}
}

async function photoCases(code){
 const A=mount(code);await until(()=>A.q('ai-camera-input'),'camera input');
 try{
  let gate=deferred();A.w.__apiHandler=e=>e.url==='/ai-chat/photo'?gate.promise:Promise.resolve({data:[]});
  A.w.__chat.getState().openChat('photo');
  ck('Snap invokes the camera input from the opening tap',A.w.__pickerClicks===1&&A.w.__lastPicker===A.q('ai-camera-input'));
  ck('camera input requests the rear camera',A.q('ai-camera-input').getAttribute('capture')==='environment');
  const input=A.q('ai-camera-input');Object.defineProperty(input,'files',{configurable:true,value:[new A.w.File(['photo'],'meal.jpg',{type:'image/jpeg'})]});
  input.dispatchEvent(new A.w.Event('change',{bubbles:true}));
  await until(()=>requests(A,'/ai-chat/photo').length===1,'photo request');
  const original=JSON.stringify(requests(A,'/ai-chat/photo')[0].body);
  gate.reject(networkError());await until(()=>A.q('ai-request-retry'),'photo recovery');
  ck('failed photo retains its preview image',!!A.w.document.querySelector('img[src^="data:image/jpeg"]'));
  ck('failed photo offers Replace photo',!!A.q('ai-request-replace'));
  await type(A.w,A.q('composer-input'),'Keep this typed draft');
  gate=deferred();A.q('ai-request-retry').click();A.q('ai-request-retry')?.click();await until(()=>requests(A,'/ai-chat/photo').length===2,'photo retry');
  ck('photo Retry uploads the same image and meal slots',JSON.stringify(requests(A,'/ai-chat/photo')[1].body)===original);
  ck('photo Retry does not reopen the camera',A.w.__pickerClicks===1);
  gate.resolve({data:{reply:'Check the estimated portion',foods:[{name:'Oats',grams:100,meal:'Breakfast',per_100g:{calories:374,protein:13,total_carbs:60,fat:8},macros:{cal:374,pro:13,carb:60,fat:8}}]}});
  await until(()=>A.q('chat-edit-macros'),'food review');
  ck('photo Retry produces one food review, no duplicate upload',requests(A,'/ai-chat/photo').length===2&&A.w.__chat.getState().messages.filter(m=>m.parsed).length===1);
  ck('photo Retry keeps the typed draft',A.q('composer-input').value==='Keep this typed draft');
  ck('photo review still provides editable macros',!!A.q('chat-edit-macros'));
  ck('photo review does not save food automatically',A.w.__log.getState().log.food.length===0&&A.w.__calls.every(e=>e.method==='get'||!/^\/logs\//.test(e.url)));
 }finally{A.close()}
 const B=mount(code);await until(()=>B.q('ai-camera-input'),'replace camera');
 try{
  B.w.__apiHandler=e=>e.url==='/ai-chat/photo'?Promise.reject(networkError()):Promise.resolve({data:[]});
  const input=B.q('ai-camera-input');input.click();Object.defineProperty(input,'files',{value:[new B.w.File(['photo'],'meal.jpg',{type:'image/jpeg'})]});input.dispatchEvent(new B.w.Event('change',{bubbles:true}));
  await until(()=>B.q('ai-request-replace'),'replace action');B.q('ai-request-replace').click();
  ck('Replace photo opens the camera in that same click',B.w.__pickerClicks===2&&B.w.__lastPicker.getAttribute('capture')==='environment');
 }finally{B.close()}
}

async function staleCases(code){
 for(const source of ['text','photo'])for(const boundary of ['account','session','day','day-return','chat-day','clear']){
  const A=mount(code);await until(()=>A.q('composer-input'),'stale fixture');
  try{
   const gate=deferred();const url=source==='text'?'/ai-chat/parse':'/ai-chat/photo';A.w.__apiHandler=e=>e.url===url?gate.promise:Promise.resolve({data:[]});
   if(source==='text')await send(A,'Weight 82.5');else{const input=A.q('ai-camera-input');input.click();Object.defineProperty(input,'files',{value:[new A.w.File(['x'],'meal.jpg',{type:'image/jpeg'})]});input.dispatchEvent(new A.w.Event('change',{bubbles:true}));}
   await until(()=>requests(A,url).length===1,'stale request');
   if(boundary==='account')A.w.__auth.setState({user:{id:999,name:'Other member',role:'patient'}});
   if(boundary==='session')A.w.__auth.setState(s=>({sessionVersion:(s.sessionVersion||0)+1}));
   if(boundary==='day')A.w.__log.setState({date:'2000-01-01'});
   if(boundary==='day-return'){A.w.__log.setState({date:'2000-01-01'});A.w.__log.setState({date:A.w.__today})}
   if(boundary==='chat-day')A.w.__chat.getState().ensureFreshDay('2000-01-01');
   if(boundary==='clear')A.w.__chat.getState().resetChat();
   gate.resolve(parsed('STALE_REPLY_MUST_NOT_APPEAR'));await tick(100);
   ck(`${source}: ${boundary} boundary drops late AI result`,!A.w.__chat.getState().messages.some(m=>m.text==='STALE_REPLY_MUST_NOT_APPEAR'));
   ck(`${source}: ${boundary} boundary cannot create a log save`,A.w.__calls.every(e=>e.method==='get'||!/^\/logs\//.test(e.url)));
  }finally{A.close()}
 }
}

async function voiceCases(code,composerCode,chatCode){
 const A=mount(code);await until(()=>A.w.__voice,'voice hook');
 try{
  A.w.__settings.getState().setVoiceLang('kn-IN');await tick();
  let gate=deferred();A.w.__apiHandler=e=>e.url==='/ai-chat/voice-transcribe'?gate.promise:Promise.resolve({data:[]});
  A.w.__voice.start();A.w.__voice.start();await until(()=>A.w.__voice.listening,'recording');
  ck('repeated voice starts request microphone only once',A.w.__micRequests===1&&A.w.__recorderStarts===1);
  A.w.__settings.getState().setVoiceLang('hi-IN');await tick();A.w.__voice.stop();
  await until(()=>requests(A,'/ai-chat/voice-transcribe').length===1,'transcription');
  const original=JSON.stringify(requests(A,'/ai-chat/voice-transcribe')[0].body);
  ck('take retains the language selected when recording began',requests(A,'/ai-chat/voice-transcribe')[0].body.langHint==='kn-IN');
  gate.reject(networkError());await until(()=>A.w.__voice.canRetry,'retained audio');
  ck('failed transcription retains a retryable take',A.w.__voice.canRetry&&A.w.__final.length===0);
  ck('microphone tracks stop when the recording ends',A.w.__stoppedTracks===1);
  gate=deferred();A.w.__voice.retry();A.w.__voice.retry();await until(()=>requests(A,'/ai-chat/voice-transcribe').length===2,'retry transcription');
  ck('audio retry sends the exact retained bytes and original language',JSON.stringify(requests(A,'/ai-chat/voice-transcribe')[1].body)===original);
  ck('audio retry neither records again nor creates duplicate requests',A.w.__micRequests===1&&requests(A,'/ai-chat/voice-transcribe').length===2);
  gate.resolve({data:{transcript:'ಎರಡು ಇಡ್ಲಿ'}});await until(()=>A.w.__final.length===1,'retried words');
  ck('retried transcript reaches the consumer once',A.w.__final[0]==='ಎರಡು ಇಡ್ಲಿ');
  ck('successful retry releases the retained take',!A.w.__voice.canRetry&&!A.w.__voice.transcribing);
  // Fixes-2n (B18): the server refused the fallback answer (wrong language): nothing reaches the
  // consumer (no preview, nothing to save), the take is kept for Retry, and the member is told why.
  gate=deferred();A.w.__voice.start();await until(()=>A.w.__voice.listening,'recording again');A.w.__voice.stop();
  await until(()=>requests(A,'/ai-chat/voice-transcribe').length===3,'third transcription');
  gate.resolve({data:{transcript:'',rejected:'wrong_script',message:'x'}});await until(()=>A.w.__voice.canRetry,'refused take kept');
  ck('2n: a refused fallback answer reaches no consumer and keeps the take for Retry',A.w.__final.length===1&&A.w.__voice.canRetry&&!A.w.__voice.transcribing);
  ck('2n: …and says it came back in a different language, with Retry, voice language or typing as the way out',/different language from the one you chose/.test(A.w.__voice.error||'')&&/Retry/.test(A.w.__voice.error)&&/type your log/.test(A.w.__voice.error),A.w.__voice.error);
 }finally{A.close()}
 for(const boundary of ['discard','account','session','context','midnight','unmount']){
  const B=mount(code);await until(()=>B.w.__voice,'voice boundary');
  try{
   let gate=deferred();B.w.__apiHandler=e=>e.url==='/ai-chat/voice-transcribe'?gate.promise:Promise.resolve({data:[]});
   B.w.__voice.start();await until(()=>B.w.__voice.listening,'voice start');B.w.__voice.stop();await until(()=>requests(B,'/ai-chat/voice-transcribe').length===1,'voice upload');
   if(boundary==='discard')B.w.__voice.discardTake();
   if(boundary==='account')B.w.__auth.setState({user:{id:999,role:'patient'}});
   if(boundary==='session')B.w.__auth.setState(s=>({sessionVersion:(s.sessionVersion||0)+1}));
   if(boundary==='context'){B.w.__setVoiceContext('second');await tick()}
   if(boundary==='midnight'){const NativeDate=B.w.Date;const tomorrow=NativeDate.now()+86400000;B.w.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[tomorrow]))}static now(){return tomorrow}}}
   if(boundary==='unmount')B.w.__root.unmount();
   gate.resolve({data:{transcript:'STALE_VOICE'}});await tick(100);
   ck(`voice ${boundary} prevents late transcript delivery`,B.w.__final.length===0);
   if(boundary!=='unmount')ck(`voice ${boundary} clears retained audio and busy state`,!B.w.__voice.canRetry&&!B.w.__voice.transcribing);
  }finally{B.close()}
 }
 const C=mount(code, {denied:true});await until(()=>C.w.__voice,'denied hook');
 try{C.w.__voice.start();await until(()=>C.w.__voice.error,'permission error');ck('denied microphone leaves a clear recoverable error',/microphone|mic/i.test(C.w.__voice.error)&&!C.w.__voice.listening&&!C.w.__voice.transcribing&&!C.w.__voice.canRetry);ck('denied permission never calls transcription',requests(C,'/ai-chat/voice-transcribe').length===0)}finally{C.close()}
 const D=mount(chatCode,{recorder:false});await until(()=>D.q('composer-input'),'unsupported composer');
 try{D.w.__chat.getState().openChat('voice');await tick();ck('unsupported voice keeps typing available',!!D.q('composer-input')&&!D.q('composer-input').disabled);ck('unsupported voice leaves camera available',!!D.w.document.querySelector('[aria-label="Open camera"]'));ck('unsupported voice makes no upload request',requests(D,'/ai-chat/voice-transcribe').length===0)}finally{D.close()}
 const E=mount(composerCode);await until(()=>E.w.__composer,'voice composer');
 try{
  E.w.__apiHandler=e=>e.url==='/ai-chat/voice-transcribe'?Promise.reject(networkError()):Promise.resolve({data:[]});
  E.w.__composer.startRecording();await until(()=>E.w.document.querySelector('[aria-label="Stop recording"]'),'composer recording');
  E.w.document.querySelector('[aria-label="Stop recording"]').click();await until(()=>E.q('voice-retry'),'voice Retry UI');
  ck('failed take displays Retry and Discard take',!!E.q('voice-retry')&&!!E.q('voice-discard-take'));
  ck('voice card exposes all three language options',E.q('voice-language')?.options.length===3);
  E.q('voice-discard-take').click();await tick();
  ck('Discard take removes retryable audio without sending',!E.q('voice-retry')&&E.w.__sent.length===0);
 }finally{E.close()}
 const F=mount(chatCode);await until(()=>F.q('composer-input'),'one tap Speak');
 try{F.w.__chat.getState().openChat('voice');ck('Speak requests the microphone in the opening tap',F.w.__micRequests===1);await until(()=>F.w.__recorderStarts===1,'one tap recording');ck('Speak needs no second mic tap to start recording',F.w.__recorderStarts===1)}finally{F.close()}
}

async function voiceDraftCases(chatCode,composerCode,foodCode){
 const A=mount(chatCode);await until(()=>A.q('composer-input'),'busy chat');
 try{
  const gate=deferred();A.w.__apiHandler=e=>e.url==='/ai-chat/parse'?gate.promise:e.url==='/ai-chat/voice-transcribe'?Promise.resolve({data:{transcript:'Walked for 30 minutes'}}):Promise.resolve({data:[]});
  await send(A,'Weight 82.5 kg');await type(A.w,A.q('composer-input'),'Keep my typed note');
  A.w.__chat.getState().openChat('voice');await until(()=>A.w.document.querySelector('[aria-label="Stop recording"]'),'busy voice');
  A.w.document.querySelector('[aria-label="Stop recording"]').click();
  await until(()=>A.q('composer-input')?.value.includes('Walked for 30 minutes'),'voice preserved while parse busy');
  ck('voice finished during an active parse preserves both new drafts',A.q('composer-input').value.includes('Keep my typed note')&&A.q('composer-input').value.includes('Walked for 30 minutes'));
  ck('voice finished during active parse does not launch duplicate parse',requests(A,'/ai-chat/parse').length===1);
  gate.resolve(parsed());await until(()=>A.w.__chat.getState().messages.some(m=>m.parsed),'busy parse finishes');
  ck('original parse completion does not clear buffered speech or text',A.q('composer-input').value.includes('Keep my typed note')&&A.q('composer-input').value.includes('Walked for 30 minutes'));
 }finally{A.close()}
 const B=mount(composerCode);await until(()=>B.w.__composer,'editable audio');
 try{
  B.w.__apiHandler=e=>e.url==='/ai-chat/voice-transcribe'?Promise.reject(networkError()):Promise.resolve({data:[]});
  B.w.__composer.startRecording();await until(()=>B.w.document.querySelector('[aria-label="Stop recording"]'),'edit recording');
  B.w.document.querySelector('[aria-label="Stop recording"]').click();await until(()=>B.q('voice-retry'),'edit audio retry');
  const gate=deferred();B.w.__apiHandler=e=>e.url==='/ai-chat/voice-transcribe'?gate.promise:Promise.resolve({data:[]});
  B.q('voice-retry').click();await until(()=>requests(B,'/ai-chat/voice-transcribe').length===2,'editing retry begins');
  const textarea=B.q('voice-composer').querySelector('textarea');await type(B.w,textarea,'My corrected food description');
  gate.resolve({data:{transcript:'A late transcription'}});await tick(100);
  ck('manual voice-card edits win over a late retry transcript',textarea.value==='My corrected food description');
  ck('late retry cannot auto-send an edited voice draft',B.w.__sent.length===0);
 }finally{B.close()}
 const C=mount(foodCode);await until(()=>C.w.document.body.textContent.includes('Add food item'),'FoodLog');
 try{
  [...C.w.document.querySelectorAll('button')].find(b=>b.textContent.includes('Add food item')).click();
  await until(()=>C.w.document.querySelector('[aria-label="Speak food name"]'),'food mic');
  C.w.__apiHandler=e=>e.url==='/ai-chat/voice-transcribe'?Promise.reject(networkError()):Promise.resolve({data:[]});
  C.w.document.querySelector('[aria-label="Speak food name"]').click();await until(()=>C.w.document.querySelector('[aria-label="Stop food recording"]'),'food recording');
  C.w.document.querySelector('[aria-label="Stop food recording"]').click();await until(()=>C.q('food-voice-retry'),'food recovery');
  ck('manual FoodLog exposes recovery after failed transcription',!!C.q('food-voice-retry')&&!!C.q('food-voice-discard'));
  C.w.__apiHandler=e=>e.url==='/ai-chat/voice-transcribe'?Promise.resolve({data:{transcript:'Paneer bhurji'}}):Promise.resolve({data:[]});
  C.q('food-voice-retry').click();await until(()=>C.w.document.querySelector('input[placeholder="Food name…"]').value==='Paneer bhurji','food retried words');
  ck('FoodLog retry fills the actual food search field',C.w.document.querySelector('input[placeholder="Food name…"]').value==='Paneer bhurji');
  ck('FoodLog retry does not reopen the microphone or add food automatically',C.w.__micRequests===1&&C.w.__foodChanges.length===0);
  C.w.__apiHandler=e=>e.url==='/ai-chat/voice-transcribe'?Promise.reject(networkError()):Promise.resolve({data:[]});
  C.w.document.querySelector('[aria-label="Speak food name"]').click();await until(()=>C.w.document.querySelector('[aria-label="Stop food recording"]'),'second food recording');
  C.w.document.querySelector('[aria-label="Stop food recording"]').click();await until(()=>C.q('food-voice-discard'),'second food recovery');
  C.q('food-voice-discard').click();await tick();C.w.document.querySelector('[aria-label="Speak food name"]').click();await until(()=>C.w.__recorderStarts===3,'food re-record');
  ck('FoodLog discard allows recording another take',C.w.__recorderStarts===3);
  const gate=deferred();C.w.__apiHandler=e=>e.url==='/ai-chat/voice-transcribe'?gate.promise:Promise.resolve({data:[]});
  C.w.document.querySelector('[aria-label="Stop food recording"]').click();await until(()=>requests(C,'/ai-chat/voice-transcribe').length===4,'third food upload');
  const field=C.w.document.querySelector('input[placeholder="Food name…"]');await type(C.w,field,'Manual corrected food');gate.resolve({data:{transcript:'Stale food words'}});await tick(100);
  ck('manual FoodLog typing invalidates pending transcription',field.value==='Manual corrected food');
  ck('manual FoodLog recovery mounts without runtime errors',C.errors.length===0,C.errors);
 }finally{C.close()}
}

async function boundedPhotoCases(code){
 const A=mount(code);await until(()=>A.q('ai-camera-input'),'bounded photos');
 try{
  A.w.__apiHandler=e=>e.url==='/ai-chat/photo'?Promise.reject(networkError()):Promise.resolve({data:[]});
  const input=A.q('ai-camera-input');
  for(let i=0;i<4;i++){
   input.click();Object.defineProperty(input,'files',{configurable:true,value:[new A.w.File(['photo'+i],`meal-${i}.jpg`,{type:'image/jpeg'})]});input.dispatchEvent(new A.w.Event('change',{bubbles:true}));
   await until(()=>requests(A,'/ai-chat/photo').length===i+1,'bounded photo upload');await until(()=>A.w.__chat.getState().messages.filter(m=>m.error).length===i+1,'bounded photo fail');
  }
  ck('only three latest failed photo requests retain retry data',A.w.__chat.getState().messages.filter(m=>m.failedRequest?.kind==='photo').length===3);
  ck('old failed photo explains why it needs attaching again',A.w.document.body.textContent.includes('three latest failed photos'));
  A.w.__chat.getState().resetChat();await tick();A.w.__chat.getState().openChat('text');await until(()=>A.q('ai-camera-input'),'fresh camera');
  const oversized=new A.w.File(['x'],'large.jpg',{type:'image/jpeg'});Object.defineProperty(oversized,'size',{value:21*1024*1024});
  const next=A.q('ai-camera-input');next.click();Object.defineProperty(next,'files',{value:[oversized]});next.dispatchEvent(new A.w.Event('change',{bubbles:true}));
  await until(()=>A.q('ai-request-replace'),'oversized replace');
  ck('oversized photo gives Replace without a futile Retry',!A.q('ai-request-retry')&&!!A.q('ai-request-replace'));
  ck('oversized photo is rejected before upload',requests(A,'/ai-chat/photo').length===4);
  ck('oversized file bytes are not retained in retry memory',A.w.__chat.getState().messages.filter(m=>m.failedRequest).every(m=>!m.failedRequest.file&&!m.failedRequest.payload));
 }finally{A.close()}
}

async function pickerCases(code){
 for(const boundary of ['account','session','day-return','clear']){
  const A=mount(code);await until(()=>A.q('ai-camera-input'),'picker fixture');
  try{
   const input=A.q('ai-camera-input');input.click();
   if(boundary==='account')A.w.__auth.setState({user:{id:999,role:'patient'}});
   if(boundary==='session')A.w.__auth.setState(s=>({sessionVersion:(s.sessionVersion||0)+1}));
   if(boundary==='day-return'){A.w.__log.setState({date:'2000-01-01'});A.w.__log.setState({date:A.w.__today})}
   if(boundary==='clear')A.w.__chat.getState().resetChat();
   Object.defineProperty(input,'files',{value:[new A.w.File(['stale-photo'],'old.jpg',{type:'image/jpeg'})]});input.dispatchEvent(new A.w.Event('change',{bubbles:true}));await tick(100);
   ck(`camera picker ${boundary} never submits a photo for changed context`,requests(A,'/ai-chat/photo').length===0);
   ck(`camera picker ${boundary} never introduces an old photo bubble`,!A.w.__chat.getState().messages.some(m=>m.photoPreview||m.requestId));
  }finally{A.close()}
 }
}

async function lateRecognitionCases(composerCode){
 const A=mount(composerCode,{},w=>{
  w.SpeechRecognition=class{constructor(){w.__recognition=this}start(){}stop(){}abort(){}addEventListener(){}removeEventListener(){}};
 });await until(()=>A.w.__composer,'recognition composer');
 try{
  A.w.__composer.startRecording();await until(()=>A.w.document.querySelector('[aria-label="Stop recording"]'),'recognition start');
  A.w.__recognition.onresult({results:[Object.assign([{transcript:'two roti'}],{isFinal:true})]});await tick();
  A.w.document.querySelector('[aria-label="Stop recording"]').click();await tick();
  const textarea=A.q('voice-composer').querySelector('textarea');await type(A.w,textarea,'My edited roti quantity');
  A.w.__recognition.onresult?.({results:[Object.assign([{transcript:'late old words'}],{isFinal:true})]});
  ck('late on-device interim cannot overwrite edits during stop flush',textarea.value==='My edited roti quantity');
  await tick(450);
  ck('late on-device final cannot overwrite edits during stop flush',textarea.value==='My edited roti quantity'&&A.w.__sent.length===0);
 }finally{A.close()}
}

async function consumerCases(workoutCode,coachCode){
 const workoutRow=(A,name)=>[...A.w.document.querySelectorAll('span')].find(e=>e.textContent===name)?.closest('div.border');
 const A=mount(workoutCode,{},w=>{w.__apiHandler=e=>Promise.resolve({data:e.url==='/workouts'&&e.method==='get'?{session:null,exercises:[{exercise_id:101,exercise_name:'Exercise A',sets:[]},{exercise_id:102,exercise_name:'Exercise B',sets:[]}],cardio:[]}:e.url==='/programs/active'?{program:null,days:[]}:[]})});
 await until(()=>workoutRow(A,'Exercise B'),'loaded workout exercises');
 try{
  ck('workout exercise rows do not render language selectors',!workoutRow(A,'Exercise A').querySelector('select')&&!workoutRow(A,'Exercise B').querySelector('select'));
  const ready=A.q('voice-language-ready');
  if(ready){ready.value='kn-IN';ready.dispatchEvent(new A.w.Event('change',{bubbles:true}));await tick()}
  ck('changing the ready language does not start a workout recording',!!ready&&A.w.__micRequests===0&&A.w.__settings.getState().voiceLang==='kn-IN');
  A.w.__apiHandler=e=>e.url==='/ai-chat/voice-transcribe'?Promise.reject(networkError()):Promise.resolve({data:[]});
  workoutRow(A,'Exercise A').querySelector('[aria-label="Speak your log"]').click();
  await until(()=>workoutRow(A,'Exercise A').querySelector('[aria-label="Stop recording"]'),'exercise A recording');
  workoutRow(A,'Exercise A').querySelector('[aria-label="Stop recording"]').click();
  await until(()=>A.q('voice-retry'),'exercise A failed take');
  const before=A.w.__micRequests;
  workoutRow(A,'Exercise B').querySelector('button[aria-label="Speak your log"]').click();await tick();
  ck('attempting another exercise keeps the retained take and microphone closed',A.w.__micRequests===before&&!!A.q('voice-retry'));
  const language=A.q('voice-language');language.value='hi-IN';language.dispatchEvent(new A.w.Event('change',{bubbles:true}));await tick();
  ck('changing a retained take language neither records nor retargets an exercise',A.w.__micRequests===before&&workoutRow(A,'Exercise B').querySelectorAll('input[type="number"]').length===0);
  A.w.__apiHandler=e=>e.url==='/ai-chat/voice-transcribe'?Promise.resolve({data:{transcript:'60 kg 8 reps'}}):Promise.resolve({data:[]});
  A.q('voice-retry').click();
  await until(()=>workoutRow(A,'Exercise A').querySelectorAll('input[type="number"]').length===2,'retried set reaches A');
  const inputs=[...workoutRow(A,'Exercise A').querySelectorAll('input[type="number"]')];
  ck('retry fills the original exercise with 60 kg and 8 reps',inputs[0].value==='60'&&inputs[1].value==='8');
  ck('retry cannot move or duplicate the set on the second exercise',workoutRow(A,'Exercise B').querySelectorAll('input[type="number"]').length===0);
  ck('workout retry preserves the original take language despite a later choice',requests(A,'/ai-chat/voice-transcribe').length===2&&requests(A,'/ai-chat/voice-transcribe').every(e=>e.body.langHint==='kn-IN'));
  ck('workout consumer mounts without runtime errors',A.errors.length===0,A.errors);
 }finally{A.close()}
 for(const boundary of ['close','member switch']){
  const B=mount(coachCode,{},w=>{w.HTMLElement.prototype.scrollIntoView=()=>{}});
  await until(()=>B.w.document.querySelector('[aria-label="Speak your log"]'),'coach voice');
  try{
   const gate=deferred();B.w.__apiHandler=e=>e.url==='/ai-chat/voice-transcribe'?gate.promise:Promise.resolve({data:[]});
   B.w.document.querySelector('[aria-label="Speak your log"]').click();await until(()=>B.w.document.querySelector('[aria-label="Stop recording"]'),'coach recording');
   B.w.document.querySelector('[aria-label="Stop recording"]').click();await until(()=>requests(B,'/ai-chat/voice-transcribe').length===1,'coach transcription');
   if(boundary==='close')B.w.__coach.getState().closeChat();else B.w.__setContextMember({id:215,name:'Member B'});
   await tick();gate.resolve({data:{transcript:'Set water target to 4 litres'}});await tick(100);
   ck(`coach ${boundary} drops late speech before any coach parse`,requests(B,'/ai-chat/coach-parse').length===0);
   ck(`coach ${boundary} clears the stale voice card`,!B.q('voice-composer')&&!B.q('voice-retry'));
   if(boundary==='close'){B.w.__coach.getState().openChat();await tick();ck('reopening coach chat does not restore a late voice take',!B.q('voice-retry')&&!B.q('voice-composer'))}
   ck(`coach ${boundary} mounts without runtime errors`,B.errors.length===0,B.errors);
  }finally{B.close()}
 }
 const C=mount(coachCode,{},w=>{w.HTMLElement.prototype.scrollIntoView=()=>{}});
 await until(()=>C.w.document.querySelector('[aria-label="Speak your log"]'),'coach failed take');
 try{
  C.w.__apiHandler=e=>e.url==='/ai-chat/voice-transcribe'?Promise.reject(networkError()):Promise.resolve({data:[]});
  C.w.document.querySelector('[aria-label="Speak your log"]').click();await until(()=>C.w.document.querySelector('[aria-label="Stop recording"]'),'coach retry recording');
  C.w.document.querySelector('[aria-label="Stop recording"]').click();await until(()=>C.q('voice-retry'),'coach retry visible');
  ck('coach failed recording exposes a retry while the original chat is open',!!C.q('voice-retry'));
  C.w.__coach.getState().closeChat();await tick();C.w.__coach.getState().openChat();await tick();
  ck('closing then reopening coach chat discards stale Retry and recording',!C.q('voice-retry')&&!C.q('voice-composer'));
  ck('coach close/reopen does not send or parse the abandoned recording',requests(C,'/ai-chat/coach-parse').length===0&&requests(C,'/ai-chat/voice-transcribe').length===1);
  ck('coach microphone is available again after closing a failed take',!C.w.document.querySelector('[aria-label="Speak your log"]')?.disabled);
 }finally{C.close()}
}

async function browserCases(chatCode,composerCode){
 const puppeteer=(await import('puppeteer-core')).default;
 const chromium=(await import('@sparticuz/chromium')).default;
 const css=readBuiltCss(path.join(ROOT,'client/dist'));
 const browser=await puppeteer.launch({executablePath:await browserExecutable(chromium),args:[...chromium.args,'--no-sandbox'],headless:true});
 try{
  const dir=path.join(ROOT,'qa/results/phase2-screenshots');fs.mkdirSync(dir,{recursive:true});
  for(const theme of ['light','dark'])for(const width of [320,390])for(const large of [false,true]){
   const page=await browser.newPage();await page.setViewport({width,height:844,deviceScaleFactor:1});
   try{
    await page.setContent(`<!doctype html><html data-theme="${theme}" data-fontsize="${large?'large':'normal'}"><head><style>${css}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({content:`(${fixture.toString()})(window);`});
    await page.evaluate(()=>{window.__apiHandler=async e=>{if(e.url==='/ai-chat/voice-transcribe')throw new Error('fixture failure');return{data:[]}}});
    // Synthetic recorder exercises the actual failed-take UI without accessing hardware.
    await page.addScriptTag({content:composerCode});await page.waitForFunction(()=>!!window.__composer);
    await page.evaluate(()=>window.__composer.startRecording());await page.waitForSelector('[aria-label="Stop recording"]');
    await page.click('[aria-label="Stop recording"]');await page.waitForSelector('[data-testid="voice-retry"]');
    const voiceLayout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth,select:document.querySelector('[data-testid="voice-language"]')?.getBoundingClientRect().right}));
    ck(`voice card ${theme} ${width}px ${large?'large':'normal'} text fits`,voiceLayout.scroll<=width+1&&voiceLayout.body<=width+1&&voiceLayout.select<=width,JSON.stringify(voiceLayout));
    const voiceActions=await page.evaluate(()=>[...document.querySelectorAll('[data-testid="voice-recovery"] button')].map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,height:e.getBoundingClientRect().height})));
    ck(`voice retry actions ${theme} ${width}px ${large?'large':'normal'} fit and remain touchable`,voiceActions.length===2&&voiceActions.every(r=>r.left>=0&&r.right<=width+1&&r.height>=44),JSON.stringify(voiceActions));
    if(large)await page.screenshot({path:path.join(dir,`voice-${theme}-${width}-large.png`),fullPage:true});
    await page.evaluate(()=>window.__root.unmount());
    await page.addScriptTag({content:chatCode});await page.waitForSelector('[data-testid="composer-input"]');
    await page.evaluate(()=>{window.__apiHandler=async e=>{if(e.url==='/ai-chat/parse')throw new Error('fixture failure');return{data:[]}};window.__chat.getState().setInput('Had two idli and a bowl of sambar after my morning walk')});
    await page.click('button[aria-label="Send"]');await page.waitForSelector('[data-testid="ai-request-retry"]');
    await page.click('[data-testid="ai-request-edit"]');await page.waitForSelector('[data-testid="ai-request-edit-input"]');
    const layout=await page.evaluate(()=>{const els=[...document.querySelectorAll('[data-testid="ai-request-error"] button,[data-testid="ai-request-edit-input"]')];return{scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth,rects:els.map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,height:e.getBoundingClientRect().height}))}});
    ck(`request recovery ${theme} ${width}px ${large?'large':'normal'} text fits`,layout.scroll<=width+1&&layout.body<=width+1&&layout.rects.every(r=>r.left>=0&&r.right<=width+1),JSON.stringify(layout));
    ck(`request actions ${theme} ${width}px ${large?'large':'normal'} remain touchable`,layout.rects.length>1&&layout.rects.every(r=>r.height>=44),JSON.stringify(layout));
    if(large)await page.screenshot({path:path.join(dir,`retry-${theme}-${width}-large.png`),fullPage:true});
    if(width===390&&!large)await page.screenshot({path:path.join(dir,`FitLife-Phase2-${theme}.jpeg`),type:'jpeg',quality:92,fullPage:true});
   }finally{await page.close()}
  }
 }finally{await browser.close()}
}

try{
 const [chatCode,voiceCode,composerCode,settingsCode,foodCode,workoutCode,coachCode]=await Promise.all([bundle(CHAT),bundle(VOICE),bundle(COMPOSER),bundle(SETTINGS),bundle(FOOD),bundle(WORKOUT),bundle(COACH)]);
 await section('Language persistence and Settings',()=>languageCases(settingsCode));
 await section('Text Retry and Edit preserve member work',()=>textCases(chatCode));
 await section('Photo Retry and one-tap camera',()=>photoCases(chatCode));
 await section('Photo retention remains bounded',()=>boundedPhotoCases(chatCode));
 await section('Native picker ownership boundaries',()=>pickerCases(chatCode));
 await section('Late parse/photo replies never cross boundaries',()=>staleCases(chatCode));
 await section('Voice take retry, discard and capture fallback',()=>voiceCases(voiceCode,composerCode,chatCode));
 await section('Voice edits, busy parser and manual FoodLog recovery',()=>voiceDraftCases(chatCode,composerCode,foodCode));
 await section('Recognition stop-flush edits',()=>lateRecognitionCases(composerCode));
 await section('Workout and coach voice consumers',()=>consumerCases(workoutCode,coachCode));
 if(!process.env.PHASE2_SKIP_BROWSER)await section('Chromium light/dark mobile layout',()=>browserCases(chatCode,composerCode));
} catch(e){ck('phase2 suite setup',false,e.stack)}
finally{fs.rmSync(TMP,{recursive:true,force:true});}
console.log(`\ntest-logging-phase2: ${pass} passed, ${fail} failed`);
if(process.env.PHASE2_RESULTS){fs.mkdirSync(path.dirname(process.env.PHASE2_RESULTS),{recursive:true});fs.writeFileSync(process.env.PHASE2_RESULTS,JSON.stringify({pass,fail,checks},null,2))}
process.exitCode=fail?1:0;
