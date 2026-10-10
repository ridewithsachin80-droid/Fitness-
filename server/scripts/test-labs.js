/**
 * scripts/test-labs.js — member lab entry and interval analysis.
 *
 * The assertions that matter most here are the ones about restraint: the
 * analysis must describe what changed alongside a result and must never
 * present it as a cause, must refuse intervals too short to mean anything,
 * and must not interpret an abnormal value.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const { analyseLabs, MIN_INTERVAL_DAYS } = require('../services/labAnalysis');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q,_r,n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/patients', require('../routes/patients'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e || '').slice(0, 200))); };
const iso = d => d.toISOString().slice(0, 10);
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

(async () => {
  console.log('\n[1] pairing and intervals');
  let r = analyseLabs([
    { test_name: 'HbA1c', value: 6.4, unit: '%', ref_min: 4, ref_max: 5.6, test_date: ago(120) },
    { test_name: 'HbA1c', value: 5.8, unit: '%', ref_min: 4, ref_max: 5.6, test_date: ago(20) },
  ], [], []);
  ck('two results 100 days apart are compared', r.comparisons.length === 1, r.comparisons.length);
  ck('improvement recognised for a lower-is-better marker',
     r.comparisons[0].direction === 'improved', r.comparisons[0].direction);
  ck('still flagged as out of range', r.out_of_range.length === 1, r.out_of_range);

  r = analyseLabs([
    { test_name: 'HbA1c', value: 6.4, test_date: ago(30) },
    { test_name: 'HbA1c', value: 6.3, test_date: ago(15) },
  ], [], []);
  ck(`repeats under ${MIN_INTERVAL_DAYS} days are NOT compared`, r.comparisons.length === 0, r.comparisons.length);
  ck('and the reason is given', /too soon/i.test(r.single_results[0]?.note || ''), r.single_results[0]);

  console.log('\n[2] direction is marker-aware');
  const dir = (name, from, to) => analyseLabs([
    { test_name: name, value: from, test_date: ago(120) },
    { test_name: name, value: to, test_date: ago(10) }], [], []).comparisons[0].direction;
  ck('HbA1c falling = improved', dir('HbA1c', 6.4, 5.6) === 'improved');
  ck('HDL rising = improved', dir('HDL', 38, 52) === 'improved');
  ck('Vitamin D rising = improved', dir('Vitamin D', 18, 42) === 'improved');
  ck('LDL rising = worsened', dir('LDL', 90, 140) === 'worsened');
  ck('an unlisted marker is described neutrally', ['rose','fell'].includes(dir('Serum Sodium', 138, 142)), dir('Serum Sodium', 138, 142));

  console.log('\n[3] the window context comes from real logs');
  const logs = [], sess = [];
  for (let d = 100; d >= 0; d--) {
    logs.push({
      log_date: ago(d), weight_kg: (88 - (100 - d) * 0.05).toFixed(1),
      food_items: [{ name:'d', grams:1000, per_100g:{ calories:180, protein:9, total_carbs:20, fat:5, fiber:2.5 } }],
      supplements: { b12: true, d3: d % 2 === 0, fishoil: false },
    });
    if (d % 3 === 0) sess.push({ session_date: ago(d), cardio: [{ type:'walking', duration_min:30 }] });
  }
  r = analyseLabs([
    { test_name: 'Vitamin D', value: 18, unit:'ng/mL', ref_min: 30, ref_max: 100, test_date: ago(95) },
    { test_name: 'Vitamin D', value: 41, unit:'ng/mL', ref_min: 30, ref_max: 100, test_date: ago(5) },
  ], logs, sess);
  const c = r.comparisons[0];
  ck('interval length computed', c.interval_days === 90, c.interval_days);
  ck('mean intake for the window', c.context.mean_kcal === 1800, c.context.mean_kcal);
  ck('weight change across the window', c.context.weight_change < 0, c.context.weight_change);
  ck('supplement adherence ranked', c.context.supplements[0].id === 'b12' && c.context.supplements[0].pct === 100, c.context.supplements[0]);
  ck('a partly-taken supplement shows a partial rate',
     c.context.supplements.find(s => s.id === 'd3').pct > 40 &&
     c.context.supplements.find(s => s.id === 'd3').pct < 60, c.context.supplements);
  ck('training counted', c.context.training_sessions > 20, c.context.training_sessions);
  ck('cardio minutes counted', c.context.cardio_minutes > 600, c.context.cardio_minutes);
  ck('log coverage reported', c.context.coverage_pct >= 95, c.context.coverage_pct);
  ck('moved from low into range', c.from_state === 'low' && c.to_state === 'normal', [c.from_state, c.to_state]);

  console.log('\n[4] restraint — the assertions that matter');
  ck('every payload carries the no-causation caveat', /not what caused/i.test(r.caveat), r.caveat);
  // The caveat itself contains the word "caused" ("not what caused it"), so
  // exclude it — otherwise the check flags the very disclaimer that makes the
  // payload safe.
  ck('no field other than the caveat claims causation', (() => {
    const { caveat, ...rest } = r;
    return !JSON.stringify(rest).match(/\b(caused|because of|due to|thanks to|proves)\b/i);
  })());
  ck('an out-of-range value is reported, not interpreted', (() => {
    const f = analyseLabs([{ test_name:'ALT', value: 90, ref_min: 7, ref_max: 40, test_date: ago(5) }], [], []);
    const s = JSON.stringify(f.out_of_range);
    return f.out_of_range[0].state === 'high' && !/liver|damage|disease|fatty/i.test(s);
  })());
  ck('a sparsely logged window is exposed by coverage', (() => {
    const sparse = logs.filter((_, i) => i % 8 === 0);
    const x = analyseLabs([
      { test_name:'HbA1c', value: 6.4, test_date: ago(95) },
      { test_name:'HbA1c', value: 5.9, test_date: ago(5) }], sparse, []);
    return x.comparisons[0].context.coverage_pct < 30;
  })());

  console.log('\n[5] endpoints');
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (n,ph,role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`,[n,ph,role])).rows[0];
  const coach = await mk('C','7101','monitor');
  const pat   = await mk('P','7102','patient');
  const other = await mk('O','7103','patient');
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`,[pat.id]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true)`,[coach.id,pat.id]);

  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u,role) => jwt.sign({id:u,role,name:'T'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const call = async (m,path,t,body) => { const res = await fetch(`http://127.0.0.1:${port}${path}`,{
    method:m, headers:{'content-type':'application/json',Authorization:'Bearer '+t},
    body: body?JSON.stringify(body):undefined});
    return { status: res.status, data: await res.json().catch(()=>({})) }; };

  let x = await call('POST','/api/patients/me/labs',tok(pat.id,'patient'),{
    test_date: ago(95), lab_name: 'Metropolis',
    results: [ { test_name:'HbA1c', value:6.4, unit:'%', ref_min:4, ref_max:5.6 },
               { test_name:'Vitamin D', value:18, unit:'ng/mL', ref_min:30, ref_max:100 } ]});
  ck('member can enter their own results', x.status === 201 && x.data.saved === 2, x.data);
  ck('abnormal values produce a notice', /reference range/i.test(x.data.notice || ''), x.data.notice);
  ck('notice does not diagnose', !/diabet|deficien|disease/i.test(x.data.notice || ''), x.data.notice);

  x = await call('POST','/api/patients/me/labs',tok(pat.id,'patient'),{
    test_date: ago(5), results: [ { test_name:'HbA1c', value:5.7, unit:'%', ref_min:4, ref_max:5.6 } ]});
  ck('a follow-up saves', x.status === 201, x.data);

  x = await call('POST','/api/patients/me/labs',tok(pat.id,'patient'),{
    test_date: iso(new Date(Date.now()+86400000)), results:[{test_name:'X',value:1}]});
  ck('a future test date is refused', x.status === 400, x.status);
  x = await call('POST','/api/patients/me/labs',tok(pat.id,'patient'),{ test_date: ago(1), results: [] });
  ck('an empty result set is refused', x.status === 400, x.status);
  x = await call('POST','/api/patients/me/labs',tok(pat.id,'patient'),{
    test_date: ago(1), results:[{test_name:'Junk', value:'abc'}]});
  ck('a non-numeric value is refused', x.status === 400, x.status);

  x = await call('GET','/api/patients/me/lab-analysis',tok(pat.id,'patient'));
  ck('member sees their own analysis', x.status === 200 && x.data.comparisons.length === 1, x.data.comparisons?.length);
  x = await call('GET',`/api/patients/${pat.id}/lab-analysis`,tok(coach.id,'monitor'));
  ck('coach sees it too', x.status === 200 && x.data.comparisons.length === 1, x.status);
  x = await call('GET',`/api/patients/${other.id}/lab-analysis`,tok(coach.id,'monitor'));
  ck('coach blocked from an unassigned member', x.status === 403, x.status);
  x = await call('GET',`/api/patients/${other.id}/lab-analysis`,tok(pat.id,'patient'));
  ck('member cannot read another member', x.status === 403, x.status);

  console.log('\n[6] lab report reader — validation without calling the AI');
  const aiApp = express(); aiApp.use(express.json({ limit: '12mb' })); aiApp.use(cookieParser());
  aiApp.use('/api/ai-chat', require('../routes/aiChat'));
  const srv2 = aiApp.listen(0); const port2 = srv2.address().port;
  const call2 = async (body, t) => { const res = await fetch(`http://127.0.0.1:${port2}/api/ai-chat/lab-report`,{
    method:'POST', headers:{'content-type':'application/json',Authorization:'Bearer '+t},
    body: JSON.stringify(body)});
    return { status: res.status, data: await res.json().catch(()=>({})) }; };

  let y = await call2({}, tok(pat.id,'patient'));
  ck('a missing file is refused', y.status === 400, y.status);
  y = await call2({ file: 'x'.repeat(10_000_001), mimeType: 'application/pdf' }, tok(pat.id,'patient'));
  ck('an oversized report is refused 413', y.status === 413, y.status);
  y = await fetch(`http://127.0.0.1:${port2}/api/ai-chat/lab-report`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: 'abc' }) });
  ck('unauthenticated upload is refused', y.status === 401, y.status);
  srv2.close();

  srv.close();
  console.log(`\n\u2550\u2550\u2550 LABS: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
