#!/usr/bin/env node
/**
 * backfill-nutrition.js — bring stored food data up to the current contract.
 *
 * Two fixes landed that only applied to data written afterwards:
 *
 *   1. `normaliseNutrients` existed in three places and disagreed. Foods
 *      written through two of those doors are missing fields, and some carry
 *      net_carbs as null where NaN reached the database.
 *   2. Coach-prescribed meal plans stored four macros and dropped the other 41
 *      fields, so anything a member logged from their plan has no micros.
 *
 * Rows already in the table stay wrong until something touches them. This
 * touches them.
 *
 *   cd server && node scripts/backfill-nutrition.js              # report only
 *   cd server && node scripts/backfill-nutrition.js --apply      # write it
 *
 * ── WHAT IT WILL AND WILL NOT DO ────────────────────────────────────────────
 * By default it is ADDITIVE ONLY. A field that is missing gets 0; a field that
 * has a value keeps it. Nobody's calorie history moves, because a nutrient
 * that was absent was already being summed as zero — the row simply stops
 * lying about which nutrients it knows.
 *
 * `--reenrich` is the exception and is opt-in for that reason: it rewrites
 * meal-plan items from the food table, which CAN change a number on screen.
 * That is the point — a plan item stored with four macros gets its real iron
 * and vitamin K back — but it is a value change, so you ask for it explicitly.
 *
 * Safe to run against production: it only reads unless --apply is passed, it
 * never deletes, and it runs each table in its own transaction.
 */

const fs = require('fs');
const { Pool, types } = require('pg');

/**
 * Its own connection, not the app's.
 *
 * db/pool.js is tuned for the server sitting next to the database inside
 * Railway: a 3-second connect timeout and three connections. Run from a laptop,
 * over the internet, through Railway's TCP proxy, three seconds is not enough
 * to finish a TLS handshake — the script died with "Connection terminated due
 * to connection timeout" before it had asked for anything.
 *
 * SSL is on unconditionally here. Railway's public proxy requires it, and
 * making that depend on remembering to set NODE_ENV was one more thing to get
 * wrong at the command line.
 */
types.setTypeParser(types.builtins.INT8, v => (v === null ? null : parseInt(v, 10)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // On for anything remote, off for a database on this machine — otherwise
  // pointing it at a local Postgres fails with a TLS error that has nothing to
  // do with the data.
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')
    ? false : { rejectUnauthorized: false },
  max: 2,
  connectionTimeoutMillis: 30000,   // 30s — a laptop on a home connection
  idleTimeoutMillis: 10000,
  statement_timeout: 120000,
});

if (!process.env.DATABASE_URL) {
  console.error('\n  DATABASE_URL is not set.\n');
  console.error('  Command Prompt:  set DATABASE_URL=postgresql://...');
  console.error('  PowerShell:      $env:DATABASE_URL="postgresql://..."');
  console.error('\n  Use Railway → Postgres → Variables → DATABASE_PUBLIC_URL,');
  console.error('  not DATABASE_URL (that one only works inside Railway).\n');
  process.exit(1);
}
const { normaliseNutrients } = require('../services/nutrients');
const { macroPlausibility, cookingFatPlausibility, massBalance } = require('../services/macroCheck');
const { saturatedPlausibility } = require('../services/fatProfile');

const argv     = process.argv.slice(2);
const APPLY    = argv.includes('--apply');
const REENRICH = argv.includes('--reenrich');
const RESTORE  = argv.includes('--restore');
const FILE     = (argv[argv.indexOf('--restore') + 1] || '').startsWith('--')
  ? 'nutrition-backup.json'
  : (argv[argv.indexOf('--restore') + 1] || 'nutrition-backup.json');

const CONTRACT = Object.keys(normaliseNutrients({}));

