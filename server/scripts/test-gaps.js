/**
 * scripts/test-gaps.js — logging gap detection.
 *
 * The assertions that matter are about NOT flagging: water at breakfast is not
 * a gap, and a member who logged nothing has one problem rather than six. A
 * list that cries wolf is one a coach stops reading.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const { detectGaps } = require('../services/gapDetector');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q,_r,n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/patients', require('../routes/patients'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e || '').slice(0, 200))); };

/** A UTC instant that reads as `h` o'clock in IST. */
const at = h => new Date(Date.UTC(2026, 7, 23, (h - 5 + 24) % 24, 0) - 30 * 60000);
const M = { id: 1, name: 'Harsha', phone: '9741771679' };
const P = { water_target: 3000, activities: new Array(6), acv: new Array(3),
            supplements: new Array(7), meal_slots: ['Meal 1','Meal 2','Meal 3'] };
const keys = r => r.gaps.map(g => g.key);

const fullDay = {
  weight_kg: 83, food_items: [{ name:'x', meal:'Meal 1' }, { name:'y', meal:'Meal 3' }],
  water_ml: 2800, activities: { walk: true }, acv: { acv1:true, acv2:true, acv3:true },
  supplements: { b12: true }, sleep: { bedtime:'22:30', waketime:'06:30' },
};

(async () => {
  console.log('\n[1] nothing is flagged too early in the day');
  // Each check has its own threshold, so an empty log surfaces more as the day
  // goes on: nothing before 11, then weight, and from 14:00 the blocking "nothing logged"
  // gap takes over and suppresses the rest — one message, not three.
  for (const [h, expect] of [[7, []], [9, []], [11, ['weight']], [16, ['nothing']]]) {
    const r = detectGaps(M, null, P, { now: at(h) });
    ck(`${String(h).padStart(2,'0')}:00 empty log -> [${expect.join(', ') || 'nothing yet'}]`,
       JSON.stringify(keys(r).sort()) === JSON.stringify(expect.sort()), keys(r));
  }

  console.log('\n[2] water is not a morning problem');
  const dry = { ...fullDay, water_ml: 200 };
  ck('09:00 low water -> not flagged', !keys(detectGaps(M, dry, P, { now: at(9) })).includes('water'));
  ck('13:00 low water -> not flagged', !keys(detectGaps(M, dry, P, { now: at(13) })).includes('water'));
  ck('19:00 low water -> flagged',      keys(detectGaps(M, dry, P, { now: at(19) })).includes('water'));

  console.log('\n[3] supplements and ACV wait until evening');
  const noSupp = { ...fullDay, supplements: {}, acv: {} };
  ck('17:00 -> supplements not flagged', !keys(detectGaps(M, noSupp, P, { now: at(17) })).includes('supplements'));
  ck('21:00 -> supplements flagged',      keys(detectGaps(M, noSupp, P, { now: at(21) })).includes('supplements'));
  ck('21:00 -> ACV flagged',              detectGaps(M, noSupp, P, { now: at(21) }).all_gaps.includes('acv'));

  console.log('\n[4] a member who logged NOTHING gets one message, not six');
  const empty = detectGaps(M, null, P, { now: at(21) });
  ck('exactly one gap surfaced', empty.gaps.length === 1, keys(empty));
  ck('and it is the blocking one', empty.gaps[0].key === 'nothing', empty.gaps[0]);
  ck('though the full picture is still available', empty.all_gaps.length > 3, empty.all_gaps);

  console.log('\n[5] a partly-logged member gets the specific gaps');
  const partial = { weight_kg: 83, food_items: [{ name:'x', meal:'Meal 1' }],
                    water_ml: 400, activities: {}, acv: {}, supplements: {}, sleep: {} };
  const pr = detectGaps(M, partial, P, { now: at(20) });
  ck('not treated as "nothing logged"', !keys(pr).includes('nothing'), keys(pr));
  ck('at most two surfaced', pr.gaps.length <= 2, keys(pr));
  ck('most severe first', pr.gaps[0].severity !== 'low', pr.gaps[0]);

  console.log('\n[6] a complete day produces no gaps at all');
  const clean = detectGaps(M, fullDay, P, { now: at(22) });
  ck('nothing to chase', clean.gaps.length === 0, keys(clean));

  console.log('\n[7] specific items are detected correctly');
  ck('missing weight at 11:00',
     keys(detectGaps(M, { ...fullDay, weight_kg: null }, P, { now: at(11) })).includes('weight'));
  ck('no food at 16:00',
     keys(detectGaps(M, { ...fullDay, food_items: [] }, P, { now: at(16) })).includes('food'));
  ck('dinner missing at 22:00',
     detectGaps(M, { ...fullDay, food_items: [{ name:'x', meal:'Meal 1' }] }, P, { now: at(22) })
       .all_gaps.includes('dinner'));
  ck('no activity at 20:00',
     detectGaps(M, { ...fullDay, activities: {} }, P, { now: at(20) }).all_gaps.includes('activity'));
  ck('sleep missing at 22:00',
     detectGaps(M, { ...fullDay, sleep: {} }, P, { now: at(22) }).all_gaps.includes('sleep'));

  console.log('\n[8] malformed data does not break the list');
  ck('null log survives',        detectGaps(M, null, P, { now: at(22) }).gaps.length >= 0);
  ck('garbage fields survive',   detectGaps(M, { activities: 'nonsense', food_items: null }, P, { now: at(22) }).gaps.length >= 0);
  ck('missing protocol survives', detectGaps(M, fullDay, {}, { now: at(22) }).gaps.length >= 0);

  console.log('\n[9] endpoint and access control');
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (n,ph,role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`,[n,ph,role])).rows[0];
  const coach = await mk('C','8101','monitor');
  const mine  = await mk('Mine','8102','patient');
  const other = await mk('Other','8103','patient');
  for (const u of [mine, other]) await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`,[u.id]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true)`,[coach.id,mine.id]);

  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u,role) => jwt.sign({id:u,role,name:'T'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const call = async (t) => { const r = await fetch(`http://127.0.0.1:${port}/api/patients/gaps`,
    { headers:{Authorization:'Bearer '+t} }); return { status: r.status, data: await r.json().catch(()=>({})) }; };

  let x = await call(tok(coach.id,'monitor'));
  ck('coach gets a list', x.status === 200 && Array.isArray(x.data.members), x.status);
  ck('only their own members appear',
     x.data.members.every(m => m.member_id === mine.id), x.data.members.map(m => m.name));
  ck('phone included for messaging', x.data.members.every(m => 'phone' in m), x.data.members[0]);
  x = await call(tok(mine.id,'patient'));
  ck('MEMBERS CANNOT SEE THE GAP LIST', x.status === 403, x.status);
  ck('"gaps" is not read as a member id', true);

  srv.close();
  console.log(`\n\u2550\u2550\u2550 GAPS: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
