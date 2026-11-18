/**
 * scripts/test-protocol-rule-switch.mjs — Fixes-3k.1 (6 Nov 2026): on the TEST server, every existing member moves once
 * to the new protocol rule (no supplements or ACV until the coach adds them). Real Postgres, the real service.
 *
 * Runs on its OWN scratch database (the switch moves every member of a database; QA review of 3k.1).
 *
 *   [1] not the test server → nothing changes; the service's own guard needs RAILWAY_GIT_BRANCH=test exactly (main, no
 *       branch, or FITLIFE_TEST_SERVER=yes alone never run it);
 *   [2] the test server → NULL rows become TRUE, members without a profile row get one, coaches/admins untouched,
 *       coach selections and own items untouched, every member moved is logged (undo is exact);
 *   [3] once per database: a second boot changes nothing; two boots at the same moment → one switch;
 *   [4] after the switch, a member with no coach selection gets the new rule everywhere (score total, reminders);
 *   [5] a failure halfway rolls everything back; [6] the exact undo (UNDO_SQL) restores the database as it was.
 *   [7] Fixes-3k.2 (Sachin, 18 Nov): PRODUCTION (branch exactly "main") moves everyone too, once, under its own record,
 *       on a second scratch database standing for production; the undo for that record restores it exactly.
 * Changed in 3k.2 (listed in DELIVERY-FIXES-3k2.md): [1] no longer expects "main" to be refused (it now runs, [7]),
 * and the refusal reason reads "not the test or production server".
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) { console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1); }
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };

const { Client, Pool } = require('pg');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(HERE, '../db/schema.sql'), 'utf8');
const base = new URL(process.env.DATABASE_URL);
const NAME = `fitlife_prs_${process.pid}`;
const admin = new Client({ connectionString: Object.assign(new URL(base), { pathname: '/postgres' }).toString() });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${NAME}`); await admin.query(`CREATE DATABASE ${NAME}`);
const pool = new Pool({ connectionString: Object.assign(new URL(base), { pathname: '/' + NAME }).toString() });
await pool.query(SCHEMA);
// cronService reads the shared pool module: point it at the scratch database before it is loaded.
process.env.DATABASE_URL = Object.assign(new URL(base), { pathname: '/' + NAME }).toString();
const { switchTestMembersToNewRule, switchMembersToNewRule, migrationForBranch, onTestBranch, undoSql, UNDO_SQL, MIGRATION, MIGRATIONS } = require('../services/protocolRuleSwitch');
const made = [];
const NAME2 = `fitlife_prs2_${process.pid}`;
let pool2 = null;
try {
  const tag = String(Date.now()).slice(-7);
  const mk = async (n, role = 'patient') => { const id = (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [`PRS ${n}`, `64${tag}${n}`, role])).rows[0].id; made.push(id); return id; };
  const plain = await mk(1), chose = await mk(2), already = await mk(3), noRow = await mk(4), coach = await mk(5, 'monitor'), own = await mk(6), adminNoRow = await mk(8, 'admin');
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [plain]);                                           // old rule, nothing chosen
  await pool.query(`INSERT INTO patient_profiles (user_id, protocol_supplements, protocol_acv) VALUES ($1, '["d3","b12"]', '[]')`, [chose]);
  await pool.query(`INSERT INTO patient_profiles (user_id, protocol_default_none) VALUES ($1, TRUE)`, [already]);           // created after 3k
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [coach]);                                           // a coach with a stray row
  await pool.query(`INSERT INTO patient_profiles (user_id, custom_supplements) VALUES ($1, '[{"id":"cx1","label":"Iron 60 mg"}]')`, [own]);
  const row = async (id) => (await pool.query(`SELECT protocol_default_none AS f, protocol_supplements AS s, protocol_acv AS a, custom_supplements AS c FROM patient_profiles WHERE user_id=$1`, [id])).rows[0];
  const flags = async () => Object.fromEntries(await Promise.all([plain, chose, already, noRow, coach, own, adminNoRow].map(async id => [id, (await row(id))?.f ?? (await row(id) ? null : 'no row')])));
  const snapshot = async () => JSON.stringify((await pool.query(`SELECT * FROM patient_profiles ORDER BY user_id`)).rows);

  console.log('\n[1] not the test server');
  const before = await flags();
  let r = await switchTestMembersToNewRule(pool, { onTestServer: false });
  ck('not the test server → it does not run', r.ran === false && r.why === 'not the test or production server', r);
  ck('…and nothing changed', JSON.stringify(await flags()) === JSON.stringify(before), [before, await flags()]);
  { const b0 = process.env.RAILWAY_GIT_BRANCH; process.env.RAILWAY_GIT_BRANCH = 'main';
    try { r = await switchMembersToNewRule(pool, { onTestServer: false }); } finally { if (b0 === undefined) delete process.env.RAILWAY_GIT_BRANCH; else process.env.RAILWAY_GIT_BRANCH = b0; }
    ck('…even on branch "main", an explicit "not the test server" wins', r.ran === false && JSON.stringify(await flags()) === JSON.stringify(before), r); }
  const env = { b: process.env.RAILWAY_GIT_BRANCH, t: process.env.FITLIFE_TEST_SERVER };
  const tryWith = async (branch, testVar) => {
    if (branch == null) delete process.env.RAILWAY_GIT_BRANCH; else process.env.RAILWAY_GIT_BRANCH = branch;
    if (testVar == null) delete process.env.FITLIFE_TEST_SERVER; else process.env.FITLIFE_TEST_SERVER = testVar;
    return { guard: onTestBranch(), r: await switchTestMembersToNewRule(pool) };   // the service's OWN default guard
  };
  const noBranch = await tryWith(null, 'yes'), nothing = await tryWith(null, null), prod = await tryWith('production', null), master = await tryWith('master', 'yes');
  const near = [await tryWith('Test', null), await tryWith('testing', null), await tryWith('test ', null), await tryWith('main-test', null),
    await tryWith('Main', null), await tryWith('main ', null), await tryWith('constructor', null), await tryWith('__proto__', null)];
  ck('the service itself does not run with no branch reported (even with FITLIFE_TEST_SERVER=yes), with nothing set, or on another branch (production, master)',
    [noBranch, nothing, prod, master].every(x => x.guard === false && x.r.ran === false) && (await flags())[plain] === null, [noBranch, nothing, prod, master]);
  ck('…nor on names that only look like "test" or "main" (Test, testing, "test ", main-test, Main, "main ", constructor, __proto__)', near.every(x => x.guard === false && x.r.ran === false) && (await flags())[plain] === null, near);
  ck('the record per site: "test" → the test record, "main" → the production record, anything else → none',
    migrationForBranch('test') === MIGRATIONS.test && migrationForBranch('main') === MIGRATIONS.main && MIGRATIONS.test !== MIGRATIONS.main
      && [undefined, '', 'Main', 'master', 'production', 'toString', 'hasOwnProperty'].every(b => migrationForBranch(b) === null));
  process.env.RAILWAY_GIT_BRANCH = 'test'; delete process.env.FITLIFE_TEST_SERVER;
  ck('…and its guard says yes only for branch "test" (checked without running it here)', onTestBranch() === true);
  delete process.env.RAILWAY_GIT_BRANCH; delete process.env.FITLIFE_TEST_SERVER;
  if (env.b !== undefined) process.env.RAILWAY_GIT_BRANCH = env.b; if (env.t !== undefined) process.env.FITLIFE_TEST_SERVER = env.t;
  console.log('\n[2] the test server');
  r = await switchTestMembersToNewRule(pool, { onTestServer: true });
  ck(`it runs once: ${r.moved} rows moved, ${r.createdRows} rows created (here at least 3 and 1)`, r.ran === true && r.moved >= 3 && r.createdRows >= 1, r);
  const after = await flags();
  ck('every member is on the new rule (old NULL → TRUE; already TRUE stays TRUE)', [plain, chose, already, own].every(id => after[id] === true), after);
  ck('a member with no profile row gets one, on the new rule', after[noRow] === true, after[noRow]);
  ck('a coach\'s row is not touched, and an admin with no row gets none', after[coach] === null && after[adminNoRow] === 'no row', [after[coach], after[adminNoRow]]);
  const c = await row(chose), o = await row(own);
  ck('coach selections and own items are untouched (d3, b12 / empty ACV / Iron)', JSON.stringify(c.s) === '["d3","b12"]' && JSON.stringify(c.a) === '[]' && o.c?.[0]?.id === 'cx1', [c.s, c.a, o.c]);
  const log = (await pool.query(`SELECT user_id, created_row FROM protocol_rule_switch_log WHERE migration=$1 AND user_id = ANY($2)`, [MIGRATION, made])).rows;
  const logged = Object.fromEntries(log.map(x => [x.user_id, x.created_row]));
  ck('the log names exactly the members it moved (not the one already TRUE, not the coach); the created row is marked',
    logged[plain] === false && logged[chose] === false && logged[own] === false && logged[noRow] === true && !(already in logged) && !(coach in logged), logged);
  ck('the switch is recorded in migrations', (await pool.query('SELECT 1 FROM migrations WHERE name=$1', [MIGRATION])).rows.length === 1);

  console.log('\n[3] once per database');
  const late = await mk(7);
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [late]);
  r = await switchTestMembersToNewRule(pool, { onTestServer: true });
  // Changed in 3k.2 (QA review): a member created AFTER the switch with the old meaning (as the old version creates
  // them during a release) is now moved on the next start ("catch-up"); the switch itself still does not re-run.
  ck('a second boot does not re-run the switch (already done); it moves only the member created afterwards with the old meaning',
    r.ran === false && r.why === 'already done' && r.caughtUp === 1 && (await row(late)).f === true, [r, (await row(late)).f]);
  await pool.query('DELETE FROM migrations WHERE name = $1', [MIGRATION]);
  const both = await Promise.all([switchTestMembersToNewRule(pool, { onTestServer: true }), switchTestMembersToNewRule(pool, { onTestServer: true })]);
  ck('two boots at the same moment → exactly one runs', both.filter(x => x.ran).length === 1 && both.some(x => x.why === 'already done'), both);
  ck('…and the late member is now on the new rule too, logged once', (await row(late)).f === true
    && (await pool.query(`SELECT count(*)::int AS n FROM protocol_rule_switch_log WHERE migration=$1 AND user_id=$2`, [MIGRATION, late])).rows[0].n === 1);

  console.log('\n[4] after the switch, the new rule applies');
  const { protocolTotalFor } = require('../services/compliance');
  const full = async (id) => (await pool.query(`SELECT * FROM patient_profiles WHERE user_id=$1`, [id])).rows[0];
  ck('score total: 6 for a member with nothing chosen (was 16); the chosen member: 6 + 2 + 0 = 8', protocolTotalFor(await full(plain)) === 6 && protocolTotalFor(await full(chose)) === 8, [protocolTotalFor(await full(plain)), protocolTotalFor(await full(chose))]);
  const { getSchedulesForTime } = require('../services/cronService');
  const at = '03:41';
  const rs = (await pool.query(`INSERT INTO reminder_schedules (patient_id, type, times, active) VALUES (NULL,'acv',ARRAY[$1],true) RETURNING id`, [at])).rows.map(x => x.id);
  try {
    const rows = await getSchedulesForTime(at);
    const has = (id) => rows.some(x => x.uid === id && x.type === 'acv');
    ck('ACV reminder: none for the switched members with no ACV (nothing chosen; ACV switched off)', !has(plain) && !has(chose) && !has(noRow), [has(plain), has(chose), has(noRow)]);
  } finally { await pool.query(`DELETE FROM reminder_schedules WHERE id = ANY($1)`, [rs]); }

  console.log('\n[5] a failure halfway rolls everything back');
  {
    const snap = await snapshot();
    await pool.query('DELETE FROM migrations WHERE name = $1', [MIGRATION]);
    const late2 = await mk(9);
    await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [late2]);
    const snap2 = await snapshot();
    await pool.query(`CREATE OR REPLACE FUNCTION prs_fail() RETURNS trigger AS $$ BEGIN IF NEW.name = '${MIGRATION}' THEN RAISE EXCEPTION 'test: migrations write fails'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER prs_fail BEFORE INSERT ON migrations FOR EACH ROW EXECUTE FUNCTION prs_fail()`);
    let threw = false;
    try { await switchTestMembersToNewRule(pool, { onTestServer: true }); } catch { threw = true; }
    await pool.query(`DROP TRIGGER prs_fail ON migrations`); await pool.query(`DROP FUNCTION prs_fail()`);
    ck('the last step failing → the error is raised and NOTHING changed (flags, log, migrations)', threw && (await snapshot()) === snap2
      && (await pool.query('SELECT 1 FROM migrations WHERE name=$1', [MIGRATION])).rows.length === 0
      && (await pool.query('SELECT 1 FROM protocol_rule_switch_log WHERE user_id=$1', [late2])).rows.length === 0, threw);
    const again = await switchTestMembersToNewRule(pool, { onTestServer: true });
    ck('…and the next boot runs it cleanly', again.ran === true && (await row(late2)).f === true, again);
    void snap;
  }

  console.log('\n[6] the exact undo (UNDO_SQL from the service) restores the database as it was');
  {
    const c2 = await pool.connect();
    try { await c2.query('BEGIN'); for (const q of UNDO_SQL) await c2.query(q); await c2.query('COMMIT'); } finally { c2.release(); }
    const undone = await flags();
    ck('moved members are NULL again; the member created TRUE before the switch stays TRUE; the coach and admin untouched',
      undone[plain] === null && undone[chose] === null && undone[own] === null && undone[already] === true && undone[coach] === null && undone[adminNoRow] === 'no row', undone);
    ck('the profile row the switch created is gone again (that member had no row before)', undone[noRow] === 'no row', undone[noRow]);
    const c3 = await row(chose);
    ck('coach selections still as they were', JSON.stringify(c3.s) === '["d3","b12"]' && JSON.stringify(c3.a) === '[]');
  }

  console.log('\n[7] production (branch "main"), on a second scratch database standing for production');
  {
    await admin.query(`DROP DATABASE IF EXISTS ${NAME2}`); await admin.query(`CREATE DATABASE ${NAME2}`);
    pool2 = new Pool({ connectionString: Object.assign(new URL(base), { pathname: '/' + NAME2 }).toString() });
    await pool2.query(SCHEMA);
    const mk2 = async (n, role = 'patient') => (await pool2.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [`PRS2 ${n}`, `65${tag}${n}`, role])).rows[0].id;
    const pPlain = await mk2(1), pChose = await mk2(2), pNoRow = await mk2(3), pCoach = await mk2(4, 'monitor'), pNew = await mk2(5);
    await pool2.query(`INSERT INTO patient_profiles (user_id) VALUES ($1), ($2)`, [pPlain, pCoach]);
    await pool2.query(`INSERT INTO patient_profiles (user_id, protocol_supplements) VALUES ($1, '["d3"]')`, [pChose]);
    await pool2.query(`INSERT INTO patient_profiles (user_id, protocol_default_none) VALUES ($1, TRUE)`, [pNew]);
    const row2 = async (id) => (await pool2.query(`SELECT protocol_default_none AS f, protocol_supplements AS s FROM patient_profiles WHERE user_id=$1`, [id])).rows[0];
    const flags2 = async () => Object.fromEntries(await Promise.all([pPlain, pChose, pNoRow, pCoach, pNew].map(async id => [id, (await row2(id))?.f ?? ((await row2(id)) ? null : 'no row')])));
    const snap2 = JSON.stringify((await pool2.query(`SELECT * FROM patient_profiles ORDER BY user_id`)).rows);
    const env2 = process.env.RAILWAY_GIT_BRANCH;
    process.env.RAILWAY_GIT_BRANCH = 'main';
    let r2;
    try { r2 = await switchMembersToNewRule(pool2); } finally { if (env2 === undefined) delete process.env.RAILWAY_GIT_BRANCH; else process.env.RAILWAY_GIT_BRANCH = env2; }
    const f2 = await flags2();
    ck(`branch "main" (the service's own default guard) → runs once under the production record: ${r2.moved} moved, ${r2.createdRows} created`,
      r2.ran === true && r2.migration === MIGRATIONS.main && r2.moved === 2 && r2.createdRows === 1, r2);
    ck('production members are on the new rule; the coach-chosen D3 stays; the coach untouched', f2[pPlain] === true && f2[pChose] === true && f2[pNoRow] === true && f2[pCoach] === null
      && JSON.stringify((await row2(pChose)).s) === '["d3"]', f2);
    const recs = (await pool2.query(`SELECT name FROM migrations WHERE name LIKE 'protocol_rule_all_new_%' ORDER BY name`)).rows.map(x => x.name);
    ck('recorded under the production record only (not the test one)', JSON.stringify(recs) === JSON.stringify([MIGRATIONS.main]), recs);
    process.env.RAILWAY_GIT_BRANCH = 'main';
    try { r2 = await switchMembersToNewRule(pool2); } finally { if (env2 === undefined) delete process.env.RAILWAY_GIT_BRANCH; else process.env.RAILWAY_GIT_BRANCH = env2; }
    ck('a second production start does nothing (already done)', r2.ran === false && r2.why === 'already done', r2);
    const logged2 = (await pool2.query(`SELECT user_id, created_row FROM protocol_rule_switch_log WHERE migration=$1 ORDER BY user_id`, [MIGRATIONS.main])).rows;
    ck('the production log names exactly the members it moved (not the one already TRUE, not the coach)',
      JSON.stringify(logged2.map(x => [x.user_id, x.created_row])) === JSON.stringify([[pPlain, false], [pChose, false], [pNoRow, true]].sort((a, b) => a[0] - b[0])), logged2);
    process.env.RAILWAY_GIT_BRANCH = 'test';
    try { r = await switchMembersToNewRule(pool); } finally { if (env2 === undefined) delete process.env.RAILWAY_GIT_BRANCH; else process.env.RAILWAY_GIT_BRANCH = env2; }
    ck('the test site, already switched on 6 Nov under its own record, does not run again after this change', r.ran === false && r.why === 'already done', r);
    const c3 = await pool2.connect();
    try { await c3.query('BEGIN'); for (const q of undoSql(MIGRATIONS.main)) await c3.query(q); await c3.query('COMMIT'); } finally { c3.release(); }
    ck('the production undo restores the profiles exactly as they were before the release', JSON.stringify((await pool2.query(`SELECT * FROM patient_profiles ORDER BY user_id`)).rows) === snap2);
    let threw = false; try { undoSql("x'; DROP TABLE users; --"); } catch { threw = true; }
    ck('the undo only accepts the two known record names', threw && undoSql(MIGRATIONS.test).join() === UNDO_SQL.join());
    // QA review of 3k.2: the record names are pinned. The test site recorded "protocol_rule_all_new_test_v1" on 6 Nov;
    // renaming it would make the live test site switch everyone again on its next start.
    ck('the record names are exactly the ones written on the sites (test: 6 Nov)', MIGRATIONS.test === 'protocol_rule_all_new_test_v1' && MIGRATIONS.main === 'protocol_rule_all_new_main_v1' && MIGRATION === 'protocol_rule_all_new_test_v1');

    console.log('\n[8] catch-up: members the OLD version created during the release (or after a rollback)');
    // The undo above put pPlain (created before the switch) back on the old meaning: it must stay there.
    const late = await mk2(6), lateNoRow = await mk2(7);
    await pool2.query(`INSERT INTO patient_profiles (user_id) VALUES ($1)`, [late]);              // as the old version creates it
    process.env.RAILWAY_GIT_BRANCH = 'main';
    try { r2 = await switchMembersToNewRule(pool2); } finally { if (env2 === undefined) delete process.env.RAILWAY_GIT_BRANCH; else process.env.RAILWAY_GIT_BRANCH = env2; }
    ck(`the next production start moves the members created after the switch (${r2.caughtUp}), and logs them`,
      r2.ran === false && r2.why === 'already done' && r2.caughtUp === 2 && (await row2(late)).f === true && (await row2(lateNoRow))?.f === true
        && (await pool2.query(`SELECT count(*)::int n FROM protocol_rule_switch_log WHERE migration=$1 AND user_id = ANY($2)`, [MIGRATIONS.main, [late, lateNoRow]])).rows[0].n === 2, r2);
    ck('…a member from before the switch whom the undo put back stays on the old meaning (an undo stays undone)', (await row2(pPlain)).f === null);
    process.env.RAILWAY_GIT_BRANCH = 'main';
    try { r2 = await switchMembersToNewRule(pool2); } finally { if (env2 === undefined) delete process.env.RAILWAY_GIT_BRANCH; else process.env.RAILWAY_GIT_BRANCH = env2; }
    ck('…and a start with nothing new moves nobody', r2.caughtUp === 0, r2);
    // QA re-check of 3k.2: an undo must stay undone for the members the catch-up moved too.
    { const c4 = await pool2.connect();
      try { await c4.query('BEGIN'); for (const q of undoSql(MIGRATIONS.main)) await c4.query(q); await c4.query('COMMIT'); } finally { c4.release(); } }
    const afterUndo = [(await row2(late))?.f ?? null, (await row2(lateNoRow)) ? 'row' : 'no row'];
    process.env.RAILWAY_GIT_BRANCH = 'main';
    try { r2 = await switchMembersToNewRule(pool2); } finally { if (env2 === undefined) delete process.env.RAILWAY_GIT_BRANCH; else process.env.RAILWAY_GIT_BRANCH = env2; }
    ck('after an undo, the next start does not move the caught-up members back (undo stays undone for everyone)',
      afterUndo[0] === null && afterUndo[1] === 'no row' && r2.caughtUp === 0 && (await row2(late)).f === null && !(await row2(lateNoRow)), [afterUndo, r2]);
    const boot = fs.readFileSync(path.resolve(HERE, '../startup.js'), 'utf8');
    ck('startup.js calls the switch with its own guard (no options), and looks again 15 minutes later on the app pool',
      /switchMembersToNewRule\(pool\);/.test(boot) && !/onTestServer/.test(boot) && /switchMembersToNewRule\(require\('\.\/db\/pool'\)\)/.test(boot) && /15 \* 60 \* 1000/.test(boot));
  }
} catch (e) { ck('the suite ran to the end', false, e.stack); }
finally {
  try { await pool2?.end(); } catch {}
  try { await admin.query(`DROP DATABASE IF EXISTS ${NAME2}`); } catch {}
  try { await pool.end(); } catch {}
  try { await require('../db/pool').end(); } catch {}
  try { await admin.query(`DROP DATABASE IF EXISTS ${NAME}`); } catch {}
  try { await admin.end(); } catch {}
}
console.log(`\nProtocol rule switch (3k.1): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
