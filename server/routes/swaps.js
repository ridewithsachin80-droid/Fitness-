/**
 * routes/swaps.js — Phase 6: approved food swaps and members' swap requests.
 *
 *   POST /api/swaps/member/:id/suggest   coach: AI suggests alternatives for every food in the plan in force
 *   GET  /api/swaps/member/:id           coach: suggested, requested, approved, declined, by food
 *   POST /api/swaps/member/:id           coach: add one by hand { food_name, alt_name }
 *   POST /api/swaps/:id/decide           coach: { approve: true|false }
 *   GET  /api/swaps/me                   member: approved swaps, by food, plus their open requests
 *   POST /api/swaps/request              member: ask for one { food_name, alt_name, note }
 *
 * Nothing becomes a swap without the coach approving it. Per member, by food
 * name (Sachin, 5 Oct 2026).
 */
const express   = require('express');
const router    = express.Router();
const pool      = require('../db/pool');
const authMW    = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const { getISTDate } = require('../utils/istDate');
const DP = require('../services/dietPlan');
const S  = require('../services/swaps');

router.use(authMW);
const coachOnly = roleCheck('monitor', 'admin');
const D = () => require('./dietPlans');
const fail = (res, err, msg = 'Something went wrong.') => { console.error('swaps:', err.message); res.status(err.status || 500).json({ error: err.status ? err.message : msg }); };

async function guard(req, res) {
  const memberId = parseInt(req.params.id);
  if (!Number.isInteger(memberId)) { res.status(400).json({ error: 'Bad member.' }); return null; }
  if (!(await D().canAccess(req.user, memberId))) { res.status(403).json({ error: 'Member not assigned to you.' }); return null; }
  return memberId;
}
const rowsFor = async (memberId) => (await pool.query(
  `SELECT id, food_name, alt_name, alt_per_100g, status, source, note, created_at, decided_at
     FROM plan_swaps WHERE patient_id = $1 ORDER BY LOWER(food_name), status, LOWER(alt_name)`, [memberId])).rows;

/** Nutrition for a name the member or coach typed: the food table first, then the AI lookup. */
async function nutritionFor(name) {
  try {
    const [e] = await require('./aiChat').enrichFromDB([{ name, grams: 100, per_100g: { calories: 0 } }]);
    if (e && e.source !== 'ai' && Number(e.per_100g?.calories) > 0) return S.per100({ per_100g: e.per_100g });
  } catch (_) { /* fall through */ }
  try {
    const days = [[{ meal: 'x', items: [{ name, grams: 100, per_100g: {} }] }]];
    await D().fillMissingNutrition(days);
    const p = days[0][0].items[0].per_100g;
    if (Number(p?.calories) > 0) return S.per100({ per_100g: p });
  } catch (_) { /* none */ }
  return null;
}

// ── Coach ────────────────────────────────────────────────────────────────────
router.post('/member/:id/suggest', coachOnly, async (req, res) => {
  try {
    const memberId = await guard(req, res); if (!memberId) return;
    const plan = await DP.planInForce(pool, memberId, getISTDate());
    if (!plan) return res.status(409).json({ error: 'Approve a diet plan first; swaps are for foods in it.' });
    const foods = S.planFoods(plan.days);
    const avoid = plan.content?.avoid || [];
    let raw;
    try {
      const { text } = await require('./aiChat').callAI(S.buildSuggestPrompt({ foods, avoid, title: plan.title, brief: plan.brief }), { maxTokens: 6000, timeout: 60000, json: true });
      const a = text.indexOf('{'), b = text.lastIndexOf('}');
      raw = JSON.parse(text.slice(a, b + 1));
    } catch (e) { return res.status(502).json({ error: 'The AI could not suggest swaps just now. Try again in a minute.' }); }
    const rows = S.normaliseSuggestions(raw, foods, avoid);
    let added = 0;
    for (const r of rows) {
      // Never overwrite a decision: an approved or declined pair stays as it is.
      const q = await pool.query(
        `INSERT INTO plan_swaps (patient_id, food_name, alt_name, alt_per_100g, status, source)
         VALUES ($1,$2,$3,$4,'suggested','ai') ON CONFLICT (patient_id, LOWER(food_name), LOWER(alt_name)) DO NOTHING`,
        [memberId, r.food_name, r.alt_name, JSON.stringify(r.alt_per_100g)]);
      added += q.rowCount;
    }
    res.json({ added, swaps: await rowsFor(memberId) });
  } catch (err) { fail(res, err); }
});

