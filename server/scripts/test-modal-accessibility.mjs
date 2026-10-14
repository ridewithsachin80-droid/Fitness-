/** Real Chromium regression for the shared modal scopes. Browser-native focus,
 * keyboard events and inert are exercised against actual Sheet/AI/Progress.
 * API/audio providers are synthetic; no physical-device or screen-reader claim.
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { browserExecutable } from './lib/browser-executable.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'fitlife-modal-accessibility-'));
const SHOTS=process.env.MODAL_SHOTS||path.join(ROOT,'qa/results/modal-accessibility');
const checks=[];let pass=0,fail=0;
const ck=(name,ok,detail='')=>{checks.push({name,status:ok?'Pass':'Fail',detail:ok?'':String(detail)});console.log(`  ${ok?'✓':'✗'} ${name}${ok||!detail?'':': '+String(detail).slice(0,240)}`);ok?pass++:fail++};
const API=path.join(TMP,'api.js');
fs.writeFileSync(API,`import {today,istDaysAgo} from '${path.join(ROOT,'client/src/constants.js')}';
 window.__apiCalls=[];window.__pastDate=istDaysAgo(1);
 const row={log_date:window.__pastDate,weight_kg:'82.4',compliance_pct:90,food_items:[{id:'past-idli',name:'Idli fixture',grams:120,meal:'Breakfast',per_100g:{calories:130,protein:3.5,total_carbs:28,fat:0.8}}],water_ml:2500,activities:{walk:true},acv:{acv1:true},supplements:{b12:true},sleep:{bedtime:'22:15',waketime:'06:30',quality:4},notes:'Historical note fixture'};
 const call=async(method,url,body)=>{window.__apiCalls.push({method,url,body});
 if(method==='get'){
 if(url.startsWith('/logs/range/'))return{data:[row]};
 if(url==='/members/me')return{data:{start_weight:'88',target_weight:'78',height_cm:'172',labs:[]}};
 if(url==='/members/me/weekly-report')return{data:{latest:null,history:[]}};
 if(url==='/workouts')return{data:{session:null,exercises:[],cardio:[]}};
 return{data:[]};}
 return{data:{ok:true,...body}};};
 export default Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(url,body)=>call(method,url,body)]));`);
const ENTRY=`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {createPortal} from 'react-dom';
 import {MemoryRouter} from 'react-router-dom';import Sheet from './components/primitives/Sheet';
 import {AddLabModal,SetPinModal,WeightEntryModal} from './pages/Monitor'; import MilestoneModal from './components/today/MilestoneModal';
 import CoachHistorySheet from './components/coach/CoachHistorySheet'; import MemberCharts from './components/coach/MemberCharts';
 import AIChatLog from './components/AIChatLog';import Progress from './pages/Progress';
 import {useAuthStore} from './store/authStore';import {useLogStore} from './store/logStore';import {useAIChat} from './store/aiChatStore';import {useSettingsStore} from './store/settingsStore';import {today,emptyLog} from './constants';
 useAuthStore.setState({user:{id:214,name:'Accessibility fixture',role:'patient'},isRestoring:false});
 useLogStore.setState({date:today(),log:emptyLog(),protocol:{activities:[],acv:[],supplements:[],meal_plan:[]},loading:false,error:null});
 useAIChat.getState().ensureFreshDay(today());window.__chat=useAIChat;window.__settings=useSettingsStore;window.__auth=useAuthStore;
 function CoachHistoryFixture(){const [log,setLog]=useState(null),[single,setSingle]=useState(false);
 const rows=[{log_date:'2026-10-10',weight_kg:82.4,compliance_pct:90,water_ml:2500,notes:'History note '+('LongNote'.repeat(90)),food_items:Array.from({length:24},(_,i)=>({name:'History oats '+i,grams:100,meal:'Breakfast',per_100g:{calories:374}}))},{log_date:'2026-10-11',compliance_pct:0,water_ml:500},{log_date:'2026-10-12',notes:'Notes-only day'},{log_date:'2026-10-13'}];
 window.__singleHistory=()=>setSingle(true);
 return <><main id="fixture-background"><MemberCharts weightData={[]} complianceData={(single?rows.slice(1,2):rows).map(log=>({date:log.log_date,score:log.compliance_pct||0,log}))} avg30={30} profile={{}} setSelectedLog={setLog}/></main><CoachHistorySheet log={log} onClose={()=>setLog(null)}/></>}
 function LegacyFixture(){const [which,setWhich]=useState(null);return <><main id="fixture-background">{['lab','pin','weight','milestone'].map(k=><button id={'open-'+k} key={k} onClick={()=>setWhich(k)}>{k}</button>)}</main>{which==='lab'&&<AddLabModal memberId={214} onClose={()=>setWhich(null)} onAdded={()=>{}}/>}{which==='pin'&&<SetPinModal memberId={214} memberName="Test member" onClose={()=>setWhich(null)} onSaved={()=>{}}/>}{which==='weight'&&<WeightEntryModal memberId={214} memberName="Test member" onClose={()=>setWhich(null)} onSaved={()=>{}}/>}{which==='milestone'&&<MilestoneModal milestone={{title:'Seven days',body:'Keep going',icon:'flame'}} onClose={()=>setWhich(null)}/>}</>}
 function SheetFixture(){const [parent,setParent]=useState(false),[child,setChild]=useState(false),[empty,setEmpty]=useState(false),[mounted,setMounted]=useState(true),[opener,setOpener]=useState(true),[late,setLate]=useState(false),[draft,setDraft]=useState(''),[version,setVersion]=useState(0);
 window.__control={bump:()=>setVersion(v=>v+1),dropParent:()=>setMounted(false),removeOpener:()=>setOpener(false),addPortal:()=>setLate(true),openChild:()=>setChild(true)};
 return <><main id="fixture-background" style={{padding:16}}>{opener&&<button id="open-parent" onClick={()=>setParent(true)}>Open parent</button>}<button id="open-empty" onClick={()=>setEmpty(true)}>Open empty</button><input id="outside-input" aria-label="Outside input"/><span id="version">{version}</span></main>
 {mounted&&<Sheet open={parent} onClose={()=>setParent(false)} title="Parent fixture"><button id="disabled-control" disabled>Disabled</button><button id="hidden-control" hidden>Hidden</button><button id="display-hidden" style={{display:'none'}}>Display hidden</button><button id="visibility-hidden" style={{visibility:'hidden'}}>Visibility hidden</button><div aria-hidden="true"><button id="aria-hidden-control">Aria hidden</button></div><div inert><button id="inert-control">Inert</button></div><fieldset disabled><button id="fieldset-disabled">Disabled group</button></fieldset><button id="negative-tab" tabIndex={-1}>Programmatic only</button><label>First field<input id="parent-first"/></label><label>Editable draft<input id="parent-edit" value={draft} onChange={e=>setDraft(e.target.value)}/></label><button id="open-child" onClick={()=>setChild(true)}>Open child</button><div aria-hidden="true" style={{height:1000}}/><button id="parent-last">Last action</button></Sheet>}
 <div onKeyDown={e=>e.stopPropagation()}><Sheet open={child} onClose={()=>setChild(false)} title="Child fixture"><label>Child field<input id="child-first"/></label><button id="child-last">Child last action</button></Sheet></div>
 <Sheet open={empty} onClose={()=>setEmpty(false)}><p>No interactive content</p></Sheet>
 {late&&createPortal(<button id="late-body-portal">Late background portal</button>,document.body)}</>;
 }
 function InitialFixture(){React.useEffect(()=>{window.__initialMounts=(window.__initialMounts||0)+1},[]);const[parent,setParent]=useState(true),[child,setChild]=useState(true);return <Sheet open={parent} title="Initial parent" onClose={()=>setParent(false)}><input id="initial-parent-field"/><Sheet open={child} title="Initial child" onClose={()=>setChild(false)}><input id="initial-child-field"/></Sheet></Sheet>}
 function AI(){return <><main id="fixture-background" style={{padding:16}}><button id="launch-type" onClick={()=>useAIChat.getState().openChat('text')}>Type</button><button id="launch-speak" onClick={()=>useAIChat.getState().openChat('voice')}>Speak</button><button id="launch-snap" onClick={()=>useAIChat.getState().openChat('photo')}>Snap</button><input id="outside-input" aria-label="Outside input"/></main><AIChatLog overlay/></>}
 window.__seedReview=()=>useAIChat.getState().setMessages([{role:'ai',text:'Review fixture oats',parsed:{foods:[{name:'Oats',grams:150,meal:'Breakfast',on:true,label:true,per_100g:{calories:374,protein:13.2,total_carbs:60,fat:7.8},macros:{cal:561,pro:19.8,carb:90,fat:11.7}}],activities:[],acv:[],supplements:[],workouts:[],corrections:[]}}]);
 window.__root=createRoot(document.getElementById('root'));window.__root.render(window.__fixtureMode==='coachHistory'?<CoachHistoryFixture/>:window.__fixtureMode==='legacy'?<LegacyFixture/>:window.__fixtureMode==='initial'?<React.StrictMode><InitialFixture/></React.StrictMode>:window.__fixtureMode==='ai'?<AI/>:window.__fixtureMode==='progress'?<MemoryRouter initialEntries={['/progress?tab=reports']}><Progress/></MemoryRouter>:<SheetFixture/>);
`;
async function assets(){
 const clientRequire=createRequire(path.join(ROOT,'client/package.json'));
 const postcss=clientRequire('postcss'),tailwind=clientRequire('tailwindcss'),autoprefixer=clientRequire('autoprefixer');
 const config=(await import(path.join(ROOT,'client/tailwind.config.js'))).default;
 const css=(await postcss([tailwind({...config,content:config.content.map(p=>path.resolve(ROOT,'client',p))}),autoprefixer]).process(fs.readFileSync(path.join(ROOT,'client/src/index.css'),'utf8'),{from:path.join(ROOT,'client/src/index.css')})).css;
 const bundleMode=async mode=>(await build({stdin:{contents:ENTRY,resolveDir:path.join(ROOT,'client/src'),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.js':'jsx','.jsx':'jsx','.css':'empty'},define:{'process.env.NODE_ENV':JSON.stringify(mode),'import.meta.env':'{"DEV":false,"PROD":true}'},plugins:[{name:'synthetic-modal-api',setup(b){b.onResolve({filter:/(?:^|\/)client$/},args=>/api\/client$/.test(args.path)||args.importer.includes(`${path.sep}api${path.sep}`)?{path:API}:null)}}],logLevel:'silent'})).outputFiles[0].text;
 const code=await bundleMode('production'),strictCode=await bundleMode('development');
 return{code,strictCode,css};
}
const selector=name=>`[role="dialog"][aria-label="${name}"]`;
const active=page=>page.evaluate(()=>({id:document.activeElement.id,testid:document.activeElement.dataset.testid,close:document.activeElement.hasAttribute('data-sheet-close'),dialog:document.activeElement.closest('[role="dialog"]')?.getAttribute('aria-label')}));
const click=(page,sel)=>page.locator(sel).setTimeout(8000).click();
const wait=async(page,fn,...args)=>page.waitForFunction(fn,{timeout:6000},...args);
async function closeDialog(page,label){await page.keyboard.press('Escape');await wait(page,label=>!document.querySelector(`[role="dialog"][aria-label="${label}"]`),label)}
async function section(name,fn){console.log('\n'+name);try{await fn()}catch(error){ck(name+' completes',false,error.stack)}}
let browser,server,url,code,strictCode;
async function pageFor(mode='sheet',theme='light',width=390,large=false){
 const page=await browser.newPage();await page.setViewport({width,height:900,deviceScaleFactor:1});
 page.__errors=[];page.on('pageerror',error=>page.__errors.push(error.message));
 await page.goto(url);await page.evaluate(({mode,theme,large})=>{
  window.__fixtureMode=mode;document.documentElement.dataset.theme=theme;if(large)document.documentElement.style.fontSize='20px';
  document.body.style.overflow='scroll';document.body.style.setProperty('overflow-x','clip');document.body.style.setProperty('overflow-y','auto','important');document.body.style.paddingRight='7px';window.__bodyStyles=()=>JSON.stringify(['overflow','overflow-x','overflow-y','padding-right'].map(n=>[n,document.body.style.getPropertyValue(n),document.body.style.getPropertyPriority(n)]));window.__initialBodyStyle=window.__bodyStyles();
  window.__micRequests=0;window.__stoppedTracks=0;
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{window.__micRequests++;throw Object.assign(new Error('Synthetic permission denied'),{name:'NotAllowedError'})}}});
  window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;
 },{mode,theme,large});
 await page.addScriptTag({content:mode==='initial'?strictCode:code});await wait(page,()=>!!window.__chat&&(!!document.getElementById('root').firstChild||!!document.querySelector('[role=dialog]')));await page.evaluate(theme=>window.__settings.getState().setTheme(theme),theme);return page;
}
async function sheetKeyboard(){const page=await pageFor();try{
 await click(page,'#open-parent');await wait(page,()=>document.activeElement.closest('[aria-label="Parent fixture"]'));
 ck('opening Sheet moves focus into its named dialog',(await active(page)).dialog==='Parent fixture');
 await page.focus('#parent-last');await page.keyboard.press('Tab');ck('Tab from final Sheet action wraps to the first allowed control',(await active(page)).close);
 await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');ck('Shift+Tab wraps from first control to final action',(await active(page)).id==='parent-last');
 await page.keyboard.press('Tab');await page.keyboard.press('Tab');ck('Tab skips disabled, hidden, inert, aria-hidden and negative-tab controls',(await active(page)).id==='parent-first',JSON.stringify(await active(page)));
 await page.focus('#parent-edit');await page.keyboard.type('Member draft remains');await page.evaluate(()=>window.__control.bump());
 ck('typing and unrelated rerenders keep the caret in the edited field',await page.$eval('#parent-edit',el=>document.activeElement===el&&el.value==='Member draft remains'&&el.selectionStart===el.value.length));
 await page.evaluate(()=>document.getElementById('outside-input').focus());ck('native inert blocks programmatic focus into the background',(await active(page)).id==='parent-edit');
 await page.focus('#open-child');await page.keyboard.press('Tab');
 await wait(page,()=>{const r=document.querySelector('#parent-last').getBoundingClientRect(),p=document.querySelector('[aria-label="Parent fixture"]').getBoundingClientRect();return r.top>=p.top&&r.bottom<=Math.min(innerHeight,p.bottom)+1});
 ck('Tab scrolls a lower control into view in a long Sheet',(await active(page)).id==='parent-last');
 await click(page,'#open-child');await wait(page,()=>document.activeElement.closest('[aria-label="Child fixture"]'));
 ck('nested Sheet makes the parent inert while its own controls remain active',await page.evaluate(()=>!!document.querySelector('[aria-label="Parent fixture"]').closest('[inert]')&&!document.querySelector('#child-first').closest('[inert]')));
 await page.focus('#child-last');await page.keyboard.press('Tab');ck('nested Sheet traps Tab within the top dialog',(await active(page)).dialog==='Child fixture'&&(await active(page)).close);
 await page.evaluate(()=>{window.__childBeforeExit=document.querySelector('[aria-label="Child fixture"]')});await page.keyboard.press('Escape');await page.evaluate(()=>window.__control.openChild());
 await wait(page,()=>document.activeElement.closest('[aria-label="Child fixture"]')&&!document.querySelector('#child-first').closest('[inert]'));
 ck('quick reopen reuses the exiting Sheet without stale inert or aria-hidden',await page.evaluate(()=>document.querySelector('[aria-label="Child fixture"]')===window.__childBeforeExit&&!document.querySelector('#child-first').closest('[inert],[aria-hidden="true"]')));
 ck('quickly reopened child receives top-modal focus',(await active(page)).dialog==='Child fixture');
 await closeDialog(page,'Child fixture');ck('Escape crosses stopped outer React bubbling and closes only the top Sheet',await page.$(selector('Parent fixture'))!==null&&await page.$(selector('Child fixture'))===null);
 ck('closing nested Sheet returns focus to its own launcher',(await active(page)).id==='open-child');
 await closeDialog(page,'Parent fixture');ck('closing final Sheet returns focus to the original background launcher',(await active(page)).id==='open-parent');
 ck('all shared scroll-lock styles restore exactly after final close',await page.evaluate(()=>window.__bodyStyles()===window.__initialBodyStyle));
 ck('Sheet keyboard flow has no runtime exceptions',page.__errors.length===0,page.__errors);
 }finally{await page.close()}}
async function initialNested(){const page=await pageFor('initial');try{
 await wait(page,()=>document.activeElement.closest('[aria-label="Initial child"]'));
 await wait(page,()=>window.__initialMounts>=2);
 ck('initially-open nested Sheet remains topmost through StrictMode effect replay',(await active(page)).dialog==='Initial child'&&await page.evaluate(()=>window.__initialMounts===2));
 ck('initially-open parent is inert while child receives focus',await page.$eval('#initial-parent-field',el=>!!el.closest('[inert]')));
 await closeDialog(page,'Initial child');ck('initial child Escape preserves and focuses the parent',(await active(page)).dialog==='Initial parent');
 await closeDialog(page,'Initial parent');ck('initial nested cleanup restores body styles and background attributes',await page.evaluate(()=>window.__bodyStyles()===window.__initialBodyStyle&&!document.getElementById('root').hasAttribute('inert')));
 }finally{await page.close()}}
async function isolationAndCleanup(){const page=await pageFor();try{
 await click(page,'#open-parent');await wait(page,()=>document.activeElement.closest('[aria-label="Parent fixture"]'));
 ck('open modal locks document scrolling',await page.evaluate(()=>document.body.style.overflow==='hidden'));
 ck('background root is inert and hidden from assistive technology',await page.$eval('#root',el=>el.inert&&el.getAttribute('aria-hidden')==='true'));
 await page.evaluate(()=>window.__control.addPortal());await wait(page,()=>document.getElementById('late-body-portal')?.inert);
 ck('dynamically added background portals become inert and aria-hidden',await page.$eval('#late-body-portal',el=>el.inert&&el.getAttribute('aria-hidden')==='true'));
 await click(page,'#open-child');await wait(page,()=>document.activeElement.closest('[aria-label="Child fixture"]'));
 await page.evaluate(()=>window.__control.dropParent());await wait(page,()=>!document.querySelector('[aria-label="Parent fixture"]'));
 ck('out-of-order parent unmount keeps remaining top modal active and scroll locked',await page.evaluate(()=>document.body.style.overflow==='hidden'&&!document.querySelector('#child-first').closest('[inert]')));
 await closeDialog(page,'Child fixture');
 ck('out-of-order modal cleanup restores the original body styles',await page.evaluate(()=>window.__bodyStyles()===window.__initialBodyStyle));
 ck('background attributes are restored including pre-existing aria-hidden and inert',await page.evaluate(()=>!document.getElementById('root').hasAttribute('inert')&&!document.getElementById('root').hasAttribute('aria-hidden')&&document.getElementById('pre-hidden').getAttribute('aria-hidden')==='true'&&document.getElementById('pre-false').getAttribute('aria-hidden')==='false'&&document.getElementById('pre-inert').inert));
 ck('dynamic portal attributes return to their original absent state',await page.$eval('#late-body-portal',el=>!el.hasAttribute('inert')&&!el.hasAttribute('aria-hidden')));
 ck('removed nested opener never leaves focus in a detached or inert subtree',await page.evaluate(()=>document.activeElement.isConnected&&!document.activeElement.closest('[inert]')));
 }finally{await page.close()}
 const second=await pageFor();try{
 await click(second,'#open-empty');await wait(second,()=>document.activeElement.getAttribute('role')==='dialog');
 ck('empty Sheet focuses its dialog container when no controls exist',(await active(second)).dialog==='Sheet');
 await second.keyboard.press('Tab');await second.keyboard.down('Shift');await second.keyboard.press('Tab');await second.keyboard.up('Shift');
 ck('empty Sheet retains keyboard focus for Tab and Shift+Tab',await second.evaluate(()=>document.activeElement.getAttribute('role')==='dialog'));
 await closeDialog(second,'Sheet');ck('empty Sheet Escape returns focus to its opener',(await active(second)).id==='open-empty');
 await click(second,'#open-parent');await wait(second,()=>document.activeElement.closest('[aria-label="Parent fixture"]'));await second.evaluate(()=>window.__control.removeOpener());await closeDialog(second,'Parent fixture');
 ck('removed original opener closes cleanly with a connected usable focus target',await second.evaluate(()=>document.activeElement.isConnected&&!document.activeElement.closest('[inert]')&&window.__bodyStyles()===window.__initialBodyStyle));
 }finally{await second.close()}}
function contrast(rgb1,rgb2){const lum=rgb=>{const c=rgb.match(/[\d.]+/g).slice(0,3).map(n=>Number(n)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};const a=lum(rgb1),b=lum(rgb2);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
async function visualMatrix(){for(const theme of ['light','dark']){const page=await pageFor('sheet',theme,320,true);try{
 await click(page,'#open-parent');await wait(page,()=>document.activeElement.closest('[aria-label="Parent fixture"]'));await page.focus('#parent-last');await page.keyboard.press('Tab');
 const focus=await page.evaluate(()=>{const el=document.activeElement,c=getComputedStyle(el),panel=el.closest('[role=dialog]');return{width:parseFloat(c.outlineWidth),style:c.outlineStyle,color:c.outlineColor,bg:getComputedStyle(panel).backgroundColor,visible:el.matches(':focus-visible')}});
 ck(`${theme} 320px enlarged-text Sheet has a visible keyboard focus outline`,focus.visible&&focus.width>=2&&focus.style!=='none',JSON.stringify(focus));
 ck(`${theme} keyboard outline contrasts with the Sheet surface by at least 3:1`,contrast(focus.color,focus.bg)>=3,JSON.stringify(focus));
 ck(`${theme} 320px enlarged-text Sheet close action is at least44×44px`,await page.$eval(`${selector('Parent fixture')} [data-sheet-close]`,el=>{const r=el.getBoundingClientRect();return r.width>=44&&r.height>=44}));
 ck(`${theme} 320px enlarged-text Sheet has no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:path.join(SHOTS,`sheet-${theme}-320-large.png`)});
 }finally{await page.close()}}}
async function aiNestedAndLabels(){for(const theme of ['light','dark']){const page=await pageFor('ai',theme,320,true);try{
 await click(page,'#launch-type');ck(`${theme} Type still focuses the composer from one tap`,await page.$eval('[data-testid="composer-input"]',el=>document.activeElement===el));
 await page.keyboard.type('Keep this unsent member draft');await page.evaluate(()=>window.__seedReview());
 await click(page,'[data-testid="chat-edit-macros"]');await wait(page,()=>document.activeElement.closest('[role=dialog]')?.getAttribute('aria-label').startsWith('Oats'));
 const dialog=selector('Oats · 150 g');
 ck(`${theme} nested macro editor isolates both AI thread and portaled composer`,await page.evaluate(()=>!!document.querySelector('.member-assistant-overlay').closest('[inert]')&&!!document.querySelector('[data-testid="composer"]').closest('[inert]')&&!document.querySelector('[data-testid="macro-editor"]').closest('[inert]')));
 ck(`${theme} macro inputs expose nutrient labels and gram/basis descriptions`,await page.evaluate(()=>['protein','carbs','fat'].every(k=>{const el=document.querySelector(`[data-testid="macro-in-${k}"]`);return el.labels?.[0]?.textContent.trim()&&document.getElementById(el.getAttribute('aria-describedby'))?.textContent.includes('per 100 grams')})));
 ck(`${theme} macro input, remember-label, forget and close targets meet44px height`,await page.evaluate(()=>{const q=s=>document.querySelector(s);return['protein','carbs','fat'].every(k=>q(`[data-testid="macro-in-${k}"]`).getBoundingClientRect().height>=44)&&q('[data-testid="macro-remember"]').closest('label').getBoundingClientRect().height>=44&&q('[data-testid="macro-forget"]').getBoundingClientRect().height>=44&&q('[data-testid="macro-editor"]').closest('[role=dialog]').querySelector('[data-sheet-close]').getBoundingClientRect().height>=44}));
 await page.focus('[data-testid="macro-in-protein"]');await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.type('-1');await click(page,'[data-testid="macro-save"]');await page.waitForSelector('[data-testid="macro-error"]');
 ck(`${theme} macro validation failure has alert semantics`,await page.$eval('[data-testid="macro-error"]',el=>el.getAttribute('role')==='alert'));
 await click(page,'[data-testid="macro-forget"]');await page.waitForSelector('[data-testid="macro-note"]');ck(`${theme} successful macro-label removal exposes a polite status`,await page.$eval('[data-testid="macro-note"]',el=>el.getAttribute('role')==='status'));
 ck(`${theme} 320px enlarged-text AI macro editor has no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 // Error/status rows resize the Sheet. Wait for the selected pill's layout
 // spring to settle before certifying readability or saving visual evidence.
 const pillAligned=()=>{const tab=document.querySelector('[data-testid="macro-editor"] [role="tab"][aria-selected="true"]'),pill=tab?.querySelector(':scope > span[aria-hidden="true"]');if(!tab||!pill)return false;const a=tab.getBoundingClientRect(),b=pill.getBoundingClientRect();return ['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<=0.5)};
 await wait(page,pillAligned);
 ck(`${theme} macro selected indicator aligns with its tab after layout changes`,await page.evaluate(pillAligned));
 await page.screenshot({path:path.join(SHOTS,`ai-macro-${theme}-320-large.png`)});

 await closeDialog(page,'Oats · 150 g');
 ck(`${theme} nested Escape keeps AI open and returns to macro launcher`,await page.$('.member-assistant-overlay')!==null&&(await active(page)).testid==='chat-edit-macros');
 ck(`${theme} macro close preserves the unsent composer draft`,await page.$eval('[data-testid="composer-input"]',el=>el.value==='Keep this unsent member draft'));
 await page.focus('[aria-label="Send"]');await page.keyboard.press('Tab');ck(`${theme} AI traps Tab across the separate thread and composer portals`,await page.evaluate(()=>document.activeElement.getAttribute('aria-label')==='Close AI assistant'));
 await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');ck(`${theme} AI Shift+Tab wraps back into the portaled composer`,await page.evaluate(()=>document.activeElement.getAttribute('aria-label')==='Send'));
 await page.keyboard.press('Escape');await wait(page,()=>!document.querySelector('.member-assistant-overlay'));ck(`${theme} closing AI returns focus to its original launcher`,(await active(page)).id==='launch-type');
 ck(`${theme} AI nested flow has no runtime exceptions`,page.__errors.length===0,page.__errors);
 }finally{await page.close()}}}
async function captureAndHistory(){const page=await pageFor('ai');try{
 await click(page,'#launch-speak');await wait(page,()=>window.__micRequests===1&&document.querySelector('[data-testid="voice-composer"]'));
 ck('Speak still starts one microphone request from the original tap',await page.evaluate(()=>window.__micRequests===1));
 ck('voice transcript has an explicit label and linked status/error descriptions',await page.evaluate(()=>{const el=[...document.querySelectorAll('textarea')].find(e=>[...e.labels||[]].some(l=>l.textContent==='Voice transcript'));const ids=el?.getAttribute('aria-describedby')?.split(' ')||[];return!!el&&ids.length>=2&&ids.every(id=>document.getElementById(id)?.getAttribute('role')==='status')}));
 ck('permission failure leaves a readable polite voice status',await page.evaluate(()=>[...document.querySelectorAll('[data-testid="voice-composer"] [role=status]')].some(el=>el.getAttribute('aria-live')==='polite'&&/microphone|permission/i.test(el.textContent))));
 await click(page,'[aria-label="Close AI assistant"]');await wait(page,()=>!document.querySelector('.member-assistant-overlay'));ck('Speak modal returns focus to its own launcher',(await active(page)).id==='launch-speak');
 const [chooser]=await Promise.all([page.waitForFileChooser(),click(page,'#launch-snap')]);
 ck('Snap still opens the native capture chooser from one tap',!!chooser&&await page.$eval('[data-testid="ai-camera-input"]',el=>el.getAttribute('capture')==='environment'));await chooser.cancel();
 await click(page,'[aria-label="Close AI assistant"]');await wait(page,()=>!document.querySelector('.member-assistant-overlay'));ck('Snap modal restores focus after cancelling the picker',(await active(page)).id==='launch-snap');
 }finally{await page.close()}
 for(const theme of ['light','dark']){const p=await pageFor('progress',theme,320,true);try{
 await wait(p,()=>!!document.querySelector(`[data-testid="heat-cell"][data-date="${window.__pastDate}"]`));
 const target=await p.evaluate(()=>`[data-testid="heat-cell"][data-date="${window.__pastDate}"]`);await p.focus(target);await p.evaluate(s=>window.__historyOpener=document.querySelector(s),target);await p.keyboard.press('Enter');await p.waitForSelector('[data-testid="past-log-details"]');
 await wait(p,()=>document.querySelector('[data-testid="past-log-details"]').closest('[role=dialog]').contains(document.activeElement));
 ck(`${theme} historical log opens in a named shared dialog with focus`,await p.$eval('[data-testid="past-log-details"]',el=>!!el.closest('[role=dialog]').getAttribute('aria-label')));
 ck(`${theme} history Sheet retains all existing daily log data`,await p.$eval('[data-testid="past-log-details"]',el=>['82.4','90%','Idli fixture','120g','Breakfast','2.5','Vitamin B12','22:15','06:30','Historical note fixture'].every(t=>el.textContent.includes(t))));
 ck(`${theme} historical log close target is44px and large-text layout fits320px`,await p.evaluate(()=>{const b=document.querySelector('[data-testid="past-log-details"]').closest('[role=dialog]').querySelector('[data-sheet-close]'),r=b.getBoundingClientRect();return r.width>=44&&r.height>=44&&document.documentElement.scrollWidth<=innerWidth+1}));
 await p.screenshot({path:path.join(SHOTS,`history-${theme}-320-large.png`)});await p.keyboard.press('Escape');await wait(p,()=>!document.querySelector('[data-testid="past-log-details"]'));
 ck(`${theme} history Escape restores focus to the original calendar cell`,await p.evaluate(()=>document.activeElement===window.__historyOpener));
 ck(`${theme} Progress history has no runtime exceptions`,p.__errors.length===0,p.__errors);
 }finally{await p.close()}}
}
async function legacyDialogs(){for(const theme of ['light','dark']){const p=await pageFor('legacy',theme,320,true);try{
 for(const [kind,title] of [['lab','Add Lab Value'],['pin','Set Login PIN'],['weight','Log Weight'],['milestone','Milestone']]){
 await p.focus('#open-'+kind);await p.keyboard.press('Enter');await p.waitForSelector(selector(title));
 await wait(p,t=>document.querySelector(`[role=dialog][aria-label="${t}"]`).contains(document.activeElement),title);
 ck(`${theme} ${kind} opens with focus inside a named dialog`,(await active(p)).dialog===title);
 ck(`${theme} ${kind} isolates background and fits enlarged text at320px`,await p.evaluate(()=>document.getElementById('root').inert&&document.documentElement.scrollWidth<=innerWidth+1));
 ck(`${theme} ${kind} has labelled fields and44px close control`,await p.$eval(selector(title),d=>[...d.querySelectorAll('input')].every(e=>!!e.getAttribute('aria-label'))&&d.querySelector('[data-sheet-close]').getBoundingClientRect().height>=44));
 if(kind==='lab'){await p.$eval(selector(title)+' button:not([data-sheet-close])',b=>b.click());await wait(p,()=>!!document.querySelector('[role=alert]'));ck(`${theme} lab validation announces errors without losing the form`,await p.$eval('[role=alert]',e=>e.textContent.includes('required')));}
 await closeDialog(p,title);ck(`${theme} ${kind} Escape restores original launcher focus`,(await active(p)).id==='open-'+kind);
 }
 for(const [kind,title,fields,url,method] of [
 ['lab','Add Lab Value',{'Test name':'Fixture lab','Value':'6.2','Unit':'%'},'/members/214/labs','post'],
 ['pin','Set Login PIN',{'New PIN':'4638','Confirm PIN':'4638'},'/members/214/pin','patch'],
 ['weight','Log Weight',{'Weight (kg)':'82.4'},'/members/214/weight','patch']]){
 await click(p,'#open-'+kind);await p.waitForSelector(selector(title));
 for(const [label,value] of Object.entries(fields))await p.type('input[aria-label="'+label+'"]',value);
 await p.evaluate(t=>{const d=document.querySelector(`[role=dialog][aria-label="${t}"]`);[...d.querySelectorAll('button')].find(b=>/^(Add Lab Value|Set PIN|Save Weight)$/.test(b.textContent.trim())).click()},title);
 await wait(p,u=>window.__apiCalls.some(c=>c.url===u),url);
 ck(`${theme} ${kind} saves using the existing member endpoint`,await p.evaluate((u,m)=>window.__apiCalls.filter(c=>c.url===u&&c.method===m).length===1,url,method));
 ck(`${theme} ${kind} preserves submitted values`,await p.evaluate((u,k)=>{const b=window.__apiCalls.find(c=>c.url===u).body;return k==='lab'?b.test_name==='Fixture lab'&&b.value==='6.2'&&b.unit==='%':k==='pin'?b.pin==='4638':b.weight_kg===82.4&&!!b.date},url,kind));
 await wait(p,t=>!document.querySelector(`[role=dialog][aria-label="${t}"]`),title);
 }
 ck(`${theme} migrated dialogs have no runtime exceptions`,p.__errors.length===0,p.__errors);
 }finally{await p.close()}}}

async function coachHistory(){for(const theme of ['light','dark']){const p=await pageFor('coachHistory',theme,320,true);try{
 const choose=async value=>{await p.focus('select[aria-label="Review a day"]');await p.select('select[aria-label="Review a day"]',value);await p.waitForSelector('[data-testid="coach-history"]');await wait(p,()=>document.querySelector('[role=dialog]').contains(document.activeElement));};
 const close=async()=>{await p.keyboard.press('Escape');await wait(p,()=>!document.querySelector('[data-testid="coach-history"]'));};
 ck(`${theme} coach history selector exposes all logged dates including zero score`,await p.$$eval('select option',es=>es.length===5&&es.some(e=>e.textContent.includes('2026-10-11')&&e.textContent.includes('0%'))));
 await choose('0');
 ck(`${theme} coach history preserves date weight compliance food quantity meal calories water and notes`,await p.$eval('[role=dialog]',e=>['2026','82.4 kg','90%','History oats 23','100g','Breakfast','374 kcal','8976 kcal','2.5 L','History note'].every(v=>e.textContent.includes(v))));
 ck(`${theme} coach history has focus and isolates the background`,await p.evaluate(()=>document.querySelector('[role=dialog]').contains(document.activeElement)&&document.getElementById('root').inert));
 ck(`${theme} long coach history fits enlarged text at320px`,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 ck(`${theme} long coach history can scroll to the final note`,await p.evaluate(()=>{const content=document.querySelector('[data-testid="coach-history"]').parentElement;content.scrollTop=content.scrollHeight;return content.scrollTop>0&&content.scrollTop+content.clientHeight>=content.scrollHeight-2}));
 await close();
 ck(`${theme} closing history restores selector focus and scrolling`,await p.evaluate(()=>document.activeElement.getAttribute('aria-label')==='Review a day'&&window.__bodyStyles()===window.__initialBodyStyle));
 await choose('0');ck(`${theme} the same day can be reopened`,!!await p.$('[data-testid="coach-history"]'));await close();
 await choose('1');ck(`${theme} water-only zero-score day is not reported empty`,await p.$eval('[data-testid="coach-history"]',e=>e.textContent.includes('0.5 L')&&e.textContent.includes('0%')&&!e.textContent.includes('No data recorded')));await close();
 await choose('2');ck(`${theme} notes-only day is not reported empty`,await p.$eval('[data-testid="coach-history"]',e=>e.textContent.includes('Notes-only day')&&!e.textContent.includes('No data recorded')));await close();
 await choose('3');ck(`${theme} truly empty day has its existing empty message`,await p.$eval('[data-testid="coach-history"]',e=>e.textContent.includes('No data recorded')));await close();
 await p.evaluate(()=>window.__singleHistory());await wait(p,()=>document.querySelectorAll('select option').length===2);await choose('0');ck(`${theme} a single logged day remains available`,await p.$eval('[data-testid="coach-history"]',e=>e.textContent.includes('0.5 L')));await close();
 ck(`${theme} reviewing history makes no write requests`,await p.evaluate(()=>window.__apiCalls.every(c=>c.method==='get')));
 ck(`${theme} coach history has no runtime exceptions`,p.__errors.length===0,p.__errors);
 }finally{await p.close()}}}

try{
 fs.mkdirSync(SHOTS,{recursive:true});const files=await assets();code=files.code;strictCode=files.strictCode;
 const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+files.css+'</style></head><body><div id="root"></div><div id="pre-hidden" aria-hidden="true">Already hidden</div><div id="pre-false" aria-hidden="false">Explicit false</div><div id="pre-inert" inert>Already inert</div></body></html>';
 server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(html)});await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;
 const puppeteer=(await import('puppeteer-core')).default,chromium=(await import('@sparticuz/chromium')).default;
 browser=await puppeteer.launch({executablePath:await browserExecutable(chromium),args:[...chromium.args,'--no-sandbox','--disable-dev-shm-usage'],headless:true});
 await section('Coach daily history',coachHistory);await section('Migrated staff and milestone dialogs',legacyDialogs);await section('Sheet keyboard behavior',sheetKeyboard);await section('Initially open nested Sheets and StrictMode',initialNested);await section('Modal background isolation and lifecycle cleanup',isolationAndCleanup);
 await section('Keyboard focus appearance and enlarged-text Sheet layout',visualMatrix);await section('AI nested macro scope and semantic controls',aiNestedAndLabels);
 await section('One-tap input routing and historical log Sheet',captureAndHistory);
}catch(error){ck('modal accessibility suite setup',false,error.stack)}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));fs.rmSync(TMP,{recursive:true,force:true})}
console.log(`\ntest-modal-accessibility: ${pass} passed, ${fail} failed`);
if(process.env.MODAL_RESULTS){fs.mkdirSync(path.dirname(process.env.MODAL_RESULTS),{recursive:true});fs.writeFileSync(process.env.MODAL_RESULTS,JSON.stringify({pass,fail,checks},null,2))}
process.exitCode=fail?1:0;
