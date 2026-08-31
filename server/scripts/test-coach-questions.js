/**
 * test-coach-questions.js — the coach AI can READ, not just write.
 *
 * Before this, every question the coach asked ("how many calories has Padmini
 * eaten today") had no matching operation, so the model fell back to "what
 * would you like to update?" — and kept doing that however the coach
 * rephrased it. Reads meant leaving the chat and opening the member.
 *
 * Full HTTP flow with only the AI transport stubbed, matching the pattern in
 * test-coach-program.js. Two AI calls happen per question — the parse, then
 * the answer — so the stub routes on which prompt it is looking at.
 *
 * Modes:
 *   default                    — stubbed pg pool (wiring + validation)
 *   TEST_DATABASE_URL=…        — real Postgres
 */
const path = require('path');
const http = require('http');
const assert = require('assert');

const SERVER = path.resolve(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'coach-q-secret';
process.env.GEMINI_API_KEY = 'stub-key';
process.env.NODE_ENV = 'test';

const USE_REAL_DB = !!process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = USE_REAL_DB
  ? process.env.TEST_DATABASE_URL
  : 'postgres://stub:stub@127.0.0.1:1/stub';

const MEMBER = { id: 214, name: 'Mrs. Padmini' };
const COACH  = { id: 300, name: 'Sachin', role: 'monitor' };

// ── pg stub ──────────────────────────────────────────────────────────────────
const poolPath = require.resolve(path.join(SERVER, 'db/pool.js'));
if (!USE_REAL_DB) {
  const stub = {
    query: async (sql) => {
      if (/monitor_patients/.test(sql)) return { rows: [MEMBER], rowCount: 1 };
      if (/FROM daily_logs/.test(sql) && /log_date = \$2::date/.test(sql)) {
        // roster snapshot
        return { rows: [{ patient_id: 214, weight_kg: '84.9', water_ml: 1500,
                          food_items: [{ name: 'Idli', grams: 120, per_100g: { calories: 120, protein: 4, total_carbs: 20, fat: 1 } }],
                          compliance_pct: 40 }], rowCount: 1 };
      }
      if (/FROM daily_logs/.test(sql)) {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
        return { rows: [{ log_date: today, weight_kg: '84.9', water_ml: 1500,
                          sleep: { bedtime: '23:00', waketime: '06:30' },
                          activities: { walk: true }, acv: { acv1: true }, supplements: {},
                          food_items: [{ name: 'Idli', grams: 120, per_100g: { calories: 120, protein: 4, total_carbs: 20, fat: 1 } }] }],
                 rowCount: 1 };
      }
      if (/FROM patient_profiles/.test(sql)) {
        return { rows: [{ macro_kcal: 1600, macro_pro: 100, water_target: 3000,
                          target_weight: '74.0', start_weight: '90.0',
                          protocol_activities: [{ id: 'walk', label: 'Morning Walk' },
                                                { id: 'yoga', label: 'Yoga' }],
                          protocol_acv: [{ id: 'acv1', label: 'ACV before meal 1' },
                                         { id: 'acv2', label: 'ACV before meal 2' }],
                          protocol_supplements: [{ id: 'whey', label: 'Whey' },
                                                 { id: 'd3', label: 'Vitamin D3' }] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    connect: async () => ({ query: async (s) => stub.query(s), release() {} }),
    on() {}, end: async () => {},
  };
  require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true,
                              exports: stub, children: [], paths: [] };
}

// ── AI stub ──────────────────────────────────────────────────────────────────
// Routes on the PROMPT, because a question makes two calls: parse, then answer.
const axiosPath = require.resolve('axios', { paths: [SERVER] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;

let lastAnswerPrompt = null;
let parseResponse = null;   // set per test

const wrap = (obj) => ({ data: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });
const wrapText = (t) => ({ data: { candidates: [{ content: { parts: [{ text: t }] } }] } });

require.cache[axiosPath].exports = {
  ...realAxios,
  post: async (url, body, opts) => {
    const prompt = body?.contents?.[0]?.parts?.[0]?.text || '';
    if (/Return ONLY the answer text/.test(prompt)) {
      lastAnswerPrompt = prompt;
      return wrapText('Padmini has eaten 144 kcal today against a 1600 kcal target.');
    }
    return wrap(parseResponse);
  },
};

// ── boot ─────────────────────────────────────────────────────────────────────
const realListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  const cb = args.find(a => typeof a === 'function'); if (cb) cb(); return this;
};
const mod = require(path.join(SERVER, 'index.js'));
const app = mod && (mod.app || mod.default || mod);
http.Server.prototype.listen = realListen;

const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const token = jwt.sign({ id: COACH.id, role: COACH.role, name: COACH.name },
                       process.env.JWT_SECRET, { expiresIn: '1h' });

const server = app.listen(0);
const port = server.address().port;

function post(pathname, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const r = http.request({ host: '127.0.0.1', port, path: pathname, method: 'POST',
      agent: new http.Agent({ keepAlive: false }),
      headers: { 'content-type': 'application/json',
                 'content-length': Buffer.byteLength(data),
                 authorization: `Bearer ${token}` } },
      (res) => { let b = ''; res.on('data', c => b += c);
                 res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') })); });
    r.on('error', () => resolve({ status: 0, body: {} }));
    r.end(data);
  });
}

let pass = 0, fail = 0;
const ok  = (n) => { pass++; console.log(`  ✓ ${n}`); };
const bad = (n, d) => { fail++; console.log(`  ✗ ${n}\n      ${d}`); };
const eq  = (n, a, b) => (String(a) === String(b)) ? ok(n) : bad(n, `expected ${b}, got ${a}`);

(async () => {
  console.log('\nCOACH QUESTIONS');

  // ── a question about a named member ────────────────────────────────────────
  parseResponse = { reply: null, question: { member_name: 'padmini', text: 'how many calories today' }, commands: [] };
  let r = await post('/api/ai-chat/coach-parse', { message: 'check how many calories padmini eaten today' });
  eq('question returns 200', r.status, 200);
  eq('an answer comes back', !!r.body.answer, true);
  eq('it is attributed to the member', r.body.answered_for, 'Mrs. Padmini');
  // The critical property: no Apply card for something with nothing to apply.
  eq('no actions are offered for a question', (r.body.actions || []).length, 0);
  eq('the old "what would you like to update" reply is gone', r.body.reply, 'null');

  // The model must be given real logged data, not asked to guess.
  eq('the answer prompt carries real food data', /Idli 120g/.test(lastAnswerPrompt), true);
  eq('it carries the calorie target',           /calorie target 1600 kcal/.test(lastAnswerPrompt), true);
  eq('it forbids inventing numbers',            /Never invent/.test(lastAnswerPrompt), true);

  // ── "what is still pending" — precomputed, not left to the model ───────────
  parseResponse = { reply: null, question: { member_name: 'Padmini', text: 'what activities are left today' }, commands: [] };
  r = await post('/api/ai-chat/coach-parse', { message: 'what all activities are left to be done by padmini' });
  eq('pending question answered', !!r.body.answer, true);
  // walk is done, yoga and the ACV are not — subtracting two lists is exactly
  // what a model gets wrong, so the server does it.
  eq('STILL PENDING is computed server-side', /STILL PENDING today:/.test(lastAnswerPrompt), true);
  eq('a done activity is excluded from pending',
     /STILL PENDING today: activities Yoga/.test(lastAnswerPrompt), true);
  eq('an undone ACV item is listed as pending',
     /ACV ACV before meal 2/.test(lastAnswerPrompt), true);
  eq('a DONE ACV item is not listed as pending',
     /STILL PENDING[^\n]*ACV before meal 1/.test(lastAnswerPrompt), false);

  // ── roster-wide question ──────────────────────────────────────────────────
  parseResponse = { reply: null, question: { member_name: null, text: "who hasn't logged today" }, commands: [] };
  r = await post('/api/ai-chat/coach-parse', { message: "who hasn't logged today" });
  eq('roster question answered', !!r.body.answer, true);
  eq('not attributed to one member', r.body.answered_for, 'null');
  eq('the roster snapshot lists members', /Mrs\. Padmini:/.test(lastAnswerPrompt), true);

  // ── unknown member ────────────────────────────────────────────────────────
  parseResponse = { reply: null, question: { member_name: 'Nobody', text: 'calories today' }, commands: [] };
  r = await post('/api/ai-chat/coach-parse', { message: 'how many calories has Nobody eaten' });
  eq('unknown member is reported, not guessed', /couldn't find a member/i.test(r.body.reply), true);
  eq('no answer is fabricated', r.body.answer, 'null');

  // ── commands still work ───────────────────────────────────────────────────
  parseResponse = { reply: 'Setting water to 4L.', question: null,
                    commands: [{ member_name: 'Padmini', water_target: 4000 }] };
  r = await post('/api/ai-chat/coach-parse', { message: 'set padmini water to 4 litres' });
  eq('a command is still parsed into an action', (r.body.actions || []).length, 1);
  eq('a command returns no answer', r.body.answer, 'undefined');
  eq('the command reply survives', r.body.reply, 'Setting water to 4L.');

  // ── A full-day summary must contain everything, precomputed ───────────────
  // "give today's summary of Padmini" should cover eaten + left, activities
  // done + left, water drunk + left, supplements taken + left. The model is
  // only allowed to phrase these, so every one has to be IN the snapshot.
  console.log('\nSUMMARY COMPLETENESS');
  parseResponse = { reply: null, question: { member_name: 'Padmini', text: "today's summary" }, commands: [] };
  await post('/api/ai-chat/coach-parse', { message: "give todays summary of padmini" });
  const ctx = lastAnswerPrompt;

  eq('calories eaten present',        /Calories eaten: \d+ kcal/.test(ctx), true);
  eq('calories REMAINING precomputed', /Calories remaining: \d+ kcal left of 1600/.test(ctx), true);
  eq('food items listed',             /Food logged: Idli 120g/.test(ctx), true);
  eq('water drunk present',           /Water drunk: 1500 ml of 3000 ml target/.test(ctx), true);
  eq('water REMAINING precomputed',   /Water remaining: 1500 ml/.test(ctx), true);
  eq('activities done listed',        /Activities done \(1\/2\): Morning Walk/.test(ctx), true);
  eq('activities left listed',        /Activities still to do: Yoga/.test(ctx), true);
  eq('ACV done listed',               /ACV done \(1\/2\): ACV before meal 1/.test(ctx), true);
  eq('supplements taken listed',      /Supplements taken \(0\/2\): none/.test(ctx), true);
  eq('ACV left listed',               /ACV still to do: ACV before meal 2/.test(ctx), true);
  eq('supplements left listed',       /Supplements still to take: Whey, Vitamin D3/.test(ctx), true);
  eq('weight present',                /Weight: 84\.9 kg/.test(ctx), true);
  eq('sleep present',                 /Sleep: 23:00-06:30/.test(ctx), true);

  // Labels, not raw ids, on BOTH sides. The done side used to print "walk"
  // while the pending side printed "Yoga" — one protocol described two ways
  // in a single sentence.
  eq('done side uses labels, not raw ids', /Activities done \(1\/2\): walk/.test(ctx), false);

  // The prompt must permit a long answer, or a summary gets crushed into
  // three sentences and loses most of this.
  eq('the prompt allows a full rundown', /SUMMARY \/ RUNDOWN/.test(ctx), true);
  eq('the prompt forbids self-calculation', /Never calculate anything yourself/.test(ctx), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
})();
