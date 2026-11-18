/** Per-card AI Save/Edit/Undo regression. Executes the mounted component and
 * real logStore/offline-save implementation against synthetic API storage.
 * No live member, database, physical media or external provider is contacted.
 */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'fitlife-save-receipts-'));
let pass=0,fail=0;const checks=[];
const copy=value=>JSON.parse(JSON.stringify(value));
function ck(name,ok,detail=''){checks.push({name,status:ok?'Pass':'Fail',detail:ok?'':String(detail)});console.log(`  ${ok?'✓':'✗'} ${name}${ok||!detail?'':': '+String(detail).slice(0,220)}`);ok?pass++:fail++}
const tick=(ms=25)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label,ms=4000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await tick()}throw new Error('Timed out: '+label)}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const rejected=(status=422)=>Object.assign(new Error('Synthetic request rejection'),{response:{status,data:{error:'Synthetic validation rejected'}}});
const ambiguous=()=>Object.assign(new Error('Synthetic acknowledgement lost'),{code:'ECONNABORTED'});
const API=path.join(TMP,'api.js');
fs.writeFileSync(API,`const call=async(method,url,body,opts)=>window.__api({method,url,body,opts});export default Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(url,body,opts)=>call(method,url,body,opts)]));`);
async function bundle(){return(await build({stdin:{resolveDir:path.join(ROOT,'client/src'),loader:'jsx',contents:`
 import {createRoot} from 'react-dom/client';
 import AIChatLog from './components/AIChatLog';
 import {useAuthStore} from './store/authStore';import {useLogStore} from './store/logStore';import {useAIChat} from './store/aiChatStore';
 import {today,emptyLog} from './constants';import * as receiptUtils from './utils/aiSaveReceipt';window.__receiptUtils=receiptUtils;
 useAuthStore.setState({user:{id:214,name:'Receipt Fixture',role:'patient'},isRestoring:false});
 useLogStore.setState({date:today(),log:{...emptyLog(),...(window.__initialLog||{})},protocol:{activities:[],acv:[],supplements:[]},loading:false,error:null});
 window.__auth=useAuthStore;window.__log=useLogStore;window.__chat=useAIChat;window.__today=today();
 window.__mount=()=>{window.__root=createRoot(document.getElementById('root'));window.__root.render(<AIChatLog overlay/>);useAIChat.getState().ensureFreshDay(today());useAIChat.getState().openChat('text')};window.__mount();
 `},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.js':'jsx','.jsx':'jsx','.css':'empty'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"DEV":false,"PROD":true}'},plugins:[{name:'synthetic-api',setup(b){b.onResolve({filter:/(?:^|\/)client$/},args=>/api\/client$/.test(args.path)||args.importer.includes(`${path.sep}api${path.sep}`)?{path:API}:null)}}],logLevel:'silent'})).outputFiles[0].text}
