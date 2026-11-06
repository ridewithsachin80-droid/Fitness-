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
const { switchTestMembersToNewRule, onTestBranch, UNDO_SQL, MIGRATION } = require('../services/protocolRuleSwitch');
const made = [];
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
  ck('not the test server → it does not run', r.ran === false && r.why === 'not the test server', r);
  ck('…and nothing changed', JSON.stringify(await flags()) === JSON.stringify(before), [before, await flags()]);
  const env = { b: process.env.RAILWAY_GIT_BRANCH, t: process.env.FITLIFE_TEST_SERVER };
  const tryWith = async (branch, testVar) => {
    if (branch == null) delete process.env.RAILWAY_GIT_BRANCH; else process.env.RAILWAY_GIT_BRANCH = branch;
    if (testVar == null) delete process.env.FITLIFE_TEST_SERVER; else process.env.FITLIFE_TEST_SERVER = testVar;
    return { guard: onTestBranch(), r: await switchTestMembersToNewRule(pool) };   // the service's OWN default guard
  };
  const onMain = await tryWith('main', 'yes'), noBranch = await tryWith(null, 'yes'), nothing = await tryWith(null, null), prod = await tryWith('production', null);
  const near = [await tryWith('Test', null), await tryWith('testing', null), await tryWith('test ', null), await tryWith('main-test', null)];
  ck('the service itself does not run on branch main (even with FITLIFE_TEST_SERVER=yes), with no branch reported (even with it), with nothing set, or on another branch',
    [onMain, noBranch, nothing, prod].every(x => x.guard === false && x.r.ran === false) && (await flags())[plain] === null, [onMain, noBranch, nothing, prod]);
  ck('…nor on branch names that only look like "test" (Test, testing, "test ", main-test)', near.every(x => x.guard === false && x.r.ran === false) && (await flags())[plain] === null, near);
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
  ck('a second boot does nothing (already done); a row made afterwards without the flag is left alone', r.ran === false && r.why === 'already done' && (await row(late)).f === null, [r, (await row(late)).f]);
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
} catch (e) { ck('the suite ran to the end', false, e.stack); }
finally {
  try { await pool.end(); } catch {}
  try { await require('../db/pool').end(); } catch {}
  try { await admin.query(`DROP DATABASE IF EXISTS ${NAME}`); } catch {}
  try { await admin.end(); } catch {}
}
console.log(`\nProtocol rule switch (3k.1): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