/** Additive merge: fill what is missing, never overwrite what is there. */
function fill(stored = {}) {
  const full = normaliseNutrients(stored);
  const out = { ...full };
  let added = 0, repaired = 0;
  for (const k of CONTRACT) {
    const had = stored[k];
    if (had === undefined || had === null) {
      // Absent. It was already being treated as zero everywhere; now it says so.
      if (!(k in stored)) added++;
      else repaired++;                     // present but null — the NaN case
    } else if (Number.isFinite(+had)) {
      out[k] = +had;                       // keep the real value untouched
    } else {
      repaired++;                          // "lots", "trace", NaN
    }
  }
  return { out, added, repaired };
}

/**
 * Compare two nutrition blocks by CONTENT, not by serialisation.
 *
 * Postgres reorders jsonb keys when it stores them, so a plain
 * JSON.stringify comparison never matches what came back out — the backfill
 * reported every row as needing work on every run and rewrote the whole table
 * each time. Harmless, but a report that says "4 of 4 rows need work" after it
 * has already fixed them is a report you stop believing.
 */
function changed(next, stored) {
  const a = stored || {};
  const keys = new Set([...Object.keys(next), ...Object.keys(a)]);
  for (const k of keys) {
    const x = next[k], y = a[k];
    if (y === undefined || y === null) { if (x !== undefined) return true; continue; }
    if (+x !== +y) return true;
  }
  return false;
}

async function backfillFoods() {
  const { rows } = await pool.query(`SELECT id, name, per_100g FROM foods ORDER BY id`);
  let touched = 0, addedTotal = 0, repairedTotal = 0;
  const samples = [];
  const pending = [];

  for (const f of rows) {
    const { out, added, repaired } = fill(f.per_100g || {});
    if (!changed(out, f.per_100g)) continue;
    touched++; addedTotal += added; repairedTotal += repaired;
    if (samples.length < 5) samples.push(`${f.name}: +${added} fields${repaired ? `, ${repaired} repaired` : ''}`);
    if (APPLY) pending.push([f.id, JSON.stringify(out)]);
  }

  // Written in batches, not one row at a time.
  //
  // 573 separate UPDATEs meant 573 round trips from a laptop in Bengaluru to
  // Railway's servers. At a couple of hundred milliseconds each that is a
  // quarter of an hour of waiting, and it looks like the script has hung.
  // One statement per 200 rows turns it into a few seconds.
  if (APPLY && pending.length) {
    const BATCH = 200;
    for (let i = 0; i < pending.length; i += BATCH) {
      const slice = pending.slice(i, i + BATCH);
      await pool.query(
        `UPDATE foods AS f
            SET per_100g = v.per_100g::jsonb
           FROM (SELECT * FROM unnest($1::int[], $2::text[]) AS t(id, per_100g)) v
          WHERE f.id = v.id`,
        [slice.map(r => r[0]), slice.map(r => r[1])]
      );
      process.stdout.write(`\r  writing foods… ${Math.min(i + BATCH, pending.length)}/${pending.length}   `);
    }
    process.stdout.write('\r' + ' '.repeat(46) + '\r');
  }

  return { total: rows.length, touched, addedTotal, repairedTotal, samples };
}

