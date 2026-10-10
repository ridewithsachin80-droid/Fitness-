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
  // ── Threshold boundaries ───────────────────────────────────────────────────
  // A mutation sweep flipped the comparisons in macroLab.js one at a time and
  // this suite noticed one change in six. The ones it missed are the gates
  // that decide whether Macro Lab speaks at all and whether it names a
  // difference — an off-by-one there does not crash, it just tells a member
  // their carbs matter when the data says nothing, or stays silent when it
  // has something real.
  //
  // Every case below sits exactly ON a threshold and one step off it, which is
  // the only place these are visible.
  console.log('\n[boundaries] the gates on the carb split');

  // A day with an exact calorie count and an exact carb share.
  const dayAt = (offset, kcal, carbPct) => {
    const carbs = (kcal * carbPct) / 4;
    const pro   = 120;
    const fat   = Math.max(0, (kcal - carbs * 4 - pro * 4) / 9);
    const d = new Date(); d.setDate(d.getDate() - offset);
    return { log_date: iso(d), weight_kg: '85.0', food_items: food(kcal, pro, carbs, fat) };
  };
  // n days, half at `lowPct` and half at `highPct`.
  const split = (n, lowPct, highPct, kcalOf = () => 2000) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(dayAt(n - i, kcalOf(i), i < n / 2 ? lowPct : highPct));
    }
    return out;
  };

  // 14 fully logged days is the bar for saying anything at all.
  ck('14 logged days is enough to look at', adherence(split(14, 0.30, 0.42)).enough === true,
     adherence(split(14, 0.30, 0.42)).reason);
  const d13 = adherence(split(13, 0.30, 0.42));
  ck('13 is not, and it says how far short', d13.enough === false
     && /13 of 14 fully logged days/.test(d13.reason || ''), d13.reason);

  // The halves must actually differ: spread >= 0.08 of carb share.
  const wide = adherence(split(20, 0.30, 0.38));
  ck('a carb spread of exactly 8 points is enough to compare', wide.enough === true, wide.reason);
  const narrow = adherence(split(20, 0.30, 0.37));
  ck('7 points is not — it refuses rather than splitting noise',
     narrow.enough === false, narrow);
  ck('and the refusal names the reason a member would recognise',
     /barely varies/.test(narrow.reason || ''), narrow.reason);

  // On-target means within 10% of the calorie target, inclusive.
  const onEdge = adherence(split(20, 0.30, 0.40, () => 2200), { kcalTarget: 2000 });
  ck('a day exactly 10% over target still counts as on target',
     onEdge.enough && onEdge.groups.every(a => a.on_target_pct === 100), onEdge.groups);
  const overEdge = adherence(split(20, 0.30, 0.40, () => 2201), { kcalTarget: 2000 });
  ck('a day just past 10% does not',
     overEdge.enough && overEdge.groups.every(a => a.on_target_pct === 0), overEdge.groups);

  // Whether Macro Lab NAMES a difference. Below the bar it must stay quiet:
  // "you hit your calories more often on high-carb days" is a claim a member
  // will act on, so it should not be made about a 14-point gap that is
  // day-to-day variation wearing a costume.
  //
  // 20 days, halves of 10. Making k of the low-carb days miss the calorie
  // target moves that half's on_target_pct by exactly 10k points.
  const gap = (missesInLowHalf) => adherence(
    split(20, 0.30, 0.42, i => (i < missesInLowHalf ? 2500 : 2000)),
    { kcalTarget: 2000 });
  const near = gap(1);   // 90% vs 100% -> 10 points, under the bar
  ck('a 10-point difference in hitting the target is not called out',
     near.enough && !/calorie target on/.test(near.verdict || ''), near.verdict);
  const wideGap = gap(2); // 80% vs 100% -> 20 points, over the bar
  ck('a 20-point difference is', wideGap.enough
     && /calorie target on/.test(wideGap.verdict || ''), wideGap.verdict);
  ck('and when nothing is called out it says so rather than going blank',
     /No meaningful difference/.test(near.note || ''), near.note);

  console.log(`\n\u2550\u2550\u2550 MACRO LAB: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
