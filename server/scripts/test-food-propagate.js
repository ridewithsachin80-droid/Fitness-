/**
 * scripts/test-food-propagate.js — correcting a food corrects it for everyone.
 *
 * A logged food carries a SNAPSHOT of its nutrition, copied when it was logged.
 * That is correct: a member's history must not silently rewrite itself every
 * time the food table is edited, and a log has to survive its food being
 * deleted.
 *
 * The cost is that fixing a wrong food only fixes it going forward. Masala
 * Dosa was stored at 140 kcal/100g with 3g fat — a dosa nobody put on a tawa.
 * Correct it and every future log is right, while every dosa fourteen members
 * already logged stays a third too light, and their weekly reports and adaptive
 * calorie estimates keep being built on it.
 *
 * So the correction can be pushed back through history, on request. The rules
 * that make that safe are what this suite protects.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use('/api/foods', require('../routes/foods'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 200))); };

const WRONG = { calories: 140, protein: 3, total_carbs: 25, fat: 3 };
const RIGHT = { calories: 210, protein: 4, total_carbs: 26, fat: 10 };

(async () => {
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  await pool.query('DELETE FROM foods');
  const mk = async (n, p, r) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`,
    [n, p, r])).rows[0].id;
  const admin = await mk('Sachin', '6601', 'admin');
  const coach = await mk('Veeru', '6602', 'monitor');
  const asha  = await mk('Asha', '6603', 'patient');
  const bujju = await mk('Bujju', '6604', 'patient');

  const { rows: [dosa] } = await pool.query(
    `INSERT INTO foods (name,category,source,verified,per_100g)
     VALUES ('Masala Dosa','grain','ai',false,$1::jsonb) RETURNING id`, [JSON.stringify(WRONG)]);
  const { rows: [idli] } = await pool.query(
    `INSERT INTO foods (name,category,source,verified,per_100g)
     VALUES ('Idli','grain','nin',true,$1::jsonb) RETURNING id`,
    [JSON.stringify({ calories: 110, protein: 2.5, total_carbs: 23, fat: 0.4 })]);

  const logFor = async (pid, offset, items) => pool.query(
    `INSERT INTO daily_logs (patient_id, log_date, food_items)
     VALUES ($1, CURRENT_DATE - $2::int, $3::jsonb)`, [pid, offset, JSON.stringify(items)]);

  // Asha logged it twice, Bujju once. Bujju also logged idli, and a
  // hand-typed dosa with NO food_id — a different dish from a restaurant.
  await logFor(asha, 0, [{ name: 'Masala Dosa', grams: 200, meal: 'Breakfast', food_id: dosa.id, per_100g: WRONG }]);
  await logFor(asha, 3, [{ name: 'Masala Dosa', grams: 150, meal: 'Breakfast', food_id: dosa.id, per_100g: WRONG }]);
  await logFor(bujju, 1, [
    { name: 'Masala Dosa', grams: 180, meal: 'Breakfast', food_id: dosa.id, per_100g: WRONG },
    { name: 'Idli',        grams: 100, meal: 'Breakfast', food_id: idli.id, per_100g: { calories: 110, protein: 2.5, total_carbs: 23, fat: 0.4 } },
    { name: 'masala dosa', grams: 250, meal: 'Dinner',    food_id: null,    per_100g: WRONG },
  ]);

  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const srv = app.listen(0); const port = srv.address().port;
  const call = async (method, path, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const itemsFor = async (pid) => (await pool.query(
    `SELECT log_date::text d, food_items FROM daily_logs WHERE patient_id=$1 ORDER BY log_date`, [pid])).rows;

  console.log('\n[1] the coach is told what a correction would touch');
  {
    const r = await call('GET', `/api/foods/${dosa.id}/impact`, tok(coach, 'monitor'));
    ck('impact is readable before deciding', r.status === 200, r.data);
    ck('three logged entries reference this food', r.data.entries === 3, r.data);
    ck('across two members', r.data.members === 2, r.data);
    ck('and it reports how far back it goes', !!r.data.earliest, r.data);
    ck('the hand-typed one is not counted — it has no food_id',
      r.data.entries === 3, 'a fourth entry exists but was never linked to this food');

    const m = await call('GET', `/api/foods/${dosa.id}/impact`, tok(asha, 'patient'));
    ck('a member cannot query it', m.status === 403, m.status);
  }

  console.log('\n[2] correcting WITHOUT propagation leaves history alone');
  {
    const r = await call('PUT', `/api/foods/${dosa.id}`, tok(admin, 'admin'), { per_100g: RIGHT });
    ck('the food itself is corrected', r.status === 200 && r.data.per_100g.fat === 10, r.data.per_100g?.fat);
    ck('nothing was propagated', r.data.propagated === null, r.data.propagated);
    const a = await itemsFor(asha);
    ck('existing logs still carry the old snapshot — that is the default',
      a[0].food_items[0].per_100g.calories === 140, a[0].food_items[0].per_100g.calories);
  }

  console.log('\n[3] correcting WITH propagation fixes everyone');
  {
    const r = await call('PUT', `/api/foods/${dosa.id}`, tok(admin, 'admin'),
      { per_100g: RIGHT, propagate: true });
    ck('the response reports what moved',
      r.data.propagated?.entries === 3 && r.data.propagated?.members === 2, r.data.propagated);

    const a = await itemsFor(asha);
    // Ordered by log_date ascending: the older 150g entry first, today's 200g
    // second.
    ck('Asha\'s older dosa is corrected', a[0].food_items[0].per_100g.calories === 210, a[0].food_items[0].per_100g);
    ck('and today\'s too', a[1].food_items[0].per_100g.calories === 210);
    ck('grams are untouched — how much she ate is her observation',
      a[0].food_items[0].grams === 150 && a[1].food_items[0].grams === 200,
      [a[0].food_items[0].grams, a[1].food_items[0].grams]);
    ck('the full nutrient profile lands, not just the four macros',
      Object.keys(a[0].food_items[0].per_100g).length >= 45,
      Object.keys(a[0].food_items[0].per_100g).length);

    const b = (await itemsFor(bujju))[0].food_items;
    ck('Bujju\'s dosa is corrected too', b[0].per_100g.calories === 210, b[0].per_100g.calories);
    ck('his idli is untouched — a different food entirely',
      b[1].per_100g.calories === 110, b[1].per_100g.calories);
    // The rule that stops this being destructive: a restaurant dosa someone
    // typed by hand is a DIFFERENT dish, and nothing recorded that it was this
    // one. Matching on the name would silently rewrite it with no way back.
    ck('his hand-typed dosa is NOT rewritten — it was never linked to this food',
      b[2].per_100g.calories === 140 && b[2].food_id === null, b[2].per_100g.calories);
    ck('item order within the day is preserved',
      b.map(x => x.name).join('|') === 'Masala Dosa|Idli|masala dosa', b.map(x => x.name));
  }

  console.log('\n[4] access');
  {
    const r = await call('PUT', `/api/foods/${dosa.id}`, tok(asha, 'patient'),
      { per_100g: WRONG, propagate: true });
    ck('a member cannot edit a shared food', r.status === 403, r.status);
    const still = (await itemsFor(asha))[0].food_items[0].per_100g.calories;
    ck('and nothing moved', still === 210, still);
  }

  srv.close();
  console.log(`\n${fail === 0 ? '✅' : '❌'} test-food-propagate: ${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
