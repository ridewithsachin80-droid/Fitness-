/** Real Today -> Timeline -> FoodSheet interactions with synthetic API data. */
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
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'fitlife-timeline-'));
const api=path.join(TMP,'api.js');
fs.writeFileSync(api,`const call=async(method,url,body)=>window.fixtureApi(method,url,body);export default Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(url,body)=>call(method,url,body)]));`);
const code=(await build({stdin:{resolveDir:path.join(ROOT,'client/src'),loader:'jsx',contents:`
import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
import Today from './pages/Today';import {useAuthStore} from './store/authStore';import {useLogStore} from './store/logStore';import {useSettingsStore} from './store/settingsStore';import {today} from './constants';
useAuthStore.setState({user:{id:214,name:'Timeline fixture',role:'patient'},isRestoring:false});
window.logs=useLogStore;window.settings=useSettingsStore;window.auth=useAuthStore;window.calls=[];
const food=[...Array.from({length:7},(_,i)=>({id:i+1,name:'Breakfast food '+i,meal:'Breakfast',grams:100,per_100g:{calories:100,protein:10,total_carbs:10,fat:2}})),{id:9,name:'Lunch food',meal:'lunch',grams:100,per_100g:{calories:100,protein:10,total_carbs:10,fat:2}},{id:10,name:'Unsorted food',meal:null,grams:50},{id:11,name:'Custom food',meal:'Tea [late]',grams:50}];
window.fixtureApi=async(method,url,body)=>{window.calls.push({method,url,body});if(method!=='get')return {data:{ok:true,...body}};
if(new RegExp("^/logs/[0-9]{4}-[0-9]{2}-[0-9]{2}$").test(url))return {data:{food_items:food,water_ml:0,activities:{},acv:{},supplements:{},protocol:{activities:[],acv:[],supplements:[]}}};
if(url==='/workouts')return {data:{exercises:[],session:null,cardio:[]}};
if(url==='/members/me/read')return {data:{date:today(),read:null}};
if(url==='/members/me/today'||url==='/members/me')return {data:{}};
return {data:[]};};
window.root=createRoot(document.getElementById('root'));window.root.render(<MemoryRouter><Today/></MemoryRouter>);
`},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.js':'jsx','.jsx':'jsx','.css':'empty'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"DEV":false,"PROD":true}'},plugins:[{name:'fixture-api',setup(b){b.onResolve({filter:/(?:^|\/)client$/},args=>/api\/client$/.test(args.path)||args.importer.includes(`${path.sep}api${path.sep}`)?{path:api}:null)}}],logLevel:'silent'})).outputFiles[0].text;
const css=readBuiltCss(path.join(ROOT,'client/dist'));
const shell=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main id="root"></main></body></html>`;
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(shell)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:await browserExecutable(chromium),args:[...chromium.args,'--no-sandbox','--disable-dev-shm-usage'],headless:true});
const pause=(ms=500)=>new Promise(r=>setTimeout(r,ms));let pass=0,fail=0;const ck=(name,ok,detail)=>{console.log(`  ${ok?'✓':'✗'} ${name}${!ok?' '+JSON.stringify(detail):''}`);ok?pass++:fail++};
try{
for(const width of [390,1280])for(const theme of ['light','dark']){
 const page=await browser.newPage();await page.setViewport({width,height:850,deviceScaleFactor:1});await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.addScriptTag({content:code});await page.waitForSelector('[data-testid=home-log-details]');await page.evaluate(t=>window.settings.getState().setTheme(t),theme);await pause(500);
 const click=async sel=>{await page.focus(sel);await page.keyboard.press('Enter');};const label=`${width}px ${theme}`;
 await click('[data-testid=home-log-details] > button');await page.waitForSelector('[data-testid=row-meal]');
 for(const [row,group,title] of [[1,'Lunch','lunch'],[3,'Other','Unsorted'],[2,'Tea [late]','Tea [late]']]){
  const rows=await page.$$('[data-testid=row-meal]');await rows[row].evaluate(e=>e.scrollIntoView({block:'center'}));await pause(150);await rows[row].click();await page.waitForSelector('[data-food-meal-target]');await pause(700);
  const g=await page.evaluate(()=>{const h=document.querySelector('[data-food-meal-target]'),sc=h.closest('[role=dialog]').querySelector('.overflow-y-auto');return{group:h.parentElement.dataset.foodMeal,focused:document.activeElement===h,top:h.getBoundingClientRect().top,scrollTop:sc.scrollTop,scrollRect:sc.getBoundingClientRect().toJSON(),all:document.querySelectorAll('[data-food-meal]').length,heading:document.querySelector('[role=dialog]').getAttribute('aria-label')}});
  ck(label+' '+group+' targets intended section',g.group===group&&g.heading===title,g);
  ck(label+' '+group+' heading is focused and visible',g.focused&&g.top>=g.scrollRect.top-2&&g.top<g.scrollRect.bottom,g);
  ck(label+' '+group+' retains other meals',g.all===5,g);
  await page.keyboard.press('Tab');ck(label+' '+group+' Tab reaches selected meal controls',await page.evaluate(g=>document.activeElement.closest('[data-food-meal]')?.dataset.foodMeal===g,group));
  await page.keyboard.press('Escape');await pause(500);ck(label+' '+group+' returns focus to launcher',await page.evaluate(()=>document.activeElement.matches('[data-testid=row-meal]')));
 }
 await click('[data-testid=plan-eat]');await page.waitForSelector('[role=dialog]');await pause(400);
 ck(label+' general food entry clears meal target',await page.$('[data-food-meal-target]')===null);
 ck(label+' complete editor remains named',await page.$eval('[role=dialog]',e=>e.getAttribute('aria-label')==='What did you eat?'));
 await page.keyboard.press('Escape');await pause(500);
 await page.evaluate(()=>window.logs.setState({date:'2026-10-10'}));await pause(400);
 // 16 Oct 2026: past days now show the AI logging bar too; bring the row to the middle first, as a member would scroll.
 {const r=(await page.$$('[data-testid=row-meal]'))[1];await r.evaluate(e=>e.scrollIntoView({block:'center'}));await pause(200);await r.click();}await pause(700);
 ck(label+' historical meal opens selected group',await page.$eval('[data-food-meal-target]',e=>e.parentElement.dataset.foodMeal==='Lunch'));
 await page.evaluate(()=>window.logs.setState({date:'2026-10-09'}));await pause(150);
 ck(label+' changed date clears stale target',await page.$('[data-food-meal-target]')===null);
 ck(label+' opening and navigation do not write food',await page.evaluate(()=>!window.calls.some(c=>c.method!=='get'&&c.url.startsWith('/logs/'))));
 await page.close();
}
}finally{await browser.close();server.close();fs.rmSync(TMP,{recursive:true,force:true});}
console.log(`\n${pass} passed, ${fail} failed`);if(fail)process.exitCode=1;
