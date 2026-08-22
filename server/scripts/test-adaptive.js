/**
 * scripts/test-adaptive.js — the adaptive metabolic engine.
 *
 * The engine claims to recover a member's true maintenance calories from
 * their logs. These assertions simulate members whose real metabolism is
 * known, feed the engine only what the app would actually have, and check
 * how close it gets — plus that it refuses to answer when it should.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const { analyse, smooth, regress, KCAL_PER_KG } = require('../services/adaptiveEngine');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q, _r, n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/patients', require('../routes/patients'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e || '').slice(0, 200))); };

function simulate({ days, trueTDEE, intake, startW, noise = 0.8, foodEvery = 1, seed = 7 }) {
  let s = seed; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const logs = []; let w = startW;
  const start = new Date(); start.setDate(start.getDate() - days);
  for (let d = 0; d < days; d++) {
    const date = new Date(start); date.setDate(date.getDate() + d);
    w += (intake - trueTDEE) / KCAL_PER_KG;
    logs.push({
      log_date: date.toISOString().slice(0, 10),
      weight_kg: (w + (rnd() - 0.5) * 2 * noise).toFixed(1),
      food_items: d % foodEvery === 0
        ? [{ name: 'Day', grams: 1000, per_100g: {
            calories: intake / 10, protein: 9, total_carbs: 11, fat: 3,
            iron: 0.6, calcium: 30, vit_c: 1.2, fiber: 1.5 } }]
        : [],
    });
  }
  return logs;
}

(async () => {
  console.log('\n[1] maths primitives');
  ck('smoothing flattens a spike', (() => {
    const sm = smooth([70, 70, 75, 70, 70], 3);
    return sm[2] < 73 && sm[2] > 70;
  })());
  ck('regression finds a known slope', (() => {
    const { slope, r2 } = regress([0, 1, 2, 3, 4], [10, 12, 14, 16, 18]);
    return Math.abs(slope - 2) < 0.001 && r2 > 0.99;
  })());

  console.log('\n[2] recovering a known metabolism');
  for (const c of [
    { label: 'losing  (TDEE 2400, eats 1900)', trueTDEE: 2400, intake: 1900, startW: 83 },
    { label: 'slow    (TDEE 2100, eats 1950)', trueTDEE: 2100, intake: 1950, startW: 78 },
    { label: 'gaining (TDEE 2500, eats 2800)', trueTDEE: 2500, intake: 2800, startW: 65 },
  ]) {
    const r = analyse(simulate({ days: 30, ...c }), { bmr: 1760, goalWeight: 75 });
    const err = Math.abs((r.observed_tdee - c.trueTDEE) / c.trueTDEE * 100);
    ck(`${c.label} -> ${r.observed_tdee} (within 5%)`, err < 5, { found: r.observed_tdee, err: err.toFixed(1) });
  }

  console.log('\n[3] a noisy scale does not break it');
  const noisy = analyse(simulate({ days: 30, trueTDEE: 2400, intake: 1900, startW: 83, noise: 1.5 }),
                        { bmr: 1760 });
  ck('±1.5kg daily swing still within 5%',
     Math.abs((noisy.observed_tdee - 2400) / 2400 * 100) < 5, noisy.observed_tdee);

  console.log('\n[4] it refuses when it should');
  const short = analyse(simulate({ days: 10, trueTDEE: 2400, intake: 1900, startW: 83 }), { bmr: 1760 });
  ck('10 days -> no answer', short.observed_tdee === null && short.confidence === 'insufficient', short.reason);
  const patchy = analyse(simulate({ days: 30, trueTDEE: 2400, intake: 1900, startW: 83, foodEvery: 3 }), { bmr: 1760 });
  ck('food logged 1 day in 3 -> no answer', patchy.observed_tdee === null, patchy.reason);
  ck('and it says why', typeof patchy.reason === 'string' && patchy.reason.length > 5, patchy.reason);
  const empty = analyse([], { bmr: 1760 });
  ck('no data at all -> no crash', empty.observed_tdee === null && empty.confidence === 'insufficient');

  console.log('\n[5] confidence tracks data quality');
  const good = analyse(simulate({ days: 40, trueTDEE: 2400, intake: 1900, startW: 83, noise: 0.5 }), { bmr: 1760 });
  ck('40 clean days -> high', good.confidence === 'high', good.confidence);
  const meh = analyse(simulate({ days: 16, trueTDEE: 2400, intake: 1900, startW: 83, noise: 1.2 }), { bmr: 1760 });
  ck('16 days -> not high', meh.confidence !== 'high', meh.confidence);

  console.log('\n[6] targets are sane');
  const t = analyse(simulate({ days: 30, trueTDEE: 2400, intake: 1900, startW: 83 }),
                    { bmr: 1760, goalWeight: 75 }).targets;
  ck('kcal below maintenance for a loss goal', t.kcal < 2400, t.kcal);
  ck('kcal never below 1200', t.kcal >= 1200, t.kcal);
  ck('protein 1.5-2.5 g/kg', t.protein_g / 83 >= 1.5 && t.protein_g / 83 <= 2.5, (t.protein_g / 83).toFixed(2));
  ck('fat at least 0.8 g/kg', t.fat_g / 83 >= 0.8, (t.fat_g / 83).toFixed(2));
  ck('macros reconcile with the kcal target',
     Math.abs((t.protein_g * 4 + t.carbs_g * 4 + t.fat_g * 9) - t.kcal) < 60,
     { fromMacros: t.protein_g * 4 + t.carbs_g * 4 + t.fat_g * 9, kcal: t.kcal });
  ck('loss rate under 1% of body weight per week', Math.abs(t.weekly_change_kg) / 83 < 0.01, t.weekly_change_kg);

  console.log('\n[7] micronutrient gaps');
  const gaps = analyse(simulate({ days: 30, trueTDEE: 2400, intake: 1900, startW: 83 }), { bmr: 1760 }).micro_gaps;
  ck('gaps reported', Array.isArray(gaps) && gaps.length > 0, gaps?.length);
  ck('each has a percentage under 70', gaps.every(g => g.pct < 70), gaps.map(g => g.pct));
  ck('worst gap listed first', gaps.every((g, i) => i === 0 || g.pct >= gaps[i - 1].pct), gaps.map(g => g.pct));

  console.log('\n[8] endpoints and access control');
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const { rows: [coach] } = await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ('C','2001','x','monitor',true) RETURNING id`);
  const { rows: [pat] }   = await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ('P','2002','x','patient',true) RETURNING id`);
  const { rows: [other] } = await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ('O','2003','x','patient',true) RETURNING id`);
  await pool.query(`INSERT INTO patient_profiles (user_id,height_cm,gender,dob,target_weight) VALUES ($1,181,'male','1985-04-10',75)`, [pat.id]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true)`, [coach.id, pat.id]);
  for (const l of simulate({ days: 30, trueTDEE: 2400, intake: 1900, startW: 83 })) {
    await pool.query(`INSERT INTO daily_logs (patient_id,log_date,weight_kg,food_items) VALUES ($1,$2,$3,$4)`,
      [pat.id, l.log_date, l.weight_kg, JSON.stringify(l.food_items)]);
  }
  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u, r) => jwt.sign({ id: u, role: r, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const call = async (path, t) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: 'Bearer ' + t } });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  let r = await call('/api/patients/me/adaptive', tok(pat.id, 'patient'));
  ck('member sees their own analysis', r.status === 200 && r.data.observed_tdee > 0, r.data.observed_tdee);
  ck('and it lands near the true 2400', Math.abs(r.data.observed_tdee - 2400) < 150, r.data.observed_tdee);

  r = await call(`/api/patients/${pat.id}/adaptive`, tok(coach.id, 'monitor'));
  ck('coach sees their assigned member', r.status === 200 && r.data.observed_tdee > 0, r.status);
  r = await call(`/api/patients/${other.id}/adaptive`, tok(coach.id, 'monitor'));
  ck('coach blocked from an unassigned member', r.status === 403, r.status);
  r = await call(`/api/patients/${other.id}/adaptive`, tok(pat.id, 'patient'));
  ck('member blocked from the coach route', r.status === 403, r.status);

  srv.close();
  console.log(`\n\u2550\u2550\u2550 ADAPTIVE ENGINE: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
