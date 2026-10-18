/**
 * scripts/test-food-preparation.js — raw or cooked, stored end to end (Fixes-2h, 18 Oct 2026).
 *
 * What a food's nutrition numbers are for (raw or cooked) used to be guessed
 * from its name only. Now it is stored: on the shared food row (a coach or
 * admin sets it; who and when kept), on a member's own label, and copied onto
 * every logged item, saved meal and plan item when the food is chosen.
 * Existing foods stay "not specified" — nothing is back-filled from names.
 *
 * Real Postgres, real HTTP:
 *   [1]  the columns and the constraint
 *   [2]  a new or existing food is "not specified" until someone says
 *   [3]  a coach sets it from the queue; who and when are kept; members cannot
 *   [4]  search, food by id, the admin list and the review queue all return it
 *   [5]  admin create / edit: set, change, leave alone, clear
 *   [6]  AI logging: the stored value travels; the model's own claim never does;
 *        a cooked-marked row wins a tie "as eaten"
 *   [7]  a member's own label carries their answer, to them only
 *   [8]  saved meals keep it; anything else is dropped
 *   [9]  saving the day and the AI apply keep it; recent foods return it
 *   [10] meal plans: from a matched food only; plate photo rows keep it
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q, _r, n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/foods',        require('../routes/foods'));
app.use('/api/member-foods', require('../routes/memberFoods'));
app.use('/api/logs',         require('../routes/logs'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n))
                            : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e === undefined ? '' : e).slice(0, 300))); };

(async () => {
  const tag = String(Date.now()).slice(-7);
  const mk = async (name, phone, role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, phone, role])).rows[0].id;
  const coach  = await mk('Prep Coach',  `73${tag}1`, 'monitor');
  const admin  = await mk('Prep Admin',  `73${tag}2`, 'admin');
  const member = await mk('Prep Member', `73${tag}3`, 'patient');
  const other  = await mk('Prep Other',  `73${tag}4`, 'patient');
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1), ($2)`, [member, other]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true)`, [coach, member]);

  const per = (kcal) => JSON.stringify({ calories: kcal, protein: 7, total_carbs: 20, net_carbs: 18, fat: 2 });
  const food = async (name, kcal, preparation = null, verified = true) => (await pool.query(
    `INSERT INTO foods (name, category, source, verified, per_100g, preparation) VALUES ($1,'pulse','manual',$4,$2,$3) RETURNING id`,
    [name, per(kcal), preparation, verified])).rows[0].id;
  // Two rows that tie on every rank except "as eaten": nothing in their names says raw or cooked.
  const DAL = `Prepdal${tag}`;
  const dalRaw    = await food(`${DAL} (Split)`, 340, 'raw');
  const dalCooked = await food(`${DAL} (Plain)`, 110, 'cooked');
  const PLAIN = `Prepplain${tag}`;
  const plainId = await food(PLAIN, 120, null, false);
  const ids = [dalRaw, dalCooked, plainId];

  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u, r) => jwt.sign({ id: u, role: r, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const call = async (method, p, t, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method, headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const C = tok(coach, 'monitor'), A = tok(admin, 'admin'), M = tok(member, 'patient'), O = tok(other, 'patient');
  const row = async (id) => (await pool.query(`SELECT preparation, preparation_by, preparation_at FROM foods WHERE id=$1`, [id])).rows[0];
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  try {
    console.log('\n[1] the columns and the constraint');
    {
      const { rows } = await pool.query(`SELECT table_name, column_name FROM information_schema.columns WHERE column_name LIKE 'preparation%'`);
      const has = (t, c) => rows.some(r => r.table_name === t && r.column_name === c);
      ck('foods.preparation, preparation_by, preparation_at and member_foods.preparation exist',
         has('foods', 'preparation') && has('foods', 'preparation_by') && has('foods', 'preparation_at') && has('member_foods', 'preparation'), rows);
      let e1 = null; try { await pool.query(`UPDATE foods SET preparation='fried' WHERE id=$1`, [plainId]); } catch (e) { e1 = e.code; }
      let e2 = null; try { await pool.query(`INSERT INTO member_foods (patient_id,name,name_key,per_100g,preparation) VALUES ($1,'x','x','{}','steamed')`, [member]); } catch (e) { e2 = e.code; }
      ck('the database refuses anything but raw, cooked or empty (foods and member labels)', e1 === '23514' && e2 === '23514', { e1, e2 });
    }

    console.log('\n[2] not specified until someone says');
    {
      ck('a food created without it is not specified (NULL), with no who/when', (await row(plainId)).preparation === null && (await row(plainId)).preparation_by === null);
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM foods WHERE preparation IS NOT NULL AND id <> ALL($1)`, [ids]);
      const schema = require('fs').readFileSync(require('path').join(__dirname, '../db/schema.sql'), 'utf8');
      ck('no existing food was back-filled: no other row carries a value, and the schema sets none',
         rows[0].n === 0 && !/UPDATE\s+foods\s+SET[^;]*preparation/i.test(schema), rows[0]);
    }

    console.log('\n[3] a coach sets it; members cannot');
    {
      const r = await call('PATCH', `/api/foods/${plainId}/preparation`, C, { preparation: 'cooked' });
      const st = await row(plainId);
      ck('a coach marks it cooked: 200, stored with the coach and a time', r.status === 200 && r.data.preparation === 'cooked'
         && st.preparation === 'cooked' && st.preparation_by === coach && !!st.preparation_at, { r, st });
      const m = await call('PATCH', `/api/foods/${plainId}/preparation`, M, { preparation: 'raw' });
      ck('a member cannot change a shared food (403) and nothing moves', m.status === 403 && (await row(plainId)).preparation === 'cooked', m);
      const bad = await call('PATCH', `/api/foods/${plainId}/preparation`, C, { preparation: 'fried' });
      const none = await call('PATCH', `/api/foods/${plainId}/preparation`, C, {});
      ck('"fried" and a missing value are refused in words (400)', bad.status === 400 && /raw, cooked or not specified/.test(bad.data.error) && none.status === 400, { bad, none });
      const missing = await call('PATCH', `/api/foods/999999999/preparation`, C, { preparation: 'raw' });
      ck('an unknown food is 404', missing.status === 404, missing);
      const clr = await call('PATCH', `/api/foods/${plainId}/preparation`, C, { preparation: null });
      const st2 = await row(plainId);
      ck('null clears it back to not specified, and the who/when go with it', clr.status === 200 && st2.preparation === null && st2.preparation_by === null && st2.preparation_at === null, st2);
      await call('PATCH', `/api/foods/${plainId}/preparation`, C, { preparation: 'cooked' });
    }

    console.log('\n[4] every read returns it');
    {
      const s = await call('GET', `/api/foods/search?q=${encodeURIComponent(PLAIN)}`, M);
      ck('food search returns preparation', s.status === 200 && s.data.find(f => f.id === plainId)?.preparation === 'cooked', s.data);
      const one = await call('GET', `/api/foods/${plainId}`, M);
      ck('food by id returns preparation', one.data.preparation === 'cooked', one.data);
      const list = await call('GET', `/api/foods/admin/list?q=${encodeURIComponent(PLAIN.toLowerCase())}`, A);
      ck('the admin list returns preparation', list.data.foods?.find(f => f.id === plainId)?.preparation === 'cooked', list.data);
      const q = await call('GET', `/api/foods/review?limit=200`, C);
      const qf = q.data.foods?.find(f => f.id === plainId);
      ck('the review queue returns preparation and who set it', qf?.preparation === 'cooked' && qf?.preparation_by === coach, qf);
    }

    console.log('\n[5] admin create and edit');
    {
      const NEWF = `Prepnew${tag} Poha`;
      const c = await call('POST', '/api/foods', A, { name: NEWF, category: 'grain', per_100g: { calories: 130 }, preparation: 'cooked' });
      const id = c.data.id; ids.push(id);
      const st = await row(id);
      ck('create with "cooked": stored, with the admin and a time', c.status === 201 && c.data.preparation === 'cooked' && st.preparation_by === admin && !!st.preparation_at, { c, st });
      const bad = await call('POST', '/api/foods', A, { name: `${NEWF} 2`, category: 'grain', per_100g: { calories: 130 }, preparation: 'boiled' });
      ck('create with "boiled" is refused (400) and nothing is made', bad.status === 400
         && !(await pool.query(`SELECT 1 FROM foods WHERE name=$1`, [`${NEWF} 2`])).rows.length, bad);
      const keep = await call('PUT', `/api/foods/${id}`, A, { name: NEWF });
      ck('an edit that does not mention it leaves it as it was', keep.status === 200 && (await row(id)).preparation === 'cooked', keep.data);
      const ch = await call('PUT', `/api/foods/${id}`, A, { preparation: 'raw' });
      ck('an edit can change it', ch.status === 200 && ch.data.preparation === 'raw' && (await row(id)).preparation === 'raw', ch.data);
      const clr = await call('PUT', `/api/foods/${id}`, A, { preparation: '' });
      const st2 = await row(id);
      ck('an edit with "" (the form’s "Not specified") clears it, and the who/when', clr.status === 200 && st2.preparation === null && st2.preparation_by === null, st2);
      const coachPut = await call('PUT', `/api/foods/${id}`, C, { preparation: 'raw' });
      ck('a coach cannot use the admin edit (403); the queue route is theirs', coachPut.status === 403 && (await row(id)).preparation === null, coachPut);
    }

    console.log('\n[6] AI logging');
    {
      const { enrichFromDB } = require('../routes/aiChat');
      const [a, b, c] = await enrichFromDB([
        { name: PLAIN, grams: 150, preparation: 'raw' },          // the model claims raw; the row says cooked
        { name: `Nosuchfood${tag}`, grams: 80, preparation: 'raw', per_100g: { calories: 200 } },   // no row: the claim is not passed on
        { name: DAL, grams: 200 },                                // two rows tie; the cooked-marked one is "as eaten"
      ]);
      ck('a matched food carries the stored value, overriding whatever the model said', a.food_id === plainId && a.preparation === 'cooked', a);
      ck('an unmatched food is not specified: the model’s raw/cooked is never passed on as checked', b.source === 'ai' && b.preparation === null, b);
      ck('"' + DAL + '" with nothing in either name: the row marked cooked wins as eaten (110 kcal, not 340)',
         c.food_id === dalCooked && c.preparation === 'cooked' && Number(c.per_100g.calories) === 110, c);
      await pool.query(`UPDATE foods SET preparation=NULL WHERE id = ANY($1)`, [[dalRaw, dalCooked]]);
      const [c2] = await enrichFromDB([{ name: DAL, grams: 200 }]);
      ck('…and with both marks cleared, the tie falls to the older row (340 kcal): the marks did the work', c2.food_id === dalRaw && c2.preparation === null, c2);
      await pool.query(`UPDATE foods SET preparation = CASE WHEN id=$1 THEN 'raw' ELSE 'cooked' END WHERE id = ANY($2)`, [dalRaw, [dalRaw, dalCooked]]);
    }

    console.log('\n[7] a member’s own label');
    {
      const put = await call('PUT', '/api/member-foods', M, { name: `Mylabel${tag} Chikki`, per_100g: { protein: 12, carbs: 50, fat: 25 }, preparation: 'raw' });
      ck('a member saves a label with "raw"', put.status === 200 && put.data.preparation === 'raw', put);
      const bad = await call('PUT', '/api/member-foods', M, { name: `Mylabel${tag} Chikki`, per_100g: { protein: 12, carbs: 50, fat: 25 }, preparation: 'grilled' });
      ck('"grilled" is refused in words (400) and the label keeps "raw"', bad.status === 400
         && (await pool.query(`SELECT preparation FROM member_foods WHERE patient_id=$1`, [member])).rows[0].preparation === 'raw', bad);
      const again = await call('PUT', '/api/member-foods', M, { name: `Mylabel${tag} Chikki`, per_100g: { protein: 12, carbs: 50, fat: 25 } });
      ck('saving again without an answer makes it not specified (the editor always sends its choice)', again.data.preparation === null, again.data);
      await call('PUT', '/api/member-foods', M, { name: `Mylabel${tag} Chikki`, per_100g: { protein: 12, carbs: 50, fat: 25 }, preparation: 'cooked' });
      const mine = await call('GET', '/api/member-foods', M);
      ck('the member’s labels list returns it', mine.data.find(l => /Chikki/.test(l.name))?.preparation === 'cooked', mine.data);
      const coachView = await call('GET', `/api/member-foods/member/${member}`, C);
      ck('the assigned coach sees it on the member’s labels', coachView.data.find(l => /Chikki/.test(l.name))?.preparation === 'cooked', coachView.data);
      const { enrichFromDB } = require('../routes/aiChat');
      const [forMe] = await enrichFromDB([{ name: `Mylabel${tag} Chikki`, grams: 30 }], member);
      const [forOther] = await enrichFromDB([{ name: `Mylabel${tag} Chikki`, grams: 30 }], other);
      ck('AI logging uses the label’s answer for that member only', forMe.label === true && forMe.preparation === 'cooked' && !forOther.label && forOther.preparation === null, { forMe, forOther });
    }

    console.log('\n[8] saved meals');
    {
      const p = await call('POST', '/api/foods/presets', M, { name: `Prep breakfast ${tag}`, meal: 'Breakfast', items: [
        { name: 'Poha', grams: 150, per_100g: { calories: 130 }, preparation: 'cooked' },
        { name: 'Peanuts', grams: 20, per_100g: { calories: 567 }, preparation: 'fried' },
        { name: 'Tea', grams: 150, per_100g: { calories: 40 } },
      ] });
      const it = p.data.items || [];
      ck('a saved meal keeps "cooked", drops "fried" to not specified, and leaves the rest not specified',
         p.status === 201 || p.status === 200 ? it[0]?.preparation === 'cooked' && it[1]?.preparation === null && it[2]?.preparation === null : false, p);
    }

    console.log('\n[9] the day, the AI apply and recent foods');
    {
      const save = await call('POST', `/api/logs/${today}`, M, { food_items: [
        { id: 1, name: PLAIN, grams: 150, meal: 'Breakfast', food_id: plainId, per_100g: JSON.parse(per(120)), preparation: 'cooked' },
      ] });
      const stored = (await pool.query(`SELECT food_items FROM daily_logs WHERE patient_id=$1 AND log_date=$2`, [member, today])).rows[0]?.food_items || [];
      ck('saving the day keeps the item’s preparation', [200, 201].includes(save.status) && stored[0]?.preparation === 'cooked', { save: save.status, stored });
      const { applyParsed } = require('../services/memberLogApply');
      await applyParsed(member, { weightOn: false, weight_kg: null, activities: [], acv: [], supplements: [], waterOn: false, water_ml_add: 0,
        sleepOn: false, sleep: null, corrections: [], bodyMetricsOn: false, bodyMetrics: [],
        foods: [{ name: DAL, grams: 200, meal: 'Lunch', on: true, food_id: dalCooked, per_100g: JSON.parse(per(110)), preparation: 'cooked' },
                { name: 'Mystery', grams: 50, meal: 'Lunch', on: true, per_100g: JSON.parse(per(90)), preparation: 'sizzled' }] }, { istDate: today });
      const after = (await pool.query(`SELECT food_items FROM daily_logs WHERE patient_id=$1 AND log_date=$2`, [member, today])).rows[0]?.food_items || [];
      const dal = after.find(i => i.name === DAL), mys = after.find(i => i.name === 'Mystery');
      ck('the AI apply writes "cooked" for the dal and drops "sizzled" to not specified', dal?.preparation === 'cooked' && mys && mys.preparation === null, after);
      const rec = await call('GET', '/api/logs/recent-foods', M);
      ck('recent foods return each food’s preparation', rec.data.find(f => f.name === PLAIN)?.preparation === 'cooked'
         && rec.data.find(f => f.name === 'Mystery')?.preparation === null, rec.data);
    }

    console.log('\n[10] meal plans and plate photos');
    {
      const DP = require('../services/dietPlan');
      const n1 = DP.normaliseItem({ name: 'Rice', grams: 150, per_100g: { calories: 130 }, preparation: 'cooked' });
      const n2 = DP.normaliseItem({ name: 'Rice', grams: 150, per_100g: { calories: 130 }, preparation: 'parboiled' });
      ck('a plan item keeps raw/cooked and drops anything else', n1.preparation === 'cooked' && n2.preparation === null, { n1, n2 });
      const { enrichDays } = require('../routes/dietPlans');
      const days = [[{ meal: 'Lunch', items: [
        { name: PLAIN, grams: 150, per_100g: { calories: 120 }, preparation: 'raw' },
        { name: `Nosuchfood${tag}`, grams: 80, per_100g: { calories: 200 }, preparation: 'raw' },
      ] }]];
      await enrichDays(days);
      const [p1, p2] = days[0][0].items;
      ck('a drafted plan takes raw/cooked from the matched food, and clears the model’s claim on an unmatched one', p1.preparation === 'cooked' && p2.preparation === null, { p1, p2 });
      const PP = require('../services/platePhoto');
      const a = PP.analyse({ meal: 'Lunch', items: [{ name: 'Rice', grams: 150, per_100g: { calories: 130 }, preparation: 'cooked' }, { name: 'Dal', grams: 100, per_100g: { calories: 110 } }] },
        { planned: [{ i: 0, seen: true, grams: 150 }, { i: 1, seen: true, grams: 100 }], extras: [{ name: 'Papad', grams: 10, kcal_100g: 370, preparation: 'raw' }] });
      ck('plate photo: planned rows keep the plan’s value; an extra never takes the model’s', a.planned[0].preparation === 'cooked' && a.planned[1].preparation === null
         && a.extras.every(e => e.preparation === undefined || e.preparation === null), a);
    }
  } catch (e) {
    fail++; console.log('  ✗ suite crashed: ' + e.stack);
  } finally {
    await pool.query(`DELETE FROM daily_logs WHERE patient_id = ANY($1)`, [[member, other]]).catch(() => {});
    await pool.query(`DELETE FROM meal_presets WHERE patient_id = ANY($1)`, [[member, other]]).catch(() => {});
    await pool.query(`DELETE FROM member_foods WHERE patient_id = ANY($1)`, [[member, other]]).catch(() => {});
    await pool.query(`DELETE FROM foods WHERE id = ANY($1)`, [ids]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[coach, admin, member, other]]).catch(() => {});
    srv.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    await pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
