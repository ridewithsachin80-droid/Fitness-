// Actual Express handlers with synthetic SQL/HTTP adapters. No real database,
// member account or wearable provider is contacted by this focused regression.
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
process.env.JWT_SECRET = 'ci55-local-fixture-secret';
let pass = 0, fail = 0;
function ck(name, condition) {
  console.log(`  ${condition ? '✓' : '✗'} ${name}`);
  condition ? pass++ : fail++;
}
const labs = [], connections = [];
let tokenCalls = 0;
const query = async (sql, args = []) => {
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || /pg_advisory_xact_lock/.test(sql)) return { rows: [] };
  if (/FROM monitor_patients/.test(sql)) return { rows: args[0] === 99 && String(args[1]) === '1' ? [{ ok: 1 }] : [] };
  if (/INSERT INTO lab_values/.test(sql)) {
    // Reject blank NUMERIC input just as the observed PostgreSQL failure did.
    assert(![args[3], args[5], args[6]].includes(''), 'blank numeric SQL parameter');
    const row = Object.fromEntries(['patient_id','test_date','test_name','value','unit','ref_min','ref_max','status'].map((k,i)=>[k,args[i]]));
    row.id = labs.length + 1; labs.push(row); return { rows: [row] };
  }
  if (/FROM lab_values/.test(sql)) return { rows: /created_at/.test(sql) ? [] : labs.filter(r=>Number(r.patient_id)===Number(args[0])) };
  if (/INSERT INTO tracker_connections/.test(sql)) { connections.push(args); return { rows: [] }; }
  if (/INSERT INTO tracker_data/.test(sql)) return { rows: [] };
  if (/FROM tracker_connections/.test(sql)) return { rows: [] };
  throw Error('Unexpected fixture query: ' + sql);
};
const poolPath = require.resolve('../db/pool');
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: { query, connect: async()=>({ query, release(){} }) } };
axios.post = async()=>{ tokenCalls++; return { data:{ access_token:'fixture',expires_in:3600 } }; };
axios.get = async()=>{ throw Error('External network is disabled in this suite'); };
const patients = require('../routes/patients');
const analysis = require('../services/labAnalysis');
const app = express(); app.use(express.json());
app.use('/api/patients', patients); app.use('/api/trackers', require('../routes/trackers'));
const server = app.listen(0, '127.0.0.1');
(async()=>{
  await new Promise(resolve=>server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const member = jwt.sign({id:1,role:'patient'},process.env.JWT_SECRET);
  const coach = jwt.sign({id:99,role:'monitor'},process.env.JWT_SECRET);
  const call = async(path, token, body)=>{
    const r=await fetch(base+path,{method:body?'POST':'GET',redirect:'manual',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return { status:r.status,location:r.headers.get('location'),data:await r.json().catch(()=>null) };
  };
  try {
    const rows=[
      {test_name:'Max only',value:250,ref_min:'',ref_max:200},
      {test_name:'Min only',value:32,ref_min:40,ref_max:''},
      {test_name:'In range',value:120,ref_max:150},
      {test_name:'Unknown range',value:14},
    ];
    const r=await call('/api/patients/me/labs',member,{test_date:'2026-09-01',results:rows});
    ck('member lab batch saves through the real route',r.status===201);
    ck('member maximum-only result is high',r.data?.results?.[0].status==='high');
    ck('member minimum-only result is low',r.data?.results?.[1].status==='low');
    ck('member in-range result stays normal',r.data?.results?.[2].status==='normal');
    ck('member blank reference limits become null',r.data?.results?.[0].ref_min===null && r.data?.results?.[1].ref_max===null);
    for(const [name,value,min,max,state] of [['upper',180,'',130,'high'],['lower',30,40,'','low'],['equal',130,'',130,'normal'],['none',8,'','','normal']]) {
      const x=await call('/api/patients/1/labs',coach,{test_date:'2026-09-01',test_name:name,value,ref_min:min,ref_max:max});
      ck(`coach ${name} reference saves and classifies`,x.status===201&&x.data?.status===state);
    }
    for(const value of ['',null,'abc','Infinity']) {
      const x=await call('/api/patients/1/labs',coach,{test_date:'2026-09-01',test_name:'Invalid',value});
      ck(`coach rejects invalid numeric value ${JSON.stringify(value)}`,x.status===400);
    }
    const blocked=await call('/api/patients/2/labs',coach,{test_date:'2026-09-01',test_name:'No access',value:5});
    ck('lab correction preserves coach assignment boundary',blocked.status===403);
    ck('classify contract handles unknown bounds and invalid values',typeof patients.classifyLab==='function'&&patients.classifyLab(5,'','')==='normal'&&patients.classifyLab('abc',1,2)==='normal');
    for(const [v,min,max,want] of [[250,null,200,'high'],[30,40,null,'low'],[200,null,200,'normal'],[40,40,null,'normal'],[5,null,null,null],['bad',1,2,null],[0,0,1,'normal']]) {
      ck(`rangeState ${JSON.stringify([v,min,max])}`,typeof analysis.rangeState==='function'&&analysis.rangeState(v,min,max)===want);
    }
    ck('one-sided range labels match printed limits',typeof analysis.refText==='function'&&analysis.refText(null,200)==='≤ 200'&&analysis.refText(40,null)==='≥ 40'&&analysis.refText(13,17)==='13–17'&&analysis.refText(null,null)===null);
    const result=analysis.analyseLabs([{test_name:'Cholesterol',value:230,ref_max:200,test_date:'2026-06-01'},{test_name:'Cholesterol',value:250,ref_max:200,test_date:'2026-09-01'}],[],[]);
    ck('comparison reports one-sided abnormal result',result.out_of_range[0]?.state==='high'&&result.out_of_range[0]?.ref==='≤ 200');
    ck('comparison carries one-sided range and state',result.comparisons[0]?.ref==='≤ 200'&&result.comparisons[0]?.to_state==='high');
    const start=await call('/api/trackers/oauth/fitbit',member);
    const issued=new URL(start.location).searchParams.get('state');
    let decoded;try{decoded=jwt.verify(issued,process.env.JWT_SECRET);}catch{}
    ck('tracker start issues expiring signed state bound to member and provider',start.status===302&&decoded?.userId===1&&decoded?.provider==='fitbit'&&decoded?.k==='tracker_oauth'&&decoded.exp>decoded.iat&&decoded.exp-decoded.iat<=900);
    const signed=(payload,options={expiresIn:600})=>jwt.sign(payload,process.env.JWT_SECRET,options);
    const claims={userId:1,provider:'fitbit',k:'tracker_oauth'};
    const invalid=[['forged',Buffer.from(JSON.stringify(claims)).toString('base64'),'fitbit'],['wrong provider',signed(claims),'whoop'],['expired',signed(claims,{expiresIn:-1}),'fitbit'],['login token',member,'fitbit'],['no expiry',signed(claims,{}),'fitbit'],['invalid user',signed({...claims,userId:-1}),'fitbit'],['unknown provider',signed({...claims,provider:'unknown'}),'unknown']];
    for(const [name,state,provider] of invalid){
      const before=tokenCalls;
      const x=await call(`/api/trackers/oauth/${provider}/callback?code=x&state=${encodeURIComponent(state)}`);
      ck(`tracker rejects ${name} before token exchange`,x.status===302&&/error=oauth_state/.test(x.location||'')&&tokenCalls===before);
    }
    const before=tokenCalls;
    const valid=await call(`/api/trackers/oauth/fitbit/callback?code=fixture&state=${encodeURIComponent(signed(claims))}`);
    ck('valid signed tracker callback completes with synthetic provider',valid.status===302&&/connected=fitbit/.test(valid.location||'')&&tokenCalls===before+1);
    ck('tracker token belongs to the signed member',connections.at(-1)?.[0]===1&&connections.at(-1)?.[1]==='fitbit');
  } catch(e){fail++;console.error('  ✗ focused suite crashed:',e.stack);}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  console.log(`\nCI55 focused regressions: ${pass} passed, ${fail} failed`);
  process.exitCode=fail?1:0;
})();