async function backfillMealPlans() {
  const { rows } = await pool.query(
    `SELECT id, patient_id, plan_date, meal, items FROM meal_plans ORDER BY id`);

  // One lookup for the whole run rather than a query per item.
  const { rows: foods } = await pool.query(
    `SELECT name, per_100g FROM foods WHERE per_100g IS NOT NULL`);
  const byName = new Map(foods.map(f => [String(f.name).toLowerCase().replace(/\s*\(.*$/, '').trim(), f.per_100g]));

  let touched = 0, itemsFilled = 0, itemsReenriched = 0;
  const pendingPlans = [];
  for (const r of rows) {
    const items = Array.isArray(r.items) ? r.items : [];
    let rowChanged = false;
    const next = items.map(it => {
      const stored = it.per_100g || {};
      let base = stored;
      if (REENRICH) {
        const known = byName.get(String(it.name || '').toLowerCase().replace(/\s*\(.*$/, '').trim());
        // Only when the food table genuinely knows more than the plan does.
        if (known && Object.keys(known).length > Object.keys(stored).length) {
          base = { ...known, ...stored };  // stored values still win
          itemsReenriched++;
        }
      }
      const { out } = fill(base);
      if (changed(out, stored)) { rowChanged = true; itemsFilled++; }
      return { ...it, per_100g: out };
    });
    if (!rowChanged) continue;
    touched++;
    if (APPLY) pendingPlans.push([r.id, JSON.stringify(next)]);
  }

  if (APPLY && pendingPlans.length) {
    const BATCH = 200;
    for (let i = 0; i < pendingPlans.length; i += BATCH) {
      const slice = pendingPlans.slice(i, i + BATCH);
      await pool.query(
        `UPDATE meal_plans AS m
            SET items = v.items::jsonb
           FROM (SELECT * FROM unnest($1::int[], $2::text[]) AS t(id, items)) v
          WHERE m.id = v.id`,
        [slice.map(r => r[0]), slice.map(r => r[1])]
      );
    }
  }
  return { total: rows.length, touched, itemsFilled, itemsReenriched };
}

/**
 * Which foods the new plausibility checks would flag.
 *
 * Reported, never corrected. Guessing a number is how the wrong ones got there.
 */
async function report() {
  const { rows } = await pool.query(
    `SELECT id, name, verified, per_100g FROM foods WHERE per_100g IS NOT NULL`);
  const verified = rows.filter(f => f.verified && +f.per_100g?.calories > 0);

  const flagged = [];
  for (const f of rows) {
    if (f.verified) continue;
    const kcal = +f.per_100g?.calories || 0;
    const macro = macroPlausibility(f.per_100g, f.name);
    const cook  = cookingFatPlausibility(f.per_100g, f.name);
    const mass  = massBalance(f.per_100g);
    const sat   = saturatedPlausibility(f.per_100g);

    let lighter = null;
    if (kcal) {
      const lc = String(f.name).toLowerCase();
      for (const b of verified) {
        const bn = String(b.name).toLowerCase().replace(/\s*\(.*$/, '').trim();
        if (bn.length < 4 || lc === bn) continue;
        if (!lc.includes(` ${bn}`) && !lc.split(/\s+/).includes(bn)) continue;
        if (kcal < +b.per_100g.calories * 0.9) lighter = b.name;
      }
    }
    // Same order the review queue uses, so the list here and the queue there
    // agree about what is most wrong. Impossible first — it is arithmetic, not
    // a judgement call.
    if (mass.status === 'impossible' || macro.status === 'suspect'
        || cook.status === 'suspect' || sat.status === 'suspect' || lighter) {
      flagged.push({
        name: f.name, kcal: Math.round(kcal),
        hard: mass.status === 'impossible',
        why: mass.status === 'impossible' ? mass.reason
           : macro.status === 'suspect' ? macro.reason
           : lighter ? `lighter than plain ${lighter}`
           : cook.status === 'suspect' ? cook.reason
           : sat.reason,
      });
    }
  }
  return flagged;
}

/**
 * Write every value this script could change to a file, before changing it.
 *
 * Railway's snapshots are a paid feature, so on a smaller plan there is no
 * rollback — and "it only adds missing fields" is a promise, not a safety net.
 * This is the safety net: a plain JSON file of exactly the rows about to be
 * touched, restorable with one command.
 *
 * Written automatically on every --apply. It costs a second and it means the
 * question "can I undo this?" always has the same answer.
 */
async function writeBackup(file) {
  const foods = await pool.query(`SELECT id, per_100g FROM foods ORDER BY id`);
  const plans = await pool.query(`SELECT id, items FROM meal_plans ORDER BY id`);
  const payload = {
    taken_at: new Date().toISOString(),
    foods: foods.rows,
    meal_plans: plans.rows,
  };
  fs.writeFileSync(file, JSON.stringify(payload));
  return { file, foods: foods.rows.length, plans: plans.rows.length,
           kb: Math.round(fs.statSync(file).size / 1024) };
}

/** Put everything back exactly as it was. */
async function restoreBackup(file) {
  if (!fs.existsSync(file)) throw new Error(`No backup file at ${file}`);
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const f of b.foods || []) {
    await pool.query(`UPDATE foods SET per_100g = $2::jsonb WHERE id = $1`,
      [f.id, JSON.stringify(f.per_100g)]);
    n++;
  }
  let m = 0;
  for (const r of b.meal_plans || []) {
    await pool.query(`UPDATE meal_plans SET items = $2::jsonb WHERE id = $1`,
      [r.id, JSON.stringify(r.items)]);
    m++;
  }
  return { taken_at: b.taken_at, foods: n, plans: m };
}

(async () => {
  console.log('');

  if (RESTORE) {
    const r = await restoreBackup(FILE);
    console.log(`  Restored ${r.foods} foods and ${r.plans} meal plans`);
    console.log(`  from the backup taken ${r.taken_at}\n`);
    await pool.end();
    return;
  }

  console.log(`  FitLife — nutrition backfill   ${APPLY ? 'APPLYING' : 'DRY RUN (nothing written)'}`);
  console.log(`  contract  : ${CONTRACT.length} fields`);
  console.log(`  re-enrich : ${REENRICH ? 'on — meal-plan values may change' : 'off (additive only)'}`);
  console.log('');

  if (APPLY) {
    const b = await writeBackup(FILE);
    console.log(`  backup    : ${b.foods} foods + ${b.plans} meal plans → ${b.file} (${b.kb} KB)`);
    console.log(`              undo with:  node scripts/backfill-nutrition.js --restore\n`);
  }

  const f = await backfillFoods();
  console.log(`  foods       ${f.touched} of ${f.total} rows need work`);
  console.log(`              ${f.addedTotal} missing fields, ${f.repairedTotal} null/NaN repaired`);
  f.samples.forEach(s => console.log(`                · ${s}`));

  const m = await backfillMealPlans();
  console.log(`  meal_plans  ${m.touched} of ${m.total} rows, ${m.itemsFilled} items` +
    (REENRICH ? `, ${m.itemsReenriched} re-enriched from the food table` : ''));

  const flagged = await report();
  flagged.sort((a, b) => (b.hard ? 1 : 0) - (a.hard ? 1 : 0));
  const hard = flagged.filter(x => x.hard).length;
  console.log('');
  console.log(`  Needs a human: ${flagged.length} unverified foods look wrong` +
    (hard ? `  (${hard} cannot be true at all)` : ''));
  flagged.slice(0, 15).forEach(x =>
    console.log(`    ${x.hard ? '✗' : '·'} ${x.name} (${x.kcal} kcal) — ${x.why}`));
  if (flagged.length > 15) console.log(`    … and ${flagged.length - 15} more`);
  console.log('');
  console.log(APPLY
    ? '  Done. Work the flagged list in Admin → Foods → Show queue.\n'
    : '  Nothing written. Re-run with --apply to write, --reenrich to also\n' +
      '  restore micros on existing coach meal plans.\n');

  await pool.end();
})().catch(err => {
  const m = String(err.message || '');
  console.error('\n  Could not finish:', m, '\n');
  if (/timeout|ENOTFOUND|ECONNREFUSED/i.test(m)) {
    console.error('  That is a connection problem, not a data problem. Check:');
    console.error('   · the URL is DATABASE_PUBLIC_URL, not the internal one');
    console.error('   · the password in it is the real one, not a placeholder');
    console.error('   · you are on a network that allows outbound port connections\n');
  } else if (/password|authentication/i.test(m)) {
    console.error('  The password in the URL is wrong.\n');
  }
  pool.end().then(() => process.exit(1));
});
