/**
 * scripts/test-swaps.js — Phase 6: approved food swaps and swap requests.
 *
 * Real Postgres and routes; the AI transport is stubbed and routed on each
 * prompt's fixed opening words.
 *
 * WHAT MUST HOLD (Sachin, 5 Oct 2026: AI suggests, coach approves each; per member)
 *   A. Nothing reaches the member until the coach approves it.
 *   B. The AI's suggestions are kept only for foods in the plan, never the food
 *      itself, never anything on the avoid list, never without calories; and a
 *      second round never undoes a coach's decision.
 *   C. A swap keeps the calories: the same grams sum on the server and in the app.
 *   D. A member can ask for a swap; it waits for the coach; a declined one is
 *      not asked again silently; an approved one is just used.
 *   E. Per member: one member's swaps never show for another.
 *   F. The member chat is told only the approved swaps, with their grams.
 */
if (!process.env.DATABASE_URL?.includes('localhost') && !process.env.ALLOW_TEST_DB) {
  console.error('Refusing to run: DATABASE_URL is not localhost.'); process.exit(1);
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'stub-key';
const path = require('path');
const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require(axiosPath);
const realAxios = require.cache[axiosPath].exports;
let suggestAnswer = null, suggestCalls = 0, lastSuggestPrompt = '';
const reply = (text) => ({ data: { candidates: [{ content: { parts: [{ text }] } }], choices: [{ message: { content: text } }] } });
const stubbedPost = async (url, body, cfg) => {
  if (/generativelanguage|groq/.test(String(url))) {
    const sent = body.messages?.[0]?.content || body.contents?.[0]?.parts?.[0]?.text || '';
    if (sent.startsWith('You are helping a fitness coach in India give a member approved food swaps')) {
      suggestCalls++; lastSuggestPrompt = sent; return reply(JSON.stringify(suggestAnswer));
    }
    if (sent.includes('NUTRITION LOOKUP')) {
      return reply(JSON.stringify({ foods: [{ name: 'Banana', kcal_100g: 89, protein_100g: 1.1, carbs_100g: 23, fat_100g: 0.3 },
                                            { name: 'Papaya', kcal_100g: 43, protein_100g: 0.5, carbs_100g: 11, fat_100g: 0.3 }] }));
    }
    return reply('{}');
  }
  return realAxios.post(url, body, cfg);
};
require.cache[axiosPath].exports = new Proxy(realAxios, { get: (t, k) => (k === 'post' ? stubbedPost : t[k]) });

const express = require('express'), jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');
const pool = require('../db/pool');
const DP = require('../services/dietPlan');
const S = require('../services/swaps');
const { importClient } = require('./lib/client-bundle');
const { getISTDate } = require('../utils/istDate');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 300))); };

