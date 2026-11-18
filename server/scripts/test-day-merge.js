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
  const post = async (date, body, token = M) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/logs/${date}`, { method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
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

  console.log('\n[2] durable save receipts over HTTP and real PostgreSQL');
  {
    const date = '2026-03-12', stream = 'p0-uncertain-commit';
    const base = (await post(date, body({ water_ml: 500 }))).data;
    const first = body({ client_stream_id: stream, client_sequence: 1,
      base_saved_at: base.saved_at, base_food_ids: [], base_fields: { water_ml: 500 }, water_ml: 750 });
    const committed = await post(date, first); // Response could be lost after this commit.
    const retry = await post(date, first);
    ck('same direct request retry does not apply additive water twice', committed.status === 200 && retry.status === 200 && retry.data.idempotent && Number(retry.data.water_ml) === 750, retry);
    ck('duplicate retry retains the original commit timestamp', retry.data.saved_at === committed.data.saved_at);

    const next = { ...first, client_sequence: 2, base_client_write: { streamId: stream, sequence: 1 }, offline_replay: true, water_ml: 1000, weight_kg: 71.9 };
    const recovered = await post(date, next);
    ck('newer offline revision continues our own commit after a lost response', recovered.status === 200 && !recovered.data.merged && Number(recovered.data.water_ml) === 1000 && Number(recovered.data.weight_kg) === 71.9, recovered);
    const older = await post(date, first);
    ck('late older request is acknowledged without replacing the newer day', older.status === 200 && older.data.superseded && Number(older.data.water_ml) === 1000, older);

    await pool.query(`UPDATE daily_logs SET water_ml=1600,weight_kg=79,food_items=$3,saved_at=NOW()
      WHERE patient_id=$1 AND log_date=$2`, [member, date, JSON.stringify([f('external', 'Coach food', 120)])]);
    const external = await post(date, { ...next, client_sequence: 3, base_client_write: { streamId: stream, sequence: 2 }, water_ml: 1250,
      food_items: [f('offline', 'Offline food', 180)] });
    ck('external edits still win after a timed-out predecessor', external.data.merged && Number(external.data.water_ml) === 1600 && Number(external.data.weight_kg) === 79, external);
    ck('receipt recovery preserves external food while adding offline food once', external.data.food_items.length === 2 && external.data.food_items.some(x => x.id === 'external') && external.data.food_items.some(x => x.id === 'offline'));
    const changed = await post(date, { ...next, client_sequence: 3, water_ml: 1500,
      food_items: [f('offline', 'Offline food', 180)] });
    ck('same revision with changed content returns 409 and leaves the committed day intact', changed.status === 409, changed);
    const count = await pool.query(`SELECT count(*)::int AS n FROM daily_log_write_receipts WHERE patient_id=$1 AND log_date=$2 AND stream_id=$3`, [member, date, stream]);
    ck('receipt storage stays one row per member/day/browser stream', count.rows[0].n === 1, count.rows);

    const other = (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ('P0 other member','9102','x','patient',true) RETURNING id`)).rows[0].id;
    await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [other]);
    const otherToken = jwt.sign({ id: other, role: 'patient' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const isolated = await post(date, body({ client_stream_id: stream, client_sequence: 1, water_ml: 400 }), otherToken);
    ck('identical stream/sequence cannot acknowledge another member\'s write', isolated.status === 200 && !isolated.data.idempotent && Number(isolated.data.water_ml) === 400 && isolated.data.patient_id === other, isolated);
    const otherDate = await post('2026-03-13', body({ client_stream_id: stream, client_sequence: 1, water_ml: 600 }));
    ck('receipt identity is also scoped to the log date', otherDate.status === 200 && !otherDate.data.idempotent && Number(otherDate.data.water_ml) === 600);

    for (const invalid of [
      { client_stream_id: 'x'.repeat(97), client_sequence: 1 },
      { client_stream_id: 'valid', client_sequence: 0 },
      { client_stream_id: 'valid', client_sequence: 1.5 },
      { client_stream_id: 'valid' },
    ]) ck('invalid bounded receipt metadata is rejected with 400', (await post(date, body(invalid))).status === 400, invalid);
  }
  {
    const date = '2026-03-14', stream = 'p0-nutrition-propagation';
    const food = { ...f('food', 'Dal', 200), per_100g: { calories: 100 } };
    const first = await post(date, body({ client_stream_id: stream, client_sequence: 1, food_items: [food] }));
    await pool.query(`UPDATE daily_logs SET food_items=$3 WHERE patient_id=$1 AND log_date=$2`,
      [member, date, JSON.stringify([{ ...food, per_100g: { calories: 120 } }])]);
    const second = await post(date, body({ client_stream_id: stream, client_sequence: 2, offline_replay: true,
      base_saved_at: first.data.saved_at, base_food_ids: ['food'], food_items: [food], water_ml: 1250 }));
    ck('nutrition correction without saved_at change invalidates continuation', second.status === 200 && second.data.merged && second.data.food_items[0].per_100g.calories === 120, second);
  }
  {
    const date = '2026-03-15', stream = 'p0-concurrent-sequences';
    const base = (await post(date, body({ water_ml: 500 }))).data;
    const request = sequence => body({ client_stream_id: stream, client_sequence: sequence,
      ...(sequence > 1 ? { base_client_write: { streamId: stream, sequence: sequence - 1 } } : {}),
      base_saved_at: base.saved_at, base_fields: { water_ml: 500 }, water_ml: 500 + 250 * sequence });
    const replies = await Promise.all([post(date, request(1)), post(date, request(2))]);
    const stored = (await pool.query(`SELECT water_ml FROM daily_logs WHERE patient_id=$1 AND log_date=$2`, [member, date])).rows[0];
    ck('concurrent requests serialize receipt checks and preserve the newest sequence', replies.every(r => r.status === 200) && Number(stored.water_ml) === 1000, replies);
    const receipt = (await pool.query(`SELECT sequence FROM daily_log_write_receipts WHERE patient_id=$1 AND log_date=$2 AND stream_id=$3`, [member, date, stream])).rows[0];
    ck('concurrent requests commit one latest receipt atomically with the day', receipt.sequence === 2, receipt);
  }
  {
    const date = '2026-03-16', stream = 'p0-stale-tab';
    const base = (await post(date, body({ water_ml: 500 }))).data;
    const staleBase = { base_saved_at: base.saved_at, base_fields: { water_ml: 500, weight_kg: 72.4 }, client_stream_id: stream };
    await post(date, body({ ...staleBase, client_sequence: 1, water_ml: 1000 }));
    const staleTab = await post(date, body({ ...staleBase, client_sequence: 2, water_ml: 500, weight_kg: 71.9 }));
    ck('shared-browser counter does not let a stale tab overwrite unrelated water', staleTab.status === 200 && staleTab.data.merged_live && Number(staleTab.data.water_ml) === 1000 && Number(staleTab.data.weight_kg) === 71.9, staleTab);
  }

  console.log(`\n${fail === 0 ? '\u2713' : '\u2717'} test-day-merge: ${pass} passed, ${fail} failed\n`);
  srv.close(); await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
