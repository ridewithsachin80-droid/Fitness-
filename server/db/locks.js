/**
 * db/locks.js — one writer at a time per member.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A member's day (one daily_logs row) has several writers: the app's own save,
 * voice logging, the offline queue. Each of them READS the row, changes it in
 * JavaScript and WRITES the whole thing back. Two of those running at the same
 * moment both read the old row, and the second write silently erases the
 * first — the audit reproduced it with two voice logs sent together.
 *
 * The same shape causes duplicates: "is this note already there? no → insert"
 * run twice at once (a double tap, a retry after a timeout) inserts twice.
 *
 * withMemberLock runs a function inside ONE transaction that holds a Postgres
 * advisory lock keyed on the member. A second caller for the same member waits
 * until the first has committed, and then sees its work. Different members
 * never wait on each other. The lock is released by COMMIT/ROLLBACK, so it
 * cannot be left behind by a crash.
 *
 * RULE FOR CALLERS: inside `fn`, use ONLY the `db` handed to you. The pool has
 * three connections; a function that holds one and asks the pool for another
 * can starve itself under load. Do reads that don't need the lock before
 * calling this, and side effects (push, sockets) after it returns.
 */
const pool = require('./pool');

const MEMBER_NS = 7101;   // arbitrary namespace so these never collide with any other advisory lock

async function withMemberLock(memberId, fn) {
  const id = parseInt(memberId, 10);
  if (!Number.isInteger(id)) throw Object.assign(new Error('Bad member id'), { status: 400 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [MEMBER_NS, id]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withMemberLock, MEMBER_NS };
