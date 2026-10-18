/**
 * scripts/test-nutrient-unknown.js — unknown is not zero, on the server (Fixes-2i, 18 Oct 2026).
 *
 * Missing nutrient values were stored as 0. The member app now treats a group
 * the food's record does not fill as "not known" (client/src/lib/day/macros.js,
 * tested in test-day-lib [3b] and ui-tests). The coach's "<food> nutrition"
 * answer follows the same rule here, on a real Postgres.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
const pool = require('../db/pool');
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e === undefined ? '' : e).slice(0, 300))); };

(async () => {
  const tag = String(Date.now()).slice(-7);
  const A = `Zzunknown${tag} Curry`, B = `Zzknown${tag} Greens`;
  const ins = (name, per) => pool.query(`INSERT INTO foods (name, category, source, verified, per_100g) VALUES ($1,'other','ai',false,$2) RETURNING id`, [name, JSON.stringify(per)]);
  const ids = [];
  try {
    console.log('\n[1] the coach’s food answer');
    ids.push((await ins(A, { calories: 150, protein: 5, total_carbs: 20, fat: 5, fiber: 0, iron: 0, calcium: 0, vit_c: 0, vit_b12: 0 })).rows[0].id);
    ids.push((await ins(B, { calories: 30, protein: 3, total_carbs: 4, fat: 0.5, fiber: 0, iron: 3, calcium: 90, vit_c: 0, vit_a: 400 })).rows[0].id);
    const { answerFoodQuestion } = require('../routes/aiChat');
    const a = await answerFoodQuestion(`${A.toLowerCase()} nutrition`);
    ck('a food stored with every micronutrient at 0: iron, calcium, vitamin C and fibre are "not known", not 0',
       /fibre not known/.test(a) && /Iron not known · calcium not known · vitamin C not known/.test(a), a);
    const b = await answerFoodQuestion(`${B.toLowerCase()} nutrition`);
    ck('a food whose record fills minerals and vitamins: the numbers, and a 0 in a filled group is a real 0 (vitamin C 0mg, fibre 0g)',
       /Iron 3mg · calcium 90mg · vitamin C 0mg/.test(b) && /fibre 0g/.test(b), b);
  } catch (e) { fail++; console.log('  ✗ suite crashed: ' + e.stack); }
  finally {
    await pool.query(`DELETE FROM foods WHERE id = ANY($1)`, [ids]).catch(() => {});
    console.log(`\n${pass} passed, ${fail} failed`);
    await pool.end(); process.exit(fail ? 1 : 0);
  }
})();
