/**
 * routes/dietPlans.js — Diet Plan Studio (Phase 1).
 *
 * Coach:
 *   POST  /api/diet-plans/draft                    brief (or change request) -> AI draft
 *   GET   /api/diet-plans/member/:memberId         plan in force, upcoming, draft, history
 *   POST  /api/diet-plans/member/:memberId/revise  copy the plan in force into a draft
 *   GET   /api/diet-plans/:id                      one version in full
 *   PATCH /api/diet-plans/:id                      edit a draft
 *   POST  /api/diet-plans/:id/fit                  Fit to target: preview, or apply:true to save
 *   POST  /api/diet-plans/:id/approve              approve a draft
 *   POST  /api/diet-plans/:id/discard              throw a draft away
 * Member:
 *   GET   /api/diet-plans/me                       the approved plan in force — never a draft
 *
 * The model writes a first draft and nothing else. Flags, checks, versions,
 * approval and what the member sees are all decided in services/dietPlan.js.
 * Nothing reaches a member until a coach approves it.
 */
const express   = require('express');
const router    = express.Router();
const pool      = require('../db/pool');
const authMW    = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const { getISTDate } = require('../utils/istDate');
const DP = require('../services/dietPlan');

router.use(authMW);

const coachOnly = roleCheck('monitor', 'admin');

