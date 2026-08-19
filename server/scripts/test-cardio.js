/**
 * scripts/test-cardio.js — cardio storage/validation on workout sessions.
 * Run: DATABASE_URL=<local test db> JWT_SECRET=x node scripts/test-cardio.js
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express=require('express'), jwt=require('jsonwebtoken');
const pool=require('../db/pool'), workouts=require('../routes/workouts'), patients=require('../routes/patients');
const app=express(); app.use(express.json());
app.use((q,_r,n)=>{q.io={to:()=>({emit:()=>{}})};n()});
app.use('/api/workouts',workouts); app.use('/api/patients',patients);
let pass=0,fail=0;
const ck=(n,c,e)=>{c?(pass++,console.log('  \u2713 '+n)):(fail++,console.log('  \u2717 '+n+' '+JSON.stringify(e||'').slice(0,180)))};
(async()=>{
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  await pool.query('DELETE FROM exercises');
  const {rows:[p]}=await pool.query(`INSERT INTO users(name,phone,password,role,active) VALUES('M','6001','x','patient',true) RETURNING id`);
  await pool.query(`INSERT INTO patient_profiles(user_id,height_cm,gender,dob) VALUES($1,181,'male','1985-04-10')`,[p.id]);
  const {rows:[ex]}=await pool.query(`INSERT INTO exercises(name,muscle_group) VALUES('Bench Press','chest') RETURNING id`);
  const tok=jwt.sign({id:p.id,role:'patient',name:'M'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const srv=app.listen(0), port=srv.address().port;
  const call=async(m,path,b)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:m,headers:{'content-type':'application/json',Authorization:'Bearer '+tok},body:b?JSON.stringify(b):undefined});return{status:r.status,data:await r.json().catch(()=>({}))}};
  const date=new Date(Date.now()+5.5*3600*1000).toISOString().slice(0,10);

  let r=await call('POST','/api/workouts',{date,exercises:[{exercise_id:ex.id,sets:[{reps:10,weight_kg:20}]}],
    cardio:[{type:'running',duration_min:30,speed_kmh:9.7},{type:'walking',duration_min:20,speed_kmh:5}]});
  ck('save with cardio ok',r.status===200,r.data);

  let g=await call('GET',`/api/workouts?date=${date}`);
  ck('cardio returned on GET',Array.isArray(g.data.cardio)&&g.data.cardio.length===2,g.data.cardio);
  ck('cardio values intact',g.data.cardio[0].type==='running'&&g.data.cardio[0].duration_min===30,g.data.cardio[0]);
  ck('sets still intact alongside cardio',g.data.exercises[0].sets.length===1,g.data.exercises);

  r=await call('POST','/api/workouts',{date,exercises:[],cardio:[{type:'HACKER',duration_min:99999,speed_kmh:-5}]});
  g=await call('GET',`/api/workouts?date=${date}`);
  ck('invalid type coerced to other',g.data.cardio[0].type==='other',g.data.cardio[0]);
  ck('duration clamped to 600',g.data.cardio[0].duration_min===600,g.data.cardio[0]);
  ck('negative speed clamped to 0',g.data.cardio[0].speed_kmh===0,g.data.cardio[0]);

  r=await call('POST','/api/workouts',{date,exercises:[],cardio:[{type:'running',duration_min:0}]});
  g=await call('GET',`/api/workouts?date=${date}`);
  ck('zero-duration entries dropped',g.data.cardio.length===0,g.data.cardio);

  await call('POST','/api/workouts',{date,exercises:[{exercise_id:ex.id,sets:[{reps:10,weight_kg:20},{reps:10,weight_kg:25}]}],
    cardio:[{type:'running',duration_min:30,speed_kmh:9.7}]});
  const me=await call('GET','/api/patients/me');
  const te=me.data.today_energy;
  ck('/me returns raw sets',Array.isArray(te.workout_sets)&&te.workout_sets.length===2,te.workout_sets);
  ck('/me returns cardio',Array.isArray(te.cardio)&&te.cardio.length===1,te.cardio);
  ck('set values usable for volume',te.workout_sets[0].reps===10&&parseFloat(te.workout_sets[0].weight_kg)===20,te.workout_sets[0]);

  srv.close(); console.log(`\n\u2550\u2550\u2550 CARDIO: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('HARNESS ERROR:',e);process.exit(1)});
