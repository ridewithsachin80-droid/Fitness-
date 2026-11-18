// Mounted App with real auth/session/recovery code and synthetic network/pages.
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../client/src/',import.meta.url));
let passed=0;
const check=(name,ok)=>{assert.ok(ok,name);passed++;console.log('  ✓ '+name);};
const tick=()=>new Promise(r=>setTimeout(r,20));
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await tick();}throw Error('Timed out waiting for mounted App');}
const code=(await build({stdin:{resolveDir:root,loader:'jsx',contents:`
 import {createRoot} from 'react-dom/client';import App from './App';
 import {useAuthStore} from './store/authStore';import {markSignedOut} from './utils/session';
 window.auth=useAuthStore;if(window.signedOut)markSignedOut();
 if(window.initialUser)useAuthStore.setState({user:window.initialUser,isRestoring:false});
 window.root=createRoot(document.getElementById('root'));window.root.render(<App/>);
 `},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"DEV":false}'},logLevel:'silent',plugins:[{name:'test-boundaries',setup(b){
 b.onResolve({filter:/.*/},a=>{
  if(a.path==='axios')return{path:'axios',namespace:'fixture'};
  if(/\/api\/logs$/.test(a.path))return{path:'logs',namespace:'fixture'};
  if(/useOfflineQueue$/.test(a.path))return{path:'offline',namespace:'fixture'};
  if(/useSync$/.test(a.path))return{path:'sync',namespace:'fixture'};
  if(a.importer===path.join(root,'App.jsx')&&(/^\.\/pages\//.test(a.path)||/^\.\/components\/(Onboarding|HandsFree)$/.test(a.path)))return{path:a.path,namespace:'fixture'};
 });
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'jsx',resolveDir:root,contents:a.path==='axios'?`export default {post:(...args)=>window.post(...args)};`:a.path==='logs'?`export const getMyOnboarding=()=>window.onboard();`:a.path==='offline'?`export const useOfflineSync=()=>{};`:a.path==='sync'?`export const disconnectSocket=()=>{};`:`export default function Page(){return <h1>${a.path.split('/').at(-1)}</h1>}` }));
 }}]})).outputFiles[0].text;
