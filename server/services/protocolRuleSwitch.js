/**
 * services/protocolRuleSwitch.js — Fixes-3k.1 (6 Nov 2026), production added in Fixes-3k.2 (18 Nov 2026).
 *
 * Fixes-3k gave members created from 3k on the new protocol rule (protocol_default_none = TRUE: no supplements or
 * apple cider vinegar until the coach adds them) and kept every existing member on the old one (NULL).
 *  - Sachin, 6 Nov: "Change all are test members" → the TEST site moves everyone (3k.1, done on 6 Nov).
 *  - Sachin, 18 Nov: "there are real members but no supplements are taken as of now" → PRODUCTION moves everyone too,
 *    once, on the first start after the release (3k.2). Nobody loses anything real: nobody takes any.
 *
 * ONE TIME PER SITE:
 *  - runs only where Railway reports the git branch exactly "test" or exactly "main" (RAILWAY_GIT_BRANCH). No fallback
 *    variable: a deploy with no branch reported (CLI, image, manual) never runs it, nor does any other branch;
 *  - each site has its own record in `migrations` (MIGRATIONS below), so the test site, which already ran on 6 Nov
 *    under its name, never runs again; under an advisory lock (two boots at once: one runs);
 *  - every member (role 'patient') whose profile row says NULL → TRUE; a member with no profile row gets one with TRUE;
 *  - each member moved is written to protocol_rule_switch_log, so the switch can be undone exactly with undoSql(name)
 *    (run in one transaction): moved rows back to NULL; rows the switch created deleted (a member with no row had the
 *    old meaning). A created row the coach has edited since would lose those edits: check updated data first.
 * Coach selections (protocol_acv / protocol_supplements lists) and the coach's own items are not touched: a member
 * whose coach chose items keeps exactly those; only "never chosen" now means none.
 * RELEASE ORDER: back up the production database BEFORE the release; this runs on the first start.
 *
 * CATCH-UP (QA review of 3k.2): during a release the old version keeps serving for a few minutes, and after a Railway
 * rollback it serves again; it creates members with the old meaning (NULL). So once a site's switch is done, every
 * later call (each start, and once 15 minutes after start: startup.js) moves members CREATED AFTER the switch ran
 * (users.created_at >= the switch's run_at) who still say NULL, and logs them under the same record. Members created
 * before the switch, and members already in the log (moved once), are never touched again, so an undo stays undone.
 */
/** One record per site: the branch Railway reports → the name the switch is recorded under. */
const MIGRATIONS = Object.freeze({ test: 'protocol_rule_all_new_test_v1', main: 'protocol_rule_all_new_main_v1' });
const MIGRATION = MIGRATIONS.test;   // the 3k.1 name (kept for anything that imported it)

/** The record name for the branch this server deploys, or null where the switch must never run. */
const migrationForBranch = (branch = process.env.RAILWAY_GIT_BRANCH) =>
  (Object.prototype.hasOwnProperty.call(MIGRATIONS, branch) ? MIGRATIONS[branch] : null);

/** True only on the Railway service that deploys the test branch (3k.1; kept). */
const onTestBranch = () => process.env.RAILWAY_GIT_BRANCH === 'test';

/** The exact undo for one site's switch, in order, inside one transaction. */
const undoSql = (name) => {
  if (!Object.values(MIGRATIONS).includes(name)) throw new Error(`unknown switch record: ${name}`);
  return [
    `UPDATE patient_profiles SET protocol_default_none = NULL
      WHERE user_id IN (SELECT user_id FROM protocol_rule_switch_log WHERE migration = '${name}' AND NOT created_row)`,
    `DELETE FROM patient_profiles
      WHERE user_id IN (SELECT user_id FROM protocol_rule_switch_log WHERE migration = '${name}' AND created_row)`,
  ];
};
const UNDO_SQL = undoSql(MIGRATION);   // the test site's undo (3k.1)

/**
 * migration: the record name to run under (default: from the branch Railway reports). onTestServer (3k.1 tests):
 * true → the test site's name, false → never runs.
 */
async function switchMembersToNewRule(db, { migration = migrationForBranch(), onTestServer } = {}) {
  if (onTestServer === true) migration = MIGRATIONS.test;
  if (onTestServer === false) migration = null;
  if (!migration) return { ran: false, why: 'not the test or production server' };
  const MIGRATION = migration;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [MIGRATION]);
    const done = await client.query('SELECT run_at FROM migrations WHERE name = $1', [MIGRATION]);
    if (done.rows.length) {
      const since = done.rows[0].run_at;
      const lateRows = since ? await client.query(
        `INSERT INTO patient_profiles (user_id, protocol_default_none)
         SELECT u.id, TRUE FROM users u
          WHERE u.role = 'patient' AND u.created_at >= $1
            AND NOT EXISTS (SELECT 1 FROM patient_profiles pp WHERE pp.user_id = u.id)
            AND NOT EXISTS (SELECT 1 FROM protocol_rule_switch_log l WHERE l.user_id = u.id AND l.migration = $2)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING user_id`, [since, MIGRATION]) : { rows: [], rowCount: 0 };
      const late = since ? await client.query(
        `UPDATE patient_profiles pp SET protocol_default_none = TRUE
           FROM users u
          WHERE u.id = pp.user_id AND u.role = 'patient' AND pp.protocol_default_none IS NULL AND u.created_at >= $1
            AND NOT EXISTS (SELECT 1 FROM protocol_rule_switch_log l WHERE l.user_id = u.id AND l.migration = $2)
         RETURNING pp.user_id`, [since, MIGRATION]) : { rows: [], rowCount: 0 };
      const logLate = (ids, createdRow) => ids.length && client.query(
        `INSERT INTO protocol_rule_switch_log (user_id, migration, created_row)
         SELECT unnest($1::int[]), $2, $3 ON CONFLICT DO NOTHING`, [ids, MIGRATION, createdRow]);
      await logLate(lateRows.rows.map(r => r.user_id), true);
      await logLate(late.rows.map(r => r.user_id), false);
      await client.query('COMMIT');
      return { ran: false, why: 'already done', migration: MIGRATION, caughtUp: late.rowCount + lateRows.rowCount };
    }
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
    return { ran: true, migration: MIGRATION, moved: moved.rowCount, createdRows: created.rowCount };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

const switchTestMembersToNewRule = switchMembersToNewRule;   // 3k.1 name (startup.js and its tests)

module.exports = { switchMembersToNewRule, switchTestMembersToNewRule, migrationForBranch, onTestBranch, undoSql, UNDO_SQL, MIGRATION, MIGRATIONS };
