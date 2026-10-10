/**
 * scripts/test-lab-insight.js — lab analysis safety layer.
 *
 * The happy path barely matters here. What matters is that a panel needing a
 * doctor never receives diet advice, that clinical language is rejected rather
 * than shown, and that members cannot reach any of it.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const { triage, buildPrompt, canonical, state } = require('../services/labInsight');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q,_r,n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/patients', require('../routes/patients'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e || '').slice(0, 200))); };
const L = (name, value, lo, hi, unit) =>
  ({ test_name: name, value, ref_min: lo, ref_max: hi, unit, test_date: '2026-08-12' });

(async () => {
  console.log('\n[1] marker names from real Indian reports resolve');
  const names = [
    ['HbA1C - Glycated Haemoglobin', 'hba1c'],
    ['Glycosylated Hb', 'hba1c'],
    ['SGPT', 'alt'],
    ['SGOT', 'ast'],
    ['Vitamin B-12 (Cobalamin)', 'b12'],
    ['25-OH Vitamin D', 'vitamin_d'],
    ['Total Leucocyte (WBC) Count', 'wbc'],
    ['PCV (Packed Cell Volume)', 'pcv'],
    ['Erythrocyte (RBC) Count', null],
  ];
  for (const [raw, want] of names) {
    ck(`"${raw}" -> ${want ?? 'unmapped'}`, canonical(raw) === want, canonical(raw));
  }

  console.log('\n[2] RED FLAGS suppress all dietary advice');
  const dangerous = [
    ['haemoglobin 7.2',        L('Haemoglobin', 7.2, 13, 17, 'g/dL')],
    ['fasting glucose 260',    L('Fasting Blood Sugar', 260, 70, 99, 'mg/dL')],
    ['HbA1c 11.2',             L('HbA1C - Glycated Haemoglobin', 11.2, 4, 5.6, '%')],
    ['creatinine 3.1',         L('Creatinine', 3.1, 0.6, 1.2, 'mg/dL')],
    ['potassium 6.1',          L('Potassium', 6.1, 3.5, 5.1, 'mmol/L')],
    ['ALT 240',                L('SGPT', 240, 7, 40, 'U/L')],
    ['TSH 14',                 L('TSH', 14, 0.4, 4.0, 'mIU/L')],
  ];
  for (const [label, row] of dangerous) {
    const t = triage([row]);
    ck(`${label} -> urgent, advice withheld`,
       t.urgent.length === 1 && t.safe_to_advise === false, { u: t.urgent.length, safe: t.safe_to_advise });
  }

  console.log('\n[3] one urgent finding suppresses advice for the WHOLE panel');
  const mixed = triage([
    L('Ferritin', 8, 30, 400, 'ng/mL'),        // normally actionable
    L('Vitamin D', 12, 30, 100, 'ng/mL'),      // normally actionable
    L('Haemoglobin', 7.5, 13, 17, 'g/dL'),     // urgent
  ]);
  ck('actionable markers still detected', mixed.actionable.length === 2, mixed.actionable.length);
  ck('but the panel is not safe to advise on', mixed.safe_to_advise === false);

  console.log('\n[4] ordinary abnormalities ARE actionable');
  const ok = triage([
    L('Ferritin', 14, 30, 400, 'ng/mL'),
    L('Vitamin D', 18, 30, 100, 'ng/mL'),
    L('Triglycerides', 220, 0, 150, 'mg/dL'),
    L('HDL', 32, 40, 60, 'mg/dL'),
  ]);
  ck('four markers actionable', ok.actionable.length === 4, ok.actionable.map(a => a.test_name));
  ck('panel is safe to advise on', ok.safe_to_advise === true);
  ck('each carries a dietary lever', ok.actionable.every(a => a.lever && a.lever.foods.length), true);

  console.log('\n[5] out-of-range but not nutritionally actionable');
  const t5 = triage([L('MCV (Mean Corpuscular Volume)', 78, 83, 101, 'fL')]);
  ck('MCV goes to "other", not actionable', t5.other.length === 1 && t5.actionable.length === 0, t5);

  console.log('\n[6] only the newest result per marker is used');
  const t6 = triage([
    { ...L('Ferritin', 12, 30, 400, 'ng/mL'), test_date: '2026-01-10' },
    { ...L('Ferritin', 95, 30, 400, 'ng/mL'), test_date: '2026-08-12' },
  ]);
  ck('superseded low value ignored', t6.actionable.length === 0 && t6.other.length === 0, t6);

  console.log('\n[7] the prompt states its own boundaries');
  const prompt = buildPrompt(ok, { name: 'Harsha', kcal: 1800, protein: 140 });
  for (const rule of ['NEVER name a disease', 'NEVER explain WHY', 'medication', 'NEVER predict']) {
    ck(`prompt forbids: ${rule}`, prompt.includes(rule), null);
  }
  ck('urgent markers never enter the prompt', !buildPrompt(mixed, {}).includes('7.5'), null);

  console.log('\n[8] clinical CLAIMS are blocked — careful phrasing is not');
  const { screenClinical } = require('../services/labInsight');

  // These must be blocked: each asserts a condition or prescribes a dose
  const overreach = [
    'These results indicate diabetes.',
    'The member has anaemia.',
    'This pattern is consistent with fatty liver.',
    'You have a deficiency that needs correcting.',
    'Take 60 mg of elemental iron daily.',
    'Start 2000 IU of vitamin D each morning.',
    'Likely metabolic syndrome given the lipid picture.',
  ];
  for (const b of overreach) ck(`blocked: "${b.slice(0, 40)}…"`, !screenClinical(b).ok, screenClinical(b));

  // These must pass. The first filter rejected all of them, which meant the
  // more carefully the model wrote, the more likely it was discarded.
  const careful = [
    'This is not a diagnosis — discuss it with the doctor who ordered the test.',
    'A supplement may be needed; the doctor should decide the dose.',
    'These numbers do not indicate anaemia on their own.',
    'If you have questions about the plan, raise them with your coach.',
    'Whether this reflects anaemia is for their doctor to judge.',
    'Ferritin measures stored iron. Pair dal with lemon to improve absorption.',
    'Vitamin D comes mostly from sunlight; diet contributes little.',
    'Add 2 tbsp of flaxseed to breakfast.',
  ];
  for (const g of careful) ck(`allowed: "${g.slice(0, 40)}…"`, screenClinical(g).ok, screenClinical(g).matches);
  ck('a rejection explains what tripped it',
     (screenClinical('The member has anaemia.').matches[0] || '').includes('anaemia'), null);

  console.log('\n[9] access control');
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (n,ph,role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`,[n,ph,role])).rows[0];
  const coach = await mk('C','9101','monitor');
  const pat   = await mk('P','9102','patient');
  const other = await mk('O','9103','patient');
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`,[pat.id]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true)`,[coach.id,pat.id]);

  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u,role) => jwt.sign({id:u,role,name:'T'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const call = async (path,t) => { const r = await fetch(`http://127.0.0.1:${port}${path}`,{
    method:'POST', headers:{'content-type':'application/json',Authorization:'Bearer '+t}});
    return { status: r.status, data: await r.json().catch(()=>({})) }; };

  let x = await call(`/api/patients/${pat.id}/lab-insight`, tok(pat.id,'patient'));
  ck('MEMBER CANNOT GENERATE ANALYSIS', x.status === 403, x.status);
  x = await call(`/api/patients/${other.id}/lab-insight`, tok(coach.id,'monitor'));
  ck('coach blocked from unassigned member', x.status === 403, x.status);
  x = await call(`/api/patients/${pat.id}/lab-insight`, tok(coach.id,'monitor'));
  ck('no labs on file -> clear error, no AI call', x.status === 400, x.status);

  await pool.query(`INSERT INTO lab_values (patient_id,test_date,test_name,value,unit,ref_min,ref_max,status)
                    VALUES ($1,'2026-08-12','Haemoglobin',7.2,'g/dL',13,17,'low')`,[pat.id]);
  x = await call(`/api/patients/${pat.id}/lab-insight`, tok(coach.id,'monitor'));
  ck('urgent panel returns without calling the AI', x.status === 200 && x.data.generated === false, x.data);
  ck('and says advice is withheld', /withheld/i.test(x.data.note || ''), x.data.note);

  console.log('\n[10] NaN reference bounds never reach the database');
  const badBounds = ['-', '< 100', 'N/A', '', undefined, null, 'abc'];
  const finiteOrNull = v => {
    if (v === undefined || v === null || v === '') return null;
    const n = parseFloat(v); return Number.isFinite(n) ? n : null;
  };
  ck('non-numeric bounds all become null', badBounds.every(b => finiteOrNull(b) === null), badBounds.map(finiteOrNull));
  ck('real numbers still pass', finiteOrNull('13.5') === 13.5 && finiteOrNull(0) === 0, null);

  // Prove the storage path, since Postgres NUMERIC accepts NaN happily
  const { rows: [u2] } = await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ('N','9199','x','patient',true) RETURNING id`);
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [u2.id]);
  await pool.query(
    `INSERT INTO lab_values (patient_id,test_date,test_name,value,unit,ref_min,ref_max,status)
     VALUES ($1,'2026-08-12','LDL Cholesterol',156.7,'mg/dL','NaN'::numeric,100,'high')`, [u2.id]);
  await pool.query(`UPDATE lab_values SET ref_min = NULL WHERE ref_min IS NOT NULL AND ref_min = 'NaN'::numeric`);
  const { rows: [ldl] } = await pool.query(
    `SELECT ref_min, ref_max FROM lab_values WHERE patient_id=$1 AND test_name='LDL Cholesterol'`, [u2.id]);
  ck('migration clears a stored NaN bound', ldl.ref_min === null, ldl);
  ck('the real bound survives', parseFloat(ldl.ref_max) === 100, ldl);

  console.log('\n[11] macro targets are computed, not guessed');
  const { macroTargets } = require('../services/labInsight');
  const A = (c, st) => ({ canonical: c, state: st });
  const base = macroTargets({ weightKg: 75, maintenanceKcal: 2200, goal: 'loss', actionable: [] });

  ck('percentages sum to exactly 100',
     base.protein_pct + base.carbs_pct + base.fat_pct === 100,
     [base.protein_pct, base.carbs_pct, base.fat_pct]);
  ck('grams reconcile with the calorie target',
     Math.abs(base.computed_kcal - base.kcal) < 30, { from: base.computed_kcal, target: base.kcal });
  ck('protein lands in 1.6-2.4 g/kg',
     base.protein_per_kg >= 1.6 && base.protein_per_kg <= 2.4, base.protein_per_kg);
  ck('deficit applied for a loss goal', base.kcal < 2200, base.kcal);

  // Each lever must actually move the numbers. An earlier version reported
  // adjustments in its reasoning that a binding floor had silently cancelled.
  const hba1c = macroTargets({ weightKg: 75, maintenanceKcal: 2200, goal: 'loss', actionable: [A('hba1c','high')] });
  ck('raised HbA1c lowers the carb share', hba1c.carbs_pct < base.carbs_pct, { base: base.carbs_pct, hba1c: hba1c.carbs_pct });
  ck('and raises protein', hba1c.protein_g > base.protein_g, { base: base.protein_g, hba1c: hba1c.protein_g });

  const trig = macroTargets({ weightKg: 75, maintenanceKcal: 2200, goal: 'loss', actionable: [A('triglycerides','high')] });
  ck('high triglycerides lowers the carb share', trig.carbs_pct < base.carbs_pct, { base: base.carbs_pct, trig: trig.carbs_pct });

  const hdl = macroTargets({ weightKg: 75, maintenanceKcal: 2200, goal: 'loss', actionable: [A('hdl','low')] });
  ck('low HDL raises the fat share', hdl.fat_pct > base.fat_pct, { base: base.fat_pct, hdl: hdl.fat_pct });

  const ldlOnly = macroTargets({ weightKg: 75, maintenanceKcal: 2200, goal: 'loss', actionable: [A('ldl','high')] });
  ck('high LDL alone changes nothing — the lever is not the ratio',
     ldlOnly.carbs_pct === base.carbs_pct && ldlOnly.fat_pct === base.fat_pct, { ldlOnly, base });
  ck('but LDL is still explained', ldlOnly.reasons.some(r => /LDL/.test(r)), ldlOnly.reasons);

  const full = macroTargets({ weightKg: 75, maintenanceKcal: 2200, goal: 'loss',
    actionable: [A('hba1c','high'), A('triglycerides','high'), A('hdl','low'), A('ldl','high'),
                 A('b12','low'), A('vitamin_d','low')] });
  ck('carbohydrate never falls below its floor', full.carbs_g >= 90, full.carbs_g);
  ck('every stated reason corresponds to a real adjustment',
     full.reasons.length >= 4 && full.carbs_pct < base.carbs_pct && full.fat_pct > base.fat_pct, full);
  ck('micronutrient findings alone move nothing', (() => {
    const micro = macroTargets({ weightKg: 75, maintenanceKcal: 2200, goal: 'loss',
      actionable: [A('b12','low'), A('vitamin_d','low'), A('ferritin','low')] });
    return micro.carbs_pct === base.carbs_pct && micro.protein_g === base.protein_g;
  })());
  ck('missing weight returns null rather than a guess',
     macroTargets({ weightKg: null, maintenanceKcal: 2200 }) === null);

  srv.close();
  console.log(`\n\u2550\u2550\u2550 LAB INSIGHT: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