function mount(code,initialLog={}){
 const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://fitlife-receipt-fixture.invalid/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;const errors=[];w.__initialLog=initialLog;w.__calls=[];w.__savedLogs={};w.__labs=[];w.__labReceipts={};w.__workout={session:null,exercises:[],cardio:[]};
 w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;
 w.fetch=async()=>({ok:false,status:401,json:async()=>({})});
 w.__defaultApi=async e=>{
  if(e.url==='/ai-chat/parse'||e.url==='/ai-chat/photo')return{data:copy(w.__answer)};
  if(/^\/logs\/\d{4}-\d{2}-\d{2}$/.test(e.url)){
   if(e.method==='get')return{data:copy(w.__savedLogs[e.url]||{})};
   const row={...copy(e.body),saved_at:new Date().toISOString()};w.__savedLogs[e.url]=row;return{data:copy(row)};
  }
  if(e.url==='/workouts'&&e.method==='get')return{data:copy(w.__workout)};
  if(e.url==='/workouts'&&e.method==='post'){const revision=w.__workout.session?.revision??0;if(e.body.expected_revision!==undefined&&e.body.expected_revision!==revision)throw Object.assign(new Error('Concurrent edit'),{response:{status:409,data:{code:'WORKOUT_CONFLICT'}}});w.__workout={session:{revision:revision+1,duration_min:e.body.duration_min,notes:e.body.notes},exercises:copy(e.body.exercises||[]),cardio:copy(e.body.cardio||[])};return{data:{saved:true,session_id:1}}}
  if(e.url==='/workouts/exercises'&&e.method==='get')return{data:[{id:101,name:'Squat'}]};
  if(e.url==='/workouts/exercises'&&e.method==='post')return{data:{id:101,name:e.body.name}};
  if(e.url==='/members/me/labs'&&e.method==='post'){if(e.body.request_id&&w.__labReceipts[e.body.request_id])return{data:copy(w.__labReceipts[e.body.request_id])};const rows=(e.body.results||[]).map((row,i)=>({...copy(row),id:w.__labs.length+i+1}));w.__labs.push(...rows);const data={saved:rows.length,results:rows};if(e.body.request_id)w.__labReceipts[e.body.request_id]=copy(data);return{data}}
  return{data:e.method==='get'?[]:{ok:true}};
 };
 w.__api=async e=>{w.__calls.push({...e,body:e.body===undefined?undefined:copy(e.body)});if(w.__intercept){const r=await w.__intercept(e);if(r!==undefined)return r}return w.__defaultApi(e)};
 w.addEventListener('error',e=>errors.push(e.message));w.eval(code);
 return{w,errors,q:id=>w.document.querySelector(`[data-testid="${id}"]`),close(){w.__root?.unmount();w.close()}};
}
const writes=(A,url)=>A.w.__calls.filter(e=>e.method!=='get'&&(typeof url==='string'?e.url===url:url.test(e.url)));
const daily=A=>writes(A,/^\/logs\/\d{4}-\d{2}-\d{2}$/);
const log=A=>A.w.__log.getState().log;
const messages=A=>A.w.__chat.getState().messages;
const card=(A,index)=>A.w.document.querySelector(`[data-testid="ai-review-card"][data-review-index="${index}"]`);
const action=(A,index,name)=>card(A,index)?.querySelector(`[data-testid="ai-card-${name}"]`);
async function type(A,node,value){if(!node)throw Error('Missing editable field');const proto=node.tagName==='TEXTAREA'?A.w.HTMLTextAreaElement.prototype:A.w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(node,value);node.dispatchEvent(new A.w.Event('input',{bubbles:true}));await tick()}
const food=(name='Oats',grams=100)=>({name,grams,meal:'Breakfast',per_100g:{calories:100,protein:10,total_carbs:10,fat:2},macros:{cal:grams,pro:grams/10,carb:grams/10,fat:grams/50}});
const answer=patch=>({reply:'Fixture entries ready',foods:[],activities:[],acv:[],supplements:[],workouts:[],corrections:[],...patch});
async function review(A,patch,text='Fixture log'){
 await until(()=>A.q('composer-input'),'AI input');A.w.__answer=answer(patch);const n=messages(A).length;
 await type(A,A.q('composer-input'),text);A.w.document.querySelector('[aria-label="Send"]').click();
 await until(()=>messages(A).length>=n+2&&messages(A).at(-1).parsed,'AI review');await tick();const index=messages(A).length-1;
 await until(()=>card(A,index),'review card');return index;
}
async function click(A,index,name){const button=action(A,index,name);if(!button)throw Error(`Missing ${name} for card ${index}: ${card(A,index)?.textContent}`);button.click();await tick(60)}
async function saved(A,index){await until(()=>!!action(A,index,'undo')&&!action(A,index,'undo').disabled,'saved receipt');await tick()}
async function quiet(A){await tick(60);await until(()=>!A.w.__log.getState().saving,'log save settled');await tick()}
async function section(label,fn){console.log('\n'+label);try{await fn()}catch(e){ck(label+' completes',false,e.stack)}}

async function receiptUtilityCases(code){
 const A=mount(code);try{
  const U=A.w.__receiptUtils;
  const original={weight:'',water:9900,activities:{walk:true},acv:{},supplements:{},sleep:{bedtime:'22:00',waketime:'06:00',quality:4},notes:'Original note',food:[{id:'old-food',name:'Rice',grams:100,meal:'Lunch',per_100g:{calories:120}}]};
  const p={foods:[{...food('Rice'),on:true}],activities:[{id:'walk',on:true}],waterOn:true,water_ml_add:500,sleepOn:true,sleep:{bedtime:'21:30'},notesOn:true,notes:'New note'};
  const oldCopy=copy(original),intentCopy=copy(p);const change=U.createDailyChange(p,original,{id:'test-card',mealSlots:['Breakfast','Lunch']});
  ck('receipt construction never mutates the original log or reviewed intent',JSON.stringify(original)===JSON.stringify(oldCopy)&&JSON.stringify(p)===JSON.stringify(intentCopy));
  ck('receipt records only the actual capped water addition',change.after.water===10000&&change.scalars.find(r=>r.field==='water')?.before===9900);
  ck('already-true protocol items do not become receipt-owned changes',!change.maps.some(r=>r.field==='activities'&&r.key==='walk'));
  const later=copy(change.after);later.sleep.quality=5;later.food.push({id:'manual-later',name:'Fruit',grams:120});later.supplements.b12=true;
  const undone=U.reverseDailyChange(later,change);const result={...later,...undone.patch};
  ck('receipt inverse restores exactly the card-owned scalar fields',undone.ok&&result.water===9900&&result.notes==='Original note');
  ck('receipt inverse preserves newer unrelated sleep quality and protocol keys',result.sleep.bedtime==='22:00'&&result.sleep.quality===5&&result.supplements.b12===true);
  ck('same-name food inverse uses identity and preserves newer manual additions',result.food.length===2&&result.food[0].id==='old-food'&&result.food[1].id==='manual-later');
  const changed=copy(change.after);changed.food.at(-1).grams=175;const conflict=U.reverseDailyChange(changed,change);
  ck('receipt inverse refuses to remove a manually edited owned food',!conflict.ok&&/newer|overlap/i.test(conflict.message));
  ck('a conflicting inverse has no partial patch to accidentally apply',conflict.patch===undefined);
  const absent={...original,activities:{}};const toggle=U.createDailyChange({activities:[{id:'walk',on:true}]},absent,{id:'toggle'});const reversed=U.reverseDailyChange(toggle.after,toggle);
  ck('Undo restores absent map keys as absent, not false placeholders',reversed.ok&&!Object.hasOwn(reversed.patch.activities,'walk'));
 }finally{A.close()}
}

