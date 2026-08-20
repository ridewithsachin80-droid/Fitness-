/**
 * scripts/test-food-lookup.js — food matching + per-serving guard.
 * Regression for the bug where "Whey Protein" logged 36 kcal instead of 120:
 * the seeds store the everyday name in name_local, but the lookup only read
 * name/name_aliases, so the DB was never consulted and the AI's per-scoop
 * estimate was used instead.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
const pool = require('../db/pool');
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e || '').slice(0, 160))); };

async function lookup(name) {
  const ql = String(name).trim().toLowerCase();
  const { rows } = await pool.query(
    `WITH c AS (
       SELECT id, name, per_100g, verified,
              LOWER(BTRIM(SPLIT_PART(name, '(', 1))) AS base
       FROM foods
       WHERE LOWER(name)       = $1
          OR LOWER(name_local) = $1
          OR LOWER(name_hindi) = $1
          OR LOWER(name_aliases::text) LIKE $2
          OR LOWER(name)       LIKE $3
     )
     SELECT id, name, per_100g, verified,
            CASE
              WHEN LOWER(name) = $1                  THEN 0
              WHEN base = $1                         THEN 1
              WHEN base IN ($1 || 's', $1 || 'es')   THEN 2
              WHEN RTRIM($1, 's') = RTRIM(base, 's') THEN 2
              WHEN base LIKE $1 || ' %'              THEN 4
              ELSE 5
            END AS rank
     FROM c
     ORDER BY rank ASC, verified DESC, LENGTH(base) ASC, id ASC
     LIMIT 1`,
    [ql, `%"${ql}"%`, `${ql}%`]
  );
  return rows[0] || null;
}

const DENSE = /\b(whey|casein|protein powder|protein isolate|oil|ghee|butter|peanut butter|sugar|jaggery|honey|nuts?|almond|cashew)\b/i;
const suspect = (name, cal) => DENSE.test(name) && cal < 300;

(async () => {
  await pool.query('DELETE FROM foods');
  // The real seed names, including the ones that caused the bug
  const seed = [
    ['Whey Protein (Unflavoured)',   'Whey Protein', 400, 80],
    ['Whey Protein (Chocolate)',     'Whey Choco',   390, 75],
    ['Eggs (Whole, Raw)',            'Muttai',       155, 12.6],
    ['Egg White (Raw)',              'Egg White',     52, 10.9],
    ['Egg Yolk (Raw)',               'Egg Yolk',     322, 15.9],
    ['Egg Bhurji (Scrambled Egg)',   'Muttai Bhurji',185, 13.0],
    ['Eggplant / Brinjal (Baingan)', 'Kathirikai',    25, 1.0],
    ['Okra (Bhindi, Cooked)',        'Okra',          33, 1.9],
    ['Groundnut Oil',                'Oil',          900, 0],
  ];
  for (const [name, local, cal, pro] of seed) {
    await pool.query(
      `INSERT INTO foods (name, name_local, category, source, verified, per_100g)
       VALUES ($1,$2,'supplement','nin',true,$3)`,
      [name, local, JSON.stringify({ calories: cal, protein: pro, total_carbs: 5, fat: 3 })]);
  }

  console.log('\n[1] the reported bug');
  let r = await lookup('Whey Protein');
  ck('"Whey Protein" now matches the DB', !!r, r);
  ck('picks unflavoured, not chocolate', r && r.name === 'Whey Protein (Unflavoured)', r && r.name);
  ck('per-100g is 400 kcal, not 120', r && r.per_100g.calories === 400, r && r.per_100g);
  const kcal30 = r ? Math.round(r.per_100g.calories * 30 / 100) : 0;
  ck('30g scoop = 120 kcal (was 36)', kcal30 === 120, kcal30);
  const pro30 = r ? +(r.per_100g.protein * 30 / 100).toFixed(1) : 0;
  ck('30g scoop = 24g protein (was 7.2)', pro30 === 24, pro30);

  console.log('\n[2] the egg family — a component must never beat the food');
  const cases = [
    ['Egg',        'Eggs (Whole, Raw)'],
    ['Eggs',       'Eggs (Whole, Raw)'],
    ['Egg White',  'Egg White (Raw)'],
    ['Egg Yolk',   'Egg Yolk (Raw)'],
    ['Egg Bhurji', 'Egg Bhurji (Scrambled Egg)'],
    ['Eggplant',   'Eggplant / Brinjal (Baingan)'],
    ['Okra',       'Okra (Bhindi, Cooked)'],
  ];
  for (const [typed, expect] of cases) {
    const m = await lookup(typed);
    ck(`"${typed}" -> ${expect}`, m && m.name === expect, m && m.name);
  }
  const egg = await lookup('Egg');
  const k165 = egg ? Math.round(egg.per_100g.calories * 165 / 100) : 0;
  ck('165g of "Egg" = 256 kcal (was 531)', k165 === 256, k165);

  console.log('\n[3] exact names still win over prefix matches');
  const exact = await lookup('Whey Protein (Chocolate)');
  ck('full product name matches itself', exact && exact.name === 'Whey Protein (Chocolate)', exact && exact.name);

  console.log('\n[4] per-serving guard');
  ck('whey at 120 kcal/100g flagged', suspect('Whey Protein', 120) === true);
  ck('whey at 400 kcal/100g not flagged', suspect('Whey Protein', 400) === false);
  ck('oil at 90 kcal/100g flagged', suspect('Groundnut Oil', 90) === true);
  ck('okra at 33 kcal/100g NOT flagged (correctly low)', suspect('Okra', 33) === false);
  ck('yoghurt at 61 kcal/100g NOT flagged', suspect('Yoghurt', 61) === false);

  console.log(`\n\u2550\u2550\u2550 FOOD LOOKUP: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
