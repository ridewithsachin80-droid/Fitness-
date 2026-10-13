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

import { baseOf } from './logSync';

export const MAX_ATTEMPTS   = 12;
export const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

export const ownerKey = (ownerId, date) => `log:${ownerId}:${date}`;
const isLog = (item) => item.kind !== 'stream';
export const isLegacy = (item) => isLog(item) && item.ownerId == null;
export const withWriteMetadata = (log, write) => write
  ? { ...log, client_stream_id: write.streamId, client_sequence: write.sequence }
  : log;
const sameWrite = (a, b) => a?.write && b?.write
  && a.write.streamId === b.write.streamId && a.write.sequence === b.write.sequence;
const followsWrite = (log, write) => write && log?.base_client_write?.streamId === write.streamId
  && log.base_client_write.sequence === write.sequence;

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

  async function finishUpload(db, item, response) {
    const tx = db.transaction(store, 'readwrite');
    const current = await tx.store.get(item.key);
    if (current && (current.rev === item.rev || sameWrite(current, item))) {
      await tx.store.delete(item.key);
    } else if (current && sameId(current.ownerId, item.ownerId)
      && response?.saved_at && !response.merged && !response.merged_live && !response.superseded
      && followsWrite(current.log, item.write)
      && (current.log.base_saved_at ?? null) === (item.log.base_saved_at ?? null)) {
      // The member edited again during OUR upload. Its confirmed server copy
      // is now the newer edit's base; otherwise our own commit is mistaken
      // for an external conflict and the next replay discards water/weight.
      // A true conflict merge keeps the original base and existing policy.
      await tx.store.put({ ...current, rev: newRev(now()), log: { ...current.log,
        base_saved_at: response.saved_at,
        base_food_ids: (response.food_items || []).map(i => i?.id).filter(Boolean),
        base_fields: baseOf(response),
      } });
    }
    await tx.done;
  }

  async function enqueue(date, log, ownerId = getOwner()) {
    if (ownerId == null) throw new Error('Cannot queue a log without a signed-in member.');
    const db = await getDB();
    // This counter survives queue draining and is shared by tabs. Allocating
    // it in the same transaction as the payload prevents duplicate sequence
    // numbers and lets the server recognize an older timed-out write.
    const tx = db.transaction(store, 'readwrite');
    const key = ownerKey(ownerId, date), streamKey = `stream:${ownerId}:${date}`;
    const previous = await tx.store.get(key);
    if (previous && !followsWrite(log, previous.write)) {
      await tx.done;
      const error = new Error('Another tab has a pending edit for this day. Your change is still on screen. Sync the other tab first, then try saving again.');
      error.code = 'QUEUE_CONFLICT';
      throw error;
    }
    const stream = await tx.store.get(streamKey);
    const write = { streamId: stream?.streamId || newRev(now()), sequence: (stream?.sequence || 0) + 1 };
    const item = {
      key: ownerKey(ownerId, date), ownerId, date, log,
      queuedAt: now(), rev: newRev(now()), write,
    };
    await tx.store.put({ key: streamKey, kind: 'stream', ...write });
    await tx.store.put(item);
    await tx.done;
    onChange();
    return { ...item, previous };
  }

  /** An invalid/canceled direct request was never accepted. Restore its prior
   *  queue copy only while this is still the same logical edit; a newer edit
   *  made meanwhile must remain untouched. */
  async function restore(prepared) {
    if (!prepared) return;
    const db = await getDB(), tx = db.transaction(store, 'readwrite');
    const current = await tx.store.get(prepared.key);
    if (current && (current.rev === prepared.rev || sameWrite(current, prepared))) {
      if (prepared.previous) await tx.store.put(prepared.previous);
      else await tx.store.delete(prepared.key);
    }
    await tx.done;
    onChange();
  }

  /** Restore the member's pending day when reopening the app offline. A
   *  later edit must start from this copy, not an empty/stale server day. */
  async function read(date, ownerId = getOwner()) {
    if (ownerId == null) return null;
    const db = await getDB();
    const key = ownerKey(ownerId, date);
    let item = await db.get(store, key);
    if (item && sameId(item.ownerId, ownerId) && !item.write) {
      // Migrate an older owner-tagged queue only when that actual payload is
      // read. Its next edit can then carry an explicit parent identity too.
      const tx = db.transaction(store, 'readwrite');
      item = await tx.store.get(key);
      if (item && !item.write) {
        const streamKey = `stream:${ownerId}:${date}`, stream = await tx.store.get(streamKey);
        const write = { streamId: stream?.streamId || newRev(now()), sequence: (stream?.sequence || 0) + 1 };
        item = { ...item, write };
        await tx.store.put({ key: streamKey, kind: 'stream', ...write });
        await tx.store.put(item);
      }
      await tx.done;
    }
    return item && sameId(item.ownerId, ownerId)
      ? { ...item.log, ...(item.write ? { base_client_write: item.write } : {}) } : null;
  }

  /** Capture the queued revision BEFORE a direct request starts. Storage
   *  failure must not prevent an otherwise successful online save. */
  async function revision(date, ownerId = getOwner()) {
    if (ownerId == null) return null;
    try {
      const db = await getDB();
      return (await db.get(store, ownerKey(ownerId, date)))?.rev ?? null;
    } catch (_) { return null; }
  }

  /** A direct save supersedes only the queued copy it knew about when it
   *  started. A newer offline edit made while that request was in flight must
   *  survive even if the older request finishes successfully. */
  async function supersede(date, ownerId = getOwner(), rev, sentLog, response, write) {
    if (ownerId == null || (rev == null && !sentLog)) return;
    try {
      const db  = await getDB();
      const key = ownerKey(ownerId, date);
      if (sentLog && response) {
        await finishUpload(db, { key, ownerId, rev, log: sentLog, write }, response);
        onChange();
      } else if (await ifSameRev(db, key, rev, (s) => s.delete(key))) onChange();
    } catch (_) { /* never fail a successful save over queue housekeeping */ }
  }

  async function pass() {
    const owner = getOwner();
    if (owner == null) return { sent: 0, skipped: 'no-owner' };

    const db    = await getDB();
    const items = (await db.getAll(store))
      .filter(i => isLog(i) && sameId(i.ownerId, owner) && (i.attempts || 0) < MAX_ATTEMPTS);

    let sent = 0, stopped = null;
    for (const item of items) {
      // A prior upload can take seconds. Another save may remove or replace
      // a later item from this snapshot while we wait; never send that stale
      // copy merely because it was present at the start of the pass.
      const current = await db.get(store, item.key);
      if (!current || current.rev !== item.rev) continue;
      if (!item.write) {
        // Entries saved by the previous app version need their receipt before
        // the first network attempt too, not only when the day is reopened.
        await read(item.date, owner);
        const upgraded = await db.get(store, item.key);
        if (!upgraded || upgraded.rev !== item.rev) continue;
        item.write = upgraded.write;
      }
      // Signed out, or someone else signed in, while this pass was running.
      if (!sameId(getOwner(), owner)) { stopped = 'owner-changed'; break; }
      try {
        // A replay says so: the server then checks whether the day changed
        // since this copy was made, and merges instead of overwriting.
        const res = await post(item.date, { ...withWriteMetadata(item.log, item.write), offline_replay: true });
        await finishUpload(db, item, res?.data);
        if (res?.data?.merged && sameId(getOwner(), owner)) {
          try { onMerged({ ownerId: owner, date: item.date, keptServer: res.data.kept_server || [] }); } catch (_) {}
        }
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
    const mine  = all.filter(i => isLog(i) && sameId(i.ownerId, owner));
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

  return { enqueue, restore, read, revision, supersede, sync, retryNow, status, claimLegacy, dismissLegacy };
}
