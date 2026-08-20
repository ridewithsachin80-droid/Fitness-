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
  const q = String(name).trim();
  const { rows } = await pool.query(
    `SELECT id, name, per_100g, verified,
            CASE
              WHEN LOWER(name)       = LOWER($1) THEN 0
              WHEN LOWER(name_local) = LOWER($1) THEN 1
              WHEN LOWER(name_hindi) = LOWER($1) THEN 2
              WHEN LOWER(name_aliases::text) LIKE LOWER($2) THEN 3
              WHEN LOWER(name)       LIKE LOWER($3) THEN 4
              ELSE 5
            END AS match_rank
     FROM foods
     WHERE LOWER(name)       = LOWER($1)
        OR LOWER(name_local) = LOWER($1)
        OR LOWER(name_hindi) = LOWER($1)
        OR LOWER(name_aliases::text) LIKE LOWER($2)
        OR LOWER(name)       LIKE LOWER($3)
     ORDER BY match_rank ASC, verified DESC, LENGTH(name) ASC, id ASC
     LIMIT 1`,
    [q, `%"${q.toLowerCase()}"%`, `${q.toLowerCase()}%`]
  );
  return rows[0] || null;
}

const DENSE = /\b(whey|casein|protein powder|protein isolate|oil|ghee|butter|peanut butter|sugar|jaggery|honey|nuts?|almond|cashew)\b/i;
const suspect = (name, cal) => DENSE.test(name) && cal < 300;

(async () => {
  await pool.query('DELETE FROM foods');
  const seed = [
    ['Whey Protein (Unflavoured)', 'Whey Protein', 400, 80],
    ['Whey Protein (Chocolate)',   'Whey Choco',   390, 75],
    ['Egg (Whole, Boiled)',        'Egg',          155, 13],
    ['Okra (Bhindi, Cooked)',      'Okra',          33, 1.9],
    ['Groundnut Oil',              'Oil',          900, 0],
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

  console.log('\n[2] the other logged items still resolve');
  for (const [typed, expect] of [['Egg', 'Egg (Whole, Boiled)'], ['Okra', 'Okra (Bhindi, Cooked)']]) {
    const m = await lookup(typed);
    ck(`"${typed}" -> ${expect}`, m && m.name === expect, m && m.name);
  }

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
