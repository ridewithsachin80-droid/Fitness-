/**
 * utils/offlineQueueCore.js — the offline log queue's rules, with storage and
 * network handed in so a Node test can drive the REAL logic.
 *
 * WHAT THIS FIXES (Phase 0)
 * -------------------------
 * 1. Entries used to be keyed `log:${date}` with no member on them, and were
 *    replayed with whoever was signed in. On a shared phone: member A logs
 *    offline, signs out, member B signs in — A's day was saved onto B.
 *    Every entry now carries `ownerId` and is only ever sent for that member.
 *
 * 2. Two sync passes could run at once (the hook was mounted twice) and both
 *    read the same entry. And an upload that finished late deleted whatever
 *    sat at that key — including a NEWER edit made while it was in flight.
 *    Now: one pass at a time, and every entry has a `rev`; an upload may only
 *    remove or mark the exact revision it sent.
 *
 * 3. Entries queued before this change have no owner. They are never sent on
 *    a guess. The signed-in member is asked, once, whether they are theirs.
 */

export const MAX_ATTEMPTS   = 12;
export const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

export const ownerKey = (ownerId, date) => `log:${ownerId}:${date}`;
export const isLegacy = (item) => item.ownerId == null;

let seq = 0;
export function newRev(now = Date.now()) {
  seq += 1;
  return `${now}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A 401/403 means the session is the problem. Resending cannot help, and it
 *  must not count against the entry's retries. */
function isAuthFailure(err) {
  const s = err && err.response && err.response.status;
  return s === 401 || s === 403;
}

/**
 * @param {object}   deps
 * @param {Function} deps.getDB     async () => idb database
 * @param {string}   deps.store     object store name
 * @param {Function} deps.post      async (date, log) => server response
 * @param {Function} deps.getOwner  () => current member id, or null
 * @param {Function} [deps.now]
 * @param {Function} [deps.onChange] called after the queue changes
 * @param {Function} [deps.lock]    (fn) => runs fn if no other tab holds the
 *                                  lock; resolves to its result, or to
 *                                  { skipped: 'locked' }
 */
export function createQueue({ getDB, store, post, getOwner, now = Date.now, onChange = () => {}, lock = (fn) => fn(), onMerged = () => {} }) {
  let running = null;

  /** Act on an entry only if it is still the revision we read. One
   *  transaction, so nothing can slip in between the check and the write. */
  async function ifSameRev(db, key, rev, act) {
    const tx  = db.transaction(store, 'readwrite');
    const cur = await tx.store.get(key);
    let did = false;
    if (cur && cur.rev === rev) { await act(tx.store, cur); did = true; }
    await tx.done;
    return did;
  }

  async function enqueue(date, log, ownerId = getOwner()) {
    if (ownerId == null) throw new Error('Cannot queue a log without a signed-in member.');
    const db = await getDB();
    await db.put(store, {
      key: ownerKey(ownerId, date), ownerId, date, log,
      queuedAt: now(), rev: newRev(now()),
    });
    onChange();
  }

  /** A save that reached the server directly makes any queued copy of that
   *  day stale — replaying it later would undo the newer save. */
  async function supersede(date, ownerId = getOwner()) {
    if (ownerId == null) return;
    try {
      const db  = await getDB();
      const key = ownerKey(ownerId, date);
      if (await db.get(store, key)) { await db.delete(store, key); onChange(); }
    } catch (_) { /* never fail a successful save over queue housekeeping */ }
  }

  async function pass() {
    const owner = getOwner();
    if (owner == null) return { sent: 0, skipped: 'no-owner' };

    const db    = await getDB();
    const items = (await db.getAll(store))
      .filter(i => sameId(i.ownerId, owner) && (i.attempts || 0) < MAX_ATTEMPTS);

    let sent = 0, stopped = null;
    for (const item of items) {
      // Signed out, or someone else signed in, while this pass was running.
      if (!sameId(getOwner(), owner)) { stopped = 'owner-changed'; break; }
      try {
        // A replay says so: the server then checks whether the day changed
        // since this copy was made, and merges instead of overwriting.
        const res = await post(item.date, { ...item.log, offline_replay: true });
        await ifSameRev(db, item.key, item.rev, (s) => s.delete(item.key));
        if (res?.data?.merged) { try { onMerged({ date: item.date, keptServer: res.data.kept_server || [] }); } catch (_) {} }
        sent += 1;
      } catch (err) {
        if (isAuthFailure(err)) { stopped = 'auth'; break; }
        await ifSameRev(db, item.key, item.rev, (s, cur) =>
          s.put({ ...cur, attempts: (cur.attempts || 0) + 1, lastError: err.message }));
      }
    }
    onChange();
    return { sent, stopped };
  }

  /** One pass at a time in this tab; `lock` extends that across tabs. */
  function sync() {
    if (running) return running;
    running = Promise.resolve()
      .then(() => lock(pass))
      .finally(() => { running = null; });
    return running;
  }

  async function retryNow() {
    const owner = getOwner();
    if (owner != null) {
      const db = await getDB();
      for (const item of await db.getAll(store)) {
        if (sameId(item.ownerId, owner) && item.attempts) {
          await ifSameRev(db, item.key, item.rev, (s, cur) => s.put({ ...cur, attempts: 0 }));
        }
      }
    }
    return sync();
  }

  const legacyFor = (items, owner) =>
    items.filter(i => isLegacy(i) && !(i.dismissedBy || []).some(d => sameId(d, owner)));

  async function status() {
    const empty = { count: 0, stuck: false, exhausted: false, oldestDate: null, unclaimed: 0, unclaimedDates: [] };
    const owner = getOwner();
    if (owner == null) return empty;
    const db    = await getDB();
    const all   = await db.getAll(store);
    const mine  = all.filter(i => sameId(i.ownerId, owner));
    const loose = legacyFor(all, owner);
    const out   = { ...empty, unclaimed: loose.length, unclaimedDates: loose.map(i => i.date).sort() };
    if (!mine.length) return out;
    const oldest    = mine.reduce((a, b) => (a.queuedAt <= b.queuedAt ? a : b));
    const exhausted = mine.some(i => (i.attempts || 0) >= MAX_ATTEMPTS);
    return {
      ...out,
      count: mine.length,
      stuck: (now() - oldest.queuedAt > STUCK_AFTER_MS) || exhausted,
      exhausted,
      oldestDate: oldest.date,
    };
  }

  /** "These are mine." Moves ownerless entries under the signed-in member,
   *  then sends them. A day the member has since re-logged keeps the newer
   *  copy. */
  async function claimLegacy() {
    const owner = getOwner();
    if (owner == null) return { claimed: 0 };
    const db = await getDB();
    let claimed = 0;
    for (const item of legacyFor(await db.getAll(store), owner)) {
      const tx   = db.transaction(store, 'readwrite');
      const cur  = await tx.store.get(item.key);
      if (cur && isLegacy(cur)) {
        const key = ownerKey(owner, cur.date);
        if (!(await tx.store.get(key))) {
          await tx.store.put({ key, ownerId: owner, date: cur.date, log: cur.log,
            queuedAt: cur.queuedAt || now(), rev: newRev(now()) });
        }
        await tx.store.delete(item.key);
        claimed += 1;
      }
      await tx.done;
    }
    onChange();
    await sync();
    return { claimed };
  }

  /** "Not mine." Stops asking THIS member; the entry stays for its owner. */
  async function dismissLegacy() {
    const owner = getOwner();
    if (owner == null) return;
    const db = await getDB();
    for (const item of legacyFor(await db.getAll(store), owner)) {
      const tx  = db.transaction(store, 'readwrite');
      const cur = await tx.store.get(item.key);
      if (cur && isLegacy(cur)) {
        await tx.store.put({ ...cur, dismissedBy: [...(cur.dismissedBy || []), String(owner)] });
      }
      await tx.done;
    }
    onChange();
  }

  return { enqueue, supersede, sync, retryNow, status, claimLegacy, dismissLegacy };
}
