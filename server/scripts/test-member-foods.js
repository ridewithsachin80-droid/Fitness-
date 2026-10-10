/**
 * scripts/test-member-foods.js — a member's own label for a food.
 *
 * 10 Oct 2026. A member logging protein oats (24 g protein per 100 g on the
 * pack) was given plain oats (13.2 g) and could not change it. Now they type
 * protein, carbs and fat; calories follow (4 × P + 4 × C + 9 × F); the label
 * is theirs alone and is used the next time they log that food.
 *
 * This suite is the server half, on a real Postgres over real HTTP:
 *   [1] the table
 *   [2] the member saves a label — and the server works out the calories
 *   [3] what is refused, in words a member can act on
 *   [4] who can see what
 *   [5] the AI chat and photo use the label — for that member only
 *   [6] the shared food table is never written
 *   [7] the day save keeps a macro edit, including when it has to merge
 *   [8] forgetting a label
 * The client half (the editor, the maths, the screens) is in test-day-lib.js
 * and ui-tests.mjs.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const fs = require('fs'), path = require('path');
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const MF = require('../services/memberFoods');
const { mergeLiveDay, macroSig } = require('../services/dayMerge');

const app = express(); app.use(express.json()); app.use(cookieParser());
app.use((q, _r, n) => { q.io = { to: () => ({ emit: () => {} }) }; n(); });
app.use('/api/member-foods', require('../routes/memberFoods'));
app.use('/api/logs',         require('../routes/logs'));

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n))
                            : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e === undefined ? '' : e).slice(0, 260))); };

(async () => {
  const mk = async (name, phone, role) => (await pool.query(
    `INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, phone, role])).rows[0].id;
  const tag = String(Date.now()).slice(-7);
  const coach  = await mk('Coach One', `72${tag}1`, 'monitor');
  const coach2 = await mk('Coach Two', `72${tag}2`, 'monitor');
  const admin  = await mk('Admin',     `72${tag}3`, 'admin');
  const member = await mk('Asha Rao',  `72${tag}4`, 'patient');
  const other  = await mk('Other',     `72${tag}5`, 'patient');
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1), ($2)`, [member, other]);
  await pool.query(`INSERT INTO monitor_patients (monitor_id,patient_id,active) VALUES ($1,$2,true)`, [coach, member]);

  // A shared food row, as the seed would have it: plain oats.
  const OATS = `Testoats ${tag}`;
  const CHIKKI = `Testchikki ${tag}`;   // a member-only food with no shared row
  const sharedPer = { calories: 374, protein: 13.2, total_carbs: 67.7, net_carbs: 57.6, fat: 7.6, fiber: 10.1, iron: 3.8, calcium: 54 };
  const oatsId = (await pool.query(
    `INSERT INTO foods (name, category, source, verified, per_100g) VALUES ($1,'grain','nin',true,$2) RETURNING id`,
    [OATS, JSON.stringify(sharedPer)])).rows[0].id;

  const srv = app.listen(0); const port = srv.address().port;
  const tok = (u, r) => jwt.sign({ id: u, role: r, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const call = async (method, p, t, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method, headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const M = tok(member, 'patient'), O = tok(other, 'patient'), C = tok(coach, 'monitor'), C2 = tok(coach2, 'monitor'), A = tok(admin, 'admin');
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  // What the client's MacroEditor sends: the food's per-100 g with the pack's macros on it.
  const packOats = { ...sharedPer, protein: 24, total_carbs: 55, net_carbs: 55, fat: 7.8, calories: 999 };

  try {
    console.log('\n[1] the table');
    {
      const { rows } = await pool.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='member_foods' ORDER BY ordinal_position`);
      const cols = Object.fromEntries(rows.map(r => [r.column_name, r]));
      ck('member_foods exists with patient_id, name, name_key, per_100g (jsonb), base_food_id, created_at, updated_at',
         ['id', 'patient_id', 'name', 'name_key', 'per_100g', 'base_food_id', 'created_at', 'updated_at'].every(c => cols[c]) && cols.per_100g.data_type === 'jsonb'
         && cols.patient_id.is_nullable === 'NO' && cols.base_food_id.is_nullable === 'YES', Object.keys(cols));
      const { rows: u } = await pool.query(
        `SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'member_foods' AND c.contype IN ('u','f')`);
      const defs = u.map(r => r.d).join(' | ');
      ck('one label per member per food name, and it goes when the member goes',
         /UNIQUE \(patient_id, name_key\)/.test(defs) && /REFERENCES users\(id\) ON DELETE CASCADE/.test(defs) && /REFERENCES foods\(id\) ON DELETE SET NULL/.test(defs), defs);
      const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
      ck('created with IF NOT EXISTS (safe on every boot); no existing table is altered for it',
         /CREATE TABLE IF NOT EXISTS member_foods/.test(schema) && !/ALTER TABLE foods/.test(schema.slice(schema.indexOf('member_foods'))));
    }

    console.log('\n[2] the member saves a label; the server works out the calories');
    {
      const r = await call('PUT', '/api/member-foods', M, { name: `  ${OATS} `, per_100g: packOats, food_id: oatsId });
      ck('saved', r.status === 200 && r.data.id > 0, [r.status, r.data]);
      const p = r.data.per_100g || {};
      ck('protein 24, carbs 55, fat 7.8 as typed', p.protein === 24 && p.total_carbs === 55 && p.net_carbs === 55 && p.fat === 7.8, p);
      ck('calories 4×24 + 4×55 + 9×7.8 = 386 — the 999 the request carried is ignored', p.calories === 386, p.calories);
      ck('fibre, iron and calcium kept from the food it replaces', p.fiber === 10.1 && p.iron === 3.8 && p.calcium === 54, p);
      ck('every nutrient field present (normalised like every other food)', Object.keys(p).length >= 39 && p.vit_b12 === 0, Object.keys(p).length);
      ck('name trimmed; linked to the shared food it came from', r.data.name === OATS && r.data.base_food_id === oatsId, [r.data.name, r.data.base_food_id]);

      const again = await call('PUT', '/api/member-foods', M, { name: OATS.toUpperCase(), per_100g: { protein: 25, carbs: 54, fat: 8 } });
      const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM member_foods WHERE patient_id=$1`, [member])).rows[0].n;
      ck('saving the same food again (any case) replaces the label, not a second one', again.status === 200 && n === 1 && again.data.per_100g.protein === 25, [again.status, n]);
      ck('a plain "carbs" field is read too; calories recomputed: 4×25 + 4×54 + 9×8 = 388', again.data.per_100g.calories === 388 && again.data.per_100g.total_carbs === 54, again.data.per_100g);
      ck('the earlier link to the shared food is kept when the new save has none', again.data.base_food_id === oatsId, again.data.base_food_id);
      await call('PUT', '/api/member-foods', M, { name: OATS, per_100g: packOats, food_id: oatsId });

      const bogus = await call('PUT', '/api/member-foods', M, { name: CHIKKI, per_100g: { protein: 12, carbs: 50, fat: 25 }, food_id: 99999999 });
      ck('a food id that does not exist does not fail the save — it is just not linked', bogus.status === 200 && bogus.data.base_food_id === null, [bogus.status, bogus.data]);
    }

    console.log('\n[3] what is refused, in words a member can act on');
    {
      const bad = async (body) => call('PUT', '/api/member-foods', M, body);
      const r1 = await bad({ name: 'X', per_100g: { protein: 10 } });
      ck('no food name → "Which food is this label for?"', r1.status === 400 && /Which food/.test(r1.data.error), r1);
      const r2 = await bad({ name: 'Paneer' });
      ck('no numbers → asks for protein, carbs and fat per 100 g', r2.status === 400 && /per 100 g/.test(r2.data.error), r2);
      const r3 = await bad({ name: 'Paneer', per_100g: { protein: -2, carbs: 3, fat: 20 } });
      ck('a negative number is refused', r3.status === 400 && /0 or more/.test(r3.data.error), r3);
      const r4 = await bad({ name: 'Paneer', per_100g: { protein: 'abc', carbs: 3, fat: 20 } });
      ck('text where a number goes is refused', r4.status === 400 && /numbers/.test(r4.data.error), r4);
      const r5 = await bad({ name: 'Paneer', per_100g: { protein: 0, carbs: 0, fat: 0 } });
      ck('all three zero is refused (a label of nothing)', r5.status === 400 && /at least one/.test(r5.data.error), r5);
      const r6 = await bad({ name: 'Paneer', per_100g: { protein: 60, carbs: 30, fat: 20 } });
      ck('more than 100 g of macros in 100 g of food is refused', r6.status === 400 && /100 g in 100 g/.test(r6.data.error), r6);
      const r7 = await bad({ name: 'Ghee', per_100g: { protein: 0, carbs: 0, fat: 100 } });
      ck('exactly 100 g (pure fat) is allowed: 900 kcal', r7.status === 200 && r7.data.per_100g.calories === 900, r7);
      await call('DELETE', '/api/member-foods?name=Ghee', M);
      const r8 = await call('PUT', '/api/member-foods', C, { name: 'Oats', per_100g: { protein: 24 } });
      ck('a coach cannot save labels (they are the member\'s reading of their own pack)', r8.status === 403, r8.status);
      const r9 = await call('PUT', '/api/member-foods', null, { name: 'Oats', per_100g: { protein: 24 } });
      ck('not signed in → 401', r9.status === 401, r9.status);
    }

    console.log('\n[4] who can see what');
    {
      const mine = await call('GET', '/api/member-foods', M);
      ck('the member sees their labels', mine.status === 200 && mine.data.some(l => l.name === OATS) && mine.data.length === 2, mine.data.map?.(l => l.name));
      const theirs = await call('GET', '/api/member-foods', O);
      ck('another member sees none of them', theirs.status === 200 && theirs.data.length === 0, theirs.data);
      const byCoach = await call('GET', `/api/member-foods/member/${member}`, C);
      ck('the member\'s coach sees them, with the numbers and the date', byCoach.status === 200 && byCoach.data.length === 2
         && byCoach.data.find(l => l.name === OATS)?.per_100g?.protein === 24 && !!byCoach.data[0].updated_at, byCoach);
      const byOther = await call('GET', `/api/member-foods/member/${member}`, C2);
      ck('a coach the member is not assigned to is refused', byOther.status === 403, byOther.status);
      const byAdmin = await call('GET', `/api/member-foods/member/${member}`, A);
      ck('an admin can look', byAdmin.status === 200 && byAdmin.data.length === 2, byAdmin.status);
      const asMember = await call('GET', `/api/member-foods/member/${other}`, M);
      ck('a member cannot use the coach route to read someone else\'s', asMember.status === 403, asMember.status);
    }

    console.log('\n[5] the AI chat and plate photo use the label — for that member only');
    {
      const ai = require('../routes/aiChat');
      const [mineE] = await ai.enrichFromDB([{ name: OATS, grams: 50, per_100g: { calories: 380, protein: 12 } }], member);
      ck('this member: 24 g protein, 386 kcal, marked as their label', mineE.per_100g.protein === 24 && mineE.per_100g.calories === 386 && mineE.label === true && mineE.source === 'member', [mineE.per_100g.protein, mineE.source]);
      ck('still linked to the shared food (so its typical serving still applies)', mineE.food_id === oatsId, mineE.food_id);
      ck('no "looks like a per-serving label" warning on a member\'s own numbers', !mineE.warning, mineE.warning);
      const [lower] = await ai.enrichFromDB([{ name: OATS.toLowerCase(), grams: 50, per_100g: {} }], member);
      ck('any case finds it', lower.label === true && lower.per_100g.protein === 24, lower.per_100g.protein);
      const [bracket] = await ai.enrichFromDB([{ name: `${OATS} (rolled)`, grams: 50, per_100g: {} }], member);
      ck('"<name> (rolled)" — the AI\'s longer name — finds it by the part before the bracket', bracket.label === true && bracket.per_100g.protein === 24, [bracket.source, bracket.per_100g.protein]);
      const [otherE] = await ai.enrichFromDB([{ name: OATS, grams: 50, per_100g: {} }], other);
      ck('another member gets the shared oats (13.2 g), not this member\'s label', otherE.per_100g.protein === 13.2 && !otherE.label && otherE.source === 'db-verified', [otherE.per_100g.protein, otherE.source]);
      const [noone] = await ai.enrichFromDB([{ name: OATS, grams: 50, per_100g: {} }]);
      ck('no member given (coach tools, older callers) → the shared row, as before', noone.per_100g.protein === 13.2 && !noone.label, noone.per_100g.protein);
      const [unlinked] = await ai.enrichFromDB([{ name: CHIKKI, grams: 30, per_100g: {} }], member);
      ck('a label with no shared food behind it still applies: 4×12 + 4×50 + 9×25 = 473', unlinked.label === true && unlinked.per_100g.calories === 473 && unlinked.food_id === null, [unlinked.per_100g.calories, unlinked.food_id]);

      const src = fs.readFileSync(path.join(__dirname, '../routes/aiChat.js'), 'utf8');
      ck('the chat parse passes the member to the lookup', /let foods = await enrichFromDB\(validFoods, userId\)/.test(src));
      ck('the plate photo passes the member too (only when a member is signed in)', /enrichFromDB\(validFoods, req\.user\?\.role === 'patient' \? req\.user\.id : null\)/.test(src));
    }

    console.log('\n[6] the shared food table is never written');
    {
      const row = (await pool.query(`SELECT per_100g FROM foods WHERE id=$1`, [oatsId])).rows[0].per_100g;
      ck('the shared oats are still 13.2 g protein and 374 kcal after all of the above', row.protein === 13.2 && row.calories === 374, row);
      const ai = require('../routes/aiChat');
      const before = (await pool.query(`SELECT COUNT(*)::int AS n FROM foods`)).rows[0].n;
      await ai.learnFoods([{ name: CHIKKI, grams: 30, per_100g: { calories: 473, protein: 12 }, food_id: null, label: true, source: 'member' }]);
      const after = (await pool.query(`SELECT COUNT(*)::int AS n FROM foods`)).rows[0].n;
      ck('the food-learning step skips a member\'s label (it would otherwise teach everyone their numbers)', after === before, [before, after]);
      await ai.learnFoods([{ name: `Learnable ${tag}`, grams: 30, per_100g: { calories: 200, protein: 5 }, food_id: null, source: 'ai' }]);
      const learnt = (await pool.query(`SELECT COUNT(*)::int AS n FROM foods`)).rows[0].n;
      ck('…while an ordinary AI food is still learnt (the skip is not too wide)', learnt === before + 1, [before, learnt]);
    }

    console.log('\n[7] the day save keeps a macro edit');
    {
      const item = { id: 501, name: OATS, grams: 50, meal: 'Breakfast', food_id: oatsId, per_100g: sharedPer };
      const s1 = await call('POST', `/api/logs/${today}`, M, { food_items: [item] });
      ck('a day with plain oats saved', s1.status === 200, s1);
      const loaded = await call('GET', `/api/logs/${today}`, M);
      const savedAt = loaded.data.log?.saved_at || loaded.data.saved_at;
      const edited = { ...item, per_100g: { ...sharedPer, protein: 24, total_carbs: 55, net_carbs: 55, fat: 7.8, calories: 386 }, label: true };
      const s2 = await call('POST', `/api/logs/${today}`, M, { food_items: [edited], base_saved_at: savedAt });
      const row = async () => (await pool.query(`SELECT food_items, saved_at FROM daily_logs WHERE patient_id=$1 AND log_date=$2`, [member, today])).rows[0];
      const r = await row();
      ck('an ordinary save stores the member\'s numbers and the label mark', s2.status === 200 && r.food_items[0].per_100g.protein === 24 && r.food_items[0].label === true, r.food_items[0]);

      // The merge: the app loaded the day, the chat then added lunch, then the
      // member edits breakfast's macros in the still-open app.
      const base = { food: { 501: '50|Breakfast' }, food_macros: { 501: macroSig({ per_100g: sharedPer }) } };
      const stored = { food_items: [{ ...item }, { id: 502, name: 'Dal', grams: 150, meal: 'Lunch', per_100g: { calories: 116 } }] };
      const m = mergeLiveDay(stored, { food_items: [edited] }, [501], base);
      const b = m.doc.food_items.find(i => i.id === 501);
      ck('merge: the macro edit made here wins over the server\'s older numbers', b.per_100g.protein === 24 && b.per_100g.calories === 386 && b.label === true, b);
      ck('merge: the lunch added elsewhere is kept', m.doc.food_items.some(i => i.id === 502), m.doc.food_items.map(i => i.id));
      const untouched = mergeLiveDay({ food_items: [{ ...item, per_100g: { ...sharedPer, protein: 30 } }] }, { food_items: [item] }, [501], base);
      ck('merge: an item whose macros were NOT edited here keeps the server\'s newer numbers', untouched.doc.food_items[0].per_100g.protein === 30, untouched.doc.food_items[0].per_100g.protein);
      const oldApp = mergeLiveDay(stored, { food_items: [edited] }, [501], { food: { 501: '50|Breakfast' } });
      ck('merge: an older app that sends no food_macros changes nothing about macros (as before)', oldApp.doc.food_items.find(i => i.id === 501).per_100g.protein === 13.2, oldApp.doc.food_items[0].per_100g.protein);
      const both = mergeLiveDay(stored, { food_items: [{ ...edited, grams: 80 }] }, [501], base);
      ck('merge: grams and macros edited together — both kept', both.doc.food_items[0].grams === 80 && both.doc.food_items[0].per_100g.protein === 24, both.doc.food_items[0]);

      // Over HTTP, with a stale base: the route does the merge.
      await pool.query(`UPDATE daily_logs SET food_items=$3, saved_at = NOW() + interval '1 second' WHERE patient_id=$1 AND log_date=$2`,
        [member, today, JSON.stringify(stored.food_items)]);
      const s3 = await call('POST', `/api/logs/${today}`, M, { food_items: [edited], base_saved_at: savedAt, base_food_ids: [501], base_fields: { ...base, weight_kg: null, water_ml: 0, activities: {}, acv: {}, supplements: {}, sleep: {}, notes: '' } });
      const r3 = await row();
      ck('over HTTP: a stale save merges, keeping the edit and the lunch', s3.status === 200 && s3.data.merged_live === true
         && r3.food_items.find(i => i.id === 501)?.per_100g?.protein === 24 && r3.food_items.some(i => i.id === 502), [s3.status, s3.data.merged_live, r3.food_items.map(i => [i.id, i.per_100g?.protein])]);

      const client = fs.readFileSync(path.join(__dirname, '../../client/src/utils/logSync.js'), 'utf8');
      const sigC = client.match(/export const macroSig = \(i\) => \{ const p = i\?\.per_100g \|\| \{\};\s*return (.+?); \};/s)?.[1];
      const sigS = fs.readFileSync(path.join(__dirname, '../services/dayMerge.js'), 'utf8').match(/const macroSig = \(it\) => \{ const p = it\?\.per_100g \|\| \{\};\s*return (.+?); \};/s)?.[1];
      ck('the app and the server build the macro signature the same way', !!sigC && sigC === sigS, [sigC, sigS]);
    }

    console.log('\n[8] forgetting a label');
    {
      const r = await call('DELETE', `/api/member-foods?name=${encodeURIComponent(OATS.toLowerCase())}`, M);
      ck('removed (by name, any case)', r.status === 200 && r.data.removed === true, r);
      const [e] = await require('../routes/aiChat').enrichFromDB([{ name: OATS, grams: 50, per_100g: {} }], member);
      ck('the next log of that food gets the shared numbers again', e.per_100g.protein === 13.2 && !e.label, e.per_100g.protein);
      const again = await call('DELETE', `/api/member-foods?name=${encodeURIComponent(OATS)}`, M);
      ck('removing one that is not there says so, without an error', again.status === 200 && again.data.removed === false, again);
      const none = await call('DELETE', '/api/member-foods', M);
      ck('no name → 400', none.status === 400, none.status);
      const o = await call('DELETE', `/api/member-foods?name=${encodeURIComponent(CHIKKI)}`, O);
      const still = (await pool.query(`SELECT COUNT(*)::int AS n FROM member_foods WHERE patient_id=$1`, [member])).rows[0].n;
      ck('another member cannot remove this member\'s label', o.data.removed === false && still === 1, [o.data, still]);
      const days = await call('GET', `/api/logs/${today}`, M);
      const items = days.data.log?.food_items || days.data.food_items || [];
      ck('food already logged keeps its numbers (forgetting is about next time)', items.find(i => i.id === 501)?.per_100g?.protein === 24, items.map(i => i.per_100g?.protein));
    }

    console.log('\n[9] the 4/4/9 rule, unit');
    {
      ck('kcalFromMacros: 24/55/7.8 → 386', MF.kcalFromMacros({ protein: 24, carbs: 55, fat: 7.8 }) === 386);
      ck('nameKey collapses spaces and case', MF.nameKey('  Protein   OATS ') === 'protein oats');
      let threw = null; try { MF.buildLabel({ name: 'Oats', per_100g: { protein: 50, carbs: 50, fat: 0.6 } }); } catch (e) { threw = e; }
      ck('100.6 g in 100 g is refused; 100.5 is the rounding allowance', threw?.status === 400
         && MF.buildLabel({ name: 'Oats', per_100g: { protein: 50, carbs: 50, fat: 0.5 } }).per_100g.calories === 405, threw?.message);
    }
  } catch (e) {
    fail++; console.log('  ✗ suite crashed: ' + e.stack);
  } finally {
    await pool.query(`DELETE FROM daily_logs WHERE patient_id IN ($1,$2)`, [member, other]).catch(() => {});
    await pool.query(`DELETE FROM foods WHERE id=$1 OR name = ANY($2)`, [oatsId, [`Learnable ${tag}`, CHIKKI]]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[coach, coach2, admin, member, other]]).catch(() => {});
    srv.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    await pool.end();
    process.exit(fail ? 1 : 0);
  }
})();
