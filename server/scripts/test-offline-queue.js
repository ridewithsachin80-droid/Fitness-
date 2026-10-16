/**
 * scripts/test-offline-queue.js — the offline log queue (Phase 0).
 *
 * Runs the REAL client logic (client/src/utils/offlineQueueCore.js) through
 * scripts/lib/client-bundle.js, with an in-memory store standing in for
 * IndexedDB and a controllable stand-in for the server.
 *
 * THE BUGS THIS GUARDS
 * --------------------
 * 1. Shared phone: member A logs offline and signs out, member B signs in —
 *    A's day was sent with B's credentials and saved on B's record.
 * 2. Two sync passes at once sent the same entry twice.
 * 3. An upload finishing late deleted (or, on failure, overwrote) a NEWER edit
 *    of the same day made while it was in flight.
 * 4. Entries queued before owner-tagging must never be sent on a guess.
 */
const fs   = require('fs');
const path = require('path');
const { importClient } = require('./lib/client-bundle');
const Q = importClient('utils/offlineQueueCore.js');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };

const STORE = 'log-queue';
const tick  = () => new Promise(r => setImmediate(r));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
};

/** Bundle the REAL browser adapter with only its browser/network boundaries
 *  injected. Unlike a source assertion, these checks execute fallback saves,
 *  IndexedDB revision capture, cancellation and queue draining together. */
async function loadHook(ctx) {
  const esbuild = require('esbuild');
  globalThis.__p0OfflineHook = ctx;
  const modules = {
    '../api/client': 'export default globalThis.__p0OfflineHook.api;',
    '../store/authStore': 'export const useAuthStore = { getState: () => globalThis.__p0OfflineHook.session, subscribe: () => () => {} };',
    '../store/logStore': 'export const useLogStore = { getState: () => globalThis.__p0OfflineHook.logStore };',
    idb: 'export const openDB = async () => { const ctx = globalThis.__p0OfflineHook; if (ctx.stall) await new Promise(() => {}); if (ctx.storageError) throw ctx.storageError; return ctx.db; };',
    react: 'export const useEffect = () => {};',
  };
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../../client/src/hooks/useOfflineQueue.js')],
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'offline-browser-boundaries', setup(build) {
      build.onResolve({ filter: /.*/ }, args => args.path in modules ? { path: args.path, namespace: 'p0-stub' } : null);
      build.onLoad({ filter: /.*/, namespace: 'p0-stub' }, args => ({ contents: modules[args.path], loader: 'js' }));
    } }],
  });
  const mod = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(mod, mod.exports);
  return mod.exports;
}

/** In-memory object store with the slice of the idb API the core uses. Every
 *  call yields, so passes can interleave the way they do in a browser. */
function memDB() {
  const rows = new Map();
  const metadata = new Map();
  const bucket = key => key.startsWith('stream:') ? metadata : rows;
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  let transactionTail = Promise.resolve();
  const ops = {
    get:    async (k) => { await tick(); return clone(bucket(k).get(k)); },
    put:    async (v) => { await tick(); bucket(v.key).set(v.key, clone(v)); },
    delete: async (k) => { await tick(); bucket(k).delete(k); },
  };
  return {
    rows, metadata,
    get:    (_s, k) => ops.get(k),
    put:    (_s, v) => ops.put(v),
    delete: (_s, k) => ops.delete(k),
    getAll: async () => { await tick(); return [...rows.values(), ...metadata.values()].map(clone); },
    // One "transaction" runs without yielding between its steps, which is the
    // guarantee IndexedDB gives a readwrite transaction on one store.
    transaction: () => {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise(r => { release = r; });
      return {
        store: {
          get:    async (k) => { await previous; return clone(bucket(k).get(k)); },
          put:    async (v) => { await previous; bucket(v.key).set(v.key, clone(v)); },
          delete: async (k) => { await previous; bucket(k).delete(k); },
        },
        get done() { release(); return Promise.resolve(); },
      };
    },
  };
}

/** A server that records who each request was saved for, and can be held,
 *  failed or made to "commit then time out". */
function fakeServer(session) {
  const saved = [];           // { as, date, log }
  let mode = 'ok', gate = null;
  const post = async (date, log) => {
    const as = session.user;                       // credentials at send time
    await tick();                                  // a real request always yields
    if (gate) await gate.promise;
    if (mode === 'fail')    { const e = new Error('Network Error'); throw e; }
    if (mode === 'auth')    { const e = new Error('401'); e.response = { status: 401 }; throw e; }
    saved.push({ as, date, log });
    if (mode === 'commit-then-timeout') { mode = 'ok'; throw new Error('timeout of 15000ms exceeded'); }
    return { data: {} };
  };
  return {
    post, saved,
    set mode(m) { mode = m; },
    hold()    { let res; gate = { promise: new Promise(r => { res = r; }) }; gate.release = res; },
    release() { const g = gate; gate = null; g.release(); },
  };
}

function setup({ db = memDB(), lock } = {}) {
  const session = { user: null };
  const server  = fakeServer(session);
  let clock = 1_000_000;
  const q = Q.createQueue({
    getDB: async () => db, store: STORE, post: server.post,
    getOwner: () => session.user, now: () => (clock += 1000), lock,
  });
  return { db, session, server, q, advance: (ms) => { clock += ms; } };
}

// A continuation test must actually read the pending snapshot it edits.
async function editPending(q, date, next) {
  const loaded = await q.read(date);
  return q.enqueue(date, { ...next, base_client_write: loaded?.base_client_write });
}

