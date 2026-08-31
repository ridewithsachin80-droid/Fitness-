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
      // Route on ANY($1::int[]), not on log_date: the single-member summary
      // query also filters by log_date, so matching on that sent it into the
      // roster branch and it came back with a different day's numbers.
      if (/FROM daily_logs/.test(sql) && /ANY\(\$1::int\[\]\)/.test(sql)) {
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

  // ── A full-day summary comes back STRUCTURED, not as model prose ──────────
  // The first version had the model format it and it arrived as one run-on
  // paragraph. The numbers were already computed in SQL, so handing them to a
  // model to retype was formatting risk for no gain.
  console.log('\nDAY SUMMARY');
  lastAnswerPrompt = null;
  parseResponse = { reply: null, commands: [],
    question: { member_name: 'Padmini', text: "today's summary", scope: 'summary' } };
  let r2 = await post('/api/ai-chat/coach-parse', { message: "give todays summary of padmini" });

  eq('summary returns 200', r2.status, 200);
  const sum = r2.body.summary;
  eq('a structured summary is returned', !!sum, true);
  eq('no prose answer for a summary', r2.body.answer, 'null');
  eq('attributed to the member', r2.body.answered_for, 'Mrs. Padmini');
  // The whole point: the model is not involved in a summary at all.
  eq('the model was NOT asked to format it', lastAnswerPrompt, 'null');

  eq('calories eaten',      sum.food.kcal, 144);
  eq('macros present',      `${sum.food.protein}/${sum.food.carbs}/${sum.food.fat}`, '4.8/24/1.2');
  eq('calorie target',      sum.food.target, 1600);
  eq('calories REMAINING precomputed', sum.food.remaining, 1456);
  eq('not flagged as over',  sum.food.over, false);
  eq('food items listed',    sum.food.items.map(i => i.name).join(','), 'Idli');

  eq('water drunk',          sum.water.drunk, 1500);
  eq('water target',         sum.water.target, 3000);
  eq('water REMAINING precomputed', sum.water.remaining, 1500);

  eq('activities done as labels', sum.activities.done.join(','), 'Morning Walk');
  eq('activities left as labels', sum.activities.left.join(','), 'Yoga');
  eq('acv done',                  sum.acv.done.join(','), 'ACV before meal 1');
  eq('acv left',                  sum.acv.left.join(','), 'ACV before meal 2');
  eq('supplements taken (none)',  sum.supplements.done.length, 0);
  eq('supplements left',          sum.supplements.left.join(','), 'Whey,Vitamin D3');
  // "nothing assigned" and "assigned but none done" both read as "none" but
  // mean opposite things to a coach, so they are distinguishable.
  eq('supplements are marked as assigned', sum.supplements.assigned, true);

  eq('weight present', sum.weight, 84.9);
  eq('sleep present',  sum.sleep, '23:00–06:30');
  eq('logged_anything flag', sum.logged_anything, true);

  // A SPECIFIC question must still go through the model — phrasing helps there.
  lastAnswerPrompt = null;
  parseResponse = { reply: null, commands: [],
    question: { member_name: 'Padmini', text: 'how much water is left', scope: 'specific' } };
  const r3 = await post('/api/ai-chat/coach-parse', { message: 'how much water is left for padmini' });
  eq('a specific question still returns prose', !!r3.body.answer, true);
  eq('a specific question has no summary card', r3.body.summary, 'undefined');
  eq('the model WAS used for the specific question', !!lastAnswerPrompt, true);

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
})();
