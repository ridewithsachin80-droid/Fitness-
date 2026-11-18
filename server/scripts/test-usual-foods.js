/** Real HTTP/Postgres regression for latest portions, preset metadata and ownership. */
if (!process.env.DATABASE_URL?.includes('localhost')) {console.error('Refusing non-local test database');process.exit(1);}
process.env.JWT_SECRET ||= 'local-test-secret';
const express=require('express'),jwt=require('jsonwebtoken'),pool=require('../db/pool');
const app=express();app.use(express.json());app.use('/api/logs',require('../routes/logs'));app.use('/api/foods',require('../routes/foods'));
let pass=0,fail=0;const ck=(name,ok)=>{console.log(`  ${ok?'✓':'✗'} ${name}`);ok?pass++:fail++;};
(async()=>{
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const ids=(await pool.query("INSERT INTO users(name,phone,password,role,active) VALUES('Usual A','60001','x','patient',true),('Usual B','60002','x','patient',true) RETURNING id")).rows.map(r=>r.id);
  const server=app.listen(0);const base=`http://127.0.0.1:${server.address().port}`;
  const call=async(path,id=ids[0],body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',authorization:'Bearer '+jwt.sign({id,role:'patient'},process.env.JWT_SECRET)},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  const food={name:'Rice',grams:200,per_100g:{calories:130,protein:3,carbs:28,fat:1},source:'member',label:true,qty_text:'1 bowl'};
  try {
    await pool.query("INSERT INTO daily_logs(patient_id,log_date,food_items) VALUES($1,'2026-10-11',$2::jsonb),($1,'2026-10-12',$3::jsonb)",[ids[0],JSON.stringify([{...food,grams:100}]),JSON.stringify([{...food,grams:150},food])]);
    let r=await call('/api/logs/recent-foods');
    ck('recent route returns newest day and last item quantity',r.status===200&&r.data[0].last_g===200);
    ck('recent food retains personal label and portion text',r.data[0].label===true&&r.data[0].source==='member'&&r.data[0].qty_text==='1 bowl');
    ck('frequency still includes older logs',r.data[0].count===3);
    ck('recent foods are private to the member',(await call('/api/logs/recent-foods',ids[1])).data.length===0);
    r=await call('/api/foods/presets',ids[0],{name:'My breakfast',meal:'Breakfast',items:[food]});
    ck('preset saves portion and nutrition source',r.status===200&&r.data.items[0].label===true&&r.data.items[0].source==='member'&&r.data.items[0].qty_text==='1 bowl');
    r=await call('/api/foods/presets');
    ck('preset reload preserves macros and quantity',r.data[0].items[0].grams===200&&r.data[0].items[0].per_100g.calories===130);
    ck('saved meals are private to the member',(await call('/api/foods/presets',ids[1])).data.length===0);
  }finally{await new Promise(r=>server.close(r));await pool.end();}
  console.log(`Usual foods: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
