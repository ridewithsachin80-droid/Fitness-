/**
 * services/protocolRuleSwitch.js — Fixes-3k.1 (6 Nov 2026).
 *
 * Fixes-3k gave members created from 3k on the new protocol rule (protocol_default_none = TRUE: no supplements or
 * apple cider vinegar until the coach adds them) and kept every existing member on the old one (NULL). Sachin, 6 Nov:
 * "Change all are test members" — every member on the test site is a test member, so move them all to the new rule.
 *
 * ONE TIME, TEST SERVER ONLY:
 *  - runs only where Railway reports the git branch "test" (RAILWAY_GIT_BRANCH). Stricter than the voice fallback
 *    switch on purpose (QA review of 3k.1): this is a one-shot data change with nobody acting, so there is NO
 *    fallback variable; a deploy with no branch reported (CLI, image, manual) never runs it, and main never does;
 *  - once per database, recorded in `migrations` under MIGRATION, under an advisory lock (two boots at once: one runs);
 *  - every member (role 'patient') whose profile row says NULL → TRUE; a member with no profile row gets one with TRUE;
 *  - each member moved is written to protocol_rule_switch_log, so the switch can be undone exactly with UNDO_SQL
 *    below (run in one transaction): moved rows back to NULL; rows the switch created deleted (a member with no row
 *    had the old meaning). A created row the coach has edited since would lose those edits: check updated data first.
 * Coach selections (protocol_acv / protocol_supplements lists) and the coach's own items are not touched: a member
 * whose coach chose items keeps exactly those; only "never chosen" now means none.
 */
const MIGRATION = 'protocol_rule_all_new_test_v1';

/** True only on the Railway service that deploys the test branch. */
const onTestBranch = () => process.env.RAILWAY_GIT_BRANCH === 'test';

/** The exact undo, in order, inside one transaction. */
const UNDO_SQL = [
  `UPDATE patient_profiles SET protocol_default_none = NULL
    WHERE user_id IN (SELECT user_id FROM protocol_rule_switch_log WHERE migration = '${MIGRATION}' AND NOT created_row)`,
  `DELETE FROM patient_profiles
    WHERE user_id IN (SELECT user_id FROM protocol_rule_switch_log WHERE migration = '${MIGRATION}' AND created_row)`,
];

async function switchTestMembersToNewRule(db, { onTestServer = onTestBranch() } = {}) {
  if (!onTestServer) return { ran: false, why: 'not the test server' };
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [MIGRATION]);
    const done = await client.query('SELECT 1 FROM migrations WHERE name = $1', [MIGRATION]);
    if (done.rows.length) { await client.query('COMMIT'); return { ran: false, why: 'already done' }; }
    const created = await client.query(
      `INSERT INTO patient_profiles (user_id, protocol_default_none)
       SELECT u.id, TRUE FROM users u
        WHERE u.role = 'patient' AND NOT EXISTS (SELECT 1 FROM patient_profiles pp WHERE pp.user_id = u.id)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING user_id`);
    const moved = await client.query(
      `UPDATE patient_profiles pp SET protocol_default_none = TRUE
         FROM users u
        WHERE u.id = pp.user_id AND u.role = 'patient' AND pp.protocol_default_none IS NULL
       RETURNING pp.user_id`);
    const log = (ids, createdRow) => ids.length && client.query(
      `INSERT INTO protocol_rule_switch_log (user_id, migration, created_row)
       SELECT unnest($1::int[]), $2, $3 ON CONFLICT DO NOTHING`, [ids, MIGRATION, createdRow]);
    await log(created.rows.map(r => r.user_id), true);
    await log(moved.rows.map(r => r.user_id), false);
    await client.query('INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [MIGRATION]);
    await client.query('COMMIT');
    return { ran: true, moved: moved.rowCount, createdRows: created.rowCount };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

module.exports = { switchTestMembersToNewRule, onTestBranch, UNDO_SQL, MIGRATION };