router.get('/member/:id', coachOnly, async (req, res) => {
  try { const memberId = await guard(req, res); if (!memberId) return; res.json({ swaps: await rowsFor(memberId) }); }
  catch (err) { fail(res, err); }
});

router.post('/member/:id', coachOnly, async (req, res) => {
  try {
    const memberId = await guard(req, res); if (!memberId) return;
    const food = String(req.body?.food_name || '').trim().slice(0, 100), alt = String(req.body?.alt_name || '').trim().slice(0, 100);
    if (!food || !alt) return res.status(400).json({ error: 'Which food, and what instead?' });
    const p = await nutritionFor(alt);
    if (!p) return res.status(422).json({ error: `Couldn't find calories for "${alt}". Try a more common name.` });
    await pool.query(
      `INSERT INTO plan_swaps (patient_id, food_name, alt_name, alt_per_100g, status, source, decided_at, decided_by)
       VALUES ($1,$2,$3,$4,'approved','coach',NOW(),$5)
       ON CONFLICT (patient_id, LOWER(food_name), LOWER(alt_name)) DO UPDATE SET status='approved', decided_at=NOW(), decided_by=$5`,
      [memberId, food, alt, JSON.stringify(p), req.user.id]);
    res.json({ swaps: await rowsFor(memberId) });
  } catch (err) { fail(res, err); }
});

router.post('/:id/decide', coachOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows: [row] } = await pool.query(`SELECT patient_id, alt_per_100g FROM plan_swaps WHERE id=$1`, [id]);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    if (!(await D().canAccess(req.user, row.patient_id))) return res.status(403).json({ error: 'Member not assigned to you.' });
    const approve = req.body?.approve === true;
    if (approve && !(Number(row.alt_per_100g?.calories) > 0)) return res.status(422).json({ error: 'This swap has no calorie figure yet, so its portion cannot be worked out.' });
    await pool.query(`UPDATE plan_swaps SET status=$2, decided_at=NOW(), decided_by=$3 WHERE id=$1`, [id, approve ? 'approved' : 'declined', req.user.id]);
    res.json({ swaps: await rowsFor(row.patient_id) });
  } catch (err) { fail(res, err); }
});

// ── Member ───────────────────────────────────────────────────────────────────
router.get('/me', roleCheck('patient'), async (req, res) => {
  try {
    const rows = await rowsFor(req.user.id);
    const byFood = {};
    for (const r of rows.filter(x => x.status === 'approved')) {
      (byFood[r.food_name.toLowerCase()] ||= []).push({ id: r.id, name: r.alt_name, per_100g: r.alt_per_100g });
    }
    res.json({ approved: byFood, requests: rows.filter(r => r.status === 'requested').map(r => ({ id: r.id, food_name: r.food_name, alt_name: r.alt_name })) });
  } catch (err) { fail(res, err); }
});

router.post('/request', roleCheck('patient'), async (req, res) => {
  try {
    const food = String(req.body?.food_name || '').trim().slice(0, 100), alt = String(req.body?.alt_name || '').trim().slice(0, 100);
    if (!food || !alt) return res.status(400).json({ error: 'Which food, and what would you like instead?' });
    if (food.toLowerCase() === alt.toLowerCase()) return res.status(400).json({ error: 'That is the same food.' });
    const { rows: [ex] } = await pool.query(
      `SELECT status FROM plan_swaps WHERE patient_id=$1 AND LOWER(food_name)=LOWER($2) AND LOWER(alt_name)=LOWER($3)`, [req.user.id, food, alt]);
    if (ex?.status === 'approved') return res.json({ status: 'approved', message: 'Already approved: pick it from the swaps.' });
    if (ex?.status === 'declined') return res.json({ status: 'declined', message: 'Your coach has said no to that swap. Ask them if you want to talk it through.' });
    const p = await nutritionFor(alt);
    await pool.query(
      `INSERT INTO plan_swaps (patient_id, food_name, alt_name, alt_per_100g, status, source, note)
       VALUES ($1,$2,$3,$4,'requested','member',$5)
       ON CONFLICT (patient_id, LOWER(food_name), LOWER(alt_name)) DO UPDATE SET status='requested', source='member', note=EXCLUDED.note, created_at=NOW()`,
      [req.user.id, food, alt, JSON.stringify(p || {}), String(req.body?.note || '').slice(0, 300) || null]);
    res.json({ status: 'requested', message: 'Sent to your coach. Until they say yes, keep to the plan.' });
  } catch (err) { fail(res, err); }
});

module.exports = router;
