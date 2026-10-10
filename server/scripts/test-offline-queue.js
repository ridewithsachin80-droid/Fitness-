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

/** In-memory object store with the slice of the idb API the core uses. Every
 *  call yields, so passes can interleave the way they do in a browser. */
function memDB() {
  const rows = new Map();
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const ops = {
    get:    async (k) => { await tick(); return clone(rows.get(k)); },
    put:    async (v) => { await tick(); rows.set(v.key, clone(v)); },
    delete: async (k) => { await tick(); rows.delete(k); },
  };
  return {
    rows,
    get:    (_s, k) => ops.get(k),
    put:    (_s, v) => ops.put(v),
    delete: (_s, k) => ops.delete(k),
    getAll: async () => { await tick(); return [...rows.values()].map(clone); },
    // One "transaction" runs without yielding between its steps, which is the
    // guarantee IndexedDB gives a readwrite transaction on one store.
    transaction: () => ({
      store: {
        get:    async (k) => clone(rows.get(k)),
        put:    async (v) => { rows.set(v.key, clone(v)); },
        delete: async (k) => { rows.delete(k); },
      },
      done: Promise.resolve(),
    }),
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
    await t.q.enqueue('2026-10-01', { v: 'new' });          // member edits again
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
    await t.q.enqueue('2026-10-01', { v: 'new' });
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
    ck('server saves a day by upsert on (patient_id, log_date), so a resend cannot duplicate',
       /ON CONFLICT \(patient_id, log_date\) DO UPDATE/.test(route));
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
    await t.q.supersede('2026-10-01');
    await t.q.sync();
    ck('the stale queued copy is dropped, not replayed over the newer save', t.server.saved.length === 0 && t.db.rows.size === 0);
    t.session.user = 300;
    await t.q.enqueue('2026-10-01', { v: 'b' });
    t.session.user = 214;
    await t.q.supersede('2026-10-01');
    ck("superseding never touches another member's entry", t.db.rows.has('log:300:2026-10-01'));
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
