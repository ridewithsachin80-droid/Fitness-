/**
 * scripts/test-day-merge.js — an offline day replayed after newer edits.
 *
 * Sachin's rule (5 Oct 2026): merge the food, keep the newer value for the rest.
 * Pure rules first, then real Postgres and the real POST /api/logs/:date.
 *
 * WHAT MUST HOLD
 *   A. Food logged elsewhere after the phone went offline is NOT wiped.
 *   B. Food added offline IS added; food deleted offline stays deleted.
 *   C. Weight, water, ticks, sleep and notes keep the newer server value, and
 *      the reply names the fields where the offline copy differed.
 *   D. With no newer edit, an offline replay is written exactly as before.
 *   E. An ordinary (not replayed) save is written exactly as sent, always.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const { mergeOfflineDay, isStale } = require('../services/dayMerge');
const { getISTDate } = require('../utils/istDate');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };
const f = (id, name, grams, meal = 'Lunch') => ({ id, name, grams, meal, food_id: null, per_100g: { calories: 100 } });

(async () => {
  console.log('\n[0] the rules (no database)');
  {
    const stored = { saved_at: '2026-10-05T10:00:00.000Z', food_items: [f('a', 'Idli', 120), f('b', 'Sambar', 150), f('chat1', 'Banana', 100)],
                     weight_kg: '72.4', water_ml: 1500, activities: { walk: true }, acv: {}, supplements: {}, sleep: {}, notes: '' };
    // The phone loaded the day when it had a and b, then went offline:
    // deleted b, added c, and logged water 2000.
    const incoming = { food_items: [f('a', 'Idli', 120), f('c', 'Curd', 200)], weight_kg: 72.4, water_ml: 2000,
                       activities: { walk: true, sun: false }, acv: {}, supplements: {}, sleep: {}, notes: '' };
    const m = mergeOfflineDay(stored, incoming, ['a', 'b']);
    const names = m.food_items.map(x => x.name);
    ck('food logged elsewhere (the chat\'s banana) is kept', names.includes('Banana'), names);
    ck('food added offline (curd) is added', names.includes('Curd'));
    ck('food deleted offline (sambar) stays deleted', !names.includes('Sambar'));
    ck('nothing is doubled', names.length === 3 && new Set(m.food_items.map(x => x.id)).size === 3, names);
    ck('the counts say what changed', m.added === 1 && m.removed === 1, m);
    ck('water differed: reported as kept from the server', m.kept_server.join() === 'water', m.kept_server);
    ck('{walk:true, sun:false} and {walk:true} count as the same ticks', !m.kept_server.includes('activities'));
    ck('weight "72.4" and 72.4 count as the same', !m.kept_server.includes('weight'));

    const goneElsewhere = mergeOfflineDay({ food_items: [f('a', 'Idli', 120)] }, { food_items: [f('a', 'Idli', 120), f('b', 'Sambar', 150)] }, ['a', 'b']);
    ck('an item deleted ELSEWHERE after the phone loaded the day stays deleted', goneElsewhere.food_items.map(x => x.id).join() === 'a', goneElsewhere.food_items);
    const edited = mergeOfflineDay({ food_items: [f('a', 'Idli', 200)] }, { food_items: [f('a', 'Idli', 90)] }, ['a']);
    ck('the same item changed on both sides: the newer (server) grams win', edited.food_items.length === 1 && edited.food_items[0].grams === 200);
    const noIds = mergeOfflineDay({ food_items: [f(null, 'Roti', 40)] }, { food_items: [f(null, 'Roti', 40), f(null, 'Dal', 150)] }, null);
    ck('items without ids: an exact repeat is not doubled, a new one is added', noIds.food_items.map(x => x.name).join() === 'Roti,Dal', noIds.food_items);

    ck('stale when the server copy is newer than the phone\'s', isStale({ saved_at: '2026-10-05T10:00:00.000Z' }, '2026-10-05T09:00:00.000Z') === true);
    ck('not stale when it is the same copy', isStale({ saved_at: '2026-10-05T10:00:00.123Z' }, '2026-10-05T10:00:00.123Z') === false);
    ck('stale when the phone had no copy but one exists now', isStale({ saved_at: '2026-10-05T10:00:00.000Z' }, null) === true);
    ck('never stale when there is no server copy', isStale(null, null) === false);
  }

  // ── Real Postgres, real route ───────────────────────────────────────────────
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const member = (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ('Padmini','9101','x','patient',true) RETURNING id`)).rows[0].id;
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [member]);
  const M = jwt.sign({ id: member, role: 'patient', name: 'Padmini' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use((req, res, next) => { req.io = { to: () => ({ emit() {} }) }; next(); });
  app.use('/api/logs', require('../routes/logs'));
  const srv = app.listen(0); const port = srv.address().port;
  const post = async (date, body) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/logs/${date}`, { method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + M }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const day = getISTDate();
  const row = async () => (await pool.query(`SELECT * FROM daily_logs WHERE patient_id=$1 AND log_date=$2::date`, [member, day])).rows[0];
  const body = (over) => ({ weight_kg: 72.4, activities: {}, acv: {}, supplements: {}, sleep: {}, notes: '', water_ml: 1000, food_items: [], ...over });

  console.log('\n[1] over HTTP, real Postgres');
  {
    let r = await post(day, body({ food_items: [f('a', 'Idli', 120), f('b', 'Sambar', 150)] }));
    const loaded = r.data;                        // what the phone has, then signal drops
    ck('an ordinary save is written as sent', r.status === 200 && loaded.food_items.length === 2 && !loaded.merged, r.data);

    // Meanwhile, elsewhere (the chat, voice, another phone): a banana, and water 1500.
    await new Promise(res => setTimeout(res, 20));
    r = await post(day, body({ water_ml: 1500, food_items: [...loaded.food_items, f('chat1', 'Banana', 100)] }));
    ck('the newer edit is saved', r.data.food_items.length === 3 && r.data.water_ml === 1500);

    // The phone comes back with its offline copy: deleted sambar, added curd, water 2000.
    r = await post(day, body({ offline_replay: true, base_saved_at: loaded.saved_at, base_food_ids: ['a', 'b'],
                               water_ml: 2000, food_items: [f('a', 'Idli', 120), f('c', 'Curd', 200)] }));
    const names = (await row()).food_items.map(x => x.name).sort().join();
    ck('the replay is merged, not written over the newer day', r.status === 200 && r.data.merged === true, r.data);
    ck('in the database: idli, banana (kept) and curd (added); sambar gone', names === 'Banana,Curd,Idli', names);
    ck('water keeps the newer 1500, and the reply says water was not saved', Number((await row()).water_ml) === 1500 && r.data.kept_server.join() === 'water', [ (await row()).water_ml, r.data.kept_server]);
    ck('the reply counts the food added and removed', r.data.food_added === 1 && r.data.food_removed === 1);

    // A replay with no newer edit: written exactly as before.
    const now = await row();
    r = await post(day, body({ offline_replay: true, base_saved_at: now.saved_at, base_food_ids: now.food_items.map(x => x.id),
                               water_ml: 2500, food_items: [f('a', 'Idli', 120)] }));
    ck('no newer edit: the replay is written as sent (water 2500, one food)', !r.data.merged && Number((await row()).water_ml) === 2500 && (await row()).food_items.length === 1, r.data);

    // An ORDINARY save with an old base is never merged: it is the latest edit.
    r = await post(day, body({ base_saved_at: '2000-01-01T00:00:00.000Z', base_food_ids: ['zzz'], water_ml: 3000, food_items: [] }));
    ck('an ordinary save is never merged, whatever base it carries', !r.data.merged && Number((await row()).water_ml) === 3000 && (await row()).food_items.length === 0, r.data);

    // A replay for a day with no server copy at all: just written.
    const other = '2026-01-15';
    r = await post(other, body({ offline_replay: true, base_saved_at: null, food_items: [f('x', 'Poha', 150)] }));
    ck('a replay for a day the server has never seen is written as sent', r.status === 200 && !r.data.merged && r.data.food_items.length === 1, r.data);
  }

  console.log(`\n${fail === 0 ? '\u2713' : '\u2717'} test-day-merge: ${pass} passed, ${fail} failed\n`);
  srv.close(); await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