async function canAccess(user, memberId) {
  if (user.role === 'admin') return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM monitor_patients WHERE monitor_id=$1 AND patient_id=$2 AND active=true`,
    [user.id, memberId]);
  return rows.length > 0;
}

const fail = (res, err) => {
  const status = err.status || 500;
  if (status >= 500) console.error('diet-plans error:', err.message);
  res.status(status).json({ error: err.message, ...(err.checks ? { checks: err.checks } : {}), ...(err.needsAck ? { needs_ack: true } : {}) });
};

async function inTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function audit(user, action, memberId, detail) {
  return pool.query(
    `INSERT INTO audit_log (actor_id, actor_name, actor_role, action, target_id, target_name, detail)
     VALUES ($1,$2,$3,$4,$5,(SELECT name FROM users WHERE id=$5),$6)`,
    [user.id, user.name || null, user.role, action, memberId, detail]).catch(() => {});
}

/** What the coach sees for a version: the plan, plus what changed against the
 *  plan currently in force. */
async function present(plan, today) {
  if (!plan) return null;
  const inForce = plan.status === 'draft' ? await DP.planInForce(pool, plan.patient_id, today) : null;
  return { ...plan, diff: inForce ? DP.diffPlans(inForce, plan) : null, compared_to_version: inForce ? inForce.version : null };
}

// ── What the model is given and asked for ────────────────────────────────────

async function memberContext(memberId, today) {
  const [{ rows: [u] }, { rows: [p] }, { rows: [w] }, { rows: labs }] = await Promise.all([
    pool.query(`SELECT id, name FROM users WHERE id=$1 AND role='patient'`, [memberId]),
    pool.query(`SELECT dob::text AS dob, height_cm, start_weight, target_weight, conditions, diet_notes
                  FROM patient_profiles WHERE user_id=$1`, [memberId]),
    pool.query(`SELECT weight_kg, log_date::text AS d FROM daily_logs
                 WHERE patient_id=$1 AND weight_kg IS NOT NULL ORDER BY log_date DESC LIMIT 1`, [memberId]),
    pool.query(`SELECT test_name, value, unit, status, test_date::text AS test_date
                  FROM lab_values WHERE patient_id=$1 ORDER BY test_date DESC LIMIT 200`, [memberId]),
  ]);
  if (!u) return null;
  const prof = p || {};
  const age = prof.dob ? Math.floor((new Date(`${today}T00:00:00Z`) - new Date(`${prof.dob}T00:00:00Z`)) / (365.25 * 86400000)) : null;
  return {
    name: u.name, age,
    height_cm: prof.height_cm != null ? Number(prof.height_cm) : null,
    weight_kg: w ? Number(w.weight_kg) : (prof.start_weight != null ? Number(prof.start_weight) : null),
    weight_date: w ? w.d : null,
    target_weight: prof.target_weight != null ? Number(prof.target_weight) : null,
    diet_notes: prof.diet_notes || null,
    flags: DP.buildFlags(labs, prof.conditions, today),
  };
}

// "Soppu" is a family of leafy greens, not one vegetable. Shared by the draft
// prompt and the nutrition lookup so both name the same things.
const GREENS_RULE = 'Soppu / sopina means leafy greens. Name the actual green: palak, dantu (amaranth), sabsige (dill), menthya (methi), harive. Never write "kale", and never a bare "soppu".';

/** A calorie figure the coach wrote in the brief ("1500 kcal", "1,800 calories"). */
function kcalFromBrief(brief) {
  const m = String(brief || '').match(/(\d{1,2},?\d{3})\s*(?:k?cal|calories)/i);
  const n = m ? parseInt(m[1].replace(',', '')) : NaN;
  return Number.isFinite(n) && n >= 800 && n <= 6000 ? n : null;
}

function buildDraftPrompt(ctx, brief, { base, instruction } = {}) {
  const facts = [
    ctx.age != null && `Age: ${ctx.age}`,
    ctx.height_cm != null && `Height: ${ctx.height_cm} cm`,
    ctx.weight_kg != null && `Weight: ${ctx.weight_kg} kg${ctx.weight_date ? ` (logged ${ctx.weight_date})` : ''}`,
    ctx.target_weight != null && `Target weight: ${ctx.target_weight} kg`,
    ctx.diet_notes && `Diet notes on file: ${ctx.diet_notes}`,
  ].filter(Boolean).join('\n') || 'No profile details on file.';
  const flags = ctx.flags.length
    ? ctx.flags.map(f => `- ${f.text}${f.date ? ` (${f.date}${f.stale ? ', old result' : ''})` : ''}`).join('\n')
    : 'None on file.';

  // The exact numbers, when we know the target: "about kcal" produced a
  // 2,206 kcal Monday on a 1,500 kcal plan.
  const pct = Math.round(DP.KCAL_MARGIN * 100);
  const kcal = base?.targets?.kcal || kcalFromBrief(brief);
  const carbs = base?.targets?.carbs || null;
  const range = kcal ? DP.kcalRange(kcal) : null;
  const allowed = [
    range && `ALLOWED RANGE PER DAY: ${range.lo} to ${range.hi} kcal (target ${kcal}). Every weekday must land inside it.`,
    carbs && `CARB LIMIT PER DAY: ${carbs} g. No weekday may go above it.`,
  ].filter(Boolean).join('\n');

  return `You are drafting a diet plan for a fitness coach in India to review. The coach
approves or changes everything; the member never sees your draft directly. This
is dietary guidance, not medical treatment.

MEMBER
${facts}

OUT-OF-RANGE LAB RESULTS AND CONDITIONS ON FILE
${flags}

COACH'S BRIEF
message: ${String(brief || '').slice(0, 2000)}
${base ? `\nCURRENT DRAFT (JSON, in the same shape you must return)\n${JSON.stringify(base).slice(0, 12000)}\n\nCHANGE REQUESTED BY THE COACH\nmessage: ${String(instruction || '').slice(0, 1000)}\nReturn the whole plan again with that change made and everything else kept, in the JSON shape below ("meals" with "items" and "rotation"; never a list of days).\nKeep every existing caution, avoid-list entry and timetable row word for word unless the change request is about that line.\nItems marked "compulsory" keep their grams and stay compulsory unless the change request names that item.\n` : ''}${allowed ? `\n${allowed}\n` : ''}
Rules:
- Follow the brief. Where it names foods, meal count, fasting window or timings, use them.
- Indian foods and household portions. Every item needs grams, AS EATEN (cooked weight, not raw grain or flour).
- Every item MUST carry all four per-100 g numbers, for the food AS EATEN: cooked rice is about 130 kcal per 100 g, not 360.
- ${GREENS_RULE}
- Mark an item "compulsory": true ONLY when the brief fixes that food and its amount (for example "200 g curd daily", "1 scoop whey after gym"). Leave it off everything else.
- For each out-of-range result above, either adjust the plan or leave it, and say which in "adjustments". Do not invent results that are not listed.
- Do not prescribe or change medicines. The app adds a caution for each out-of-range result above by itself: do not repeat those. Use "cautions" for other "see your doctor" points.
- Targets must be consistent: 4 x protein + 4 x carbs + 9 x fat should be within 10% of kcal. If the brief gives a calorie figure or a carb limit, use exactly that as the target.
- CALORIES: for EVERY weekday, the every-day items plus that weekday's rotation items must add up to within ${pct}% of targets.kcal (for 1500 kcal: 1425 to 1575), and never above it. Add each weekday up before you answer and change the grams of non-compulsory items until it fits.
- CARBS: for every weekday, total carbs must not go above targets.carbs.
- Each meal lists the items eaten EVERY day in "items". If one dish changes by weekday, put it in "rotation" with one item per weekday. Omit "rotation" if nothing rotates.
- Keep it compact: at most 5 meals, at most 6 items per meal, at most 5 cautions and 6 adjustments, each one short sentence.

Return ONLY this JSON, no other text:
{
  "title": "<short plan name>",
  "eating_window": "<e.g. 12:00-20:00, or null>",
  "targets": { "kcal": <int>, "protein": <int g>, "carbs": <int g>, "fat": <int g>, "fiber": <int g> },
  "timetable": [ { "time": "HH:MM", "what": "<short>" } ],
  "meals": [
    { "meal": "<name>", "time": "HH:MM",
      "items": [ { "name": "<food>", "grams": <number>, "qty_text": "<household measure>", "compulsory": <true or false>,
                   "kcal_100g": <number>, "protein_100g": <number>, "carbs_100g": <number>, "fat_100g": <number> } ],
      "rotation": { "mon": { <item> }, "tue": { <item> }, "wed": { <item> }, "thu": { <item> }, "fri": { <item> }, "sat": { <item> }, "sun": { <item> } } }
  ],
  "avoid": [ "<food>" ],
  "cautions": [ "<one sentence>" ],
  "adjustments": [ { "for": "<result or condition>", "note": "<what the plan does about it>" } ]
}`;
}

function parseModelJSON(text) {
  const cleaned = String(text || '').replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const first = cleaned.indexOf('{'), last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { /* fall through */ }
  }
  return null;
}

/**
 * Replace the model's nutrition guesses with the food table's measured values
 * wherever we have the food — unless the two disagree wildly.
 *
 * A plan's grams are as eaten. The food table also holds RAW ingredients, and
 * the name lookup finds them: "Brown Rice" matches "Rice, Raw (Brown)" at 362
 * kcal, so 120 g of cooked rice was costed at 434 kcal instead of about 150.
 * When the model's as-eaten figure and the table's differ by more than 2x,
 * the table row is a different food state; keep the model's figure.
 */
async function enrichDays(days) {
  const { enrichFromDB } = require('./aiChat');
  for (const day of days) {
    for (const m of day) {
      const enriched = await enrichFromDB(m.items).catch(() => null);
      if (!enriched) continue;
      m.items = m.items.map((it, i) => {
        const e = enriched[i];
        if (!e || !e.per_100g || !e.source || e.source === 'ai') return it;
        const ai = Number(it.per_100g?.calories) || 0;
        const db = Number(e.per_100g.calories) || 0;
        if (ai > 0 && (db > ai * 2 || db < ai / 2)) return it;
        return { ...it, per_100g: e.per_100g };
      });
    }
  }
  return days;
}

const NUTRITION_LOOKUP = 'NUTRITION LOOKUP';

function buildFillPrompt(names) {
  return `${NUTRITION_LOOKUP}
Give typical per-100 g nutrition for each food below AS EATEN (cooked, ready
to eat — not raw grain, flour or dry lentils). These are Indian home foods.
Estimate sensibly; do not return 0 for a food that has calories.
${GREENS_RULE} If a name below only says "soppu", cost it as cooked
palak palya.

Foods:
${names.map(n => `- ${n}`).join('\n')}

Return ONLY this JSON, using each name exactly as written above:
{ "foods": [ { "name": "<name>", "kcal_100g": <number>, "protein_100g": <number>, "carbs_100g": <number>, "fat_100g": <number> } ] }`;
}

/**
 * The model sometimes leaves the per-100 g numbers off a long plan. Ask once
 * more, for just those foods. Best effort: if this fails the items stay at 0
 * and the "no calorie figure" check blocks approval, which is the safe side.
 */
async function fillMissingNutrition(days) {
  const missing = new Set();
  days.forEach(d => d.forEach(m => m.items.forEach(it => { if (!(Number(it.per_100g?.calories) > 0)) missing.add(it.name); })));
  if (!missing.size) return 0;
  let found;
  try {
    const { text } = await require('./aiChat').callAI(buildFillPrompt([...missing].slice(0, 40)));
    found = parseModelJSON(text);
  } catch (_) { return 0; }
  const byName = new Map();
  for (const f of Array.isArray(found?.foods) ? found.foods : []) {
    const it = DP.normaliseItem({ ...f, grams: 100 });
    if (it && it.per_100g.calories > 0) byName.set(it.name.toLowerCase(), it.per_100g);
  }
  let filled = 0;
  days.forEach(d => d.forEach(m => {
    m.items = m.items.map(it => {
      const p = !(Number(it.per_100g?.calories) > 0) && byName.get(it.name.toLowerCase());
      if (!p) return it;
      filled += 1;
      return { ...it, per_100g: p };
    });
  }));
  return filled;
}

// ── Member: the approved plan in force. Declared before /:id. ────────────────
router.get('/me', roleCheck('patient'), async (req, res) => {
  try {
    const today = getISTDate();
    const plan = await DP.planInForce(pool, req.user.id, today);
    if (!plan) return res.json({ plan: null });
    // The brief, the lab flags and the checks are the coach's working notes.
    res.json({ plan: DP.memberView(plan) });
  } catch (err) { fail(res, err); }
});

// ── Phase 5: the plan as a PDF, and the grocery list. Declared before /:id. ──
const PDFS = require('../services/planPdf');
async function sendPdf(res, plan, { memberName, coachName, draft }) {
  const buf = PDFS.planPdf(DP.memberView(plan), { memberName, coachName, draft });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="FitLife-Diet-Plan-${PDFS.safeName(memberName)}-v${plan.version}.pdf"` });
  res.send(buf);
}
async function names(memberId) {
  const { rows: [r] } = await pool.query(
    `SELECT u.name, c.name AS coach FROM users u
       LEFT JOIN monitor_patients mp ON mp.patient_id = u.id AND mp.active = true
       LEFT JOIN users c ON c.id = mp.monitor_id
      WHERE u.id = $1 LIMIT 1`, [memberId]);
  return { memberName: r?.name || '', coachName: r?.coach || '' };
}
router.get('/me/pdf', roleCheck('patient'), async (req, res) => {
  try {
    const plan = await DP.planInForce(pool, req.user.id, getISTDate());
    if (!plan) return res.status(404).json({ error: 'Your coach has not set a diet plan yet.' });
    await sendPdf(res, plan, { ...(await names(req.user.id)), draft: false });
  } catch (err) { fail(res, err); }
});
router.get('/me/grocery', roleCheck('patient'), async (req, res) => {
  try {
    const plan = await DP.planInForce(pool, req.user.id, getISTDate());
    if (!plan) return res.json({ plan: null, items: [], prep: null });
    res.json({ plan: { id: plan.id, version: plan.version, title: plan.title },
      items: PDFS.groceryList(plan.days), prep: PDFS.prepList(plan.days) });
  } catch (err) { fail(res, err); }
});