(async () => {
  console.log('\n[0] the rules (no database)');
  {
    ck('150 g guava (68 kcal/100 g) = 115 g banana (89): same calories, to 5 g', S.swapGrams(150, { calories: 68 }, { calories: 89 }) === 115);
    ck('small amounts round to the gram: 20 g almonds = 19 g cashews', S.swapGrams(20, { calories: 579 }, { calories: 600 }) === 19);
    ck('no calories on either side: no grams, never a guess', S.swapGrams(150, { calories: 0 }, { calories: 89 }) === null && S.swapGrams(150, { calories: 68 }, {}) === null);
    const day = importClient('lib/day/index.js');
    const pairs = [[150, 68, 89], [20, 579, 600], [200, 60, 45], [100, 105, 116], [5, 900, 884], [1250, 265, 40]];
    ck('the app works out the same grams as the server, every time', pairs.every(([g, a, b]) => day.swapGrams(g, { calories: a }, { calories: b }) === S.swapGrams(g, { calories: a }, { calories: b })), pairs.map(([g, a, b]) => [day.swapGrams(g, { calories: a }, { calories: b }), S.swapGrams(g, { calories: a }, { calories: b })]));
    const meal = { meal: 'Meal 2', items: [{ name: 'Guava', grams: 150, per_100g: { calories: 68 } }], pending: [{ name: 'Guava', grams: 150, per_100g: { calories: 68 } }] };
    const r = day.plannedRows(meal, { Guava: { on: true, grams: '115', swap: { name: 'Banana', per_100g: { calories: 89 } } } }, []);
    ck('logging a swap writes the banana, at its grams, under the same meal, and says so', r.rows.length === 1 && r.rows[0].name === 'Banana' && r.rows[0].grams === 115 && r.rows[0].meal === 'Meal 2' && r.changes[0] === 'Banana 115 g instead of Guava', r);
    ck('and keeps the calories within 1%', Math.abs(r.kcal - 102) <= 1, r.kcal);

    const foods = [{ name: 'Guava', meal: 'Meal 2', per_100g: { calories: 68 } }, { name: 'Paneer', meal: 'Meal 1', per_100g: { calories: 265 } }];
    const out = S.normaliseSuggestions({ swaps: [
      { for: 'guava', options: [{ name: 'Banana', kcal_100g: 89 }, { name: 'Guava', kcal_100g: 68 }, { name: 'Apple', kcal_100g: 52 }, { name: 'Mango', kcal_100g: 0 }] },
      { for: 'Paneer', options: [{ name: 'Tofu', kcal_100g: 76 }, { name: 'Sugar-coated nuts', kcal_100g: 500 }] },
      { for: 'Pizza', options: [{ name: 'Burger', kcal_100g: 250 }] }] }, foods, ['sugar']);
    ck('suggestions kept only for plan foods, never the food itself, never with 0 kcal, never on the avoid list',
       out.map(o => `${o.food_name}>${o.alt_name}`).join() === 'Guava>Banana,Guava>Apple,Paneer>Tofu', out.map(o => `${o.food_name}>${o.alt_name}`));
    const p = S.buildSuggestPrompt({ foods, avoid: ['sugar', 'maida'], title: 'Low carb veg' });
    ck('the prompt gives each food\'s nutrition and the avoid list, and says the coach approves', /Guava \(Meal 2\): 68 kcal/.test(p) && /avoid list \(sugar, maida\)/.test(p) && /The coach approves each one/.test(p));
  }

  // ── Database ────────────────────────────────────────────────────────────────
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
  const mk = async (name, phone, role) => (await pool.query(`INSERT INTO users (name,phone,password,role,active) VALUES ($1,$2,'x',$3,true) RETURNING id`, [name, phone, role])).rows[0].id;
  const coach = await mk('Sachin', '9601', 'monitor'), other = await mk('Other Coach', '9602', 'monitor');
  const member = await mk('Padmini', '9603', 'patient'), member2 = await mk('Ravi', '9604', 'patient');
  await pool.query(`INSERT INTO monitor_patients (monitor_id, patient_id, active) VALUES ($1,$2,true), ($1,$3,true)`, [coach, member, member2]);
  await pool.query(`INSERT INTO patient_profiles (user_id) VALUES ($1), ($2)`, [member, member2]);
  const today = getISTDate();
  const it = (name, grams, k) => ({ name, grams, kcal_100g: k, protein_100g: 5, carbs_100g: 10, fat_100g: 3 });
  const draft = DP.normaliseDraft({ title: 'Low carb veg', targets: { kcal: 1500, protein: 110, carbs: 80, fat: 70 },
    meals: [{ meal: 'Meal 1', time: '12:00', items: [it('Paneer', 150, 265), it('Curd', 200, 60)] }, { meal: 'Meal 2', time: '16:00', items: [it('Guava', 150, 68)] }], avoid: ['sugar'] });
  const inTx = async (fn) => { const c = await pool.connect(); try { await c.query('BEGIN'); const o = await fn(c); await c.query('COMMIT'); return o; } finally { c.release(); } };
  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use('/api/swaps', require('../routes/swaps'));
  const srv = app.listen(0); const port = srv.address().port;
  const tok = (id, role) => jwt.sign({ id, role, name: 'T' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const M = tok(member, 'patient'), M2 = tok(member2, 'patient'), C = tok(coach, 'monitor'), O = tok(other, 'monitor');
  const call = async (method, p, t, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  suggestAnswer = { swaps: [{ for: 'Guava', options: [{ name: 'Banana', kcal_100g: 89, protein_100g: 1.1, carbs_100g: 23, fat_100g: 0.3 }, { name: 'Apple', kcal_100g: 52 }] },
                            { for: 'Paneer', options: [{ name: 'Tofu', kcal_100g: 76, protein_100g: 8 }, { name: 'Sugar-free biscuits', kcal_100g: 450 }] }] };

  console.log('\n[1] the AI suggests, the coach decides');
  let rows;
  {
    ck('no plan in force yet: suggesting is refused, the AI is not called', (await call('POST', `/api/swaps/member/${member}/suggest`, C)).status === 409 && suggestCalls === 0);
    const id = await inTx(c => DP.saveDraft(c, { memberId: member, coachId: coach, source: 'brief', title: draft.title, brief: 'veg only', targets: draft.targets, content: draft.content, flags: [], days: draft.days }));
    await inTx(c => DP.approveDraft(c, id, { coachId: coach, today, effectiveFrom: today, acknowledgeWarnings: true }));
    ck('another coach cannot ask for suggestions', (await call('POST', `/api/swaps/member/${member}/suggest`, O)).status === 403);
    ck('a member cannot use the coach route', (await call('POST', `/api/swaps/member/${member}/suggest`, M)).status === 403);
    const r = await call('POST', `/api/swaps/member/${member}/suggest`, C);
    rows = r.data.swaps;
    ck('the AI is given the plan\'s foods and its avoid list', /Guava \(Meal 2\)/.test(lastSuggestPrompt) && /Paneer \(Meal 1\)/.test(lastSuggestPrompt) && /\(sugar\)/.test(lastSuggestPrompt));
    ck('three suggestions saved (the "sugar" one dropped), all waiting', r.status === 200 && r.data.added === 3 && rows.every(x => x.status === 'suggested' && x.source === 'ai'), rows?.map(x => [x.alt_name, x.status]));
    ck('the member sees none of them yet', Object.keys((await call('GET', '/api/swaps/me', M)).data.approved).length === 0);
    const banana = rows.find(x => x.alt_name === 'Banana'), apple = rows.find(x => x.alt_name === 'Apple');
    ck('another coach cannot decide', (await call('POST', `/api/swaps/${banana.id}/decide`, O, { approve: true })).status === 403);
    await call('POST', `/api/swaps/${banana.id}/decide`, C, { approve: true });
    await call('POST', `/api/swaps/${apple.id}/decide`, C, { approve: false });
    const me = (await call('GET', '/api/swaps/me', M)).data;
    ck('approved: the member now has Guava -> Banana, and only that', JSON.stringify(Object.keys(me.approved)) === '["guava"]' && me.approved.guava.length === 1 && me.approved.guava[0].name === 'Banana' && me.approved.guava[0].per_100g.calories === 89, me);
    const again = await call('POST', `/api/swaps/member/${member}/suggest`, C);
    const st = Object.fromEntries(again.data.swaps.map(x => [x.alt_name, x.status]));
    ck('suggesting again never undoes a decision', again.data.added === 0 && st.Banana === 'approved' && st.Apple === 'declined' && st.Tofu === 'suggested', st);
    ck('a member\'s swaps are theirs: the other member sees none', Object.keys((await call('GET', '/api/swaps/me', M2)).data.approved).length === 0);
  }

  console.log('\n[2] the member asks for one');
  {
    let r = await call('POST', '/api/swaps/request', M, { food_name: 'Guava', alt_name: 'Papaya', note: 'guava is not in season' });
    ck('asking for papaya: sent to the coach, "keep to the plan until then"', r.status === 200 && r.data.status === 'requested' && /keep to the plan/.test(r.data.message), r.data);
    const reqRow = (await call('GET', `/api/swaps/member/${member}`, C)).data.swaps.find(x => x.alt_name === 'Papaya');
    ck('the coach sees the request, with the note and calories looked up', reqRow?.status === 'requested' && reqRow.source === 'member' && reqRow.note === 'guava is not in season' && reqRow.alt_per_100g.calories === 43, reqRow);
    ck('it is not usable before the coach approves', !(await call('GET', '/api/swaps/me', M)).data.approved.guava.some(a => a.name === 'Papaya'));
    ck('the member sees it as waiting', (await call('GET', '/api/swaps/me', M)).data.requests.some(q => q.alt_name === 'Papaya'));
    r = await call('POST', '/api/swaps/request', M, { food_name: 'Guava', alt_name: 'apple' });
    ck('asking for one the coach declined: told so, not quietly re-sent', r.data.status === 'declined' && /said no/.test(r.data.message) && (await pool.query(`SELECT status FROM plan_swaps WHERE LOWER(alt_name)='apple'`)).rows[0].status === 'declined');
    r = await call('POST', '/api/swaps/request', M, { food_name: 'guava', alt_name: 'BANANA' });
    ck('asking for one already approved: just use it', r.data.status === 'approved');
    ck('the same food is refused', (await call('POST', '/api/swaps/request', M, { food_name: 'Guava', alt_name: 'guava' })).status === 400);
    await call('POST', `/api/swaps/${reqRow.id}/decide`, C, { approve: true });
    ck('approved by the coach: now one of the member\'s swaps', (await call('GET', '/api/swaps/me', M)).data.approved.guava.map(a => a.name).sort().join() === 'Banana,Papaya');
    const hand = await call('POST', `/api/swaps/member/${member}`, C, { food_name: 'Curd', alt_name: 'Banana' });
    ck('the coach can add one by hand; it is approved at once, with calories looked up', hand.status === 200 && hand.data.swaps.some(x => x.food_name === 'Curd' && x.alt_name === 'Banana' && x.status === 'approved' && x.alt_per_100g.calories === 89), hand.data);
    const noCal = (await pool.query(`INSERT INTO plan_swaps (patient_id, food_name, alt_name, alt_per_100g, status, source) VALUES ($1,'Paneer','Mystery','{}','requested','member') RETURNING id`, [member])).rows[0].id;
    ck('a swap with no calories cannot be approved (its portion cannot be worked out)', (await call('POST', `/api/swaps/${noCal}/decide`, C, { approve: true })).status === 422);
  }

  console.log('\n[2b] the coach is told a member is waiting');
  {
    const { composeMember } = require('../services/triage');
    const base = { logs: [], protocol: {}, daysSince: 0, todayStr: today, hour: 10 };
    const t = composeMember({ id: 1, name: 'Padmini' }, { ...base, swapRequests: 2 });
    ck('the coach\'s Needs attention feed says "Asked for 2 swaps"', t.reasons.includes('Asked for 2 swaps'), t.reasons);
    ck('and says nothing when none are waiting', !composeMember({ id: 1, name: 'Padmini' }, base).reasons.some(r => /swap/.test(r)));
  }

  console.log('\n[3] what the member chat is told');
  {
    const lines = (await DP.memberPlanLines(pool, member, today, [])).join('\n');
    ck('the approved swaps, with the grams that keep the calories', /Approved swaps \(only these\): Curd -> Banana \(135 g\); Guava -> Banana \(115 g\); Guava -> Papaya \(235 g\)/.test(lines), lines.split('\n').pop());
    ck('not the declined, suggested or requested ones', !/Apple|Tofu|Mystery/.test(lines));
    ck('another member\'s chat has no swaps', !/Approved swaps/.test((await DP.memberPlanLines(pool, member2, today, [])).join('\n')));
  }

  console.log(`\n${fail === 0 ? '\u2713' : '\u2717'} test-swaps: ${pass} passed, ${fail} failed\n`);
  srv.close(); await pool.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
