// Exercise the shipped Axios interceptors and Zustand stores, with transport
// adapters as the only API substitute. No database or live member is touched.
const path = require('path');
const esbuild = require('esbuild');
const { execFileSync } = require('child_process');
const { ROOT, CLIENT_SRC } = require('./client-bundle');

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function runRequestCases(ck) {
  console.log('\nP0 session recovery — actual request interceptors and log store');
  const source = `export { default as api } from './api/client';
    export { default as axios } from 'axios';
    export { useAuthStore } from './store/authStore';
    export { useLogStore } from './store/logStore';
    export { useAIChat, undoSnap, workoutUndoSnap } from './store/aiChatStore';`;
  const built = await esbuild.build({
    stdin: { contents: source, resolveDir: CLIENT_SRC, sourcefile: 'session-qa-entry.js' },
    bundle:true, write:false, format:'cjs', platform:'node', jsx:'automatic',
    define:{'import.meta.env':JSON.stringify({DEV:false, MODE:'test'})},
    nodePaths:[path.join(ROOT,'node_modules')], logLevel:'silent',
    plugins:[...(process.env.SESSION_QA_BASELINE ? [{name:'baseline-source',setup(build) {
      build.onLoad({filter: /client\/src\/(api\/client|store\/(authStore|logStore))\.js$/}, args => ({
        contents:execFileSync('git',['show',`HEAD:${path.relative(ROOT,args.path)}`],{cwd:ROOT,encoding:'utf8'}), loader:'js'
      }));
    }}] : []), {name:'controlled-save-transport', setup(build) {
      build.onResolve({filter:/useOfflineQueue$/}, () => ({path:'save-transport',namespace:'session-qa'}));
      build.onLoad({filter:/.*/,namespace:'session-qa'}, () => ({contents:'export const saveLogWithFallback = (...args) => globalThis.__sessionQA.save(...args); export const getQueuedLog = (...args) => globalThis.__sessionQA.queued?.(...args) ?? Promise.resolve(null);'}));
    }}],
  });
  const mod={exports:{}};
  new Function('module','exports','require',built.outputFiles[0].text)(mod,mod.exports,require);
  const {api,axios,useAuthStore:auth,useLogStore:logs,useAIChat:chat,undoSnap,workoutUndoSnap}=mod.exports;
  const storage = new Map();
  global.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
  global.sessionStorage={...global.localStorage};
  global.window={location:{href:'/'},navigator:{}};
  global.fetch=async()=>({ok:true});
  global.__sessionQA={save:async()=>({queued:true})};
  const user=id=>({id,name:`QA ${id}`,role:'patient',phone:'9000000001'});
  const refreshToken='aaaaaaaaaa.bbbbbbbbbb.cccccccccc';
  const login=(id=1,token=`access-${id}`)=>auth.getState().login(token,user(id),refreshToken);
  const good=(config,data={ok:true})=>({status:200,statusText:'OK',headers:{},config,data});
  const bad=(config,status=401)=>new axios.AxiosError(`HTTP ${status}`,'ERR_BAD_RESPONSE',config,null,{status,config,headers:{},data:{}});
  const rejected=promise=>promise.then(()=>null,error=>error);
  const privateRequest=()=>api.post('/logs/2026-10-13',{water_ml:250});

  login();
  auth.getState().login('coach-token', {id:2,name:'Coach',role:'monitor'});
  ck('login without a new fallback cannot retain the previous member credential or name',!storage.has('fl-refresh-token')&&!storage.has('fl-last-member'));
  login();
  chat.getState().setMessages([{text:'private old conversation'}]);
  chat.getState().setInput('private draft');
  chat.getState().prefill('old prefill');
  undoSnap.current={private:true}; workoutUndoSnap.current={private:true};
  const firstVersion=auth.getState().sessionVersion;
  auth.getState().setToken('rotated');
  ck('silent token rotation keeps the same session generation',auth.getState().sessionVersion===firstVersion);
  ck('silent refresh preserves the current AI conversation and draft',chat.getState().messages.length===1&&chat.getState().input==='private draft');
  login();
  ck('new sign-in clears AI transcript, prefill, draft and both undo snapshots',chat.getState().messages.length===0&&chat.getState().input===''&&chat.getState().prefillText===''&&undoSnap.current===null&&workoutUndoSnap.current===null);
  ck('re-login as the same member changes the session generation',auth.getState().sessionVersion===firstVersion+1);

  for(const failure of ['network',503,429,'timeout']) {
    login(); let timeout;
    api.defaults.adapter=async config=>{throw bad(config)};
    axios.defaults.adapter=async config=>{timeout=config.timeout; if(typeof failure==='number') throw bad(config,failure); throw new axios.AxiosError(failure,failure==='timeout'?'ECONNABORTED':'ERR_NETWORK',config);};
    const err=await rejected(privateRequest());
    ck(`refresh ${failure}: rejected request keeps signed-in member and fallback credential`,!!err&&auth.getState().user?.id===1&&storage.get('fl-refresh-token')===refreshToken);
    ck(`refresh ${failure}: refresh has a bounded timeout`,timeout===35000);
  }
  if (process.env.SESSION_QA_BASELINE) return; // Bounded pre-fix reproduction; old replay can loop.
  for(const status of [401,403]) {
    login(); api.defaults.adapter=async config=>{throw bad(config)};
    axios.defaults.adapter=async config=>{throw bad(config,status)};
    await rejected(privateRequest()); await tick();
    ck(`refresh ${status}: confirmed expiry clears current session and credential`,auth.getState().user===null&&!storage.has('fl-refresh-token'));
    ck(`refresh ${status}: login receives the expired-session explanation`,storage.get('fl-logout-reason')==='expired');
  }

  login(); let calls=0,refreshes=0; const refresh=deferred();
  api.defaults.adapter=async config=>{calls++; if(!config._retry) throw bad(config); return good(config);};
  axios.defaults.adapter=config=>{refreshes++; return refresh.promise.then(()=>good(config,{accessToken:'new-token',refreshToken,user:user(1)}));};
  const one=privateRequest(), two=privateRequest(); await tick();
  ck('simultaneous expired-token requests share one refresh',refreshes===1);
  refresh.resolve(); await Promise.all([one,two]);
  ck('each waiting request is replayed exactly once after refresh',calls===4&&auth.getState().accessToken==='new-token');

  login(); refreshes=0;
  api.defaults.adapter=async config=>{throw bad(config)};
  axios.defaults.adapter=async config=>{refreshes++;return good(config,{accessToken:'new-token',user:user(1)})};
  await rejected(Promise.all([privateRequest(),privateRequest()]));
  ck('a second 401 on replay never starts a refresh loop',refreshes===1);

  global.window.location.href='/';
  let finishLogout; global.fetch=()=>new Promise(resolve=>{finishLogout=resolve});
  login(); auth.getState().logout(); login(2); finishLogout({ok:true}); await tick();
  ck('late logout completion cannot redirect a newly signed-in member',global.window.location.href==='/'&&auth.getState().user?.id===2);
  global.fetch=async()=>({ok:true});

  for(const switchKind of ['different member','same member re-login','logout']) {
    login(); const wait=deferred(); let replay=0;
    api.defaults.adapter=async config=>{replay++;throw bad(config)};
    axios.defaults.adapter=config=>wait.promise.then(()=>good(config,{accessToken:'late-old-token',refreshToken,user:user(1)}));
    const pending=rejected(privateRequest()); await tick();
    if(switchKind==='logout') auth.getState().logout();
    else login(switchKind==='different member'?2:1,'new-session-token');
    wait.resolve(); const err=await pending; await tick();
    ck(`late refresh after ${switchKind} cannot restore or replay the old session`,err?.code==='ERR_CANCELED'&&replay===1&&auth.getState().accessToken!=='late-old-token');
  }

  login(); const failLate=deferred();
  api.defaults.adapter=async config=>{throw bad(config)};
  axios.defaults.adapter=config=>failLate.promise.then(()=>{throw bad(config,401)});
  const oldFailure=rejected(privateRequest()); await tick(); login(2); failLate.resolve(); await oldFailure;
  ck('old refresh rejection cannot log out the next member',auth.getState().user?.id===2);

  for(const status of [200,401]) {
    login(); const wait=deferred(); let refreshCount=0;
    api.defaults.adapter=config=>wait.promise.then(()=>{if(status===401)throw bad(config);return good(config,{secret:'old member'});});
    axios.defaults.adapter=async config=>{refreshCount++;return good(config,{accessToken:'bad'})};
    const old=rejected(privateRequest()); login(2); wait.resolve(); const err=await old;
    ck(`old request ${status} after account switch is canceled before data/replay`,err?.code==='ERR_CANCELED'&&refreshCount===0&&auth.getState().user?.id===2);
  }
  let dispatches=0;
  api.defaults.adapter=async config=>{dispatches++;return good(config)};
  const mismatch=await rejected(api.post('/logs/2026-10-13',{}, {_authSession:{owner:1,version:0}}));
  ck('a queued request bound to a different session never reaches transport',mismatch?.code==='ERR_CANCELED'&&dispatches===0);

  login(); dispatches=0;
  api.defaults.adapter=async config=>{dispatches++;throw bad(config)};
  axios.defaults.adapter=async config=>good(config,{accessToken:'other-account-token',user:user(2)});
  await rejected(privateRequest());
  ck('refresh identity mismatch never replays member edits under another account',dispatches===1&&auth.getState().user===null);

  console.log('\nP0 saves — response ownership and invocation order');
  login(); const date='2026-10-13';
  logs.setState({date}); logs.getState().updateLog('weight','71');
  login(2);
  ck('account change immediately clears the prior in-memory log',logs.getState().log.weight!=='71'&&!logs.getState().dirty);

  // Isolate store response guards from the separate Axios response guard.
  const originalGet=api.get;
  let delayed=deferred(); api.get=()=>delayed.promise;
  const loading=logs.getState().setDate(date); login(3);
  delayed.resolve({data:{weight_kg:88,water_ml:900}}); await loading;
  ck('late date-load response cannot populate a new member log',logs.getState().log.weight!==88&&logs.getState().log.weight!=='88');

  delayed=deferred(); api.get=()=>delayed.promise;
  const reload=logs.getState().reload(); login(4);
  delayed.resolve({data:{weight_kg:89}}); await reload;
  ck('late background reload cannot populate a new member log',logs.getState().log.weight!==89&&logs.getState().log.weight!=='89');

  login(); logs.setState({date}); logs.getState().updateLog('water','100');
  const saveA=deferred(); const snapshots=[], payloads=[];
  global.__sessionQA.save=async (day,log)=>{snapshots.push(log.water_ml); payloads.push(log); const sequence=snapshots.length; if(sequence===1) await saveA.promise; return {queued:true,write:{streamId:'same-day-history',sequence}};};
  const first=logs.getState().saveLog(); await tick();
  logs.getState().updateLog('water','200'); const second=logs.getState().saveLog(); await tick();
  ck('second save waits until older same-day save settles',snapshots.length===1);
  saveA.resolve(); await Promise.all([first,second]);
  ck('serialized saves retain their own snapshots in edit order',snapshots.length===2&&snapshots[0]==='100'&&snapshots[1]==='200', snapshots);
  ck('latest queued save alone clears dirty state and reports queued',logs.getState().saved&&logs.getState().queued&&!logs.getState().dirty&&!logs.getState().saving);
  ck('serialized edit captured during its predecessor carries that exact parent identity',payloads[1].base_client_write?.streamId==='same-day-history'&&payloads[1].base_client_write?.sequence===1);
  logs.getState().updateLog('water','300'); await logs.getState().saveLog();
  ck('a later edit retains the pending snapshot identity after the save chain drains',payloads[2].base_client_write?.sequence===2&&logs.getState().log.writeBase?.sequence===3);

  login(); logs.setState({date}); logs.getState().updateLog('water',750);
  const previousSave=deferred(), afterReload=[];
  global.__sessionQA.save=async(day,payload)=>{afterReload.push(payload);if(afterReload.length===1)await previousSave.promise;return{queued:true,write:{streamId:'reloaded-history',sequence:afterReload.length}}};
  const beforeReload=logs.getState().saveLog(); await tick();
  api.get=async()=>({data:{water_ml:500,weight_kg:81,saved_at:'2026-10-13T00:00:00Z'}});
  await logs.getState().setDate(date); logs.getState().updateLog('weight','80.5');
  const fromReload=logs.getState().saveLog(); previousSave.resolve(); await Promise.all([beforeReload,fromReload]);
  ck('an explicit day reload cannot inherit parent identity from an unrelated in-flight snapshot',!afterReload[1].base_client_write);
  login(); logs.setState({date}); logs.getState().updateLog('water',750);
  const lateQueued=deferred(); global.__sessionQA.save=()=>lateQueued.promise;
  const beforeFreshLoad=logs.getState().saveLog(); await tick();
  api.get=async()=>({data:{water_ml:500,weight_kg:81,saved_at:'2026-10-13T00:00:00Z'}});
  await logs.getState().setDate(date);
  lateQueued.resolve({queued:true,write:{streamId:'old-visible-history',sequence:1}}); await beforeFreshLoad;
  ck('late queued receipt cannot attach its parent identity to an explicitly reloaded snapshot',!logs.getState().log.writeBase&&logs.getState().log.water===500&&!logs.getState().saving);

  login(); logs.setState({date}); delayed=deferred();
  global.__sessionQA.save=()=>delayed.promise;
  const staleSave=logs.getState().saveLog(); await tick(); login(2); logs.getState().updateLog('weight','73');
  delayed.resolve({queued:false,data:{weight_kg:91}}); await staleSave;
  ck('late successful save cannot overwrite the next account or clear its edits',logs.getState().log.weight==='73'&&logs.getState().dirty&&!logs.getState().saved);

  login(); logs.setState({date}); delayed=deferred();
  global.__sessionQA.save=()=>delayed.promise;
  const failedSave=logs.getState().saveLog(); await tick(); login(2);
  delayed.reject(new Error('old failure')); await failedSave;
  ck('late failed save does not show the old account error to the new account',logs.getState().error===null);

  login(); logs.setState({date}); delayed=deferred();
  global.__sessionQA.save=()=>delayed.promise;
  const otherDay=logs.getState().saveLog(); await tick(); logs.setState({date:'2026-10-12'});
  delayed.reject(new Error('old date failure')); await otherDay;
  ck('save failure for a previous date does not mark the current date failed',logs.getState().error===null&&!logs.getState().saving);

  global.__sessionQA.save=async()=>{throw new Error('offline storage is unavailable')};
  logs.getState().updateLog('weight','74'); await logs.getState().saveLog();
  ck('storage-unavailable failure keeps edits and gives actionable recovery text',logs.getState().dirty&&logs.getState().error.includes('Keep this page open'));
  global.__sessionQA.save=async()=>{throw Object.assign(new Error('Another tab has a pending edit. Your change is still on screen.'),{code:'QUEUE_CONFLICT'})};
  logs.getState().updateLog('weight','74.5'); await logs.getState().saveLog();
  ck('pending-tab conflict keeps the unsaved draft and exposes specific recovery text',logs.getState().dirty&&!logs.getState().saved&&!logs.getState().queued&&logs.getState().log.weight==='74.5'&&logs.getState().error.includes('still on screen'));

  login(); logs.setState({date});
  const base={water_ml:0,food:{},food_macros:{}};
  const food={id:'queued-food',name:'Dal',grams:100,meal:'lunch',per_100g:{calories:120}};
  global.__sessionQA.queued=async(day,owner)=>owner===1?{food_items:[food],water_ml:350,base_saved_at:'2026-10-12T12:00:00Z',base_food_ids:[],base_fields:base,base_client_write:{streamId:'restored-pending',sequence:7}}:null;
  let reads=0; api.get=async()=>{reads++;throw new Error('offline')};
  await logs.getState().setDate(date);
  ck('cold day load restores this member queued food and water without a network read',logs.getState().log.food[0]?.id==='queued-food'&&logs.getState().log.water===350&&reads===0&&logs.getState().queued);
  let sent;
  global.__sessionQA.save=async(day,payload)=>{sent=payload;return{queued:true}};
  logs.getState().updateLog('water',600); await logs.getState().saveLog();
  ck('editing a restored queued day preserves food and original merge baseline',sent.food_items[0]?.id==='queued-food'&&sent.water_ml===600&&sent.base_fields===base&&sent.base_food_ids.length===0&&sent.base_saved_at==='2026-10-12T12:00:00Z');
  ck('editing a hydrated pending day retains its exact parent write identity',sent.base_client_write?.streamId==='restored-pending'&&sent.base_client_write?.sequence===7);
  await logs.getState().reload();
  ck('background refresh cannot replace a pending queued day with stale server state',reads===0&&logs.getState().log.water===600);
  delete global.__sessionQA.queued;
  api.get=async()=>({data:{water_ml:600,food_items:[food]}});
  await logs.getState().reload();
  ck('successful reload after queue drains clears the pending-sync flag',!logs.getState().queued&&logs.getState().log.food[0]?.id==='queued-food');
  api.get=originalGet;
}
module.exports={runRequestCases};