/**
 * Write a draft for a member from a brief (or change the open draft on an
 * instruction). The one way a draft is made by the AI: the Studio and the
 * coach chat both come through here, so both get the same checks.
 * Throws an Error carrying .status for anything the coach should be told.
 */
async function createDraft(user, { memberId, brief = '', instruction = '' }) {
  const err = (status, message) => Object.assign(new Error(message), { status });
  if (!Number.isInteger(memberId)) throw err(400, 'member_id is required.');
  if (!(await canAccess(user, memberId))) throw err(403, 'Member not assigned to you.');
  const today = getISTDate();
  const ctx = await memberContext(memberId, today);
  if (!ctx) throw err(404, 'Member not found.');

  // A change request works on the existing draft.
  let base = null, baseRow = null;
  if (instruction) {
    const { rows: [d] } = await pool.query(`SELECT id FROM diet_plans WHERE patient_id=$1 AND status='draft'`, [memberId]);
    baseRow = d ? await DP.loadPlan(pool, d.id) : null;
    if (!baseRow) throw err(409, 'There is no draft to change. Create a draft first.');
    // Same shape as the answer we want back ("meals" + "rotation"), never
    // seven explicit days: a model echoes the shape it is shown.
    // lab_cautions are the app's, rebuilt on save: the model is not shown them.
    const { adjustments, lab_cautions, ...rest } = baseRow.content || {};
    base = { title: baseRow.title, targets: baseRow.targets, ...rest, meals: DP.toMealsShape(baseRow.days) };
  } else if (brief.length < 10) {
    throw err(400, 'Write a short brief first: the kind of diet, meals a day, foods to include.');
  }
  const useBrief = brief || baseRow?.brief || '';

  let text;
  try {
    // A whole week of meals with cautions does not fit in the 3000-token
    // reply every other AI call uses; cut off, it is half a JSON object.
    ({ text } = await require('./aiChat').callAI(buildDraftPrompt(ctx, useBrief, { base, instruction }),
      { maxTokens: 8000, timeout: 60000, json: true, failOnTruncation: true }));
  } catch (_) {
    throw err(502, 'The AI could not draft a plan just now. Nothing was changed. Try again in a minute.');
  }
  const draft = DP.normaliseDraft(parseModelJSON(text));
  if (!draft) throw err(502, 'The AI answer could not be read as a plan. Nothing was changed. Try again, or shorten the brief.');
  await fillMissingNutrition(draft.days);
  await enrichDays(draft.days);

  const id = await inTx(client => DP.saveDraft(client, {
    memberId, coachId: user.id, source: baseRow?.source || 'brief',
    title: draft.title, brief: useBrief, targets: draft.targets, content: draft.content,
    flags: ctx.flags, days: draft.days,
  }));
  return present(await DP.loadPlan(pool, id), today);
}