/** In-memory transport exercising the actual server receipt/merge rules.
 * SQL atomicity is covered separately by test-day-merge against PostgreSQL. */
function receiptServer(initial = {}) {
  const R = require('../services/dayWriteReceipt');
  const { isStale, mergeOfflineDay, mergeLiveDay } = require('../services/dayMerge');
  const receipts = new Map();
  let row = { weight_kg: 81, water_ml: 500, activities: {}, acv: {}, supplements: {}, sleep: {}, notes: '', food_items: [],
    saved_at: '2026-10-01T10:00:00.000Z', ...initial };
  let clock = 0;
  return {
    get row() { return row; },
    set row(value) { row = value; },
    receipts,
    post: async (_date, body) => {
      const write = R.writeMetadata(body), hash = R.requestFingerprint(body, body.protocol_total);
      const receipt = write ? receipts.get(write.streamId) : null;
      const decision = R.receiptDecision(receipt, row, write, hash);
      if (decision.replay) return { data: { ...row, ...receipt.outcome, idempotent: true,
        superseded: decision.superseded, ...(decision.externalChanged ? { merged: true } : {}) } };
      const stale = (isStale(row, body.base_saved_at) || decision.externalChanged) && !decision.continuation;
      let extra = {};
      if (body.offline_replay && stale) {
        const merged = mergeOfflineDay(row, body, body.base_food_ids);
        row = { ...row, food_items: merged.food_items };
        extra = { merged: true, kept_server: merged.kept_server };
      } else if (stale && body.base_fields) {
        const merged = mergeLiveDay(row, body, body.base_food_ids, body.base_fields);
        row = { ...row, ...merged.doc };
        extra = { merged_live: true, kept_server: merged.kept_server };
      } else row = { ...row, ...body };
      row.saved_at = new Date(Date.UTC(2026, 9, 1, 10, 0, ++clock)).toISOString();
      if (write) receipts.set(write.streamId, { sequence: write.sequence, payload_hash: hash, day_hash: R.dayFingerprint(row), outcome: extra });
      return { data: { ...row, ...extra } };
    },
  };
}

