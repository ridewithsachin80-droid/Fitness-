// Integration test of the question branch over real HTTP: stub the pg pool with
// Sachin-like data and stub axios (the AI transport) so callAI returns a
// question flag on the first call and an answer on the second. Proves the full
// wiring: parse → flag → day context (from the stubbed DB) → answer → response.
if (/railway|rlwy\.net|amazonaws|prod/i.test(process.env.DATABASE_URL || '')) {
  console.error('Refusing to run: DATABASE_URL points at a live database.');
  process.exit(1);
}
const path = require('path');
const http = require('http');
process.env.DATABASE_URL = 'postgres://stub:stub@127.0.0.1:1/stub';
process.env.JWT_SECRET = 'smoke-test-secret';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'stub-key';
delete process.env.GROQ_API_KEY;
const SERVER = path.resolve(__dirname, '..');

// Stub pool with a today's log + profile targets
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST-ish
const dayRow = {
  log_date: today, weight_kg: null, water_ml: 800,
  sleep: null, activities: {}, acv: {}, supplements: {},
  food_items: [
    { name: 'Ghee', grams: 12, per_100g: { calories: 900, protein: 0, total_carbs: 0, fat: 99.5 } },
    { name: 'Soppina Palya', grams: 200, per_100g: { calories: 23, protein: 2.9, total_carbs: 3.6, fat: 0.4 } },
  ],
};
// With TEST_DATABASE_URL set, run against a real Postgres (schema.sql loaded,
// member 214 seeded) — this catches SQL syntax and column-name errors a stub
// pool waves through, which is exactly how two such bugs shipped on 26 Aug.
const USE_REAL_DB = !!process.env.TEST_DATABASE_URL;
if (USE_REAL_DB) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const poolPath = require.resolve(path.join(SERVER, 'db/pool.js'));
const stubPool = {
  query: async (sql) => {
    if (/FROM daily_logs/.test(sql)) {
      const twoDaysAgo = new Date(Date.now() + 5.5 * 3600e3 - 2 * 86400e3).toISOString().slice(0, 10);
      const weekRow = { log_date: twoDaysAgo, weight_kg: '84.0', water_ml: 2500, sleep: null,
        activities: {}, acv: {}, supplements: {},
        food_items: [{ name: 'Chapati', grams: 90, per_100g: { calories: 297, protein: 8, total_carbs: 61, fat: 3.7 } }] };
      return { rows: [dayRow, weekRow], rowCount: 2 };
    }
    if (/FROM patient_profiles/.test(sql)) return { rows: [{ macro_kcal: 1800, macro_pro: 120, macro_carb: null, macro_fat: null, water_target: 3000, target_weight: 70, start_weight: 78.5 }], rowCount: 1 };
    if (/member_portions/.test(sql))       return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  },
  connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
  on() {}, end: async () => {},
};
if (!USE_REAL_DB) {
  require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: stubPool, children: [], paths: [] };
}

// Stub axios: first generateContent call = parser (returns question flag),
// second = answerer (echoes context numbers so we can assert data flowed).
const axiosPath = require.resolve('axios', { paths: [SERVER] });
require(axiosPath); // ensure it is in cache
let aiCalls = 0; let capturedPrompts = [];
const fake = async (url, body) => {
  if (!/generativelanguage/.test(String(url))) throw new Error('unexpected url ' + url);
  aiCalls++;
  const prompt = body.contents[0].parts.map(p => p.text || '').join('');
  capturedPrompts.push(prompt);
  let text;
  if (/Member's message: "make the dal 250 grams"/i.test(prompt)) {
    text = JSON.stringify({ reply: 'Updated the dal to 250g.', question: null,
      corrections: [
        { name: 'Dal Tadka', grams: 250, meal: null },
        { name: 'Hallucinated Biryani', grams: 500, meal: null },
        { name: 'Ghee', grams: 99999, meal: null },
      ],
      weight_kg: null, activity_ids: [], acv_ids: [], supplement_ids: [],
      water_ml_add: null, sleep: null, foods: [], workouts: [] });
  } else if (aiCalls === 1) {
    text = JSON.stringify({ reply: '', question: 'how many calories have i consumed today?', weight_kg: null, activity_ids: [], acv_ids: [], supplement_ids: [], water_ml_add: null, sleep: null, foods: [], workouts: [] });
  } else {
    text = "You've eaten 154 kcal so far today, out of your 1800 kcal target — 1646 kcal left.";
  }
  return { data: { candidates: [{ content: { parts: [{ text }] } }] } };
};
const real = require.cache[axiosPath].exports;
const stub = (...a) => fake(...a);
stub.post = fake; stub.get = real.get; stub.create = real.create;
stub.isAxiosError = real.isAxiosError; stub.default = stub;
require.cache[axiosPath].exports = stub;