// ── Coach ────────────────────────────────────────────────────────────────────
router.post('/draft', coachOnly, async (req, res) => {
  try {
    res.json({ plan: await createDraft(req.user, {
      memberId: parseInt(req.body?.member_id),
      brief: String(req.body?.brief || '').trim(),
      instruction: String(req.body?.instruction || '').trim(),
    }) });
  } catch (err) { fail(res, err); }
});

router.get('/member/:memberId', coachOnly, async (req, res) => {
  try {
    const memberId = parseInt(req.params.memberId);
    if (!Number.isInteger(memberId)) return res.status(400).json({ error: 'Bad member id.' });
    if (!(await canAccess(req.user, memberId))) return res.status(403).json({ error: 'Member not assigned to you.' });
    const today = getISTDate();
    const { rows } = await pool.query(
      `SELECT id, version, status, source, title, effective_from::text AS effective_from, approved_at, created_at
         FROM diet_plans WHERE patient_id=$1 ORDER BY version DESC`, [memberId]);
    const inForce = await DP.planInForce(pool, memberId, today);
    const draftRow = rows.find(r => r.status === 'draft');
    // The member's own daily targets (what Today counts against). A plan
    // imported from a PDF that names only calories and protein has no carb or
    // fat target: the carb check cannot run and the member's plan shows "—".
    // The Studio offers these in one tap; nothing is filled in silently.
    const { rows: [mp] } = await pool.query(
      `SELECT macro_kcal, macro_pro, macro_carb, macro_fat FROM patient_profiles WHERE user_id=$1`, [memberId]);
    const num = (v) => (v == null ? null : Number(v));
    // Upcoming = approved, not started yet, and approved after the plan now
    // in force (an older scheduled version that has since been overruled by a
    // newer approval will never take over, so it is not "upcoming").
    const upcoming = rows.filter(r => r.status === 'approved' && r.effective_from > today
        && (!inForce || new Date(r.approved_at) > new Date(inForce.approved_at)))
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0] || null;
    res.json({
      today,
      member_targets: { kcal: num(mp?.macro_kcal), protein: num(mp?.macro_pro), carbs: num(mp?.macro_carb), fat: num(mp?.macro_fat) },
      in_force: inForce,
      upcoming,
      draft: draftRow ? await present(await DP.loadPlan(pool, draftRow.id), today) : null,
      history: rows.filter(r => r.status === 'approved').map(r => ({ ...r, in_force: !!inForce && r.id === inForce.id })),
    });
  } catch (err) { fail(res, err); }
});

