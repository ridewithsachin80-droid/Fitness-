/**
 * scripts/test-macrolab.js — adherence patterns and macro trial comparison.
 *
 * The point of these assertions is not that the maths runs. It is that the
 * engine REFUSES to claim things the data cannot support: it must call a
 * glycogen shift what it is, must not name a winner inside the noise floor,
 * and must flag a trial where calories drifted.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const { adherence, compareArms, weeklyNoise } = require('../services/macroLab');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q,_r,n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/patients', require('../routes/patients'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e || '').slice(0, 220))); };

const iso = d => d.toISOString().slice(0, 10);
function food(kcal, protein, carbs, fat) {
  return [{ name: 'Day', grams: 1000, per_100g:
    { calories: kcal / 10, protein: protein / 10, total_carbs: carbs / 10, fat: fat / 10 } }];
}

/**
 * Build a trial history. `glycogenDrop` simulates the 1.5kg water loss that
 * happens in the first days of a low-carb arm — the artifact the washout
 * exists to remove.
 */
function trialLogs({ days = 80, startW = 85, aRate, bRate, aKcal = 1850, bKcal = 1850,
                     aPro = 165, bPro = 165, aCarb = 220, bCarb = 120,
                     switchAt = 40, glycogenDrop = 0, noise = 0.6, seed = 5 }) {
  let s = seed; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const logs = []; let w = startW;
  const start = new Date(); start.setDate(start.getDate() - days);
  for (let d = 0; d < days; d++) {
    const date = new Date(start); date.setDate(date.getDate() + d);
    const inB = d >= switchAt;
    w += (inB ? bRate : aRate) / 7;
    // water shift in the first 5 days of arm B
    if (inB && d < switchAt + 5) w -= glycogenDrop / 5;
    logs.push({
      log_date: iso(date),
      weight_kg: (w + (rnd() - 0.5) * 2 * noise).toFixed(1),
      food_items: inB ? food(bKcal, bPro, bCarb, (bKcal - bPro*4 - bCarb*4) / 9)
                      : food(aKcal, aPro, aCarb, (aKcal - aPro*4 - aCarb*4) / 9),
    });
  }
  const sw = new Date(start); sw.setDate(sw.getDate() + switchAt);
  return { logs, trial: { a_started_on: iso(start), b_started_on: iso(sw),
                          completed_on: null, washout_days: 10 } };
}

