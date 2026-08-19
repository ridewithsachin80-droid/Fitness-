/**
 * scripts/test-ai-workout-sets.js
 * Verifies the AI-chat → workout_sessions chain writes REAL set rows:
 * resolves/creates the exercise, appends sets, and never clobbers
 * manually-logged exercises.
 * Run: DATABASE_URL=<local test db> JWT_SECRET=x node scripts/test-ai-workout-sets.js
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express=require('express'), jwt=require('jsonwebtoken');
const pool=require('../db/pool'); const workouts=require('../routes/workouts');
const app=express(); app.use(express.json());
app.use((req,_res,next)=>{ req.io={to:()=>({emit:()=>{}})}; next(); });
app.use('/api/workouts', workouts);
let pass=0,fail=0;
const ck=(n,c,e)=>{c?(pass++,console.log('  \u2713 '+n)):(fail++,console.log('  \u2717 '+n+' '+JSON.stringify(e||'').slice(0,180)))};
(async()=>{
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  await pool.query('DELETE FROM exercises');
  const {rows:[pat]}=await pool.query(`INSERT INTO users(name,phone,password,role,active) VALUES('M','9001','x','patient',true) RETURNING id`);
  const {rows:[db]}=await pool.query(`INSERT INTO exercises(name,muscle_group) VALUES('Dumbbell Rows','back') RETURNING id`);
  const tok=jwt.sign({id:pat.id,role:'patient',name:'M'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const srv=app.listen(0), port=srv.address().port;
  const call=async(m,p,b)=>{const r=await fetch(`http://127.0.0.1:${port}${p}`,{method:m,headers:{'content-type':'application/json',Authorization:'Bearer '+tok},body:b?JSON.stringify(b):undefined});return{status:r.status,data:await r.json().catch(()=>({}))}};
  const date='2026-08-19';

  // 1. Member manually logs Dumbbell Rows
  await call('POST','/api/workouts',{date,duration_min:20,notes:null,exercises:[{exercise_id:db.id,sets:[{reps:12,weight_kg:25}]}]});
  let g=await call('GET',`/api/workouts?date=${date}`);
  ck('manual exercise saved',g.data.exercises.length===1,g.data);

  // 2. Simulate AI chat: "bench press 3 sets 20kg 10/10/12 reps"
  //    resolve exercise (not in library -> create)
  let search=await call('GET','/api/workouts/exercises?q=Bench Press');
  ck('bench press not in library yet',(search.data||[]).length===0,search.data);
  let created=await call('POST','/api/workouts/exercises',{name:'Bench Press'});
  ck('exercise auto-created',created.status===201&&created.data.id,created.data);
  const benchId=created.data.id;

  const prev=g.data.exercises.map(e=>({exercise_id:e.exercise_id,sets:e.sets.map(s=>({reps:s.reps,weight_kg:s.weight_kg}))}));
  const merged=[...prev,{exercise_id:benchId,sets:[{reps:10,weight_kg:20},{reps:10,weight_kg:20},{reps:12,weight_kg:20}]}];
  let save=await call('POST','/api/workouts',{date,duration_min:20,notes:null,exercises:merged});
  ck('AI merge save ok',save.status===200,save.data);

  // 3. Verify
  let after=await call('GET',`/api/workouts?date=${date}`);
  const names=after.data.exercises.map(e=>e.exercise_name).sort();
  ck('BOTH exercises present',names.length===2&&names.includes('Bench Press')&&names.includes('Dumbbell Rows'),names);
  const bench=after.data.exercises.find(e=>e.exercise_name==='Bench Press');
  ck('bench has 3 real set rows',bench.sets.length===3,bench.sets);
  ck('set values correct',bench.sets[0].reps===10&&bench.sets[0].weight_kg===20&&bench.sets[2].reps===12,bench.sets);
  const rows=after.data.exercises.find(e=>e.exercise_name==='Dumbbell Rows');
  ck('manual sets untouched',rows.sets.length===1&&rows.sets[0].reps===12&&rows.sets[0].weight_kg===25,rows.sets);

  // 4. Re-resolving an existing name must NOT duplicate the library row
  let again=await call('POST','/api/workouts/exercises',{name:'Bench Press'});
  ck('upsert returns same exercise id',again.data.id===benchId,{again:again.data.id,benchId});
  const {rows:cnt}=await pool.query(`SELECT COUNT(*)::int c FROM exercises WHERE name='Bench Press'`);
  ck('no duplicate exercise row',cnt[0].c===1,cnt[0]);

  // 5. Freeform workout -> notes, and notes survive alongside sets
  await call('POST','/api/workouts',{date,duration_min:80,notes:'\u2728 Cycling — 30 min (~250 kcal)',exercises:merged});
  let fin=await call('GET',`/api/workouts?date=${date}`);
  ck('freeform note stored',fin.data.session.notes.includes('Cycling'),fin.data.session.notes);
  ck('sets still intact with note',fin.data.exercises.length===2,fin.data.exercises.length);

  srv.close(); console.log(`\n\u2550\u2550\u2550 AI WORKOUT SETS: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('HARNESS ERROR:',e);process.exit(1)});