async function independentCards(code){
 const A=mount(code);try{
  const a=await review(A,{foods:[food('Same food')],weight_kg:82.5},'Meal A');await click(A,a,'save');await saved(A,a);
  const firstId=log(A).food[0]?.id;const b=await review(A,{foods:[food('Same food')],water_ml_add:500},'Meal B');await click(A,b,'save');await saved(A,b);
  const secondId=log(A).food[1]?.id;
  ck('separate saves create distinct food identities even with the same name',firstId!=null&&secondId!=null&&firstId!==secondId);
  ck('separate cards each retain their own visible Undo action',!!action(A,a,'undo')&&!!action(A,b,'undo'));
  await click(A,a,'undo');await quiet(A);
  ck('Undo older A removes only A food and preserves B food identity',log(A).food.length===1&&log(A).food[0].id===secondId,JSON.stringify(log(A).food));
  ck('Undo older A restores only its weight and retains B water',log(A).weight===''&&log(A).water===500,JSON.stringify({weight:log(A).weight,water:log(A).water}));
  ck('older-card Undo writes the remaining B state to the server',daily(A).at(-1)?.body.food_items.length===1&&daily(A).at(-1).body.food_items[0].id===secondId);
  ck('Undo A does not mark B reverted or remove its Undo action',!messages(A)[b].undone&&!!action(A,b,'undo'));
  await click(A,b,'undo');await quiet(A);
  ck('B can still be undone independently after undoing A',log(A).food.length===0&&log(A).water===0);
  ck('independent card flow renders without runtime errors',A.errors.length===0,A.errors);
 }finally{A.close()}
}
async function manualEdits(code){
 const A=mount(code);try{
  const a=await review(A,{foods:[food('AI oats')]});await click(A,a,'save');await saved(A,a);
  const manual={id:'manual-other-food',name:'Manual fruit',grams:120,meal:'Snack',per_100g:{calories:80}};
  A.w.__log.getState().updateLog('food',[...log(A).food,manual]);A.w.__log.getState().updateLog('weight','79.4');await A.w.__log.getState().saveLog();
  await click(A,a,'undo');await quiet(A);
  ck('Undo preserves newer manually added food not owned by that card',log(A).food.length===1&&log(A).food[0].id===manual.id);
  ck('Undo preserves an unrelated newer manual weight',log(A).weight==='79.4');
 }finally{A.close()}
 for(const field of ['weight','food']){
  const B=mount(code);try{
   const a=await review(B,field==='weight'?{weight_kg:82.5}:{foods:[food('Edited oats')]});await click(B,a,'save');await saved(B,a);
   if(field==='weight')B.w.__log.getState().updateLog('weight','79.4');else B.w.__log.getState().updateLog('food',log(B).food.map(f=>({...f,grams:175})));
   await B.w.__log.getState().saveLog();const before=copy(log(B)),n=daily(B).length;
   await click(B,a,'undo');await quiet(B);
   ck(`Undo detects newer manual ${field} edits instead of overwriting them`,field==='weight'?log(B).weight==='79.4':log(B).food[0]?.grams===175);
   ck(`overlapping ${field} undo displays a clear conflict`,/newer|overlap|changed/i.test(card(B,a)?.textContent||''));
   ck(`overlapping ${field} conflict makes no server write`,daily(B).length===n);
  }finally{B.close()}
 }
}
async function repeatedAndEdit(code){
 const A=mount(code);try{
  const a=await review(A,{foods:[food('Editable oats')],water_ml_add:500});let gate=deferred();
  A.w.__intercept=e=>/^\/logs\//.test(e.url)&&e.method==='post'?gate.promise:undefined;
  const save=action(A,a,'save');save.click();save.click();await until(()=>daily(A).length===1,'one repeated save');
  ck('double Save begins one daily write',daily(A).length===1);
  gate.resolve(await A.w.__defaultApi(daily(A)[0]));await saved(A,a);A.w.__intercept=null;
  ck('double Save adds one food and one water contribution',log(A).food.length===1&&log(A).water===500);
  await click(A,a,'edit');await quiet(A);await until(()=>action(A,a,'save'),'editable receipt');
  ck('Edit reverses only the original contribution before reopening review',log(A).food.length===0&&log(A).water===0);
  await type(A,card(A,a).querySelector('[aria-label="Editable oats grams"]'),'150');await click(A,a,'save');await saved(A,a);
  ck('Edit then Save replaces the entry instead of duplicating it',log(A).food.length===1&&log(A).food[0].grams===150&&log(A).water===500);
  const writesBefore=daily(A).length;const undo=action(A,a,'undo');undo.click();undo.click();await quiet(A);
  ck('double Undo restores once and submits one write',daily(A).length===writesBefore+1&&log(A).food.length===0&&log(A).water===0);
 }finally{A.close()}
}
async function undoFailures(code){
 for(const kind of ['rejected','lost-ack']){
  const A=mount(code);try{
   const a=await review(A,{foods:[food('Retry oats')],water_ml_add:500});await click(A,a,'save');await saved(A,a);
   let failNext=true;A.w.__intercept=async e=>{
    if(e.method==='post'&&/^\/logs\//.test(e.url)&&failNext){failNext=false;if(kind==='lost-ack')await A.w.__defaultApi(e);throw kind==='lost-ack'?ambiguous():rejected();}
   };
   await click(A,a,'undo');await until(()=>action(A,a,'undo-retry'),'undo retry');
   ck(`${kind}: failed Undo exposes Retry instead of a completed reversal claim`,!!action(A,a,'undo-retry')&&!messages(A)[a].undone);
   const before=copy(log(A));const n=daily(A).length;await click(A,a,'undo-retry');await quiet(A);
   ck(`${kind}: Retry Undo makes one additional daily request`,daily(A).length===n+1);
   ck(`${kind}: Retry Undo never subtracts water twice or duplicates/removes other food`,log(A).water===0&&log(A).food.length===0&&before.water===0);
   ck(`${kind}: successful retry marks the intended card reverted`,messages(A)[a].undone===true);
   if(kind==='lost-ack')ck('lost-ack Undo retry preserves the original write identity',!!daily(A).at(-1).body.client_stream_id&&daily(A).at(-1).body.client_stream_id===daily(A).at(-2).body.client_stream_id&&daily(A).at(-1).body.client_sequence===daily(A).at(-2).body.client_sequence);
  }finally{A.close()}
 }
}
async function contextGuards(code){
 for(const boundary of ['day','account','session']){
  const A=mount(code);try{
   const a=await review(A,{foods:[food('Guard oats')]});await click(A,a,'save');await saved(A,a);const stale=action(A,a,'undo');const n=daily(A).length;
   if(boundary==='day')A.w.__log.setState({date:'2000-01-01',log:{...log(A),food:[{id:'past-food',name:'Past day food',grams:50}]}});
   if(boundary==='account')A.w.__auth.setState({user:{id:999,name:'Other fixture',role:'patient'}});
   if(boundary==='session')A.w.__auth.setState(s=>({sessionVersion:(s.sessionVersion||0)+1}));
   stale.click();await quiet(A);
   ck(`${boundary}: an old Undo action cannot write into the new context`,daily(A).length===n);
   if(boundary==='day')ck('old Undo keeps the selected past-day food unchanged',log(A).food[0]?.id==='past-food');
  }finally{A.close()}
 }
 const A=mount(code);try{
  const a=await review(A,{foods:[food('Delayed oats')],workouts:[{name:'Walk',duration_min:20}]});const gate=deferred();
  A.w.__intercept=e=>e.method==='post'&&/^\/logs\//.test(e.url)?gate.promise:undefined;
  await click(A,a,'save');await until(()=>daily(A).length===1,'delayed daily');A.w.__auth.setState({user:{id:999,name:'Other fixture',role:'patient'}});
  gate.resolve(await A.w.__defaultApi(daily(A)[0]));await tick(120);
  ck('account switch during Save prevents later workout writes',writes(A,'/workouts').length===0);
  ck('account switch during Save cannot resurrect the old chat receipt',messages(A).length===0);
 }finally{A.close()}
}
async function partialSaves(code){
 for(const destination of ['workout','body']){
  const A=mount(code);try{
   const patch={foods:[food('Partial oats')],water_ml_add:500,...(destination==='workout'?{workouts:[{name:'Walk',duration_min:20}]}:{body_metrics:[{name:'Body fat',value:20,unit:'%'}]})};
   let a;
   if(destination==='body'){
    a=await review(A,{foods:[food('Partial oats')],water_ml_add:500});A.w.__chat.getState().setMessages(ms=>ms.map((m,i)=>i===a?{...m,parsed:{...m.parsed,bodyMetrics:[{name:'Body fat',value:20,unit:'%'}],bodyMetricsOn:true}}:m));await tick();
   }else a=await review(A,patch);
   const url=destination==='workout'?'/workouts':'/members/me/labs';let failed=false;
   A.w.__intercept=e=>{if(e.method==='post'&&e.url===url&&!failed){failed=true;throw rejected()}};
   await click(A,a,'save');await until(()=>action(A,a,'retry'),'partial retry');const dailyBefore=daily(A).length;const foodId=log(A).food[0]?.id;
   ck(`${destination}: partial failure leaves daily contribution once`,log(A).food.length===1&&log(A).water===500);
   ck(`${destination}: partial failure does not claim everything saved`,!/Everything.s logged/.test(card(A,a)?.textContent||'')&&/retry|attention|failed|not saved/i.test(card(A,a)?.textContent||''));
   await click(A,a,'retry');await quiet(A);await until(()=>!action(A,a,'retry')||action(A,a,'retry').disabled,'partial retry completed');
   ck(`${destination}: retry does not resend already-saved daily log`,daily(A).length===dailyBefore);
   ck(`${destination}: retry preserves food identity and water total`,log(A).food.length===1&&log(A).food[0].id===foodId&&log(A).water===500);
   ck(`${destination}: retry targets the failed resource exactly once more`,writes(A,url).length===2);
   if(destination==='body')ck('body retry creates one set of metrics',A.w.__labs.length===1);
  }finally{A.close()}
 }
 const B=mount(code);try{
  const a=await review(B,{foods:[food('Unknown metric oats')]});B.w.__chat.getState().setMessages(ms=>ms.map((m,i)=>i===a?{...m,parsed:{...m.parsed,bodyMetrics:[{name:'Body fat',value:20,unit:'%'}],bodyMetricsOn:true}}:m));await tick();
  B.w.__intercept=async e=>{if(e.method==='post'&&e.url==='/members/me/labs'){await B.w.__defaultApi(e);throw ambiguous()}};
  await click(B,a,'save');await quiet(B);await tick(120);
  ck('unknown append-only metric outcome is explicit rather than reported as saved',/confirm|unknown|check|uncertain/i.test(card(B,a)?.textContent||''));
  const retry=action(B,a,'retry');if(retry&&!retry.disabled){retry.click();await quiet(B)}
  ck('ambiguous append-only metrics are not blindly duplicated by Retry',writes(B,'/members/me/labs').length===2&&B.w.__labs.length===1&&writes(B,'/members/me/labs')[0].body.request_id===writes(B,'/members/me/labs')[1].body.request_id);
 }finally{B.close()}
}
async function serverMergeGuards(code){
 for(const field of ['weight','food']){
  const A=mount(code);try{
   const a=await review(A,field==='weight'?{weight_kg:82.5}:{foods:[food('Merged oats')]});
   A.w.__intercept=async e=>{if(e.method==='post'&&/^\/logs\//.test(e.url)){const row={...copy(e.body),saved_at:new Date().toISOString()};if(field==='weight')row.weight_kg=79.4;else row.food_items[0].grams=175;A.w.__savedLogs[e.url]=row;return{data:copy(row)}}};
   await click(A,a,'save');await quiet(A);await until(()=>!messages(A)[a].saveReceipt?.running,'merged save settled');
   const count=daily(A).length;const undo=action(A,a,'undo');if(undo&&!undo.disabled){undo.click();await quiet(A)}
   ck(`server merge: foreign ${field} postimage is retained instead of adopted as ours`,field==='weight'?Number(log(A).weight)===79.4:log(A).food[0]?.grams===175);
   ck(`server merge: foreign ${field} postimage cannot be erased by Undo`,daily(A).length===count&&!messages(A)[a].undone);
   ck(`server merge: foreign ${field} postimage presents conflict/verification status`,/changed|overlap|conflict|confirm|review/i.test(card(A,a)?.textContent||''));
  }finally{A.close()}
 }
 const A=mount(code);try{
  const a=await review(A,{weight_kg:82.5});await click(A,a,'save');await saved(A,a);
  A.w.__intercept=async e=>{if(e.method==='post'&&/^\/logs\//.test(e.url)){const row={...copy(e.body),weight_kg:79.4,saved_at:new Date().toISOString()};A.w.__savedLogs[e.url]=row;return{data:copy(row)}}};
  await click(A,a,'undo');await quiet(A);
  ck('Undo HTTP success with a different server postimage is not claimed complete',!messages(A)[a].undone&&!messages(A)[a].saveReceipt?.rolledBack);
  ck('Undo server merge retains the canonical newer weight',Number(log(A).weight)===79.4);
  ck('Undo server merge presents an explicit conflict or unconfirmed status',/changed|conflict|confirm|newer|overlap/i.test(card(A,a)?.textContent||''));
 }finally{A.close()}
}
async function retainedBodyAndRemount(code){
 const A=mount(code);try{
  const a=await review(A,{foods:[food('Scale meal')]});A.w.__chat.getState().setMessages(ms=>ms.map((m,i)=>i===a?{...m,parsed:{...m.parsed,bodyMetrics:[{name:'Body fat',value:20,unit:'%'}],bodyMetricsOn:true}}:m));await tick();
  await click(A,a,'save');await saved(A,a);await until(()=>A.w.__labs.length===1,'saved body metric');
  await click(A,a,'edit');await quiet(A);await until(()=>action(A,a,'save'),'body review reopened');
  ck('Edit honestly retains append-only saved body metrics in history',A.w.__labs.length===1&&/remain|retained|health history/i.test(card(A,a)?.textContent||''));
  ck('Edit excludes already-saved body metrics from a new review save',messages(A)[a].parsed.bodyMetricsOn===false);
  const retainedToggle=[...card(A,a).querySelectorAll('button')].find(b=>/Save 1 metrics to body history/.test(b.textContent));
  if(retainedToggle)retainedToggle.click();await tick();
  ck('retained body metrics cannot be reselected through the reopened review control',messages(A)[a].parsed.bodyMetricsOn===false);
  await click(A,a,'save');await saved(A,a);
  ck('Edit then Save does not append body metrics again',A.w.__labs.length===1&&writes(A,'/members/me/labs').length===1);
  ck('Edit then Save keeps a single corrected daily food',log(A).food.length===1);
  A.w.__root.unmount();await tick();A.w.__mount();await until(()=>action(A,a,'undo'),'receipt after remount');
  await click(A,a,'undo');await quiet(A);
  ck('Saved card keeps its own Undo across component remount',log(A).food.length===0&&messages(A)[a].undone===true);
 }finally{A.close()}
}
async function workoutUndoRaces(code){
 const A=mount(code);try{
  const a=await review(A,{foods:[food('Workout oats')],workouts:[{name:'Walk',duration_min:20}]});await click(A,a,'save');await saved(A,a);await until(()=>writes(A,'/workouts').length===1,'workout saved');
  const gate=deferred();A.w.__intercept=e=>e.method==='post'&&/^\/logs\//.test(e.url)?gate.promise:undefined;
  await click(A,a,'undo');await until(()=>daily(A).length===2,'daily undo pending');
  A.w.__workout={session:{duration_min:35,notes:'A newer manual workout'},exercises:[],cardio:[]};
  gate.resolve(await A.w.__defaultApi(daily(A).at(-1)));await quiet(A);await tick(80);
  ck('Undo rechecks workout after awaited daily reversal and keeps newer manual data',A.w.__workout.session?.notes==='A newer manual workout'&&writes(A,'/workouts').length===1);
  ck('Workout race does not claim the whole review was undone',!messages(A)[a].undone&&/changed|manual|conflict|review/i.test(card(A,a)?.textContent||''));
 }finally{A.close()}
 for(const boundary of ['day','account']){
  const B=mount(code);try{
   const a=await review(B,{foods:[food('Boundary workout oats')],workouts:[{name:'Walk',duration_min:20}]});await click(B,a,'save');await saved(B,a);await until(()=>writes(B,'/workouts').length===1,'boundary workout saved');
   const gate=deferred();B.w.__intercept=e=>e.method==='post'&&/^\/logs\//.test(e.url)?gate.promise:undefined;
   await click(B,a,'undo');await until(()=>daily(B).length===2,'boundary undo sent');const current=copy(log(B));
   if(boundary==='account')B.w.__auth.setState({user:{id:999,name:'Other fixture',role:'patient'}});
   else {B.w.__log.setState({date:'2000-01-01'});B.w.__log.setState({date:B.w.__today,log:current})}
   gate.resolve(await B.w.__defaultApi(daily(B).at(-1)));await quiet(B);await tick(80);
   ck(`${boundary}: context switch during Undo prevents a later workout reversal`,writes(B,'/workouts').length===1);
   if(boundary==='day')ck('date switch away and back leaves an actionable interrupted Undo',!messages(B)[a].saveReceipt?.running&&!!action(B,a,'undo-retry')&&!action(B,a,'undo-retry').disabled);
   else ck('account switch during Undo cannot restore the prior member receipt',messages(B).length===0);
  }finally{B.close()}
 }
}

async function dailyFailureAndWorkoutAcknowledgement(code){
 const A=mount(code);try{
  const a=await review(A,{foods:[food('Daily retry oats')],workouts:[{name:'Walk',duration_min:20}]});let failed=false;
  A.w.__intercept=e=>{if(e.method==='post'&&/^\/logs\//.test(e.url)&&!failed){failed=true;throw rejected()}};
  await click(A,a,'save');await until(()=>action(A,a,'retry')&&!messages(A)[a].saveReceipt?.running,'daily retry visible');
  ck('failed daily save still reports the independently acknowledged workout',writes(A,'/workouts').length===1&&/Saved/.test(action(A,a,'workout-status')?.textContent||''));
  await click(A,a,'retry');await saved(A,a);
  ck('retrying only the daily failure never repeats a saved workout',daily(A).length===2&&writes(A,'/workouts').length===1&&log(A).food.length===1);
 }finally{A.close()}
 const B=mount(code);try{
  const a=await review(B,{workouts:[{name:'Walk',duration_min:20}]});let first=true;
  B.w.__intercept=async e=>{if(e.method==='post'&&e.url==='/workouts'&&first){first=false;await B.w.__defaultApi(e);throw ambiguous()}};
  await click(B,a,'save');await until(()=>action(B,a,'retry')&&!messages(B)[a].saveReceipt?.running,'unknown workout retry');
  ck('workout lost acknowledgement is presented as unconfirmed',/not confirmed/i.test(action(B,a,'workout-status')?.textContent||''));
  await click(B,a,'retry');await saved(B,a);
  ck('workout retry verifies the existing server result instead of posting twice',writes(B,'/workouts').length===1&&B.w.__workout.session?.duration_min===20);
 }finally{B.close()}
}
async function standaloneLabScope(code){
 const seed=async A=>{
  await until(()=>A.q('composer-input'),'lab fixture mounted');
  A.w.__chat.getState().setMessages([{role:'ai',text:'Review these values',lab:{test_date:A.w.__today,lab_name:'Synthetic fixture',needs_review:0,results:[{test_name:'Weight',value:82.5,unit:'kg',on:true},{test_name:'Body fat',value:20,unit:'%',on:true}]}}]);await tick();
  return [...A.w.document.querySelectorAll('button')].find(b=>/^Save 2 results$/.test(b.textContent.trim()));
 };
 for(const boundary of ['day','account']){
  const A=mount(code);try{
   const button=await seed(A);const gate=deferred();A.w.__intercept=e=>e.url==='/members/me/labs'&&e.method==='post'?gate.promise:undefined;
   button.click();button.click();await until(()=>writes(A,'/members/me/labs').length>0,'pending standalone lab');
   ck(`${boundary}: repeated lab Save starts one append request`,writes(A,'/members/me/labs').length===1);
   if(boundary==='account')A.w.__auth.setState({user:{id:999,name:'Other fixture',role:'patient'}});
   else A.w.__log.setState({date:'2000-01-01',log:{...log(A),weight:'73'}});
   gate.resolve(await A.w.__defaultApi(writes(A,'/members/me/labs')[0]));await quiet(A);await tick(80);
   ck(`${boundary}: stale lab response never writes its weight into the new context`,daily(A).length===0&&(boundary==='account'||log(A).weight==='73'));
   ck(`${boundary}: stale lab response cannot mark an old card completed`,boundary==='account'?messages(A).length===0:!messages(A)[0]?.applied&&!messages(A)[0]?.weightLogged);
  }finally{A.close()}
 }
 for(const transition of ['away-and-back','remount','manual-weight']){
  const A=mount(code);try{
   const button=await seed(A),gate=deferred();A.w.__intercept=e=>e.url==='/members/me/labs'&&e.method==='post'?gate.promise:undefined;
   button.click();await until(()=>writes(A,'/members/me/labs').length===1,'lab append pending transition');
   if(transition==='away-and-back'){
    const original=copy(log(A));A.w.__log.setState({date:'2000-01-01'});A.w.__log.setState({date:A.w.__today,log:original});
   }else if(transition==='remount'){
    A.w.__root.unmount();await tick();A.w.__mount();await until(()=>A.q('composer-input'),'lab remounted');
    const second=[...A.w.document.querySelectorAll('button')].find(b=>/^Save 2 results$/.test(b.textContent.trim()));second?.click();await tick();
   }else{
    A.w.__log.getState().updateLog('weight','79.4');await A.w.__log.getState().saveLog();
   }
   gate.resolve(await A.w.__defaultApi(writes(A,'/members/me/labs')[0]));await quiet(A);await tick(60);
   if(transition==='away-and-back'){
    const again=[...A.w.document.querySelectorAll('button')].find(b=>/^Save 2 results$/.test(b.textContent.trim()));again?.click();await quiet(A);
    ck('lab append remains protected after date changes away and back',writes(A,'/members/me/labs').length===1&&daily(A).length===0);
    ck('stale lab acknowledgement leaves a visible check-before-repeating notice',/not confirmed|may already|check.*Lab results/i.test(A.w.document.body.textContent));
   }else if(transition==='remount'){
    ck('component remount while lab append is pending cannot submit a second append',writes(A,'/members/me/labs').length===1&&A.w.__labs.length===1);
   }else{
    ck('lab save retains a newer manual weight entered during the append',log(A).weight==='79.4'&&daily(A).length===1);
    ck('lab/manual-weight conflict is explicit and never claims the AI weight logged',!messages(A)[0]?.weightLogged&&/weight has changed|newer.*weight|newer value/i.test(A.w.document.body.textContent));
   }
  }finally{A.close()}
 }
 const A=mount(code);try{
  const button=await seed(A);A.w.__intercept=e=>{if(e.method==='post'&&/^\/logs\//.test(e.url))throw rejected()};
  button.click();await until(()=>writes(A,'/members/me/labs').length===1&&daily(A).length===1,'lab and failed weight request');await quiet(A);
  ck('failed daily weight save is never marked weightLogged by lab save',messages(A)[0]?.weightLogged==null);
  ck('lab save with rejected daily weight exposes a partial or failed outcome',/weight.*not|weight.*fail|could not.*weight|save failed|not saved|not confirmed|retry/i.test(A.w.document.body.textContent));
 }finally{A.close()}
}

async function reliableWrites(code){
 const A=mount(code);try{
  const a=await review(A,{foods:[food('Retry oats')]});A.w.__chat.getState().setMessages(ms=>ms.map((m,i)=>i===a?{...m,parsed:{...m.parsed,bodyMetrics:[{name:'Body fat',value:20,unit:'%'}],bodyMetricsOn:true}}:m));await tick();let first=true;
  A.w.__intercept=async e=>{if(e.method==='post'&&e.url==='/members/me/labs'&&first){first=false;await A.w.__defaultApi(e);throw ambiguous()}};
  await click(A,a,'save');await until(()=>action(A,a,'retry')&&!messages(A)[a].saveReceipt?.running,'body safe retry');
  ck('lost body acknowledgement exposes an explicit safe retry',/Retry safely/.test(card(A,a).textContent));
  await click(A,a,'retry');await saved(A,a);
  const calls=writes(A,'/members/me/labs');
  ck('body retry reuses its original request ID',calls.length===2&&calls[0].body.request_id===calls[1].body.request_id&&!!calls[0].body.request_id);
  ck('body retry confirms one persisted measurement',A.w.__labs.length===1);
 }finally{A.close()}
 const B=mount(code);try{
  B.w.__workout={session:{revision:7,duration_min:10,notes:null},exercises:[],cardio:[]};
  const a=await review(B,{workouts:[{name:'Walk',duration_min:20}]});
  B.w.__intercept=e=>{if(e.method==='post'&&e.url==='/workouts')throw Object.assign(new Error('Concurrent edit'),{response:{status:409,data:{code:'WORKOUT_CONFLICT'}}})};
  await click(B,a,'save');await until(()=>messages(B)[a].saveReceipt?.workout.state==='conflict','atomic workout conflict');
  ck('AI workout save sends the observed server revision',writes(B,'/workouts')[0].body.expected_revision===7);
  ck('server conflict preserves newer workout and reports it',B.w.__workout.session.duration_min===10&&/newer changes|not overwritten/i.test(card(B,a).textContent));
 }finally{B.close()}
 const U=mount(code);try{
  const a=await review(U,{workouts:[{name:'Walk',duration_min:15}]});await click(U,a,'save');await saved(U,a);await click(U,a,'undo');await until(()=>messages(U)[a].undone,'revision-aware Undo');
  const calls=writes(U,'/workouts');ck('Save and Undo each send the last observed revision',calls.length===2&&calls[0].body.expected_revision===0&&calls[1].body.expected_revision===1);
 }finally{U.close()}
 const C=mount(code);try{
  await until(()=>C.q('composer-input'),'standalone retry mounted');
  C.w.__chat.getState().setMessages([{role:'ai',lab:{test_date:C.w.__today,results:[{test_name:'Body fat',value:20,unit:'%',on:true}]}}]);await tick();
  let first=true;C.w.__intercept=async e=>{if(e.url==='/members/me/labs'&&e.method==='post'&&first){first=false;await C.w.__defaultApi(e);throw ambiguous()}};
  [...C.w.document.querySelectorAll('button')].find(b=>/^Save 1 results$/.test(b.textContent.trim())).click();
  await until(()=>[...C.w.document.querySelectorAll('button')].some(b=>b.textContent==='Retry report save'),'report retry');
  [...C.w.document.querySelectorAll('button')].find(b=>b.textContent==='Retry report save').click();await until(()=>messages(C)[0].applied,'report replay confirmed');
  const calls=writes(C,'/members/me/labs');
  ck('standalone report retry reuses its submission ID',calls.length===2&&calls[0].body.request_id===calls[1].body.request_id);
  ck('standalone report retry saves once and confirms success',C.w.__labs.length===1&&messages(C)[0].labSaved===1);
 }finally{C.close()}
}

async function noOpAndCap(code){
 const A=mount(code,{water:9900,activities:{walk:true}});try{
  const a=await review(A,{water_ml_add:500,activities:[{id:'walk',label:'Walk'}]});await click(A,a,'save');await saved(A,a);
  ck('water save respects the existing daily cap',log(A).water===10000);
  await click(A,a,'undo');await quiet(A);
  ck('Undo reverses only the actual capped water change',log(A).water===9900);
  ck('Undo does not unset a protocol item that was already true',log(A).activities.walk===true);
 }finally{A.close()}
}
try{const code=await bundle();
 await section('Atomic workout and idempotent lab writes',()=>reliableWrites(code));
 await section('Receipt delta invariants',()=>receiptUtilityCases(code));
 await section('Independent per-card receipts',()=>independentCards(code));
 await section('Manual changes and conflict protection',()=>manualEdits(code));
 await section('Repeated taps and Edit/Save cycle',()=>repeatedAndEdit(code));
 await section('Failed Undo recovery',()=>undoFailures(code));
 await section('Receipt account/day/session guards',()=>contextGuards(code));
 await section('Independent partial-save retries',()=>partialSaves(code));
 await section('Canonical server postimage guards',()=>serverMergeGuards(code));
 await section('Saved body retention and receipt remount',()=>retainedBodyAndRemount(code));
 await section('Workout Undo and context races',()=>workoutUndoRaces(code));
 await section('Daily failure and workout acknowledgement recovery',()=>dailyFailureAndWorkoutAcknowledgement(code));
 await section('Standalone lab safety boundaries',()=>standaloneLabScope(code));
 await section('No-op changes and capped additions',()=>noOpAndCap(code));
}catch(e){ck('receipt suite setup',false,e.stack)}finally{fs.rmSync(TMP,{recursive:true,force:true})}
console.log(`\ntest-ai-save-receipts: ${pass} passed, ${fail} failed`);
if(process.env.RECEIPT_RESULTS){fs.mkdirSync(path.dirname(process.env.RECEIPT_RESULTS),{recursive:true});fs.writeFileSync(process.env.RECEIPT_RESULTS,JSON.stringify({pass,fail,checks},null,2))}
process.exitCode=fail?1:0;
