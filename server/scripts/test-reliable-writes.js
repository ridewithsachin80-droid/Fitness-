// Runs only against the disposable CI PostgreSQL database, never Railway.
if (!process.env.DATABASE_URL?.includes('localhost')) { console.error('Disposable localhost database required'); process.exit(1); }
process.env.JWT_SECRET ||= 'testsecret';
const express=require('express'),jwt=require('jsonwebtoken'),pool=require('../db/pool');
const app=express();app.use(express.json());app.use((req,res,next)=>{req.io={to:()=>({emit(){}})};next();});
app.use('/api/workouts',require('../routes/workouts'));app.use('/api/members',require('../routes/patients'));
let passed=0,failed=0,server,ids=[];
const check=(name,ok)=>{console.log(`  ${ok?'✓':'✗'} ${name}`);ok?passed++:failed++;};
(async()=>{
 const make=async n=>{const {rows:[u]}=await pool.query("INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x','patient',true) RETURNING id",['Write fixture '+n,'rw-'+Date.now()+'-'+n]);ids.push(u.id);return u;};
 const a=await make(1),b=await make(2);
 const token=u=>jwt.sign({id:u.id,role:'patient',name:'Write fixture'},process.env.JWT_SECRET,{expiresIn:'1h'});
 server=app.listen(0);const base='http://127.0.0.1:'+server.address().port;
 const req=async(method,path,body,u=a)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json',Authorization:'Bearer '+token(u)},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
 const date='2026-01-10';
 let r=await req('POST','/api/workouts',{date,expected_revision:0,duration_min:10});
 check('first conditional workout creates revision1',r.status===200&&r.data.revision===1);
 const contenders=await Promise.all([20,30].map(duration_min=>req('POST','/api/workouts',{date,expected_revision:1,duration_min})));
 check('concurrent workout replacements have exactly one winner',contenders.filter(x=>x.status===200).length===1&&contenders.filter(x=>x.status===409).length===1);
 r=await req('GET','/api/workouts?date='+date);const winner=r.data.session.duration_min;
 check('GET returns the committed workout revision',r.data.session.revision===2&&[20,30].includes(winner));
 r=await req('POST','/api/workouts',{date,expected_revision:1,duration_min:0});
 check('stale Undo cannot replace newer workout',r.status===409&&r.data.code==='WORKOUT_CONFLICT');
 r=await req('GET','/api/workouts?date='+date);check('conflict preserves complete winner',r.data.session.duration_min===winner&&r.data.session.revision===2);
 r=await req('POST','/api/workouts',{date,duration_min:40});check('legacy manual writer advances revision',r.status===200&&r.data.revision===3);
 r=await req('POST','/api/workouts',{date,expected_revision:2,duration_min:50});check('AI cannot overwrite intervening legacy save',r.status===409);
 r=await req('POST','/api/workouts',{date,expected_revision:3,exercises:[{exercise_id:2147483646,sets:[{reps:5,weight_kg:10}]}]});check('invalid set aborts the whole workout transaction',r.status===500);
 r=await req('GET','/api/workouts?date='+date);check('failed workout write preserves revision and duration',r.data.session.revision===3&&r.data.session.duration_min===40);
 for(const expected_revision of [-1,'3',1.5,null]){r=await req('POST','/api/workouts',{date,expected_revision});check('malformed revision rejected: '+expected_revision,r.status===400);}
 r=await req('POST','/api/workouts',{date:'2026-1-10',expected_revision:0});check('noncanonical date cannot bypass first-save lock',r.status===400);
 r=await req('POST','/api/workouts',{date,expected_revision:0,duration_min:8},b);check('workout revisions isolated by member',r.status===200&&r.data.revision===1);
 const payload={test_date:date,request_id:'fixture-submit-0001',lab_name:'Synthetic test',results:[{test_name:'Body fat',value:20,unit:'%'},{test_name:'Test marker',value:3,unit:'x'}]};
 const batch=await Promise.all(Array.from({length:4},()=>req('POST','/api/members/me/labs',payload)));
 check('concurrent identical lab submissions all receive success',batch.every(r=>[200,201].includes(r.status)&&r.data.saved===2));
 check('only one lab submission is new; others replay',batch.filter(r=>r.status===201).length===1&&batch.filter(r=>r.data.replayed).length===3);
 check('lab replays return the same result IDs',new Set(batch.map(r=>JSON.stringify(r.data.results.map(v=>v.id)))).size===1);
 let count=await pool.query('SELECT COUNT(*)::int AS n FROM lab_values WHERE patient_id=$1',[a.id]);check('retries persist exactly two lab rows',count.rows[0].n===2);
 r=await req('POST','/api/members/me/labs',{...payload,results:[{test_name:'Body fat',value:21}]});check('same key with changed results is rejected',r.status===409&&r.data.code==='SUBMISSION_CONFLICT');
 count=await pool.query('SELECT COUNT(*)::int AS n FROM lab_values WHERE patient_id=$1',[a.id]);check('payload conflict creates no rows',count.rows[0].n===2);
 r=await req('POST','/api/members/me/labs',payload,b);check('lab keys cannot replay another member data',r.status===201&&r.data.results.every(x=>x.patient_id===b.id));
 r=await req('POST','/api/members/me/labs',{...payload,request_id:'fixture-submit-0002'});check('new submission may legitimately repeat measured values',r.status===201);
 const broken={...payload,request_id:'fixture-failed-0001',results:[{test_name:'Good row',value:1},{test_name:'Too large',value:1e20}]};
 r=await req('POST','/api/members/me/labs',broken);check('invalid database value rolls back entire report',r.status===500);
 count=await pool.query('SELECT COUNT(*)::int AS n FROM member_lab_receipts WHERE patient_id=$1 AND request_id=$2',[a.id,broken.request_id]);check('failed report creates no completed receipt',count.rows[0].n===0);
 r=await req('POST','/api/members/me/labs',{...broken,results:[{test_name:'Good row',value:1}]});check('retry after rollback can succeed with the same key',r.status===201&&r.data.saved===1);
 r=await req('POST','/api/members/me/labs',{...payload,request_id:'bad key'});check('malformed submission key is rejected',r.status===400);
 console.log(`\n${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(server)await new Promise(r=>server.close(r));if(ids.length)await pool.query('DELETE FROM users WHERE id = ANY($1::int[])',[ids]);await pool.end();});