(async () => {
  // ── 1. Shared phone ─────────────────────────────────────────────────────────
  console.log('Shared phone: A logs offline, signs out, B signs in');
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-01', { weight_kg: 81 });
    t.session.user = null;                                   // A signs out
    await t.q.sync();
    ck('nothing is sent while nobody is signed in', t.server.saved.length === 0);
    t.session.user = 300;                                    // B signs in
    const r = await t.q.sync();
    ck("B's sync sends nothing of A's", t.server.saved.length === 0, t.server.saved);
    ck("A's entry is still on the device", t.db.rows.has('log:214:2026-10-01'));
    ck("B's badge does not count A's entry", (await t.q.status()).count === 0);
    await t.q.enqueue('2026-10-01', { weight_kg: 64 });     // B logs the same date
    ck('same date, two members: two separate entries', t.db.rows.size === 2);
    await t.q.sync();
    ck("B's own entry is saved as B", t.server.saved.length === 1 && t.server.saved[0].as === 300 && t.server.saved[0].log.weight_kg === 64, t.server.saved);
    t.session.user = 214;                                    // A comes back
    ck("A's badge shows A's entry again", (await t.q.status()).count === 1);
    await t.q.sync();
    ck("A's entry is saved as A, with A's data", t.server.saved.length === 2 && t.server.saved[1].as === 214 && t.server.saved[1].log.weight_kg === 81, t.server.saved);
    ck('queue is empty once both have synced', t.db.rows.size === 0);
    ck('every save went to the member who made it', t.server.saved.every(s => (s.as === 214) === (s.log.weight_kg === 81)));
  }

  console.log('\nMember id as number or string');
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-02', { n: 1 });
    t.session.user = '214';
    await t.q.sync();
    ck("214 and '214' are the same member", t.server.saved.length === 1);
  }
  {
    const t = setup(); t.session.user = 214;
    t.db.rows.set('log:214:2026-10-01', { key: 'log:214:2026-10-01', ownerId: 214, date: '2026-10-01', rev: 'older-app-revision', queuedAt: 1, log: { water_ml: 750 } });
    await t.q.sync();
    ck('an older app\'s owner-tagged queue gets a durable receipt before its first replay',
      t.server.saved.length === 1 && t.server.saved[0].log.client_stream_id && t.server.saved[0].log.client_sequence === 1 && t.db.rows.size === 0);
  }

  console.log('\nNobody signed in');
  {
    const t = setup();
    let threw = false;
    try { await t.q.enqueue('2026-10-02', {}); } catch (_) { threw = true; }
    ck('queueing without a member is refused, not stored ownerless', threw && t.db.rows.size === 0);
    ck('status is empty when signed out', (await t.q.status()).count === 0);
  }

  // ── 2. Concurrent sync ──────────────────────────────────────────────────────
  console.log('\nTwo sync passes at once');
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-01', { n: 1 });
    await t.q.enqueue('2026-10-02', { n: 2 });
    await Promise.all([t.q.sync(), t.q.sync(), t.q.sync()]);
    ck('same tab: each entry is sent once', t.server.saved.length === 2, t.server.saved.length);
  }
  {
    // Two tabs = two queues over one database, sharing a cross-tab lock.
    const db = memDB();
    let held = false;
    const lock = async (fn) => { if (held) return { skipped: 'locked' }; held = true; try { return await fn(); } finally { held = false; } };
    const a = setup({ db, lock }), b = setup({ db, lock });
    a.session.user = b.session.user = 214;
    await a.q.enqueue('2026-10-01', { n: 1 });
    a.server.hold();
    const pa = a.q.sync(); await tick(); await tick(); await tick();
    const rb = await b.q.sync();
    a.server.release(); await pa;
    ck('two tabs: the second pass stands down', rb.skipped === 'locked' && b.server.saved.length === 0, rb);
    ck('two tabs: entry sent once and removed', a.server.saved.length === 1 && db.rows.size === 0);
  }
  {
    // No cross-tab lock available (older browser): both tabs may send, the
    // server upsert makes that harmless, and nothing may be lost or left.
    const db = memDB();
    const a = setup({ db }), b = setup({ db });
    a.session.user = b.session.user = 214;
    await a.q.enqueue('2026-10-01', { n: 1 });
    await Promise.all([a.q.sync(), b.q.sync()]);
    const sent = [...a.server.saved, ...b.server.saved];
    ck('no lock: every send carries the same day and data', sent.length >= 1 && sent.every(s => s.date === '2026-10-01' && s.log.n === 1), sent);
    ck('no lock: queue ends empty', db.rows.size === 0);
  }

  // ── 3. Newer edit while an older one is uploading ───────────────────────────
  console.log('\nEdit during upload');
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-01', { v: 'old' });
    t.server.hold();
    const p = t.q.sync(); await tick(); await tick(); await tick();
    await editPending(t.q, '2026-10-01', { v: 'new' });   // member edits the loaded pending day
    t.server.release(); await p;
    const row = t.db.rows.get('log:214:2026-10-01');
    ck('the late upload does not delete the newer edit', !!row && row.log.v === 'new', row);
    await t.q.sync();
    ck('the newer edit is then sent, last', t.server.saved.map(s => s.log.v).join() === 'old,new', t.server.saved);
    ck('and the queue is empty', t.db.rows.size === 0);
  }
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-01', { v: 'old' });
    t.server.hold(); t.server.mode = 'fail';
    const p = t.q.sync(); await tick(); await tick(); await tick();
    await editPending(t.q, '2026-10-01', { v: 'new' });
    t.server.release(); await p;
    const row = t.db.rows.get('log:214:2026-10-01');
    ck('a late FAILURE does not overwrite the newer edit with old data', row && row.log.v === 'new' && !row.attempts, row);
  }

  // ── 4. Timeout after the server already saved ───────────────────────────────
  console.log('\nTimeout after server commit');
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-01', { weight_kg: 81 });
    t.server.mode = 'commit-then-timeout';
    await t.q.sync();
    const row = t.db.rows.get('log:214:2026-10-01');
    ck('entry is kept and counted as one failed attempt', row && row.attempts === 1, row);
    await t.q.sync();
    ck('retry resends the identical day', t.server.saved.length === 2 && JSON.stringify(t.server.saved[0]) === JSON.stringify(t.server.saved[1]));
    ck('and the queue drains', t.db.rows.size === 0);
    // The resend is only harmless because the server REPLACES the day's row.
    const route = fs.readFileSync(path.join(__dirname, '../routes/logs.js'), 'utf8');
    ck('source contract: server day save uses a member/date upsert (DB execution is a separate suite)',
       /ON CONFLICT \(patient_id, log_date\) DO UPDATE/.test(route));
  }
  {
    // Use the real merge rules, not a fake server that blindly replaces rows:
    // our own older upload must not make the next local revision look like a
    // conflict from another device and silently discard its water/weight.
    const { isStale, mergeOfflineDay } = require('../services/dayMerge');
    const db = memDB(), gate = deferred(), started = deferred();
    const baseTime = '2026-10-01T10:00:00.000Z';
    let row = { saved_at: baseTime, weight_kg: 81, water_ml: 500, food_items: [] }, sends = 0;
    const q = Q.createQueue({ getDB: async () => db, store: STORE, getOwner: () => 214,
      post: async (_date, incoming) => {
        sends++;
        if (sends === 1) { started.resolve(); await gate.promise; }
        const merged = isStale(row, incoming.base_saved_at);
        row = merged
          ? { ...row, ...mergeOfflineDay(row, incoming, incoming.base_food_ids) }
          : { ...row, ...incoming };
        row.saved_at = `2026-10-01T10:00:0${sends}.000Z`;
        return { data: { ...row, merged } };
      } });
    const firstEntry = await q.enqueue('2026-10-01', { base_saved_at: baseTime, base_food_ids: [], weight_kg: 81, water_ml: 750, food_items: [] });
    const pending = q.sync(); await started.promise;
    await q.enqueue('2026-10-01', { base_saved_at: baseTime, base_food_ids: [], base_client_write: firstEntry.write, weight_kg: 80.5, water_ml: 1000, food_items: [] });
    gate.resolve(); await pending;
    await q.sync();
    ck('a newer queued edit keeps weight and water after our own earlier replay commits', row.weight_kg === 80.5 && row.water_ml === 1000, row);
    ck('all consecutive local revisions drain after the real merge rules accept them', db.rows.size === 0 && sends === 2);
  }
  console.log('\nUncertain commits with actual server receipt rules');
  for (const externalEdit of [false, true]) {
    const db = memDB(), server = receiptServer(), started = deferred(), gate = deferred();
    let calls = 0;
    const q = Q.createQueue({ getDB: async () => db, store: STORE, getOwner: () => 214,
      post: async (date, body) => {
        calls++;
        if (calls === 1) { started.resolve(); await gate.promise; }
        const result = await server.post(date, body);
        if (calls === 1) throw new Error('Commit succeeded; response timed out');
        return result;
      } });
    const base = server.row.saved_at;
    const firstEntry = await q.enqueue('2026-10-01', { base_saved_at: base, base_food_ids: [], weight_kg: 81, water_ml: 750, food_items: [] });
    const first = q.sync(); await started.promise;
    await q.enqueue('2026-10-01', { base_saved_at: base, base_food_ids: [], base_client_write: firstEntry.write, weight_kg: 80.5, water_ml: 1000, food_items: [] });
    gate.resolve(); await first;
    if (externalEdit) server.row = { ...server.row, weight_kg: 79, water_ml: 1500,
      food_items: [{ id: 'coach-food', name: 'Dal', grams: 200 }], saved_at: '2026-10-01T10:01:00.000Z' };
    await q.sync();
    ck(externalEdit ? 'a later external edit still wins after our timed-out commit'
      : 'newer weight/water survive an older committed replay whose response was lost',
      server.row.weight_kg === (externalEdit ? 79 : 80.5) && server.row.water_ml === (externalEdit ? 1500 : 1000), server.row);
    ck(externalEdit ? 'external food survives the receipt continuation guard'
      : 'uncertain-commit recovery drains both revisions without duplication',
      db.rows.size === 0 && (externalEdit ? server.row.food_items.some(x => x.id === 'coach-food') : server.row.food_items.length === 0));
  }
  {
    const server = receiptServer();
    const body = { client_stream_id: 'stable-browser', client_sequence: 1, base_saved_at: server.row.saved_at,
      base_fields: { water_ml: 500 }, weight_kg: 81, water_ml: 750, food_items: [] };
    const first = await server.post('2026-10-01', body);
    const retry = await server.post('2026-10-01', body);
    ck('identical direct retry is acknowledged without applying additive water twice', retry.data.idempotent === true && server.row.water_ml === 750);
    ck('identical retry does not change the committed timestamp', retry.data.saved_at === first.data.saved_at);
    await server.post('2026-10-01', { ...body, client_sequence: 2, base_client_write: { streamId: 'stable-browser', sequence: 1 }, water_ml: 1000 });
    const older = await server.post('2026-10-01', body);
    ck('older same-stream retry cannot replace the newer accepted value', older.data.superseded === true && server.row.water_ml === 1000);
    let conflict;
    try { await server.post('2026-10-01', { ...body, client_sequence: 2, water_ml: 1250 }); } catch (error) { conflict = error; }
    ck('reusing a revision for different data is rejected rather than silently accepted', conflict?.status === 409 && server.row.water_ml === 1000);
    server.row = { ...server.row, water_ml: 1600 };
    const changed = await server.post('2026-10-01', { ...body, client_sequence: 2, water_ml: 1000 });
    ck('duplicate acknowledgment preserves external changes and forbids client base advancement', changed.data.merged === true && server.row.water_ml === 1600);
    ck('receipts are updated in place rather than appended per save', server.receipts.size === 1);
  }
  {
    const server = receiptServer();
    const base = server.row.saved_at;
    await server.post('2026-10-01', { client_stream_id: 'two-tabs', client_sequence: 1,
      base_saved_at: base, base_fields: { water_ml: 500, weight_kg: 81 }, water_ml: 1000, weight_kg: 81, food_items: [] });
    const staleTab = await server.post('2026-10-01', { client_stream_id: 'two-tabs', client_sequence: 2,
      base_saved_at: base, base_fields: { water_ml: 500, weight_kg: 81 }, water_ml: 500, weight_kg: 80.5, food_items: [] });
    ck('a later counter from a stale tab does not imply descent from another tab\'s edit', staleTab.data.merged_live === true && server.row.water_ml === 1000 && server.row.weight_kg === 80.5, server.row);
  }
  {
    const server = receiptServer();
    const food = { id: 'meal', name: 'Dal', grams: 200, per_100g: { calories: 100 } };
    const body = { client_stream_id: 'nutrition-change', client_sequence: 1, offline_replay: true,
      base_saved_at: server.row.saved_at, base_food_ids: [], weight_kg: 81, water_ml: 750, food_items: [food] };
    await server.post('2026-10-01', body);
    // Nutrition propagation can update food JSON without changing saved_at.
    server.row = { ...server.row, food_items: [{ ...food, per_100g: { calories: 120 } }] };
    const result = await server.post('2026-10-01', { ...body, client_sequence: 2, base_saved_at: server.row.saved_at, water_ml: 1000 });
    ck('external nutrition changes invalidate continuation even when saved_at is unchanged',
      result.data.merged === true && server.row.food_items[0].per_100g.calories === 120);
  }
  {
    const t = setup(); t.session.user = 214;
    const a = await t.q.enqueue('2026-10-01', { water_ml: 500 });
    await t.q.sync();
    const parallel = await Promise.allSettled([t.q.enqueue('2026-10-01', { water_ml: 750 }), t.q.enqueue('2026-10-01', { water_ml: 500, weight_kg: 80.5 })]);
    const b = parallel[0].value;
    ck('concurrent unrelated tabs cannot overwrite a pending snapshot or reuse a sequence', a.write.streamId === b?.write.streamId && b.write.sequence === 2 && parallel[1].reason?.code === 'QUEUE_CONFLICT' && (await t.q.read('2026-10-01')).water_ml === 750);
    await t.q.sync();
    const c = await t.q.enqueue('2026-10-01', { water_ml: 1000 });
    ck('stream identity and monotonic counter survive successful queue draining', c.write.streamId === a.write.streamId && c.write.sequence === 3);
    ck('counter metadata never appears as ownerless health data', (await t.q.status()).unclaimed === 0 && (await t.q.status()).count === 1);
    const rejected = await editPending(t.q, '2026-10-01', { water_ml: 'invalid' });
    await t.q.restore(rejected);
    ck('rejected direct save restores the previous pending valid revision', (await t.q.read('2026-10-01')).water_ml === 1000);
    const rejectedAgain = await editPending(t.q, '2026-10-01', { water_ml: 'invalid' });
    await editPending(t.q, '2026-10-01', { water_ml: 1250 });
    await t.q.restore(rejectedAgain);
    ck('restoring a rejected save never overwrites a newer pending edit', (await t.q.read('2026-10-01')).water_ml === 1250);
  }

  // ── 5. Session and retry limits ─────────────────────────────────────────────
  console.log('\nSession lost mid-pass');
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-01', { n: 1 });
    await t.q.enqueue('2026-10-02', { n: 2 });
    t.server.mode = 'auth';
    const r = await t.q.sync();
    const rows = [...t.db.rows.values()];
    ck('a 401 stops the pass', r.stopped === 'auth');
    ck('a 401 does not use up retries', rows.length === 2 && rows.every(x => !x.attempts), rows);
  }
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-01', { n: 1 });
    await t.q.enqueue('2026-10-02', { n: 2 });
    const realPost = t.server.post;
    // Sign out right after the first entry goes.
    const q2 = Q.createQueue({ getDB: async () => t.db, store: STORE, getOwner: () => t.session.user,
      post: async (d, l) => { const r = await realPost(d, l); t.session.user = null; return r; } });
    const r = await q2.sync();
    ck('signing out mid-pass stops it before the next entry', r.stopped === 'owner-changed' && t.server.saved.length === 1 && t.db.rows.size === 1, r);
  }

  console.log('\nRetry cap');
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-01', { n: 1 });
    t.server.mode = 'fail';
    for (let i = 0; i < Q.MAX_ATTEMPTS + 3; i++) await t.q.sync();
    const row = t.db.rows.get('log:214:2026-10-01');
    ck('attempts stop at the cap', row.attempts === Q.MAX_ATTEMPTS, row.attempts);
    const st = await t.q.status();
    ck('status reports it as stuck and exhausted', st.stuck && st.exhausted && st.count === 1, st);
    t.server.mode = 'ok';
    await t.q.sync();
    ck('an exhausted entry is not resent on its own', t.server.saved.length === 0);
    await t.q.retryNow();
    ck('"Try again now" resets and sends it', t.server.saved.length === 1 && t.db.rows.size === 0);
  }
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-01', { n: 1 });
    ck('a fresh entry is not stuck', (await t.q.status()).stuck === false);
    t.advance(Q.STUCK_AFTER_MS + 5000);
    ck('an entry waiting over a day is stuck', (await t.q.status()).stuck === true);
  }

  // ── 6. A direct save supersedes the queued copy ─────────────────────────────
  console.log('\nDirect save after a queued one');
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-01', { v: 'old' });
    await t.q.supersede('2026-10-01', 214, await t.q.revision('2026-10-01'));
    await t.q.sync();
    ck('the stale queued copy is dropped, not replayed over the newer save', t.server.saved.length === 0 && t.db.rows.size === 0);
    t.session.user = 300;
    await t.q.enqueue('2026-10-01', { v: 'b' });
    t.session.user = 214;
    await t.q.supersede('2026-10-01', 214, await t.q.revision('2026-10-01'));
    ck("superseding never touches another member's entry", t.db.rows.has('log:300:2026-10-01'));
  }
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-01', { v: 'before-direct-save' });
    const sentRev = t.db.rows.get('log:214:2026-10-01').rev;
    // A direct request is now in flight. The network drops and a newer edit
    // is queued before that older direct request finishes successfully.
    await editPending(t.q, '2026-10-01', { v: 'newer-offline-edit' });
    await t.q.supersede('2026-10-01', 214, sentRev);
    ck('a late direct success cannot delete a newer offline edit',
      t.db.rows.get('log:214:2026-10-01')?.log.v === 'newer-offline-edit');
  }
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-01', { v: 'first-day' });
    await t.q.enqueue('2026-10-02', { v: 'stale-day' });
    t.server.hold();
    const pending = t.q.sync();
    for (let i = 0; i < 8; i++) await tick();
    // The second item was in the pass snapshot, but has since been saved
    // directly. Sending the removed snapshot would revive stale data.
    const sentRev = t.db.rows.get('log:214:2026-10-02').rev;
    await t.q.supersede('2026-10-02', 214, sentRev);
    t.server.release();
    await pending;
    ck('sync does not replay a snapshot removed while another day uploaded',
      t.server.saved.length === 1 && t.server.saved[0].date === '2026-10-01', t.server.saved);
  }
  {
    const t = setup();
    t.session.user = 214;
    await t.q.enqueue('2026-10-01', { v: 'first-day' });
    await t.q.enqueue('2026-10-02', { v: 'old-second-day' });
    t.server.hold();
    const pending = t.q.sync();
    for (let i = 0; i < 8; i++) await tick();
    await editPending(t.q, '2026-10-02', { v: 'new-second-day' });
    t.server.release();
    await pending;
    ck('sync never uploads a replaced stale revision from its snapshot',
      t.server.saved.every(x => x.log.v !== 'old-second-day'), t.server.saved);
    await t.q.sync();
    ck('the replacement revision is retained and later synced',
      t.server.saved.at(-1)?.log.v === 'new-second-day' && t.db.rows.size === 0, t.server.saved);
  }
  {
    const t = setup();
    t.session.user = 214;
    ck('no queued revision is represented explicitly as null', await t.q.revision('2026-10-01') === null);
    await t.q.enqueue('2026-10-01', { v: 'newer-edit' });
    await t.q.supersede('2026-10-01', 214, null);
    ck('a direct save with no prior queued copy cannot remove a later entry', t.db.rows.size === 1);
  }
  {
    const t = setup(); t.session.user = 214;
    const sent = { base_saved_at: null, water_ml: 750, food_items: [] };
    const write = { streamId: 'direct-parent', sequence: 1 };
    await t.q.enqueue('2026-10-01', { ...sent, base_client_write: write, water_ml: 1000 });
    await t.q.supersede('2026-10-01', 214, null, sent,
      { water_ml: 750, food_items: [], saved_at: '2026-10-01T10:00:01.000Z' }, write);
    const pending = await t.q.read('2026-10-01');
    ck('known direct success advances a newer offline edit\'s base without discarding its changes',
      pending?.water_ml === 1000 && pending.base_fields?.water_ml === 750 && pending.base_saved_at === '2026-10-01T10:00:01.000Z', pending);
    const sentBase = pending.base_saved_at;
    await t.q.supersede('2026-10-01', 214, null, pending,
      { water_ml: 1500, food_items: [], saved_at: '2026-10-01T10:00:02.000Z', merged: true });
    ck('a genuine external conflict never rewrites the pending edit\'s base',
      (await t.q.read('2026-10-01'))?.base_saved_at === sentBase);
  }
  {
    const t = setup();
    t.session.user = 214;
    const payload = { water_ml: 750, food_items: [{ id: 'offline-food', name: 'Dal', grams: 180 }],
      base_saved_at: '2026-10-01T10:00:00Z', base_food_ids: [], base_fields: { water_ml: 500 } };
    await t.q.enqueue('2026-10-01', payload);
    // A fresh queue instance represents the app reopening with persisted DB.
    const reopened = setup({ db: t.db });
    reopened.session.user = 214;
    const restored = await reopened.q.read('2026-10-01');
    ck('reopening restores the complete queued day, original merge base and explicit write parent', JSON.stringify(restored) === JSON.stringify({ ...payload, base_client_write: t.db.rows.get('log:214:2026-10-01').write }), restored);
    reopened.session.user = 300;
    ck('queue restoration never returns another member\'s pending day', await reopened.q.read('2026-10-01') === null);
    reopened.session.user = null;
    ck('queue restoration returns nothing while signed out', await reopened.q.read('2026-10-01') === null);
  }
  {
    const db = memDB(), session = { user: 214 }, notices = [];
    const gate = deferred(), started = deferred();
    const q = Q.createQueue({ getDB: async () => db, store: STORE, getOwner: () => session.user,
      post: async () => { started.resolve(); await gate.promise; return { data: { merged: true, kept_server: ['weight'] } }; },
      onMerged: notice => notices.push(notice) });
    await q.enqueue('2026-10-01', { weight_kg: 81 });
    const pending = q.sync();
    await started.promise;
    session.user = 300;
    gate.resolve();
    await pending;
    ck('a late merge response never notifies the next signed-in member', notices.length === 0);
    ck('a committed old-owner revision can still be removed safely', db.rows.size === 0);
  }

  console.log('\nOffline browser adapter (real hook with controlled boundaries)');
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const net = { onLine: false };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: net });
  try {
    {
      const db = memDB(), started = deferred(), gate = deferred(), requests = [];
      const ctx = { db, session: { user: { id: 214 }, sessionVersion: 1 }, api: {
        post: async (url, payload, config) => {
          requests.push({ url, payload, config });
          if (payload.v === 'direct-save') { started.resolve(); await gate.promise; }
          return { data: { saved_at: '2026-10-13T00:00:00Z' } };
        },
      } };
      const hook = await loadHook(ctx);
      net.onLine = false;
      const queued = await hook.saveLogWithFallback('2026-10-01', { v: 'old-queue' });
      net.onLine = true;
      const direct = hook.saveLogWithFallback('2026-10-01', { v: 'direct-save', base_client_write: queued.write });
      await started.promise;
      net.onLine = false;
      const loaded = await hook.getQueuedLog('2026-10-01');
      const newer = await hook.saveLogWithFallback('2026-10-01', { v: 'newest-queue', base_client_write: loaded.base_client_write });
      gate.resolve();
      const saved = await direct;
      ck('hook reports offline fallback honestly and online save separately', newer.queued === true && saved.queued === false);
      ck('hook preserves a newer offline edit after an older online success', db.rows.get('log:214:2026-10-01')?.log.v === 'newest-queue');
      ck('hook exposes the pending day for offline reopen hydration', (await hook.getQueuedLog('2026-10-01', 214))?.v === 'newest-queue');
      ck('direct hook save binds the original owner and session before awaiting', requests[0].config?._authSession?.owner === 214 && requests[0].config?._authSession?.version === 1, requests[0].config);
      net.onLine = true;
      await hook.syncOfflineQueue();
      ck('hook reconnect replays the newest queued edit with replay marker', requests.at(-1)?.payload.v === 'newest-queue' && requests.at(-1)?.payload.offline_replay === true && db.rows.size === 0);
    }
    {
      const db = memDB(), started = deferred(), gate = deferred();
      const originalTransaction = db.transaction;
      let firstRead = true;
      db.transaction = (...args) => {
        const tx = originalTransaction(...args), originalGet = tx.store.get;
        tx.store.get = async (...keys) => {
          if (firstRead) { firstRead = false; started.resolve(); await gate.promise; }
          return originalGet(...keys);
        };
        return tx;
      };
      const ctx = { db, session: { user: { id: 214 }, sessionVersion: 1 }, api: {
        post: async (_url, _payload, config) => {
          if (config._authSession.owner !== ctx.session.user.id || config._authSession.version !== ctx.session.sessionVersion) {
            const error = new Error('Session changed'); error.code = 'ERR_CANCELED'; throw error;
          }
          throw new Error('Should not send under a changed account');
        },
      } };
      const hook = await loadHook(ctx);
      net.onLine = true;
      const pending = hook.saveLogWithFallback('2026-10-01', { weight_kg: 81 });
      await started.promise;
      ctx.session = { user: { id: 300 }, sessionVersion: 2 };
      gate.resolve();
      let error;
      try { await pending; } catch (e) { error = e; }
      ck('a canceled account-bound request is surfaced instead of queued', error?.code === 'ERR_CANCELED' && db.rows.size === 0, error?.message);
    }
    {
      // 16 Oct 2026: a stalled IndexedDB (iOS Safari, a blocked upgrade) held
      // every save of the day forever. Now: wait ENQUEUE_TIMEOUT_MS, then post.
      const db = memDB(), posted = [];
      const ctx = { db, stall: true, session: { user: { id: 214 }, sessionVersion: 1 },
        api: { post: async (url, payload) => { posted.push(payload); return { data: { saved_at: '2026-10-16T00:00:00Z' } }; } } };
      const hook = await loadHook(ctx);
      net.onLine = true;
      const t0 = Date.now();
      // A hang must fail the check, not let node exit quietly with nothing pending.
      const res = await Promise.race([hook.saveLogWithFallback('2026-10-01', { water_ml: 500 }), new Promise(r => setTimeout(() => r({ hung: true }), 8000))]);
      const took = Date.now() - t0;
      ck('a stalled offline store does not hold the save: it posts directly after the time limit', res.queued === false && posted.length === 1 && posted[0].water_ml === 500 && took >= hook.ENQUEUE_TIMEOUT_MS - 50 && took < hook.ENQUEUE_TIMEOUT_MS + 2000, { took, posted: posted.length });
    }
    {
      const db = memDB();
      const ctx = { db, session: { user: { id: 214 }, sessionVersion: 1 }, storageError: new Error('QuotaExceededError'),
        api: { post: async () => ({ data: { saved_at: '2026-10-13T00:00:00Z' } }) } };
      const hook = await loadHook(ctx);
      net.onLine = true;
      ck('unavailable offline storage does not block a successful online save', (await hook.saveLogWithFallback('2026-10-01', {})).queued === false);
      net.onLine = false;
      let error;
      try { await hook.saveLogWithFallback('2026-10-01', {}); } catch (e) { error = e; }
      ck('storage failure while offline is a visible save failure, never success', /offline storage is unavailable/.test(error?.message || '') && db.rows.size === 0);
    }
    {
      const db = memDB();
      const ctx = { db, session: { user: { id: 214 }, sessionVersion: 1 },
        api: { post: async () => { throw new Error('Network Error'); } } };
      const hook = await loadHook(ctx);
      net.onLine = true;
      const saved = await hook.saveLogWithFallback('2026-10-01', { water_ml: 750 });
      ck('false-positive navigator.onLine still queues a failed network request', saved.queued === true && db.rows.get('log:214:2026-10-01')?.log.water_ml === 750);
      const rejected = new Error('Validation failed'); rejected.response = { status: 400 };
      ctx.api.post = async () => { throw rejected; };
      let error;
      try { await hook.saveLogWithFallback('2026-10-02', {}); } catch (e) { error = e; }
      ck('validation rejection is shown and never parked in the offline queue', error === rejected && !db.rows.has('log:214:2026-10-02'));
    }
    {
      const db = memDB(), server = receiptServer();
      let first = true;
      const ctx = { db, session: { user: { id: 214 }, sessionVersion: 1 }, api: {
        post: async (url, payload) => {
          const result = await server.post(url.split('/').at(-1), payload);
          if (first) { first = false; throw new Error('Commit succeeded; direct response timed out'); }
          return result;
        },
      } };
      const hook = await loadHook(ctx), base = server.row.saved_at;
      net.onLine = true;
      const firstSave = await hook.saveLogWithFallback('2026-10-01', { base_saved_at: base, base_food_ids: [], weight_kg: 81, water_ml: 750, food_items: [] });
      net.onLine = false;
      await hook.saveLogWithFallback('2026-10-01', { base_saved_at: base, base_food_ids: [], base_client_write: firstSave.write, weight_kg: 80.5, water_ml: 1000, food_items: [] });
      net.onLine = true;
      await hook.syncOfflineQueue();
      ck('a direct commit with lost response keeps its durable receipt identity in the fallback queue', firstSave.queued === true && server.receipts.size === 1);
      ck('newer offline changes survive a timed-out DIRECT commit and reconnect', server.row.water_ml === 1000 && server.row.weight_kg === 80.5 && db.rows.size === 0, server.row);
    }
    {
      const db = memDB(), server = receiptServer();
      let first = true, requests = 0;
      const ctx = { db, storageError: new Error('Storage disabled'), session: { user: { id: 214 }, sessionVersion: 1 }, api: {
        post: async (url, payload) => {
          requests++;
          const result = await server.post(url.split('/').at(-1), payload);
          if (first) { first = false; throw new Error('Committed but timed out'); }
          return result;
        },
      } };
      const hook = await loadHook(ctx), payload = { base_saved_at: server.row.saved_at, base_fields: { water_ml: 500 }, water_ml: 750, weight_kg: 81, food_items: [] };
      net.onLine = true;
      let error;
      try { await hook.saveLogWithFallback('2026-10-01', payload); } catch (caught) { error = caught; }
      ck('storage-disabled uncertain commit surfaces explicit guidance instead of false queue success', error?.code === 'SAVE_UNCERTAIN' && db.rows.size === 0);
      try { await hook.saveLogWithFallback('2026-10-01', { ...payload, water_ml: 1000 }); } catch (caught) { error = caught; }
      ck('changing an uncertain storage-disabled save cannot silently create a fresh request identity', error?.code === 'SAVE_UNCERTAIN' && requests === 1 && server.row.water_ml === 750);
      const retry = await hook.saveLogWithFallback('2026-10-01', payload);
      ck('identical storage-disabled retry reuses the in-memory receipt without adding water twice', retry.data.idempotent && requests === 2 && server.row.water_ml === 750 && server.receipts.size === 1);
    }
    {
      const db = memDB(); let requests = 0;
      const ctx = { db, session: { user: { id: 214 }, sessionVersion: 1 }, api: { post: async () => { requests++; return { data: {} }; } } };
      const hook = await loadHook(ctx);
      net.onLine = false;
      await hook.saveLogWithFallback('2026-10-01', { water_ml: 1000, weight_kg: 81 });
      let conflict;
      try { await hook.saveLogWithFallback('2026-10-01', { water_ml: 500, weight_kg: 80.5 }); } catch (error) { conflict = error; }
      ck('two offline tabs keep the first pending day and reject the unrelated stale draft visibly',
        conflict?.code === 'QUEUE_CONFLICT' && /still on screen/.test(conflict.message) && requests === 0 && db.rows.get('log:214:2026-10-01').log.water_ml === 1000);
      net.onLine = true;
      try { await hook.saveLogWithFallback('2026-10-01', { water_ml: 500, weight_kg: 80.5 }); } catch (error) { conflict = error; }
      ck('online fallback cannot bypass an unrelated pending-queue conflict', conflict?.code === 'QUEUE_CONFLICT' && requests === 0);
    }
  } finally {
    delete globalThis.__p0OfflineHook;
    if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore);
    else delete globalThis.navigator;
  }

  // ── 7. Entries from before owner-tagging ────────────────────────────────────
  console.log('\nOwnerless entries from the old queue');
  {
    const t = setup();
    const legacy = { key: 'log:2026-09-30', date: '2026-09-30', log: { weight_kg: 81 }, queuedAt: 5 };
    t.db.rows.set(legacy.key, legacy);
    t.session.user = 300;
    await t.q.sync();
    await t.q.retryNow();
    ck('an ownerless entry is never sent by a sync', t.server.saved.length === 0);
    let st = await t.q.status();
    ck('it is offered to the signed-in member, not counted as theirs', st.unclaimed === 1 && st.count === 0 && st.unclaimedDates[0] === '2026-09-30', st);
    await t.q.dismissLegacy();
    st = await t.q.status();
    ck('"Not mine" stops asking that member', st.unclaimed === 0);
    ck('"Not mine" keeps the entry on the device', t.db.rows.has('log:2026-09-30') && t.server.saved.length === 0);
    t.session.user = 214;
    st = await t.q.status();
    ck('the next member is still asked', st.unclaimed === 1);
    await t.q.claimLegacy();
    ck('"Mine" sends it as the member who claimed it', t.server.saved.length === 1 && t.server.saved[0].as === 214 && t.server.saved[0].log.weight_kg === 81, t.server.saved);
    ck('and clears it from the device', t.db.rows.size === 0);
  }
  {
    const t = setup();
    t.db.rows.set('log:2026-09-30', { key: 'log:2026-09-30', date: '2026-09-30', log: { v: 'legacy' }, queuedAt: 5 });
    t.session.user = 214;
    await t.q.enqueue('2026-09-30', { v: 'newer' });
    await t.q.claimLegacy();
    ck("claiming never replaces the member's newer copy of that day", t.server.saved.length === 1 && t.server.saved[0].log.v === 'newer', t.server.saved);
    ck('and leaves nothing behind', t.db.rows.size === 0);
  }
  {
    const t = setup();
    t.db.rows.set('log:2026-09-30', { key: 'log:2026-09-30', date: '2026-09-30', log: {}, queuedAt: 5 });
    await t.q.claimLegacy();
    ck('nobody signed in: claiming does nothing', t.db.rows.size === 1 && t.server.saved.length === 0);
  }

  // ── 8. The wiring around the core ───────────────────────────────────────────
  console.log('\nHook wiring (source contracts)');
  {
    const hook = fs.readFileSync(path.join(__dirname, '../../client/src/hooks/useOfflineQueue.js'), 'utf8');
    ck('the hook builds its queue from the tested core', /createQueue\(\{/.test(hook) && /from '\.\.\/utils\/offlineQueueCore'/.test(hook));
    ck('the owner comes from the signed-in member', /getOwner:\s*currentOwner/.test(hook) && /useAuthStore\.getState\(\)\.user\?\.id/.test(hook));
    ck('no ownerless key is written any more', !/key:\s*`log:\$\{date\}`/.test(hook));
    ck('sync wiring is installed once however many components mount it', /mounts === 1/.test(hook) && /mounts === 0/.test(hook));
    ck('a cross-tab lock is used where the browser has one', /navigator\.locks|locks\.request/.test(hook) && /ifAvailable:\s*true/.test(hook));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