const rl = http.Server.prototype.listen;
http.Server.prototype.listen = function (...a) { const cb = a.find(x => typeof x === 'function'); cb && cb(); return this; };
const { app } = require(path.join(SERVER, 'index.js'));
http.Server.prototype.listen = rl;
const jwt = require(path.join(SERVER, 'node_modules/jsonwebtoken'));
const token = jwt.sign({ id: 214, role: 'patient', name: 'Sachin' }, 'smoke-test-secret');
const server = app.listen(0); const port = server.address().port;

const req = (body) => new Promise(r => {
  const q = http.request({ host: '127.0.0.1', port, path: '/api/ai-chat/parse', method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token } },
    res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r({ code: res.statusCode, body: JSON.parse(d || '{}') })); });
  q.end(JSON.stringify(body));
});

(async () => {
  const { code, body } = await req({ message: 'how many calories have i consumed today?', context: { waterTargetMl: 3000 } });
  let ok = true;
  const t = (n, c) => { console.log((c ? '  ✓ ' : '  ✗ ') + n); if (!c) ok = false; };
  t('200 response', code === 200);
  t('question flag returned', body.question === true);
  t('reply carries the answer', /154 kcal/.test(body.reply));
  t('no loggable items leak into the preview', body.foods.length === 0 && body.weight_kg === null);
  t('two AI calls made (parse + answer)', aiCalls === 2);
  t('answer prompt contained real computed calories (154 kcal = 108 ghee + 46 palya)', /Calories eaten: 154 kcal/.test(capturedPrompts[1] || ''));
  t('answer prompt contained the calorie target', /calorie target 1800 kcal/.test(capturedPrompts[1] || ''));
  t('answer prompt contained week history (267 kcal chapati day, 84 kg)',
    /267 kcal.*84(\.0)? kg/.test(capturedPrompts[1] || ''));

  // ── Corrections scenario ────────────────────────────────────────────────────
  const corr = await req({
    message: 'make the dal 250 grams',
    context: {
      waterTargetMl: 3000,
      lastFoods: [
        { name: 'Dal Tadka', grams: 150, meal: 'Lunch' },
        { name: 'Ghee', grams: 12, meal: 'Breakfast' },
      ],
      recent: [{ role: 'user', text: '1 katori dal tadka for lunch' },
               { role: 'ai', text: 'Logged Dal Tadka 150g for Lunch.' }],
    },
  });
  t('corrections: 200 response', corr.code === 200);
  t('valid correction passes through', corr.body.corrections?.length >= 1
      && corr.body.corrections[0].name === 'Dal Tadka' && corr.body.corrections[0].grams === 250);
  t('hallucinated food name is whitelisted out',
    !(corr.body.corrections || []).some(c => /biryani/i.test(c.name)));
  t('implausible grams (99999) dropped',
    !(corr.body.corrections || []).some(c => c.name === 'Ghee'));
  t('parse prompt carried the logged-foods list',
    /Dal Tadka · 150g · Lunch/.test(capturedPrompts[2] || ''));
  server.close(); process.exit(ok ? 0 : 1);
})();