const member={id:901,name:'Recovery fixture',role:'patient'};
const oldToken='fixture.old.refresh-token',newToken='fixture.new.refresh-token';
const success=()=>({data:{user:member,accessToken:'synthetic-access-token',refreshToken:newToken}});
const failure=status=>Promise.reject(status?{response:{status}}:new Error('Network unavailable'));
function mount({online=true,post=async()=>success(),onboard=async()=>({data:{onboarding_done:true}}),signedOut=false,initialUser=null}={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://recovery.invalid/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.connected=online;Object.defineProperty(w.navigator,'onLine',{get:()=>w.connected});w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.fetch=async()=>({ok:true});w.signedOut=signedOut;w.initialUser=initialUser;
 w.localStorage.setItem('fl-refresh-token',oldToken);w.calls=[];w.setupCalls=0;w.post=(...args)=>{w.calls.push(args);return post(...args)};w.onboard=()=>{w.setupCalls++;return onboard()};
 w.eval(code);
 return{w,d:w.document,text:()=>w.document.body.textContent,event:n=>w.dispatchEvent(new w.Event(n)),close:()=>{w.root.unmount();w.close();}};
}
let a;
try{
 a=mount({online:false});await until(()=>a.text().includes("You're offline"));
 check('offline cold start does not wait for a refresh timeout',a.w.calls.length===0);
 check('offline retry is disabled and account remains closed',a.d.querySelector('button').disabled&&!a.w.auth.getState().user&&!a.text().includes('DailyLog'));
 check('offline start preserves the stored sign-in',a.w.localStorage.getItem('fl-refresh-token')===oldToken);
 a.w.connected=true;a.event('online');a.event('focus');await until(()=>a.text().includes('DailyLog'));
 check('reconnect restores session and opens member home automatically',a.w.auth.getState().user.id===member.id);
 check('online and focus burst sends one refresh',a.w.calls.length===1);
 check('refresh sends fallback and bounded timeout',a.w.calls[0][1].refreshToken===oldToken&&a.w.calls[0][2].timeout===15000);
 check('successful refresh stores rotated fallback',a.w.localStorage.getItem('fl-refresh-token')===newToken);
 a.close();
 let release;a=mount({post:()=>failure(503)});await until(()=>a.text().includes("Couldn't reconnect"));
 check('server outage retains sign-in and shows recovery',a.w.localStorage.getItem('fl-refresh-token')===oldToken&&!a.text().includes('Login'));
 a.w.post=(...args)=>{a.w.calls.push(args);return new Promise(r=>release=r)};
 a.event('focus');await until(()=>release);a.event('online');a.event('focus');await tick();
 check('resume retries once with no overlapping refresh',a.w.calls.length===2);
 release(success());await until(()=>a.text().includes('DailyLog'));check('successful resume reaches home',a.w.auth.getState().user.id===member.id);a.close();
 for(const status of [401,403]){a=mount({post:()=>failure(status)});await until(()=>a.text().includes('Login'));check('confirmed expiry '+status+' clears invalid token',!a.w.localStorage.getItem('fl-refresh-token'));a.event('online');await tick();check('confirmed expiry '+status+' does not auto-retry sign-in',a.w.calls.length===1);a.close();}
 a=mount({post:async()=>({data:{user:member}})});await until(()=>a.text().includes("Couldn't reconnect"));check('malformed refresh cannot open member account',!a.w.auth.getState().user);a.w.post=async()=>success();a.d.querySelector('button').click();await until(()=>a.text().includes('DailyLog'));check('manual retry remains available',a.w.auth.getState().user.id===member.id);a.close();
 a=mount({signedOut:true,online:false});await until(()=>a.text().includes('Login'));check('deliberate sign-out stays signed out offline',a.w.calls.length===0&&!a.w.auth.getState().user);a.close();
 let finish;a=mount({post:()=>new Promise(r=>finish=r)});await until(()=>finish);a.w.auth.setState({user:{...member,id:902},sessionVersion:9,isRestoring:false});finish(success());await tick();check('late refresh cannot replace a newer account',a.w.auth.getState().user.id===902);a.close();
 a=mount({post:()=>new Promise(r=>finish=r)});await until(()=>a.w.calls.length===1);const signal=a.w.calls[0][2].signal;a.w.root.unmount();check('unmount aborts in-flight restore',signal.aborted);finish(success());await tick();check('late unmounted response does not sign in',!a.w.auth.getState().user);a.w.close();
 a=mount({onboard:()=>failure(503)});await until(()=>a.text().includes("Couldn't reach FitLife"));check('unavailable onboarding does not start setup',!a.d.querySelector('h1'));
 a.w.onboard=async()=>{a.w.setupCalls++;return {data:{onboarding_done:true}}};a.event('focus');await until(()=>a.text().includes('DailyLog'));check('onboarding automatically resumes after focus',a.w.setupCalls===2);a.close();
 a=mount({online:false,initialUser:member});await until(()=>a.text().includes("You're offline"));check('offline onboarding avoids unreachable request',a.w.setupCalls===0);a.w.connected=true;a.event('online');await until(()=>a.text().includes('DailyLog'));check('onboarding retries on reconnect',a.w.setupCalls===1);a.close();
 a=mount({post:()=>failure()});await until(()=>a.text().includes("Couldn't reconnect"));Object.defineProperty(a.d,'visibilityState',{configurable:true,value:'hidden'});a.event('focus');await tick();check('hidden app does not trigger recovery traffic',a.w.calls.length===1);Object.defineProperty(a.d,'visibilityState',{configurable:true,value:'visible'});a.w.post=async(...args)=>{a.w.calls.push(args);return success()};a.d.dispatchEvent(new a.w.Event('visibilitychange'));await until(()=>a.text().includes('DailyLog'));check('return to visible app retries failed restore',a.w.calls.length===2);a.close();
 console.log(`Connection recovery: ${passed} passed, 0 failed`);
}catch(e){console.error(e);a?.close();process.exitCode=1;}