router.post('/member/:memberId/revise', coachOnly, async (req, res) => {
  try {
    const memberId = parseInt(req.params.memberId);
    if (!Number.isInteger(memberId)) return res.status(400).json({ error: 'Bad member id.' });
    if (!(await canAccess(req.user, memberId))) return res.status(403).json({ error: 'Member not assigned to you.' });
    const today = getISTDate();
    const cur = await DP.planInForce(pool, memberId, today);
    if (!cur) return res.status(404).json({ error: 'There is no approved plan to revise.' });
    const ctx = await memberContext(memberId, today);
    const id = await inTx(client => DP.saveDraft(client, {
      memberId, coachId: req.user.id, source: 'revision', title: cur.title, brief: cur.brief,
      targets: cur.targets, content: cur.content, flags: ctx ? ctx.flags : [], days: cur.days,
    }));
    res.json({ plan: await present(await DP.loadPlan(pool, id), today) });
  } catch (err) { fail(res, err); }
});

async function ownedPlan(req, res) {
  const id = parseInt(req.params.id);
  const plan = Number.isInteger(id) ? await DP.loadPlan(pool, id) : null;
  if (!plan) { res.status(404).json({ error: 'Plan not found.' }); return null; }
  if (!(await canAccess(req.user, plan.patient_id))) { res.status(403).json({ error: 'Member not assigned to you.' }); return null; }
  return plan;
}

