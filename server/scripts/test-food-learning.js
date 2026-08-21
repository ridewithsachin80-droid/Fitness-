/**
 * scripts/test-food-learning.js — the chat feeding foods back into the database.
 *
 * Before this, the AI chat read from `foods` but never wrote to it: a member
 * could log "upma" daily and the AI would re-estimate it from scratch every
 * time. These assertions cover what must and must not be written.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
const pool = require('../db/pool');
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e || '').slice(0, 180))); };

const CATEGORY_VALUES = ['dairy','grain','vegetable','fruit','nut','oil',
                         'supplement','branded','other','pulse','meat','beverage','spice'];
function guessCategory(name) {
  const n = String(name || '').toLowerCase();
  if (/\b(milk|curd|yoghurt|yogurt|paneer|cheese|butter|ghee|lassi|buttermilk)\b/.test(n)) return 'dairy';
  if (/\b(rice|roti|chapati|paratha|bread|poha|upma|idli|dosa|oats|wheat|millet|quinoa|noodle|pasta)\b/.test(n)) return 'grain';
  if (/\b(dal|daal|lentil|chana|rajma|beans?|sprouts?|moong|toor|urad|chickpea)\b/.test(n)) return 'pulse';
  if (/\b(chicken|mutton|fish|egg|prawn|meat|beef|pork)\b/.test(n)) return 'meat';
  if (/\b(oil|ghee)\b/.test(n)) return 'oil';
  if (/\b(almond|cashew|walnut|peanut|nuts?|seeds?)\b/.test(n)) return 'nut';
  if (/\b(juice|tea|coffee|water|shake|smoothie|soda)\b/.test(n)) return 'beverage';
  if (/\b(whey|protein powder|supplement|capsule|tablet)\b/.test(n)) return 'supplement';
  if (/\b(apple|banana|mango|orange|grape|papaya|melon|berry|fruit)\b/.test(n)) return 'fruit';
  if (/\b(masala|powder|spice|jeera|haldi|turmeric)\b/.test(n)) return 'spice';
  return 'other';
}
async function learnFoods(foods) {
  for (const f of foods) {
    if (f.food_id) continue;
    if (f.warning) continue;
    const cal = parseFloat(f.per_100g?.calories) || 0;
    if (cal <= 0 || cal > 920) continue;
    const name = String(f.name || '').trim();
    if (name.length < 2 || name.length > 100) continue;
    const category = CATEGORY_VALUES.includes(f.category) ? f.category : guessCategory(name);
    try {
      await pool.query(
        `INSERT INTO foods (name, category, source, verified, per_100g)
         VALUES ($1,$2,'ai',false,$3)
         ON CONFLICT (lower(name), source) DO UPDATE SET per_100g = EXCLUDED.per_100g`,
        [name, category, JSON.stringify(f.per_100g)]);
    } catch (e) { /* never fail the log */ }
  }
}
const row = (name, cal, extra = {}) => ({
  name, per_100g: { calories: cal, protein: 5, total_carbs: 20, fat: 3 }, ...extra });

(async () => {
  await pool.query('DELETE FROM foods');

  console.log('\n[1] new foods are learned');
  await learnFoods([row('Ragi Mudde', 119), row('Bisi Bele Bath', 165)]);
  let { rows } = await pool.query(`SELECT name, source, verified, category FROM foods ORDER BY name`);
  ck('both saved', rows.length === 2, rows.map(r => r.name));
  ck("source is 'ai'", rows.every(r => r.source === 'ai'), rows.map(r => r.source));
  ck('verified is false', rows.every(r => r.verified === false), rows.map(r => r.verified));

  console.log('\n[2] known foods are not re-learned');
  await pool.query(`INSERT INTO foods (name,category,source,verified,per_100g)
                    VALUES ('Chapati','grain','nin',true,'{"calories":297}')`);
  await learnFoods([{ ...row('Chapati', 999), food_id: 42 }]);
  const { rows: ch } = await pool.query(`SELECT per_100g, verified, source FROM foods WHERE name='Chapati'`);
  ck('matched food not written again', ch.length === 1, ch.length);
  ck('verified seed value untouched', ch[0].per_100g.calories === 297, ch[0].per_100g);

  console.log('\n[3] an AI row can never overwrite a verified seed');
  await learnFoods([row('Chapati', 150)]);   // same name, no food_id
  const { rows: ch2 } = await pool.query(
    `SELECT name, source, verified, per_100g FROM foods WHERE LOWER(name)='chapati' ORDER BY source`);
  ck('two rows now exist, one per source', ch2.length === 2, ch2.map(r => r.source));
  const nin = ch2.find(r => r.source === 'nin');
  const ai  = ch2.find(r => r.source === 'ai');
  ck('verified NIN row still 297 kcal', nin.per_100g.calories === 297, nin.per_100g);
  ck('AI row is separate and unverified', ai.verified === false && ai.per_100g.calories === 150, ai.per_100g);

  console.log('\n[4] suspect and implausible values are refused');
  await learnFoods([
    { ...row('Dodgy Whey', 120), warning: 'looks like a per-serving label' },
    row('Impossible Food', 1500),
    row('Zero Food', 0),
    row('X', 200),
  ]);
  const { rows: bad } = await pool.query(
    `SELECT name FROM foods WHERE name IN ('Dodgy Whey','Impossible Food','Zero Food','X')`);
  ck('flagged, implausible, zero and 1-char names all refused', bad.length === 0, bad.map(r => r.name));

  console.log('\n[5] categories');
  await learnFoods([row('Upma', 141), row('Moong Dal Khichdi', 120),
                    row('Buttermilk', 40), row('Mystery Thing', 100)]);
  const { rows: cats } = await pool.query(
    `SELECT name, category FROM foods WHERE source='ai' ORDER BY name`);
  const cat = n => cats.find(r => r.name === n)?.category;
  ck('Upma -> grain', cat('Upma') === 'grain', cat('Upma'));
  ck('Moong Dal Khichdi -> pulse', cat('Moong Dal Khichdi') === 'pulse', cat('Moong Dal Khichdi'));
  ck('Buttermilk -> dairy', cat('Buttermilk') === 'dairy', cat('Buttermilk'));
  ck('unknown -> other', cat('Mystery Thing') === 'other', cat('Mystery Thing'));
  ck('all categories pass the DB check constraint', cats.every(r => CATEGORY_VALUES.includes(r.category)));

  console.log('\n[6] re-logging updates rather than duplicating');
  await learnFoods([row('Upma', 145)]);
  const { rows: up } = await pool.query(`SELECT per_100g FROM foods WHERE name='Upma' AND source='ai'`);
  ck('one row only', up.length === 1, up.length);
  ck('value refreshed to 145', up[0].per_100g.calories === 145, up[0].per_100g);

  console.log(`\n\u2550\u2550\u2550 FOOD LEARNING: ${pass} passed, ${fail} failed \u2550\u2550\u2550`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
