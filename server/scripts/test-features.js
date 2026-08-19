/**
 * scripts/test-features.js — workout summary, weekly summary, photo validation.
 * Run: DATABASE_URL=<local test db> JWT_SECRET=x node scripts/test-features.js
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'dummy';
const express=require('express'), jwt=require('jsonwebtoken');
const pool=require('../db/pool'), workouts=require('../routes/workouts'),
      aiChat=require('../routes/aiChat'), patients=require('../routes/patients');
const app=express(); app.use(express.json({limit:'12mb'}));
app.use((q,_r,n)=>{q.io={to:()=>({emit:()=>{}})};n()});
app.use('/api/workouts',workouts); app.use('/api/ai-chat',aiChat); app.use('/api/patients',patients);
let pass=0,fail=0;
const ck=(n,c,e)=>{c?(pass++,console.log('  \u2713 '+n)):(fail++,console.log('  \u2717 '+n+' '+JSON.stringify(e||'').slice(0,200)))};
(async()=>{
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  await pool.query('DELETE FROM exercises');
  const {rows:[mon]}=await pool.query(`INSERT INTO users(name,phone,password,role,active) VALUES('Coach','4001','x','monitor',true) RETURNING id`);
  const {rows:[p]}=await pool.query(`INSERT INTO users(name,phone,password,role,active) VALUES('Subramanya Prasad','4002','x','patient',true) RETURNING id`);
  const {rows:[other]}=await pool.query(`INSERT INTO users(name,phone,password,role,active) VALUES('Other','4003','x','patient',true) RETURNING id`);
  await pool.query(`INSERT INTO patient_profiles(user_id,start_weight,target_weight,height_cm) VALUES($1,85,78,181)`,[p.id]);
  await pool.query(`INSERT INTO monitor_patients(monitor_id,patient_id,active) VALUES($1,$2,true)`,[mon.id,p.id]);
  const {rows:[ex]}=await pool.query(`INSERT INTO exercises(name,muscle_group) VALUES('Bench Press','chest') RETURNING id`);

  const ptok=jwt.sign({id:p.id,role:'patient',name:'S'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const mtok=jwt.sign({id:mon.id,role:'monitor',name:'C'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const srv=app.listen(0), port=srv.address().port;
  const call=async(m,path,tok,b)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:m,headers:{'content-type':'application/json',Authorization:'Bearer '+tok},body:b?JSON.stringify(b):undefined});return{status:r.status,data:await r.json().catch(()=>({}))}};

  // seed a week of data
  for (let d=0; d<5; d++) {
    await pool.query(`INSERT INTO daily_logs(patient_id,log_date,weight_kg,compliance_pct,food_items)
      VALUES($1,CURRENT_DATE - $2::int,$3,$4,$5)`,
      [p.id,d,85-d*0.3,70+d*2,JSON.stringify([{name:'Rice',grams:150,per_100g:{calories:130}}])]);
    const {rows:[ws]}=await pool.query(`INSERT INTO workout_sessions(patient_id,session_date,cardio)
      VALUES($1,CURRENT_DATE - $2::int,$3) RETURNING id`,
      [p.id,d,JSON.stringify([{type:'walking',duration_min:30,speed_kmh:5}])]);
    await pool.query(`INSERT INTO session_sets(session_id,exercise_id,set_number,reps,weight_kg)
      VALUES($1,$2,1,10,$3),($1,$2,2,10,$3)`,[ws.id,ex.id,20+d*5]);
  }

  console.log('\n[1] workout summary (member)');
  let r=await call('GET','/api/workouts/summary?days=30',ptok);
  ck('returns sessions',r.status===200&&r.data.sessions.length===5,r.data.totals);
  ck('volume computed',r.data.totals.volume_kg>0,r.data.totals);
  ck('cardio minutes computed',r.data.totals.cardio_min===150,r.data.totals);
  ck('personal best reported',r.data.best.volume_kg>0,r.data.best);
  ck('sessions ascending by date',
     r.data.sessions.every((s,i,a)=>i===0||new Date(s.date)>=new Date(a[i-1].date)),
     r.data.sessions.map(s=>s.date));

  console.log('\n[2] workout summary (coach view of member)');
  r=await call('GET',`/api/workouts/summary?days=30&patient_id=${p.id}`,mtok);
  ck('coach sees assigned member',r.status===200&&r.data.sessions.length===5,r.status);
  r=await call('GET',`/api/workouts/summary?days=30&patient_id=${other.id}`,mtok);
  ck('coach blocked from unassigned member',r.status===403,r.status);

  console.log('\n[3] days clamp');
  r=await call('GET','/api/workouts/summary?days=9999',ptok);
  ck('days clamped to 180',r.data.days===180,r.data.days);
  r=await call('GET','/api/workouts/summary?days=-5',ptok);
  ck('negative days clamped to 1',r.data.days===1,r.data.days);

  console.log('\n[4] weekly summary');
  r=await call('POST','/api/ai-chat/weekly-summary',mtok,{member_id:p.id,preview:true});
  ck('preview builds a message',r.status===200&&r.data.message.includes('Subramanya'),r.data.message);
  ck('mentions days logged',r.data.message.includes('5 of 7'),r.data.message);
  ck('mentions volume',/kg lifted/.test(r.data.message),r.data.message);
  ck('mentions cardio',/min of cardio/.test(r.data.message),r.data.message);
  ck('preview does NOT send',
     (await pool.query(`SELECT COUNT(*)::int c FROM monitor_notes WHERE patient_id=$1`,[p.id])).rows[0].c===0);

  r=await call('POST','/api/ai-chat/weekly-summary',mtok,{member_id:p.id});
  ck('send creates a coach note',r.data.sent===true &&
     (await pool.query(`SELECT COUNT(*)::int c FROM monitor_notes WHERE patient_id=$1`,[p.id])).rows[0].c===1);
  // coachAudit is fire-and-forget (deliberately — an audit failure must not
  // fail the member-facing action), so give it a moment to land.
  await new Promise(r => setTimeout(r, 300));
  const {rows:audits}=await pool.query(`SELECT action FROM audit_log ORDER BY id DESC LIMIT 1`);
  ck('audit row written',audits[0]?.action==='coach_weekly_summary',audits);

  r=await call('POST','/api/ai-chat/weekly-summary',mtok,{member_id:other.id});
  ck('cannot summarise unassigned member',r.status===403,r.status);
  r=await call('POST','/api/ai-chat/weekly-summary',ptok,{member_id:p.id});
  ck('member blocked from coach endpoint',r.status===403,r.status);

  console.log('\n[5] photo endpoint validation');
  r=await call('POST','/api/ai-chat/photo',ptok,{});
  ck('missing image rejected',r.status===400,r.status);
  r=await call('POST','/api/ai-chat/photo',ptok,{image:'x'.repeat(8_000_001)});
  ck('oversized image rejected 413',r.status===413,r.status);

  srv.close(); console.log(`\n\u2550\u2550\u2550 FEATURES: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('HARNESS ERROR:',e);process.exit(1)});