// The coach's copy to send. A draft is marked DRAFT on every page.
router.get('/:id/pdf', coachOnly, async (req, res) => {
  try {
    const plan = await ownedPlan(req, res);
    if (!plan) return;
    await sendPdf(res, plan, { ...(await names(plan.patient_id)), draft: plan.status === 'draft' });
  } catch (err) { fail(res, err); }
});

router.get('/:id', coachOnly, async (req, res) => {
  try {
    const plan = await ownedPlan(req, res);
    if (plan) res.json({ plan: await present(plan, getISTDate()) });
  } catch (err) { fail(res, err); }
});

/**
 * Edit a draft. Body may carry: title, targets, content {avoid, cautions,
 * timetable, eating_window}, effective_from, and item `edits`:
 *   { meal, name, grams }           change grams      (all weekdays unless `weekday` given)
 *   { meal, name, remove: true }    remove the item
 *   { meal, name, compulsory: bool } fix (or free) the item's portion for Fit to target
 *   { meal, add: { name, grams } }  add an item
 * and fill_nutrition: true to look up foods that have no calorie figure.
 */
router.patch('/:id', coachOnly, async (req, res) => {
  try {
    const plan = await ownedPlan(req, res);
    if (!plan) return;
    if (plan.status !== 'draft') return res.status(409).json({ error: 'An approved plan cannot be edited. Use Revise to make a new version.' });
    const b = req.body || {};

    let days = null;
    if (Array.isArray(b.edits) && b.edits.length) {
      days = plan.days.map(d => d.map(m => ({ ...m, items: m.items.map(it => ({ ...it })) })));
      let added = false;
      for (const e of b.edits.slice(0, 50)) {
        const mealName = String(e?.meal || '').toLowerCase();
        const only = Number.isInteger(e?.weekday) && e.weekday >= 0 && e.weekday <= 6 ? e.weekday : null;
        days.forEach((d, w) => {
          if (only !== null && w !== only) return;
          const m = d.find(x => x.meal.toLowerCase() === mealName);
          if (!m) return;
          if (e.add) {
            const it = DP.normaliseItem(e.add);
            if (it && !m.items.some(x => x.name.toLowerCase() === it.name.toLowerCase())) { m.items.push(it); added = true; }
            return;
          }
          const name = String(e.name || '').toLowerCase();
          if (typeof e.compulsory === 'boolean') {
            m.items.forEach(x => { if (x.name.toLowerCase() === name) x.compulsory = e.compulsory; });
            return;
          }
          if (e.remove) { m.items = m.items.filter(x => x.name.toLowerCase() !== name); return; }
          const g = parseFloat(e.grams);
          if (Number.isFinite(g) && g >= 1 && g <= 2000) {
            m.items.forEach(x => { if (x.name.toLowerCase() === name) { x.grams = g; x.qty_text = `${g} g`; } });
          }
        });
      }
      days = days.map(d => d.filter(m => m.items.length));
      if (added) await enrichDays(days);
    }
    // "Look up missing calories": for a draft that still has foods at 0 kcal
    // (a revision of an older plan, or a lookup that failed the first time).
    if (b.fill_nutrition === true) {
      days = days || plan.days.map(d => d.map(m => ({ ...m, items: m.items.map(it => ({ ...it })) })));
      await fillMissingNutrition(days);
      await enrichDays(days);
    }

    await inTx(client => DP.updateDraft(client, plan.id, {
      title: b.title, targets: b.targets, content: b.content, effective_from: b.effective_from, days,
    }));
    res.json({ plan: await present(await DP.loadPlan(pool, plan.id), getISTDate()) });
  } catch (err) { fail(res, err); }
});

