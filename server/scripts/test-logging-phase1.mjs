/** Behavioural regression for repeat logging and editable household measures. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
const src = fileURLToPath(new URL('../../client/src/', import.meta.url));
let count = 0;
const check = (name, value) => { assert.ok(value, name); count++; console.log('  ✓ ' + name); };
const api = `export default {get:url => window.__api(url), delete:(url,body)=>window.__delete(url,body)};`;
const result = await build({
  stdin:{resolveDir:src,loader:'jsx',contents:`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import * as portions from './utils/householdPortions';
    import * as usual from './utils/usualMeals';
    import * as review from './utils/aiFoodReview';
    import * as source from './utils/foodProvenance';
    import UsualMeals from './components/chat/UsualMeals';
    import HouseholdPortion from './components/chat/HouseholdPortion';
    import {useAuthStore} from './store/authStore';
    window.helpers={...portions,...usual,...review,...source};window.auth=useAuthStore;
    const root=createRoot(document.getElementById('root'));window.unmount=()=>root.unmount();
    window.showUsual=(props={})=>root.render(<UsualMeals active autoSlot="Breakfast" onChoose={s=>window.__chosen.push(s)} {...props}/>);
    function Portion(){const [food,setFood]=React.useState(window.__food);window.__food=food;
      return <HouseholdPortion food={food} memories={window.__memories||[]} onPatch={p=>setFood(f=>({...f,...p}))} onForget={window.__forget}/>;}
    window.showPortion=()=>root.render(<Portion/>);
  `}, bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.js':'jsx'},
  define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},logLevel:'silent',
  plugins:[{name:'api',setup(b){b.onResolve({filter:/api\/client$/},()=>({path:'api',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:api}));}}]
});
const dom = new JSDOM('<div id="root"></div>',{url:'https://fitlife.test',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window; const tick=()=>new Promise(r=>setTimeout(r,50));
w.__chosen=[]; w.__delete=async()=>({data:{forgotten:true}});
w.eval(result.outputFiles[0].text);
const h=w.helpers;
const rice={name:'Rice (Cooked)',grams:300,ai_grams:300,on:true,qty_text:'2 bowls',portion_phrase:'bowl rice',source:'db-verified',per_100g:{calories:130,protein:3,total_carbs:28,fat:1}};
try {
  const p=h.statedPortion(rice);
  check('two bowls divide into a 150 g single bowl',p.quantity===2 && p.grams_per_unit===150 && p.unit==='bowl');
  check('half-cup fraction is supported',h.statedPortion({...rice,qty_text:'1/2 cup',grams:100}).grams_per_unit===200);
  check('unicode fraction is supported',h.statedPortion({...rice,qty_text:'½ cup',grams:100}).quantity===0.5);
  check('unspecified portions never invent household weights',h.statedPortion({...rice,qty_text:'some rice'})===null);
  check('zero and divide-by-zero counts are rejected',!h.statedPortion({...rice,qty_text:'0 bowls'})&&!h.statedPortion({...rice,qty_text:'1/0 cups'}));
  const scaled=h.withPortion(rice,p,3);
  check('three bowls recalculate grams and all nutrition',scaled.grams===450&&scaled.macros.cal===585&&scaled.macros.pro===13.5&&scaled.macros.carb===126&&scaled.macros.fat===4.5);
  check('empty count stays invalid until entered',!!h.foodReviewError([h.withPortion(rice,p,'')]));
  check('oversized amount is blocked rather than silently clamped',h.withFoodGrams(rice,6000).grams===6000&&!!h.foodReviewError([h.withFoodGrams(rice,6000)]));
  check('count greater than 100 is blocked',!!h.foodReviewError([h.withPortion(rice,{...p,grams_per_unit:1},101)]));
  check('excluded invalid foods do not prevent other items saving',!h.foodReviewError([{...h.withPortion(rice,p,''),on:false}]));
  check('portion memory is opt-in in household editor',h.portionCorrections([scaled]).length===0);
  const correction=h.portionCorrections([{...scaled,remember_portion:true}])[0];
  check('memory sends quantity with total weight',correction.grams===450&&correction.quantity===3&&correction.replace===true);
  check('legacy gram correction divides by original stated count',h.portionCorrections([{...rice,grams:400}])[0].quantity===2);
  check('unticked foods never train portion memory',h.portionCorrections([{...scaled,on:false,remember_portion:true}]).length===0);
  check('manual gram edit keeps household count consistent',h.withFoodGrams(scaled,600).portion.quantity===4);
  check('remembered bowl only matches its food and preparation',h.portionOptions(rice,[{phrase:'bowl rice (raw)',grams:200},{phrase:'bowl rice (cooked)',grams:180}]).length===2);
  check('nutrition source and preparation are independent',h.foodSource(rice)==='Verified food database'&&h.preparationLabel(rice)==='Cooked weight');
  check('label overrides inferred nutrition provenance',h.foodSource({...rice,label:true})==='Your nutrition label');
  check('missing provenance is stated honestly',h.foodSource({})==='Nutrition source not recorded');
  const preset={id:1,name:'Rice breakfast',meal:'Breakfast',items:[rice]};
  const suggestions=h.usualSuggestions([preset],[],[{name:rice.name,per_100g:{calories:200,protein:4,carbs:40,fat:2}}],'Dinner');
  check('current member label replaces stale saved nutrition',suggestions[0].foods[0].macros.cal===600&&suggestions[0].foods[0].source==='member');
  check('repeat uses the current meal slot',suggestions[0].foods[0].meal==='Dinner');
  check('usual selection creates review only',h.usualReview(suggestions[0],'2026-10-12').applied===false);
  check('corrupt and empty recent entries are ignored',h.usualSuggestions(null,[{}, {name:'x',last_g:0}],null,'Breakfast').length===0);
  check('matching meal preset is ranked first',h.usualSuggestions([{...preset,id:2,name:'Dinner',meal:'Dinner'},preset],[],[],'Breakfast')[0].name==='Rice breakfast');

  w.auth.setState({user:{id:1,role:'patient'},accessToken:'fixture'});
  w.__api=async url=>({data:url==='/foods/presets'?[preset]:[]});
  w.showUsual(); await tick(); await tick();
  check('My usual renders a compact saved-meal action',w.document.querySelector('.usual-primary')?.textContent.includes('Rice breakfast'));
  w.document.querySelector('.usual-primary').click();w.document.querySelector('.usual-primary').click();await tick();
  check('rapid double tap creates one review',w.__chosen.length===1);
  const pending=[];w.showUsual({active:false});await tick();
  w.__api=()=>new Promise(r=>{pending.push(r);});w.showUsual();await tick();const oldRequests=[...pending];
  w.auth.setState({user:{id:2,role:'patient'}});await tick();
  check('switching accounts immediately removes previous suggestions',!w.document.querySelector('.usual-primary'));
  oldRequests.forEach(resolve=>resolve({data:[preset]}));await tick();
  check('late previous-account response cannot show old food',!w.document.querySelector('.usual-primary'));
  w.showUsual({active:false});await tick();
  w.__api=async url=>{if(url==='/logs/recent-foods')throw Error('offline');return {data:url==='/foods/presets'?[preset]:[]};};
  w.showUsual();await tick();await tick();
  check('partial network failure retains available suggestions',!!w.document.querySelector('.usual-primary'));
  check('partial failure offers a retry',w.document.body.textContent.includes('Try again'));
  w.showUsual({disabled:true});await tick();
  check('busy state blocks repeat logging',w.document.querySelector('.usual-primary').disabled);

  w.__food=rice;w.__memories=[{phrase:'bowl rice (cooked)',grams:180}];w.__forget=async()=>{throw Error('offline');};
  w.showPortion();await tick();
  const select=w.document.querySelector('select');select.value='bowl rice (cooked)';select.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
  check('choosing remembered bowl preserves count and recalculates weight',w.__food.grams===360&&w.__food.macros.cal===468&&w.__food.portion.quantity===2);
  w.document.querySelector('.portion-forget').click();await tick();
  check('failed forget keeps portion and shows recovery',w.document.querySelector('[role=alert]')?.textContent.includes('Try again')&&w.__food.portion.basis==='remembered');
  const select2=w.document.querySelector('select');select2.value='';select2.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
  check('returning to grams clears stale household phrase',w.__food.portion===null&&w.__food.portion_phrase===null&&w.__food.qty_text==='');
  console.log(`Logging phase 1: ${count} passed, 0 failed`);
} finally {w.unmount();w.close();}
