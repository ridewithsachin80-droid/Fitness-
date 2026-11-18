// Render the real App session boundary. Page content and remote transport are
// fixtures; effects, routing, restore/retry and auth changes execute as shipped.
const esbuild = require('esbuild');
const path = require('path');
const { createRequire } = require('module');
const { ROOT, CLIENT_SRC } = require('./client-bundle');

async function runBootCases(ck) {
  console.log('\nP0 cold start — real App restore and session boundary');
  const clientRequire = createRequire(path.join(ROOT,'package.json'));
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>',{url:'https://fitlife.test/'});
  global.window=dom.window; global.document=dom.window.document;
  global.localStorage=dom.window.localStorage; global.sessionStorage=dom.window.sessionStorage;
  Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true,writable:true});
  global.IS_REACT_ACT_ENVIRONMENT=true;
  global.fetch=async()=>({ok:true});
  const React=clientRequire('react');
  const {createRoot}=clientRequire('react-dom/client');
  const {act}=React;
  const source=`export {default as App} from './App'; export {default as axios} from 'axios'; export {useAuthStore} from './store/authStore';`;
  const built=await esbuild.build({stdin:{contents:source,resolveDir:CLIENT_SRC,sourcefile:'session-boot-qa.js'},
    bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',loader:{'.css':'empty'},
    external:['react','react/jsx-runtime','react-dom','react-dom/client','react-router-dom'],
    define:{'import.meta.env':JSON.stringify({DEV:false,MODE:'test'})},
    nodePaths:[path.join(ROOT,'node_modules')],logLevel:'silent',
    plugins:[{name:'app-page-fixtures',setup(build){
      build.onResolve({filter:/(?:pages\/|components\/|hooks\/useOfflineQueue|hooks\/useSync|api\/logs|store\/settingsStore)/},args=>({path:args.path,namespace:'boot-fixture'}));
      build.onLoad({filter:/.*/,namespace:'boot-fixture'},args=>{
        let contents;
        if(args.path.endsWith('.css')) contents='';
        else if(args.path.includes('useOfflineQueue')) contents='export function useOfflineSync() {}';
        else if(args.path.includes('useSync')) contents='export function disconnectSocket() {}';
        else if(args.path.includes('api/logs')) contents='export const getMyOnboarding = async () => ({data:{onboarding_done:true}});';
        else if(args.path.includes('settingsStore')) contents=`export const useSettingsStore=()=>({fontSize:'normal',ageMode:'adult',onboardingDone:false}); useSettingsStore.getState=()=>({finishOnboarding(){},setAvatarIdx(){}}); export function applyTheme(){} export function applyFontSize(){}`;
        else if(args.path.includes('HandsFree')) contents='export default function HandsFree(){return null}';
        else contents=`import React,{useState} from 'react'; export default function Page(){const [draft,setDraft]=useState(''); return React.createElement('section',{'data-page':${JSON.stringify(args.path)}},React.createElement('span',{'data-draft':true},draft),React.createElement('button',{onClick:()=>setDraft('private draft')},'Edit draft'));}`;
        return {contents,loader:'js'};
      });
    }}],
  });
  const mod={exports:{}};
  new Function('module','exports','require',built.outputFiles[0].text)(mod,mod.exports,clientRequire);
  const {App,axios,useAuthStore:auth}=mod.exports;
  const TOKEN='aaaaaaaaaa.bbbbbbbbbb.cccccccccc';
  const user=id=>({id,name:`Member ${id}`,role:'monitor'});
  const response=(config,data)=>({status:200,config,data,headers:{},statusText:'OK'});
  const failure=(config,status)=>new axios.AxiosError(`HTTP ${status}`,'ERR_BAD_RESPONSE',config,null,{status,config});
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  let root;
  const mount=async()=>{root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(App));await flush()})};
  const unmount=async()=>{if(root){await act(async()=>root.unmount());root=null}};
  const reset=()=>{window.history.replaceState({},'','/');localStorage.clear();sessionStorage.clear();auth.setState({user:null,accessToken:null,isRestoring:true,sessionVersion:0});};

  reset(); localStorage.setItem('fl-refresh-token',TOKEN); let timeout,refreshes=0;
  axios.defaults.adapter=async config=>{refreshes++;timeout=config.timeout;throw new axios.AxiosError('offline','ERR_NETWORK',config)};
  await mount();
  ck('cold-start network failure offers retry while preserving the saved credential',document.body.textContent.includes('Try again')&&localStorage.getItem('fl-refresh-token')===TOKEN&&auth.getState().isRestoring);
  ck('cold-start refresh has a 15-second timeout instead of an endless spinner',timeout===15000);
  ck('network failure does not show an anonymous sign-in page',!document.querySelector('[data-page="./pages/Login"]'));
  axios.defaults.adapter=async config=>{refreshes++;return response(config,{accessToken:'new-token',refreshToken:TOKEN,user:user(1)})};
  await act(async()=>{document.querySelector('button').click();await flush();await flush()});
  ck('retry restores the same member without re-entering credentials',auth.getState().user?.id===1&&refreshes===2&&!document.body.textContent.includes('Try again'));
  await act(async()=>{document.querySelector('button').click()});
  ck('authenticated page fixture holds a draft before the boundary test',document.querySelector('[data-draft]')?.textContent==='private draft');
  await act(async()=>{auth.getState().setToken('silently-rotated')});
  ck('silent refresh preserves mounted page state',document.querySelector('[data-draft]')?.textContent==='private draft');
  await act(async()=>{auth.getState().login('other-token',user(2),TOKEN);await flush()});
  ck('another account receives newly mounted pages without the prior draft',auth.getState().user?.id===2&&document.querySelector('[data-draft]')?.textContent==='');
  await unmount();

  reset(); localStorage.setItem('fl-refresh-token',TOKEN);
  axios.defaults.adapter=async config=>{throw failure(config,401)};
  await mount();
  ck('confirmed cold-start expiry clears invalid credential and reaches login',auth.getState().isRestoring===false&&localStorage.getItem('fl-refresh-token')===null&&!!document.querySelector('[data-page="./pages/Login"]'));
  await unmount();

  reset(); localStorage.setItem('fl-signed-out','1'); refreshes=0;
  axios.defaults.adapter=async config=>{refreshes++;return response(config,{accessToken:'old',user:user(1)})};
  await mount();
  ck('deliberate sign-out suppresses cold-start cookie restoration',refreshes===0&&auth.getState().user===null&&!!document.querySelector('[data-page="./pages/Login"]'));
  await unmount();

  reset(); let release;
  axios.defaults.adapter=config=>new Promise(resolve=>{release=()=>resolve(response(config,{accessToken:'old-token',refreshToken:TOKEN,user:user(1)}))});
  await mount();
  await act(async()=>{auth.getState().login('current-token',user(2),TOKEN);release();await flush()});
  ck('late cold-start response cannot replace a newer sign-in',auth.getState().user?.id===2&&auth.getState().accessToken==='current-token');
  await unmount();

  reset();
  axios.defaults.adapter=config=>new Promise(resolve=>{release=()=>resolve(response(config,{accessToken:'old-token',refreshToken:TOKEN,user:user(1)}))});
  await mount(); await unmount(); release(); await flush();
  ck('unmounted restore cannot silently log someone in',auth.getState().user===null);
  dom.window.close();
}
module.exports={runBootCases};