/**
 * Fit to target. Scales the portions of non-compulsory items so each day
 * lands inside the allowed calorie range and under the carb limit.
 * Arithmetic in services/dietPlan.js; no AI call.
 *
 * Without `apply` nothing is saved: the coach is shown what would change.
 * With apply: true the same sum is done again on the draft as it stands now
 * and saved, so what is saved can never be a stale preview.
 */
router.post('/:id/fit', coachOnly, async (req, res) => {
  try {
    const plan = await ownedPlan(req, res);
    if (!plan) return;
    if (plan.status !== 'draft') return res.status(409).json({ error: 'An approved plan cannot be edited. Use Revise to make a new version.' });
    const fit = DP.fitToTarget(plan);
    if (!fit.ok) return res.status(422).json({ error: fit.reason });
    const { days, ...report } = fit;
    if (req.body?.apply !== true || !fit.changes.length) {
      return res.json({ applied: false, fit: report });
    }
    await inTx(client => DP.updateDraft(client, plan.id, { days }));
    res.json({ applied: true, fit: report, plan: await present(await DP.loadPlan(pool, plan.id), getISTDate()) });
  } catch (err) { fail(res, err); }
});

router.post('/:id/approve', coachOnly, async (req, res) => {
  try {
    const plan = await ownedPlan(req, res);
    if (!plan) return;
    const today = getISTDate();
    const approved = await inTx(client => DP.approveDraft(client, plan.id, {
      coachId: req.user.id, today,
      effectiveFrom: req.body?.effective_from,
      acknowledgeWarnings: req.body?.acknowledge_warnings === true,
    }));

    // After the commit, and never awaited: a push that fails must not undo an
    // approval, and must not make the coach's screen say it failed.
    audit(req.user, 'diet_plan_approved', approved.patient_id, `v${approved.version} from ${approved.effective_from}`);
    const starts = approved.effective_from > today ? `It starts on ${approved.effective_from}.` : 'Open FitLife to see today\'s meals.';
    try {
      require('../services/pushService')
        .sendToUser(approved.patient_id, 'Your diet plan is ready', `${approved.title}. ${starts}`, 'coach-ai')
        .catch(() => {});
    } catch (_) { /* push not configured */ }

    res.json({ plan: approved });
  } catch (err) { fail(res, err); }
});

router.post('/:id/discard', coachOnly, async (req, res) => {
  try {
    const plan = await ownedPlan(req, res);
    if (!plan) return;
    const { rowCount } = await pool.query(`DELETE FROM diet_plans WHERE id=$1 AND status='draft'`, [plan.id]);
    if (!rowCount) return res.status(409).json({ error: 'Only a draft can be discarded.' });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

module.exports = router;
module.exports.buildDraftPrompt = buildDraftPrompt;
module.exports.parseModelJSON   = parseModelJSON;
module.exports.buildFillPrompt  = buildFillPrompt;
module.exports.createDraft      = createDraft;
module.exports.fillMissingNutrition = fillMissingNutrition;
module.exports.enrichDays       = enrichDays;
module.exports.canAccess        = canAccess;
module.exports.memberContext    = memberContext;
module.exports.kcalFromBrief    = kcalFromBrief;
