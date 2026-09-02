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
const pool = require('../db/pool');
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

  for (const f of rows) {
    const { out, added, repaired } = fill(f.per_100g || {});
    if (!changed(out, f.per_100g)) continue;
    touched++; addedTotal += added; repairedTotal += repaired;
    if (samples.length < 5) samples.push(`${f.name}: +${added} fields${repaired ? `, ${repaired} repaired` : ''}`);
    if (APPLY) {
      await pool.query(`UPDATE foods SET per_100g = $2::jsonb WHERE id = $1`,
        [f.id, JSON.stringify(out)]);
    }
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
    if (APPLY) {
      await pool.query(`UPDATE meal_plans SET items = $2::jsonb WHERE id = $1`,
        [r.id, JSON.stringify(next)]);
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
})().catch(err => { console.error('backfill failed:', err.message); pool.end().then(() => process.exit(1)); });