(async () => {
  console.log('\n[1] noise floor');
  const { logs: steady } = trialLogs({ aRate: -0.4, bRate: -0.4, noise: 0.6 });
  const nf = weeklyNoise(steady);
  ck('a personal weekly variation is computed', nf != null && nf > 0, nf);

  console.log('\n[2] identical arms must NOT produce a winner');
  let t = trialLogs({ aRate: -0.4, bRate: -0.4 });
  let r = compareArms(t.logs, t.trial);
  ck('reports no detectable difference', r.status === 'no_difference', r.status + ' / ' + r.headline);
  ck('and tells the coach to let them choose', /choose/i.test(r.recommendation || ''), r.recommendation);

  console.log('\n[3] a glycogen water drop must NOT be sold as fat loss');
  t = trialLogs({ aRate: -0.4, bRate: -0.4, glycogenDrop: 1.5 });
  r = compareArms(t.logs, t.trial);
  ck('washout absorbs the water shift, still no winner', r.status === 'no_difference',
     { status: r.status, diff: r.difference_kg_per_week });

  console.log('\n[4] a genuinely large difference IS reported');
  t = trialLogs({ aRate: -0.15, bRate: -0.85, noise: 0.4 });
  r = compareArms(t.logs, t.trial);
  ck('difference detected', r.status === 'difference', { status: r.status, diff: r.difference_kg_per_week });
  ck('arm B named as better', r.winner === 'B', r.winner);
  ck('and it still carries a caveat', /repeating/i.test(r.caveat || ''), r.caveat);

  console.log('\n[5] an uncontrolled trial is flagged, not scored');
  t = trialLogs({ aRate: -0.2, bRate: -0.9, aKcal: 2100, bKcal: 1600, noise: 0.4 });
  r = compareArms(t.logs, t.trial);
  ck('confounded, not a winner', r.status === 'confounded', r.status);
  ck('names calories as the reason', /calorie/i.test(r.detail), r.detail);

  console.log('\n[6] too little data');
  t = trialLogs({ days: 26, switchAt: 13, aRate: -0.4, bRate: -0.4 });
  r = compareArms(t.logs, t.trial);
  ck('incomplete rather than guessed', r.status === 'incomplete', r.status);

  console.log('\n[7] adherence');
  // A member who logs well on high-carb days and poorly on low-carb days
  const aLogs = [];
  const st = new Date(); st.setDate(st.getDate() - 60);
  for (let d = 0; d < 60; d++) {
    const date = new Date(st); date.setDate(date.getDate() + d);
    const highCarb = d % 2 === 0;
    const skip = !highCarb && d % 4 === 1;          // misses some low-carb days
    aLogs.push({
      log_date: iso(date), weight_kg: 80,
      food_items: skip ? [] : (highCarb ? food(1850, 160, 230, 55) : food(2250, 160, 90, 135)),
    });
  }
  const ad = adherence(aLogs, { kcalTarget: 1850 });
  ck('has enough data', ad.enough === true, ad.reason);
  ck('two groups reported', ad.groups?.length === 2, ad.groups?.length);
  ck('spots the sustained split', !!ad.verdict, ad.verdict);
  ck('labels it behavioural, not metabolic', /behavioural/i.test(ad.note), ad.note);

  const flat = Array.from({ length: 30 }, (_, d) => {
    const date = new Date(st); date.setDate(date.getDate() + d);
    return { log_date: iso(date), weight_kg: 80, food_items: food(1850, 160, 200, 60) };
  });
  const adFlat = adherence(flat, { kcalTarget: 1850 });
  ck('identical daily intake -> refuses to compare', adFlat.enough === false, adFlat.reason);

  console.log('\n[8] endpoints, access control and guards');
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (n, ph, role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`,
    [n, ph, role])).rows[0];
  const coach = await mk('C', '1101', 'monitor');
  const pat   = await mk('P', '1102', 'patient');
  const other = await mk('O', '1103', 'patient');
  await pool.query(`INSERT INTO patient_profiles (user_id, macro_kcal) VALUES ($1, 1850)`, [pat.id]);
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [other.id]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true)`, [coach.id, pat.id]);

  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u, r) => jwt.sign({ id: u, role: r, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const call = async (m, path, t, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: m, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + t },
      body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const A = { label: 'Higher carb', kcal: 1850, protein_g: 165, carbs_g: 220, fat_g: 60 };
  const B = { label: 'Higher fat',  kcal: 1850, protein_g: 165, carbs_g: 120, fat_g: 105 };

  let x = await call('POST', `/api/patients/${pat.id}/trial`, tok(coach.id, 'monitor'), { arm_a: A, arm_b: B });
  ck('coach can start a trial', x.status === 200 && x.data.trial?.current_arm === 'A', x.data);
  const { rows: pr } = await pool.query(`SELECT macro_carb, macro_fat FROM patient_profiles WHERE user_id=$1`, [pat.id]);
  ck("arm A's macros applied to the protocol", pr[0].macro_carb === 220 && pr[0].macro_fat === 60, pr[0]);

  x = await call('POST', `/api/patients/${pat.id}/trial`, tok(coach.id, 'monitor'),
                 { arm_a: A, arm_b: { ...B, kcal: 1500 } });
  ck('refuses arms with different calories', x.status === 400, x.data);
  x = await call('POST', `/api/patients/${pat.id}/trial`, tok(coach.id, 'monitor'),
                 { arm_a: A, arm_b: { ...B, protein_g: 100 } });
  ck('refuses arms with different protein', x.status === 400, x.data);

  x = await call('POST', `/api/patients/${pat.id}/trial/advance`, tok(coach.id, 'monitor'));
  ck('advancing moves to arm B', x.data.moved_to === 'B', x.data);
  const { rows: pr2 } = await pool.query(`SELECT macro_carb, macro_fat FROM patient_profiles WHERE user_id=$1`, [pat.id]);
  ck("arm B's macros applied", pr2[0].macro_carb === 120 && pr2[0].macro_fat === 105, pr2[0]);

  x = await call('GET', `/api/patients/${pat.id}/trial`, tok(coach.id, 'monitor'));
  ck('trial readable by the coach', x.status === 200 && !!x.data.trial, x.status);

  x = await call('GET', `/api/patients/${other.id}/adherence`, tok(coach.id, 'monitor'));
  ck('coach blocked from an unassigned member', x.status === 403, x.status);
  x = await call('GET', `/api/patients/${pat.id}/adherence`, tok(pat.id, 'patient'));
  ck('MEMBER CANNOT SEE ADHERENCE', x.status === 403, x.status);
  x = await call('GET', `/api/patients/${pat.id}/trial`, tok(pat.id, 'patient'));
  ck('MEMBER CANNOT SEE THE TRIAL', x.status === 403, x.status);
  x = await call('POST', `/api/patients/${pat.id}/trial`, tok(pat.id, 'patient'), { arm_a: A, arm_b: B });
  ck('member cannot start one either', x.status === 403, x.status);

  srv.close();
  console.log(`\n\u2550\u2550\u2550 MACRO LAB: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
