/**
 * scripts/test-food-cooked.js — food is costed AS EATEN.
 *
 * Runs the REAL NIN seed (about 700 foods) into the test database, then the
 * boot-time food fixes, then the real food matcher the member chat uses.
 * Anything the seed added is removed again at the end, so other suites see
 * the table as they left it.
 *
 * WHAT MUST HOLD
 * --------------
 *   A. "brown rice", "white rice", "rice", "boiled rice" and "moong dal" find
 *      the COOKED food. Before: brown rice at 362 kcal per 100 g (raw grain),
 *      moong dal at 334, so 150 g of cooked brown rice logged as 543 kcal.
 *   B. Someone who really means raw can still get the raw row.
 *   C. The fixes are safe to run on every boot: the second run changes
 *      nothing, a coach's own aliases are kept, and on a table the seed has
 *      not filled they add no rows (the seed only runs on an empty table).
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const path = require('path');
const { execFileSync } = require('child_process');
const pool = require('../db/pool');
const { applyFoodFixes } = require('../services/foodFixes');
const { enrichFromDB } = require('../routes/aiChat');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };

(async () => {
  const { rows: [{ max }] } = await pool.query(`SELECT COALESCE(MAX(id), 0) AS max FROM foods`);
  const before = Number(max);
  try {
    console.log('\n[0] a table the seed has not filled');
    {
      const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM foods WHERE LOWER(name) LIKE 'rice, raw%'`);
      if (n === 0) {
        const f = await applyFoodFixes(pool);
        ck('with no raw rice rows, the fixes add nothing (so a later seed is not skipped)', f.added === 0, f);
      } else {
        ck('(raw rice rows already present from an earlier run; skipped)', true);
      }
    }

    execFileSync(process.execPath, [path.join(__dirname, 'seed-nin-india.js')], { env: process.env, stdio: 'ignore', timeout: 120000 });
    const cost = async (name, grams = 100) => {
      const [e] = await enrichFromDB([{ name, grams, per_100g: { calories: 999 } }]);
      return { kcal100: Math.round(Number(e?.per_100g?.calories) || 0), source: e?.source, id: e?.food_id };
    };

    console.log('\n[1] before the fixes: the bug, reproduced');
    {
      // Only meaningful on a database the fixes have never touched.
      const touched = (await pool.query(`SELECT 1 FROM foods WHERE name = 'Rice, Cooked (Brown)'`)).rows.length > 0;
      if (!touched) {
        ck('"brown rice" finds the RAW grain at 362 kcal', (await cost('brown rice')).kcal100 === 362, await cost('brown rice'));
        // 7 Oct 2026 audit: the same mistake elsewhere in the table.
        for (const [q, k] of [['chana', 360], ['urad dal', 347], ['chana dal', 372], ['whole moong', 347], ['lobia', 323], ['pasta', 348], ['noodles', 364], ['idiyappam', 350], ['red rice', 350], ['corn', 357]]) {
          const c = await cost(q);
          ck(`"${q}" finds a dry or wrong row at ${k} kcal`, c.kcal100 === k, c);
        }
      } else {
        ck('(fixes already applied in this database; skipped)', true);
      }
    }

    console.log('\n[2] after the fixes');
    // A coach's own alias, there before the fixes ever ran.
    await pool.query(`UPDATE foods SET name_aliases = '["sona masoori"]'::jsonb WHERE name = 'Rice, Cooked (White)'`);
    const f1 = await applyFoodFixes(pool);
    const al1 = (await pool.query(`SELECT name_aliases FROM foods WHERE name = 'Rice, Cooked (White)'`)).rows[0].name_aliases;
    ck('the first run keeps an alias the coach had already added', al1.includes('sona masoori') && al1.includes('rice'), al1);
    ck('the first run renames 9 dry rows, adds 13 cooked rows, sets the rice and corn aliases', f1.renamed === 9 && f1.added === 13 && f1.aliased === 2, f1);
    const expect = [['brown rice', 123], ['Brown Rice', 123], ['white rice', 130], ['rice', 130], ['plain rice', 130], ['anna', 130],
                    ['boiled rice', 123], ['kusubalakki', 123], ['cooked rice', 130], ['moong dal', 105], ['toor dal', 116], ['dal', 116],
                    // 7 Oct 2026: pulses, pasta, noodles, idiyappam, red rice, corn. With the Kannada names.
                    ['chana', 164], ['Chana', 164], ['kadale', 164], ['chickpeas', 164], ['kabuli chana', 164],
                    ['urad dal', 105], ['uddina bele', 105], ['chana dal', 129], ['kadale bele', 129],
                    ['whole moong', 105], ['hesaru', 105], ['green gram', 105], ['lobia', 116], ['alasande', 116],
                    ['pasta', 158], ['spaghetti', 158], ['noodles', 138], ['rice noodles', 108],
                    ['idiyappam', 140], ['shavige', 140], ['red rice', 123], ['corn', 86], ['rajma', 127]];
    for (const [q, k] of expect) {
      const c = await cost(q);
      ck(`"${q}" is costed as cooked: ${k} kcal per 100 g`, c.kcal100 === k && c.source && c.source !== 'ai', c);
    }
    const br = await cost('brown rice', 150);
    ck('so 150 g of brown rice is about 185 kcal, not 543', Math.round(150 * br.kcal100 / 100) === 185);
    ck('"brown rice (raw)" still finds the raw grain', (await cost('brown rice (raw)')).kcal100 === 362);
    ck('"rice, raw (white)" still finds the raw grain', (await cost('Rice, Raw (White)')).kcal100 === 346);
    ck('"moong dal raw" is not forced to cooked', (await cost('moong dal raw')).kcal100 !== 105, await cost('moong dal raw'));
    ck('"rice flour" is still rice flour', (await cost('rice flour')).kcal100 === 366, await cost('rice flour'));
    ck('"poha" is cooked poha (as before)', (await cost('poha')).kcal100 === 140, await cost('poha'));
    const ch = await cost('chana', 150);
    ck('so 150 g of chana is about 246 kcal, not 540', Math.round(150 * ch.kcal100 / 100) === 246);
    ck('foods people weigh dry are left alone: oats 374, soya chunks 336, ragi 328', (await cost('oats')).kcal100 === 374 && (await cost('soya chunks')).kcal100 === 336 && (await cost('ragi')).kcal100 === 328);
    ck('"cornflakes" is still cornflakes, "sweet corn" still sweet corn', (await cost('cornflakes')).kcal100 === 357 && (await cost('sweet corn')).kcal100 === 86);
    ck('the dry rows are still there under their full names', (await cost('Chana (Bengal Gram, Whole)')).kcal100 === 360 && (await cost('Pasta (Whole Wheat, Dry)')).kcal100 === 348 && (await cost('Rice Vermicelli (Idiyappam)')).kcal100 === 350);
    const locals = (await pool.query(`SELECT name, name_local FROM foods WHERE name IN ('Rajma (Kidney Beans, Raw)', 'Rice Flakes (Poha)', 'Rice Vermicelli (Idiyappam)', 'Pasta (Whole Wheat, Dry)', 'Noodles (Rice, Dry)', 'Rice, Raw (Red)')`)).rows;
    ck('and their everyday names now say raw or dry, so a search list cannot mistake them for the dish', locals.length === 6 && locals.every(r => /\((raw|dry|dry flakes)\)$/.test(r.name_local)), locals);
    ck('every cooked row has calories, protein, carbs and fat that add up (within 12%)', (await pool.query(`SELECT name, per_100g FROM foods WHERE source = 'manual' AND name ~ 'Cooked'`)).rows
       .every(r => { const n = r.per_100g; const k = 4 * n.protein + 4 * n.total_carbs + 9 * n.fat; return n.calories > 0 && Math.abs(k - n.calories) / n.calories < 0.12; }),
       (await pool.query(`SELECT name, per_100g FROM foods WHERE source = 'manual' AND name ~ 'Cooked'`)).rows.map(r => [r.name, r.per_100g.calories, Math.round(4 * r.per_100g.protein + 4 * r.per_100g.total_carbs + 9 * r.per_100g.fat)]));

    console.log('\n[3] safe to run on every boot');
    const f2 = await applyFoodFixes(pool);
    ck('the second run changes nothing', f2.renamed === 0 && f2.added === 0 && f2.aliased === 0, f2);
    await pool.query(`UPDATE foods SET name_aliases = name_aliases || '["jeera rice"]'::jsonb WHERE name = 'Rice, Cooked (White)'`);
    await applyFoodFixes(pool);
    const al = (await pool.query(`SELECT name_aliases FROM foods WHERE name = 'Rice, Cooked (White)'`)).rows[0].name_aliases;
    ck('an alias added later is kept too, with no duplicates', al.includes('jeera rice') && al.includes('sona masoori') && al.includes('rice') && new Set(al).size === al.length, al);
    const dup = (await pool.query(`SELECT COUNT(*)::int AS n FROM foods WHERE name = 'Rice, Cooked (Brown)'`)).rows[0].n;
    ck('cooked brown rice exists exactly once', dup === 1, dup);
    const dups = (await pool.query(`SELECT name, COUNT(*)::int AS n FROM foods WHERE source = 'manual' GROUP BY name HAVING COUNT(*) > 1`)).rows;
    ck('no cooked row was added twice', dups.length === 0, dups);
  } finally {
    await pool.query(`DELETE FROM foods WHERE id > $1`, [before]);
    await pool.end();
  }
  console.log(`\n${fail === 0 ? '\u2713' : '\u2717'} test-food-cooked: ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
