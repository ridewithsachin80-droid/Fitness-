/** Real Chromium geometry and wheel scrolling against the mounted member
 * assistant and production CSS. All accounts, AI replies and saves are local fixtures. */
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { browserExecutable } from './lib/browser-executable.mjs';
import { readBuiltCss } from './lib/built-css.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'fitlife-chat-scroll-'));
const api=path.join(TMP,'api.js');
fs.writeFileSync(api,`const call=async(method,url,body)=>window.fixtureApi(method,url,body);export default Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(url,body)=>call(method,url,body)]));`);
const code=(await build({stdin:{resolveDir:path.join(ROOT,'client/src'),loader:'jsx',contents:`
import {createRoot} from 'react-dom/client';
import AIChatLog from './components/AIChatLog';
import {useAuthStore} from './store/authStore';import {useLogStore} from './store/logStore';import {useAIChat} from './store/aiChatStore';import {today,emptyLog} from './constants';
useAuthStore.setState({user:{id:214,name:'Scroll Fixture',role:'patient'},isRestoring:false});useLogStore.setState({date:today(),log:emptyLog(),protocol:{activities:[],acv:[],supplements:[]},loading:false,error:null});
window.chat=useAIChat;window.log=useLogStore;window.calls=[];
window.fixtureApi=async(method,url,body)=>{window.calls.push({method,url,body});return {data:[]};};
window.root=createRoot(document.getElementById('root'));window.root.render(<AIChatLog overlay/>);useAIChat.getState().ensureFreshDay(today());useAIChat.getState().openChat('photo');
window.photoReply=()=>useAIChat.getState().setMessages([{role:'user',text:'Photo attached · AI will estimate your meal'}, {role:'ai',text:'Review your plate.',parsed:{foods:Array.from({length:9},(_,i)=>({name:'Plate item '+(i+1),grams:100,meal:'Lunch',on:true,source:'ai',per_100g:{calories:100,protein:10,total_carbs:10,fat:2},macros:{cal:100,pro:10,carb:10,fat:2}})),activities:[],acv:[],supplements:[],workouts:[],corrections:[]}}]);
`},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.js':'jsx','.jsx':'jsx','.css':'empty'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"DEV":false,"PROD":true}'},plugins:[{name:'fixture-api',setup(b){b.onResolve({filter:/(?:^|\/)client$/},args=>/api\/client$/.test(args.path)||args.importer.includes(`${path.sep}api${path.sep}`)?{path:api}:null)}}],logLevel:'silent'})).outputFiles[0].text;
const css=readBuiltCss(path.join(ROOT,'client/dist'));
const shell=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main id="root"></main></body></html>`;
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(shell)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:await browserExecutable(chromium),args:[...chromium.args,'--no-sandbox','--disable-dev-shm-usage'],headless:true});
const pause=(ms=500)=>new Promise(r=>setTimeout(r,ms));let pass=0,fail=0;const ck=(name,ok,detail)=>{console.log(`  ${ok?'✓':'✗'} ${name}${!ok?' '+JSON.stringify(detail):''}`);ok?pass++:fail++};
try{
for(const width of [390,1280])for(const theme of ['light','dark']){
 const page=await browser.newPage();await page.setViewport({width,height:800,isMobile:width<768,hasTouch:width<768,deviceScaleFactor:1});await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.addScriptTag({content:code});await page.waitForSelector('.member-assistant-scroll');await page.evaluate(()=>window.photoReply());await pause(1200);
 const geometry=()=>page.evaluate(()=>{const s=document.querySelector('.member-assistant-scroll'),h=document.querySelector('.member-assistant-head'),o=document.querySelector('.member-assistant-overlay'),c=document.querySelector('[data-testid=composer]');return {top:s.scrollTop,max:s.scrollHeight-s.clientHeight,height:s.clientHeight,rect:s.getBoundingClientRect().toJSON(),header:h.getBoundingClientRect().toJSON(),overlay:o.getBoundingClientRect().toJSON(),composer:c.getBoundingClientRect().toJSON(),inert:!!s.closest('[inert]'),overflow:getComputedStyle(s).overflowY}});
 const label=`${width}px ${theme}`;let g=await geometry();console.log(label,JSON.stringify(g));
 ck(label+' new long reply opens at first item',g.top<200,g);
 ck(label+' nine photo items mount',await page.$$eval('[data-testid=ai-food-review] [aria-label$=" grams"]',nodes=>nodes.length===9));
 ck(label+' has bounded scrolling region',g.max>1000&&g.height>100&&g.rect.bottom<=801&&!g.inert,g);
 await page.mouse.move(width/2,300);await page.mouse.wheel({deltaY:-12000});await pause(800);g=await geometry();ck(label+' wheel reaches first item',g.top<2,g);
 await page.click('[aria-label="Plate item 1 grams"]');await page.keyboard.press('ArrowUp');await pause(1000);g=await geometry();ck(label+' quantity edit preserves first item position',g.top<100,g);

 await page.click('[data-testid=chat-edit-macros]');await pause();await page.keyboard.press('Escape');await pause();g=await geometry();ck(label+' macro dialog returns to upper item',g.top<100&&!g.inert,g);
 await page.mouse.move(width/2,300);await page.mouse.wheel({deltaY:12000});await pause();g=await geometry();ck(label+' wheel reaches last item and Save',g.max-g.top<2,g);
 const reachable=await page.evaluate(()=>{const b=document.querySelector('[data-testid=ai-card-save]').getBoundingClientRect(),c=document.querySelector('[data-testid=composer]').getBoundingClientRect();return b.top>=0&&b.bottom<=c.top;});ck(label+' Save is above composer',reachable);
 await page.mouse.wheel({deltaY:-12000});await pause();g=await geometry();ck(label+' wheel can return to first item after edit',g.top<2,g);
 await page.click('.member-assistant-head button');await pause();await page.evaluate(()=>window.chat.getState().openChat('text'));await pause();g=await geometry();ck(label+' reopening starts at review beginning',g.top<200,g);
 ck(label+' reviewing never saves automatically',await page.evaluate(()=>!window.calls.some(c=>['post','put','patch','delete'].includes(c.method))));
 await page.close();
}
}finally{await browser.close();server.close();fs.rmSync(TMP,{recursive:true,force:true});}
console.log(`\n${pass} passed, ${fail} failed`);if(fail)process.exitCode=1;
