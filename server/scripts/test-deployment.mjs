/** Read-only smoke test for the named test deployment. Never writes member data. */
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base='https://fitness-test.up.railway.app';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=process.env.TEST_RESULTS_DIR || root+'qa/results';
await fs.mkdir(out,{recursive:true});
const results=[];
const record=(id,name,status,actual)=>{results.push({id,name,status,actual});console.log(`${status}: ${name} — ${actual}`);};
const get=path=>fetch(base+path,{signal:AbortSignal.timeout(20000),cache:'no-store'});
try {
  const response=await get('/');const html=await response.text();
  record('DEP-001','Test app shell',response.ok&&html.includes('id="root"')?'Pass':'Fail',`HTTP ${response.status}`);
  const local=await fs.readFile(root+'client/dist/index.html','utf8');
  const assets=text=>[...text.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.(?:js|css))"/g)].map(m=>m[1]);
  const expected=assets(local),actual=assets(html);
  const current=expected.length>0&&expected.every(a=>actual.includes(a));
  record('DEP-002','Exact build assets',current?'Pass':'Blocked',current?'Compiled assets match this build':`Expected ${expected.join(', ')}; deployed ${actual.join(', ')}. New build not verified.`);
  for(const asset of actual){const r=await get(asset);const body=await r.text();record('DEP-003','Asset loads: '+asset,r.ok&&!body.startsWith('<!doctype')?'Pass':'Fail',`HTTP ${r.status}; ${body.length} characters`);}
  const health=await get('/health');const healthData=await health.json();
  record('DEP-004','Service health',health.ok&&healthData.status==='ok'?'Pass':'Fail',`HTTP ${health.status}; ${healthData.status}`);
  const sw=await get('/sw.js');const swText=await sw.text();
  record('DEP-005','Service worker available',sw.ok&&/precache|workbox/i.test(swText)?'Pass':'Fail',`HTTP ${sw.status}`);
  for(const endpoint of ['/api/logs/recent-foods','/api/foods/presets','/api/ai-chat/portions','/api/member-foods']){
    const r=await get(endpoint);record('DEP-006','Private endpoint rejects anonymous access: '+endpoint,r.status===401?'Pass':'Fail',`HTTP ${r.status}`);
  }
  record('DEP-007','Authenticated member/coach/device regression','Blocked','Requires this build deployed plus dedicated test accounts and physical phone checks. HTTP smoke is not full member regression.');
}catch(e){record('DEP-000','Deployment connectivity','Blocked',e.message);}
await fs.writeFile(out+'/deployment-smoke.json',JSON.stringify({base,checkedAt:new Date().toISOString(),results},null,2));
process.exitCode=results.some(r=>r.status==='Fail')?1:results.find(r=>r.id==='DEP-002')?.status!=='Pass'?2:0;
