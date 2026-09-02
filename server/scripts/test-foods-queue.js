/**
 * scripts/test-foods-queue.js — the food verification queue (Sprint L3).
 *
 * An unverified food with wrong macros silently distorts every calorie number
 * for every member who logs it. Three things have to hold for the queue to be
 * worth opening:
 *
 *   1. RANKING     — the food forty members eat outranks the one logged once,
 *                    and a food whose calories contradict its own macros
 *                    outranks both. A queue in arbitrary order never gets
 *                    worked, which is the state this started in.
 *   2. THE FLAG    — the Atwater check must actually separate good from bad.
 *                    A checker that says "ok" to everything turns the queue
 *                    back into an unordered list while looking like a feature.
 *   3. PROVENANCE  — verifying records who and when, and un-verifying clears
 *                    it rather than leaving a stale name on a food nobody
 *                    stands behind.
 *
 * Also asserts that /review and /unverified are the SAME handler. They were
 * mounted as two paths on purpose; two handlers would drift apart and only one
 * of them would ever get fixed.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const { macroPlausibility, atwaterKcal, cookingFatPlausibility } = require('../services/macroCheck');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use('/api/foods', require('../routes/foods'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 200))); };

const per = (cal, pro, carb, fat) => JSON.stringify({ calories: cal, protein: pro, total_carbs: carb, fat });

(async () => {
  // ── 1. The macro check, in isolation ───────────────────────────────────────
  // Pure arithmetic, so it is asserted directly rather than inferred from an
  // HTTP response. Both directions on every rule.
  console.log('\n[1] macro consistency (Atwater)');
  {
    ck('4·P + 4·C + 9·F', atwaterKcal({ protein: 10, total_carbs: 20, fat: 5 }) === 165,
      atwaterKcal({ protein: 10, total_carbs: 20, fat: 5 }));

    // Roti: 297 kcal, P11 C58 F3.7 -> atwater 309. Real food, genuinely fine.
    ck('a real food passes',
      macroPlausibility({ calories: 297, protein: 11, total_carbs: 58, fat: 3.7 }, 'Roti').status === 'ok');

    // A per-SERVING calorie figure sitting next to per-100g macros. This is the
    // shape Atwater actually catches: the two numbers disagree with each other.
    ck('a per-serving calorie next to per-100g macros is caught',
      macroPlausibility({ calories: 100, protein: 25, total_carbs: 20, fat: 50 }, 'Peanut Butter').status === 'suspect');

    // What it CANNOT catch, asserted so nobody later assumes it does: if the
    // whole row is scaled to a 30g scoop, calories and macros still agree with
    // each other and Atwater has nothing to object to. That is the density
    // check's job in validate-foods.js, not this one. Whey at 120 kcal with
    // P24 C2 F1 is internally consistent — and was still the bug that logged
    // whey at a third of its value.
    ck('a whole row scaled to one serving is NOT caught here — by design',
      macroPlausibility({ calories: 120, protein: 24, total_carbs: 2, fat: 1 }, 'Whey Protein').status === 'ok');

    ck('calories with no macros behind them are caught',
      macroPlausibility({ calories: 250, protein: 0, total_carbs: 0, fat: 0 }, 'Mystery Ladoo').status === 'suspect');

    ck('and the reason says so plainly',
      /no macros behind it/.test(
        macroPlausibility({ calories: 250, protein: 0, total_carbs: 0, fat: 0 }, 'Mystery Ladoo').reason || ''));

    ck('an empty food is unknown, not suspect',
      macroPlausibility({}, 'Blank').status === 'unknown');

    ck('a per-unit food is unknown, not suspect',
      macroPlausibility({ calories: 10, protein: 0, total_carbs: 0, fat: 0 },
        'Vitamin D3 (60000 IU)').status === 'unknown');

    // Small foods must not be flagged for a rounding difference.
    ck('the absolute floor protects tiny values',
      macroPlausibility({ calories: 20, protein: 1, total_carbs: 1, fat: 0 }, 'Coriander').status === 'ok');

    ck('the tolerance is configurable and actually applied', (() => {
      const f = { calories: 200, protein: 10, total_carbs: 10, fat: 10 };  // atwater 170, delta 30
      return macroPlausibility(f, 'X', { tolerance: 0.50, floorKcal: 5 }).status === 'ok'
          && macroPlausibility(f, 'X', { tolerance: 0.05, floorKcal: 5 }).status === 'suspect';
    })());

    ck('delta_pct is reported for a suspect food',
      macroPlausibility({ calories: 100, protein: 25, total_carbs: 20, fat: 50 }, 'Peanut Butter').delta_pct > 0);
  }

  // ── 1b. Cooked dishes that forgot the cooking fat ─────────────────────────
  // Real report: a member logged "Masala Dosa" at 112 kcal for 80g — about 140
  // per 100g, with 3g of fat. Two spoons of oil on the tawa is 16-20g of fat
  // that never appeared. Atwater cannot see it: the numbers agree with each
  // other, they just describe a dish nobody cooked.
  console.log('\n[1b] a cooked dish with no cooking fat');
  {
    const dosa = { calories: 140, protein: 3, total_carbs: 23, fat: 3 };
    ck('the Atwater check passes it — which is why this check exists',
      macroPlausibility(dosa, 'Masala Dosa').status === 'ok',
      macroPlausibility(dosa, 'Masala Dosa'));
    ck('but the cooking-fat check catches it',
      cookingFatPlausibility(dosa, 'Masala Dosa').status === 'suspect');
    ck('and says what is missing',
      /no cooking fat/.test(cookingFatPlausibility(dosa, 'Masala Dosa').reason || ''));

    ck('a properly-oiled dish passes',
      cookingFatPlausibility({ calories: 240, fat: 14 }, 'Paneer Butter Masala').status === 'ok');
    ck('a paratha with no ghee is caught',
      cookingFatPlausibility({ calories: 180, fat: 2 }, 'Aloo Paratha').status === 'suspect');

    // The exceptions matter as much as the rule. Flagging every steamed and
    // simmered dish would fill the queue with correct entries, and a queue full
    // of false alarms is one nobody works.
    ck('sambar is not a fried dish',
      cookingFatPlausibility({ calories: 60, fat: 1.5 }, 'Sambar').status === 'unknown');
    ck('idli is steamed, not fried',
      cookingFatPlausibility({ calories: 110, fat: 0.4 }, 'Idli').status === 'unknown');
    ck('dal is named in the exception list even though "masala" dishes are not',
      cookingFatPlausibility({ calories: 120, fat: 2 }, 'Dal Tadka Masala').status === 'unknown');
    ck('a food with no nutrition is unknown, not suspect',
      cookingFatPlausibility({}, 'Masala Dosa').status === 'unknown');
    ck('a per-unit supplement is not judged on fat',
      cookingFatPlausibility({ calories: 5, fat: 0 }, 'Curry Leaf Capsule (60000 IU)').status === 'unknown');
  }

  // ── 2. Ranking and the endpoint ────────────────────────────────────────────
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  await pool.query('DELETE FROM foods');

  const { rows: [coach] } = await pool.query(
    `INSERT INTO users (name,phone,password,role,active)
     VALUES ('Sachin','9001','x','monitor',true) RETURNING id`);
  const { rows: [admin] } = await pool.query(
    `INSERT INTO users (name,phone,password,role,active)
     VALUES ('Admin','9002','x','admin',true) RETURNING id`);
  const members = [];
  for (let i = 0; i < 3; i++) {
    const { rows: [m] } = await pool.query(
      `INSERT INTO users (name,phone,password,role,active)
       VALUES ($1,$2,'x','patient',true) RETURNING id`, [`M${i}`, `910${i}`]);
    members.push(m.id);
  }

  // Popular and consistent; unpopular and consistent; unpopular but WRONG.
  const { rows: [popular] } = await pool.query(
    `INSERT INTO foods (name,category,source,verified,per_100g)
     VALUES ('Ragi Mudde','grain','ai',false,$1::jsonb) RETURNING id`, [per(119, 3, 25, 0.5)]);
  const { rows: [rare] } = await pool.query(
    `INSERT INTO foods (name,category,source,verified,per_100g)
     VALUES ('Brazil Nut','nut','ai',false,$1::jsonb) RETURNING id`, [per(659, 14, 12, 67)]);
  const { rows: [broken] } = await pool.query(
    `INSERT INTO foods (name,category,source,verified,per_100g)
     VALUES ('Mystery Ladoo','other','ai',false,$1::jsonb) RETURNING id`, [per(400, 0, 0, 0)]);
  await pool.query(
    `INSERT INTO foods (name,category,source,verified,per_100g)
     VALUES ('Verified Rice','grain','nin',true,$1::jsonb)`, [per(130, 2.7, 28, 0.3)]);

  // Three members log Ragi Mudde; one logs Brazil Nut; nobody logs the ladoo.
  for (const m of members) {
    await pool.query(
      `INSERT INTO daily_logs (patient_id, log_date, food_items)
       VALUES ($1, CURRENT_DATE, $2::jsonb)`,
      [m, JSON.stringify([{ name: 'Ragi Mudde', grams: 200, meal: 'Lunch' }])]);
  }
  await pool.query(
    `INSERT INTO daily_logs (patient_id, log_date, food_items)
     VALUES ($1, CURRENT_DATE - 1, $2::jsonb)`,
    [members[0], JSON.stringify([{ name: 'Brazil Nut', grams: 20, meal: 'Snack' }])]);

  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const srv = app.listen(0); const port = srv.address().port;
  const call = async (method, path, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };

  console.log('\n[2] the queue');
  {
    const r = await call('GET', '/api/foods/review', tok(coach.id, 'monitor'));
    ck('the coach can open the queue', r.status === 200, r.status);
    ck('verified foods are not in it',
      !r.data.foods.some(f => f.name === 'Verified Rice'), r.data.foods?.map(f => f.name));
    ck('all three unverified foods are', r.data.foods.length === 3, r.data.foods?.map(f => f.name));
    ck('unverified_total counts the table, not the page',
      r.data.unverified_total === 3, r.data.unverified_total);

    ck('the self-contradicting food is FIRST, ahead of the popular one',
      r.data.foods[0].name === 'Mystery Ladoo', r.data.foods.map(f => f.name));
    ck('then the food three members eat',
      r.data.foods[1].name === 'Ragi Mudde', r.data.foods.map(f => f.name));
    ck('then the one logged once',
      r.data.foods[2].name === 'Brazil Nut', r.data.foods.map(f => f.name));

    const mudde = r.data.foods.find(f => f.name === 'Ragi Mudde');
    ck('member count is distinct members, not log rows', mudde.members === 3, mudde.members);
    ck('times_logged counts every logging', mudde.times_logged === 3, mudde.times_logged);
    ck('counts arrive as numbers, not strings (int8 parser)',
      typeof mudde.members === 'number', typeof mudde.members);

    const nobody = r.data.foods.find(f => f.name === 'Mystery Ladoo');
    ck('a food nobody logs reports zero, not null', nobody.members === 0, nobody.members);

    ck('each food carries its macro verdict',
      r.data.foods.every(f => f.macro_check && f.macro_check.status), r.data.foods[0]);
    ck('the ladoo is flagged', nobody.macro_check.status === 'suspect', nobody.macro_check);
    ck('the real foods are not', mudde.macro_check.status === 'ok', mudde.macro_check);
    ck('flagged_in_page reports the page, and says 1', r.data.flagged_in_page === 1, r.data.flagged_in_page);
    ck('page_size is reported alongside it, so the number can be read honestly',
      r.data.page_size === 3, r.data.page_size);
  }

  console.log('\n[2b] lighter than the plain version of itself');
  {
    // The verified plain dosa is the reference. Nothing is hardcoded — the
    // check asks the food table, so it gets better as the queue is worked.
    await pool.query(
      `INSERT INTO foods (name,category,source,verified,per_100g)
       VALUES ('Dosa (Plain)','grain','nin',true,$1::jsonb)`, [per(168, 3.8, 24, 6.5)]);
    const { rows: [md] } = await pool.query(
      `INSERT INTO foods (name,category,source,verified,per_100g)
       VALUES ('Masala Dosa','grain','ai',false,$1::jsonb) RETURNING id`, [per(140, 3, 23, 3)]);

    const r = await call('GET', '/api/foods/review', tok(coach.id, 'monitor'));
    const found = r.data.foods.find(f => f.id === md.id);
    ck('the masala dosa is in the queue', !!found, r.data.foods.map(f => f.name));
    ck('and it is flagged', found?.macro_check?.status === 'suspect', found?.macro_check);
    ck('with the plain dosa named as the reference',
      /plain Dosa/i.test(found?.macro_check?.reason || ''), found?.macro_check?.reason);
    ck('the individual checks are reported separately',
      found?.checks?.lighter_than_base === true, found?.checks);

    // A dish that IS heavier than its base must not be flagged for this.
    const { rows: [ok] } = await pool.query(
      `INSERT INTO foods (name,category,source,verified,per_100g)
       VALUES ('Ghee Dosa','grain','ai',false,$1::jsonb) RETURNING id`, [per(240, 4, 24, 13)]);
    const r2 = await call('GET', '/api/foods/review', tok(coach.id, 'monitor'));
    const good = r2.data.foods.find(f => f.id === ok.id);
    ck('a richer dish that costs more is not flagged',
      good?.checks?.lighter_than_base === false, good?.checks);

    await pool.query(`DELETE FROM foods WHERE name IN ('Dosa (Plain)','Masala Dosa','Ghee Dosa')`);
  }

  console.log('\n[3] /unverified and /review are one handler');
  {
    const a = await call('GET', '/api/foods/review',     tok(coach.id, 'monitor'));
    const b = await call('GET', '/api/foods/unverified', tok(coach.id, 'monitor'));
    ck('/unverified answers', b.status === 200, b.status);
    ck('and returns identical data to /review',
      JSON.stringify(a.data) === JSON.stringify(b.data));
    ck('/unverified is not swallowed by /:id as a food named "unverified"',
      Array.isArray(b.data.foods), b.data);
  }

  console.log('\n[4] the flagged-only filter');
  {
    const r = await call('GET', '/api/foods/unverified?flagged=1', tok(coach.id, 'monitor'));
    ck('returns only the mismatched food', r.data.foods.length === 1, r.data.foods.map(f => f.name));
    ck('and it is the right one', r.data.foods[0].name === 'Mystery Ladoo');
    ck('the total still describes the whole table', r.data.unverified_total === 3, r.data.unverified_total);
  }

  console.log('\n[5] access');
  {
    const m = await call('GET', '/api/foods/review', tok(members[0], 'patient'));
    ck('a member cannot open the queue', m.status === 403, m.status);
    const anon = await call('GET', '/api/foods/review', null);
    ck('nor can an anonymous caller', anon.status === 401, anon.status);
  }

  console.log('\n[6] verifying records who and when');
  {
    let r = await call('PATCH', `/api/foods/${popular.id}/verify`, tok(coach.id, 'monitor'), { verified: true });
    ck('verify succeeds', r.status === 200 && r.data.verified === true, r.data);
    ck('it records the coach', r.data.verified_by === coach.id, r.data);
    ck('and a timestamp', !!r.data.verified_at, r.data);

    const { rows } = await pool.query('SELECT verified, verified_by, verified_at FROM foods WHERE id = $1', [popular.id]);
    ck('persisted to the database', rows[0].verified === true && rows[0].verified_by === coach.id, rows[0]);

    ck('macros are NOT recomputed on verify', await (async () => {
      const { rows: p } = await pool.query('SELECT per_100g FROM foods WHERE id = $1', [popular.id]);
      return Number(p[0].per_100g.calories) === 119;
    })());

    r = await call('GET', '/api/foods/review', tok(coach.id, 'monitor'));
    ck('the verified food leaves the queue',
      !r.data.foods.some(f => f.id === popular.id), r.data.foods.map(f => f.name));
    ck('and the total drops', r.data.unverified_total === 2, r.data.unverified_total);

    r = await call('PATCH', `/api/foods/${popular.id}/verify`, tok(admin.id, 'admin'), { verified: false });
    ck('un-verifying works', r.data.verified === false, r.data);
    ck('and clears the trail rather than leaving a stale name',
      r.data.verified_by === null && r.data.verified_at === null, r.data);

    r = await call('PATCH', '/api/foods/999999/verify', tok(admin.id, 'admin'), { verified: true });
    ck('an unknown food is a 404, not a silent success', r.status === 404, r.status);

    r = await call('PATCH', `/api/foods/${rare.id}/verify`, tok(members[0], 'patient'), { verified: true });
    ck('a member cannot verify a food', r.status === 403, r.status);
  }

  console.log('\n[7] deleting from the queue');
  {
    let r = await call('DELETE', `/api/foods/${broken.id}`, tok(admin.id, 'admin'));
    ck('an admin can delete a bad food', r.status === 200, r.status);
    r = await call('GET', '/api/foods/review', tok(coach.id, 'monitor'));
    ck('it is gone from the queue',
      !r.data.foods.some(f => f.id === broken.id), r.data.foods.map(f => f.name));
    r = await call('DELETE', `/api/foods/${rare.id}`, tok(coach.id, 'monitor'));
    ck('a coach cannot delete — verifying is not deleting', r.status === 403, r.status);
  }

  srv.close();
  console.log(`\n${fail === 0 ? '✅' : '❌'} test-foods-queue: ${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
