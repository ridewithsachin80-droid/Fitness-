/**
 * scripts/test-learning-features.js — Fixes-2m: the app's existing "learning"
 * features, checked end to end through the REAL parse (routes/aiChat.js
 * parseMemberMessage) on real Postgres. Only the AI provider is stubbed (Groq
 * chat), so what reaches the AI and what comes back can be checked.
 *
 * Two gaps the 19 Oct feature review found in the existing suites:
 *   1. Portion memory: test-portion-memory proves the grams are stored and
 *      averaged, but nothing proved they reach the AI for THAT member only.
 *   2. Reusing saved food estimates: test-food-learning tests a COPY of
 *      learnFoods, and nothing proved the round trip: a food the AI estimated
 *      once is saved, and the next parse uses the saved numbers.
 * Both are automatic personalisation (nothing to press). The voice pilot and
 * correction samples are evaluation tools and are tested in their own suites.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GROQ_API_KEY = 'stub-groq'; delete process.env.GEMINI_API_KEY;
const path = require('path');
const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
let reply = {}; const prompts = [];
const stubbedPost = async (url, body, cfg) => {
  if (String(url).includes('api.groq.com/openai/v1/chat/completions')) {
    prompts.push(body?.messages?.map(m => m.content).join('\n') || '');
    return { data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }] } };
  }
  return realAxios.post(url, body, cfg);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const pool = require('../db/pool');
const ai = require('../routes/aiChat');
let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  ✓ ' + n))
                            : (fail++, console.log('  ✗ ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };
const base = (foods) => ({ weight_kg: null, activities: [], acv: [], supplements: [], water_ml_add: null, sleep: null, foods, workouts: [], reply: 'Logged.' });
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  ai.setControlSampler?.(() => false);
  const tag = Date.now().toString(36);
  // Other suites insert users with fixed ids; move the sequence past them.
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1))`);
  const mk = async (name) => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x','patient',true) RETURNING id`, [name, '7' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0')])).rows[0].id;
  const a = await mk(`Learn A ${tag}`), b = await mk(`Learn B ${tag}`);
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1), ($2) ON CONFLICT DO NOTHING`, [a, b]);

  console.log('\n[1] personal portion memory reaches the AI, for that member only');
  {
    await pool.query(`INSERT INTO member_portions (patient_id, phrase, grams, samples) VALUES ($1, 'katori dal', 210, 2)`, [a]);
    reply = base([]);
    prompts.length = 0; await ai.parseMemberMessage({ userId: a, message: 'had 1 katori dal for lunch', context: {} });
    const pa = prompts[0] || '';
    prompts.length = 0; await ai.parseMemberMessage({ userId: b, message: 'had 1 katori dal for lunch', context: {} });
    const pb = prompts[0] || '';
    ck('member A\'s parse prompt carries their own "katori dal = 210g"', /THIS MEMBER'S OWN PORTION SIZES[\s\S]*katori dal = 210g/.test(pa), pa.slice(pa.indexOf('THIS MEMBER'), pa.indexOf('THIS MEMBER') + 200));
    ck('member B (no memory) gets the generic table, never A\'s grams', /none recorded yet/.test(pb) && !/katori dal = 210g/.test(pb));
  }

  console.log('\n[2] a food the AI estimated once is saved and reused next time');
  {
    const name = `Kosambari Test ${tag}`;
    const first = { name, qty_text: '1 bowl', grams: 150, meal: 'Lunch', category: 'veg', per_100g: { calories: 80, protein: 4, total_carbs: 10, fat: 2.5, iron: 1.1 } };
    reply = base([first]);
    const r1 = await ai.parseMemberMessage({ userId: a, message: `1 bowl ${name}`, context: {} });
    await wait(300);   // learnFoods runs after the reply (fire-and-forget)
    const saved = (await pool.query(`SELECT id, source, verified, per_100g FROM foods WHERE lower(name) = lower($1)`, [name])).rows[0];
    ck('first time: the AI\'s estimate is saved as an unverified AI food, marked as an AI estimate', r1 && saved && saved.source === 'ai' && saved.verified === false
       && Number(saved.per_100g.calories) === 80 && saved.per_100g._status?.iron === 'ai', saved);
    // Next time the model says different numbers for the same food: the saved ones are used.
    reply = base([{ ...first, per_100g: { calories: 140, protein: 9, total_carbs: 15, fat: 6, iron: 3 } }]);
    const r2 = await ai.parseMemberMessage({ userId: b, message: `1 bowl ${name}`, context: {} });
    const f2 = r2.foods?.[0] || {};
    ck('second time (another member): the saved numbers are used, not the new guess (80 kcal per 100 g, not 140)', Number(f2.per_100g?.calories) === 80 && f2.food_id === saved.id, f2);
    ck('the reused food still says its iron is an AI estimate', f2.per_100g?._status?.iron === 'ai', f2.per_100g?._status);
    ck('the AI is still asked every time (only the numbers are reused)', prompts.length >= 2);
  }

  await pool.query(`DELETE FROM foods WHERE name = $1`, [`Kosambari Test ${tag}`]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[a, b]]);
  console.log(`\n${fail === 0 ? '✓' : '✗'} test-learning-features: ${pass} passed, ${fail} failed\n`);
  await pool.end(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
