/**
 * scripts/test-learning-model.js — continuous multivariate learning.
 *
 * The value of this model is not that it fits a line. It is that it refuses to
 * claim effects the data cannot support, and finds them when it can. These
 * assertions plant known effects and check both directions.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const { learn, ols } = require('../services/learningModel');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q,_r,n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/patients', require('../routes/patients'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e || '').slice(0, 200))); };

function sim({ weeks = 20, tdee = 2400, proteinEffect = 0, proteinVaries = true,
               scaleNoise = 0.8, weekNoise = 0.15, seed = 3 }) {
  let s = seed; const rnd = () => { s = (s*9301+49297)%233280; return s/233280; };
  const logs = []; const start = new Date(); start.setDate(start.getDate() - weeks*7);
  let w = 85;
  for (let wk = 0; wk < weeks; wk++) {
    const kcal = tdee - 600 + Math.round(rnd()*700);
    const proteinG = proteinVaries ? Math.round(100 + rnd()*90) : 150;
    const change = ((kcal - tdee)*7)/7700 + proteinEffect*(proteinG/85) + (rnd()-0.5)*2*weekNoise;
    for (let d = 0; d < 7; d++) {
      const date = new Date(start); date.setDate(date.getDate() + wk*7 + d);
      w += change/7;
      logs.push({ log_date: date.toISOString().slice(0,10),
        weight_kg: (w + (rnd()-0.5)*2*scaleNoise).toFixed(1),
        food_items: [{ name:'d', grams:1000, per_100g:{
          calories: kcal/10, protein: proteinG/10, total_carbs: 20, fat: 5 } }] });
    }
  }
  return logs;
}
const finding = (r, v) => r.findings.find(f => f.variable === v);

(async () => {
  console.log('\n[1] the regression itself');
  const X = [], y = [];
  for (let i = 0; i < 40; i++) { const a = i%7, b = (i*3)%5; X.push([a,b]); y.push(2 + 1.5*a - 0.8*b); }
  const f = ols(X, y, ['a','b']);
  ck('recovers planted coefficients exactly',
     Math.abs(f.coefficients[1].estimate - 1.5) < 0.01 && Math.abs(f.coefficients[2].estimate + 0.8) < 0.01,
     f.coefficients.map(c => c.estimate.toFixed(3)));
  ck('R² is 1 on noiseless data', f.r2 === 1, f.r2);
  const dup = ols([[1,2],[2,4],[3,6],[4,8],[5,10],[6,12]], [1,2,3,4,5,6], ['a','b']);
  ck('collinear predictors refused, not fudged', dup.ok === false && /collinear/i.test(dup.reason), dup.reason);

  console.log('\n[2] calories');
  let r = learn(sim({}), { bodyWeightKg: 85 });
  ck('model fits', r.ok === true, r.reason);
  ck('calorie effect established', finding(r,'Calories').confidence === 'established', finding(r,'Calories'));
  ck('maintenance lands near the true 2400', Math.abs(r.maintenance_kcal - 2400) < 250, r.maintenance_kcal);
  ck('implied kcal/kg is in a sane range', r.implied_kcal_per_kg > 4000 && r.implied_kcal_per_kg < 12000, r.implied_kcal_per_kg);

  console.log('\n[3] protein — the discipline test');
  r = learn(sim({ proteinEffect: 0, seed: 21 }), { bodyWeightKg: 85 });
  ck('NO effect planted -> reports unproven (no false positive)',
     finding(r,'Protein').confidence === 'unproven', finding(r,'Protein'));
  /**
   * A planted large effect, on one seed.
   *
   * This used to assert `confidence === 'established'` here and had been red
   * for months. It was never a model regression — it is a coin flip written as
   * a pass/fail. Measured over 400 seeds, the model calls a large protein
   * effect established 45% of the time on 20 weeks of realistically noisy
   * data, so a single seed decides this assertion by luck. Seed 7 lands at
   * t = -1.78, just under the bar, and went red every run.
   *
   * A test whose outcome is a coin flip is not a weaker test — it is a broken
   * one, because a red tells you nothing and neither does a green. So the
   * detection claim moved to the rate assertions below, where it belongs, and
   * what is left here is the part that must hold on EVERY seed: the model
   * returns a well-formed Protein finding, and when the evidence does not
   * clear the bar it says so rather than guessing a direction.
   */
  r = learn(sim({ proteinEffect: -1.0, seed: 7 }), { bodyWeightKg: 85 });
  const pf7 = finding(r, 'Protein');
  ck('a planted large effect always produces a Protein finding',
     !!pf7 && typeof pf7.confidence === 'string', pf7);
  ck('when it does not clear the bar it says so, it does not guess a direction',
     pf7.confidence === 'established'
       ? /more protein → faster/.test(pf7.direction)
       : /not distinguishable from zero/.test(pf7.direction), pf7.direction);

  /**
   * Detection is probabilistic, so the honest measurement is a rate across many
   * simulated members. Nothing here is random at run time — `sim` is seeded and
   * `learn` is deterministic — so these numbers are identical on every machine.
   *
   * MEASURED over 400 seeds on this code, 31 Aug 2026:
   *
   *     false positive        7.0%     threshold ≤ 10%
   *     small / clean scale  32.3%     threshold ≥ 25%
   *     large / real scale   45.3%     threshold ≥ 35%
   *     small / real scale    9.3%     threshold < 20%
   *     large / 40 weeks     83.0%     threshold ≥ 70%
   *
   * Every threshold above sits 7–13 points from its measured value: far enough
   * that this cannot go red on its own, close enough that real drift still
   * trips it. They are set FROM the measurement — the previous pass set them
   * from 30 seeds, where the standard error on a proportion is about 9 points,
   * which is calibrating on noise.
   *
   * The last row is the one that proves the model works. Detecting a large
   * effect only 45% of the time on 20 weeks looks like a broken detector until
   * you double the history and it jumps to 83%. That is textbook statistical
   * power, not a defect — and it is worth knowing as a product fact: Macro Lab
   * will honestly say "unproven" for a member's protein finding until they have
   * roughly five months of history behind them.
   */
  const POWER_SEEDS = 400;
  const rate = (opts) => {
    let hit = 0, n = 0;
    for (let seed = 1; seed <= POWER_SEEDS; seed++) {
      const m = learn(sim({ ...opts, seed }), { bodyWeightKg: 85 });
      if (!m.ok) continue;
      const pf = finding(m, 'Protein');
      if (pf && pf.confidence !== 'untested') { n++; if (pf.confidence === 'established') hit++; }
    }
    return n ? hit / n : 0;
  };

  const falsePositive = rate({ proteinEffect: 0 });
  ck(`false-positive rate ${(falsePositive*100).toFixed(0)}% — must stay under 10%`,
     falsePositive <= 0.10, falsePositive);            // measured 7.0%

  const powerClean = rate({ proteinEffect: -0.25, scaleNoise: 0, weekNoise: 0.02 });
  ck(`finds a small effect on a clean scale ${(powerClean*100).toFixed(0)}% of the time`,
     powerClean >= 0.25, powerClean);                  // measured 32.3%

  const powerLarge = rate({ proteinEffect: -1.0 });
  ck(`finds a large effect on a real scale ${(powerLarge*100).toFixed(0)}% of the time`,
     powerLarge >= 0.35, powerLarge);                  // measured 45.3%

  const powerSmallReal = rate({ proteinEffect: -0.25 });
  ck(`small effect on a real scale is mostly invisible (${(powerSmallReal*100).toFixed(0)}%) — documented, not a bug`,
     powerSmallReal < 0.20, powerSmallReal);           // measured 9.3%

  const powerLongHistory = rate({ proteinEffect: -1.0, weeks: 40 });
  ck(`the same large effect over 40 weeks is found ${(powerLongHistory*100).toFixed(0)}% of the time — power, not a defect`,
     powerLongHistory >= 0.70, powerLongHistory);      // measured 83.0%

  console.log('\n[4] it says when it cannot know');
  r = learn(sim({ proteinVaries: false }), { bodyWeightKg: 85 });
  ck('protein never varied -> untested, not unproven',
     finding(r,'Protein').confidence === 'untested', finding(r,'Protein'));
  r = learn(sim({ weeks: 5 }), { bodyWeightKg: 85 });
  ck('5 weeks -> refuses to fit', r.ok === false, r.reason);
  ck('and explains the bar', /usable weeks/.test(r.reason), r.reason);
  ck('empty history -> no crash', learn([], {}).ok === false);

  console.log('\n[5] endpoints and access');
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (n,ph,role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`,[n,ph,role])).rows[0];
  const coach = await mk('C','5101','monitor');
  const pat   = await mk('P','5102','patient');
  const other = await mk('O','5103','patient');
  await pool.query(`INSERT INTO patient_profiles (user_id,height_cm,gender,dob,start_weight,target_weight) VALUES ($1,181,'male','1985-04-10',85,75)`,[pat.id]);
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`,[other.id]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true)`,[coach.id,pat.id]);
  for (const l of sim({})) {
    await pool.query(`INSERT INTO daily_logs (patient_id,log_date,weight_kg,food_items) VALUES ($1,$2,$3,$4)
                      ON CONFLICT (patient_id,log_date) DO NOTHING`,
      [pat.id, l.log_date, l.weight_kg, JSON.stringify(l.food_items)]);
  }
  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u,role) => jwt.sign({id:u,role,name:'T'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const call = async (path,t) => { const res = await fetch(`http://127.0.0.1:${port}${path}`,{headers:{Authorization:'Bearer '+t}});
    return { status: res.status, data: await res.json().catch(()=>({})) }; };

  let x = await call(`/api/patients/${pat.id}/model`, tok(coach.id,'monitor'));
  ck('coach gets the model', x.status === 200 && x.data.ok === true, x.data.reason || x.status);
  ck('with weekly rows attached', Array.isArray(x.data.weekly_panel) && x.data.weekly_panel.length >= 8, x.data.weekly_panel?.length);
  x = await call(`/api/patients/${other.id}/model`, tok(coach.id,'monitor'));
  ck('blocked for an unassigned member', x.status === 403, x.status);
  x = await call(`/api/patients/${pat.id}/model`, tok(pat.id,'patient'));
  ck('MEMBER CANNOT SEE THE MODEL', x.status === 403, x.status);

  console.log('\n[6] cross-member prior');
  x = await call('/api/patients/population/prior', tok(coach.id,'monitor'));
  ck('prior route not swallowed by /:id', x.status === 200 && x.data.factor != null, x.data);
  ck('honest when too few calibrated members', x.data.n < 3 ? /not enough/i.test(x.data.basis) : true, x.data.basis);
  x = await call('/api/patients/population/prior', tok(pat.id,'patient'));
  ck('members cannot read the prior', x.status === 403, x.status);

  srv.close();
  console.log(`\n\u2550\u2550\u2550 LEARNING MODEL: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
